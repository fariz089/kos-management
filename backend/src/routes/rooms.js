const express = require('express');
const prisma = require('../utils/prisma');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/rooms — List all rooms (with filters)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status, propertyId, type } = req.query;
    const where = {};
    if (status) where.status = status;
    if (propertyId) where.propertyId = propertyId;
    if (type) where.type = type;

    // Only show rooms from properties owned by this user
    where.property = { ownerId: req.user.id };

    const rooms = await prisma.room.findMany({
      where,
      include: {
        property: { select: { name: true } },
        tenants: {
          where: { status: 'ACTIVE' },
          select: { id: true, name: true, phone: true },
        },
      },
      orderBy: [{ property: { name: 'asc' } }, { number: 'asc' }],
    });

    res.json(rooms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/rooms/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const room = await prisma.room.findUnique({
      where: { id: req.params.id },
      include: {
        property: true,
        tenants: { where: { status: 'ACTIVE' } },
        bills: { orderBy: { dueDate: 'desc' }, take: 12 },
      },
    });
    if (!room) return res.status(404).json({ error: 'Kamar tidak ditemukan' });
    res.json(room);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/rooms
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { number, floor, type, price, description } = req.body;
    let { propertyId } = req.body;

    // Auto-assign property if not provided
    if (!propertyId) {
      const property = await prisma.property.findFirst({
        where: { ownerId: req.user.id },
      });
      if (!property) return res.status(400).json({ error: 'Belum ada properti. Buat properti terlebih dahulu.' });
      propertyId = property.id;
    }

    // Verify ownership
    const property = await prisma.property.findFirst({
      where: { id: propertyId, ownerId: req.user.id },
    });
    if (!property) return res.status(403).json({ error: 'Bukan properti Anda' });

    const room = await prisma.room.create({
      data: { number, floor, type, price, description, propertyId },
    });
    res.status(201).json(room);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/rooms/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { number, floor, type, price, status, description } = req.body;
    const room = await prisma.room.update({
      where: { id: req.params.id },
      data: { number, floor, type, price, status, description },
    });
    res.json(room);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/rooms/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await prisma.room.delete({ where: { id: req.params.id } });
    res.json({ message: 'Kamar dihapus' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
