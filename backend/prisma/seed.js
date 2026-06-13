const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  // Skip if already seeded
  const existingUser = await prisma.user.findUnique({ where: { email: 'admin@kos.j99t.tech' } });
  if (existingUser) {
    console.log('✅ Database already seeded, skipping.');
    return;
  }

  console.log('🌱 Seeding database...');

  // Create owner
  const password = await bcrypt.hash('admin123', 12);
  const owner = await prisma.user.upsert({
    where: { email: 'admin@kos.j99t.tech' },
    update: {},
    create: {
      name: 'Admin Kos',
      email: 'admin@kos.j99t.tech',
      phone: '6281234567890',
      password,
      role: 'OWNER',
    },
  });

  // Create property
  const property = await prisma.property.upsert({
    where: { id: 'prop-demo-001' },
    update: {},
    create: {
      id: 'prop-demo-001',
      name: 'Kos Harmoni Residence',
      address: 'Jl. Kebon Jeruk No. 42',
      city: 'Jakarta Barat',
      description: 'Kos nyaman dekat stasiun MRT, WiFi kencang, parkir luas',
      rules: '1. Tamu maks jam 22.00\n2. Dilarang merokok di kamar\n3. Bayar sewa tiap tanggal 1-10',
      ownerId: owner.id,
    },
  });

  // Create facilities
  const facilities = ['WiFi 100Mbps', 'Parkir Motor', 'Dapur Bersama', 'Laundry', 'CCTV 24 Jam', 'Air Panas'];
  for (const name of facilities) {
    await prisma.facility.create({
      data: { name, propertyId: property.id },
    });
  }

  // Create rooms
  const rooms = [];
  for (let floor = 1; floor <= 2; floor++) {
    for (let num = 1; num <= 5; num++) {
      const roomNum = `${floor}0${num}`;
      const isDeluxe = num >= 4;
      const room = await prisma.room.create({
        data: {
          number: roomNum,
          floor,
          type: isDeluxe ? 'DELUXE' : 'STANDARD',
          price: isDeluxe ? 1800000 : 1200000,
          status: num <= 3 ? 'OCCUPIED' : 'AVAILABLE',
          description: isDeluxe ? 'Kamar luas dengan kamar mandi dalam' : 'Kamar standar nyaman',
          propertyId: property.id,
        },
      });
      rooms.push(room);
    }
  }

  // Create tenants for occupied rooms
  const tenantData = [
    { name: 'Budi Santoso', phone: '6281111111111' },
    { name: 'Siti Rahayu', phone: '6282222222222' },
    { name: 'Ahmad Fauzi', phone: '6283333333333' },
    { name: 'Dewi Lestari', phone: '6284444444444' },
    { name: 'Rizky Pratama', phone: '6285555555555' },
    { name: 'Nur Fadilah', phone: '6286666666666' },
  ];

  const occupiedRooms = rooms.filter(r => r.status === 'OCCUPIED');
  for (let i = 0; i < occupiedRooms.length; i++) {
    const td = tenantData[i];
    if (!td) break;

    const tenant = await prisma.tenant.create({
      data: {
        name: td.name,
        phone: td.phone,
        moveInDate: new Date('2025-01-15'),
        roomId: occupiedRooms[i].id,
      },
    });

    // Create a bill for this month
    await prisma.bill.create({
      data: {
        type: 'RENT',
        amount: occupiedRooms[i].price,
        dueDate: new Date(2026, 4, 10), // May 10, 2026
        status: i < 3 ? 'PAID' : 'UNPAID',
        paidAt: i < 3 ? new Date(2026, 4, 5) : null,
        description: `Sewa kamar ${occupiedRooms[i].number} — Mei 2026`,
        tenantId: tenant.id,
        roomId: occupiedRooms[i].id,
      },
    });
  }

  console.log('✅ Seeding complete!');
  console.log(`   Owner: admin@kos.j99t.tech / admin123`);
  console.log(`   Property: ${property.name}`);
  console.log(`   Rooms: ${rooms.length}`);
  console.log(`   Tenants: ${tenantData.length}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
