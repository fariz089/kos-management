-- ============================================================
-- MIGRATION: Diskon + DP Fleksibel (bebas nominal) + Cicilan / Kurang Bayar
--
-- Menambah kemampuan:
--   1. Diskon per booking (potong total kontrak ATAU per bulan)
--   2. DP bebas nominal (tidak harus 50%)
--   3. Pelacakan "kurang bayar" — 1 tagihan bisa dibayar sebagian (PARTIAL),
--      sisa kekurangan otomatis terhitung (amount - paidAmount)
--
-- Jalankan SEKALI di database production (aman diulang / idempotent):
--   psql "$DATABASE_URL" -f prisma/migrations/discount_partial_payment.sql
-- atau via docker:
--   docker compose exec -T db psql -U kos_admin -d kos_management < backend/prisma/migrations/discount_partial_payment.sql
-- ============================================================

-- ── 1. Enum BillStatus: tambah nilai PARTIAL (dibayar sebagian) ──
ALTER TYPE "BillStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';

BEGIN;

-- ── 2. Kolom baru di Bill ───────────────────────────────────
-- discount   : potongan rupiah (amount sudah = hargaAsli - discount)
-- paidAmount : total yang sudah dibayar (untuk DP / cicilan)
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "discount"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "paidAmount" INTEGER NOT NULL DEFAULT 0;

-- ── 3. Kolom baru di Tenant (info kontrak & diskon) ─────────
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "durationMonths" INTEGER;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "discountAmount" INTEGER DEFAULT 0;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "discountType"   TEXT;

-- ── 4. Backfill paidAmount untuk tagihan yang sudah ada ─────
-- Tagihan yang sudah PAID dianggap paidAmount = amount (lunas penuh).
UPDATE "Bill" SET "paidAmount" = "amount" WHERE "status" = 'PAID' AND "paidAmount" = 0;

-- ============================================================
-- 5. SINKRONISASI DATA dari buku Excel (kurang bayar / DP / diskon)
--    Memperbaiki 4 kamar yang belum sinkron dengan catatan harian.
-- ============================================================

-- ── 5a. A-06 — Shofiyyah Hana Tahniah ───────────────────────
--   Excel: "KURANG 350 RB, dp 50%". Masuk 20 Juli (promo Tipe D = 700.000).
--   DP 350.000, sisa kurang 350.000. Tagihan RENT lama (700rb, status PAID)
--   dikoreksi jadi PARTIAL dengan paidAmount = 350.000.
UPDATE "Tenant"
   SET "depositAmount" = 350000
 WHERE "id" = 'cmqcswimy0024n21ph4ircvdc';

UPDATE "Bill"
   SET "status" = 'PARTIAL', "paidAmount" = 350000, "paidAt" = NULL,
       "description" = 'Sewa bulan pertama - Kamar A-06 (DP 350.000, kurang 350.000)'
 WHERE "id" = 'cmqcswimz0026n21pdh1dhinv';

-- ── 5b. B-03 — Dhiya Fauziyah Mumtaz ────────────────────────
--   Excel: "KURANG 500 RB, dp 50%". Masuk 1 Agustus (normal Tipe D = 1.000.000).
--   DP 500.000, sisa 500.000. Belum ada tagihan → buat 1 tagihan RENT PARTIAL.
UPDATE "Tenant"
   SET "depositAmount" = 500000
 WHERE "id" = 'cmqs0h64n0003k801s5ydshhr';

INSERT INTO "Bill" ("id","type","amount","discount","paidAmount","dueDate","paidAt","status","description","tenantId","roomId","createdAt","updatedAt","paymentMethod")
SELECT 'bill-sync-b03-rent', 'RENT', 1000000, 0, 500000,
       '2026-08-04 00:00:00', NULL, 'PARTIAL',
       'Sewa bulan pertama - Kamar B-03 (DP 500.000, kurang 500.000)',
       'cmqs0h64n0003k801s5ydshhr', 'cmqcswima0014n21pws42q3sc',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
WHERE NOT EXISTS (SELECT 1 FROM "Bill" WHERE "id" = 'bill-sync-b03-rent');

-- ── 5c. B-06 — Moy (BARU, belum ada di DB) ──────────────────
--   Excel: sewa 6 bulan, diskon 100.000, DP 50%, kurang 2.950.000.
--   Masuk 1 Agustus (normal Tipe D = 1.000.000/bln).
--   Total kotor 6 bln = 6.000.000; diskon 100.000 → net 5.900.000.
--   DP 2.950.000, sisa 2.950.000.
--   Buat: Room→OCCUPIED, Tenant (durasi 6 bln, diskon TOTAL 100rb),
--         1 tagihan RENT senilai net 5.900.000 (discount 100rb), paidAmount 2.950.000.
UPDATE "Room" SET "status" = 'OCCUPIED' WHERE "id" = 'cmqcswimc0018n21pa6t6svh3';

INSERT INTO "Tenant" ("id","name","phone","email","ktpNumber","ktpPhoto","occupation","emergency","moveInDate","moveOutDate","status","roomId","createdAt","updatedAt","depositAmount","depositPaidAt","durationMonths","discountAmount","discountType")
SELECT 'tenant-sync-moy', 'Moy', '6285588153450', NULL, NULL, NULL, NULL, NULL,
       '2026-08-01 00:00:00', '2027-02-01 00:00:00', 'ACTIVE',
       'cmqcswimc0018n21pa6t6svh3', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
       2950000, NULL, 6, 100000, 'TOTAL'
WHERE NOT EXISTS (SELECT 1 FROM "Tenant" WHERE "id" = 'tenant-sync-moy');

INSERT INTO "Bill" ("id","type","amount","discount","paidAmount","dueDate","paidAt","status","description","tenantId","roomId","createdAt","updatedAt","paymentMethod")
SELECT 'bill-sync-moy-rent', 'RENT', 5900000, 100000, 2950000,
       '2026-08-04 00:00:00', NULL, 'PARTIAL',
       'Sewa 6 bulan - Kamar B-06 (diskon 100.000, DP 2.950.000, kurang 2.950.000)',
       'tenant-sync-moy', 'cmqcswimc0018n21pa6t6svh3',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
WHERE NOT EXISTS (SELECT 1 FROM "Bill" WHERE "id" = 'bill-sync-moy-rent');

-- ── 5d. B-11 — Caca (BARU, belum ada di DB) ─────────────────
--   Excel: "KURANG 500 RB, dp 50%". Masuk 1 Agustus (normal Tipe D = 1.000.000).
--   DP 500.000, sisa 500.000.
UPDATE "Room" SET "status" = 'OCCUPIED' WHERE "id" = 'cmqcswimi001in21p97bvahaj';

INSERT INTO "Tenant" ("id","name","phone","email","ktpNumber","ktpPhoto","occupation","emergency","moveInDate","moveOutDate","status","roomId","createdAt","updatedAt","depositAmount","depositPaidAt","durationMonths","discountAmount","discountType")
SELECT 'tenant-sync-caca', 'Caca', '6281275901946', NULL, NULL, NULL, NULL, NULL,
       '2026-08-01 00:00:00', '2026-09-01 00:00:00', 'ACTIVE',
       'cmqcswimi001in21p97bvahaj', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
       500000, NULL, 1, 0, NULL
WHERE NOT EXISTS (SELECT 1 FROM "Tenant" WHERE "id" = 'tenant-sync-caca');

INSERT INTO "Bill" ("id","type","amount","discount","paidAmount","dueDate","paidAt","status","description","tenantId","roomId","createdAt","updatedAt","paymentMethod")
SELECT 'bill-sync-caca-rent', 'RENT', 1000000, 0, 500000,
       '2026-08-04 00:00:00', NULL, 'PARTIAL',
       'Sewa bulan pertama - Kamar B-11 (DP 500.000, kurang 500.000)',
       'tenant-sync-caca', 'cmqcswimi001in21p97bvahaj',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
WHERE NOT EXISTS (SELECT 1 FROM "Bill" WHERE "id" = 'bill-sync-caca-rent');

COMMIT;

-- ── Verifikasi (jalankan manual kalau mau cek) ──────────────
-- SELECT r."number", t."name", t."depositAmount", t."discountAmount", t."discountType",
--        b."amount", b."discount", b."paidAmount", (b."amount"-b."paidAmount") AS kurang, b."status"
-- FROM "Bill" b
--   JOIN "Tenant" t ON b."tenantId"=t."id"
--   JOIN "Room" r   ON b."roomId"=r."id"
-- WHERE b."status"='PARTIAL'
-- ORDER BY r."number";
