import { useState, useEffect } from 'react';
import { isLoggedIn, getUserStatus } from '../lib/backendApi';
import type { UserStatus } from '../lib/backendApi';

type Props = {
  onBack: () => void;
  onRegister?: (plan?: string) => void;
};

const PLANS = [
  {
    id: 'trial',
    name: 'Триал',
    price: 0,
    period: null,
    badge: null,
    cta: 'Начать бесплатно',
    ctaType: 'outline' as const,
    features: [
      '3 технических задания',
      '14 дней',
      'Все функции',
      'QA-проверка документа',
    ],
  },
  {
    id: 'start',
    name: 'Старт',
    price: 1900,
    period: '/мес',
    badge: null,
    cta: 'Выбрать',
    ctaType: 'default' as const,
    features: [
      '15 ТЗ в месяц',
      'История генераций',
      'Скачать DOCX и PDF',
      'Email-поддержка',
    ],
  },
  {
    id: 'base',
    name: 'Базовый',
    price: 4900,
    period: '/мес',
    badge: 'Популярный',
    cta: 'Выбрать',
    ctaType: 'primary' as const,
    features: [
      '50 ТЗ в месяц',
      'Автоисправление ошибок',
      'Приоритетная поддержка',
    ],
  },
  {
    id: 'team',
    name: 'Команда',
    price: 12900,
    period: '/мес',
    badge: null,
    cta: 'Выбрать',
    ctaType: 'default' as const,
    features: [
      'Безлимит ТЗ',
      'До 5 пользователей',
      'Общая история команды',
    ],
  },
  {
    id: 'corp',
    name: 'Корп',
    price: 35000,
    period: '/мес',
    badge: null,
    cta: 'Связаться',
    ctaType: 'outline' as const,
    features: [
      'Безлимит ТЗ',
      'Безлимит пользователей',
      'API доступ',
      'Персональный менеджер',
      'Пилот 90 дней для ФГУП',
    ],
  },
];

const FAQ = [
  {
    q: 'Можно ли сменить тариф?',
    a: 'Да, в любой момент. При переходе на высший — пересчёт пропорционально оставшемуся периоду.',
  },
  {
    q: 'Как работает командный доступ?',
    a: 'Владелец приглашает коллег по email, они работают в общем пространстве с общим лимитом.',
  },
  {
    q: 'Есть ли возврат?',
    a: 'Да, в течение 3 дней с момента оплаты.',
  },
  {
    q: 'Подходит ли для ФГУП и госструктур?',
    a: 'Да. Предоставляем закрывающие документы для 223-ФЗ.',
  },
];

function formatPrice(price: number, annual: boolean): string {
  if (price === 0) return 'Бесплатно';
  if (annual) return Math.round(price * 12 * 0.8).toLocaleString('ru-RU');
  return price.toLocaleString('ru-RU');
}

function getPeriodLabel(price: number, annual: boolean): string | null {
  if (price === 0) return null;
  return annual ? '/год' : '/мес';
}

function detectCurrentPlan(status: UserStatus | null): string | null {
  if (!status) return null;
  return status.plan ?? null;
}

export function PricingPage({ onBack, onRegister }: Props) {
  const [annual, setAnnual] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [showContact, setShowContact] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', email: '', phone: '' });
  const [contactSent, setContactSent] = useState(false);
  const [userStatus, setUserStatus] = useState<UserStatus | null>(null);
  const loggedIn = isLoggedIn();

  useEffect(() => {
    if (loggedIn) {
      getUserStatus().then(setUserStatus).catch(() => {});
    }
  }, [loggedIn]);

  const currentPlan = detectCurrentPlan(userStatus);

  function handlePlanClick(planId: string) {
    if (planId === 'corp') {
      setShowContact(true);
      return;
    }
    if (!loggedIn) {
      if (onRegister) {
        onRegister(planId === 'trial' ? undefined : planId);
      } else {
        onBack();
      }
      return;
    }
    // Logged in — show telegram/contact for payment
    setShowContact(true);
  }

  function handleContactSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { name, email, phone } = contactForm;
    const mailto = `mailto:support@tz-generator.ru?subject=${encodeURIComponent('Запрос на подключение')}&body=${encodeURIComponent(`Имя: ${name}\nEmail: ${email}\nТелефон: ${phone}`)}`;
    window.open(mailto, '_blank');
    setContactSent(true);
  }

  return (
    <div className="pp-root">
      {/* Back button */}
      <button className="pp-back" onClick={onBack}>
        ← Назад
      </button>

      {/* Header */}
      <div className="pp-header">
        <h1 className="pp-title">Выберите тариф</h1>
        <p className="pp-subtitle">
          Генерируйте ТЗ для госзакупок по 44-ФЗ<br />в 24 раза быстрее
        </p>

        {/* Toggle */}
        <div className="pp-toggle">
          <button
            className={`pp-toggle-btn${!annual ? ' pp-toggle-btn--active' : ''}`}
            onClick={() => setAnnual(false)}
          >
            Помесячно
          </button>
          <button
            className={`pp-toggle-btn${annual ? ' pp-toggle-btn--active' : ''}`}
            onClick={() => setAnnual(true)}
          >
            Годовой&nbsp;<span className="pp-toggle-discount">−20%</span>
          </button>
        </div>
      </div>

      {/* Cards */}
      <div className="pp-cards">
        {PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.id;
          const isPopular = plan.id === 'base';
          return (
            <div
              key={plan.id}
              className={[
                'pp-card',
                isPopular ? 'pp-card--popular' : '',
                isCurrent ? 'pp-card--current' : '',
              ].filter(Boolean).join(' ')}
            >
              {plan.badge && (
                <div className="pp-card-badge">{plan.badge}</div>
              )}

              <div className="pp-card-name">{plan.name}</div>

              <div className="pp-card-price">
                {plan.price === 0 ? (
                  <span className="pp-card-amount pp-card-amount--free">Бесплатно</span>
                ) : (
                  <>
                    <span className="pp-card-amount">{formatPrice(plan.price, annual)}</span>
                    <span className="pp-card-currency"> ₽</span>
                    <span className="pp-card-period">{getPeriodLabel(plan.price, annual)}</span>
                  </>
                )}
              </div>

              {annual && plan.price > 0 && (
                <div className="pp-card-annual-note">
                  Вместо {(plan.price * 12).toLocaleString('ru-RU')} ₽/год
                </div>
              )}

              <ul className="pp-card-features">
                {plan.features.map((f, i) => (
                  <li key={i}><span className="pp-card-check">✓</span>{f}</li>
                ))}
              </ul>

              <div className="pp-card-action">
                {isCurrent ? (
                  <button className="pp-btn pp-btn--current" disabled>
                    Ваш тариф
                  </button>
                ) : (
                  <button
                    className={[
                      'pp-btn',
                      plan.ctaType === 'primary' ? 'pp-btn--primary' : '',
                      plan.ctaType === 'outline' ? 'pp-btn--outline' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => handlePlanClick(plan.id)}
                  >
                    {plan.cta}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* FAQ */}
      <div className="pp-faq">
        <h2 className="pp-faq-title">Частые вопросы</h2>
        {FAQ.map((item, i) => (
          <div key={i} className="pp-faq-item">
            <button
              className="pp-faq-q"
              onClick={() => setOpenFaq(openFaq === i ? null : i)}
              aria-expanded={openFaq === i}
            >
              <span>{item.q}</span>
              <span className="pp-faq-arrow">{openFaq === i ? '▲' : '▼'}</span>
            </button>
            {openFaq === i && (
              <div className="pp-faq-a">{item.a}</div>
            )}
          </div>
        ))}
      </div>

      {/* Footer trust */}
      <div className="pp-trust">
        Оплата по счёту для юридических лиц · Договор и закрывающие документы
      </div>

      {/* Contact modal */}
      {showContact && (
        <div className="pp-overlay" onClick={() => { setShowContact(false); setContactSent(false); }}>
          <div className="pp-modal" onClick={(e) => e.stopPropagation()}>
            <button className="pp-modal-close" onClick={() => { setShowContact(false); setContactSent(false); }}>×</button>
            {contactSent ? (
              <>
                <h3 className="pp-modal-title">Спасибо!</h3>
                <p className="pp-modal-text">Письмо сформировано. Мы свяжемся с вами в ближайшее время.</p>
                <button className="pp-btn pp-btn--primary" onClick={() => { setShowContact(false); setContactSent(false); }}>
                  Закрыть
                </button>
              </>
            ) : (
              <>
                <h3 className="pp-modal-title">Свяжитесь с нами</h3>
                <p className="pp-modal-text">Заполните форму — мы пришлём детали подключения.</p>
                <form className="pp-modal-form" onSubmit={handleContactSubmit}>
                  <input
                    className="pp-modal-input"
                    type="text"
                    placeholder="Ваше имя"
                    required
                    value={contactForm.name}
                    onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                  />
                  <input
                    className="pp-modal-input"
                    type="email"
                    placeholder="Email"
                    required
                    value={contactForm.email}
                    onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                  />
                  <input
                    className="pp-modal-input"
                    type="tel"
                    placeholder="Телефон"
                    value={contactForm.phone}
                    onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                  />
                  <button className="pp-btn pp-btn--primary" type="submit" style={{ width: '100%', marginTop: '4px' }}>
                    Отправить
                  </button>
                </form>
                <p className="pp-modal-note">
                  Или напишите напрямую: <a href="https://t.me/andrei_sh_tech" target="_blank" rel="noopener noreferrer">@andrei_sh_tech</a>
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
