-- HOTFIX: tambahkan nilai 'PARTIAL' ke enum BillStatus pada database yang SEDANG berjalan.
-- Jalankan ini SEKALI, lalu restart container backend.
-- Aman/idempotent — tidak menghapus data apa pun.
ALTER TYPE "public"."BillStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';
