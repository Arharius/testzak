import { useState } from 'react';
import { getPlatformSettings, setPlatformSettings } from '../lib/storage';

type Props = {
  onClose: () => void;
};

export function OnboardingModal({ onClose }: Props) {
  const [step, setStep] = useState(1);
  const [orgName, setOrgName] = useState('');
  const [inn, setInn] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [signatoryName, setSignatoryName] = useState('');
  const [signatoryTitle, setSignatoryTitle] = useState('');

  const handleFinish = () => {
    const current = getPlatformSettings();
    setPlatformSettings({
      ...current,
      orgName: orgName.trim() || current.orgName,
      customerInn: inn.trim() || current.customerInn,
      deliveryAddress: deliveryAddress.trim() || current.deliveryAddress,
      approvalPersonName: signatoryName.trim() || current.approvalPersonName,
      approvalPersonTitle: signatoryTitle.trim() || current.approvalPersonTitle,
    });
    try {
      localStorage.setItem('tz_onboarding_done', '1');
    } catch { /* ignore */ }
    onClose();
  };

  return (
    <div className="onb-overlay">
      <div className="onb-modal">
        <div className="onb-progress">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`onb-dot ${step >= n ? 'onb-dot--active' : ''} ${step > n ? 'onb-dot--done' : ''}`}
            />
          ))}
        </div>

        {step === 1 && (
          <>
            <div className="onb-step-label">Шаг 1 из 3</div>
            <h2 className="onb-title">Давайте настроим ваш профиль</h2>
            <p className="onb-desc">Эти данные будут автоматически подставляться в каждое ТЗ.</p>
            <div className="onb-field-group">
              <label className="onb-label">Название организации</label>
              <input
                className="onb-input"
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="ФГБУ «Центр закупок» Минздрава России"
              />
            </div>
            <div className="onb-field-group">
              <label className="onb-label">ИНН</label>
              <input
                className="onb-input"
                type="text"
                value={inn}
                onChange={(e) => setInn(e.target.value.replace(/\D/g, '').slice(0, 12))}
                placeholder="7700000000"
                maxLength={12}
              />
            </div>
            <div className="onb-actions">
              <button className="onb-skip" onClick={handleFinish}>Пропустить</button>
              <button className="onb-next" onClick={() => setStep(2)}>Далее →</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="onb-step-label">Шаг 2 из 3</div>
            <h2 className="onb-title">Реквизиты для ТЗ</h2>
            <p className="onb-desc">Используются в разделах «Заказчик» и грифе УТВЕРЖДАЮ.</p>
            <div className="onb-field-group">
              <label className="onb-label">Адрес доставки</label>
              <input
                className="onb-input"
                type="text"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder="г. Москва, ул. Примерная, д. 1"
              />
            </div>
            <div className="onb-field-group">
              <label className="onb-label">ФИО подписанта</label>
              <input
                className="onb-input"
                type="text"
                value={signatoryName}
                onChange={(e) => setSignatoryName(e.target.value)}
                placeholder="Иванов Иван Иванович"
              />
            </div>
            <div className="onb-field-group">
              <label className="onb-label">Должность</label>
              <input
                className="onb-input"
                type="text"
                value={signatoryTitle}
                onChange={(e) => setSignatoryTitle(e.target.value)}
                placeholder="Начальник отдела закупок"
              />
            </div>
            <div className="onb-actions">
              <button className="onb-skip" onClick={() => setStep(1)}>← Назад</button>
              <button className="onb-next" onClick={() => setStep(3)}>Далее →</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="onb-step-label">Шаг 3 из 3</div>
            <div className="onb-success-icon">✓</div>
            <h2 className="onb-title">Всё готово!</h2>
            <p className="onb-desc">
              Теперь создайте первое ТЗ — займёт около 3 минут.
              Данные организации автоматически попадут в каждый документ.
            </p>
            <div className="onb-actions onb-actions--center">
              <button className="onb-next onb-next--wide" onClick={handleFinish}>
                Создать первое ТЗ →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
