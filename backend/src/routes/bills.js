const express = require('express');
const prisma = require('../utils/prisma');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

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
        const bill = await prisma.bill.create({
          data: {
            type: 'RENT',
            amount: tenant.room.price,
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

module.exports = router;