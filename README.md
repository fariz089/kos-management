# Andhata Boarding House — Kos Management System

Sistem manajemen kos-kosan lengkap: dashboard web, pembayaran online (Midtrans), dan **AI WhatsApp bot** powered by [Hermes Agent](https://hermes-agent.nousresearch.com/) dari NousResearch.

- **Kos:** Andhata Boarding House (20 kamar)
- **Alamat:** Jl. Dieng Atas Gg. Praja No.RT.001, RW.003, Kunci, Kalisongo, Kec. Dau, Kabupaten Malang, Jawa Timur 65151
- **Kontak:** +62 813-2648-6485

---

## Arsitektur

```
┌─────────────────────────────────────────────────────┐
│  Cloudflare Tunnel (kos.j99t.tech)                  │
└──────────────┬──────────────────────────────────────┘
               │
        ┌──────▼──────┐
        │    Nginx    │  (port 8080 → 80)
        └──┬───┬───┬──┘
           │   │   │
     /api/ │   │   │ /bot/
           │   │   │
   ┌───────▼┐  │  ┌▼──────────────────┐
   │Backend │  │  │ Hermes Agent      │
   │Express │  │  │ (NousResearch)    │
   │+Prisma │  │  │ WhatsApp Gateway  │
   └───┬────┘  │  │ + Dashboard       │
       │       │  └────────┬──────────┘
   ┌───▼─────┐ │           │ MCP (HTTP)
   │PostgreSQL│ │  ┌────────▼──────────┐
   └─────────┘ │  │ Kos MCP Server    │
               │  │ (tools → Backend) │
        ┌──────▼┐ └───────────────────┘
        │Frontend│
        │React+  │
        │Vite    │
        └────────┘
```

Komponen (semua via `docker compose`): `db` (Postgres), `backend`, `frontend`, `nginx`, `cloudflared` (Cloudflare Tunnel), `kos-mcp-server`, `hermes`.

---

## Prasyarat Server

- Docker Engine + Docker Compose plugin (`docker compose`, bukan `docker-compose`)
- Domain + Cloudflare Tunnel (untuk akses publik HTTPS)
- Akun [Midtrans](https://dashboard.midtrans.com) (pembayaran)
- Sebuah nomor WhatsApp khusus untuk bot (akan discan via QR)
- API key LLM yang OpenAI-compatible (OpenRouter / OpenAI / Gemini / dll)

---

## Setup dari Nol (Deploy ke Server Baru)

### 1. Clone & masuk folder
```bash
git clone <repo-anda> kos-management
cd kos-management
```

### 2. Buat file `.env`
```bash
cp .env.example .env
```
Lalu edit `.env` dan isi semua nilai. Lihat tabel [Environment Variables](#environment-variables) di bawah.

Generate secret acak untuk `JWT_SECRET` dan `HERMES_API_KEY`:
```bash
openssl rand -hex 32   # jalankan dua kali, pakai untuk JWT_SECRET & HERMES_API_KEY
```

### 3. Cloudflare Tunnel
1. Buka https://one.dash.cloudflare.com → **Networks → Tunnels → Create a tunnel**
2. Pilih **Cloudflared**, beri nama, copy **token** → tempel ke `CLOUDFLARE_TUNNEL_TOKEN` di `.env`
3. Di bagian **Public Hostnames** tunnel, arahkan domain kamu (mis. `kos.j99t.tech`) ke service **`http://nginx:80`** (atau `http://localhost:8080` kalau cloudflared jalan di host).
   > Catatan: domain saat ini di-hardcode `kos.j99t.tech` di beberapa file. Kalau ganti domain, lihat bagian [Mengganti Domain](#mengganti-domain).

### 4. Setup awal Hermes (registrasi WhatsApp & config)
Hermes butuh inisialisasi sekali sebelum jalan sebagai gateway. Jalankan:
```bash
docker compose run --rm hermes setup
```
Ikuti wizard-nya (pilih provider LLM, dll). Config tersimpan di volume `hermes_data` + file `hermes/config.yaml` yang sudah termount.

> `hermes/config.yaml` sudah disiapkan untuk kos ini (model provider, MCP server `kos`, bahasa `id`, timezone `Asia/Jakarta`). Personality & alur bot ada di `hermes/SOUL.md`.

### 5. Nyalakan semua service
```bash
docker compose up -d --build
```
Cek semua healthy:
```bash
docker compose ps
docker compose logs -f backend     # tunggu "listening on 4000"
```
Saat pertama kali, backend otomatis menjalankan `prisma db push` lalu `node prisma/seed.js` (lihat [Database & Seed](#database--seed)).

### 6. Scan QR WhatsApp (aktivasi bot)
1. Buka dashboard bot: `https://<domain-anda>/bot/` (atau lokal `http://localhost:8080/bot/`)
2. Untuk QR scan langsung Hermes: buka dashboard Hermes di `http://<server>:3001` (port 3001 → Hermes dashboard 9119).
   Atau cek log untuk QR di terminal:
   ```bash
   docker compose logs -f hermes
   ```
3. Di HP: **WhatsApp → Setelan → Perangkat Tertaut → Tautkan Perangkat** → scan QR.
4. Setelah tertaut, bot langsung aktif menerima & membalas chat. Kirim pesan tes dari nomor lain.

> WhatsApp pakai sesi multi-device. Sesi tersimpan di volume `hermes_data`, jadi tidak perlu scan ulang setelah restart container. Kalau sesi putus (logout/kebanyakan device), ulangi scan QR.

---

## Environment Variables

Semua di file `.env` (root project). Jangan commit file ini.

| Variable | Keterangan |
|---|---|
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Kredensial PostgreSQL |
| `JWT_SECRET` | Secret untuk token login dashboard (64 hex, `openssl rand -hex 32`) |
| `BASE_URL` | URL publik, dipakai callback Midtrans (mis. `https://kos.j99t.tech`) |
| `MIDTRANS_SERVER_KEY` / `MIDTRANS_CLIENT_KEY` | Dari dashboard Midtrans |
| `MIDTRANS_IS_PRODUCTION` | `false` = sandbox, `true` = produksi |
| `HERMES_API_KEY` | Secret bersama antara backend, MCP server, & Hermes |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | Provider LLM OpenAI-compatible untuk bot |
| `CLOUDFLARE_TUNNEL_TOKEN` | Token tunnel dari Cloudflare |
| `SEED_ADMIN_PASSWORD` | (opsional) password admin awal saat seed; default `admin123` |

Contoh konfigurasi LLM untuk berbagai provider ada di komentar `.env.example`.

> **Penting soal keamanan:** Sebelum produksi, ganti `DB_PASSWORD`, `JWT_SECRET`, `HERMES_API_KEY`, dan login admin default. Jangan pakai nilai contoh apa adanya. Set `MIDTRANS_IS_PRODUCTION=true` hanya saat sudah pakai key produksi Midtrans.

---

## Database & Seed

Saat container backend pertama kali start, ia menjalankan (lihat `backend/Dockerfile`):
```
npx prisma db push --accept-data-loss   # buat/update skema
node prisma/seed.js                      # isi data awal (idempotent)
node src/index.js                        # start API
```

`prisma/seed.js` sudah berisi **data asli Andhata Boarding House** (20 kamar, 11 terisi, 9 kosong, lengkap dengan tipe & harga) — bukan lagi data dummy. Seed bersifat idempotent: kalau admin sudah ada, seed di-skip.

Re-seed manual (mis. setelah reset DB):
```bash
docker compose exec backend node prisma/seed.js
```

Reset total database (HATI-HATI, hapus semua data):
```bash
docker compose down
docker volume rm $(docker compose config --volumes | grep pgdata) 2>/dev/null || docker volume rm kos-management_pgdata
docker compose up -d
```

Inspeksi data via Prisma Studio:
```bash
docker compose exec backend npx prisma studio
```

Login dashboard default: `admin@andhata.kos` / `admin123` (ganti segera).

---

## Services & Ports

| Service          | Port | Keterangan              |
|------------------|------|-------------------------|
| Nginx            | 8080 | Reverse proxy (public)  |
| Backend API      | 4000 | REST API                |
| Frontend         | 3000 | React SPA               |
| Hermes Dashboard | 3001 | Bot dashboard & QR scan |
| Hermes API       | 8642 | OpenAI-compatible API   |
| Kos MCP Server   | 3100 | MCP tools (internal)    |
| PostgreSQL       | 5432 | Database                |

---

## WhatsApp Bot Tools (MCP)

MCP server (`hermes/mcp-server`) mengekspos backend sebagai tools untuk bot:

| Tool                | Fungsi                                              |
|---------------------|-----------------------------------------------------|
| `cek_kamar_kosong`  | Cek kamar tersedia + harga                          |
| `cek_tagihan`       | Cek tagihan penghuni (sudah & belum bayar) via no WA|
| `cek_status_bayar`  | Cek/sinkronkan status satu tagihan (via Midtrans)   |
| `info_kos`          | Info lengkap kos (fasilitas, aturan, alamat, harga) |
| `booking_kamar`     | Booking kamar untuk calon penghuni baru             |
| `reset_link_bayar`  | Reset link bayar lama yang expired/stuck            |
| `buat_link_bayar`   | Generate link pembayaran Midtrans                   |
| `log_message`       | Catat percakapan ke database                        |

Personality, alur booking, dan aturan bot diatur di `hermes/SOUL.md`.

---

## Mengganti Model LLM
```bash
# Lewat wizard Hermes:
docker compose exec hermes hermes model

# Atau edit LLM_BASE_URL / LLM_API_KEY / LLM_MODEL di .env, lalu:
docker compose restart hermes
```

## Mengganti Domain
Domain `kos.j99t.tech` muncul di: `.env` (`BASE_URL`), `docker-compose.yml` (env `BASE_URL` backend), dan `nginx/default.conf` (`server_name`). Ganti di ketiganya, lalu update Public Hostname di Cloudflare Tunnel, lalu `docker compose up -d --build`.

---

## Maintenance
```bash
docker compose logs -f hermes          # Logs bot
docker compose logs -f kos-mcp-server  # Logs MCP
docker compose restart hermes          # Restart bot
docker compose pull hermes             # Update image Hermes
docker compose exec hermes hermes doctor   # Diagnostics
curl http://localhost:3100/health      # MCP health
curl http://localhost:4000/api/health  # Backend health
```

### Troubleshooting cepat
- **Bot tidak balas:** cek `docker compose logs -f hermes` — kalau sesi WA logout, scan QR ulang lewat dashboard (`/bot/` atau port 3001).
- **Tools error / "Backend unavailable":** pastikan `HERMES_API_KEY` sama persis di `.env` (dipakai backend & MCP server), lalu `docker compose restart kos-mcp-server backend`.
- **Link bayar stuck/expired:** bot bisa pakai `reset_link_bayar` lalu `buat_link_bayar`; atau cek `MIDTRANS_*` key benar & mode (sandbox/produksi) sesuai.
- **Domain tidak kebuka:** cek `docker compose logs -f cloudflared` dan Public Hostname tunnel mengarah ke `http://nginx:80`.
