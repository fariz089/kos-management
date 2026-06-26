-- ============================================================
-- MIGRATION: Harga Dinamis (Tipe A/B/C/D) + DP + Pembayaran Manual
-- Jalankan SEKALI di database production.
--
-- Cara pakai (dari folder backend):
--   psql "$DATABASE_URL" -f prisma/migrations/manual_pricing_deposit.sql
-- atau via docker:
--   docker compose exec -T db psql -U <DB_USER> -d <DB_NAME> < backend/prisma/migrations/manual_pricing_deposit.sql
--
-- Aman dijalankan ulang (idempotent) — pakai IF NOT EXISTS / ON CONFLICT.
-- ============================================================

-- ── 1. Enum BillType: tambah nilai DEPOSIT ──────────────────
-- (di luar transaksi — PostgreSQL tidak mengizinkan pemakaian nilai enum baru
--  di transaksi yang sama saat nilai itu ditambahkan)
ALTER TYPE "BillType" ADD VALUE IF NOT EXISTS 'DEPOSIT';

BEGIN;

-- ── 2. Kolom baru di Tenant (DP / uang muka) ────────────────
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "depositAmount" INTEGER;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "depositPaidAt" TIMESTAMP(3);

-- ── 3. Kolom baru di Bill (cara bayar manual) ───────────────
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;

-- ── 4. Kolom tier di Room ───────────────────────────────────
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "tierId" TEXT;

-- ── 5. Tabel PricingTier ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PricingTier" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "description" TEXT,
  "propertyId"  TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PricingTier_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PricingTier_code_key" ON "PricingTier"("code");

-- ── 6. Tabel PricingRule ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PricingRule" (
  "id"        TEXT NOT NULL,
  "tierId"    TEXT NOT NULL,
  "price"     INTEGER NOT NULL,
  "startDate" TIMESTAMP(3),
  "endDate"   TIMESTAMP(3),
  "label"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PricingRule_tierId_idx" ON "PricingRule"("tierId");

-- ── 7. Foreign keys (skip kalau sudah ada) ──────────────────
DO $$ BEGIN
  ALTER TABLE "PricingTier"
    ADD CONSTRAINT "PricingTier_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PricingRule"
    ADD CONSTRAINT "PricingRule_tierId_fkey"
    FOREIGN KEY ("tierId") REFERENCES "PricingTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Room"
    ADD CONSTRAINT "Room_tierId_fkey"
    FOREIGN KEY ("tierId") REFERENCES "PricingTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 8. SEED DATA — Tipe A/B/C/D + aturan harga + mapping kamar
--    Property: prop-andhata-001
-- ============================================================

-- 8a. Buat 4 tier (idempotent via code unik)
INSERT INTO "PricingTier" ("id","name","code","description","propertyId","createdAt","updatedAt") VALUES
  ('tier-andhata-A','Tipe A','A','Kamar tipe A','prop-andhata-001',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tier-andhata-B','Tipe B','B','Kamar tipe B','prop-andhata-001',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tier-andhata-C','Tipe C','C','Kamar tipe C','prop-andhata-001',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tier-andhata-D','Tipe D','D','Kamar tipe D','prop-andhata-001',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- 8b. Aturan harga. Periode berdasarkan TANGGAL MASUK penghuni.
--     Promo: 1 Jun 2026 – 31 Jul 2026.  Normal: mulai 1 Agt 2026 (endDate null = seterusnya).
--     Hapus dulu rule lama untuk tier ini agar tidak dobel kalau dijalankan ulang.
DELETE FROM "PricingRule" WHERE "tierId" IN ('tier-andhata-A','tier-andhata-B','tier-andhata-C','tier-andhata-D');

INSERT INTO "PricingRule" ("id","tierId","price","startDate","endDate","label","createdAt","updatedAt") VALUES
  -- Tipe A
  ('rule-A-promo','tier-andhata-A',1600000,'2026-06-01 00:00:00','2026-07-31 23:59:59','Promo Juni-Juli',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('rule-A-normal','tier-andhata-A',2000000,'2026-08-01 00:00:00',NULL,'Harga Normal',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  -- Tipe B
  ('rule-B-promo','tier-andhata-B',1100000,'2026-06-01 00:00:00','2026-07-31 23:59:59','Promo Juni-Juli',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('rule-B-normal','tier-andhata-B',1400000,'2026-08-01 00:00:00',NULL,'Harga Normal',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  -- Tipe C
  ('rule-C-promo','tier-andhata-C',800000,'2026-06-01 00:00:00','2026-07-31 23:59:59','Promo Juni-Juli',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('rule-C-normal','tier-andhata-C',1300000,'2026-08-01 00:00:00',NULL,'Harga Normal',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  -- Tipe D
  ('rule-D-promo','tier-andhata-D',700000,'2026-06-01 00:00:00','2026-07-31 23:59:59','Promo Juni-Juli',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('rule-D-normal','tier-andhata-D',1000000,'2026-08-01 00:00:00',NULL,'Harga Normal',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

-- 8c. Map kamar ke tier (berdasarkan nomor kamar)
-- Tipe A (1): A-10
UPDATE "Room" SET "tierId"='tier-andhata-A' WHERE "propertyId"='prop-andhata-001' AND "number" IN ('A-10');
-- Tipe B (6): A-02, A-04, A-07, A-09, B-02, B-07
UPDATE "Room" SET "tierId"='tier-andhata-B' WHERE "propertyId"='prop-andhata-001' AND "number" IN ('A-02','A-04','A-07','A-09','B-02','B-07');
-- Tipe C (3): A-03, B-04, B-10
UPDATE "Room" SET "tierId"='tier-andhata-C' WHERE "propertyId"='prop-andhata-001' AND "number" IN ('A-03','B-04','B-10');
-- Tipe D (10): A-01, A-05, A-06, A-08, B-01, B-03, B-06, B-08, B-09, B-11
UPDATE "Room" SET "tierId"='tier-andhata-D' WHERE "propertyId"='prop-andhata-001' AND "number" IN ('A-01','A-05','A-06','A-08','B-01','B-03','B-06','B-08','B-09','B-11');

-- 8d. Set kolom Room.price ke harga NORMAL (jangka panjang) sebagai fallback.
--     PENTING: jangan pakai harga promo di sini, karena Room.price adalah nilai
--     statis yang dipakai sebagai fallback. Harga sebenarnya tetap dihitung dinamis
--     (date-aware) berdasarkan tanggal masuk penghuni saat booking/generate tagihan
--     dan saat ditampilkan di kartu kamar.
--     Harga normal = rule yang startDate-nya paling akhir / tanpa endDate.
UPDATE "Room" r
SET "price" = pr."price"
FROM "PricingRule" pr
WHERE r."tierId" = pr."tierId"
  AND pr."endDate" IS NULL;  -- rule "Harga Normal" (berlaku seterusnya)

COMMIT;

-- ── Verifikasi (jalankan manual kalau mau cek) ──────────────
-- SELECT t."code", r."number", r."price"
-- FROM "Room" r JOIN "PricingTier" t ON r."tierId"=t."id"
-- ORDER BY t."code", r."number";
