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
  const trialExpired = !isPro && !trialActive;

  return (
    <div className="pricing-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pricing-modal">
        <button className="pricing-close" onClick={onClose} aria-label="Закрыть">×</button>

        <div className="pricing-header">
          <span className="micro-label">Тарифы</span>
          <h2>Полнофункциональный доступ для компании</h2>
          {trialActive && trialDaysLeft != null ? (
            <p className="pricing-trial-note">
              ⚡ Trial: ещё <strong>{trialDaysLeft}</strong> {trialDaysLeft === 1 ? 'день' : trialDaysLeft < 5 ? 'дня' : 'дней'} полного Pro-доступа
            </p>
          ) : trialExpired ? (
            <p className="pricing-trial-note">
              ⏰ Trial завершён. Без оплаты генерация, поиск, экспорт и сохранение отключены.
            </p>
          ) : (
            <p className="pricing-trial-note">
              Активный платный план: доступ открыт без ограничений.
            </p>
          )}
        </div>

        <div className="pricing-cards">
          <div className={`pricing-card ${trialActive ? 'current' : ''}`}>
            <div className="pricing-card-badge">Trial</div>
            <div className="pricing-card-price">
              <span className="pricing-amount">0</span>
              <span className="pricing-currency">₽</span>
              <span className="pricing-period">/14 дней</span>
            </div>
            <ul className="pricing-features">
              <li>Полный Pro-функционал без ограничений</li>
              <li>Генерация, поиск, DOCX, PDF, история</li>
              <li>Подходит для пилота и теста закупщиков</li>
              <li>После 14 дней нужен платный план</li>
            </ul>
            {trialActive ? (
              <div className="pricing-current-badge">Активен сейчас</div>
            ) : trialExpired ? (
              <div className="pricing-current-badge">Завершён</div>
            ) : null}
          </div>

          <div className={`pricing-card pricing-card-pro ${isPro ? 'current' : ''}`}>
            <div className="pricing-card-badge">Pro Business</div>
            <div className="pricing-card-price">
              <span className="pricing-amount">29 900</span>
              <span className="pricing-currency">₽</span>
              <span className="pricing-period">/мес</span>
            </div>
            <div className="pricing-card-subprice">за компанию · до 5 пользователей</div>
            <ul className="pricing-features">
              <li>♾️ Безлимитные ТЗ</li>
              <li>Встроенный AI (без ключа)</li>
              <li>Поиск по ЕИС</li>
              <li>Поиск в интернете</li>
              <li>Экспорт, история, автодоводка, import DOCX/XLSX</li>
            </ul>
            {isPro ? (
              <div className="pricing-current-badge">Текущий план</div>
            ) : (
              <button
                className="pricing-buy-btn"
                onClick={() => handlePay('pro')}
                disabled={loading !== null}
              >
                {loading === 'pro' ? 'Переход к оплате...' : 'Оформить Pro Business'}
              </button>
            )}
          </div>

          <div className="pricing-card pricing-card-annual">
            <div className="pricing-card-badge">Business Annual</div>
            <div className="pricing-card-save">2 месяца в подарок</div>
            <div className="pricing-card-price">
              <span className="pricing-amount">299 000</span>
              <span className="pricing-currency">₽</span>
              <span className="pricing-period">/год</span>
            </div>
            <div className="pricing-card-subprice">24 917 ₽/мес · за компанию</div>
            <ul className="pricing-features">
              <li>♾️ Всё из Pro Business</li>
              <li>12 месяцев доступа</li>
              <li>Оптимально для постоянной закупочной команды</li>
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
          <p>Оплата через ЮKassa • Банковские карты, СБП, ЮMoney</p>
          <p>Доступ активируется автоматически после подтверждения оплаты</p>
        </div>
      </div>
    </div>
  );
}
