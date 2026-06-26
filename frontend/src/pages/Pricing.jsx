import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Tag, Loader2, Pencil, Check, X, Plus, Trash2 } from 'lucide-react';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export default function Pricing() {
  const qc = useQueryClient();
  const [editRule, setEditRule] = useState(null); // rule id being edited
  const [editForm, setEditForm] = useState({ price: '', startDate: '', endDate: '', label: '' });
  const [addModal, setAddModal] = useState(null); // tierId to add a rule for
  const [addForm, setAddForm] = useState({ price: '', startDate: '', endDate: '', label: '' });

  const { data: tiers = [], isLoading } = useQuery({ queryKey: ['pricing-tiers'], queryFn: () => api.get('/pricing/tiers') });

  const updateRule = useMutation({
    mutationFn: ({ id, body }) => api.put(`/pricing/rules/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pricing-tiers'] }); qc.invalidateQueries({ queryKey: ['rooms'] }); setEditRule(null); },
    onError: (e) => alert('Gagal menyimpan: ' + e.message),
  });

  const addRule = useMutation({
    mutationFn: (body) => api.post('/pricing/rules', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pricing-tiers'] }); setAddModal(null); setAddForm({ price: '', startDate: '', endDate: '', label: '' }); },
    onError: (e) => alert('Gagal menambah: ' + e.message),
  });

  const delRule = useMutation({
    mutationFn: (id) => api.del(`/pricing/rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pricing-tiers'] }),
    onError: (e) => alert('Gagal menghapus: ' + e.message),
  });

  const startEdit = (rule) => {
    setEditRule(rule.id);
    setEditForm({
      price: rule.price,
      startDate: rule.startDate?.slice(0, 10) || '',
      endDate: rule.endDate?.slice(0, 10) || '',
      label: rule.label || '',
    });
  };

  const saveEdit = (id) => {
    updateRule.mutate({ id, body: {
      price: Number(editForm.price),
      startDate: editForm.startDate || null,
      endDate: editForm.endDate || null,
      label: editForm.label || null,
    }});
  };

  const submitAdd = (tierId) => {
    if (!addForm.price) { alert('Harga wajib diisi'); return; }
    addRule.mutate({
      tierId,
      price: Number(addForm.price),
      startDate: addForm.startDate || null,
      endDate: addForm.endDate || null,
      label: addForm.label || null,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Harga Kamar</h1>
        <p className="text-slate-500 text-sm mt-1">Atur harga per tipe & periode. Harga dihitung otomatis berdasarkan tanggal masuk penghuni.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" /></div>
      ) : tiers.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Tag size={48} className="mx-auto mb-3 opacity-50" />
          <p>Belum ada tipe harga. Jalankan migrasi database terlebih dahulu.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {tiers.map(tier => (
            <div key={tier.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-emerald-600 text-white font-bold flex items-center justify-center">{tier.code}</span>
                  <div>
                    <h3 className="font-bold text-slate-900">{tier.name}</h3>
                    <p className="text-xs text-slate-400">{tier._count?.rooms ?? 0} kamar</p>
                  </div>
                </div>
                <button onClick={() => setAddModal(tier.id)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100">
                  <Plus size={14} /> Periode
                </button>
              </div>

              <div className="divide-y divide-slate-50">
                {tier.rules.length === 0 && (
                  <p className="px-5 py-4 text-sm text-slate-400">Belum ada aturan harga.</p>
                )}
                {tier.rules.map(rule => (
                  <div key={rule.id} className="px-5 py-3">
                    {editRule === rule.id ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <input type="number" value={editForm.price} onChange={e => setEditForm({ ...editForm, price: e.target.value })}
                            placeholder="Harga" className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm" />
                          <input value={editForm.label} onChange={e => setEditForm({ ...editForm, label: e.target.value })}
                            placeholder="Label (cth: Promo)" className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm" />
                          <input type="date" value={editForm.startDate} onChange={e => setEditForm({ ...editForm, startDate: e.target.value })}
                            className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm" />
                          <input type="date" value={editForm.endDate} onChange={e => setEditForm({ ...editForm, endDate: e.target.value })}
                            className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm" />
                        </div>
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => saveEdit(rule.id)} disabled={updateRule.isPending}
                            className="p-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
                            {updateRule.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                          </button>
                          <button onClick={() => setEditRule(null)} className="p-1.5 bg-slate-100 text-slate-500 rounded-lg hover:bg-slate-200"><X size={14} /></button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-emerald-700">Rp {Number(rule.price).toLocaleString('id-ID')}<span className="text-xs font-normal text-slate-400">/bln</span></p>
                          <p className="text-xs text-slate-500">
                            {rule.label && <span className="text-emerald-600 font-medium">{rule.label} · </span>}
                            {fmtDate(rule.startDate)} → {fmtDate(rule.endDate)}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => startEdit(rule)} className="p-1.5 hover:bg-slate-100 rounded-lg"><Pencil size={14} className="text-slate-500" /></button>
                          <button onClick={() => { if (confirm('Hapus aturan harga ini?')) delRule.mutate(rule.id); }} className="p-1.5 hover:bg-red-50 rounded-lg"><Trash2 size={14} className="text-red-500" /></button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add rule modal */}
      {addModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAddModal(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-900">Tambah Periode Harga</h2>
              <button onClick={() => setAddModal(null)} className="p-1 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Harga / bulan (Rp)</label>
                <input type="number" value={addForm.price} onChange={e => setAddForm({ ...addForm, price: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Label</label>
                <input value={addForm.label} onChange={e => setAddForm({ ...addForm, label: e.target.value })}
                  placeholder="cth: Promo Juni-Juli" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Mulai berlaku</label>
                  <input type="date" value={addForm.startDate} onChange={e => setAddForm({ ...addForm, startDate: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Sampai (opsional)</label>
                  <input type="date" value={addForm.endDate} onChange={e => setAddForm({ ...addForm, endDate: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
              </div>
              <p className="text-xs text-slate-400">Kosongkan tanggal "sampai" jika harga berlaku seterusnya. Periode dihitung dari tanggal masuk penghuni.</p>
              <button onClick={() => submitAdd(addModal)} disabled={addRule.isPending}
                className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {addRule.isPending && <Loader2 size={18} className="animate-spin" />}
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
