const express = require('express');
const prisma = require('../utils/prisma');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

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
      },
      orderBy: { name: 'asc' },
    });
    res.json(tenants);
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
    res.json(tenant);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tenants
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, phone, email, ktpNumber, occupation, emergency, moveInDate, roomId } = req.body;

    // Set room to OCCUPIED
    await prisma.room.update({
      where: { id: roomId },
      data: { status: 'OCCUPIED' },
    });

    const tenant = await prisma.tenant.create({
      data: {
        name, phone, email, ktpNumber, occupation, emergency,
        moveInDate: new Date(moveInDate),
        roomId,
      },
    });
    res.status(201).json(tenant);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/tenants/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { name, phone, email, ktpNumber, occupation, emergency, status, moveInDate, moveOutDate, roomId } = req.body;

    const data = { name, phone, email, ktpNumber, occupation, emergency };
    if (status) data.status = status;
    if (moveInDate) data.moveInDate = new Date(moveInDate);
    if (moveOutDate) data.moveOutDate = new Date(moveOutDate);

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

module.exports = router;