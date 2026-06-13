const express = require('express');
const prisma = require('../utils/prisma');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard — flat summary for frontend
router.get('/', authMiddleware, async (req, res) => {
  try {
    const ownerId = req.user.id;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalRooms,
      occupiedRooms,
      availableRooms,
      activeTenants,
      unpaidBills,
      paidThisMonthCount,
      revenueAgg,
      overdueBills,
    ] = await Promise.all([
      prisma.room.count({ where: { property: { ownerId } } }),
      prisma.room.count({ where: { property: { ownerId }, status: 'OCCUPIED' } }),
      prisma.room.count({ where: { property: { ownerId }, status: 'AVAILABLE' } }),
      prisma.tenant.count({ where: { status: 'ACTIVE', room: { property: { ownerId } } } }),
      prisma.bill.count({
        where: { status: { in: ['UNPAID', 'OVERDUE'] }, room: { property: { ownerId } } },
      }),
      prisma.bill.count({
        where: {
          status: 'PAID',
          paidAt: { gte: monthStart },
          room: { property: { ownerId } },
        },
      }),
      prisma.bill.aggregate({
        _sum: { amount: true },
        where: {
          status: 'PAID',
          paidAt: { gte: monthStart },
          room: { property: { ownerId } },
        },
      }),
      prisma.bill.findMany({
        where: {
          status: { in: ['UNPAID', 'OVERDUE'] },
          dueDate: { lt: now },
          room: { property: { ownerId } },
        },
        include: {
          tenant: { select: { name: true, phone: true, room: { select: { number: true } } } },
        },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
    ]);

    res.json({
      totalRooms,
      occupiedRooms,
      availableRooms,
      activeTenants,
      unpaidBills,
      paidThisMonth: revenueAgg._sum.amount || 0,
      totalBillingThisMonth: revenueAgg._sum.amount || 0,
      occupancyRate: totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0,
      overdueBills,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
