const prisma = require('./prisma');

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/**
 * Apakah dua rentang tanggal [aStart,aEnd] dan [bStart,bEnd] bertumpang tindih?
 * Tanggal keluar dianggap EKSKLUSIF (hari keluar = hari kosong, bisa langsung
 * ditempati penghuni berikutnya). Jadi overlap hanya bila aStart < bEnd && bStart < aEnd.
 */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const as = startOfDay(aStart).getTime();
  const ae = aEnd ? startOfDay(aEnd).getTime() : Infinity;
  const bs = startOfDay(bStart).getTime();
  const be = bEnd ? startOfDay(bEnd).getTime() : Infinity;
  return as < be && bs < ae;
}

/**
 * Cek apakah sebuah kamar BEBAS pada rentang [start, end], dengan mengabaikan
 * satu penghuni tertentu (ignoreTenantId, mis. penghuni yang sedang diperpanjang).
 * Penghuni yang dihitung: yang masih aktif kontraknya (ACTIVE/PENDING) — bukan
 * yang sudah dibatalkan (INACTIVE).
 *
 * @returns {Promise<{free:boolean, conflict:null|{name:string, moveInDate:Date, moveOutDate:Date}}>}
 */
async function isRoomFree(roomId, start, end, ignoreTenantId = null) {
  const tenants = await prisma.tenant.findMany({
    where: {
      roomId,
      status: { in: ['ACTIVE', 'PENDING'] },
      ...(ignoreTenantId ? { id: { not: ignoreTenantId } } : {}),
    },
    select: { id: true, name: true, moveInDate: true, moveOutDate: true },
  });

  for (const t of tenants) {
    if (!t.moveInDate) continue;
    if (rangesOverlap(start, end, t.moveInDate, t.moveOutDate)) {
      return { free: false, conflict: { name: t.name, moveInDate: t.moveInDate, moveOutDate: t.moveOutDate } };
    }
  }
  return { free: true, conflict: null };
}

/**
 * Daftar kamar milik owner yang BEBAS pada rentang [start, end].
 * @returns {Promise<Array>} kamar (id, number, type, price, tier) yang bebas.
 */
async function availableRoomsForRange(ownerId, start, end, ignoreTenantId = null) {
  const rooms = await prisma.room.findMany({
    where: { property: { ownerId }, status: { not: 'MAINTENANCE' } },
    include: {
      tier: { select: { code: true, name: true } },
      tenants: {
        where: { status: { in: ['ACTIVE', 'PENDING'] }, ...(ignoreTenantId ? { id: { not: ignoreTenantId } } : {}) },
        select: { id: true, name: true, moveInDate: true, moveOutDate: true },
      },
    },
    orderBy: { number: 'asc' },
  });

  const free = [];
  for (const r of rooms) {
    const clash = r.tenants.some((t) => t.moveInDate && rangesOverlap(start, end, t.moveInDate, t.moveOutDate));
    if (!clash) {
      free.push({
        id: r.id, number: r.number, floor: r.floor, type: r.type, price: r.price,
        tier: r.tier ? { code: r.tier.code, name: r.tier.name } : null,
      });
    }
  }
  return free;
}

module.exports = { rangesOverlap, isRoomFree, availableRoomsForRange, startOfDay };
