const express = require('express');
const prisma = require('../utils/prisma');
const { authMiddleware } = require('../middleware/auth');
const { priceForRoom } = require('../utils/pricing');

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
    res.json(bills);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/bills — Create bill(s)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { tenantId, roomId, type, amount, dueDate, description } = req.body;

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
    const dueDate = new Date(year, month - 1, 10); // Due tanggal 10

    const activeTenants = await prisma.tenant.findMany({
      where: {
        status: { in: ['ACTIVE', 'PENDING'] },
        room: { property: { ownerId: req.user.id } },
      },
      include: { room: true },
    });

    const bills = [];
    for (const tenant of activeTenants) {
      // Check if bill already exists for this month
      const existing = await prisma.bill.findFirst({
        where: {
          tenantId: tenant.id,
          type: 'RENT',
          dueDate: {
            gte: new Date(year, month - 1, 1),
            lte: new Date(year, month, 0, 23, 59, 59),
          },
        },
      });

      if (!existing) {
        // Harga dinamis berdasarkan tanggal masuk penghuni
        let rentAmount = tenant.room.price;
        try {
          const p = await priceForRoom(tenant.roomId, tenant.moveInDate);
          rentAmount = p.price;
        } catch (e) { /* fallback ke room.price */ }

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
    }

    res.json({ generated: bills.length, bills });
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

module.exports = router;