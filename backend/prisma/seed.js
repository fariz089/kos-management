const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// ============================================
// DATA KOS — Andhata Boarding House
// Sumber data: Buku Pengelolaan Harian Kos (ANdhata_Kost.xlsx)
// 20 kamar — 11 terisi, 9 kosong.
//
// Mapping tipe kamar (xlsx → enum Prisma):
//   A VIP            → SUITE
//   B Deluxe         → DELUXE
//   C Standard Plus  → STANDARD  (tipe asli disimpan di description)
//   D Standard       → STANDARD
//
// Normalisasi nomor HP ke format 628xxxx (untuk pencocokan bot WhatsApp).
// ============================================

function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/\D/g, '');
  if (p.startsWith('0')) p = '62' + p.slice(1);
  else if (!p.startsWith('62')) p = '62' + p;
  return p;
}

// type, price (sesuai xlsx)
const FAS_STD = 'Kasur, Lemari Baju, Meja, Kamar mandi Dalam, Wifi';
const FAS_STDPLUS = 'Kasur, Lemari Baju, Meja, Kamar mandi Dalam, Wifi, Water Heater';
const FAS_DELUXE = 'Kasur, Lemari Baju, Meja, Kamar mandi Dalam, Wifi, AC, Water Heater';
const FAS_VIP = 'Kasur, Lemari Baju, Meja, Kamar mandi Dalam, Wifi, AC, Water Heater';

// Daftar kamar persis dari buku pengelolaan harian.
// enumType = enum Prisma; jenis = nama tipe asli (untuk deskripsi).
const ROOMS = [
  { number: 'A-01', jenis: 'D Standard',      enumType: 'STANDARD', fasilitas: FAS_STD,     price: 1000000, tenant: { name: 'Anet',                   phone: '085706085775', moveIn: '2026-06-05' } },
  { number: 'A-02', jenis: 'B Deluxe',        enumType: 'DELUXE',   fasilitas: FAS_DELUXE,  price: 1100000, tenant: { name: 'Syakira Izzati',         phone: '0817810350',   moveIn: '2026-06-21' } },
  { number: 'A-03', jenis: 'C Standard Plus', enumType: 'STANDARD', fasilitas: FAS_STDPLUS, price: 800000,  tenant: { name: 'Elsa Tri Angela',        phone: '08136815239',  moveIn: '2026-06-20' } },
  { number: 'A-04', jenis: 'B Deluxe',        enumType: 'DELUXE',   fasilitas: FAS_DELUXE,  price: 1100000, tenant: { name: 'Aurelia Chang',          phone: '085156012351', moveIn: '2026-03-28' } },
  { number: 'A-05', jenis: 'D Standard',      enumType: 'STANDARD', fasilitas: FAS_STD,     price: 700000,  tenant: { name: 'Vera Ismawanti',         phone: '081358822725', moveIn: '2026-07-14' } },
  { number: 'A-06', jenis: 'D Standard',      enumType: 'STANDARD', fasilitas: FAS_STD,     price: 700000,  tenant: { name: 'Shofiyyah Hana Tahniah', phone: '082278746346', moveIn: '2026-07-20', note: 'KURANG 350 RB, dp 50%' } },
  { number: 'A-07', jenis: 'B Deluxe',        enumType: 'DELUXE',   fasilitas: FAS_DELUXE,  price: 1100000, tenant: null },
  { number: 'A-08', jenis: 'D Standard',      enumType: 'STANDARD', fasilitas: FAS_STD,     price: 700000,  tenant: { name: 'Silma Kamilah',          phone: '082257529160', moveIn: '2026-05-28' } },
  { number: 'A-09', jenis: 'B Deluxe',        enumType: 'DELUXE',   fasilitas: FAS_DELUXE,  price: 1100000, tenant: { name: 'Yunie Sari Mega',        phone: '082210031416', moveIn: '2026-06-11' } },
  { number: 'A-10', jenis: 'A VIP',           enumType: 'SUITE',    fasilitas: FAS_VIP,     price: 2000000, tenant: { name: 'Shafa Nabila',           phone: '0816513855',   moveIn: '2026-08-01' } },
  { number: 'B-01', jenis: 'D Standard',      enumType: 'STANDARD', fasilitas: FAS_STD,     price: 700000,  tenant: null },
  { number: 'B-02', jenis: 'B Deluxe',        enumType: 'DELUXE',   fasilitas: FAS_DELUXE,  price: 1100000, tenant: null },
  { number: 'B-03', jenis: 'D Standard',      enumType: 'STANDARD', fasilitas: FAS_STD,     price: 700000,  tenant: null },
  { number: 'B-04', jenis: 'C Standard Plus', enumType: 'STANDARD', fasilitas: FAS_STDPLUS, price: 800000,  tenant: null },
  { number: 'B-06', jenis: 'D Standard',      enumType: 'STANDARD', fasilitas: FAS_STD,     price: 700000,  tenant: null },
  { number: 'B-07', jenis: 'B Deluxe',        enumType: 'DELUXE',   fasilitas: FAS_DELUXE,  price: 1100000, tenant: null },
  { number: 'B-08', jenis: 'D Standard',      enumType: 'STANDARD', fasilitas: FAS_STD,     price: 700000,  tenant: null },
  { number: 'B-09', jenis: 'D Standard',      enumType: 'STANDARD', fasilitas: FAS_STD,     price: 700000,  tenant: { name: 'Elza Rifdah',            phone: '081949270546', moveIn: '2026-05-28' } },
  { number: 'B-10', jenis: 'C Standard Plus', enumType: 'STANDARD', fasilitas: FAS_STDPLUS, price: 800000,  tenant: { name: 'Thalia Trivigiani',      phone: '081249693213', moveIn: '2026-05-01' } },
  { number: 'B-11', jenis: 'D Standard',      enumType: 'STANDARD', fasilitas: FAS_STD,     price: 700000,  tenant: null },
];

async function main() {
  // Skip if already seeded
  const existingUser = await prisma.user.findUnique({ where: { email: 'admin@andhata.kos' } });
  if (existingUser) {
    console.log('✅ Database already seeded, skipping.');
    return;
  }

  console.log('🌱 Seeding database — Andhata Boarding House...');

  // ─── Owner ───────────────────────────────────────────────
  const password = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || 'admin123', 12);
  const owner = await prisma.user.upsert({
    where: { email: 'admin@andhata.kos' },
    update: {},
    create: {
      name: 'Admin Andhata',
      email: 'admin@andhata.kos',
      phone: '6281326486485',
      password,
      role: 'OWNER',
    },
  });

  // ─── Property ────────────────────────────────────────────
  const property = await prisma.property.upsert({
    where: { id: 'prop-andhata-001' },
    update: {},
    create: {
      id: 'prop-andhata-001',
      name: 'Andhata Boarding House',
      address: 'Jl. Dieng Atas Gg. Praja No.RT.001, RW.003, Kunci, Kalisongo, Kec. Dau, Kabupaten Malang, Jawa Timur 65151',
      city: 'Malang',
      description: 'Kos eksklusif 20 kamar di Kalisongo, Dau, Malang. Tersedia tipe Standard, Standard Plus, Deluxe, dan VIP. Semua kamar mandi dalam + WiFi. Kontak: +62 813-2648-6485',
      rules: '1. Tamu maks jam 22.00\n2. Dilarang merokok di kamar\n3. Bayar sewa sesuai tanggal jatuh tempo masing-masing\n4. Jaga kebersihan & ketenangan bersama',
      ownerId: owner.id,
    },
  });

  // ─── Facilities ──────────────────────────────────────────
  const facilities = [
    { name: 'WiFi', icon: '📶' },
    { name: 'Kamar Mandi Dalam', icon: '🚿' },
    { name: 'Parkir', icon: '🛵' },
    { name: 'AC (tipe Deluxe & VIP)', icon: '❄️' },
    { name: 'Water Heater (tipe tertentu)', icon: '🔥' },
    { name: 'Kasur, Lemari & Meja', icon: '🛏️' },
  ];
  for (const f of facilities) {
    await prisma.facility.create({ data: { name: f.name, icon: f.icon, propertyId: property.id } });
  }

  // ─── Rooms + Tenants + Bills ─────────────────────────────
  let occupied = 0, vacant = 0;
  for (const r of ROOMS) {
    const isOccupied = !!r.tenant;
    const floor = r.number.startsWith('A') ? 1 : 2;

    const room = await prisma.room.create({
      data: {
        number: r.number,
        floor,
        type: r.enumType,
        price: r.price,
        status: isOccupied ? 'OCCUPIED' : 'AVAILABLE',
        description: `${r.jenis} — ${r.fasilitas}`,
        propertyId: property.id,
      },
    });

    if (!isOccupied) { vacant++; continue; }
    occupied++;

    const moveIn = new Date(r.tenant.moveIn);
    const tenant = await prisma.tenant.create({
      data: {
        name: r.tenant.name,
        phone: normalizePhone(r.tenant.phone),
        moveInDate: moveIn,
        status: 'ACTIVE',
        roomId: room.id,
      },
    });

    // Tagihan sewa berjalan — semua penghuni saat ini berstatus Lunas (PAID),
    // jatuh tempo berikutnya = sebulan setelah tanggal masuk.
    const dueDate = new Date(moveIn);
    dueDate.setMonth(dueDate.getMonth() + 1);

    await prisma.bill.create({
      data: {
        type: 'RENT',
        amount: r.price,
        dueDate,
        status: 'PAID',
        paidAt: moveIn,
        description: `Sewa kamar ${r.number}${r.tenant.note ? ' — ' + r.tenant.note : ''}`,
        tenantId: tenant.id,
        roomId: room.id,
      },
    });
  }

  console.log('✅ Seeding complete!');
  console.log(`   Owner    : admin@andhata.kos / ${process.env.SEED_ADMIN_PASSWORD || 'admin123'}`);
  console.log(`   Property : ${property.name}`);
  console.log(`   Rooms    : ${ROOMS.length} (terisi: ${occupied}, kosong: ${vacant})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
