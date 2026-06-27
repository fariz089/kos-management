-- ============================================================
-- MIGRATION: Tambah penghuni Lana Malika (A-04, DP 550.000)
--
-- Kasus: 1 kamar dipakai beberapa orang di periode berbeda.
--   A-04 sebelumnya dihuni Aurelia Chang (keluar 28 Jun 2026).
--   Lana Malika masuk 20 Jul 2026 s/d 20 Agt 2026, bayar DP Rp 550.000.
--
-- Karena tanggal masuk masih di masa depan & masih ada sisa bayar,
-- status terhitung otomatis = "Dipesan" (RESERVED), bukan "Aktif".
--
-- Jalankan SEKALI (aman diulang / idempotent):
--   docker compose exec -T db psql -U kos_admin -d kos_management < backend/prisma/migrations/add_lana_malika.sql
-- (ganti kos_admin / kos_management sesuai .env kamu)
-- ============================================================

BEGIN;

-- Hanya insert kalau Lana (by phone) belum ada — idempotent.
DO $$
DECLARE
  v_room_id   TEXT;
  v_price     INTEGER;
  v_tenant_id TEXT;
  v_bill_id   TEXT;
  v_dp        INTEGER := 550000;
  v_total     INTEGER;
  v_sisa      INTEGER;
  v_movein    TIMESTAMP := '2026-07-20 00:00:00';
  v_moveout   TIMESTAMP := '2026-08-20 00:00:00';
  v_due       TIMESTAMP := '2026-07-23 00:00:00';
BEGIN
  -- Lewati kalau sudah ada (cek nomor HP, dengan/atau tanpa awalan 62)
  IF EXISTS (
    SELECT 1 FROM "Tenant"
    WHERE phone IN ('6281113802605', '081113802605', '81113802605')
  ) THEN
    RAISE NOTICE 'Lana Malika sudah ada — dilewati.';
    RETURN;
  END IF;

  -- Ambil kamar A-04 (room id + harga)
  SELECT id, price INTO v_room_id, v_price
  FROM "Room" WHERE number = 'A-04' LIMIT 1;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Kamar A-04 tidak ditemukan.';
  END IF;

  v_total := v_price;                       -- sewa 1 bulan
  v_sisa  := GREATEST(0, v_total - v_dp);

  -- ID unik (gaya cuid-ish, cukup untuk PK TEXT)
  v_tenant_id := 'tenant-lana-' || substr(md5(random()::text), 1, 12);
  v_bill_id   := 'bill-lana-'   || substr(md5(random()::text), 1, 12);

  -- Penghuni — status PENDING (masih ada sisa); helper memetakan jadi "Dipesan".
  INSERT INTO "Tenant" (
    id, name, phone, "moveInDate", "moveOutDate",
    "depositAmount", "depositPaidAt", "durationMonths",
    status, "roomId", "createdAt", "updatedAt"
  ) VALUES (
    v_tenant_id, 'Lana Malika', '6281113802605', v_movein, v_moveout,
    v_dp, CURRENT_TIMESTAMP, 1,
    'PENDING', v_room_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

  -- Tagihan sewa — DP 550rb sebagai pembayaran sebagian (PARTIAL).
  INSERT INTO "Bill" (
    id, type, amount, discount, "paidAmount", "dueDate",
    status, description, "tenantId", "roomId", "createdAt", "updatedAt"
  ) VALUES (
    v_bill_id, 'RENT', v_total, 0, v_dp, v_due,
    'PARTIAL',
    'Sewa kamar A-04 — DP Rp ' || to_char(v_dp, 'FM999G999G999') ||
      ', sisa Rp ' || to_char(v_sisa, 'FM999G999G999'),
    v_tenant_id, v_room_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

  -- Tandai kamar A-04 sebagai RESERVED (dipesan untuk Lana, periode depan).
  -- Hanya jika sekarang AVAILABLE (jangan timpa kalau masih OCCUPIED penghuni lain).
  UPDATE "Room" SET status = 'RESERVED'
  WHERE id = v_room_id AND status = 'AVAILABLE';

  RAISE NOTICE 'Lana Malika ditambahkan: DP % / total % / sisa %', v_dp, v_total, v_sisa;
END $$;

COMMIT;
