import { useState } from 'react';
import { createPayment } from '../lib/backendApi';

type Props = {
  onClose: () => void;
  currentRole?: string;
  trialActive?: boolean;
  trialDaysLeft?: number;
};

export function PricingModal({ onClose, currentRole, trialActive, trialDaysLeft }: Props) {
  const [loading, setLoading] = useState<'pro' | 'annual' | null>(null);
  const [error, setError] = useState('');

  const handlePay = async (plan: 'pro' | 'annual') => {
    setLoading(plan);
    setError('');
    try {
      const res = await createPayment(plan);
      if (res.confirmation_url) {
        window.location.href = res.confirmation_url;
      } else {
        setError('Не удалось создать платёж. Попробуйте позже.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка оплаты');
    } finally {
      setLoading(null);
    }
  };

  const isPro = currentRole === 'pro' || currentRole === 'admin';

  return (
    <div className="pricing-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pricing-modal">
        <button className="pricing-close" onClick={onClose} aria-label="Закрыть">×</button>

        <div className="pricing-header">
          <span className="micro-label">Тарифы</span>
          <h2>Выберите план</h2>
          {trialActive && trialDaysLeft != null && (
            <p className="pricing-trial-note">
              ⚡ Пробный период: ещё <strong>{trialDaysLeft}</strong> {trialDaysLeft === 1 ? 'день' : trialDaysLeft < 5 ? 'дня' : 'дней'}
            </p>
          )}
        </div>

        <div className="pricing-cards">
          {/* Free */}
          <div className={`pricing-card ${!isPro && !trialActive ? 'current' : ''}`}>
            <div className="pricing-card-badge">Free</div>
            <div className="pricing-card-price">
              <span className="pricing-amount">0</span>
              <span className="pricing-currency">₽</span>
            </div>
            <ul className="pricing-features">
              <li>3 ТЗ в месяц</li>
              <li>91 тип товара</li>
              <li>DOCX + PDF экспорт</li>
              <li>Нужен свой API-ключ</li>
            </ul>
            {!isPro && !trialActive && (
              <div className="pricing-current-badge">Текущий план</div>
            )}
          </div>

          {/* Pro Monthly */}
          <div className={`pricing-card pricing-card-pro ${isPro ? 'current' : ''}`}>
            <div className="pricing-card-badge">Pro</div>
            <div className="pricing-card-price">
              <span className="pricing-amount">1 500</span>
              <span className="pricing-currency">₽</span>
              <span className="pricing-period">/мес</span>
            </div>
            <ul className="pricing-features">
              <li>♾️ Безлимитные ТЗ</li>
              <li>Встроенный AI (без ключа)</li>
              <li>Поиск по ЕИС</li>
              <li>Поиск в интернете</li>
              <li>Приоритетная генерация</li>
            </ul>
            {isPro ? (
              <div className="pricing-current-badge">Текущий план</div>
            ) : (
              <button
                className="pricing-buy-btn"
                onClick={() => handlePay('pro')}
                disabled={loading !== null}
              >
                {loading === 'pro' ? 'Переход к оплате...' : 'Оформить Pro'}
              </button>
            )}
          </div>

          {/* Annual */}
          <div className="pricing-card pricing-card-annual">
            <div className="pricing-card-badge">Годовой</div>
            <div className="pricing-card-save">Экономия 33%</div>
            <div className="pricing-card-price">
              <span className="pricing-amount">12 000</span>
              <span className="pricing-currency">₽</span>
              <span className="pricing-period">/год</span>
            </div>
            <div className="pricing-card-subprice">1 000 ₽/мес</div>
            <ul className="pricing-features">
              <li>♾️ Всё из Pro</li>
              <li>12 месяцев доступа</li>
              <li>Фиксированная цена</li>
            </ul>
            {isPro ? (
              <div className="pricing-current-badge">Текущий план</div>
            ) : (
              <button
                className="pricing-buy-btn pricing-buy-annual"
                onClick={() => handlePay('annual')}
                disabled={loading !== null}
              >
                {loading === 'annual' ? 'Переход к оплате...' : 'Оформить на год'}
              </button>
            )}
          </div>
        </div>

        {error && <div className="pricing-error">{error}</div>}

        <div className="pricing-footer">
          <p>Оплата через ЮКасса • Банковские карты, СБП, ЮMoney</p>
          <p>После оплаты доступ активируется автоматически</p>
        </div>
      </div>
    </div>
  );
}
