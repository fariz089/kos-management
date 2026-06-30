-- ============================================================================
-- PERBAIKAN JATUH TEMPO (dueDate) TAGIHAN SEWA
-- ----------------------------------------------------------------------------
-- Aturan yang benar:
--   • Tagihan sewa periode PERTAMA  → jatuh tempo = tanggal MASUK (moveInDate).
--       Contoh: masuk 1 Agustus  → wajib lunas 1 Agustus.
--   • Tagihan PERPANJANGAN          → jatuh tempo = tanggal MULAI perpanjangan
--       (sudah benar dibuat oleh endpoint /renew, JANGAN diubah).
--
-- Masalah: data seed lama (deskripsi "Sewa kamar ... — <Bulan> 2026") dan
-- migrasi "Sewa bulan pertama ..." memakai dueDate hard-coded (10 Jun / 4 Agu),
-- tidak mengikuti tanggal masuk. Script ini mengoreksinya.
--
-- Aman dijalankan berulang (idempotent): hanya meng-UPDATE baris yang masih
-- melenceng, dan tidak menyentuh tagihan "Perpanjang".
-- ============================================================================

BEGIN;

-- Koreksi HANYA tagihan sewa periode pertama (BUKAN perpanjangan) yang
-- jatuh temponya berbeda dari tanggal masuk penghuni. Untuk tiap penghuni,
-- "periode pertama" = tagihan RENT dengan createdAt paling awal yang
-- deskripsinya tidak diawali "Perpanjang".
WITH first_period AS (
  SELECT DISTINCT ON (b."tenantId")
         b."id"            AS bill_id,
         t."moveInDate"    AS move_in
    FROM "Bill" b
    JOIN "Tenant" t ON t."id" = b."tenantId"
   WHERE b."type" = 'RENT'
     AND b."status" <> 'CANCELLED'
     AND COALESCE(b."description", '') NOT LIKE 'Perpanjang%'
   ORDER BY b."tenantId", b."createdAt" ASC
)
UPDATE "Bill" b
   SET "dueDate"   = date_trunc('day', fp.move_in),
       "updatedAt" = CURRENT_TIMESTAMP
  FROM first_period fp
 WHERE b."id" = fp.bill_id
   AND date_trunc('day', b."dueDate") <> date_trunc('day', fp.move_in);

COMMIT;

-- ── Verifikasi (jalankan manual bila perlu) ─────────────────────────────────
-- SELECT t."name", t."moveInDate"::date AS masuk, b."dueDate"::date AS jatuh_tempo,
--        b."description"
--   FROM "Bill" b JOIN "Tenant" t ON t."id" = b."tenantId"
--  WHERE b."type" = 'RENT' AND b."status" <> 'CANCELLED'
--  ORDER BY t."name", b."createdAt";