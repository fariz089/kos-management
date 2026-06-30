const prisma = require('./prisma');
const { tenantStage } = require('./lifecycle');

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/**
 * Rekonsiliasi tagihan dengan data penghuni. IDEMPOTEN & ringan — aman dipanggil
 * berulang (mis. tiap kali dashboard/bills dimuat) supaya data selalu konsisten
 * tanpa perlu tombol manual "Rapikan".
 *
 * Memperbaiki 4 hal:
 *   1. Hapus tagihan "hantu" (pola generate bulanan) untuk penghuni yang belum masuk
 *      & belum dibayar.
 *   2. Hapus tagihan sewa GANDA di luar jumlah bulan kontrak (durationMonths)
 *      yang belum ada pembayaran.
 *   3. Selaraskan paidAmount tagihan PARTIAL dengan tenant.depositAmount (beda ≤ 5 rupiah).
 *   4. Koreksi dueDate tagihan yang lebih awal dari tanggal masuk penghuni →
 *      set ke tanggal masuk (sesuai aturan: jatuh tempo dihitung saat penghuni masuk).
 *
 * @param {string} ownerId
 * @returns {Promise<{removedPhantom:number, removedDuplicate:number, fixedDp:number, fixedDueDate:number}>}
 */
async function reconcileBilling(ownerId) {
  const tenants = await prisma.tenant.findMany({
    where: { room: { property: { ownerId } } },
    include: { bills: { orderBy: { createdAt: 'asc' } } },
  });

  let removedPhantom = 0;
  let removedDuplicate = 0;
  let fixedDp = 0;
  let fixedDueDate = 0;
  const phantomPattern = /^Sewa kamar .+ — \d+\/\d{4}$/;

  for (const t of tenants) {
    const moveIn = t.moveInDate ? startOfDay(t.moveInDate) : null;
    const rentBills = t.bills.filter((b) => b.type === 'RENT' && b.status !== 'CANCELLED');

    // 1) Tagihan hantu
    for (const b of rentBills) {
      const isPhantomDesc = phantomPattern.test(b.description || '');
      const unpaid = (b.paidAmount || 0) === 0 && ['UNPAID', 'OVERDUE'].includes(b.status);
      const notYetMovedIn = moveIn && moveIn > new Date(b.dueDate);
      if (isPhantomDesc && unpaid && notYetMovedIn) {
        await prisma.payment.deleteMany({ where: { billId: b.id } }).catch(() => {});
        await prisma.bill.delete({ where: { id: b.id } }).catch(() => {});
        removedPhantom += 1;
      }
    }

    // 2) Tagihan sewa ganda di luar kontrak
    const remainingRent = await prisma.bill.findMany({
      where: { tenantId: t.id, type: 'RENT', status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'asc' },
    });
    const maxBills = t.durationMonths || 1;
    if (remainingRent.length > maxBills) {
      const excess = remainingRent.slice(maxBills);
      for (const b of excess) {
        if ((b.paidAmount || 0) === 0) {
          await prisma.payment.deleteMany({ where: { billId: b.id } }).catch(() => {});
          await prisma.bill.delete({ where: { id: b.id } }).catch(() => {});
          removedDuplicate += 1;
        }
      }
    }

    // 3) Selaraskan DP (beda kecil 1-5 rupiah)
    if (t.depositAmount != null) {
      const partial = remainingRent.find((b) => b.status === 'PARTIAL');
      if (partial) {
        const diff = Math.abs((partial.paidAmount || 0) - t.depositAmount);
        if (diff >= 1 && diff <= 5) {
          await prisma.bill.update({
            where: { id: partial.id },
            data: { paidAmount: t.depositAmount },
          });
          fixedDp += 1;
        }
      }
    }

    // 4) Koreksi jatuh tempo tagihan sewa PERIODE PERTAMA → harus = tanggal masuk.
    //    Aturan kos:
    //      • Sewa periode pertama  : jatuh tempo = tanggal MASUK (moveInDate).
    //          mis. masuk 1 Agustus → wajib lunas 1 Agustus.
    //      • Tagihan PERPANJANGAN  : jatuh tempo = tanggal mulai perpanjangan,
    //          sudah benar dari endpoint /renew → JANGAN diubah.
    //
    //    Catatan penting: koreksi dilakukan dua arah (baik dueDate yang lebih
    //    AWAL maupun lebih AKHIR dari tanggal masuk), karena data seed/import
    //    lama memakai tanggal hard-coded (mis. 10 Jun / 4 Agu) yang justru
    //    sering LEBIH AKHIR dari tanggal masuk. Versi lama hanya mengoreksi
    //    yang lebih awal sehingga kasus ini lolos dan jatuh tempo tetap salah.
    if (moveIn) {
      // Tagihan periode pertama = RENT paling awal dibuat yang BUKAN perpanjangan.
      const firstPeriod = remainingRent.find(
        (b) => !String(b.description || '').startsWith('Perpanjang')
      );
      if (firstPeriod && firstPeriod.dueDate &&
          startOfDay(firstPeriod.dueDate).getTime() !== moveIn.getTime()) {
        await prisma.bill.update({
          where: { id: firstPeriod.id },
          data: { dueDate: moveIn },
        });
        fixedDueDate += 1;
      }
    }
  }

  return { removedPhantom, removedDuplicate, fixedDp, fixedDueDate };
}

/**
 * Selaraskan status KAMAR dari tahap lifecycle penghuninya (computed), bukan dari
 * field tersimpan yang sering melenceng. Aturan per kamar:
 *   - OCCUPIED  : ada penghuni yang stage-nya ACTIVE (sedang tinggal hari ini).
 *   - RESERVED  : tidak ada yang ACTIVE, tapi ada UPCOMING/RESERVED (akan masuk).
 *   - AVAILABLE : tidak ada penghuni aktif/akan masuk.
 *   - MAINTENANCE: dihormati apa adanya (tidak diutak-atik otomatis).
 *
 * @param {string} ownerId
 * @returns {Promise<{fixedRooms:number}>}
 */
async function reconcileRoomStatus(ownerId, now = new Date()) {
  const rooms = await prisma.room.findMany({
    where: { property: { ownerId } },
    include: {
      tenants: {
        select: { moveInDate: true, moveOutDate: true, status: true,
          bills: { select: { amount: true, paidAmount: true, status: true } } },
      },
    },
  });

  let fixedRooms = 0;
  for (const r of rooms) {
    if (r.status === 'MAINTENANCE') continue; // jangan ganggu kamar perbaikan

    let hasActive = false;
    let hasUpcoming = false;
    for (const t of r.tenants) {
      const stage = tenantStage(t, now).stage;
      if (stage === 'ACTIVE') hasActive = true;
      else if (stage === 'UPCOMING' || stage === 'RESERVED') hasUpcoming = true;
    }

    const correct = hasActive ? 'OCCUPIED' : hasUpcoming ? 'RESERVED' : 'AVAILABLE';
    if (r.status !== correct) {
      await prisma.room.update({ where: { id: r.id }, data: { status: correct } });
      fixedRooms += 1;
    }
  }
  return { fixedRooms };
}

module.exports = { reconcileBilling, reconcileRoomStatus };