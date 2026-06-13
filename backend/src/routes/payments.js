const express = require('express');
const midtransClient = require('midtrans-client');
const prisma = require('../utils/prisma');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

const core = new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// ─── Helpers ─────────────────────────────────────────────────────────

async function activateTenantIfPending(bill) {
  try {
    if (!bill.tenant || bill.tenant.status !== 'PENDING') return;
    await prisma.tenant.update({ where: { id: bill.tenant.id }, data: { status: 'ACTIVE' } });
    await prisma.room.update({ where: { id: bill.roomId }, data: { status: 'OCCUPIED' } });
    console.log(`✅ Tenant ${bill.tenant.name} activated, room ${bill.room.number} OCCUPIED`);
  } catch (error) {
    console.error('Tenant activation error:', error.message);
  }
}

/**
 * Send WhatsApp via Hermes WhatsApp Bridge (port 3000)
 * Endpoint: POST http://hermes:3000/send
 * Body: { chatId: "number@s.whatsapp.net", message: "text" }
 */
async function sendWhatsApp(phone, message) {
  try {
    let p = phone.replace(/\D/g, '');
    if (p.startsWith('0')) p = '62' + p.slice(1);
    if (!p.startsWith('62')) p = '62' + p;

    const bridgeUrl = process.env.HERMES_WA_BRIDGE_URL || 'http://hermes:3000';
    const chatId = `${p}@s.whatsapp.net`;

    const response = await fetch(`${bridgeUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`✅ WhatsApp sent to ${p}:`, result.messageId || result.success);
      return true;
    } else {
      const errText = await response.text();
      console.warn(`⚠️ WhatsApp bridge error for ${p}: ${response.status} ${errText}`);
      return false;
    }
  } catch (error) {
    console.error('WhatsApp send error (non-blocking):', error.message);
    return false;
  }
}

async function processSuccessfulPayment(payment, paymentType) {
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'SUCCESS', method: paymentType || payment.method, paidAt: new Date() },
  });

  const bill = await prisma.bill.update({
    where: { id: payment.billId },
    data: { status: 'PAID', paidAt: new Date() },
    include: { tenant: true, room: { include: { property: true } } },
  });

  await activateTenantIfPending(bill);

  // Send WhatsApp to the tenant registered in the system (not necessarily the payer)
  if (bill.tenant?.phone) {
    const amt = `Rp ${payment.amount.toLocaleString('id-ID')}`;
    const msg = [
      `✅ *Pembayaran Berhasil!*`,
      ``,
      `Halo ${bill.tenant.name},`,
      `Pembayaran kamu sudah kami terima:`,
      ``,
      `📋 *Detail:*`,
      `• Tagihan: ${bill.type === 'RENT' ? 'Sewa Kamar' : bill.type}`,
      `• Kamar: ${bill.room.number}`,
      `• Jumlah: ${amt}`,
      `• Metode: ${paymentType || '-'}`,
      ``,
      `Silakan datang ke ${bill.room.property?.name || 'kos'} untuk serah terima kunci. 🔑`,
      `Terima kasih! 🙏`,
    ].join('\n');

    // Fire and forget — don't block payment flow
    sendWhatsApp(bill.tenant.phone, msg);
  }

  return bill;
}

// ─── Routes ──────────────────────────────────────────────────────────

// POST /api/payments/create
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { billId } = req.body;
    const bill = await prisma.bill.findUnique({
      where: { id: billId },
      include: { tenant: true, room: { include: { property: true } }, payment: true },
    });

    if (!bill) return res.status(404).json({ error: 'Tagihan tidak ditemukan' });
    if (bill.status === 'PAID') return res.status(400).json({ error: 'Tagihan sudah dibayar' });

    if (bill.payment) {
      if (bill.payment.status === 'SUCCESS') {
        return res.json({ alreadyPaid: true, message: 'Tagihan sudah terbayar!' });
      }
      try {
        const s = await core.transaction.status(bill.payment.orderId);
        if (s.transaction_status === 'settlement' || s.transaction_status === 'capture') {
          await processSuccessfulPayment(bill.payment, s.payment_type);
          return res.json({ alreadyPaid: true, message: 'Tagihan sudah terbayar!' });
        }
        if (s.transaction_status === 'pending') {
          return res.json({ token: bill.payment.snapToken, redirectUrl: bill.payment.snapUrl, orderId: bill.payment.orderId });
        }
      } catch (e) { /* not found at midtrans */ }
      await prisma.payment.delete({ where: { id: bill.payment.id } });
    }

    const orderId = `KOS-${bill.id}-${Date.now()}`;
    const transaction = await snap.createTransaction({
      transaction_details: { order_id: orderId, gross_amount: bill.amount },
      item_details: [{ id: bill.id, price: bill.amount, quantity: 1, name: `${bill.type} - Kamar ${bill.room.number}` }],
      customer_details: { first_name: bill.tenant.name, phone: bill.tenant.phone, email: bill.tenant.email || undefined },
      callbacks: { finish: `${process.env.BASE_URL}/payment/finish` },
    });

    await prisma.payment.create({
      data: { orderId, amount: bill.amount, snapToken: transaction.token, snapUrl: transaction.redirect_url, billId: bill.id },
    });
    await prisma.bill.update({ where: { id: billId }, data: { status: 'PENDING' } });

    res.json({ token: transaction.token, redirectUrl: transaction.redirect_url, orderId });
  } catch (error) {
    console.error('Payment create error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/payments/notification — Midtrans webhook
router.post('/notification', async (req, res) => {
  try {
    const notification = req.body;
    if (!notification?.order_id || !notification?.transaction_status) {
      return res.status(400).json({ error: 'Invalid notification' });
    }
    const statusResponse = await snap.transaction.notification(notification);
    const { order_id, transaction_status, fraud_status, payment_type, transaction_id } = statusResponse;
    const payment = await prisma.payment.findUnique({ where: { orderId: order_id } });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    if ((transaction_status === 'capture' || transaction_status === 'settlement') && (fraud_status === 'accept' || !fraud_status)) {
      await prisma.payment.update({ where: { id: payment.id }, data: { midtransId: transaction_id, rawNotification: notification } });
      await processSuccessfulPayment(payment, payment_type);
    } else if (['deny', 'cancel', 'expire'].includes(transaction_status)) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: transaction_status === 'expire' ? 'EXPIRED' : 'FAILED', rawNotification: notification } });
      await prisma.bill.update({ where: { id: payment.billId }, data: { status: 'UNPAID' } });
    }
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/payments/check-status — Manual sync
router.post('/check-status', authMiddleware, async (req, res) => {
  try {
    const { billId } = req.body;
    const payment = await prisma.payment.findFirst({ where: { billId }, orderBy: { createdAt: 'desc' } });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status === 'SUCCESS') return res.json({ status: 'SUCCESS', message: 'Sudah terbayar' });

    try {
      const s = await core.transaction.status(payment.orderId);
      if ((s.transaction_status === 'settlement' || s.transaction_status === 'capture') && (s.fraud_status === 'accept' || !s.fraud_status)) {
        await prisma.payment.update({ where: { id: payment.id }, data: { midtransId: s.transaction_id } });
        await processSuccessfulPayment(payment, s.payment_type);
        return res.json({ status: 'SUCCESS', message: 'Pembayaran dikonfirmasi!' });
      }
      if (s.transaction_status === 'pending') {
        return res.json({ status: 'PENDING', redirectUrl: payment.snapUrl, message: 'Masih menunggu pembayaran' });
      }
      if (s.transaction_status === 'expire') {
        await prisma.payment.delete({ where: { id: payment.id } });
        await prisma.bill.update({ where: { id: payment.billId }, data: { status: 'UNPAID' } });
        return res.json({ status: 'EXPIRED', message: 'Link expired, silakan buat link baru' });
      }
      return res.json({ status: s.transaction_status });
    } catch (e) {
      await prisma.payment.delete({ where: { id: payment.id } });
      await prisma.bill.update({ where: { id: payment.billId }, data: { status: 'UNPAID' } });
      return res.json({ status: 'RESET', message: 'Link lama tidak valid, silakan buat link pembayaran baru' });
    }
  } catch (error) {
    console.error('Check status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/payments/sync-by-order — Auto-sync from PaymentFinish page
router.post('/sync-by-order', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId required' });
    const payment = await prisma.payment.findUnique({ where: { orderId } });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status === 'SUCCESS') return res.json({ status: 'SUCCESS' });

    try {
      const s = await core.transaction.status(orderId);
      if ((s.transaction_status === 'settlement' || s.transaction_status === 'capture') && (s.fraud_status === 'accept' || !s.fraud_status)) {
        await prisma.payment.update({ where: { id: payment.id }, data: { midtransId: s.transaction_id } });
        await processSuccessfulPayment(payment, s.payment_type);
        return res.json({ status: 'SUCCESS' });
      }
      return res.json({ status: s.transaction_status });
    } catch (e) {
      return res.json({ status: 'unknown' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/payments/:billId/status
router.get('/:billId/status', authMiddleware, async (req, res) => {
  try {
    const payment = await prisma.payment.findFirst({ where: { billId: req.params.billId }, orderBy: { createdAt: 'desc' } });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json(payment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
