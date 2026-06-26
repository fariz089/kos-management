-- ============================================================
-- FIX: Perbaiki kolom Room.price agar tidak menampilkan harga promo
--
-- KENAPA: Migrasi pertama keliru men-set Room.price ke harga AKTIF hari ini.
-- Karena sekarang bulan Juni (periode promo), semua kamar jadi kelihatan harga
-- promo — termasuk kamar yang penghuninya masuk Agustus (harusnya harga normal).
--
-- Room.price hanyalah nilai fallback statis. Harga sebenarnya selalu dihitung
-- dinamis berdasarkan tanggal masuk penghuni. File ini meng-set Room.price ke
-- harga NORMAL (jangka panjang) supaya fallback-nya benar.
--
-- Jalankan SEKALI:
--   docker compose exec -T db psql -U kos_admin -d kos_management < backend/prisma/migrations/fix_room_price_to_normal.sql
-- ============================================================

BEGIN;

UPDATE "Room" r
SET "price" = pr."price"
FROM "PricingRule" pr
WHERE r."tierId" = pr."tierId"
  AND pr."endDate" IS NULL;  -- ambil rule "Harga Normal" (berlaku seterusnya)

COMMIT;

-- Cek hasil:
-- SELECT t."code", r."number", r."price"
-- FROM "Room" r JOIN "PricingTier" t ON r."tierId" = t."id"
-- ORDER BY t."code", r."number";
--
-- Harusnya: A=2.000.000  B=1.400.000  C=1.300.000  D=1.000.000
