import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Pencil, Trash2, X, Loader2, Users, Phone, Mail } from 'lucide-react';

const empty = { name: '', phone: '', email: '', ktpNumber: '', roomId: '', moveInDate: '', moveOutDate: '', status: '', depositAmount: '', rentAmount: '' };

export default function Tenants() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(empty);
  const [pricePreview, setPricePreview] = useState(null); // { price, label, tierCode }

  // Ambil harga dinamis sesuai kamar + tanggal masuk (untuk preview & default sewa)
  useEffect(() => {
    if (!modal || !form.roomId || !form.moveInDate) { setPricePreview(null); return; }
    let cancelled = false;
    api.get(`/pricing/preview?roomId=${form.roomId}&date=${form.moveInDate}`)
      .then(res => { if (!cancelled) setPricePreview(res); })
      .catch(() => { if (!cancelled) setPricePreview(null); });
    return () => { cancelled = true; };
  }, [modal, form.roomId, form.moveInDate]);

  const { data: tenants = [], isLoading } = useQuery({ queryKey: ['tenants'], queryFn: () => api.get('/tenants') });
  const { data: rooms = [] } = useQuery({ queryKey: ['rooms'], queryFn: () => api.get('/rooms') });

  const availableRooms = rooms.filter(r => r.status === 'AVAILABLE');

  const save = useMutation({
    mutationFn: (d) => modal === 'add' ? api.post('/tenants', d) : api.put(`/tenants/${modal.id}`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tenants'] }); qc.invalidateQueries({ queryKey: ['rooms'] }); setModal(null); },
  });

  const del = useMutation({
    mutationFn: (id) => api.del(`/tenants/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tenants'] }); qc.invalidateQueries({ queryKey: ['rooms'] }); },
  });

  const openAdd = () => { setForm(empty); setModal('add'); };
  const openEdit = (t) => {
    setForm({
      name: t.name, phone: t.phone, email: t.email || '', ktpNumber: t.ktpNumber || '',
      roomId: t.roomId, moveInDate: t.moveInDate?.slice(0, 10) || '', moveOutDate: t.moveOutDate?.slice(0, 10) || '',
      status: t.status || '', depositAmount: t.depositAmount ?? '', rentAmount: '',
    });
    setModal(t);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const body = { ...form };
    if (body.moveInDate) body.moveInDate = new Date(body.moveInDate).toISOString();
    if (body.moveOutDate) body.moveOutDate = new Date(body.moveOutDate).toISOString();
    else body.moveOutDate = null; // kirim null agar bisa dikosongkan (bukan dihapus dari body)
    if (!body.email) delete body.email;
    if (!body.ktpNumber) delete body.ktpNumber;
    // DP: kirim angka kalau diisi, null kalau dikosongkan
    body.depositAmount = body.depositAmount === '' ? null : Number(body.depositAmount);
    // rentAmount override: hanya kirim kalau diisi (kosong = pakai harga dinamis otomatis)
    if (body.rentAmount === '' || body.rentAmount == null) delete body.rentAmount;
    else body.rentAmount = Number(body.rentAmount);
    save.mutate(body);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Penghuni</h1>
          <p className="text-slate-500 text-sm mt-1">Kelola data penghuni kos</p>
        </div>
        <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-all">
          <Plus size={18} /> Tambah Penghuni
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" /></div>
      ) : tenants.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Users size={48} className="mx-auto mb-3 opacity-50" />
          <p>Belum ada penghuni</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Nama</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Kontak</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Kamar</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Mulai</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Keluar</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {tenants.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-medium text-slate-900">{t.name}</p>
                      {t.ktpNumber && <p className="text-xs text-slate-400">KTP: {t.ktpNumber}</p>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-sm text-slate-600"><Phone size={13} /> {t.phone}</div>
                      {t.email && <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5"><Mail size={12} /> {t.email}</div>}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-700">{t.room?.number || '-'}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">{t.moveInDate ? new Date(t.moveInDate).toLocaleDateString('id-ID') : '-'}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">{t.moveOutDate ? new Date(t.moveOutDate).toLocaleDateString('id-ID') : <span className="text-slate-300">—</span>}</td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-lg text-xs font-medium ${t.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : t.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                        {t.status === 'ACTIVE' ? 'Aktif' : t.status === 'PENDING' ? 'Pending' : 'Non-Aktif'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex gap-1">
                        <button onClick={() => openEdit(t)} className="p-2 hover:bg-slate-100 rounded-lg"><Pencil size={15} className="text-slate-500" /></button>
                        <button onClick={() => { if (confirm('Hapus penghuni ini?')) del.mutate(t.id); }} className="p-2 hover:bg-red-50 rounded-lg"><Trash2 size={15} className="text-red-500" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModal(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-900">{modal === 'add' ? 'Tambah Penghuni' : 'Edit Penghuni'}</h2>
              <button onClick={() => setModal(null)} className="p-1 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nama Lengkap</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">No. HP</label>
                  <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="08123456789" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">No. KTP</label>
                <input value={form.ktpNumber} onChange={e => setForm({ ...form, ktpNumber: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Kamar</label>
                <select value={form.roomId} onChange={e => setForm({ ...form, roomId: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" required>
                  <option value="">Pilih kamar...</option>
                  {modal !== 'add' && form.roomId && !availableRooms.find(r => r.id === form.roomId) && (
                    <option value={form.roomId}>Kamar {rooms.find(r => r.id === form.roomId)?.number || form.roomId} (current)</option>
                  )}
                  {availableRooms.map(r => (
                    <option key={r.id} value={r.id}>Kamar {r.number} — {r.tier?.name || r.type} (Rp {Number(r.displayPrice ?? r.price).toLocaleString('id-ID')})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tanggal Masuk</label>
                  <input type="date" value={form.moveInDate} onChange={e => setForm({ ...form, moveInDate: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tanggal Keluar</label>
                  <input type="date" value={form.moveOutDate} onChange={e => setForm({ ...form, moveOutDate: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
              </div>

              {/* Harga dinamis (preview otomatis sesuai tanggal masuk) */}
              {pricePreview && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Harga sewa otomatis{pricePreview.tierCode ? ` (Tipe ${pricePreview.tierCode})` : ''}</span>
                    <span className="font-semibold text-emerald-700">Rp {Number(pricePreview.price).toLocaleString('id-ID')}/bln</span>
                  </div>
                  {pricePreview.label && <p className="text-xs text-emerald-600 mt-0.5">{pricePreview.label}</p>}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Sewa (override)</label>
                  <input type="number" value={form.rentAmount} onChange={e => setForm({ ...form, rentAmount: e.target.value })}
                    placeholder={pricePreview ? Number(pricePreview.price).toLocaleString('id-ID') : 'Otomatis'}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
                  <p className="text-xs text-slate-400 mt-1">Kosongkan = pakai harga otomatis</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">DP / Uang Muka</label>
                  <input type="number" value={form.depositAmount} onChange={e => setForm({ ...form, depositAmount: e.target.value })}
                    placeholder="cth: 500000" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
                  <p className="text-xs text-slate-400 mt-1">Isi jika ada DP</p>
                </div>
              </div>
              {modal === 'add' && form.depositAmount && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  Penghuni akan berstatus <b>Pending</b> & kamar <b>Reserved</b>. Tagihan DP + sewa bulan pertama dibuat otomatis, dan WhatsApp pemberitahuan dikirim. Penghuni jadi <b>Aktif</b> setelah semua lunas.
                </p>
              )}
              {modal !== 'add' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none">
                    <option value="ACTIVE">Aktif</option>
                    <option value="PENDING">Pending</option>
                    <option value="INACTIVE">Non-Aktif</option>
                  </select>
                </div>
              )}
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
