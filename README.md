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
3. Di tunnel ini, tambahkan **satu** Published application route saja:
   - Hostname: domain kamu (mis. `kos.j99t.tech`), Path: `*`
   - Service: **`http://nginx:80`**

   **Cukup satu route ini saja.** Tidak perlu route terpisah untuk backend,
   frontend, atau bot — nginx yang membagi traffic ke dalam: `/api/` → backend,
   `/bot/` → halaman bot, `/` → frontend. Cloudflare hanya perlu mengarah ke
   satu pintu (nginx).

   > `http://nginx:80` resolve karena `cloudflared` & `nginx` ada di Docker
   > network yang sama. Kalau di server kamu ada **beberapa** tunnel/cloudflared,
   > pastikan `CLOUDFLARE_TUNNEL_TOKEN` di `.env` adalah token tunnel YANG INI
   > (yang route-nya mengarah ke nginx kos), bukan tunnel project lain.
   > Kalau ganti domain, lihat bagian [Mengganti Domain](#mengganti-domain).

### 4. Set kredensial dashboard bot
Dashboard Hermes (untuk scan QR & lihat status) di-bind ke `0.0.0.0` supaya bisa diakses dari host/nginx. Bind non-loopback ini **otomatis mengaktifkan auth gate** Hermes — jadi kamu WAJIB mengisi kredensial login, kalau tidak container Hermes menolak start dan log-nya loop pesan *"Refusing to bind dashboard to 0.0.0.0..."*.

Di `.env`, isi:
```bash
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=<password-kuat>
DASHBOARD_SECRET=<hasil: openssl rand -base64 32>
```
> `DASHBOARD_SECRET` membuat sesi login tetap valid setelah container restart. Tanpa itu kamu ter-logout tiap kali Hermes restart.

> **Keamanan akses publik:** basic-auth cocok untuk jaringan tepercaya / di belakang reverse proxy. Karena dashboard ini kebuka lewat domain publik, ia mengekspos API key & data sesi ke siapa pun yang berhasil login — pakai password yang benar-benar kuat. Untuk pengamanan lebih, Hermes mendukung OAuth (Nous Portal) via `hermes dashboard register`.

### 5. Nyalakan semua service
```bash
docker compose up -d --build
```
Image Hermes ini memakai supervisor (s6) yang **otomatis** menjalankan gateway WhatsApp + dashboard saat container start — jadi **tidak perlu** menjalankan wizard `docker compose run --rm hermes setup` terpisah. Wizard interaktif itu akan tertimbun output dashboard dan tidak bisa dijawab. Konfigurasi cukup lewat dashboard yang sudah ber-auth (langkah 6).

Cek semua healthy:
```bash
docker compose ps
docker compose logs -f backend     # tunggu "listening on 4000"
docker compose logs -f hermes      # pastikan TIDAK ada loop "Refusing to bind..."
```
Saat pertama kali, backend otomatis menjalankan `prisma db push` lalu `node prisma/seed.js` (lihat [Database & Seed](#database--seed)).

> Kalau log Hermes menampilkan *`Device or resource busy ... config.yaml`*: itu efek versi lama yang me-mount file `config.yaml` tunggal. Compose ini sudah membuangnya — Hermes mengelola config sendiri di volume `hermes_data`.

### 6. Konfigurasi model & MCP, lalu scan QR WhatsApp
1. Buka dashboard bot: `http://<server>:3001` (atau `https://<domain-anda>/bot/`). Login pakai `DASHBOARD_USER` / `DASHBOARD_PASSWORD`.
2. Di dashboard: set **provider LLM** (sesuai `LLM_*` di `.env`) dan pastikan **MCP server `kos`** mengarah ke `http://kos-mcp-server:3100/mcp`. Acuan nilai ada di `hermes/config.yaml` & `hermes/SOUL.md`.
3. Buka tab gateway/WhatsApp untuk menampilkan **QR code**. Atau lihat QR di log:
   ```bash
   docker compose logs -f hermes
   ```
4. Di HP: **WhatsApp → Setelan → Perangkat Tertaut → Tautkan Perangkat** → scan QR.
5. Setelah tertaut, bot langsung aktif. Kirim pesan tes dari nomor lain.

> Sesi WhatsApp tersimpan di volume `hermes_data`, jadi tidak perlu scan ulang setelah restart. Kalau sesi putus (logout/kebanyakan device), ulangi scan QR.

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

Hanya 3 port yang di-expose ke host. Sisanya internal Docker network saja
(menghindari bentrok dengan container lain di server yang sama).

| Service          | Host Port | Internal | Keterangan                          |
|------------------|-----------|----------|-------------------------------------|
| Nginx            | **8080**  | 80       | Reverse proxy — tujuan Cloudflare   |
| Hermes Dashboard | **3001**  | 9119     | Login dashboard & QR scan           |
| Hermes API       | **8642**  | 8642     | OpenAI-compatible API               |
| Backend API      | —         | 4000     | Internal (`backend:4000`)           |
| Frontend         | —         | 80       | Internal (`frontend:80`)            |
| Kos MCP Server   | —         | 3100     | Internal (`kos-mcp-server:3100`)    |
| PostgreSQL       | —         | 5432     | Internal (`db:5432`)                |

> Catatan: frontend, backend, db, dan MCP server **tidak** lagi di-publish ke
> host karena hanya diakses antar-container lewat nama service. Kalau perlu debug
> dari host, tambahkan `ports:` sementara (contoh ada di komentar compose).

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
- **`Bind for 0.0.0.0:XXXX failed: port is already allocated`:** ada container lain di server yang sudah pakai port itu. Cek `docker ps -a`. Service internal (frontend/backend/db/mcp) di compose ini sudah tidak publish port ke host. Kalau yang bentrok port host yang masih dipakai (8080/3001/8642), ganti angka sisi kiri, mis. `"8090:80"`.
- **Hermes loop "Refusing to bind dashboard to 0.0.0.0":** auth gate aktif tapi belum ada provider. Isi `DASHBOARD_USER` + `DASHBOARD_PASSWORD` (+ `DASHBOARD_SECRET`) di `.env`, lalu `docker compose up -d`. Jangan pakai `--insecure` untuk dashboard yang kebuka publik — itu mengekspos API key & data sesi tanpa login.
- **Hermes "Device or resource busy ... config.yaml":** jangan mount file `config.yaml` tunggal ke `/opt/data` (versi compose ini sudah tidak). Hapus mount itu, `docker compose down`, lalu `docker volume rm kos-management_hermes_data` untuk membersihkan state setup yang korup, lalu `up -d` lagi.
- **Bot tidak balas:** cek `docker compose logs -f hermes` — kalau sesi WA logout, scan QR ulang lewat dashboard (port 3001 atau `/bot/`).
- **Tools error / "Backend unavailable":** pastikan `HERMES_API_KEY` sama persis di `.env` (dipakai backend & MCP server), lalu `docker compose restart kos-mcp-server backend`.
- **Link bayar stuck/expired:** bot bisa pakai `reset_link_bayar` lalu `buat_link_bayar`; atau cek `MIDTRANS_*` key benar & mode (sandbox/produksi) sesuai.
- **Domain tidak kebuka:** cek `docker compose logs -f cloudflared` dan Public Hostname tunnel mengarah ke `http://nginx:80`.
