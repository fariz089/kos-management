#!/usr/bin/env node
/**
 * Kos Management — MCP Server (Streamable HTTP)
 *
 * Tools:
 *   - cek_kamar_kosong
 *   - cek_tagihan
 *   - info_kos
 *   - booking_kamar  ← NEW
 *   - buat_link_bayar
 *   - log_message
 *
 * Runs on port 3100 inside Docker.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
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
  'Booking / reservasi kamar untuk calon penghuni baru. Buat tenant baru, ubah status kamar jadi RESERVED, dan buat tagihan bulan pertama. Panggil setelah calon penghuni konfirmasi mau kamar tertentu.',
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
  'Reset link pembayaran lama untuk tagihan tertentu agar bisa generate link Midtrans baru. Panggil ini dulu kalau buat_link_bayar selalu return link yang sama / sudah expired.',
  { billId: z.string().describe('ID tagihan yang mau direset link bayarnya') },
  async ({ billId }) => {
    const result = await callBackend('/reset-payment-link', 'POST', { billId });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Tool: buat_link_bayar
server.tool(
  'buat_link_bayar',
  'Buat link pembayaran Midtrans untuk tagihan tertentu. Panggil setelah booking berhasil atau saat penghuni mau bayar tagihan.',
  { billId: z.string().describe('ID tagihan yang mau dibayar') },
  async ({ billId }) => {
    const result = await callBackend('/create-payment-link', 'POST', { billId });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Tool: cek_status_bayar
server.tool(
  'cek_status_bayar',
  'Cek apakah tagihan sudah dibayar atau belum. Bisa juga sinkronkan status pembayaran dari Midtrans. SELALU panggil ini kalau penghuni tanya sudah bayar atau belum, atau saat ingin konfirmasi status pembayaran.',
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

// ─── HTTP Server with Streamable HTTP transport ──────────────────────
const app = express();
app.use(express.json());

const transports = {};

app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] || 'default';
  let transport = transports[sessionId];
  if (!transport) {
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId });
    transports[sessionId] = transport;
    await server.connect(transport);
  }
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] || 'default';
  let transport = transports[sessionId];
  if (!transport) {
    // Auto-create session for clients that do GET first (e.g. Hermes initial connect)
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId });
    transports[sessionId] = transport;
    await server.connect(transport);
  }
  await transport.handleRequest(req, res);
});

app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] || 'default';
  const transport = transports[sessionId];
  if (transport) {
    await transport.close();
    delete transports[sessionId];
  }
  res.status(200).json({ ok: true });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', tools: 7, server: 'kos-management-mcp' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔧 Kos MCP Server running on http://0.0.0.0:${PORT}/mcp`);
  console.log(`   Backend: ${BACKEND_URL}`);
  console.log(`   Tools: cek_kamar_kosong, cek_tagihan, info_kos, booking_kamar, reset_link_bayar, buat_link_bayar, log_message`);
});