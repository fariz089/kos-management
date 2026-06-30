const express = require('express');
const prisma = require('../utils/prisma');
const { authMiddleware } = require('../middleware/auth');
const { priceForRoom } = require('../utils/pricing');
const { tenantStage } = require('../utils/lifecycle');
const { isRoomFree } = require('../utils/availability');
const { reconcileRoomStatus } = require('../utils/reconcile');

const router = express.Router();

// Kirim WhatsApp via Hermes bridge (fire-and-forget, non-blocking)
async function sendWhatsApp(phone, message) {
  try {
    let p = String(phone).replace(/\D/g, '');
    if (p.startsWith('0')) p = '62' + p.slice(1);
    if (!p.startsWith('62')) p = '62' + p;
    const bridgeUrl = process.env.HERMES_WA_BRIDGE_URL || 'http://hermes:3000';
    const response = await fetch(`${bridgeUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: `${p}@s.whatsapp.net`, message }),
    });
    return response.ok;
  } catch (e) {
    console.error('WA send error (tenants, non-blocking):', e.message);
    return false;
  }
}

// GET /api/tenants
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status, roomId } = req.query;
    const where = {
      room: { property: { ownerId: req.user.id } },
    };
    if (status) where.status = status;
    if (roomId) where.roomId = roomId;

    const tenants = await prisma.tenant.findMany({
      where,
      include: {
        room: { select: { number: true, property: { select: { name: true } } } },
        bills: { select: { amount: true, paidAmount: true, status: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Tambahkan tahap lifecycle terhitung (Dipesan/Akan Masuk/Aktif/Selesai)
    const withStage = tenants.map((t) => {
      const s = tenantStage(t);
      // jangan bocorkan detail bills mentah ke list; cukup ringkasan
      const { bills, ...rest } = t;
      return { ...rest, stage: s.stage, stageLabel: s.label, stageColor: s.color, outstanding: s.outstanding };
    });

    // Filter by stage kalau diminta (mis. ?stage=ACTIVE) — di atas filter status DB
    const result = req.query.stage
      ? withStage.filter((t) => t.stage === req.query.stage)
      : withStage;

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/tenants/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        room: { include: { property: true } },
        bills: { orderBy: { dueDate: 'desc' } },
      },
    });
    if (!tenant) return res.status(404).json({ error: 'Penghuni tidak ditemukan' });
    const s = tenantStage(tenant);
    res.json({ ...tenant, stage: s.stage, stageLabel: s.label, stageColor: s.color, outstanding: s.outstanding });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tenants
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      name, phone, email, ktpNumber, occupation, emergency,
      moveInDate, moveOutDate, roomId,
      depositAmount,          // DP / uang muka — BEBAS nominal (boleh berapa saja)
      status,                 // opsional override; default tergantung ada DP/tidak
      createBills = true,     // buat tagihan otomatis (sewa kontrak)
      rentAmount,             // opsional override harga sewa/bulan; default = harga dinamis
      durationMonths,         // lama sewa (bulan). default 1
      discountAmount,         // nominal diskon (Rupiah). default 0
      discountType,           // 'TOTAL' (potong sekali) | 'PER_MONTH' (potong tiap bulan)
    } = req.body;

    // Harga sewa/bulan dinamis berdasarkan tanggal masuk (boleh dioverride manual)
    let monthlyRent = Number(rentAmount) || 0;
    let priceInfo = null;
    if (!monthlyRent) {
      priceInfo = await priceForRoom(roomId, moveInDate || new Date());
      monthlyRent = priceInfo.price;
    }

    const months = Number(durationMonths) > 0 ? Number(durationMonths) : 1;
    const discount = Number(discountAmount) > 0 ? Number(discountAmount) : 0;
    const dType = discount > 0 ? (discountType || 'TOTAL') : null;

    // Hitung total kontrak setelah diskon
    //  - TOTAL     : potong sekali dari keseluruhan  → (sewa*bulan) - diskon
    //  - PER_MONTH : potong tiap bulan               → (sewa - diskon) * bulan
    const grossTotal = Math.round(monthlyRent * months);
    const contractTotal = dType === 'PER_MONTH'
      ? Math.max(0, Math.round((monthlyRent - discount) * months))
      : Math.max(0, Math.round(grossTotal - discount));

    const dp = depositAmount ? Math.round(Number(depositAmount)) : null;

    // ── Penentuan status TERSIMPAN (sederhana; tahap kaya dihitung helper) ──
    // Aturan: simpan ACTIVE hanya bila penghuni benar-benar masuk SEKARANG & lunas.
    // Selain itu simpan PENDING — biar lifecycle helper yang memetakan jadi
    // Dipesan / Akan Masuk sesuai tanggal & sisa bayar. Ini mencegah penghuni
    // yang masuk bulan depan tampil "Aktif".
    const moveInD = new Date(moveInDate);
    const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
    const moveInDay = new Date(moveInD); moveInDay.setHours(0, 0, 0, 0);
    const sisaAwal = dp ? Math.max(0, contractTotal - dp) : 0;
    const isFutureMoveIn = moveInDay > todayD;
    const hasOutstanding = sisaAwal > 0;

    // Default: PENDING kalau ada DP / belum lunas / tanggal masuk di masa depan.
    const tenantStatus = status || ((dp || isFutureMoveIn || hasOutstanding) ? 'PENDING' : 'ACTIVE');
    // Kamar: RESERVED bila penghuni belum benar-benar menempati sekarang.
    const roomStatus = (tenantStatus === 'ACTIVE' && !isFutureMoveIn) ? 'OCCUPIED' : 'RESERVED';

    await prisma.room.update({ where: { id: roomId }, data: { status: roomStatus } });

    const tenant = await prisma.tenant.create({
      data: {
        name, phone, email, ktpNumber, occupation, emergency,
        moveInDate: new Date(moveInDate),
        ...(moveOutDate ? { moveOutDate: new Date(moveOutDate) } : {}),
        ...(dp ? { depositAmount: dp } : {}),
        durationMonths: months,
        discountAmount: discount,
        discountType: dType,
        status: tenantStatus,
        roomId,
      },
      include: { room: { include: { property: true } } },
    });

    // ── Buat tagihan otomatis ──────────────────────────────
    const createdBills = [];
    if (createBills) {
      const moveIn = new Date(moveInDate);
      const dueDate = new Date(moveIn); // jatuh tempo = tanggal masuk (harus lunas sebelum masuk)

      // Satu tagihan SEWA untuk seluruh kontrak (sudah termasuk diskon).
      // DP dianggap pembayaran sebagian (paidAmount). Sisa = contractTotal - dp.
      const paid = dp ? Math.round(Math.min(dp, contractTotal)) : 0;
      const billStatus = paid >= contractTotal ? 'PAID' : (paid > 0 ? 'PARTIAL' : 'UNPAID');

      const durasiTxt = months > 1 ? `${months} bulan` : 'bulan pertama';
      const diskonTxt = discount > 0
        ? ` (diskon Rp ${discount.toLocaleString('id-ID')}${dType === 'PER_MONTH' ? '/bln' : ''})`
        : '';

      const rentBill = await prisma.bill.create({
        data: {
          type: 'RENT',
          amount: contractTotal,
          discount,
          paidAmount: paid,
          dueDate,
          ...(billStatus === 'PAID' ? { paidAt: new Date() } : {}),
          status: billStatus,
          description: `Sewa ${durasiTxt} - Kamar ${tenant.room.number}${diskonTxt}`,
          tenantId: tenant.id,
          roomId,
        },
      });
      createdBills.push(rentBill);

      if (dp) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { depositPaidAt: new Date() },
        }).catch(() => {});
      }
    }

    // ── Kirim WhatsApp pemberitahuan (non-blocking) ────────
    if (tenant.phone) {
      const moveInStr = new Date(moveInDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      const sisa = dp ? Math.max(0, contractTotal - dp) : contractTotal;
      const lines = [
        `🏠 *Booking Diterima — ${tenant.room.property?.name || 'Andhata Boarding House'}*`,
        ``,
        `Halo ${tenant.name},`,
        `Kamar *${tenant.room.number}* sudah kami reservasi untuk kamu. 🎉`,
        ``,
        `📋 *Rincian:*`,
        `• Kamar: ${tenant.room.number}`,
        `• Tanggal masuk: ${moveInStr}`,
        `• Sewa: Rp ${monthlyRent.toLocaleString('id-ID')}/bln${months > 1 ? ` × ${months} bln` : ''}`,
      ];
      if (discount > 0) lines.push(`• Diskon: Rp ${discount.toLocaleString('id-ID')}${dType === 'PER_MONTH' ? '/bln' : ''}`);
      lines.push(`• Total: Rp ${contractTotal.toLocaleString('id-ID')}`);
      if (dp) {
        lines.push(`• DP dibayar: Rp ${dp.toLocaleString('id-ID')}`);
        lines.push(`• *Sisa kurang bayar: Rp ${sisa.toLocaleString('id-ID')}*`);
        lines.push(``);
        lines.push(`⚠️ *Mohon lunasi sisa kekurangan sebelum tanggal masuk* agar kamar bisa kamu tempati.`);
      } else {
        lines.push(``);
        lines.push(`Mohon lakukan pembayaran sewa sesuai tagihan ya.`);
      }
      lines.push(`Ketik *"bayar"* untuk link pembayaran, atau bayar langsung (cash/transfer) ke pemilik kos.`);
      lines.push(`Terima kasih! 🙏`);
      sendWhatsApp(tenant.phone, lines.join('\n'));
    }

    res.status(201).json({ ...tenant, bills: createdBills, priceInfo, contractTotal });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/tenants/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { name, phone, email, ktpNumber, occupation, emergency, status, moveInDate, moveOutDate, roomId, depositAmount, durationMonths, discountAmount, discountType } = req.body;

    const data = { name, phone, email, ktpNumber, occupation, emergency };
    if (status) data.status = status;
    if (moveInDate) data.moveInDate = new Date(moveInDate);
    // moveOutDate: kirim tanggal untuk set, kirim null/"" untuk kosongkan
    if (moveOutDate !== undefined) data.moveOutDate = moveOutDate ? new Date(moveOutDate) : null;
    if (depositAmount !== undefined) data.depositAmount = depositAmount ? Number(depositAmount) : null;
    if (durationMonths !== undefined) data.durationMonths = durationMonths ? Number(durationMonths) : null;
    if (discountAmount !== undefined) data.discountAmount = discountAmount ? Number(discountAmount) : 0;
    if (discountType !== undefined) data.discountType = discountType || null;

    // Handle room change
    if (roomId) {
      const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
      if (tenant && tenant.roomId !== roomId) {
        // Free up old room if no other active tenants
        const activeCount = await prisma.tenant.count({
          where: { roomId: tenant.roomId, status: 'ACTIVE', id: { not: req.params.id } },
        });
        if (activeCount === 0) {
          await prisma.room.update({
            where: { id: tenant.roomId },
            data: { status: 'AVAILABLE' },
          });
        }
        // Occupy new room
        await prisma.room.update({
          where: { id: roomId },
          data: { status: 'OCCUPIED' },
        });
        data.roomId = roomId;
      }
    }

    // If tenant is leaving, free up the room
    if (status === 'INACTIVE') {
      const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
      const activeCount = await prisma.tenant.count({
        where: { roomId: tenant.roomId, status: 'ACTIVE', id: { not: req.params.id } },
      });
      if (activeCount === 0) {
        await prisma.room.update({
          where: { id: tenant.roomId },
          data: { status: 'AVAILABLE' },
        });
      }
    }

    const updated = await prisma.tenant.update({
      where: { id: req.params.id },
      data,
      include: {
        room: { select: { number: true, property: { select: { name: true } } } },
      },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/tenants/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) return res.status(404).json({ error: 'Penghuni tidak ditemukan' });

    // Delete related bills and payments first
    const bills = await prisma.bill.findMany({ where: { tenantId: req.params.id } });
    for (const bill of bills) {
      await prisma.payment.deleteMany({ where: { billId: bill.id } });
    }
    await prisma.bill.deleteMany({ where: { tenantId: req.params.id } });
    await prisma.message.deleteMany({ where: { tenantId: req.params.id } });

    await prisma.tenant.delete({ where: { id: req.params.id } });

    // Free up room if no other active tenants
    const activeCount = await prisma.tenant.count({
      where: { roomId: tenant.roomId, status: 'ACTIVE' },
    });
    if (activeCount === 0) {
      await prisma.room.update({
        where: { id: tenant.roomId },
        data: { status: 'AVAILABLE' },
      });
    }

    res.json({ message: 'Penghuni dihapus' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tenants/:id/renew — Perpanjang kontrak penghuni
// Body: { durationMonths, rentAmount?, discountAmount?, discountType?, depositAmount? }
router.post('/:id/renew', authMiddleware, async (req, res) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: { room: { include: { property: true } } },
    });
    if (!tenant) return res.status(404).json({ error: 'Penghuni tidak ditemukan' });

    const {
      durationMonths = 1,
      rentAmount,
      discountAmount = 0,
      discountType = 'TOTAL',
      depositAmount,
      startDate: startDateInput,   // tanggal mulai perpanjangan (opsional)
      roomId: targetRoomId,        // kamar tujuan (opsional; default = kamar saat ini)
    } = req.body;

    const months = Math.max(1, Number(durationMonths) || 1);

    // Tanggal mulai: pakai input manual, kalau kosong pakai tanggal keluar saat ini.
    const startDate = startDateInput
      ? new Date(startDateInput)
      : (tenant.moveOutDate || new Date());

    // Tanggal keluar baru
    const newMoveOut = new Date(startDate);
    newMoveOut.setMonth(newMoveOut.getMonth() + months);

    // Kamar tujuan: default kamar sekarang. Boleh pindah ke kamar lain.
    const roomId = targetRoomId || tenant.roomId;
    const isMovingRoom = roomId !== tenant.roomId;

    // ── VALIDASI BENTROK KAMAR ──────────────────────────────────
    // Cek kamar tujuan apakah bebas pada periode perpanjangan baru, abaikan
    // penghuni ini sendiri. Kalau bentrok (mis. kamar lama sudah dibooking
    // penghuni lain), tolak dengan pesan jelas — wajib pilih kamar kosong.
    const { free, conflict } = await isRoomFree(roomId, startDate, newMoveOut, tenant.id);
    if (!free) {
      const ci = conflict
        ? ` Kamar sudah dibooking ${conflict.name} (${new Date(conflict.moveInDate).toLocaleDateString('id-ID')}–${new Date(conflict.moveOutDate).toLocaleDateString('id-ID')}).`
        : '';
      return res.status(409).json({
        error: `Kamar tidak tersedia pada periode perpanjangan.${ci} Silakan pilih kamar lain yang kosong.`,
        needRoomChange: true,
        conflict,
      });
    }

    // Verifikasi kamar tujuan milik owner ini (kalau pindah).
    if (isMovingRoom) {
      const targetRoom = await prisma.room.findFirst({
        where: { id: roomId, property: { ownerId: req.user.id } },
      });
      if (!targetRoom) return res.status(400).json({ error: 'Kamar tujuan tidak valid.' });
    }

    // Harga sewa: pakai override, atau harga dinamis kamar TUJUAN pada tanggal mulai.
    let monthlyRent = Number(rentAmount) || 0;
    let priceInfo = null;
    if (!monthlyRent) {
      priceInfo = await priceForRoom(roomId, startDate);
      monthlyRent = priceInfo.price;
    }

    const discount = Number(discountAmount) > 0 ? Number(discountAmount) : 0;
    const dType = discount > 0 ? (discountType || 'TOTAL') : null;

    const grossTotal = Math.round(monthlyRent * months);
    const contractTotal = dType === 'PER_MONTH'
      ? Math.max(0, Math.round((monthlyRent - discount) * months))
      : Math.max(0, Math.round(grossTotal - discount));

    const dp = depositAmount ? Math.round(Number(depositAmount)) : 0;
    const paid = Math.round(Math.min(dp, contractTotal));
    const sisa = Math.max(0, contractTotal - paid);

    // durationMonths AKUMULATIF hanya bila tetap di kamar yang sama. Kalau PINDAH
    // kamar, anggap kontrak baru (durationMonths = months) supaya jumlah tagihan
    // konsisten per kamar.
    const newDuration = isMovingRoom ? months : (tenant.durationMonths || 1) + months;

    // Update tenant (termasuk pindah kamar bila perlu)
    const newStatus = sisa > 0 ? 'PENDING' : 'ACTIVE';
    const oldRoomId = tenant.roomId;
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        roomId,
        moveInDate: isMovingRoom ? startDate : tenant.moveInDate,
        moveOutDate: newMoveOut,
        durationMonths: newDuration,
        discountAmount: discount,
        discountType: dType,
        depositAmount: dp || null,
        depositPaidAt: dp ? new Date() : null,
        status: newStatus,
      },
    });

    // Selaraskan status kamar (lama & baru) via reconcile supaya konsisten.
    await reconcileRoomStatus(req.user.id).catch(() => {});

    // Ambil nomor kamar tujuan (bisa beda dari kamar lama kalau pindah).
    const targetRoom = isMovingRoom
      ? await prisma.room.findUnique({ where: { id: roomId }, select: { number: true } })
      : { number: tenant.room.number };
    const roomNumber = targetRoom?.number || tenant.room.number;

    // Buat tagihan sewa perpanjangan
    const dueDate = new Date(startDate); // jatuh tempo = tanggal mulai perpanjang
    const billStatus = paid >= contractTotal ? 'PAID' : (paid > 0 ? 'PARTIAL' : 'UNPAID');
    const durasiTxt = months > 1 ? `${months} bulan` : '1 bulan';
    const pindahTxt = isMovingRoom ? ` (pindah dari Kamar ${tenant.room.number})` : '';
    const diskonTxt = discount > 0
      ? ` (diskon Rp ${discount.toLocaleString('id-ID')}${dType === 'PER_MONTH' ? '/bln' : ''})`
      : '';

    const rentBill = await prisma.bill.create({
      data: {
        type: 'RENT',
        amount: contractTotal,
        discount,
        paidAmount: paid,
        dueDate,
        ...(billStatus === 'PAID' ? { paidAt: new Date() } : {}),
        status: billStatus,
        description: `Perpanjang sewa ${durasiTxt} - Kamar ${roomNumber}${pindahTxt}${diskonTxt}`,
        tenantId: tenant.id,
        roomId,
      },
    });

    // WhatsApp notification
    if (tenant.phone) {
      const mulaiStr = new Date(startDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      const selesaiStr = newMoveOut.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      const lines = [
        `🔄 *Perpanjangan Kos — ${tenant.room.property?.name || 'Andhata Boarding House'}*`,
        ``,
        `Halo ${tenant.name},`,
        `Kontrak kos kamu telah diperpanjang. 🎉`,
        ``,
        `📋 *Rincian:*`,
        `• Kamar: ${roomNumber}${isMovingRoom ? ` (pindah dari ${tenant.room.number})` : ''}`,
        `• Periode: ${mulaiStr} s/d ${selesaiStr}`,
        `• Sewa: Rp ${monthlyRent.toLocaleString('id-ID')}/bln × ${months} bln`,
      ];
      if (discount > 0) lines.push(`• Diskon: Rp ${discount.toLocaleString('id-ID')}${dType === 'PER_MONTH' ? '/bln' : ''}`);
      lines.push(`• Total: Rp ${contractTotal.toLocaleString('id-ID')}`);
      if (dp) {
        lines.push(`• DP dibayar: Rp ${dp.toLocaleString('id-ID')}`);
        lines.push(`• *Sisa kurang bayar: Rp ${sisa.toLocaleString('id-ID')}*`);
      }
      lines.push(``, `Terima kasih! 🙏`);
      sendWhatsApp(tenant.phone, lines.join('\n'));
    }

    res.json({ tenant: { ...tenant, moveOutDate: newMoveOut, status: newStatus }, bill: rentBill, contractTotal, priceInfo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;