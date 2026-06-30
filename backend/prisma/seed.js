const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  // Skip if already seeded
  const existingUser = await prisma.user.findUnique({ where: { email: 'admin@andhata.kos' } });
  if (existingUser) {
    console.log('✅ Database already seeded, skipping.');
    return;
  }

  console.log('🌱 Seeding database...');

  // Create owner
  const password = await bcrypt.hash('admin123', 12);
  const owner = await prisma.user.upsert({
    where: { email: 'admin@andhata.kos' },
    update: {},
    create: {
      name: 'Admin Kos',
      email: 'admin@andhata.kos',
      phone: '6281286333232',
      password,
      role: 'OWNER',
    },
  });

  // Create property
  const property = await prisma.property.upsert({
    where: { id: 'prop-andhata-001' },
    update: {},
    create: {
      id: 'prop-andhata-001',
      name: 'Andhata Boarding House',
      address: 'Jl. Dieng Atas Gg. Praja No.RT.001, RW.003, Kunci, Kalisongo, Kec. Dau, Kabupaten Malang, Jawa Timur 65151',
      city: 'Malang',
      description: 'Kos putri nyaman di Kalisongo Dau Malang, kamar mandi dalam, WiFi, dengan berbagai pilihan tipe kamar.',
      rules: '1. Khusus penghuni putri\n2. Tamu maks jam 21.00\n3. Dilarang merokok di dalam kamar\n4. Bayar sewa tepat waktu setiap bulan\n5. Jaga kebersihan dan ketenangan bersama',
      ownerId: owner.id,
    },
  });

  // Create facilities
  const facilities = ['WiFi', 'Kamar Mandi Dalam', 'Kasur', 'Lemari Baju', 'Meja Belajar', 'AC (tipe tertentu)', 'Water Heater (tipe tertentu)'];
  for (const name of facilities) {
    await prisma.facility.create({
      data: { name, propertyId: property.id },
    });
  }

  // Room data from xlsx
  // Type mapping: A VIP -> SUITE, B Deluxe -> DELUXE, C Standard Plus -> DELUXE, D Standard -> STANDARD
  const roomsData = [
    { number: 'A-01', floor: 1, type: 'STANDARD', price: 1000000, status: 'OCCUPIED',  description: 'Kamar Standard, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi' },
    { number: 'A-02', floor: 1, type: 'DELUXE',   price: 1100000, status: 'OCCUPIED',  description: 'Kamar Deluxe, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi, AC, Water Heater' },
    { number: 'A-03', floor: 1, type: 'DELUXE',   price: 800000,  status: 'OCCUPIED',  description: 'Kamar Standard Plus, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi, Water Heater' },
    { number: 'A-04', floor: 1, type: 'DELUXE',   price: 1100000, status: 'OCCUPIED',  description: 'Kamar Deluxe, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi, AC, Water Heater' },
    { number: 'A-05', floor: 1, type: 'STANDARD', price: 700000,  status: 'OCCUPIED',  description: 'Kamar Standard, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi' },
    { number: 'A-06', floor: 1, type: 'STANDARD', price: 700000,  status: 'OCCUPIED',  description: 'Kamar Standard, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi' },
    { number: 'A-07', floor: 1, type: 'DELUXE',   price: 1100000, status: 'AVAILABLE', description: 'Kamar Deluxe, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi, AC, Water Heater' },
    { number: 'A-08', floor: 1, type: 'STANDARD', price: 700000,  status: 'OCCUPIED',  description: 'Kamar Standard, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi' },
    { number: 'A-09', floor: 1, type: 'DELUXE',   price: 1100000, status: 'OCCUPIED',  description: 'Kamar Deluxe, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi, AC, Water Heater' },
    { number: 'A-10', floor: 1, type: 'SUITE',    price: 2000000, status: 'OCCUPIED',  description: 'Kamar VIP, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi, AC, Water Heater' },
    { number: 'B-01', floor: 2, type: 'STANDARD', price: 700000,  status: 'AVAILABLE', description: 'Kamar Standard, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi' },
    { number: 'B-02', floor: 2, type: 'DELUXE',   price: 1100000, status: 'AVAILABLE', description: 'Kamar Deluxe, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi, AC, Water Heater' },
    { number: 'B-03', floor: 2, type: 'STANDARD', price: 700000,  status: 'AVAILABLE', description: 'Kamar Standard, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi' },
    { number: 'B-04', floor: 2, type: 'DELUXE',   price: 800000,  status: 'AVAILABLE', description: 'Kamar Standard Plus, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi, Water Heater' },
    { number: 'B-06', floor: 2, type: 'STANDARD', price: 700000,  status: 'AVAILABLE', description: 'Kamar Standard, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi' },
    { number: 'B-07', floor: 2, type: 'DELUXE',   price: 1100000, status: 'AVAILABLE', description: 'Kamar Deluxe, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi, AC, Water Heater' },
    { number: 'B-08', floor: 2, type: 'STANDARD', price: 700000,  status: 'AVAILABLE', description: 'Kamar Standard, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi' },
    { number: 'B-09', floor: 2, type: 'STANDARD', price: 700000,  status: 'OCCUPIED',  description: 'Kamar Standard, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi' },
    { number: 'B-10', floor: 2, type: 'DELUXE',   price: 800000,  status: 'OCCUPIED',  description: 'Kamar Standard Plus, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi, Water Heater' },
    { number: 'B-11', floor: 2, type: 'STANDARD', price: 700000,  status: 'AVAILABLE', description: 'Kamar Standard, fasilitas: Kasur, Lemari Baju, Meja, KM Dalam, Wifi' },
  ];

  const rooms = [];
  for (const rd of roomsData) {
    const room = await prisma.room.create({
      data: {
        number: rd.number,
        floor: rd.floor,
        type: rd.type,
        price: rd.price,
        status: rd.status,
        description: rd.description,
        propertyId: property.id,
      },
    });
    rooms.push({ ...room, roomNumber: rd.number });
  }

  // Tenant data from xlsx (only occupied rooms)
  // Excel dates: serial 46178 = Jan 17 2026, base = Jan 1 1900
  // Formula: new Date((serial - 25569) * 86400 * 1000) for Excel epoch
  function excelDate(serial) {
    return new Date((serial - 25569) * 86400 * 1000);
  }

  const tenantData = [
    { roomNumber: 'A-01', name: 'Anet',                phone: '6285706085775', moveInDate: excelDate(46178), moveOutDate: excelDate(46208) },
    { roomNumber: 'A-02', name: 'Syakira Izzati',      phone: '6281781035000', moveInDate: excelDate(46194), moveOutDate: excelDate(46224) },
    { roomNumber: 'A-03', name: 'Elsa Tri Angela',     phone: '6281368152390', moveInDate: excelDate(46193), moveOutDate: excelDate(46254) },
    { roomNumber: 'A-04', name: 'Aurelia Chang',       phone: '6285156012351', moveInDate: excelDate(46109), moveOutDate: excelDate(46201) },
    { roomNumber: 'A-05', name: 'Vera Ismawanti',      phone: '6281358822725', moveInDate: excelDate(46217), moveOutDate: excelDate(46309) },
    { roomNumber: 'A-06', name: 'Shofiyyah Hana Tahniah', phone: '6282278746346', moveInDate: excelDate(46223), moveOutDate: excelDate(46254) },
    { roomNumber: 'A-08', name: 'Silma Kamilah',       phone: '6282257529160', moveInDate: excelDate(46170), moveOutDate: excelDate(46201) },
    { roomNumber: 'A-09', name: 'Yunie Sari Mega',     phone: '6282210031416', moveInDate: excelDate(46184), moveOutDate: excelDate(46398) },
    { roomNumber: 'A-10', name: 'Shafa Nabila',        phone: '6281651385500', moveInDate: excelDate(46235), moveOutDate: excelDate(46327) },
    { roomNumber: 'B-09', name: 'Elza Rifdah',         phone: '6281949270546', moveInDate: excelDate(46170), moveOutDate: excelDate(46201) },
    { roomNumber: 'B-10', name: 'Thalia Trivigiani',   phone: '6281249693213', moveInDate: excelDate(46143), moveOutDate: excelDate(46174) },
    // Penghuni baru masuk belakangan di A-04 (Aurelia keluar 28 Jun, Lana masuk 20 Jul).
    // Contoh kasus 1 kamar dipakai beberapa orang di periode berbeda. DP 550rb, sewa 1 bln.
    { roomNumber: 'A-04', name: 'Lana Malika',         phone: '6281113802605', moveInDate: excelDate(46223), moveOutDate: excelDate(46254), depositAmount: 550000, durationMonths: 1 },
  ];

  const roomMap = {};
  for (const r of rooms) roomMap[r.roomNumber] = r;

  for (const td of tenantData) {
    const room = roomMap[td.roomNumber];
    if (!room) continue;

    const hasDP = td.depositAmount && td.depositAmount > 0;
    const months = td.durationMonths || 1;
    const contractTotal = room.price * months;
    const dp = hasDP ? Math.min(td.depositAmount, contractTotal) : 0;
    const sisa = Math.max(0, contractTotal - dp);

    // Status TERSIMPAN dibiarkan sederhana; tahap kaya (Dipesan/Akan Masuk/
    // Aktif/Selesai) dihitung on-the-fly oleh utils/lifecycle.js dari tanggal +
    // pembayaran. Untuk penghuni ber-DP yang belum lunas → PENDING; sisanya
    // tanpa status khusus akan otomatis terpetakan oleh helper saat ditampilkan.
    // Kita simpan ACTIVE hanya bila tidak ada sisa & sudah/akan masuk normal.
    const storedStatus = hasDP && sisa > 0 ? 'PENDING' : 'ACTIVE';

    const tenant = await prisma.tenant.create({
      data: {
        name: td.name,
        phone: td.phone,
        moveInDate: td.moveInDate,
        moveOutDate: td.moveOutDate,
        status: storedStatus,
        ...(hasDP ? { depositAmount: dp, depositPaidAt: new Date(), durationMonths: months } : {}),
        roomId: room.id,
      },
    });

    if (hasDP) {
      // Tagihan kontrak dengan DP sebagai pembayaran sebagian (kurang bayar).
      const billStatus = sisa > 0 ? 'PARTIAL' : 'PAID';
      // Jatuh tempo sewa periode pertama = tanggal masuk (wajib lunas saat masuk).
      const due = new Date(td.moveInDate);
      await prisma.bill.create({
        data: {
          type: 'RENT',
          amount: contractTotal,
          paidAmount: dp,
          dueDate: due,
          status: billStatus,
          ...(billStatus === 'PAID' ? { paidAt: new Date() } : {}),
          description: `Sewa kamar ${td.roomNumber} — DP Rp ${dp.toLocaleString('id-ID')}, sisa Rp ${sisa.toLocaleString('id-ID')}`,
          tenantId: tenant.id,
          roomId: room.id,
        },
      });
      // Kamar yang dipesan untuk masa depan → RESERVED (bukan OCCUPIED).
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const mi = new Date(td.moveInDate); mi.setHours(0, 0, 0, 0);
      if (mi > today || sisa > 0) {
        await prisma.room.update({ where: { id: room.id }, data: { status: 'RESERVED' } }).catch(() => {});
      }
    } else {
      // Tagihan lunas periode pertama. Jatuh tempo = tanggal masuk penghuni
      // (bukan tanggal hard-coded), sesuai aturan kos.
      await prisma.bill.create({
        data: {
          type: 'RENT',
          amount: room.price,
          paidAmount: room.price,
          dueDate: new Date(td.moveInDate),
          status: 'PAID',
          paidAt: new Date(td.moveInDate),
          description: `Sewa kamar ${td.roomNumber} — sewa pertama`,
          tenantId: tenant.id,
          roomId: room.id,
        },
      });
    }
  }

  console.log('✅ Seeding complete!');
  console.log(`   Owner: admin@andhata.kos / admin123`);
  console.log(`   Property: Andhata Boarding House`);
  console.log(`   Rooms: ${rooms.length}`);
  console.log(`   Tenants: ${tenantData.length}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());