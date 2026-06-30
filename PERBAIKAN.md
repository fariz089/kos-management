# Perbaikan — Sinkronisasi Tagihan & Penghuni

Ringkasan perubahan untuk memperbaiki 4 masalah yang dilaporkan.

## 1. Jatuh tempo aneh (Moy/Caca jatuh tempo 10 Jun padahal masuk 1 Agustus)

**Penyebab:** Tombol **Generate Bulanan** membuat tagihan untuk SEMUA penghuni
berstatus ACTIVE/PENDING — termasuk yang baru masuk bulan depan — dengan harga
flat `room.price` dan jatuh tempo di bulan berjalan. Ini menghasilkan tagihan
"hantu" yang lepas dari kontrak.

**Perbaikan (`backend/src/routes/bills.js` → `generate-monthly`):**
- Hanya generate bila periode kontrak penghuni (`moveInDate`..`moveOutDate`)
  benar-benar mencakup bulan target.
- Tidak pernah melebihi jumlah bulan kontrak (`durationMonths`).
- Mengembalikan daftar `skipped` + alasannya supaya transparan.

## 2. Bunga tampil "kurang Rp 650.001" (harusnya 650.000)

**Penyebab:** DP di tagihan tersimpan `paidAmount = 649.999`, sedangkan
`tenant.depositAmount = 650.000`. Keduanya tidak pernah direkonsiliasi, jadi
selisih 1 rupiah tampil sebagai sisa ganjil.

**Perbaikan:**
- SQL `fix_billing_sync.sql` menyelaraskan selisih kecil (≤ 5 rupiah).
- Endpoint baru `POST /api/bills/reconcile` melakukan hal sama dari UI.

## 3. Tidak ada cara memperpanjang kos (Elza, Silma, Thalia, dll.)

**Penyebab:** Endpoint `/tenants/:id/renew` sudah ada, tetapi tombolnya hanya
ikon kecil dan hanya muncul untuk stage FINISHED/ACTIVE.

**Perbaikan (`frontend/src/pages/Tenants.jsx`):**
- Tombol **"Perpanjang"** berlabel jelas, muncul untuk stage
  Aktif / Selesai / Akan Masuk.
- Modal perpanjang kini punya field **Tanggal Mulai** (default = tanggal keluar
  saat ini) dan menampilkan periode baru yang dihitung otomatis.
- Backend menerima `startDate` dan **mengakumulasi** `durationMonths`
  (kontrak lama + perpanjangan) agar jumlah tagihan tetap konsisten.

## 4. Clara punya 2 tagihan lunas (kontrak 1 bulan)

**Penyebab:** Halaman Tagihan tidak tersambung dengan kontrak penghuni — tagihan
sewa ganda bisa muncul lewat Generate Bulanan / penambahan manual.

**Perbaikan:**
- Generate Bulanan kini menghormati `durationMonths`.
- Rekonsiliasi otomatis menghapus tagihan sewa ganda di luar kontrak (yang BELUM
  ada pembayaran — riwayat bayar dilindungi).

## 5. Shofiyyah tampil "Jatuh Tempo" padahal baru masuk 20 hari lagi

**Penyebab:** Dashboard menandai tagihan "jatuh tempo" hanya dari `dueDate < hari ini`,
tanpa cek apakah penghuni sudah masuk. Tagihan Shofiyyah punya `dueDate` 10 Jun
(sisa seed lama) padahal dia baru masuk 20 Jul.

**Perbaikan:**
- Dashboard sekarang hanya menghitung "jatuh tempo" bila penghuni SUDAH masuk
  (`moveInDate ≤ hari ini`). Jatuh tempo efektif = paling lambat antara `dueDate`
  dan tanggal masuk. Sesuai aturan: kewajiban bayar jatuh tempo saat penghuni masuk.
- Rekonsiliasi otomatis mengoreksi `dueDate` tagihan yang lebih awal dari tanggal
  masuk → diset ke tanggal masuk.

## 6. Tombol "Rapikan" sekali pakai → dihapus, jadi OTOMATIS

Kamu benar — tombol pembersih sekali pakai tidak pantas duduk permanen di UI.
Sekarang **rekonsiliasi berjalan otomatis** setiap kali halaman Tagihan atau
Dashboard dimuat (ringan & idempoten). Tombolnya dihapus. Tidak ada lagi langkah
manual; data selalu konsisten dengan kontrak penghuni.

## 7. Tombol Laporan PDF (baru)

Tombol **"Laporan PDF"** di halaman Tagihan menghasilkan laporan lengkap & mudah
dibaca: ringkasan keuangan (pemasukan bulan ini, total kurang bayar, jatuh tempo),
status penghuni & kamar, daftar tagihan menunggak, daftar kurang bayar (DP masuk),
daftar penghuni, dan semua tagihan — dengan nomor halaman. Dibuat server-side
(library `pdfkit`).

---

## Cara apply

1. Replace seluruh folder dengan isi zip ini.
2. Rebuild & restart (penting: ada dependency baru `pdfkit`):
   ```
   docker compose up -d --build
   ```
   Rekonsiliasi otomatis akan membersihkan data lama saat dashboard/tagihan dibuka
   pertama kali. (Opsional: jalankan `fix_billing_sync.sql` untuk membersihkan
   langsung di DB.)

Tidak ada perubahan skema database (tidak perlu `prisma migrate`).
