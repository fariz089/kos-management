const express = require('express');
const prisma = require('../utils/prisma');
const { authMiddleware } = require('../middleware/auth');
const { priceForRoom } = require('../utils/pricing');
const { reconcileBilling } = require('../utils/reconcile');
const { generateReport } = require('../utils/report');

const router = express.Router();

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
    console.error('WA send error (bills, non-blocking):', e.message);
    return false;
  }
}

// GET /api/bills
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Auto-rapikan data tagihan tiap kali daftar dimuat (idempoten & ringan):
    // hapus tagihan hantu/ganda, selaraskan DP, koreksi jatuh tempo. Tidak perlu
    // tombol manual — data selalu konsisten dengan kontrak penghuni.
    await reconcileBilling(req.user.id).catch((e) => console.error('reconcile (bills) skip:', e.message));

    const { status, tenantId, month, year } = req.query;
    const where = {
      room: { property: { ownerId: req.user.id } },
    };
    if (status) where.status = status;
    if (tenantId) where.tenantId = tenantId;
    if (month && year) {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0, 23, 59, 59);
      where.dueDate = { gte: start, lte: end };
    }

    const bills = await prisma.bill.findMany({
      where,
      include: {
        tenant: { select: { name: true, phone: true } },
        room: { select: { number: true } },
        payment: { select: { status: true, method: true, paidAt: true } },
      },
      orderBy: { dueDate: 'desc' },
    });
    // Tambahkan sisa kurang bayar (remaining) untuk tiap tagihan
    const enriched = bills.map(b => ({
      ...b,
      remaining: Math.max(0, b.amount - (b.paidAmount || 0)),
    }));
    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/bills/report.pdf — Laporan lengkap kos dalam format PDF.
// Ditempatkan sebelum route lain agar tidak bentrok dengan pola :id.
router.get('/report.pdf', authMiddleware, async (req, res) => {
  try {
    // Rapikan dulu supaya laporan akurat.
    await reconcileBilling(req.user.id).catch(() => {});
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Laporan-Kos.pdf"`);
    await generateReport(req.user.id, res);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: error.message });
    else res.end();
  }
});

// POST /api/bills — Create bill(s)
// Validates against tenant's contract to prevent duplicate/excess bills
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { tenantId, roomId, type, amount, dueDate, description } = req.body;

    // Validasi: untuk tagihan RENT, cek apakah sudah ada tagihan RENT yang cukup
    if (type === 'RENT' && tenantId) {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (tenant) {
        const maxBills = tenant.durationMonths || 1;
        const existingRentBills = await prisma.bill.count({
          where: { tenantId, type: 'RENT', status: { not: 'CANCELLED' } },
        });
        if (existingRentBills >= maxBills) {
          return res.status(400).json({
            error: `Penghuni ini sudah memiliki ${existingRentBills} tagihan sewa (kontrak ${maxBills} bulan). Tidak bisa menambah tagihan sewa lagi. Gunakan fitur "Perpanjang" di halaman Penghuni untuk memperpanjang kontrak.`,
          });
        }
      }
    }

    const bill = await prisma.bill.create({
      data: {
        type: type || 'RENT',
        amount,
        dueDate: new Date(dueDate),
        description,
        tenantId,
        roomId,
      },
    });

    // Sync: update tenant outstanding jika tagihan baru berpengaruh
    if (tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { bills: { select: { amount: true, paidAmount: true, status: true } } },
      });
      if (tenant) {
        const totalOutstanding = tenant.bills.reduce((sum, b) => {
          if (b.status === 'CANCELLED') return sum;
          return sum + Math.max(0, b.amount - (b.paidAmount || 0));
        }, 0);
        // Jika ada outstanding dan tenant ACTIVE, set ke PENDING agar lifecycle benar
        if (totalOutstanding > 0 && tenant.status === 'ACTIVE') {
          // Jangan ubah status kalau tenant sedang tinggal (moveIn <= hari ini <= moveOut)
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const moveIn = tenant.moveInDate ? new Date(tenant.moveInDate) : null;
          if (moveIn) moveIn.setHours(0, 0, 0, 0);
          const isLiving = moveIn && moveIn <= today;
          // Tidak mengubah status jika sudah tinggal — biarkan lifecycle helper yang handle
        }
      }
    }

    res.status(201).json(bill);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/bills/generate-monthly — Auto-generate rent bills for all active tenants
router.post('/generate-monthly', authMiddleware, async (req, res) => {
  try {
    const now = new Date();
    const month = req.body.month || now.getMonth() + 1; // 1-indexed
    const year = req.body.year || now.getFullYear();

    // Rentang bulan target
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0, 23, 59, 59);

    const activeTenants = await prisma.tenant.findMany({
      where: {
        status: { in: ['ACTIVE', 'PENDING'] },
        room: { property: { ownerId: req.user.id } },
      },
      include: {
        room: true,
        bills: { where: { type: 'RENT', status: { not: 'CANCELLED' } } },
      },
    });

    const bills = [];
    const skipped = [];
    for (const tenant of activeTenants) {
      const moveIn = tenant.moveInDate ? new Date(tenant.moveInDate) : null;
      const moveOut = tenant.moveOutDate ? new Date(tenant.moveOutDate) : null;

      // 1) Hanya generate kalau periode kontrak penghuni MENCAKUP bulan target.
      //    - moveIn harus <= akhir bulan target (sudah/akan masuk di bulan ini atau sebelumnya)
      //    - moveOut (kalau ada) harus >= awal bulan target (kontrak belum berakhir)
      //    Ini mencegah tagihan "hantu" untuk penghuni yang baru masuk bulan depan
      //    atau yang kontraknya sudah selesai.
      if (moveIn && moveIn > periodEnd) { skipped.push({ name: tenant.name, reason: 'belum masuk' }); continue; }
      if (moveOut && moveOut < periodStart) { skipped.push({ name: tenant.name, reason: 'kontrak selesai' }); continue; }

      // 2) JANGAN melebihi jumlah bulan kontrak (durationMonths).
      //    Tagihan sewa kontrak sudah dibuat saat booking/perpanjang. Generate
      //    bulanan tidak boleh menambah tagihan di luar kontrak — gunakan fitur
      //    "Perpanjang" untuk menambah periode baru.
      const maxBills = tenant.durationMonths || 1;
      if (tenant.bills.length >= maxBills) { skipped.push({ name: tenant.name, reason: 'kontrak sudah tertagih penuh' }); continue; }

      // 3) Cek apakah sudah ada tagihan RENT yang jatuh tempo di bulan ini.
      const existing = tenant.bills.find((b) => {
        const d = new Date(b.dueDate);
        return d >= periodStart && d <= periodEnd;
      });
      if (existing) { skipped.push({ name: tenant.name, reason: 'sudah ada tagihan bulan ini' }); continue; }

      // Harga dinamis berdasarkan tanggal masuk penghuni
      let rentAmount = tenant.room.price;
      try {
        const p = await priceForRoom(tenant.roomId, tenant.moveInDate);
        rentAmount = p.price;
      } catch (e) { /* fallback ke room.price */ }

      // Due date = tanggal masuk penghuni di bulan ini (anniversary)
      const moveInDay = moveIn ? moveIn.getDate() : 1;
      const dueDate = new Date(year, month - 1, moveInDay);

      const bill = await prisma.bill.create({
        data: {
          type: 'RENT',
          amount: rentAmount,
          dueDate,
          description: `Sewa kamar ${tenant.room.number} — ${month}/${year}`,
          tenantId: tenant.id,
          roomId: tenant.roomId,
        },
      });
      bills.push(bill);
    }

    res.json({ generated: bills.length, bills, skipped });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/bills/reconcile — (opsional) jalankan rekonsiliasi manual.
// Catatan: rekonsiliasi juga berjalan OTOMATIS tiap kali daftar tagihan/dashboard
// dimuat, jadi endpoint ini hanya untuk keperluan administratif/debug.
router.post('/reconcile', authMiddleware, async (req, res) => {
  try {
    const result = await reconcileBilling(req.user.id);
    res.json({ message: 'Rekonsiliasi selesai', ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/bills/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { status, amount, dueDate } = req.body;
    const data = {};
    if (status) data.status = status;
    if (amount) data.amount = amount;
    if (dueDate) data.dueDate = new Date(dueDate);
    if (status === 'PAID') data.paidAt = new Date();

    const bill = await prisma.bill.update({ where: { id: req.params.id }, data });
    res.json(bill);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/bills/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    // Delete associated payment first (if exists)
    await prisma.payment.deleteMany({ where: { billId: req.params.id } });
    await prisma.bill.delete({ where: { id: req.params.id } });
    res.json({ message: 'Tagihan dihapus' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/bills/:id/mark-paid — Catat pembayaran MANUAL (cash / transfer langsung)
// Tanpa payment gateway. Body: { method: 'CASH' | 'TRANSFER' }
router.post('/:id/mark-paid', authMiddleware, async (req, res) => {
  try {
    const method = (req.body.method || 'CASH').toUpperCase();
    if (!['CASH', 'TRANSFER'].includes(method)) {
      return res.status(400).json({ error: "method harus 'CASH' atau 'TRANSFER'" });
    }

    const bill = await prisma.bill.update({
      where: { id: req.params.id },
      data: { status: 'PAID', paidAt: new Date(), paymentMethod: method },
      include: { tenant: true, room: { include: { property: true } } },
    });

    // Set paidAmount = amount (lunas penuh)
    await prisma.bill.update({ where: { id: bill.id }, data: { paidAmount: bill.amount } }).catch(() => {});

    // Kalau ini tagihan DP, tandai depositPaidAt
    if (bill.type === 'DEPOSIT' && bill.tenantId) {
      await prisma.tenant.update({
        where: { id: bill.tenantId },
        data: { depositPaidAt: new Date() },
      }).catch(() => {});
    }

    // Aktivasi penghuni PENDING kalau semua tagihan wajib (DP + sewa pertama) sudah lunas
    let activated = false;
    if (bill.tenant?.status === 'PENDING') {
      const outstanding = await prisma.bill.count({
        where: { tenantId: bill.tenantId, status: { in: ['UNPAID', 'OVERDUE', 'PENDING'] } },
      });
      if (outstanding === 0) {
        await prisma.tenant.update({ where: { id: bill.tenantId }, data: { status: 'ACTIVE' } });
        await prisma.room.update({ where: { id: bill.roomId }, data: { status: 'OCCUPIED' } });
        activated = true;
      }
    }

    // Notifikasi WhatsApp (non-blocking)
    if (bill.tenant?.phone) {
      const amt = `Rp ${bill.amount.toLocaleString('id-ID')}`;
      const tipe = bill.type === 'RENT' ? 'Sewa Kamar' : bill.type === 'DEPOSIT' ? 'DP / Uang Muka' : bill.type;
      const metodeStr = method === 'CASH' ? 'Tunai (Cash)' : 'Transfer';
      const lines = [
        `✅ *Pembayaran Diterima*`,
        ``,
        `Halo ${bill.tenant.name},`,
        `Pembayaran kamu sudah kami terima & catat:`,
        ``,
        `• Tagihan: ${tipe}`,
        `• Kamar: ${bill.room.number}`,
        `• Jumlah: ${amt}`,
        `• Metode: ${metodeStr}`,
      ];
      if (activated) {
        lines.push(``);
        lines.push(`Semua pembayaran sudah lunas! Silakan datang ke ${bill.room.property?.name || 'kos'} untuk serah terima kunci. 🔑`);
      }
      lines.push(``, `Terima kasih! 🙏`);
      sendWhatsApp(bill.tenant.phone, lines.join('\n'));
    }

    res.json({ ...bill, activated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/bills/:id/pay-partial — Catat pembayaran SEBAGIAN (DP / cicilan, bebas nominal)
// Body: { amount: number, method: 'CASH' | 'TRANSFER' }
// paidAmount bertambah; status jadi PARTIAL (kalau belum penuh) atau PAID (kalau lunas).
router.post('/:id/pay-partial', authMiddleware, async (req, res) => {
  try {
    const addAmount = Number(req.body.amount);
    const method = (req.body.method || 'CASH').toUpperCase();
    if (!addAmount || addAmount <= 0) {
      return res.status(400).json({ error: 'Nominal pembayaran harus lebih dari 0' });
    }
    if (!['CASH', 'TRANSFER'].includes(method)) {
      return res.status(400).json({ error: "method harus 'CASH' atau 'TRANSFER'" });
    }

    const current = await prisma.bill.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: 'Tagihan tidak ditemukan' });

    const newPaid = Math.min(current.amount, (current.paidAmount || 0) + addAmount);
    const lunas = newPaid >= current.amount;
    const remaining = Math.max(0, current.amount - newPaid);

    const bill = await prisma.bill.update({
      where: { id: req.params.id },
      data: {
        paidAmount: newPaid,
        status: lunas ? 'PAID' : 'PARTIAL',
        paymentMethod: method,
        ...(lunas ? { paidAt: new Date() } : {}),
      },
      include: { tenant: true, room: { include: { property: true } } },
    });

    // Kalau tagihan DP & sudah lunas penuh, tandai depositPaidAt
    if (lunas && bill.type === 'DEPOSIT' && bill.tenantId) {
      await prisma.tenant.update({
        where: { id: bill.tenantId },
        data: { depositPaidAt: new Date() },
      }).catch(() => {});
    }

    // Aktivasi penghuni PENDING kalau SEMUA tagihan wajib sudah lunas
    let activated = false;
    if (bill.tenant?.status === 'PENDING') {
      const outstanding = await prisma.bill.count({
        where: { tenantId: bill.tenantId, status: { in: ['UNPAID', 'OVERDUE', 'PENDING', 'PARTIAL'] } },
      });
      if (outstanding === 0) {
        await prisma.tenant.update({ where: { id: bill.tenantId }, data: { status: 'ACTIVE' } });
        await prisma.room.update({ where: { id: bill.roomId }, data: { status: 'OCCUPIED' } });
        activated = true;
      }
    }

    // Notifikasi WhatsApp (non-blocking)
    if (bill.tenant?.phone) {
      const metodeStr = method === 'CASH' ? 'Tunai (Cash)' : 'Transfer';
      const lines = [
        lunas ? `✅ *Pembayaran Lunas*` : `💰 *Pembayaran Sebagian Diterima*`,
        ``,
        `Halo ${bill.tenant.name},`,
        `Pembayaran kamu sudah kami catat:`,
        ``,
        `• Kamar: ${bill.room.number}`,
        `• Dibayar sekarang: Rp ${addAmount.toLocaleString('id-ID')} (${metodeStr})`,
        `• Total dibayar: Rp ${newPaid.toLocaleString('id-ID')} dari Rp ${bill.amount.toLocaleString('id-ID')}`,
      ];
      if (!lunas) {
        lines.push(`• *Sisa kurang bayar: Rp ${remaining.toLocaleString('id-ID')}*`);
      }
      if (activated) {
        lines.push(``, `Semua pembayaran sudah lunas! Silakan datang ke ${bill.room.property?.name || 'kos'} untuk serah terima kunci. 🔑`);
      }
      lines.push(``, `Terima kasih! 🙏`);
      sendWhatsApp(bill.tenant.phone, lines.join('\n'));
    }

    res.json({ ...bill, activated, remaining, paidNow: addAmount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;