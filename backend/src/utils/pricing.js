const prisma = require('./prisma');

/**
 * Resolusi harga sewa untuk sebuah kamar pada tanggal tertentu.
 *
 * Logika:
 *  1. Kalau kamar punya tier (Tipe A/B/C/D), cari PricingRule yang periodenya
 *     mencakup `date` (berdasarkan tanggal masuk penghuni).
 *  2. Kalau ada beberapa rule yang cocok, ambil yang startDate-nya paling baru
 *     (paling spesifik), lalu yang punya endDate (lebih sempit) didahulukan.
 *  3. Kalau tidak ada rule yang cocok / kamar tanpa tier, fallback ke Room.price.
 *
 * @param {string} roomId
 * @param {Date|string} [date=now]  Tanggal acuan (biasanya tanggal masuk penghuni)
 * @returns {Promise<{ price: number, source: string, label: string|null, tierCode: string|null }>}
 */
async function priceForRoom(roomId, date = new Date()) {
  const at = date ? new Date(date) : new Date();
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { tier: { include: { rules: true } } },
  });

  if (!room) throw new Error('Kamar tidak ditemukan');

  // Tanpa tier → pakai harga flat kamar
  if (!room.tier || !room.tier.rules || room.tier.rules.length === 0) {
    return { price: room.price, source: 'ROOM_FLAT', label: null, tierCode: room.tier?.code || null };
  }

  // Cari rule yang mencakup tanggal
  const matching = room.tier.rules.filter((r) => {
    const afterStart = !r.startDate || new Date(r.startDate) <= at;
    const beforeEnd = !r.endDate || new Date(r.endDate) >= at;
    return afterStart && beforeEnd;
  });

  if (matching.length === 0) {
    // Tidak ada periode cocok → fallback harga kamar
    return { price: room.price, source: 'ROOM_FLAT_FALLBACK', label: null, tierCode: room.tier.code };
  }

  // Paling spesifik: startDate terbaru dulu, lalu yang punya endDate (rentang lebih sempit)
  matching.sort((a, b) => {
    const sa = a.startDate ? new Date(a.startDate).getTime() : 0;
    const sb = b.startDate ? new Date(b.startDate).getTime() : 0;
    if (sb !== sa) return sb - sa;
    const ea = a.endDate ? 0 : 1; // yang punya endDate (0) didahulukan
    const eb = b.endDate ? 0 : 1;
    return ea - eb;
  });

  const chosen = matching[0];
  return { price: chosen.price, source: 'TIER_RULE', label: chosen.label || null, tierCode: room.tier.code };
}

module.exports = { priceForRoom };
