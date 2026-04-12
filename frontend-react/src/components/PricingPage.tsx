import { useEffect, useState } from 'react';
import { getPricingPlans, getUserStatus, isLoggedIn } from '../lib/backendApi';
import type { PricingPlan, UserStatus } from '../lib/backendApi';

type Props = {
  onBack: () => void;
};

const ANNUAL_DISCOUNT = 0.8;

function formatPrice(price: number, annual: boolean): string {
  if (price === 0) return 'БЕСПЛАТНО';
  if (annual) {
    const yearly = Math.round(price * 12 * ANNUAL_DISCOUNT);
    return yearly.toLocaleString('ru-RU');
  }
  return price.toLocaleString('ru-RU');
}

function planLabel(plan: string): string {
  const labels: Record<string, string> = {
    trial: 'Пробный', start: 'Старт', base: 'Базовый', team: 'Команда', corp: 'Корпоратив', admin: 'Admin',
  };
  return labels[plan] ?? plan;
}

export function PricingPage({ onBack }: Props) {
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [status, setStatus] = useState<UserStatus | null>(null);
  const [annual, setAnnual] = useState(false);
  const [contact, setContact] = useState('@andrei_sh_tech');
  const [showContact, setShowContact] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPricingPlans()
      .then((data) => { setPlans(data.plans); setContact(data.contact); })
      .catch(() => {})
      .finally(() => setLoading(false));
    if (isLoggedIn()) {
      getUserStatus().then(setStatus).catch(() => {});
    }
  }, []);

  const currentPlan = status?.plan ?? null;

  const getPeriodLabel = (plan: PricingPlan) => {
    if (plan.price === 0) return null;
    return annual ? '/год' : '/мес';
  };

  return (
    <div className="pricing-page">
      <div className="pricing-page__header">
        <button className="pricing-page__back" onClick={onBack}>← Назад</button>
        <h1 className="pricing-page__title">Тарифы</h1>
        <p className="pricing-page__subtitle">Выберите план для закупочной работы</p>

        <div className="pricing-page__toggle">
          <span className={!annual ? 'pricing-toggle-active' : ''}>Помесячно</span>
          <button
            className={`pricing-toggle-switch${annual ? ' pricing-toggle-switch--on' : ''}`}
            onClick={() => setAnnual((a) => !a)}
            aria-pressed={annual}
          >
            <span className="pricing-toggle-thumb" />
          </button>
          <span className={annual ? 'pricing-toggle-active' : ''}>
            Годовой <span className="pricing-toggle-badge">–20%</span>
          </span>
        </div>
      </div>

      {loading ? (
        <div className="pricing-page__loading">Загрузка тарифов…</div>
      ) : (
        <div className="pricing-page__cards">
          {plans.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            const isHighlight = !!plan.highlight;
            return (
              <div
                key={plan.id}
                className={[
                  'pricing-card-v2',
                  isHighlight ? 'pricing-card-v2--highlight' : '',
                  isCurrent ? 'pricing-card-v2--current' : '',
                ].filter(Boolean).join(' ')}
              >
                {isHighlight && <div className="pricing-card-v2__badge">★ Популярный</div>}
                {isCurrent && <div className="pricing-card-v2__current-label">Ваш тариф</div>}

                <div className="pricing-card-v2__name">{plan.name}</div>

                <div className="pricing-card-v2__price">
                  {plan.price === 0 ? (
                    <span className="pricing-card-v2__amount pricing-card-v2__amount--free">БЕСПЛАТНО</span>
                  ) : (
                    <>
                      <span className="pricing-card-v2__amount">{formatPrice(plan.price, annual)}</span>
                      <span className="pricing-card-v2__currency"> ₽</span>
                      <span className="pricing-card-v2__period">{getPeriodLabel(plan)}</span>
                    </>
                  )}
                </div>

                {annual && plan.price > 0 && (
                  <div className="pricing-card-v2__annual-note">
                    Вместо {(plan.price * 12).toLocaleString('ru-RU')} ₽/год
                  </div>
                )}

                <div className="pricing-card-v2__limit">
                  {plan.tz_limit != null
                    ? `${plan.tz_limit} ТЗ/${plan.tz_period ?? 'мес'}`
                    : 'Безлимит'}
                  {plan.days ? ` · ${plan.days} дней` : ''}
                </div>

                <ul className="pricing-card-v2__features">
                  {plan.features.map((f, i) => (
                    <li key={i}><span className="pricing-card-v2__check">✓</span> {f}</li>
                  ))}
                </ul>

                <div className="pricing-card-v2__action">
                  {isCurrent ? (
                    <button className="pricing-card-v2__btn pricing-card-v2__btn--current" disabled>
                      Ваш тариф
                    </button>
                  ) : plan.id === 'trial' ? (
                    <button className="pricing-card-v2__btn" onClick={onBack}>
                      Начать бесплатно
                    </button>
                  ) : plan.id === 'corp' ? (
                    <button
                      className="pricing-card-v2__btn pricing-card-v2__btn--outline"
                      onClick={() => setShowContact('corp')}
                    >
                      Запрос
                    </button>
                  ) : (
                    <button
                      className={`pricing-card-v2__btn${isHighlight ? ' pricing-card-v2__btn--primary' : ''}`}
                      onClick={() => setShowContact(plan.id)}
                    >
                      Подключить
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="pricing-page__annual-note">
        При оплате за год — скидка 20%
      </div>

      <div className="pricing-page__trust">
        <span>Оплата по счёту для юридических лиц · Договор и закрывающие документы</span>
        <span>Вопросы по тарифам: <strong>{contact}</strong> в Telegram</span>
      </div>

      {showContact && (
        <div className="pricing-contact-overlay" onClick={() => setShowContact(null)}>
          <div className="pricing-contact-modal" onClick={(e) => e.stopPropagation()}>
            <button className="pricing-contact-modal__close" onClick={() => setShowContact(null)}>×</button>
            <h3>Подключение тарифа «{planLabel(showContact)}»</h3>
            <p>Для оплаты и активации тарифа напишите нам в Telegram:</p>
            <a
              className="pricing-contact-modal__tg"
              href={`https://t.me/${contact.replace('@', '')}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {contact}
            </a>
            <p className="pricing-contact-modal__note">
              После оплаты доступ активируется в течение нескольких минут.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
