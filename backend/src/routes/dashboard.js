const express = require('express');
const prisma = require('../utils/prisma');
const { authMiddleware } = require('../middleware/auth');
const { tenantStage } = require('../utils/lifecycle');

const router = express.Router();

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

// GET /api/dashboard — ringkasan kaya & informatif untuk pemilik kos.
// Setiap angka disertai konteks/rincian supaya jelas "berdasarkan apa".
router.get('/', authMiddleware, async (req, res) => {
  try {
    const ownerId = req.user.id;
    const now = new Date();
    const today = startOfDay(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const in30 = new Date(today); in30.setDate(in30.getDate() + 30);
    const monthLabel = now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

    // Ambil semua data yang dibutuhkan dalam beberapa query paralel.
    const [rooms, tenants, bills] = await Promise.all([
      prisma.room.findMany({
        where: { property: { ownerId } },
        select: { id: true, number: true, status: true, floor: true },
        orderBy: { number: 'asc' },
      }),
      prisma.tenant.findMany({
        where: { room: { property: { ownerId } } },
        include: {
          room: { select: { number: true } },
          bills: { select: { amount: true, paidAmount: true, status: true } },
        },
      }),
      prisma.bill.findMany({
        where: { room: { property: { ownerId } } },
        include: {
          tenant: { select: { name: true, phone: true } },
          room: { select: { number: true } },
        },
      }),
    ]);

    // ── KAMAR ───────────────────────────────────────────────
    const totalRooms = rooms.length;
    const occupiedRooms = rooms.filter((r) => r.status === 'OCCUPIED').length;
    const reservedRooms = rooms.filter((r) => r.status === 'RESERVED').length;
    const availableRooms = rooms.filter((r) => r.status === 'AVAILABLE').length;
    const maintenanceRooms = rooms.filter((r) => r.status === 'MAINTENANCE').length;
    const occupancyRate = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;

    // ── PENGHUNI per TAHAP (computed lifecycle) ─────────────
    const stageCount = { RESERVED: 0, UPCOMING: 0, ACTIVE: 0, FINISHED: 0, INACTIVE: 0 };
    const upcomingMoveIns = [];
    const upcomingMoveOuts = [];

    for (const t of tenants) {
      const s = tenantStage(t, now);
      stageCount[s.stage] = (stageCount[s.stage] || 0) + 1;

      // Akan masuk dalam 30 hari ke depan
      if (t.moveInDate) {
        const mi = startOfDay(t.moveInDate);
        if (mi >= today && mi <= in30 && s.stage !== 'INACTIVE') {
          upcomingMoveIns.push({
            id: t.id, name: t.name, phone: t.phone,
            room: t.room?.number || '-', date: t.moveInDate,
            stage: s.stage, stageLabel: s.label, outstanding: s.outstanding,
          });
        }
      }
      // Akan keluar dalam 30 hari ke depan
      if (t.moveOutDate) {
        const mo = startOfDay(t.moveOutDate);
        if (mo >= today && mo <= in30) {
          upcomingMoveOuts.push({
            id: t.id, name: t.name, phone: t.phone,
            room: t.room?.number || '-', date: t.moveOutDate,
          });
        }
      }
    }
    upcomingMoveIns.sort((a, b) => new Date(a.date) - new Date(b.date));
    upcomingMoveOuts.sort((a, b) => new Date(a.date) - new Date(b.date));

    const activeTenants = stageCount.ACTIVE;

    // ── KEUANGAN ────────────────────────────────────────────
    // 1) Pemasukan bulan ini = jumlah uang yang BENAR-BENAR diterima bulan ini.
    //    Dihitung dari paidAmount tagihan yang dibayar (paidAt) di bulan ini,
    //    plus pembayaran sebagian. Untuk sederhana & akurat, kita pakai:
    //    - tagihan PAID dengan paidAt bulan ini → seluruh paidAmount
    //    Catatan: DP yang masuk via PARTIAL juga dihitung lewat paidAmount-nya.
    let incomeThisMonth = 0;
    let incomeRent = 0, incomeDeposit = 0, incomeOther = 0;
    let dpCollectedTotal = 0;       // total DP/cicilan yang sudah masuk (semua waktu, dari tagihan PARTIAL)
    let outstandingTotal = 0;       // total piutang / kurang bayar (semua tagihan belum lunas)
    let unpaidCount = 0;            // jumlah tagihan belum lunas (UNPAID/PARTIAL/OVERDUE)
    let overdueAmount = 0;          // nominal tagihan jatuh tempo
    const overdueBills = [];        // daftar tagihan jatuh tempo (lewat dueDate, belum lunas)
    const partialBills = [];        // daftar tagihan kurang bayar (DP masuk, ada sisa)

    for (const b of bills) {
      const paid = b.paidAmount || 0;
      const remaining = Math.max(0, b.amount - paid);

      // Pemasukan bulan ini (uang yang diterima di bulan berjalan)
      if (b.paidAt && b.paidAt >= monthStart && b.paidAt <= monthEnd && paid > 0) {
        incomeThisMonth += paid;
        if (b.type === 'RENT') incomeRent += paid;
        else if (b.type === 'DEPOSIT') incomeDeposit += paid;
        else incomeOther += paid;
      }

      // Piutang / kurang bayar (semua tagihan yang belum lunas penuh)
      if (b.status !== 'PAID' && b.status !== 'CANCELLED' && remaining > 0) {
        outstandingTotal += remaining;
        unpaidCount += 1;

        // Tagihan kurang bayar (sudah ada DP masuk tapi belum lunas)
        if (b.status === 'PARTIAL' || paid > 0) {
          dpCollectedTotal += paid;
          partialBills.push({
            id: b.id, tenant: b.tenant?.name || 'N/A', phone: b.tenant?.phone,
            room: b.room?.number || '-', type: b.type,
            amount: b.amount, paid, remaining, dueDate: b.dueDate,
          });
        }

        // Jatuh tempo (lewat tanggal & belum lunas)
        if (b.dueDate && new Date(b.dueDate) < now) {
          overdueAmount += remaining;
          overdueBills.push({
            id: b.id, tenant: b.tenant?.name || 'N/A', phone: b.tenant?.phone,
            room: b.room?.number || '-', type: b.type,
            amount: b.amount, paid, remaining, dueDate: b.dueDate,
          });
        }
      }
    }

    overdueBills.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    partialBills.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    // 2) Proyeksi pemasukan bulan ini = total tagihan yang jatuh tempo bulan ini
    let projectedThisMonth = 0;
    for (const b of bills) {
      if (b.status === 'CANCELLED') continue;
      if (b.dueDate && new Date(b.dueDate) >= monthStart && new Date(b.dueDate) <= monthEnd) {
        projectedThisMonth += b.amount;
      }
    }

    res.json({
      monthLabel,

      // Kamar (dengan rincian)
      totalRooms,
      occupiedRooms,
      reservedRooms,
      availableRooms,
      maintenanceRooms,
      occupancyRate,

      // Penghuni per tahap lifecycle
      activeTenants,
      tenantStages: stageCount,        // { RESERVED, UPCOMING, ACTIVE, FINISHED, INACTIVE }

      // Keuangan — semua disertai konteks
      incomeThisMonth,                 // uang masuk bulan ini (riil)
      incomeBreakdown: {               // pemasukan ini berdasarkan apa
        rent: incomeRent,
        deposit: incomeDeposit,
        other: incomeOther,
      },
      projectedThisMonth,              // target/tagihan bulan ini
      dpCollectedTotal,                // total DP yang sudah masuk (di tagihan kurang bayar)
      outstandingTotal,                // total piutang / kurang bayar
      unpaidCount,                     // jumlah tagihan belum lunas
      overdueAmount,                   // nominal jatuh tempo
      overdueCount: overdueBills.length,

      // Daftar untuk panel
      overdueBills: overdueBills.slice(0, 10),
      partialBills: partialBills.slice(0, 10),     // "yang DP mana" → di sini
      upcomingMoveIns: upcomingMoveIns.slice(0, 10),
      upcomingMoveOuts: upcomingMoveOuts.slice(0, 10),

      // Kompatibilitas mundur (key lama)
      unpaidBills: unpaidCount,
      paidThisMonth: incomeThisMonth,
      totalBillingThisMonth: projectedThisMonth,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
