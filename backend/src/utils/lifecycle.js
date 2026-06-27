/**
 * ============================================================
 *  LIFECYCLE PENGHUNI — status dihitung otomatis (computed)
 * ============================================================
 *
 * Masalah lama: semua penghuni di-seed `ACTIVE`, jadi penghuni yang baru
 * masuk 2 bulan lagi pun tampil "Aktif". Itu salah secara konsep.
 *
 * Solusi: SIMPAN enum `TenantStatus` tetap sederhana di DB, tapi HITUNG
 * "tahap" (stage) yang lebih kaya secara on-the-fly dari:
 *   - tanggal masuk / keluar (moveInDate / moveOutDate)
 *   - kondisi pembayaran (apakah masih ada sisa kurang bayar)
 *   - override manual (kolom `status` dipakai sebagai sinyal override)
 *
 * Keuntungan:
 *   - Status auto-update seiring waktu TANPA cron / tulis DB.
 *     ("Akan Masuk" otomatis jadi "Aktif" pas hari H.)
 *   - Tidak perlu migrasi enum yang rapuh (kita baru saja kena masalah itu).
 *   - Tetap bisa override manual kalau pemilik mau.
 *
 * Lima tahap:
 *   RESERVED  → "Dipesan"    : sudah DP, masih ada sisa, & belum masuk
 *   UPCOMING  → "Akan Masuk" : lunas tapi tanggal masuk belum tiba
 *   ACTIVE    → "Aktif"      : sedang tinggal (masuk ≤ hari ini ≤ keluar)
 *   FINISHED  → "Selesai"    : sudah lewat tanggal keluar
 *   INACTIVE  → "Non-Aktif"  : dibatalkan / keluar manual (override)
 */

const STAGE = {
  RESERVED: 'RESERVED',
  UPCOMING: 'UPCOMING',
  ACTIVE: 'ACTIVE',
  FINISHED: 'FINISHED',
  INACTIVE: 'INACTIVE',
};

// Label Bahasa Indonesia + warna (dipakai juga sebagai acuan di frontend)
const STAGE_META = {
  RESERVED: { label: 'Dipesan', color: 'amber', desc: 'Sudah DP, belum lunas & belum masuk' },
  UPCOMING: { label: 'Akan Masuk', color: 'blue', desc: 'Lunas, menunggu tanggal masuk' },
  ACTIVE: { label: 'Aktif', color: 'emerald', desc: 'Sedang tinggal sekarang' },
  FINISHED: { label: 'Selesai', color: 'slate', desc: 'Sudah lewat tanggal keluar' },
  INACTIVE: { label: 'Non-Aktif', color: 'rose', desc: 'Dibatalkan / keluar' },
};

/** Normalisasi tanggal ke awal hari (abaikan jam) untuk perbandingan adil. */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Hitung total sisa kurang bayar dari kumpulan tagihan penghuni.
 * @param {Array<{amount:number, paidAmount:number, status:string}>} bills
 * @returns {number} total sisa (Rupiah). 0 = tidak ada kurang bayar.
 */
function outstanding(bills = []) {
  return bills.reduce((sum, b) => {
    if (b.status === 'CANCELLED') return sum;
    const remaining = Math.max(0, (b.amount || 0) - (b.paidAmount || 0));
    return sum + remaining;
  }, 0);
}

/**
 * Tentukan tahap lifecycle penghuni.
 *
 * @param {object} tenant  Objek tenant (boleh sertakan `bills` untuk akurasi pembayaran)
 * @param {Date}   [now=new Date()]
 * @returns {{ stage:string, label:string, color:string, overridden:boolean, outstanding:number }}
 */
function tenantStage(tenant, now = new Date()) {
  const today = startOfDay(now);
  const bills = tenant.bills || [];
  const sisa = outstanding(bills);

  // 1) OVERRIDE MANUAL — kalau pemilik set INACTIVE, hormati apa adanya.
  if (tenant.status === 'INACTIVE') {
    return meta(STAGE.INACTIVE, true, sisa);
  }

  const moveIn = tenant.moveInDate ? startOfDay(tenant.moveInDate) : null;
  const moveOut = tenant.moveOutDate ? startOfDay(tenant.moveOutDate) : null;

  // 2) SELESAI — tanggal keluar sudah lewat.
  if (moveOut && moveOut < today) {
    return meta(STAGE.FINISHED, false, sisa);
  }

  // 3) BELUM MASUK (tanggal masuk di masa depan)
  if (moveIn && moveIn > today) {
    // Masih ada sisa kurang bayar → Dipesan. Sudah lunas → Akan Masuk.
    return meta(sisa > 0 ? STAGE.RESERVED : STAGE.UPCOMING, false, sisa);
  }

  // 4) SEDANG PERIODE TINGGAL (masuk ≤ hari ini ≤ keluar) atau tanpa tanggal masuk.
  //    Kalau masih ada sisa DP yang belum dilunasi padahal sudah waktunya masuk,
  //    tetap tampilkan Dipesan supaya pemilik ingat menagih — kecuali di-override ACTIVE.
  if (sisa > 0 && tenant.status !== 'ACTIVE') {
    return meta(STAGE.RESERVED, false, sisa);
  }

  return meta(STAGE.ACTIVE, false, sisa);
}

function meta(stage, overridden, sisa) {
  const m = STAGE_META[stage];
  return { stage, label: m.label, color: m.color, overridden, outstanding: sisa };
}

module.exports = { tenantStage, outstanding, STAGE, STAGE_META };
