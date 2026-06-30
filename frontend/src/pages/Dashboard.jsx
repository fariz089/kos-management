import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  DoorOpen, Banknote, Wallet, AlertTriangle, LogIn, LogOut,
  TrendingUp, CheckCircle2, CircleDollarSign, Receipt,
} from 'lucide-react';

const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const tgl = (d) => d ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
const hariLagi = (d) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = new Date(d); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - today) / 86400000);
  if (diff === 0) return 'hari ini';
  if (diff === 1) return 'besok';
  if (diff < 0) return `${Math.abs(diff)} hari lalu`;
  return `${diff} hari lagi`;
};

// Kartu statistik utama dengan rincian opsional
function StatCard({ icon: Icon, label, value, color, breakdown }) {
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600',
    purple: 'bg-purple-50 text-purple-600',
    teal: 'bg-teal-50 text-teal-600',
    slate: 'bg-slate-100 text-slate-600',
  };
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
      <div className="flex items-start gap-4">
        <div className={`p-3 rounded-xl shrink-0 ${colors[color]}`}>
          <Icon size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-500">{label}</p>
          <p className="text-2xl font-bold text-slate-900 leading-tight mt-0.5 break-words">{value}</p>
          {breakdown && breakdown.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {breakdown.map((b, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{b.label}</span>
                  <span className="font-medium text-slate-600">{b.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Distribusi penghuni per tahap lifecycle
function StageStrip({ stages }) {
  const items = [
    { key: 'RESERVED', label: 'Dipesan', color: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50', icon: CircleDollarSign },
    { key: 'UPCOMING', label: 'Akan Masuk', color: 'bg-blue-500', text: 'text-blue-700', bg: 'bg-blue-50', icon: LogIn },
    { key: 'ACTIVE', label: 'Aktif', color: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle2 },
    { key: 'FINISHED', label: 'Selesai', color: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-slate-100', icon: CheckCircle2 },
  ];
  const total = items.reduce((s, it) => s + (stages?.[it.key] || 0), 0);
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-800">Status Penghuni</h3>
        <span className="text-xs text-slate-400">{total} penghuni</span>
      </div>
      {/* Bar proporsi */}
      <div className="flex h-3 rounded-full overflow-hidden bg-slate-100 mb-4">
        {items.map((it) => {
          const v = stages?.[it.key] || 0;
          const pct = total > 0 ? (v / total) * 100 : 0;
          return pct > 0 ? <div key={it.key} className={it.color} style={{ width: `${pct}%` }} title={`${it.label}: ${v}`} /> : null;
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.key} className={`flex items-center gap-2 ${it.bg} rounded-xl px-3 py-2`}>
              <Icon size={16} className={it.text} />
              <span className="text-sm text-slate-600 flex-1">{it.label}</span>
              <span className={`text-sm font-bold ${it.text}`}>{stages?.[it.key] || 0}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Panel daftar (jatuh tempo / kurang bayar / akan masuk / akan keluar)
function ListPanel({ title, icon: Icon, items, empty, accent, render }) {
  const accents = {
    rose: 'text-rose-600 bg-rose-50',
    amber: 'text-amber-600 bg-amber-50',
    blue: 'text-blue-600 bg-blue-50',
    teal: 'text-teal-600 bg-teal-50',
  };
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
      <div className="flex items-center gap-2 mb-4">
        <div className={`p-1.5 rounded-lg ${accents[accent]}`}><Icon size={16} /></div>
        <h3 className="font-semibold text-slate-800">{title}</h3>
        {items?.length > 0 && <span className="ml-auto text-xs text-slate-400">{items.length}</span>}
      </div>
      {!items || items.length === 0 ? (
        <p className="text-slate-400 text-sm text-center py-8">{empty}</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-auto pr-1">
          {items.map(render)}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
      </div>
    );
  }

  const d = data || {};
  const inc = d.incomeBreakdown || {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Ringkasan kondisi kos — {d.monthLabel || 'bulan ini'}</p>
      </div>

      {/* Baris 1 — angka utama, masing-masing dengan rincian */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Banknote} color="emerald"
          label={`Pemasukan ${d.monthLabel || 'bulan ini'}`}
          value={rupiah(d.incomeThisMonth)}
          breakdown={[
            { label: 'Sewa', value: rupiah(inc.rent) },
            { label: 'DP / deposit', value: rupiah(inc.deposit) },
            ...(inc.other ? [{ label: 'Lainnya', value: rupiah(inc.other) }] : []),
          ]}
        />
        <StatCard
          icon={Wallet} color="amber"
          label="Total Kurang Bayar"
          value={rupiah(d.outstandingTotal)}
          breakdown={[
            { label: 'DP sudah masuk', value: rupiah(d.dpCollectedTotal) },
            { label: 'Jumlah tagihan', value: `${d.unpaidCount || 0} tagihan` },
          ]}
        />
        <StatCard
          icon={DoorOpen} color="blue"
          label="Kamar"
          value={`${d.occupiedRooms || 0}/${d.totalRooms || 0} terisi`}
          breakdown={[
            { label: 'Kosong', value: `${d.availableRooms || 0} kamar` },
            { label: 'Dipesan', value: `${d.reservedRooms || 0} kamar` },
            ...(d.maintenanceRooms ? [{ label: 'Perbaikan', value: `${d.maintenanceRooms} kamar` }] : []),
          ]}
        />
        <StatCard
          icon={AlertTriangle} color="rose"
          label="Jatuh Tempo"
          value={rupiah(d.overdueAmount)}
          breakdown={[
            { label: 'Jumlah tagihan', value: `${d.overdueCount || 0} tagihan` },
            { label: 'Tingkat hunian', value: `${d.occupancyRate || 0}%` },
          ]}
        />
      </div>

      {/* Baris 2 — status penghuni + akan masuk */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StageStrip stages={d.tenantStages} />
        <ListPanel
          title="Akan Masuk" icon={LogIn} accent="blue"
          items={d.upcomingMoveIns} empty="Belum ada yang akan masuk 📭"
          render={(t) => (
            <div key={t.id} className="flex items-center justify-between p-3 bg-blue-50/60 rounded-xl">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{t.name}</p>
                <p className="text-xs text-slate-500">Kamar {t.room} · masuk {tgl(t.date)}</p>
              </div>
              <div className="text-right shrink-0 ml-2">
                <span className="text-xs font-semibold text-blue-600">{hariLagi(t.date)}</span>
                {t.outstanding > 0 && (
                  <p className="text-xs text-amber-600 mt-0.5">kurang {rupiah(t.outstanding)}</p>
                )}
              </div>
            </div>
          )}
        />
      </div>

      {/* Baris 3 — kurang bayar (DP) + jatuh tempo */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ListPanel
          title="Kurang Bayar (DP masuk, ada sisa)" icon={CircleDollarSign} accent="amber"
          items={d.partialBills} empty="Tidak ada kurang bayar 🎉"
          render={(b) => (
            <div key={b.id} className="p-3 bg-amber-50/60 rounded-xl">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-800 truncate">{b.tenant}</p>
                <span className="text-xs text-slate-400 shrink-0 ml-2">Kamar {b.room}</span>
              </div>
              <div className="flex items-center justify-between mt-1.5 text-xs">
                <span className="text-emerald-600">dibayar {rupiah(b.paid)}</span>
                <span className="font-bold text-amber-600">sisa {rupiah(b.remaining)}</span>
              </div>
              {/* progress bar bayar */}
              <div className="h-1.5 bg-amber-100 rounded-full overflow-hidden mt-2">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${b.amount > 0 ? Math.min(100, (b.paid / b.amount) * 100) : 0}%` }} />
              </div>
            </div>
          )}
        />
        <ListPanel
          title="Tagihan Jatuh Tempo" icon={AlertTriangle} accent="rose"
          items={d.overdueBills} empty="Tidak ada tagihan jatuh tempo 🎉"
          render={(b) => (
            <div key={b.id} className="flex items-center justify-between p-3 bg-rose-50 rounded-xl">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{b.tenant}</p>
                <p className="text-xs text-slate-500">Kamar {b.room} · {b.type} · {tgl(b.dueDate)}</p>
              </div>
              <span className="text-sm font-bold text-rose-600 shrink-0 ml-2">{rupiah(b.remaining)}</span>
            </div>
          )}
        />
      </div>

      {/* Baris 4 — akan keluar + proyeksi */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ListPanel
          title="Akan Keluar" icon={LogOut} accent="teal"
          items={d.upcomingMoveOuts} empty="Belum ada yang akan keluar"
          render={(t) => (
            <div key={t.id} className="flex items-center justify-between p-3 bg-teal-50/60 rounded-xl">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{t.name}</p>
                <p className="text-xs text-slate-500">Kamar {t.room} · keluar {tgl(t.date)}</p>
              </div>
              <span className="text-xs font-semibold text-teal-600 shrink-0 ml-2">{hariLagi(t.date)}</span>
            </div>
          )}
        />
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-1.5 rounded-lg text-purple-600 bg-purple-50"><TrendingUp size={16} /></div>
            <h3 className="font-semibold text-slate-800">Ringkasan Keuangan {d.monthLabel || ''}</h3>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
              <div className="flex items-center gap-2">
                <Receipt size={16} className="text-slate-400" />
                <span className="text-sm text-slate-600">Target tagihan bulan ini</span>
              </div>
              <span className="text-sm font-semibold text-slate-800">{rupiah(d.projectedThisMonth)}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                <span className="text-sm text-slate-600">Sudah masuk</span>
              </div>
              <span className="text-sm font-semibold text-emerald-700">{rupiah(d.incomeThisMonth)}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-amber-50 rounded-xl">
              <div className="flex items-center gap-2">
                <Wallet size={16} className="text-amber-500" />
                <span className="text-sm text-slate-600">Belum tertagih (piutang)</span>
              </div>
              <span className="text-sm font-semibold text-amber-700">{rupiah(d.outstandingTotal)}</span>
            </div>
            {/* progress target vs masuk */}
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Pencapaian target</span>
                <span>{d.projectedThisMonth > 0 ? Math.round((d.incomeThisMonth / d.projectedThisMonth) * 100) : 0}%</span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-700"
                  style={{ width: `${d.projectedThisMonth > 0 ? Math.min(100, (d.incomeThisMonth / d.projectedThisMonth) * 100) : 0}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
