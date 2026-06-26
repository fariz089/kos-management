const express = require('express');
const midtransClient = require('midtrans-client');
const prisma = require('../utils/prisma');
const { hermesAuth } = require('../middleware/auth');
const { priceForRoom } = require('../utils/pricing');

const router = express.Router();

// Midtrans Snap client (same config as payments.js)
const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// All routes require Hermes API key
router.use(hermesAuth);

// ============================================
// TOOL: cek_kamar_kosong
// ============================================
router.get('/available-rooms', async (req, res) => {
  try {
    const rooms = await prisma.room.findMany({
      where: { status: 'AVAILABLE' },
      include: {
        property: { select: { name: true, address: true } },
        tier: { include: { rules: true } },
      },
      orderBy: { price: 'asc' },
    });

    const formatted = await Promise.all(rooms.map(async r => {
      let livePrice = r.price;
      let priceLabel = null;
      try {
        const p = await priceForRoom(r.id, new Date());
        livePrice = p.price;
        priceLabel = p.label;
      } catch (e) { /* fallback */ }
      return {
        id: r.id,
        nomor: r.number,
        lantai: r.floor,
        tipe: r.tier?.name || r.type,
        harga: `Rp ${livePrice.toLocaleString('id-ID')}/bulan${priceLabel ? ` (${priceLabel})` : ''}`,
        hargaAngka: livePrice,
        properti: r.property.name,
        alamat: r.property.address,
        deskripsi: r.description || '-',
      };
    }));

    res.json({
      tersedia: formatted.length,
      kamar: formatted,
      pesan: formatted.length > 0
        ? `Ada ${formatted.length} kamar tersedia`
        : 'Maaf, saat ini semua kamar terisi. Mau kami hubungi kalau ada yang kosong?',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TOOL: cek_tagihan
// ============================================
router.get('/tenant-bills/:phone', async (req, res) => {
  try {
    const phone = req.params.phone.replace(/\D/g, '');

    const tenant = await prisma.tenant.findFirst({
      where: {
        phone: { contains: phone.slice(-10) },
        status: { in: ['ACTIVE', 'PENDING'] },
      },
      include: {
        room: { select: { number: true, price: true } },
        bills: {
          include: { payment: { select: { snapUrl: true, status: true, paidAt: true, method: true } } },
          orderBy: { dueDate: 'desc' },
          take: 10,
        },
      },
    });

    if (!tenant) {
      return res.json({
        found: false,
        pesan: 'Maaf, nomor WhatsApp ini belum terdaftar sebagai penghuni. Hubungi pemilik kos untuk info lebih lanjut.',
      });
    }

    const unpaidBills = tenant.bills.filter(b => ['UNPAID', 'PENDING', 'OVERDUE'].includes(b.status));
    const paidBills = tenant.bills.filter(b => b.status === 'PAID');
    const totalUnpaid = unpaidBills.reduce((sum, b) => sum + b.amount, 0);

    res.json({
      found: true,
      penghuni: tenant.name,
      kamar: tenant.room.number,
      statusPenghuni: tenant.status,
      tagihanBelumBayar: unpaidBills.map(b => ({
        id: b.id,
        tipe: b.type,
        jumlah: `Rp ${b.amount.toLocaleString('id-ID')}`,
        jatuhTempo: b.dueDate.toISOString().split('T')[0],
        status: b.status,
        linkBayar: b.payment?.snapUrl || null,
        statusPembayaran: b.payment?.status || 'BELUM_BAYAR',
      })),
      tagihanSudahBayar: paidBills.map(b => ({
        id: b.id,
        tipe: b.type,
        jumlah: `Rp ${b.amount.toLocaleString('id-ID')}`,
        tanggalBayar: b.paidAt?.toISOString().split('T')[0] || '-',
        metode: b.payment?.method || '-',
      })),
      totalBelumBayar: `Rp ${totalUnpaid.toLocaleString('id-ID')}`,
      totalSudahBayar: `Rp ${paidBills.reduce((s, b) => s + b.amount, 0).toLocaleString('id-ID')}`,
      ringkasan: unpaidBills.length === 0
        ? `Semua tagihan ${tenant.name} sudah LUNAS! ✅`
        : `Ada ${unpaidBills.length} tagihan belum bayar (total ${totalUnpaid.toLocaleString('id-ID')})`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TOOL: buat_link_bayar
// Benar-benar call Midtrans Snap
// ============================================
router.post('/create-payment-link', async (req, res) => {
  try {
    const { billId } = req.body;

    const bill = await prisma.bill.findUnique({
      where: { id: billId },
      include: {
        tenant: true,
        room: { include: { property: true } },
        payment: true,
      },
    });

    if (!bill) return res.status(404).json({ error: 'Tagihan tidak ditemukan' });
    if (bill.status === 'PAID') {
      return res.json({ pesan: 'Tagihan ini sudah dibayar. Terima kasih!' });
    }

    // Kalau sudah ada snap URL yang masih PENDING, return langsung
    if (bill.payment?.snapUrl && bill.payment.status === 'PENDING') {
      return res.json({
        pesan: 'Silakan bayar melalui link ini:',
        linkBayar: bill.payment.snapUrl,
        jumlah: `Rp ${bill.amount.toLocaleString('id-ID')}`,
      });
    }

    // Buat transaksi baru ke Midtrans
    const orderId = `KOS-${bill.id}-${Date.now()}`;

    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: bill.amount,
      },
      item_details: [{
        id: bill.id,
        price: bill.amount,
        quantity: 1,
        name: `${bill.type} - Kamar ${bill.room.number}`,
      }],
      customer_details: {
        first_name: bill.tenant.name,
        phone: bill.tenant.phone,
        ...(bill.tenant.email && { email: bill.tenant.email }),
      },
      callbacks: {
        finish: `${process.env.BASE_URL}/payment/finish`,
      },
    };

    const transaction = await snap.createTransaction(parameter);

    // Hapus payment lama kalau ada (EXPIRED/FAILED)
    if (bill.payment) {
      await prisma.payment.delete({ where: { id: bill.payment.id } });
    }

    // Simpan payment baru
    await prisma.payment.create({
      data: {
        orderId,
        amount: bill.amount,
        snapToken: transaction.token,
        snapUrl: transaction.redirect_url,
        billId: bill.id,
      },
    });

    // Update bill jadi PENDING
    await prisma.bill.update({
      where: { id: billId },
      data: { status: 'PENDING' },
    });

    res.json({
      pesan: 'Link pembayaran berhasil dibuat! Silakan bayar melalui link berikut:',
      linkBayar: transaction.redirect_url,
      jumlah: `Rp ${bill.amount.toLocaleString('id-ID')}`,
      orderId,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TOOL: reset_link_bayar
// Hapus payment record lama agar buat_link_bayar bisa generate baru
// ============================================
router.post('/reset-payment-link', async (req, res) => {
  try {
    const { billId } = req.body;

    const bill = await prisma.bill.findUnique({
      where: { id: billId },
      include: { payment: true },
    });

    if (!bill) return res.status(404).json({ error: 'Tagihan tidak ditemukan' });
    if (bill.status === 'PAID') {
      return res.json({ pesan: 'Tagihan ini sudah dibayar, tidak perlu reset.' });
    }

    // Hapus payment lama kalau ada
    if (bill.payment) {
      await prisma.payment.delete({ where: { id: bill.payment.id } });
    }

    // Reset status bill ke UNPAID
    await prisma.bill.update({
      where: { id: billId },
      data: { status: 'UNPAID' },
    });

    res.json({
      berhasil: true,
      pesan: `Link lama berhasil dihapus. Sekarang gunakan buat_link_bayar dengan billId ${billId} untuk generate link baru.`,
      billId,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TOOL: booking_kamar
// Calon penghuni mau booking kamar
// ============================================
router.post('/booking-room', async (req, res) => {
  try {
    const { roomId, nama, phone, moveInDate } = req.body;

    // Validasi field wajib
    if (!roomId || !nama || !phone) {
      return res.status(400).json({
        error: 'roomId, nama, dan phone wajib diisi',
      });
    }

    // Cek kamar masih available
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { property: true },
    });

    if (!room) {
      return res.status(404).json({ error: 'Kamar tidak ditemukan' });
    }
    if (room.status !== 'AVAILABLE') {
      return res.status(400).json({
        error: `Kamar ${room.number} sudah tidak tersedia (status: ${room.status})`,
        pesan: `Maaf, kamar ${room.number} sudah tidak tersedia. Mau cek kamar lain?`,
      });
    }

    // Cek apakah nomor WA sudah terdaftar sebagai penghuni aktif
    const existingTenant = await prisma.tenant.findFirst({
      where: {
        phone: { contains: phone.replace(/\D/g, '').slice(-10) },
        status: 'ACTIVE',
      },
    });

    if (existingTenant) {
      return res.status(400).json({
        pesan: `Nomor WhatsApp ini sudah terdaftar sebagai penghuni kamar ${existingTenant.roomId}. Hubungi admin untuk info lebih lanjut.`,
      });
    }

    // Tentukan tanggal masuk — default hari ini kalau tidak diisi
    const parsedMoveIn = moveInDate ? new Date(moveInDate) : new Date();
    // Validasi tanggal
    if (isNaN(parsedMoveIn.getTime())) {
      return res.status(400).json({ error: 'Format moveInDate tidak valid, gunakan YYYY-MM-DD' });
    }

    // Buat tenant baru dengan status PENDING
    const tenant = await prisma.tenant.create({
      data: {
        name: nama,
        phone: phone.replace(/\D/g, ''), // Simpan angka saja
        moveInDate: parsedMoveIn,
        status: 'PENDING',
        roomId: room.id,
      },
    });

    // Update status kamar jadi RESERVED
    await prisma.room.update({
      where: { id: roomId },
      data: { status: 'RESERVED' },
    });

    // Buat tagihan bulan pertama (UNPAID)
    const dueDate = new Date(parsedMoveIn);
    dueDate.setDate(dueDate.getDate() + 3); // Jatuh tempo 3 hari setelah check-in

    // Harga dinamis berdasarkan tanggal masuk
    let rentAmount = room.price;
    try {
      const p = await priceForRoom(room.id, parsedMoveIn);
      rentAmount = p.price;
    } catch (e) { /* fallback ke room.price */ }

    const bill = await prisma.bill.create({
      data: {
        type: 'RENT',
        amount: rentAmount,
        dueDate,
        status: 'UNPAID',
        description: `Sewa bulan pertama - Kamar ${room.number}`,
        tenantId: tenant.id,
        roomId: room.id,
      },
    });

    res.json({
      berhasil: true,
      pesan: `Booking berhasil! Kamar ${room.number} telah direservasi untuk ${nama}.`,
      data: {
        tenantId: tenant.id,
        nama: tenant.name,
        kamar: room.number,
        tipe: room.type,
        harga: `Rp ${room.price.toLocaleString('id-ID')}/bulan`,
        tanggalMasuk: parsedMoveIn.toISOString().split('T')[0],
        properti: room.property.name,
      },
      tagihan: {
        id: bill.id,
        jumlah: `Rp ${bill.amount.toLocaleString('id-ID')}`,
        jatuhTempo: dueDate.toISOString().split('T')[0],
        info: 'Tagihan bulan pertama sudah dibuat. Gunakan tool buat_link_bayar untuk membuat link pembayaran.',
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TOOL: info_kos
// ============================================
router.get('/property-info', async (req, res) => {
  try {
    const properties = await prisma.property.findMany({
      include: {
        facilities: { select: { name: true, icon: true } },
        rooms: {
          where: { status: 'AVAILABLE' },
          select: { type: true, price: true },
        },
      },
    });

    const formatted = properties.map(p => ({
      nama: p.name,
      alamat: p.address,
      kota: p.city,
      deskripsi: p.description || '-',
      peraturan: p.rules || '-',
      fasilitas: p.facilities.map(f => `${f.icon || '✓'} ${f.name}`),
      kamarTersedia: p.rooms.length,
      hargaMulai: p.rooms.length > 0
        ? `Rp ${Math.min(...p.rooms.map(r => r.price)).toLocaleString('id-ID')}/bulan`
        : 'Hubungi untuk harga',
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TOOL: cek_status_bayar
// Cek apakah tagihan tertentu sudah dibayar
// Bisa juga sync status dari Midtrans
// ============================================
router.post('/check-payment', async (req, res) => {
  try {
    const { billId } = req.body;

    const bill = await prisma.bill.findUnique({
      where: { id: billId },
      include: {
        tenant: true,
        room: { select: { number: true } },
        payment: { select: { status: true, method: true, paidAt: true, snapUrl: true, orderId: true } },
      },
    });

    if (!bill) return res.status(404).json({ error: 'Tagihan tidak ditemukan' });

    // If already paid
    if (bill.status === 'PAID') {
      return res.json({
        status: 'PAID',
        pesan: `✅ Tagihan ${bill.type} untuk ${bill.tenant.name} (Kamar ${bill.room.number}) sudah LUNAS!`,
        jumlah: `Rp ${bill.amount.toLocaleString('id-ID')}`,
        tanggalBayar: bill.paidAt?.toISOString().split('T')[0] || '-',
        metode: bill.payment?.method || '-',
      });
    }

    // If pending, try to check with Midtrans
    if (bill.payment?.orderId) {
      try {
        const s = await snap.transaction.status(bill.payment.orderId);
        if (s.transaction_status === 'settlement' || s.transaction_status === 'capture') {
          // It's actually paid! Update everything
          await prisma.payment.update({
            where: { billId: bill.id },
            data: { status: 'SUCCESS', method: s.payment_type, paidAt: new Date() },
          });
          await prisma.bill.update({
            where: { id: bill.id },
            data: { status: 'PAID', paidAt: new Date() },
          });

          // Activate tenant if PENDING
          if (bill.tenant.status === 'PENDING') {
            await prisma.tenant.update({ where: { id: bill.tenant.id }, data: { status: 'ACTIVE' } });
            await prisma.room.update({ where: { id: bill.roomId }, data: { status: 'OCCUPIED' } });
          }

          return res.json({
            status: 'PAID',
            pesan: `✅ Pembayaran berhasil dikonfirmasi! Tagihan ${bill.type} untuk ${bill.tenant.name} sudah LUNAS.`,
            jumlah: `Rp ${bill.amount.toLocaleString('id-ID')}`,
            metode: s.payment_type,
          });
        }
      } catch (e) {
        // Midtrans check failed, return current status
      }
    }

    return res.json({
      status: bill.status,
      pesan: `Tagihan ${bill.type} untuk ${bill.tenant.name} (Kamar ${bill.room.number}) belum dibayar.`,
      jumlah: `Rp ${bill.amount.toLocaleString('id-ID')}`,
      jatuhTempo: bill.dueDate.toISOString().split('T')[0],
      linkBayar: bill.payment?.snapUrl || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TOOL: log_message
// ============================================
router.post('/log-message', async (req, res) => {
  try {
    const { phone, direction, content, metadata } = req.body;

    const tenant = await prisma.tenant.findFirst({
      where: { phone: { contains: phone?.replace(/\D/g, '').slice(-10) || '' } },
    });

    await prisma.message.create({
      data: {
        direction: direction || 'INBOUND',
        content,
        metadata: metadata || {},
        tenantId: tenant?.id || null,
      },
    });

    res.json({ logged: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;