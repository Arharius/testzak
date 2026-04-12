type PaymentSuccessPageProps = {
  onGoHome: () => void;
};

export function PaymentSuccessPage({ onGoHome }: PaymentSuccessPageProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
        padding: 24,
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: '48px 56px',
          maxWidth: 480,
          width: '100%',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: '0 0 12px' }}>
          Тариф активирован
        </h1>
        <p style={{ fontSize: 15, color: '#475569', lineHeight: 1.6, margin: '0 0 32px' }}>
          Оплата прошла успешно. Ваш тариф уже активен — можно начинать генерацию ТЗ.
        </p>
        <button
          type="button"
          onClick={onGoHome}
          style={{
            display: 'inline-block',
            padding: '12px 32px',
            background: '#1d4ed8',
            color: '#fff',
            borderRadius: 8,
            border: 'none',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
            textDecoration: 'none',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#1e40af'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#1d4ed8'; }}
        >
          Перейти в рабочую область
        </button>
      </div>
    </div>
  );
}
