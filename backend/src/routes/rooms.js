const express = require('express');
const prisma = require('../utils/prisma');
const { authMiddleware } = require('../middleware/auth');
const { priceForRoom } = require('../utils/pricing');
const { tenantStage } = require('../utils/lifecycle');

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
        tier: { include: { rules: true } },
        tenants: {
          where: { status: { in: ['ACTIVE', 'PENDING'] } },
          select: { id: true, name: true, phone: true, moveInDate: true, status: true },
          orderBy: { moveInDate: 'desc' },
        },
      },
      orderBy: [{ property: { name: 'asc' } }, { number: 'asc' }],
    });

    // Hitung harga date-aware untuk tiap kamar
    const enriched = await Promise.all(rooms.map(async (r) => {
      // Harga aktif HARI INI (untuk kamar kosong)
      let currentPrice = r.price;
      let currentLabel = null;
      try {
        const today = await priceForRoom(r.id, new Date());
        currentPrice = today.price;
        currentLabel = today.label;
      } catch (e) { /* fallback */ }

      // Harga sesuai TANGGAL MASUK penghuni aktif (untuk kamar terisi)
      const occupant = r.tenants[0] || null;
      let tenantPrice = null;
      let tenantPriceLabel = null;
      if (occupant) {
        try {
          const p = await priceForRoom(r.id, occupant.moveInDate);
          tenantPrice = p.price;
          tenantPriceLabel = p.label;
        } catch (e) { /* fallback */ }
      }

      // Harga yang DITAMPILKAN: kalau terisi pakai harga penghuni, kalau kosong pakai harga hari ini
      const displayPrice = occupant && tenantPrice != null ? tenantPrice : currentPrice;
      const displayLabel = occupant && tenantPrice != null ? tenantPriceLabel : currentLabel;

      return {
        ...r,
        tier: r.tier ? { id: r.tier.id, name: r.tier.name, code: r.tier.code } : null,
        currentPrice,
        currentLabel,
        tenantPrice,
        tenantPriceLabel,
        displayPrice,
        displayLabel,
      };
    }));

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/rooms/occupancy?year=YYYY — data kalender hunian per kamar (semua penghuni)
router.get('/occupancy/calendar', authMiddleware, async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const rooms = await prisma.room.findMany({
      where: { property: { ownerId: req.user.id } },
      include: {
        tier: { select: { code: true, name: true } },
        tenants: {
          where: { status: { in: ['ACTIVE', 'PENDING', 'INACTIVE'] } },
          select: { id: true, name: true, phone: true, moveInDate: true, moveOutDate: true, status: true,
            bills: { select: { amount: true, paidAmount: true, status: true } } },
          orderBy: { moveInDate: 'asc' },
        },
      },
      orderBy: { number: 'asc' },
    });

    const data = rooms.map(r => ({
      id: r.id,
      number: r.number,
      floor: r.floor,
      type: r.type,
      tier: r.tier ? { code: r.tier.code, name: r.tier.name } : null,
      status: r.status,
      tenants: r.tenants.map(t => {
        const s = tenantStage(t);
        return {
          id: t.id,
          name: t.name,
          phone: t.phone,
          status: t.status,
          stage: s.stage,
          stageLabel: s.label,
          outstanding: s.outstanding,
          moveInDate: t.moveInDate,
          moveOutDate: t.moveOutDate,
        };
      }),
    }));

    res.json({ year, rooms: data });
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
