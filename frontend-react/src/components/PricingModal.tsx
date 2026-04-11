import { useState } from 'react';
import { createPayment } from '../lib/backendApi';

type Props = {
  onClose: () => void;
  currentRole?: string;
  trialActive?: boolean;
  trialTzLeft?: number;
  trialTzTotal?: number;
  tzCount?: number;
};

const PLANS = [
  {
    id: 'starter',
    badge: 'Старт',
    price: '1 900',
    period: '/мес',
    sub: 'Фрилансер, ИП',
    limit: '15 ТЗ/мес',
    features: [
      '15 технических заданий в месяц',
      'Генерация по 44-ФЗ и 223-ФЗ',
      'Экспорт в DOCX (ГОСТ-совместимый)',
      'История сохранённых ТЗ',
      'Базовая проверка на ФАС-риски',
    ],
    highlight: false,
    payPlan: 'starter' as const,
  },
  {
    id: 'basic',
    badge: 'Базовый',
    price: '4 900',
    priceSale: '2 450',
    saleNote: 'для первых 20 клиентов — 3 мес.',
    period: '/мес',
    sub: 'Малый бизнес, 1 пользователь',
    limit: '50 ТЗ/мес',
    features: [
      '50 технических заданий в месяц',
      'Автопоиск характеристик по datasheet',
      'Исправление загруженных DOCX/XLSX',
      'Двойной эквивалент (ДЭ-алгоритм)',
      'Авто-аудит ТЗ по 9 контрольным пунктам',
      'Поиск по ЕИС zakupki.gov.ru',
    ],
    highlight: true,
    payPlan: 'pro' as const,
  },
  {
    id: 'team',
    badge: 'Команда',
    price: '12 900',
    period: '/мес',
    sub: 'Отдел закупок, до 5 человек',
    limit: 'Безлимит',
    features: [
      'Безлимитные ТЗ в месяц',
      'До 5 пользователей в команде',
      'Все функции тарифа Базовый',
      'Выгрузка в Word (ГОСТ-совместимый)',
      'Приоритетная поддержка',
    ],
    highlight: false,
    payPlan: 'annual' as const,
  },
  {
    id: 'enterprise',
    badge: 'Корпоратив',
    price: 'от 35 000',
    period: '/мес',
    sub: 'Госструктуры, крупный бизнес',
    limit: 'Безлимит + API',
    features: [
      'Безлимитные ТЗ для всей организации',
      'REST API для интеграции с ЕИС/СЭД',
      'Выделенный менеджер поддержки',
      'Обучение сотрудников (онлайн)',
      'SLA 99.9%, отчёты об использовании',
    ],
    highlight: false,
    payPlan: null,
  },
];

export function PricingModal({ onClose, currentRole, trialActive, trialTzLeft, trialTzTotal, tzCount }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  const isPro = currentRole === 'pro' || currentRole === 'admin';
  const total = trialTzTotal ?? 3;
  const used = tzCount ?? 0;
  const left = trialTzLeft ?? Math.max(0, total - used);
  const trialExpired = !isPro && !trialActive;

  const handlePay = async (plan: 'starter' | 'pro' | 'annual') => {
    setLoading(plan);
    setError('');
    try {
      const res = await createPayment(plan);
      if (res.confirmation_url) {
        window.location.href = res.confirmation_url;
      } else {
        setError('Не удалось создать платёж. Попробуйте позже или свяжитесь с нами.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка оплаты');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="pricing-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pricing-modal pricing-modal--wide">
        <button className="pricing-close" onClick={onClose} aria-label="Закрыть">×</button>

        <div className="pricing-header">
          <span className="micro-label">Тарифы</span>
          <h2>Выберите план для закупочной работы</h2>
          {trialActive && left > 0 ? (
            <p className="pricing-trial-note">
              Пробный доступ: осталось <strong>{left} из {total}</strong> бесплатных ТЗ — все функции активны
            </p>
          ) : trialExpired ? (
            <p className="pricing-trial-note pricing-trial-note--expired">
              Бесплатные ТЗ использованы. Выберите план для продолжения работы.
            </p>
          ) : (
            <p className="pricing-trial-note">
              Активный платный план — доступ открыт.
            </p>
          )}
        </div>

        <div className="pricing-cards pricing-cards--four">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`pricing-card${plan.highlight ? ' pricing-card-pro' : ''}${isPro && plan.id === 'basic' ? ' current' : ''}`}
            >
              {plan.highlight && <div className="pricing-card-popular">Популярный</div>}
              <div className="pricing-card-badge">{plan.badge}</div>

              <div className="pricing-card-price">
                {plan.priceSale ? (
                  <>
                    <span className="pricing-amount pricing-amount--sale">{plan.priceSale}</span>
                    <span className="pricing-currency">₽</span>
                    <span className="pricing-period">{plan.period}</span>
                    <div className="pricing-old-price">{plan.price} ₽/мес</div>
                  </>
                ) : (
                  <>
                    <span className="pricing-amount">{plan.price}</span>
                    <span className="pricing-currency">₽</span>
                    <span className="pricing-period">{plan.period}</span>
                  </>
                )}
              </div>

              <div className="pricing-card-subprice">{plan.sub}</div>
              <div className="pricing-card-limit">{plan.limit}</div>

              {plan.saleNote && (
                <div className="pricing-sale-note">{plan.saleNote}</div>
              )}

              <ul className="pricing-features">
                {plan.features.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>

              {isPro && plan.id === 'basic' ? (
                <div className="pricing-current-badge">Текущий план</div>
              ) : plan.payPlan ? (
                <button
                  className={`pricing-buy-btn${plan.highlight ? ' pricing-buy-btn--highlight' : ''}`}
                  onClick={() => handlePay(plan.payPlan as 'starter' | 'pro' | 'annual')}
                  disabled={loading !== null}
                >
                  {loading === plan.payPlan ? 'Переход к оплате...' : `Выбрать ${plan.badge}`}
                </button>
              ) : (
                <a
                  className="pricing-buy-btn pricing-buy-btn--outline"
                  href="mailto:sales@tz-generator.ru?subject=Запрос на Корпоратив"
                >
                  Связаться с нами
                </a>
              )}
            </div>
          ))}
        </div>

        {error && <div className="pricing-error">{error}</div>}

        <div className="pricing-sale-banner">
          Первым 20 клиентам — скидка 50% на тариф Базовый на 3 месяца (2 450 ₽/мес вместо 4 900 ₽) при условии отзыва о сервисе
        </div>

        <div className="pricing-footer">
          <p>Оплата через ЮKassa — банковские карты, СБП, ЮMoney</p>
          <p>Доступ активируется автоматически после подтверждения оплаты</p>
        </div>
      </div>
    </div>
  );
}
