// ensure-enum.js
// Memastikan nilai enum 'PARTIAL' ADA di tipe "BillStatus" pada database SEBELUM
// `prisma db push` dijalankan.
//
// Kenapa perlu: kalau database punya baris ber-status 'PARTIAL' tetapi tipe enum
// BillStatus (versi yang sedang ada di DB) belum mengenal 'PARTIAL', maka
// `prisma db push` akan mencoba membangun ulang enum dan GAGAL dengan:
//   ERROR: invalid input value for enum "BillStatus_new": "PARTIAL"
// Dengan menambahkan nilainya lebih dulu (idempotent), schema DB jadi cocok dengan
// schema.prisma sehingga db push tidak perlu membangun ulang enum.
//
// Aman dijalankan berkali-kali. Tidak menghapus apa pun.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Cek apakah tipe BillStatus ada (kalau DB masih kosong/baru, lewati saja —
  // nanti `prisma db push` yang akan membuat enum lengkap dari schema.prisma).
  const typeExists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_type WHERE typname = 'BillStatus' LIMIT 1;`
  );
  if (!Array.isArray(typeExists) || typeExists.length === 0) {
    console.log('[ensure-enum] Tipe BillStatus belum ada — dilewati (akan dibuat oleh db push).');
    return;
  }

  // Tambahkan 'PARTIAL' kalau belum ada. IF NOT EXISTS membuat ini idempotent.
  // ALTER TYPE ... ADD VALUE tidak boleh di dalam transaksi → pakai executeRawUnsafe
  // (Prisma menjalankan ini sebagai statement tunggal, di luar transaksi eksplisit).
  await prisma.$executeRawUnsafe(
    `ALTER TYPE "BillStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';`
  );
  console.log("[ensure-enum] OK: nilai enum 'PARTIAL' dipastikan ada pada BillStatus.");
}

main()
  .catch((e) => {
    // Jangan menggagalkan boot kalau memang sudah ada / race condition jinak.
    const msg = String(e && e.message || e);
    if (msg.includes('already exists')) {
      console.log("[ensure-enum] 'PARTIAL' sudah ada — lanjut.");
      process.exit(0);
    }
    console.error('[ensure-enum] Gagal memastikan enum:', msg);
    // Keluar 0 supaya tidak menghentikan rantai start; db push tetap dicoba.
    // Kalau memang fatal, db push yang akan menampilkan error sebenarnya.
    process.exit(0);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
