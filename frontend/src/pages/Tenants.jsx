import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Pencil, Trash2, X, Loader2, Users, Phone, Mail, RefreshCw } from 'lucide-react';

const empty = {
  name: '', phone: '', email: '', ktpNumber: '', roomId: '',
  moveInDate: '', moveOutDate: '', status: '',
  depositAmount: '', rentAmount: '',
  durationMonths: '1', discountAmount: '', discountType: 'TOTAL',
};

const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

// Warna badge per tahap lifecycle (selaras dengan backend lifecycle.js)
const stageBadge = (stage) => ({
  RESERVED: 'bg-amber-100 text-amber-700',
  UPCOMING: 'bg-blue-100 text-blue-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  FINISHED: 'bg-slate-100 text-slate-500',
  INACTIVE: 'bg-rose-100 text-rose-600',
  // fallback status lama
  PENDING: 'bg-amber-100 text-amber-700',
}[stage] || 'bg-slate-100 text-slate-500');

const stageLabelOf = (s) => ({
  RESERVED: 'Dipesan', UPCOMING: 'Akan Masuk', ACTIVE: 'Aktif',
  FINISHED: 'Selesai', INACTIVE: 'Non-Aktif', PENDING: 'Pending',
}[s] || s);

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

  // Kamar yang bisa dipilih untuk booking baru: yang kosong ATAU sudah dipesan
  // (RESERVED) — supaya 1 kamar bisa diisi penghuni lain di periode berbeda
  // (mis. penghuni lama + penghuni baru masuk belakangan). Kamar OCCUPIED
  // disembunyikan dari daftar tambah, tapi tetap bisa dipilih saat edit.
  const availableRooms = rooms.filter(r => r.status === 'AVAILABLE' || r.status === 'RESERVED');

  const save = useMutation({
    mutationFn: (d) => modal === 'add' ? api.post('/tenants', d) : api.put(`/tenants/${modal.id}`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tenants'] }); qc.invalidateQueries({ queryKey: ['rooms'] }); qc.invalidateQueries({ queryKey: ['bills'] }); setModal(null); },
  });

  const del = useMutation({
    mutationFn: (id) => api.del(`/tenants/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tenants'] }); qc.invalidateQueries({ queryKey: ['rooms'] }); },
  });

  // ── Perpanjang (Renew) ─────────────────────────────────────
  const [renewModal, setRenewModal] = useState(null);
  const [renewForm, setRenewForm] = useState({ durationMonths: '1', rentAmount: '', discountAmount: '', discountType: 'TOTAL', depositAmount: '' });
  const [renewPricePreview, setRenewPricePreview] = useState(null);

  // Fetch harga untuk perpanjangan
  useEffect(() => {
    if (!renewModal) { setRenewPricePreview(null); return; }
    let cancelled = false;
    const startDate = renewModal.moveOutDate?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    api.get(`/pricing/preview?roomId=${renewModal.roomId}&date=${startDate}`)
      .then(res => { if (!cancelled) setRenewPricePreview(res); })
      .catch(() => { if (!cancelled) setRenewPricePreview(null); });
    return () => { cancelled = true; };
  }, [renewModal]);

  const renew = useMutation({
    mutationFn: ({ id, data }) => api.post(`/tenants/${id}/renew`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] });
      qc.invalidateQueries({ queryKey: ['rooms'] });
      qc.invalidateQueries({ queryKey: ['bills'] });
      setRenewModal(null);
      alert('Perpanjangan berhasil! Tagihan baru telah dibuat.');
    },
    onError: (error) => alert('Gagal perpanjang: ' + error.message),
  });

  const openRenew = (t) => {
    setRenewForm({ durationMonths: '1', rentAmount: '', discountAmount: '', discountType: 'TOTAL', depositAmount: '' });
    setRenewModal(t);
  };

  const handleRenewSubmit = (e) => {
    e.preventDefault();
    const body = { ...renewForm };
    body.durationMonths = Number(body.durationMonths) || 1;
    body.discountAmount = body.discountAmount === '' ? 0 : Number(body.discountAmount);
    if (!body.discountAmount) body.discountType = null;
    if (body.rentAmount === '' || body.rentAmount == null) delete body.rentAmount;
    else body.rentAmount = Number(body.rentAmount);
    body.depositAmount = body.depositAmount === '' ? null : Number(body.depositAmount);
    renew.mutate({ id: renewModal.id, data: body });
  };

  // Renew preview calculations
  const renewMonthly = Number(renewForm.rentAmount) || Number(renewPricePreview?.price) || 0;
  const renewMonths = Math.max(1, Number(renewForm.durationMonths) || 1);
  const renewDiscount = Number(renewForm.discountAmount) || 0;
  const renewDp = Number(renewForm.depositAmount) || 0;
  const renewGross = renewMonthly * renewMonths;
  const renewTotal = renewForm.discountType === 'PER_MONTH'
    ? Math.max(0, (renewMonthly - renewDiscount) * renewMonths)
    : Math.max(0, renewGross - renewDiscount);
  const renewSisa = Math.max(0, renewTotal - renewDp);

  const openAdd = () => { setForm(empty); setModal('add'); };
  const openEdit = (t) => {
    setForm({
      name: t.name, phone: t.phone, email: t.email || '', ktpNumber: t.ktpNumber || '',
      roomId: t.roomId, moveInDate: t.moveInDate?.slice(0, 10) || '', moveOutDate: t.moveOutDate?.slice(0, 10) || '',
      status: t.status || '', depositAmount: t.depositAmount ?? '', rentAmount: '',
      durationMonths: t.durationMonths ? String(t.durationMonths) : '1',
      discountAmount: t.discountAmount ?? '', discountType: t.discountType || 'TOTAL',
    });
    setModal(t);
  };

  // ── Hitung ringkasan pembayaran (live) ─────────────────────
  const monthly = Number(form.rentAmount) || Number(pricePreview?.price) || 0;
  const months = Math.max(1, Number(form.durationMonths) || 1);
  const discount = Number(form.discountAmount) || 0;
  const dp = Number(form.depositAmount) || 0;
  const gross = monthly * months;
  const total = form.discountType === 'PER_MONTH'
    ? Math.max(0, (monthly - discount) * months)
    : Math.max(0, gross - discount);
  const sisa = Math.max(0, total - dp);

  const handleSubmit = (e) => {
    e.preventDefault();
    const body = { ...form };
    if (body.moveInDate) body.moveInDate = new Date(body.moveInDate).toISOString();
    if (body.moveOutDate) body.moveOutDate = new Date(body.moveOutDate).toISOString();
    else body.moveOutDate = null;
    if (!body.email) delete body.email;
    if (!body.ktpNumber) delete body.ktpNumber;
    body.depositAmount = body.depositAmount === '' ? null : Number(body.depositAmount);
    body.durationMonths = Number(body.durationMonths) || 1;
    body.discountAmount = body.discountAmount === '' ? 0 : Number(body.discountAmount);
    if (!body.discountAmount) body.discountType = null;
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
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex w-fit px-3 py-1 rounded-lg text-xs font-medium ${stageBadge(t.stage || t.status)}`}>
                          {t.stageLabel || stageLabelOf(t.status)}
                        </span>
                        {t.outstanding > 0 && (
                          <span className="text-xs text-amber-600">kurang {rupiah(t.outstanding)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex gap-1">
                        {(t.stage === 'FINISHED' || t.stage === 'ACTIVE') && (
                          <button onClick={() => openRenew(t)} title="Perpanjang kontrak" className="p-2 hover:bg-blue-50 rounded-lg"><RefreshCw size={15} className="text-blue-600" /></button>
                        )}
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
                    <option key={r.id} value={r.id}>Kamar {r.number} — {r.tier?.name || r.type} ({rupiah(r.displayPrice ?? r.price)})</option>
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
                    <span className="font-semibold text-emerald-700">{rupiah(pricePreview.price)}/bln</span>
                  </div>
                  {pricePreview.label && <p className="text-xs text-emerald-600 mt-0.5">{pricePreview.label}</p>}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Lama Sewa (bulan)</label>
                  <input type="number" min="1" value={form.durationMonths} onChange={e => setForm({ ...form, durationMonths: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Sewa/bln (override)</label>
                  <input type="number" value={form.rentAmount} onChange={e => setForm({ ...form, rentAmount: e.target.value })}
                    placeholder={pricePreview ? Number(pricePreview.price).toLocaleString('id-ID') : 'Otomatis'}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
              </div>

              {/* Diskon */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Diskon (opsional)</label>
                <div className="grid grid-cols-2 gap-4">
                  <input type="number" value={form.discountAmount} onChange={e => setForm({ ...form, discountAmount: e.target.value })}
                    placeholder="cth: 100000" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
                  <select value={form.discountType} onChange={e => setForm({ ...form, discountType: e.target.value })}
                    disabled={!form.discountAmount}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-slate-50 disabled:text-slate-400">
                    <option value="TOTAL">Potong total</option>
                    <option value="PER_MONTH">Potong /bulan</option>
                  </select>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {form.discountType === 'PER_MONTH'
                    ? 'Potongan dikali jumlah bulan'
                    : 'Potongan sekali dari keseluruhan'}
                </p>
              </div>

              {/* DP */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">DP / Uang Muka (bebas nominal)</label>
                <input type="number" value={form.depositAmount} onChange={e => setForm({ ...form, depositAmount: e.target.value })}
                  placeholder="cth: 300000 — boleh berapa saja" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
                <p className="text-xs text-slate-400 mt-1">Kosongkan jika lunas di muka. Sisa wajib dilunasi sebelum masuk.</p>
              </div>

              {/* Ringkasan Pembayaran (live) */}
              {monthly > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm space-y-1.5">
                  <p className="font-semibold text-slate-700 mb-2">Ringkasan Pembayaran</p>
                  <div className="flex justify-between text-slate-600">
                    <span>Sewa {rupiah(monthly)} × {months} bln</span>
                    <span>{rupiah(gross)}</span>
                  </div>
                  {discount > 0 && (
                    <div className="flex justify-between text-rose-600">
                      <span>Diskon{form.discountType === 'PER_MONTH' ? ` (${rupiah(discount)}/bln)` : ''}</span>
                      <span>− {rupiah(form.discountType === 'PER_MONTH' ? discount * months : discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold text-slate-800 pt-1.5 border-t border-slate-200">
                    <span>Total</span>
                    <span>{rupiah(total)}</span>
                  </div>
                  {dp > 0 && (
                    <>
                      <div className="flex justify-between text-emerald-600">
                        <span>DP dibayar</span>
                        <span>− {rupiah(dp)}</span>
                      </div>
                      <div className={`flex justify-between font-bold pt-1.5 border-t border-slate-200 ${sisa > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        <span>{sisa > 0 ? 'Sisa kurang bayar' : 'Lunas'}</span>
                        <span>{rupiah(sisa)}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {modal === 'add' && dp > 0 && sisa > 0 && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  Penghuni berstatus <b>Pending</b> & kamar <b>Reserved</b>. Tagihan sewa dibuat otomatis (sudah tercatat DP {rupiah(dp)}, sisa {rupiah(sisa)}), dan WhatsApp dikirim. Penghuni jadi <b>Aktif</b> setelah sisa lunas.
                </p>
              )}
              {modal !== 'add' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Status (override manual)</label>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none">
                    <option value="">Otomatis (dari tanggal & pembayaran)</option>
                    <option value="ACTIVE">Paksa Aktif</option>
                    <option value="PENDING">Paksa Dipesan/Pending</option>
                    <option value="INACTIVE">Non-Aktif (keluar/batal)</option>
                  </select>
                  <p className="text-xs text-slate-400 mt-1">
                    Biarkan "Otomatis" agar status berpindah sendiri: Dipesan → Akan Masuk → Aktif → Selesai sesuai tanggal & pelunasan. Pilih paksa hanya bila perlu.
                  </p>
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

      {/* Modal Perpanjang */}
      {renewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRenewModal(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-900">Perpanjang Kontrak</h2>
              <button onClick={() => setRenewModal(null)} className="p-1 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm mb-4">
              <p className="font-medium text-blue-800">{renewModal.name}</p>
              <p className="text-blue-600 text-xs mt-0.5">Kamar {renewModal.room?.number || '-'} · Kontrak berakhir {renewModal.moveOutDate ? new Date(renewModal.moveOutDate).toLocaleDateString('id-ID') : '-'}</p>
            </div>

            {renewPricePreview && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-sm mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Harga sewa{renewPricePreview.tierCode ? ` (Tipe ${renewPricePreview.tierCode})` : ''}</span>
                  <span className="font-semibold text-emerald-700">{rupiah(renewPricePreview.price)}/bln</span>
                </div>
                {renewPricePreview.label && <p className="text-xs text-emerald-600 mt-0.5">{renewPricePreview.label}</p>}
              </div>
            )}

            <form onSubmit={handleRenewSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Lama Perpanjang (bulan)</label>
                  <input type="number" min="1" value={renewForm.durationMonths} onChange={e => setRenewForm({ ...renewForm, durationMonths: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Sewa/bln (override)</label>
                  <input type="number" value={renewForm.rentAmount} onChange={e => setRenewForm({ ...renewForm, rentAmount: e.target.value })}
                    placeholder={renewPricePreview ? Number(renewPricePreview.price).toLocaleString('id-ID') : 'Otomatis'}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Diskon (opsional)</label>
                <div className="grid grid-cols-2 gap-4">
                  <input type="number" value={renewForm.discountAmount} onChange={e => setRenewForm({ ...renewForm, discountAmount: e.target.value })}
                    placeholder="0" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" />
                  <select value={renewForm.discountType} onChange={e => setRenewForm({ ...renewForm, discountType: e.target.value })}
                    disabled={!renewForm.discountAmount}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400">
                    <option value="TOTAL">Potong total</option>
                    <option value="PER_MONTH">Potong /bulan</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">DP / Uang Muka (opsional)</label>
                <input type="number" value={renewForm.depositAmount} onChange={e => setRenewForm({ ...renewForm, depositAmount: e.target.value })}
                  placeholder="Kosongkan jika lunas langsung" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>

              {renewMonthly > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm space-y-1.5">
                  <p className="font-semibold text-slate-700 mb-2">Ringkasan Perpanjangan</p>
                  <div className="flex justify-between text-slate-600">
                    <span>Sewa {rupiah(renewMonthly)} × {renewMonths} bln</span>
                    <span>{rupiah(renewGross)}</span>
                  </div>
                  {renewDiscount > 0 && (
                    <div className="flex justify-between text-rose-600">
                      <span>Diskon</span>
                      <span>− {rupiah(renewForm.discountType === 'PER_MONTH' ? renewDiscount * renewMonths : renewDiscount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold text-slate-800 pt-1.5 border-t border-slate-200">
                    <span>Total</span>
                    <span>{rupiah(renewTotal)}</span>
                  </div>
                  {renewDp > 0 && (
                    <>
                      <div className="flex justify-between text-emerald-600">
                        <span>DP dibayar</span>
                        <span>− {rupiah(renewDp)}</span>
                      </div>
                      <div className={`flex justify-between font-bold pt-1.5 border-t border-slate-200 ${renewSisa > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        <span>{renewSisa > 0 ? 'Sisa kurang bayar' : 'Lunas'}</span>
                        <span>{rupiah(renewSisa)}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              <button type="submit" disabled={renew.isPending}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {renew.isPending && <Loader2 size={18} className="animate-spin" />}
                Perpanjang Kontrak
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
