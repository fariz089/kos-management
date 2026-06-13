# Kos Management System

Sistem manajemen kos-kosan lengkap dengan dashboard web, pembayaran online (Midtrans), dan **AI WhatsApp bot** powered by [Hermes Agent](https://hermes-agent.nousresearch.com/) dari NousResearch.

## Arsitektur

```
┌─────────────────────────────────────────────────────┐
│  Cloudflare Tunnel (kos.j99t.tech)                  │
└──────────────┬──────────────────────────────────────┘
               │
        ┌──────▼──────┐
        │    Nginx    │
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
   ┌───▼────┐  │           │ MCP (HTTP)
   │PostgreSQL│ │  ┌────────▼──────────┐
   └────────┘  │  │ Kos MCP Server    │
               │  │ (tools → Backend) │
        ┌──────▼┐ └───────────────────┘
        │Frontend│
        │React+  │
        │Vite    │
        └────────┘
```

## Quick Start

### 1. Configure
```bash
cp .env.example .env
# Edit .env — isi semua API keys
```

### 2. Setup Hermes Agent
```bash
bash hermes/setup-hermes.sh
```

### 3. Start Everything
```bash
docker compose up -d
```

### 4. Setup WhatsApp
1. Buka dashboard: `https://kos.j99t.tech/bot/`
2. Scan QR code dengan WhatsApp di HP
3. Bot siap menerima pesan!

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

## WhatsApp Bot Tools (MCP)

| Tool               | Fungsi                                    |
|--------------------|-------------------------------------------|
| `cek_kamar_kosong` | Cek kamar tersedia + harga                |
| `cek_tagihan`      | Cek tagihan penghuni via nomor WA         |
| `info_kos`         | Info lengkap kos (fasilitas, aturan, dll) |
| `buat_link_bayar`  | Generate link pembayaran Midtrans         |
| `log_message`      | Catat percakapan ke database              |

## Mengganti Model LLM
```bash
docker exec -it kos-hermes hermes model
# Atau edit LLM_API_KEY dan LLM_MODEL di .env, lalu:
docker compose restart hermes
```

## Maintenance
```bash
docker compose logs -f hermes          # Logs bot
docker compose logs -f kos-mcp-server  # Logs MCP
docker compose restart hermes          # Restart bot
docker compose pull hermes             # Update image
docker exec -it kos-hermes hermes doctor  # Diagnostics
curl http://localhost:3100/health      # MCP health
```
