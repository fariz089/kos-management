const PDFDocument = require('pdfkit');
const prisma = require('./prisma');
const { tenantStage } = require('./lifecycle');

const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const tgl = (d) => d ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

// Palet warna sederhana (selaras tema aplikasi)
const C = {
  ink: '#0f172a', sub: '#475569', muted: '#94a3b8', line: '#e2e8f0',
  green: '#059669', greenBg: '#ecfdf5', amber: '#d97706', amberBg: '#fffbeb',
  red: '#dc2626', redBg: '#fef2f2', blue: '#2563eb', blueBg: '#eff6ff',
  slate: '#334155', headBg: '#f1f5f9',
};

const STATUS_LABEL = {
  UNPAID: 'Belum Bayar', PARTIAL: 'Kurang Bayar', PENDING: 'Menunggu',
  PAID: 'Lunas', OVERDUE: 'Terlambat', CANCELLED: 'Batal',
};
const STAGE_LABEL = {
  RESERVED: 'Dipesan', UPCOMING: 'Akan Masuk', ACTIVE: 'Aktif',
  FINISHED: 'Selesai', INACTIVE: 'Non-Aktif',
};

/**
 * Bangun laporan PDF lengkap & mudah dipahami, lalu pipe ke `res`.
 */
async function generateReport(ownerId, res) {
  const now = new Date();
  const today = startOfDay(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const property = await prisma.property.findFirst({ where: { ownerId } });
  const propName = property?.name || 'Kos-Kosan';

  const [rooms, tenants, bills] = await Promise.all([
    prisma.room.findMany({ where: { property: { ownerId } }, orderBy: { number: 'asc' } }),
    prisma.tenant.findMany({
      where: { room: { property: { ownerId } } },
      include: { room: { select: { id: true, number: true } }, bills: { select: { amount: true, paidAmount: true, status: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.bill.findMany({
      where: { room: { property: { ownerId } } },
      include: { tenant: { select: { name: true, moveInDate: true } }, room: { select: { number: true } } },
      orderBy: { dueDate: 'asc' },
    }),
  ]);

  // ── Hitung ringkasan ────────────────────────────────────────
  const stageCount = { RESERVED: 0, UPCOMING: 0, ACTIVE: 0, FINISHED: 0, INACTIVE: 0 };
  for (const t of tenants) stageCount[tenantStage(t, now).stage]++;

  let incomeThisMonth = 0, outstandingTotal = 0, overdueTotal = 0;
  const partial = [], overdue = [];
  for (const b of bills) {
    const paid = b.paidAmount || 0;
    const remaining = Math.max(0, b.amount - paid);
    if (b.paidAt && b.paidAt >= monthStart && b.paidAt <= monthEnd && paid > 0) incomeThisMonth += paid;
    if (b.status !== 'PAID' && b.status !== 'CANCELLED' && remaining > 0) {
      outstandingTotal += remaining;
      if (b.status === 'PARTIAL' || paid > 0) partial.push({ ...b, remaining, paid });
      const movedIn = !b.tenant?.moveInDate || startOfDay(b.tenant.moveInDate) <= today;
      const effDue = b.tenant?.moveInDate && startOfDay(b.tenant.moveInDate) > new Date(b.dueDate)
        ? startOfDay(b.tenant.moveInDate) : new Date(b.dueDate);
      if (movedIn && effDue < now) { overdueTotal += remaining; overdue.push({ ...b, remaining, paid, effDue }); }
    }
  }

  // ── Status kamar DIHITUNG dari lifecycle penghuni (bukan field tersimpan) ──
  // Supaya konsisten dengan Dashboard: kamar Terisi bila ada penghuni Aktif,
  // Dipesan bila ada yang Akan Masuk/Dipesan (belum masuk), selain itu Kosong.
  const roomStage = new Map(); // roomId -> { hasActive, hasUpcoming }
  for (const t of tenants) {
    const rid = t.room?.id;
    if (!rid) continue;
    const st = tenantStage(t, now).stage;
    const cur = roomStage.get(rid) || { hasActive: false, hasUpcoming: false };
    if (st === 'ACTIVE') cur.hasActive = true;
    else if (st === 'UPCOMING' || st === 'RESERVED') cur.hasUpcoming = true;
    roomStage.set(rid, cur);
  }
  let occupied = 0, reserved = 0, available = 0, maintenance = 0;
  for (const r of rooms) {
    if (r.status === 'MAINTENANCE') { maintenance++; continue; }
    const s = roomStage.get(r.id) || {};
    if (s.hasActive) occupied++;
    else if (s.hasUpcoming) reserved++;
    else available++;
  }

  // ── Mulai dokumen ───────────────────────────────────────────
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  doc.pipe(res);

  const PW = doc.page.width;          // 595.28
  const ML = 40, MR = 40;
  const CW = PW - ML - MR;            // content width

  // Helper: header bar judul section
  const sectionTitle = (text) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.6);
    const y = doc.y;
    doc.rect(ML, y, CW, 22).fill(C.headBg);
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(11).text(text, ML + 8, y + 6);
    doc.fillColor(C.ink).font('Helvetica').moveDown(1.2);
  };

  // ── Judul utama ─────────────────────────────────────────────
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(20).text(propName, ML, 40);
  doc.fillColor(C.sub).font('Helvetica').fontSize(10)
    .text('Laporan Kos-Kosan', ML, doc.y + 2);
  doc.fillColor(C.muted).fontSize(9)
    .text(`Dibuat: ${now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} ${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`, ML, doc.y + 2);
  doc.moveTo(ML, doc.y + 8).lineTo(PW - MR, doc.y + 8).strokeColor(C.line).stroke();
  doc.y += 16;

  // ── Kartu ringkasan keuangan ────────────────────────────────
  sectionTitle('Ringkasan');
  const cardW = (CW - 16) / 3;
  const cardY = doc.y;
  const card = (i, label, value, accent, bg) => {
    const x = ML + i * (cardW + 8);
    doc.roundedRect(x, cardY, cardW, 54, 6).fill(bg);
    doc.fillColor(C.sub).font('Helvetica').fontSize(8).text(label, x + 10, cardY + 9, { width: cardW - 20 });
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(13).text(value, x + 10, cardY + 24, { width: cardW - 20 });
  };
  card(0, 'Pemasukan Bulan Ini', rupiah(incomeThisMonth), C.green, C.greenBg);
  card(1, 'Total Kurang Bayar', rupiah(outstandingTotal), C.amber, C.amberBg);
  card(2, 'Jatuh Tempo (menunggak)', rupiah(overdueTotal), C.red, C.redBg);
  doc.y = cardY + 64;

  // Baris status penghuni & kamar
  const line2Y = doc.y;
  const half = (CW - 8) / 2;
  doc.roundedRect(ML, line2Y, half, 60, 6).fill('#f8fafc');
  doc.fillColor(C.slate).font('Helvetica-Bold').fontSize(9).text('Penghuni', ML + 10, line2Y + 8);
  doc.font('Helvetica').fontSize(8.5).fillColor(C.sub).text(
    `Aktif ${stageCount.ACTIVE}  ·  Akan Masuk ${stageCount.UPCOMING}  ·  Dipesan ${stageCount.RESERVED}\nSelesai ${stageCount.FINISHED}  ·  Non-Aktif ${stageCount.INACTIVE}  ·  Total ${tenants.length}`,
    ML + 10, line2Y + 24, { width: half - 20, lineGap: 3 });

  const x2 = ML + half + 8;
  doc.roundedRect(x2, line2Y, half, 60, 6).fill('#f8fafc');
  doc.fillColor(C.slate).font('Helvetica-Bold').fontSize(9).text('Kamar', x2 + 10, line2Y + 8);
  const kamarBooked = reserved; // kamar yang sudah dibooking untuk penghuni yang akan datang
  doc.font('Helvetica').fontSize(8.5).fillColor(C.sub).text(
    `Terisi ${occupied}  ·  Dibooking ${kamarBooked}  ·  Kosong ${available}` +
    (maintenance ? `  ·  Perbaikan ${maintenance}` : '') +
    `\nTotal ${rooms.length} kamar (Dibooking = sudah ada calon penghuni)`,
    x2 + 10, line2Y + 24, { width: half - 20, lineGap: 3 });
  doc.y = line2Y + 70;

  // ── Util tabel generik ──────────────────────────────────────
  function table(cols, rows, opts = {}) {
    const rowH = opts.rowH || 20;
    const headH = 22;
    const drawHead = () => {
      const y = doc.y;
      doc.rect(ML, y, CW, headH).fill(C.headBg);
      doc.fillColor(C.slate).font('Helvetica-Bold').fontSize(8.5);
      let x = ML;
      for (const c of cols) {
        doc.text(c.label, x + 6, y + 7, { width: c.w - 8, align: c.align || 'left' });
        x += c.w;
      }
      doc.y = y + headH;
    };
    drawHead();
    let alt = false;
    for (const r of rows) {
      if (doc.y + rowH > doc.page.height - 50) { doc.addPage(); drawHead(); alt = false; }
      const y = doc.y;
      if (alt) { doc.rect(ML, y, CW, rowH).fill('#fafafa'); }
      alt = !alt;
      let x = ML;
      for (const c of cols) {
        const cell = r[c.key];
        doc.fillColor(c.color ? c.color(r) : C.ink).font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
          .text(cell == null ? '-' : String(cell), x + 6, y + 6, { width: c.w - 8, align: c.align || 'left', lineBreak: false });
        x += c.w;
      }
      doc.strokeColor(C.line).moveTo(ML, y + rowH).lineTo(PW - MR, y + rowH).stroke();
      doc.y = y + rowH;
    }
    doc.fillColor(C.ink);
  }

  // ── Tagihan jatuh tempo (menunggak) ─────────────────────────
  sectionTitle(`Tagihan Jatuh Tempo / Menunggak (${overdue.length})`);
  if (overdue.length === 0) {
    doc.fillColor(C.green).font('Helvetica').fontSize(9).text('Tidak ada tagihan yang menunggak. ', ML + 4);
  } else {
    table([
      { key: 'nama', label: 'Penghuni', w: 150, bold: true },
      { key: 'kamar', label: 'Kamar', w: 70 },
      { key: 'jatuh', label: 'Jatuh Tempo', w: 95 },
      { key: 'sisa', label: 'Sisa', w: CW - 150 - 70 - 95, align: 'right', bold: true, color: () => C.red },
    ], overdue.map(b => ({
      nama: b.tenant?.name || '-', kamar: b.room?.number || '-',
      jatuh: tgl(b.effDue), sisa: rupiah(b.remaining),
    })));
  }

  // ── Kurang bayar (DP masuk, ada sisa) ───────────────────────
  sectionTitle(`Kurang Bayar — DP Masuk, Ada Sisa (${partial.length})`);
  if (partial.length === 0) {
    doc.fillColor(C.green).font('Helvetica').fontSize(9).text('Tidak ada kurang bayar.', ML + 4);
  } else {
    table([
      { key: 'nama', label: 'Penghuni', w: 140, bold: true },
      { key: 'kamar', label: 'Kamar', w: 60 },
      { key: 'total', label: 'Total', w: 95, align: 'right' },
      { key: 'bayar', label: 'Dibayar', w: 95, align: 'right', color: () => C.green },
      { key: 'sisa', label: 'Sisa', w: CW - 140 - 60 - 95 - 95, align: 'right', bold: true, color: () => C.amber },
    ], partial.map(b => ({
      nama: b.tenant?.name || '-', kamar: b.room?.number || '-',
      total: rupiah(b.amount), bayar: rupiah(b.paid), sisa: rupiah(b.remaining),
    })));
  }

  // ── Daftar penghuni ─────────────────────────────────────────
  sectionTitle(`Daftar Penghuni (${tenants.length})`);
  table([
    { key: 'nama', label: 'Nama', w: 150, bold: true },
    { key: 'kamar', label: 'Kamar', w: 55 },
    { key: 'masuk', label: 'Masuk', w: 80 },
    { key: 'keluar', label: 'Keluar', w: 80 },
    { key: 'status', label: 'Status', w: CW - 150 - 55 - 80 - 80, align: 'right',
      color: (r) => r._stage === 'ACTIVE' ? C.green : r._stage === 'FINISHED' ? C.muted : C.amber },
  ], tenants.map(t => {
    const s = tenantStage(t, now);
    return {
      nama: t.name, kamar: t.room?.number || '-',
      masuk: tgl(t.moveInDate), keluar: tgl(t.moveOutDate),
      status: STAGE_LABEL[s.stage] || s.stage, _stage: s.stage,
    };
  }));

  // ── Semua tagihan ───────────────────────────────────────────
  sectionTitle(`Semua Tagihan (${bills.length})`);
  table([
    { key: 'nama', label: 'Penghuni', w: 135, bold: true },
    { key: 'tipe', label: 'Tipe', w: 50 },
    { key: 'jumlah', label: 'Jumlah', w: 90, align: 'right' },
    { key: 'jatuh', label: 'Jatuh Tempo', w: 85 },
    { key: 'status', label: 'Status', w: CW - 135 - 50 - 90 - 85, align: 'right',
      color: (r) => r._st === 'PAID' ? C.green : r._st === 'PARTIAL' ? C.amber : r._st === 'UNPAID' || r._st === 'OVERDUE' ? C.red : C.sub },
  ], bills.map(b => ({
    nama: b.tenant?.name || '-', tipe: b.type,
    jumlah: rupiah(b.amount), jatuh: tgl(b.dueDate),
    status: STATUS_LABEL[b.status] || b.status, _st: b.status,
  })), { rowH: 18 });

  // ── Nomor halaman ───────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fillColor(C.muted).font('Helvetica').fontSize(8)
      .text(`${propName} · Laporan ${tgl(now)}`, ML, doc.page.height - 28, { width: CW / 2 })
      .text(`Halaman ${i + 1} dari ${range.count}`, ML + CW / 2, doc.page.height - 28, { width: CW / 2, align: 'right' });
  }

  doc.end();
}

module.exports = { generateReport };
