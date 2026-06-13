import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export default function PaymentFinish() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('order_id') || '-';
  const statusCode = searchParams.get('status_code');
  const transactionStatus = searchParams.get('transaction_status');
  const [synced, setSynced] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const isSuccess = statusCode === '200' && ['capture', 'settlement'].includes(transactionStatus);
  const isPending = transactionStatus === 'pending';

  // Auto-sync payment status with backend (bypass broken webhook)
  useEffect(() => {
    if (!orderId || orderId === '-') return;

    const syncPayment = async () => {
      try {
        const res = await fetch('/api/payments/sync-by-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
        });
        const data = await res.json();
        if (data.status === 'SUCCESS') {
          setSynced(true);
          setSyncMsg('Status pembayaran berhasil disinkronkan!');
        }
      } catch (e) {
        console.error('Sync error:', e);
      }
    };

    // Try immediately, then retry after 3s and 8s (Midtrans sometimes delays)
    syncPayment();
    const t1 = setTimeout(syncPayment, 3000);
    const t2 = setTimeout(syncPayment, 8000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [orderId]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: isSuccess ? 'linear-gradient(135deg, #e0f7ee 0%, #f0fdf4 100%)'
        : isPending ? 'linear-gradient(135deg, #fef9e7 0%, #fffdf0 100%)'
        : 'linear-gradient(135deg, #fde8e8 0%, #fff5f5 100%)',
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      padding: '20px',
    }}>
      <div style={{
        background: 'white',
        borderRadius: '20px',
        padding: '48px 40px',
        maxWidth: '440px',
        width: '100%',
        textAlign: 'center',
        boxShadow: '0 20px 60px rgba(0,0,0,0.08)',
      }}>
        <div style={{
          width: '80px', height: '80px', borderRadius: '50%',
          margin: '0 auto 24px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: '40px',
          background: isSuccess ? '#d1fae5' : isPending ? '#fef3c7' : '#fee2e2',
        }}>
          {isSuccess ? '✅' : isPending ? '⏳' : '❌'}
        </div>

        <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#1a1a1a', margin: '0 0 8px' }}>
          {isSuccess ? 'Pembayaran Berhasil!' : isPending ? 'Menunggu Pembayaran' : 'Pembayaran Gagal'}
        </h1>

        <p style={{ fontSize: '15px', color: '#6b7280', margin: '0 0 12px', lineHeight: '1.5' }}>
          {isSuccess
            ? 'Terima kasih! Pembayaran kamu sudah kami terima. Kamu akan menerima konfirmasi via WhatsApp.'
            : isPending
            ? 'Pembayaran sedang diproses. Kamu akan menerima notifikasi setelah pembayaran terkonfirmasi.'
            : 'Pembayaran gagal atau dibatalkan. Silakan coba lagi atau hubungi admin.'}
        </p>

        {synced && (
          <p style={{ fontSize: '13px', color: '#059669', margin: '0 0 20px', fontWeight: '600' }}>
            ✓ {syncMsg}
          </p>
        )}

        <div style={{
          background: '#f9fafb', borderRadius: '12px',
          padding: '16px', marginBottom: '28px',
        }}>
          <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Order ID
          </div>
          <div style={{ fontSize: '14px', color: '#374151', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {orderId}
          </div>
        </div>

        <a href="/" style={{
          display: 'inline-block', padding: '14px 32px', borderRadius: '12px',
          background: isSuccess ? '#059669' : '#3b82f6', color: 'white',
          textDecoration: 'none', fontSize: '15px', fontWeight: '600',
        }}>
          Kembali ke Dashboard
        </a>
      </div>
    </div>
  );
}
