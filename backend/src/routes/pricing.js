const express = require('express');
const prisma = require('../utils/prisma');
const { authMiddleware } = require('../middleware/auth');
const { priceForRoom } = require('../utils/pricing');

const router = express.Router();

// GET /api/pricing/tiers — daftar tier + aturan harga
router.get('/tiers', authMiddleware, async (req, res) => {
  try {
    const tiers = await prisma.pricingTier.findMany({
      where: { property: { ownerId: req.user.id } },
      include: {
        rules: { orderBy: { startDate: 'asc' } },
        _count: { select: { rooms: true } },
      },
      orderBy: { code: 'asc' },
    });
    res.json(tiers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/pricing/preview?roomId=...&date=YYYY-MM-DD — harga aktif untuk kamar pada tanggal
router.get('/preview', authMiddleware, async (req, res) => {
  try {
    const { roomId, date } = req.query;
    if (!roomId) return res.status(400).json({ error: 'roomId wajib diisi' });
    const result = await priceForRoom(roomId, date || new Date());
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/pricing/rules/:id — ubah harga satu aturan (mis. ganti nominal promo)
router.put('/rules/:id', authMiddleware, async (req, res) => {
  try {
    const { price, startDate, endDate, label } = req.body;
    const data = {};
    if (price !== undefined) data.price = Number(price);
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
    if (label !== undefined) data.label = label;
    const rule = await prisma.pricingRule.update({ where: { id: req.params.id }, data });
    res.json(rule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/pricing/rules — tambah aturan harga baru ke sebuah tier
router.post('/rules', authMiddleware, async (req, res) => {
  try {
    const { tierId, price, startDate, endDate, label } = req.body;
    if (!tierId || price === undefined) return res.status(400).json({ error: 'tierId dan price wajib diisi' });
    const rule = await prisma.pricingRule.create({
      data: {
        tierId,
        price: Number(price),
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        label: label || null,
      },
    });
    res.status(201).json(rule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/pricing/rules/:id
router.delete('/rules/:id', authMiddleware, async (req, res) => {
  try {
    await prisma.pricingRule.delete({ where: { id: req.params.id } });
    res.json({ message: 'Aturan harga dihapus' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
