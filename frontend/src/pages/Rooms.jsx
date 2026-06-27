import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Pencil, Trash2, X, Loader2, DoorOpen, LayoutGrid, CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';

const ROOM_TYPES = ['STANDARD', 'DELUXE', 'SUITE'];
const STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'];
const STATUS_LABELS = { AVAILABLE: 'Kosong', OCCUPIED: 'Terisi', RESERVED: 'Dipesan', MAINTENANCE: 'Perbaikan' };
const STATUS_COLORS = {
  AVAILABLE: 'bg-emerald-100 text-emerald-700',
  OCCUPIED: 'bg-blue-100 text-blue-700',
  RESERVED: 'bg-purple-100 text-purple-700',
  MAINTENANCE: 'bg-amber-100 text-amber-700',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const empty = { number: '', floor: 1, type: 'STANDARD', price: '', facilities: '', status: 'AVAILABLE' };

// Warna bar penghuni (diputar berdasarkan urutan agar antar penghuni di kamar sama tetap beda)
const TENANT_BARS = [
  { active: 'bg-blue-500', pending: 'bg-purple-400', text: 'text-white' },
  { active: 'bg-teal-500', pending: 'bg-amber-400', text: 'text-white' },
  { active: 'bg-indigo-500', pending: 'bg-pink-400', text: 'text-white' },
  { active: 'bg-cyan-600', pending: 'bg-rose-400', text: 'text-white' },
];

export default function Rooms() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(empty);
  const [filter, setFilter] = useState('ALL');
  const [view, setView] = useState('cards'); // 'cards' | 'calendar'
  const [year, setYear] = useState(new Date().getFullYear());

  const { data: rooms = [], isLoading } = useQuery({
    queryKey: ['rooms'],
    queryFn: () => api.get('/rooms'),
  });

  const { data: occ, isLoading: occLoading } = useQuery({
    queryKey: ['occupancy', year],
    queryFn: () => api.get(`/rooms/occupancy/calendar?year=${year}`),
    enabled: view === 'calendar',
  });

  const save = useMutation({
    mutationFn: (d) => modal === 'add' ? api.post('/rooms', d) : api.put(`/rooms/${modal.id}`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rooms'] }); setModal(null); },
  });

  const del = useMutation({
    mutationFn: (id) => api.del(`/rooms/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rooms'] }),
  });

  const openAdd = () => { setForm(empty); setModal('add'); };
  const openEdit = (r) => {
    setForm({ number: r.number, floor: r.floor, type: r.type, price: r.price, facilities: (r.facilities || []).join(', '), status: r.status });
    setModal(r);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const body = { ...form, price: Number(form.price), floor: Number(form.floor), facilities: form.facilities ? form.facilities.split(',').map(s => s.trim()).filter(Boolean) : [] };
    save.mutate(body);
  };

  const filtered = filter === 'ALL' ? rooms : rooms.filter(r => r.status === filter);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Kamar</h1>
          <p className="text-slate-500 text-sm mt-1">Kelola semua kamar kos</p>
        </div>
        <div className="flex gap-2">
          {/* Toggle tampilan */}
          <div className="inline-flex bg-white border border-slate-200 rounded-xl p-1">
            <button onClick={() => setView('cards')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${view === 'cards' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              <LayoutGrid size={16} /> Kartu
            </button>
            <button onClick={() => setView('calendar')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${view === 'calendar' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              <CalendarRange size={16} /> Kalender
            </button>
          </div>
          <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-all">
            <Plus size={18} /> Tambah Kamar
          </button>
        </div>
      </div>

      {view === 'cards' ? (
        <>
          {/* Filter */}
          <div className="flex gap-2 flex-wrap">
            {['ALL', ...STATUSES].map(s => (
              <button key={s} onClick={() => setFilter(s)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${filter === s ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
                {s === 'ALL' ? 'Semua' : STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <DoorOpen size={48} className="mx-auto mb-3 opacity-50" />
              <p>Belum ada kamar</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(r => (
                <div key={r.id} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-all">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-lg text-slate-900">Kamar {r.number}</h3>
                    <span className={`px-3 py-1 rounded-lg text-xs font-medium ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                  </div>
                  <div className="space-y-1 text-sm text-slate-600 mb-4">
                    <p>Lantai {r.floor} — {r.tier?.name || r.type}</p>
                    <p className="font-semibold text-emerald-600">{rupiah(r.displayPrice ?? r.price)}/bulan</p>
                    {r.displayLabel && <p className="text-xs text-emerald-500">{r.displayLabel}</p>}
                    {r.facilities?.length > 0 && <p className="text-xs text-slate-400">{r.facilities.join(', ')}</p>}
                    {r.tenants?.[0] && (
                      <p className="text-xs text-blue-600">
                        👤 {r.tenants[0].name}
                        {r.tenants[0].moveInDate && <span className="text-slate-400"> · masuk {new Date(r.tenants[0].moveInDate).toLocaleDateString('id-ID')}</span>}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(r)} className="flex-1 py-2 text-sm bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-all flex items-center justify-center gap-1">
                      <Pencil size={14} /> Edit
                    </button>
                    <button onClick={() => { if (confirm('Hapus kamar ini?')) del.mutate(r.id); }}
                      className="py-2 px-3 text-sm bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-all">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <OccupancyCalendar occ={occ} loading={occLoading} year={year} setYear={setYear} />
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModal(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-900">{modal === 'add' ? 'Tambah Kamar' : 'Edit Kamar'}</h2>
              <button onClick={() => setModal(null)} className="p-1 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nomor</label>
                  <input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Lantai</label>
                  <input type="number" value={form.floor} onChange={e => setForm({ ...form, floor: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tipe</label>
                  <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none">
                    {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none">
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Harga/bulan (Rp)</label>
                <input type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Fasilitas (pisah koma)</label>
                <input value={form.facilities} onChange={e => setForm({ ...form, facilities: e.target.value })}
                  placeholder="AC, WiFi, Kamar Mandi Dalam"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <button type="submit" disabled={save.isPending}
                className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {save.isPending && <Loader2 size={18} className="animate-spin" />}
                {modal === 'add' ? 'Tambah' : 'Simpan'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Kalender Hunian Tahunan (Jan–Des, satu baris per kamar) ──────────
function OccupancyCalendar({ occ, loading, year, setYear }) {
  const [detail, setDetail] = useState(null); // tenant yang diklik

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" /></div>;
  }
  if (!occ) return null;

  // Hitung overlap satu penghuni dengan tahun yang dipilih → kolom mulai & lebar (1..12)
  const spanForTenant = (t) => {
    const start = new Date(t.moveInDate);
    const end = t.moveOutDate ? new Date(t.moveOutDate) : new Date(year, 11, 31);
    const ys = new Date(year, 0, 1), ye = new Date(year, 11, 31);
    if (end < ys || start > ye) return null; // tidak ada irisan tahun ini
    const startMonth = start < ys ? 0 : start.getMonth();
    const endMonth = end > ye ? 11 : end.getMonth();
    return { startMonth, span: endMonth - startMonth + 1, startsBefore: start < ys, endsAfter: end > ye };
  };

  return (
    <div className="space-y-4">
      {/* Header tahun + legenda */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit">
          <button onClick={() => setYear(year - 1)} className="p-2 hover:bg-slate-50 rounded-lg"><ChevronLeft size={18} className="text-slate-600" /></button>
          <span className="px-4 font-bold text-slate-800 text-lg tabular-nums">{year}</span>
          <button onClick={() => setYear(year + 1)} className="p-2 hover:bg-slate-50 rounded-lg"><ChevronRight size={18} className="text-slate-600" /></button>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-500" /> Aktif</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-purple-400" /> Dipesan (DP)</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-100 border border-slate-200" /> Kosong</span>
        </div>
      </div>

      <p className="text-sm text-slate-500">
        Tiap baris satu kamar. Bar berwarna = periode terisi. Sela kosong = kamar bebas di bulan itu —
        klik bar penghuni untuk detail. Satu kamar bisa punya beberapa penghuni di bulan berbeda.
      </p>

      {/* Grid kalender */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-x-auto">
        <div className="min-w-[760px]">
          {/* Header bulan */}
          <div className="grid border-b border-slate-100" style={{ gridTemplateColumns: '110px repeat(12, 1fr)' }}>
            <div className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">Kamar</div>
            {MONTHS.map((m, i) => (
              <div key={m} className={`px-1 py-2.5 text-center text-xs font-semibold uppercase ${i === new Date().getMonth() && year === new Date().getFullYear() ? 'text-emerald-600' : 'text-slate-400'}`}>{m}</div>
            ))}
          </div>

          {/* Baris kamar */}
          {occ.rooms.map((room, ri) => {
            const spans = room.tenants
              .map((t, idx) => ({ t, idx, sp: spanForTenant(t) }))
              .filter(x => x.sp);
            return (
              <div key={room.id} className="grid items-center border-b border-slate-50 hover:bg-slate-50/40" style={{ gridTemplateColumns: '110px repeat(12, 1fr)' }}>
                {/* Label kamar */}
                <div className="px-3 py-3">
                  <p className="font-semibold text-slate-800 text-sm">{room.number}</p>
                  <p className="text-[11px] text-slate-400">{room.tier?.code ? `Tipe ${room.tier.code}` : room.type}</p>
                </div>

                {/* Track 12 bulan + bar penghuni di-overlay */}
                <div className="col-span-12 relative h-12">
                  {/* garis bulan */}
                  <div className="absolute inset-0 grid" style={{ gridTemplateColumns: 'repeat(12, 1fr)' }}>
                    {MONTHS.map((m, i) => (
                      <div key={i} className={`border-l ${i === 0 ? 'border-transparent' : 'border-slate-100'}`} />
                    ))}
                  </div>
                  {/* bar penghuni */}
                  {spans.map(({ t, idx, sp }) => {
                    const c = TENANT_BARS[idx % TENANT_BARS.length];
                    const color = t.status === 'PENDING' ? c.pending : (t.status === 'INACTIVE' ? 'bg-slate-300' : c.active);
                    const leftPct = (sp.startMonth / 12) * 100;
                    const widthPct = (sp.span / 12) * 100;
                    return (
                      <button key={t.id} onClick={() => setDetail({ ...t, roomNumber: room.number })}
                        title={`${t.name} (${t.status})`}
                        className={`absolute top-1.5 bottom-1.5 ${color} ${c.text} rounded-md px-2 text-[11px] font-medium flex items-center truncate shadow-sm hover:brightness-110 transition-all`}
                        style={{
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          borderTopLeftRadius: sp.startsBefore ? 0 : undefined,
                          borderBottomLeftRadius: sp.startsBefore ? 0 : undefined,
                          borderTopRightRadius: sp.endsAfter ? 0 : undefined,
                          borderBottomRightRadius: sp.endsAfter ? 0 : undefined,
                        }}>
                        <span className="truncate">{t.name}</span>
                      </button>
                    );
                  })}
                  {spans.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-300">kosong sepanjang {year}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail penghuni */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900">Detail Penghuni</h2>
              <button onClick={() => setDetail(null)} className="p-1 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Nama</span><span className="font-medium text-slate-800">{detail.name}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Kamar</span><span className="font-medium text-slate-800">{detail.roomNumber}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">No. HP</span><span className="font-medium text-slate-800">{detail.phone}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Masuk</span><span className="font-medium text-slate-800">{new Date(detail.moveInDate).toLocaleDateString('id-ID')}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Keluar</span><span className="font-medium text-slate-800">{detail.moveOutDate ? new Date(detail.moveOutDate).toLocaleDateString('id-ID') : '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Status</span>
                <span className={`px-2.5 py-0.5 rounded-lg text-xs font-medium ${detail.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : detail.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                  {detail.status === 'ACTIVE' ? 'Aktif' : detail.status === 'PENDING' ? 'Pending' : 'Non-Aktif'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
