import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Pencil, Trash2, X, Loader2, DoorOpen } from 'lucide-react';

const ROOM_TYPES = ['STANDARD', 'DELUXE', 'SUITE'];
const STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'];
const STATUS_COLORS = {
  AVAILABLE: 'bg-emerald-100 text-emerald-700',
  OCCUPIED: 'bg-blue-100 text-blue-700',
  RESERVED: 'bg-purple-100 text-purple-700',
  MAINTENANCE: 'bg-amber-100 text-amber-700',
};

const empty = { number: '', floor: 1, type: 'STANDARD', price: '', facilities: '', status: 'AVAILABLE' };

export default function Rooms() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null); // null | 'add' | room obj
  const [form, setForm] = useState(empty);
  const [filter, setFilter] = useState('ALL');

  const { data: rooms = [], isLoading } = useQuery({
    queryKey: ['rooms'],
    queryFn: () => api.get('/rooms'),
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
        <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-all">
          <Plus size={18} /> Tambah Kamar
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {['ALL', ...STATUSES].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${filter === s ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
            {s === 'ALL' ? 'Semua' : s}
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
                <span className={`px-3 py-1 rounded-lg text-xs font-medium ${STATUS_COLORS[r.status]}`}>{r.status}</span>
              </div>
              <div className="space-y-1 text-sm text-slate-600 mb-4">
                <p>Lantai {r.floor} — {r.tier?.name || r.type}</p>
                <p className="font-semibold text-emerald-600">
                  Rp {Number(r.displayPrice ?? r.price).toLocaleString('id-ID')}/bulan
                </p>
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
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
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
