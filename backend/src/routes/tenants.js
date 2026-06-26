const express = require('express');
const prisma = require('../utils/prisma');
const { authMiddleware } = require('../middleware/auth');
const { priceForRoom } = require('../utils/pricing');

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
    const {
      name, phone, email, ktpNumber, occupation, emergency,
      moveInDate, moveOutDate, roomId,
      depositAmount,          // DP / uang muka (diisi manual saat booking)
      status,                 // opsional override; default tergantung ada DP/tidak
      createBills = true,     // buat tagihan otomatis (DP + sewa bln pertama)
      rentAmount,             // opsional override harga sewa; default = harga dinamis
    } = req.body;

    // Harga sewa dinamis berdasarkan tanggal masuk (boleh dioverride manual)
    let resolvedRent = Number(rentAmount) || 0;
    let priceInfo = null;
    if (!resolvedRent) {
      priceInfo = await priceForRoom(roomId, moveInDate || new Date());
      resolvedRent = priceInfo.price;
    }

    const dp = depositAmount ? Number(depositAmount) : null;

    // Kalau ada DP, penghuni mulai sebagai PENDING (harus lunasi dulu sebelum masuk)
    // & kamar jadi RESERVED. Tanpa DP, perilaku lama: langsung ACTIVE + OCCUPIED.
    const tenantStatus = status || (dp ? 'PENDING' : 'ACTIVE');
    const roomStatus = tenantStatus === 'PENDING' ? 'RESERVED' : 'OCCUPIED';

    await prisma.room.update({ where: { id: roomId }, data: { status: roomStatus } });

    const tenant = await prisma.tenant.create({
      data: {
        name, phone, email, ktpNumber, occupation, emergency,
        moveInDate: new Date(moveInDate),
        ...(moveOutDate ? { moveOutDate: new Date(moveOutDate) } : {}),
        ...(dp ? { depositAmount: dp } : {}),
        status: tenantStatus,
        roomId,
      },
      include: { room: { include: { property: true } } },
    });

    // ── Buat tagihan otomatis ──────────────────────────────
    const createdBills = [];
    if (createBills) {
      const moveIn = new Date(moveInDate);
      const dueDate = new Date(moveIn);
      dueDate.setDate(dueDate.getDate() + 3); // jatuh tempo 3 hari setelah tanggal masuk

      // 1) Tagihan DP (kalau ada) — harus dibayar sebelum masuk
      if (dp) {
        const dpBill = await prisma.bill.create({
          data: {
            type: 'DEPOSIT',
            amount: dp,
            dueDate,
            status: 'UNPAID',
            description: `DP / uang muka - Kamar ${tenant.room.number}`,
            tenantId: tenant.id,
            roomId,
          },
        });
        createdBills.push(dpBill);
      }

      // 2) Tagihan sewa bulan pertama
      const rentBill = await prisma.bill.create({
        data: {
          type: 'RENT',
          amount: resolvedRent,
          dueDate,
          status: 'UNPAID',
          description: `Sewa bulan pertama - Kamar ${tenant.room.number}`,
          tenantId: tenant.id,
          roomId,
        },
      });
      createdBills.push(rentBill);
    }

    // ── Kirim WhatsApp pemberitahuan (non-blocking) ────────
    if (tenant.phone) {
      const moveInStr = new Date(moveInDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      const lines = [
        `🏠 *Booking Diterima — ${tenant.room.property?.name || 'Andhata Boarding House'}*`,
        ``,
        `Halo ${tenant.name},`,
        `Kamar *${tenant.room.number}* sudah kami reservasi untuk kamu. 🎉`,
        ``,
        `📋 *Rincian:*`,
        `• Kamar: ${tenant.room.number}`,
        `• Tanggal masuk: ${moveInStr}`,
        `• Sewa bulan pertama: Rp ${resolvedRent.toLocaleString('id-ID')}`,
      ];
      if (dp) {
        lines.push(`• DP / uang muka: Rp ${dp.toLocaleString('id-ID')}`);
        lines.push(``);
        lines.push(`⚠️ *Mohon lunasi DP + sewa terlebih dahulu sebelum tanggal masuk* agar kamar bisa kamu tempati.`);
      } else {
        lines.push(``);
        lines.push(`Mohon lakukan pembayaran sewa sesuai tagihan ya.`);
      }
      lines.push(`Ketik *"bayar"* untuk mendapatkan link pembayaran, atau bayar langsung (cash/transfer) ke pemilik kos.`);
      lines.push(`Terima kasih! 🙏`);
      sendWhatsApp(tenant.phone, lines.join('\n'));
    }

    res.status(201).json({ ...tenant, bills: createdBills, priceInfo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/tenants/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { name, phone, email, ktpNumber, occupation, emergency, status, moveInDate, moveOutDate, roomId, depositAmount } = req.body;

    const data = { name, phone, email, ktpNumber, occupation, emergency };
    if (status) data.status = status;
    if (moveInDate) data.moveInDate = new Date(moveInDate);
    // moveOutDate: kirim tanggal untuk set, kirim null/"" untuk kosongkan
    if (moveOutDate !== undefined) data.moveOutDate = moveOutDate ? new Date(moveOutDate) : null;
    if (depositAmount !== undefined) data.depositAmount = depositAmount ? Number(depositAmount) : null;

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