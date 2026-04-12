import { useEffect, useState } from 'react';
import { getUserStatus, isLoggedIn } from '../lib/backendApi';
import type { UserStatus } from '../lib/backendApi';

type Props = {
  onGoToPricing: () => void;
  refreshTick?: number;
};

export function TrialBanner({ onGoToPricing, refreshTick }: Props) {
  const [status, setStatus] = useState<UserStatus | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) return;
    getUserStatus().then(setStatus).catch(() => {});
  }, [refreshTick]);

  if (!status) return null;
  const { plan, access, trial_tz_used, trial_tz_total, trial_tz_left, trial_days_left } = status;

  if (plan === 'admin') return null;

  const used = trial_tz_used ?? 0;
  const total = trial_tz_total ?? 3;
  const left = trial_tz_left ?? Math.max(0, total - used);
  const days = trial_days_left ?? 0;
  const pct = Math.min(100, Math.round((used / total) * 100));

  const barColor = used >= total ? '#ef4444' : used >= 2 ? '#f59e0b' : '#22c55e';

  const getMessage = () => {
    if (used === 0) return `Добро пожаловать! Осталось ${left} бесплатных ТЗ`;
    if (used === 1) return `Отличный старт! Осталось ${left} бесплатных ТЗ`;
    if (used === 2) return `Осталось ${left} бесплатное ТЗ · Не потеряйте доступ`;
    return 'Бесплатные ТЗ закончились · Выберите тариф';
  };

  if (plan === 'trial' && access.allowed) {
    return (
      <div className="trial-banner trial-banner-v2">
        <div className="trial-banner-v2__left">
          <div className="trial-banner-v2__bar-wrap">
            <div
              className="trial-banner-v2__bar"
              style={{ width: `${pct}%`, background: barColor }}
            />
          </div>
          <span className="trial-banner-v2__text">
            {getMessage()} · <strong>{days}</strong> {days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}
          </span>
        </div>
        <button className="trial-banner-v2__btn" onClick={onGoToPricing}>
          Выбрать тариф →
        </button>
      </div>
    );
  }

  if (plan === 'trial' && !access.allowed && access.reason === 'trial_limit') {
    return (
      <div className="trial-banner trial-banner-v2 trial-banner-v2--expired">
        <span className="trial-banner-v2__text">
          Вы использовали все {total} бесплатных ТЗ
        </span>
        <button className="trial-banner-v2__btn trial-banner-v2__btn--cta" onClick={onGoToPricing}>
          Продолжить работу — от 1 900 ₽/мес
        </button>
      </div>
    );
  }

  if (plan === 'trial' && !access.allowed && access.reason === 'trial_expired') {
    return (
      <div className="trial-banner trial-banner-v2 trial-banner-v2--expired">
        <span className="trial-banner-v2__text">
          Пробный период завершён (14 дней)
        </span>
        <button className="trial-banner-v2__btn trial-banner-v2__btn--cta" onClick={onGoToPricing}>
          Выбрать тариф
        </button>
      </div>
    );
  }

  return null;
}
