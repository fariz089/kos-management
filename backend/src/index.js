require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const tenantRoutes = require('./routes/tenants');
const billRoutes = require('./routes/bills');
const paymentRoutes = require('./routes/payments');
const dashboardRoutes = require('./routes/dashboard');
const hermesRoutes = require('./routes/hermes');
const pricingRoutes = require('./routes/pricing');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// Trust proxy (behind nginx/cloudflare) — required for express-rate-limit
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/payments/notification',
});
app.use('/api/', limiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/hermes', hermesRoutes); // API for Hermes Agent tools
app.use('/api/pricing', pricingRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Status endpoint (used by frontend /bot page)
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error',
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    },
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏠 Kos Management API running on port ${PORT}`);

  // ─── Notification Scheduler ────────────────────────────────────────
  const prisma = require('./utils/prisma');
  const NOTIFY_HOUR = 12; // Jam 12 siang WIB (UTC+7 = 05:00 UTC)
  let lastRunDate = ''; // Track to run once per day

  async function sendWA(phone, message) {
    try {
      let p = phone.replace(/\D/g, '');
      if (p.startsWith('0')) p = '62' + p.slice(1);
      if (!p.startsWith('62')) p = '62' + p;

      const bridgeUrl = process.env.HERMES_WA_BRIDGE_URL || 'http://hermes:3000';
      const response = await fetch(`${bridgeUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: `${p}@s.whatsapp.net`, message }),
      });

      if (response.ok) {
        console.log(`📱 WA sent to ${p}`);
        return true;
      }
      const err = await response.text();
      console.warn(`⚠️ WA failed ${p}: ${err}`);
      return false;
    } catch (e) {
      console.error('WA error:', e.message);
      return false;
    }
  }

  // Small delay between messages to avoid rate limiting
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  async function runDailyNotifications() {
    const now = new Date();
    // Convert to WIB (UTC+7)
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const todayStr = wib.toISOString().split('T')[0];
    const currentHour = wib.getHours();

    // Only run once per day at NOTIFY_HOUR
    if (todayStr === lastRunDate) return;
    if (currentHour < NOTIFY_HOUR) return;

    lastRunDate = todayStr;
    console.log(`\n🔔 Running daily notifications for ${todayStr} at ${currentHour}:00 WIB\n`);

    try {
      const today = new Date(wib.getFullYear(), wib.getMonth(), wib.getDate());
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
      const in3days = new Date(today); in3days.setDate(in3days.getDate() + 3);
      const in4days = new Date(today); in4days.setDate(in4days.getDate() + 4);

      let sentCount = 0;

      // ──────────────────────────────────────────────────────────────
      // 1. PENGINGAT BAYAR H-3 (3 hari sebelum jatuh tempo)
      // ──────────────────────────────────────────────────────────────
      const billsH3 = await prisma.bill.findMany({
        where: {
          status: { in: ['UNPAID', 'PENDING'] },
          dueDate: { gte: in3days, lt: in4days },
        },
        include: { tenant: true, room: true },
      });

      for (const bill of billsH3) {
        if (!bill.tenant?.phone) continue;
        const amt = `Rp ${bill.amount.toLocaleString('id-ID')}`;
        const due = bill.dueDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
        await sendWA(bill.tenant.phone, [
          `⏰ *Pengingat Pembayaran*`,
          ``,
          `Halo ${bill.tenant.name},`,
          `Tagihan kamu akan jatuh tempo *3 hari lagi*:`,
          ``,
          `• Tipe: ${bill.type === 'RENT' ? 'Sewa Kamar' : bill.type}`,
          `• Kamar: ${bill.room.number}`,
          `• Jumlah: ${amt}`,
          `• Jatuh tempo: ${due}`,
          ``,
          `Segera lakukan pembayaran ya! Hubungi kami kalau butuh bantuan. 🙏`,
        ].join('\n'));
        sentCount++;
        await delay(2000);
      }

      // ──────────────────────────────────────────────────────────────
      // 2. PENGINGAT BAYAR H-1 (1 hari sebelum jatuh tempo)
      // ──────────────────────────────────────────────────────────────
      const billsH1 = await prisma.bill.findMany({
        where: {
          status: { in: ['UNPAID', 'PENDING'] },
          dueDate: { gte: tomorrow, lt: new Date(tomorrow.getTime() + 86400000) },
        },
        include: { tenant: true, room: true },
      });

      for (const bill of billsH1) {
        if (!bill.tenant?.phone) continue;
        const amt = `Rp ${bill.amount.toLocaleString('id-ID')}`;
        await sendWA(bill.tenant.phone, [
          `🔔 *Pengingat: Tagihan Jatuh Tempo Besok!*`,
          ``,
          `Halo ${bill.tenant.name},`,
          `Tagihan kamu jatuh tempo *besok*:`,
          ``,
          `• Tipe: ${bill.type === 'RENT' ? 'Sewa Kamar' : bill.type}`,
          `• Kamar: ${bill.room.number}`,
          `• Jumlah: ${amt}`,
          ``,
          `Mohon segera bayar agar tidak terkena denda. Terima kasih! 🙏`,
        ].join('\n'));
        sentCount++;
        await delay(2000);
      }

      // ──────────────────────────────────────────────────────────────
      // 3. TAGIHAN OVERDUE (lewat jatuh tempo)
      // ──────────────────────────────────────────────────────────────
      // First, update status to OVERDUE
      await prisma.bill.updateMany({
        where: { status: 'UNPAID', dueDate: { lt: today } },
        data: { status: 'OVERDUE' },
      });

      // Then notify
      const overdueBills = await prisma.bill.findMany({
        where: { status: 'OVERDUE' },
        include: { tenant: true, room: true },
      });

      for (const bill of overdueBills) {
        if (!bill.tenant?.phone) continue;
        const amt = `Rp ${bill.amount.toLocaleString('id-ID')}`;
        const due = bill.dueDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
        const daysLate = Math.floor((today - bill.dueDate) / 86400000);
        await sendWA(bill.tenant.phone, [
          `🚨 *Tagihan Lewat Jatuh Tempo!*`,
          ``,
          `Halo ${bill.tenant.name},`,
          `Tagihan kamu sudah *lewat ${daysLate} hari* dari jatuh tempo:`,
          ``,
          `• Tipe: ${bill.type === 'RENT' ? 'Sewa Kamar' : bill.type}`,
          `• Kamar: ${bill.room.number}`,
          `• Jumlah: ${amt}`,
          `• Jatuh tempo: ${due}`,
          ``,
          `Mohon segera selesaikan pembayaran. Hubungi kami jika ada kendala. 🙏`,
        ].join('\n'));
        sentCount++;
        await delay(2000);
      }

      // ──────────────────────────────────────────────────────────────
      // 4. PENGINGAT CHECK-IN HARI INI
      // ──────────────────────────────────────────────────────────────
      const checkInToday = await prisma.tenant.findMany({
        where: {
          status: { in: ['PENDING', 'ACTIVE'] },
          moveInDate: { gte: today, lt: tomorrow },
        },
        include: { room: { include: { property: true } } },
      });

      for (const tenant of checkInToday) {
        await sendWA(tenant.phone, [
          `🏠 *Selamat Datang! Check-in Hari Ini*`,
          ``,
          `Halo ${tenant.name},`,
          `Jadwal check-in kamu di *${tenant.room.property?.name || 'Andhata Boarding House'}* adalah *hari ini*! 🎉`,
          ``,
          `📍 Kamar: ${tenant.room.number}`,
          `📍 Alamat: ${tenant.room.property?.address || '-'}`,
          ``,
          `Pastikan tagihan sudah dibayar, lalu datang untuk serah terima kunci. 🔑`,
          `Selamat datang di rumah baru kamu! 😊`,
        ].join('\n'));
        sentCount++;
        await delay(2000);
      }

      // ──────────────────────────────────────────────────────────────
      // 4b. PENGINGAT MAU KELUAR KOS (H-3 sebelum tanggal keluar)
      // ──────────────────────────────────────────────────────────────
      const moveOutSoon = await prisma.tenant.findMany({
        where: {
          status: 'ACTIVE',
          moveOutDate: { gte: in3days, lt: in4days },
        },
        include: { room: { include: { property: true } } },
      });

      for (const tenant of moveOutSoon) {
        const outDate = tenant.moveOutDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
        await sendWA(tenant.phone, [
          `📦 *Pengingat: Jadwal Keluar Kos*`,
          ``,
          `Halo ${tenant.name},`,
          `Sesuai data kami, jadwal kamu keluar dari kamar *${tenant.room.number}* adalah *${outDate}* (3 hari lagi).`,
          ``,
          `Mohon pastikan:`,
          `• Semua tagihan sudah lunas`,
          `• Kamar dirapikan & kunci dikembalikan`,
          ``,
          `Kalau ada perubahan rencana, kabari kami ya. Terima kasih sudah tinggal di ${tenant.room.property?.name || 'kos'}! 🙏`,
        ].join('\n'));
        sentCount++;
        await delay(2000);
      }
      if (today.getDate() === 1) {
        const month = today.getMonth() + 1;
        const year = today.getFullYear();
        const dueDate = new Date(year, month - 1, 10); // Due tanggal 10

        const activeTenants = await prisma.tenant.findMany({
          where: { status: { in: ['ACTIVE', 'PENDING'] } },
          include: { room: true },
        });

        const { priceForRoom } = require('./utils/pricing');

        let generated = 0;
        for (const tenant of activeTenants) {
          // Skip if bill already exists
          const existing = await prisma.bill.findFirst({
            where: {
              tenantId: tenant.id,
              type: 'RENT',
              dueDate: { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) },
            },
          });
          if (existing) continue;

          // Harga dinamis berdasarkan tanggal masuk penghuni
          let rentAmount = tenant.room.price;
          try {
            const p = await priceForRoom(tenant.roomId, tenant.moveInDate);
            rentAmount = p.price;
          } catch (e) { /* fallback ke room.price */ }

          await prisma.bill.create({
            data: {
              type: 'RENT',
              amount: rentAmount,
              dueDate,
              description: `Sewa kamar ${tenant.room.number} — ${month}/${year}`,
              tenantId: tenant.id,
              roomId: tenant.roomId,
            },
          });
          generated++;

          // Notify tenant about new bill
          const amt = `Rp ${rentAmount.toLocaleString('id-ID')}`;
          const dueDateStr = dueDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
          await sendWA(tenant.phone, [
            `📋 *Tagihan Baru Bulan ${month}/${year}*`,
            ``,
            `Halo ${tenant.name},`,
            `Tagihan sewa kamar bulan ini sudah diterbitkan:`,
            ``,
            `• Kamar: ${tenant.room.number}`,
            `• Jumlah: ${amt}`,
            `• Jatuh tempo: ${dueDateStr}`,
            ``,
            `Silakan lakukan pembayaran sebelum jatuh tempo. Ketik "bayar" untuk mendapatkan link pembayaran. 💳`,
          ].join('\n'));
          sentCount++;
          await delay(2000);
        }

        if (generated > 0) {
          console.log(`📋 Auto-generated ${generated} monthly bills for ${month}/${year}`);
        }
      }

      console.log(`🔔 Daily notifications done: ${sentCount} messages sent\n`);
    } catch (error) {
      console.error('Scheduler error:', error.message);
    }
  }

  // Check every 5 minutes if it's time to run
  setInterval(runDailyNotifications, 5 * 60 * 1000);
  // Also run on startup (after 15 seconds)
  setTimeout(runDailyNotifications, 15000);
});
