import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Trash2, X, Loader2, Receipt, CreditCard, RefreshCw, Banknote } from 'lucide-react';

const BILL_TYPES = ['RENT', 'ELECTRIC', 'WATER', 'WIFI', 'OTHER'];
const STATUS_COLORS = {
  UNPAID: 'bg-red-100 text-red-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  PENDING: 'bg-amber-100 text-amber-700',
  PARTIAL: 'bg-amber-100 text-amber-700',
  OVERDUE: 'bg-red-200 text-red-800',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

const empty = { tenantId: '', type: 'RENT', amount: '', description: '', dueDate: '' };

export default function Bills() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(empty);
  const [filter, setFilter] = useState('ALL');

  const { data: bills = [], isLoading } = useQuery({ queryKey: ['bills'], queryFn: () => api.get('/bills') });
  const { data: tenants = [] } = useQuery({ queryKey: ['tenants'], queryFn: () => api.get('/tenants') });

  const create = useMutation({
    mutationFn: (d) => api.post('/bills', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bills'] }); setModal(null); },
  });

  const del = useMutation({
    mutationFn: (id) => api.del(`/bills/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bills'] }),
  });

  const genMonthly = useMutation({
    mutationFn: () => api.post('/bills/generate-monthly'),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      alert(`Berhasil generate ${data.generated || 0} tagihan bulan ini!`);
    },
  });

  const payBill = useMutation({
    mutationFn: (billId) => api.post('/payments/create', { billId }),
    onSuccess: (data) => {
      if (data.alreadyPaid) {
        alert('Tagihan sudah terbayar!');
        qc.invalidateQueries({ queryKey: ['bills'] });
        qc.invalidateQueries({ queryKey: ['tenants'] });
        return;
      }
      const url = data.redirectUrl || data.snapUrl;
      if (url) {
        window.open(url, '_blank');
      } else if (data.token) {
        window.snap?.pay(data.token);
      }
      qc.invalidateQueries({ queryKey: ['bills'] });
    },
    onError: (error) => {
      alert('Gagal buat pembayaran: ' + error.message);
    },
  });

  const checkStatus = useMutation({
    mutationFn: (billId) => api.post('/payments/check-status', { billId }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['tenants'] });
      if (data.status === 'SUCCESS') {
        alert('✅ Pembayaran dikonfirmasi! Status sudah diupdate.');
      } else if (data.status === 'PENDING' && data.redirectUrl) {
        window.open(data.redirectUrl, '_blank');
      } else if (data.status === 'EXPIRED' || data.status === 'RESET') {
        alert(data.message || 'Link expired, silakan buat link baru.');
      } else {
        alert(`Status: ${data.message || data.status}`);
      }
    },
    onError: (error) => {
      alert('Gagal cek status: ' + error.message);
    },
  });

  // Pembayaran manual (cash / transfer langsung ke rekening owner) — tanpa payment gateway
  const markPaid = useMutation({
    mutationFn: ({ billId, method }) => api.post(`/bills/${billId}/mark-paid`, { method }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['tenants'] });
      qc.invalidateQueries({ queryKey: ['rooms'] });
      alert(data.activated
        ? '✅ Lunas dicatat. Semua tagihan beres — penghuni kini Aktif & kamar Terisi.'
        : '✅ Pembayaran manual dicatat sebagai LUNAS.');
    },
    onError: (error) => alert('Gagal mencatat pembayaran: ' + error.message),
  });

  const handleMarkPaid = (billId) => {
    const choice = window.prompt('Catat pembayaran manual sebagai LUNAS.\nKetik metode: "cash" atau "transfer"', 'cash');
    if (!choice) return;
    const method = choice.trim().toLowerCase() === 'transfer' ? 'TRANSFER' : 'CASH';
    markPaid.mutate({ billId, method });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const selectedTenant = tenants.find(t => t.id === form.tenantId);
    const body = { ...form, amount: Number(form.amount), roomId: selectedTenant?.roomId };
    if (body.dueDate) body.dueDate = new Date(body.dueDate).toISOString();
    create.mutate(body);
  };

  const filtered = filter === 'ALL' ? bills : bills.filter(b => b.status === filter);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tagihan</h1>
          <p className="text-slate-500 text-sm mt-1">Kelola tagihan penghuni</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => genMonthly.mutate()} disabled={genMonthly.isPending}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-all disabled:opacity-50">
            {genMonthly.isPending ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Generate Bulanan
          </button>
          <button onClick={() => { setForm(empty); setModal('add'); }}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-all">
            <Plus size={18} /> Tambah
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {['ALL', 'UNPAID', 'PENDING', 'OVERDUE', 'PAID', 'PARTIAL'].map(s => (
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
          <Receipt size={48} className="mx-auto mb-3 opacity-50" />
          <p>Belum ada tagihan</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Penghuni</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Tipe</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Jumlah</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Jatuh Tempo</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(b => (
                  <tr key={b.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-medium text-slate-900">{b.tenant?.name || 'N/A'}</p>
                      <p className="text-xs text-slate-400">Kamar {b.room?.number || '-'}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium">{b.type}</span>
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-800">Rp {Number(b.amount).toLocaleString('id-ID')}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">{b.dueDate ? new Date(b.dueDate).toLocaleDateString('id-ID') : '-'}</td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-lg text-xs font-medium ${STATUS_COLORS[b.status] || 'bg-slate-100 text-slate-600'}`}>{b.status}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex gap-1">
                        {b.status === 'PENDING' && (
                          <button onClick={() => checkStatus.mutate(b.id)} title="Cek status pembayaran"
                            disabled={checkStatus.isPending}
                            className="p-2 hover:bg-blue-50 rounded-lg">
                            <RefreshCw size={15} className={`text-blue-600 ${checkStatus.isPending ? 'animate-spin' : ''}`} />
                          </button>
                        )}
                        {(b.status === 'UNPAID' || b.status === 'OVERDUE') && (
                          <button onClick={() => payBill.mutate(b.id)} title="Buat link bayar (Midtrans)"
                            disabled={payBill.isPending}
                            className="p-2 hover:bg-emerald-50 rounded-lg">
                            <CreditCard size={15} className="text-emerald-600" />
                          </button>
                        )}
                        {b.status !== 'PAID' && b.status !== 'CANCELLED' && (
                          <button onClick={() => handleMarkPaid(b.id)} title="Tandai lunas manual (cash/transfer)"
                            disabled={markPaid.isPending}
                            className="p-2 hover:bg-green-50 rounded-lg">
                            <Banknote size={15} className="text-green-700" />
                          </button>
                        )}
                        <button onClick={() => { if (confirm('Hapus tagihan ini?')) del.mutate(b.id); }}
                          className="p-2 hover:bg-red-50 rounded-lg">
                          <Trash2 size={15} className="text-red-500" />
                        </button>
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
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-900">Tambah Tagihan</h2>
              <button onClick={() => setModal(null)} className="p-1 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Penghuni</label>
                <select value={form.tenantId} onChange={e => setForm({ ...form, tenantId: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" required>
                  <option value="">Pilih penghuni...</option>
                  {tenants.filter(t => t.status === 'ACTIVE').map(t => (
                    <option key={t.id} value={t.id}>{t.name} — Kamar {t.room?.number || '?'}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tipe</label>
                  <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none">
                    {BILL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Jumlah (Rp)</label>
                  <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Jatuh Tempo</label>
                <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Keterangan</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="Opsional" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <button type="submit" disabled={create.isPending}
                className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {create.isPending && <Loader2 size={18} className="animate-spin" />}
                Tambah Tagihan
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
