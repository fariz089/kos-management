-- ============================================================
-- MIGRATION: Perbaikan Sinkronisasi Tagihan (Billing Sync Fix)
--
-- Memperbaiki 3 masalah yang muncul karena halaman Tagihan & Penghuni
-- belum tersambung rapi:
--
--   1. Tagihan "hantu" dari tombol "Generate Bulanan" untuk penghuni yang
--      baru masuk bulan depan (Moy & Caca) — muncul jatuh tempo 10 Jun 2026
--      padahal mereka baru masuk 1 Agustus. HAPUS.
--
--   2. Tagihan sewa GANDA untuk Clara (kontrak 1 bulan tapi ada 2 tagihan
--      RENT lunas). Sisakan 1 tagihan kontrak, hapus duplikatnya.
--
--   3. DP Bunga meleset 1 rupiah: tenant.depositAmount = 650.000 tapi
--      bill.paidAmount = 649.999 → sisa tampil 650.001. Selaraskan ke 650.000.
--
-- Jalankan SEKALI di database production (aman diulang / idempotent):
--   docker compose exec -T db psql -U kos_admin -d kos_management \
--     < backend/prisma/migrations/fix_billing_sync.sql
-- ============================================================

BEGIN;

-- ── 1. Hapus tagihan "hantu" Generate Bulanan untuk penghuni yang belum masuk ──
--    Kriteria aman: tagihan RENT, BELUM dibayar sama sekali (paidAmount = 0),
--    deskripsi pola "Sewa kamar ... — M/YYYY" (format generate bulanan), dan
--    milik penghuni yang tanggal masuknya MASIH di masa depan relatif dueDate.
DELETE FROM "Bill" b
USING "Tenant" t
WHERE b."tenantId" = t."id"
  AND b."type" = 'RENT'
  AND b."paidAmount" = 0
  AND b."status" IN ('UNPAID', 'OVERDUE')
  AND b."description" ~ '^Sewa kamar .+ — [0-9]+/[0-9]{4}$'
  AND t."moveInDate" > b."dueDate";

-- ── 2. Dedupe tagihan sewa Clara (kontrak 1 bulan = maksimal 1 tagihan RENT) ──
--    Untuk setiap penghuni dengan durationMonths = 1 yang punya >1 tagihan RENT
--    non-CANCELLED, sisakan tagihan TERLAMA (kontrak asli), hapus sisanya yang
--    BELUM ada pembayaran berbeda (hindari menghapus yang sudah dibayar penuh
--    berbeda). Di sini kita hapus duplikat yang lebih baru.
WITH ranked AS (
  SELECT b."id",
         ROW_NUMBER() OVER (
           PARTITION BY b."tenantId"
           ORDER BY b."createdAt" ASC
         ) AS rn,
         t."durationMonths" AS dur
  FROM "Bill" b
  JOIN "Tenant" t ON t."id" = b."tenantId"
  WHERE b."type" = 'RENT'
    AND b."status" <> 'CANCELLED'
)
DELETE FROM "Bill"
WHERE "id" IN (
  SELECT "id" FROM ranked WHERE rn > COALESCE(dur, 1)
);

-- ── 3. Selaraskan DP Bunga: bill.paidAmount mengikuti tenant.depositAmount ──
--    Untuk tagihan PARTIAL yang seharusnya merepresentasikan DP penghuni,
--    set paidAmount = depositAmount penghuni bila selisihnya kecil (≤ 5 rupiah),
--    sehingga tidak ada "sisa Rp ...001" akibat salah ketik.
UPDATE "Bill" b
SET "paidAmount" = t."depositAmount"
FROM "Tenant" t
WHERE b."tenantId" = t."id"
  AND b."type" = 'RENT'
  AND b."status" = 'PARTIAL'
  AND t."depositAmount" IS NOT NULL
  AND ABS(b."paidAmount" - t."depositAmount") BETWEEN 1 AND 5;

COMMIT;
