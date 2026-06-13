#!/usr/bin/env node
/**
 * Kos Management — MCP Server (SSE Transport)
 *
 * Menggunakan SSEServerTransport agar kompatibel dengan Hermes Agent
 * yang menggunakan MCP protocol lama (tanpa Mcp-Session-Id header).
 *
 * Tools:
 *   - cek_kamar_kosong
 *   - cek_tagihan
 *   - info_kos
 *   - booking_kamar
 *   - reset_link_bayar
 *   - buat_link_bayar
 *   - cek_status_bayar
 *   - log_message
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import { z } from 'zod';

const BACKEND_URL = process.env.BACKEND_API_URL || 'http://backend:4000/api';
const API_KEY = process.env.HERMES_API_KEY || '';
const PORT = parseInt(process.env.MCP_PORT || '3100', 10);

// ─── Backend API helper ──────────────────────────────────────────────
async function callBackend(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
  };
  if (body) options.body = JSON.stringify(body);
  try {
    const res = await fetch(`${BACKEND_URL}/hermes${endpoint}`, options);
    return await res.json();
  } catch (error) {
    return { error: `Backend unavailable: ${error.message}` };
  }
}

// ─── Create MCP Server ───────────────────────────────────────────────
const server = new McpServer({
  name: 'kos-management',
  version: '2.0.0',
});

// Tool: cek_kamar_kosong
server.tool(
  'cek_kamar_kosong',
  'Cek kamar kos yang tersedia beserta harga dan tipe. Panggil saat ada yang tanya kamar kosong.',
  {},
  async () => {
    const result = await callBackend('/available-rooms');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Tool: cek_tagihan
server.tool(
  'cek_tagihan',
  'Cek tagihan belum bayar untuk penghuni berdasarkan nomor WhatsApp (format 628xxx)',
  { phone: z.string().describe('Nomor WhatsApp penghuni, format 628xxx') },
  async ({ phone }) => {
    const result = await callBackend(`/tenant-bills/${phone}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Tool: info_kos
server.tool(
  'info_kos',
  'Lihat info lengkap kos: fasilitas, peraturan, alamat, harga. Panggil saat ada yang tanya info kos.',
  {},
  async () => {
    const result = await callBackend('/property-info');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Tool: booking_kamar
server.tool(
  'booking_kamar',
  'Booking / reservasi kamar untuk calon penghuni baru. Buat tenant baru, ubah status kamar jadi RESERVED, dan buat tagihan bulan pertama.',
  {
    roomId: z.string().describe('ID kamar yang mau dibooking (dari hasil cek_kamar_kosong)'),
    nama: z.string().describe('Nama lengkap calon penghuni'),
    phone: z.string().describe('Nomor WhatsApp calon penghuni, format 628xxx'),
    moveInDate: z.string().optional().describe('Tanggal masuk format YYYY-MM-DD, default hari ini'),
  },
  async ({ roomId, nama, phone, moveInDate }) => {
    const result = await callBackend('/booking-room', 'POST', { roomId, nama, phone, moveInDate });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Tool: reset_link_bayar
server.tool(
  'reset_link_bayar',
  'Reset link pembayaran lama untuk tagihan tertentu agar bisa generate link Midtrans baru.',
  { billId: z.string().describe('ID tagihan yang mau direset link bayarnya') },
  async ({ billId }) => {
    const result = await callBackend('/reset-payment-link', 'POST', { billId });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Tool: buat_link_bayar
server.tool(
  'buat_link_bayar',
  'Buat link pembayaran Midtrans untuk tagihan tertentu.',
  { billId: z.string().describe('ID tagihan yang mau dibayar') },
  async ({ billId }) => {
    const result = await callBackend('/create-payment-link', 'POST', { billId });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Tool: cek_status_bayar
server.tool(
  'cek_status_bayar',
  'Cek apakah tagihan sudah dibayar atau belum. Bisa juga sinkronkan status pembayaran dari Midtrans.',
  { billId: z.string().describe('ID tagihan yang mau dicek statusnya') },
  async ({ billId }) => {
    const result = await callBackend('/check-payment', 'POST', { billId });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Tool: log_message
server.tool(
  'log_message',
  'Log pesan percakapan WhatsApp ke database untuk analytics',
  {
    phone: z.string().describe('Nomor WhatsApp pengirim'),
    direction: z.enum(['INBOUND', 'OUTBOUND']).describe('Arah pesan'),
    content: z.string().describe('Isi pesan'),
  },
  async ({ phone, direction, content }) => {
    const result = await callBackend('/log-message', 'POST', { phone, direction, content });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ─── HTTP Server dengan SSE Transport ───────────────────────────────
// SSEServerTransport kompatibel dengan Hermes (tidak butuh Mcp-Session-Id)
const app = express();
app.use(express.json());

const transports = {};

// SSE endpoint — Hermes connect ke sini untuk terima events
app.get('/mcp', async (req, res) => {
  const transport = new SSEServerTransport('/mcp/messages', res);
  transports[transport.sessionId] = transport;

  transport.onclose = () => {
    delete transports[transport.sessionId];
  };

  await server.connect(transport);
});

// Message endpoint — Hermes kirim tool calls ke sini
app.post('/mcp/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) {
    return res.status(400).json({ error: 'Session not found' });
  }
  await transport.handlePostMessage(req, res, req.body);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', tools: 8, server: 'kos-management-mcp', transport: 'sse' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔧 Kos MCP Server (SSE) running on http://0.0.0.0:${PORT}/mcp`);
  console.log(`   Backend: ${BACKEND_URL}`);
  console.log(`   Transport: SSE (compatible with Hermes)`);
  console.log(`   Tools: cek_kamar_kosong, cek_tagihan, info_kos, booking_kamar, reset_link_bayar, buat_link_bayar, cek_status_bayar, log_message`);
});