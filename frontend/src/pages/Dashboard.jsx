import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { DoorOpen, Users, Receipt, AlertTriangle, TrendingUp, Banknote } from 'lucide-react';

function StatCard({ icon: Icon, label, value, sub, color }) {
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
    teal: 'bg-teal-50 text-teal-600',
  };
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-xl ${colors[color]}`}>
          <Icon size={24} />
        </div>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
          {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

function OccupancyBar({ occupied, total }) {
  const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
      <h3 className="font-semibold text-slate-800 mb-4">Tingkat Hunian</h3>
      <div className="flex items-end gap-4 mb-3">
        <span className="text-4xl font-bold text-emerald-600">{pct}%</span>
        <span className="text-sm text-slate-400 pb-1">{occupied} dari {total} kamar terisi</span>
      </div>
      <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function OverdueBills({ bills }) {
  if (!bills || bills.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
        <h3 className="font-semibold text-slate-800 mb-4">Tagihan Jatuh Tempo</h3>
        <p className="text-slate-400 text-sm text-center py-8">Tidak ada tagihan jatuh tempo 🎉</p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
      <h3 className="font-semibold text-slate-800 mb-4">Tagihan Jatuh Tempo</h3>
      <div className="space-y-3 max-h-64 overflow-auto">
        {bills.map((b) => (
          <div key={b.id} className="flex items-center justify-between p-3 bg-red-50 rounded-xl">
            <div>
              <p className="text-sm font-medium text-slate-800">{b.tenant?.name || 'N/A'}</p>
              <p className="text-xs text-slate-500">Kamar {b.tenant?.room?.number || '-'} — {b.type}</p>
            </div>
            <span className="text-sm font-bold text-red-600">
              Rp {Number(b.amount).toLocaleString('id-ID')}
            </span>
          </div>
        ))}
      </div>
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Ringkasan kondisi kos-kosan kamu</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={DoorOpen} label="Total Kamar" value={d.totalRooms || 0} sub={`${d.availableRooms || 0} tersedia`} color="blue" />
        <StatCard icon={Users} label="Penghuni Aktif" value={d.activeTenants || 0} color="emerald" />
        <StatCard icon={Receipt} label="Tagihan Bulan Ini" value={`Rp ${Number(d.totalBillingThisMonth || 0).toLocaleString('id-ID')}`} color="purple" />
        <StatCard icon={Banknote} label="Pemasukan Bulan Ini" value={`Rp ${Number(d.paidThisMonth || 0).toLocaleString('id-ID')}`} color="teal" />
        <StatCard icon={AlertTriangle} label="Belum Bayar" value={d.unpaidBills || 0} sub="tagihan" color="amber" />
        <StatCard icon={TrendingUp} label="Occupancy Rate" value={`${d.occupancyRate || 0}%`} color="emerald" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OccupancyBar occupied={d.occupiedRooms || 0} total={d.totalRooms || 0} />
        <OverdueBills bills={d.overdueBills} />
      </div>
    </div>
  );
}
