import { useEffect, useState } from 'react';
import { getAiProviders, setLlmProviderSetting, getLlmProviderSetting, type AiProviderInfo } from '../lib/backendApi';

interface Props {
  onClose: () => void;
  onSaved?: (provider: string, model: string) => void;
}

export function LLMProviderModal({ onClose, onSaved }: Props) {
  const [providers, setProviders] = useState<AiProviderInfo[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [effectiveProvider, setEffectiveProvider] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAiProviders(), getLlmProviderSetting()])
      .then(([pResp, sResp]) => {
        if (cancelled) return;
        setProviders(pResp.providers);
        setEffectiveProvider(pResp.active_provider);
        setSelected(sResp.provider || '');
        setSelectedModel(sResp.model || '');
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить список провайдеров');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleSelect = (id: string) => {
    setSelected(id);
    const info = providers.find(p => p.id === id);
    setSelectedModel(info?.default_model || '');
    setSaved(false);
    setError('');
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await setLlmProviderSetting(selected, selectedModel || undefined);
      setEffectiveProvider(res.effective_provider);
      setSaved(true);
      onSaved?.(res.effective_provider, res.effective_model);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await setLlmProviderSetting('', undefined);
      setSelected('');
      setSelectedModel('');
      setEffectiveProvider(res.effective_provider);
      setSaved(true);
      onSaved?.(res.effective_provider, res.effective_model);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка сброса');
    } finally {
      setSaving(false);
    }
  };

  const activeInfo = providers.find(p => p.id === effectiveProvider);

  return (
    <div className="pricing-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pricing-modal llm-modal" style={{ maxWidth: 640 }}>
        <button className="modal-close-btn" onClick={onClose} aria-label="Закрыть">✕</button>

        <div className="pricing-header">
          <h2>Выбор AI-провайдера</h2>
          {activeInfo && (
            <p className="llm-active-note">
              Сейчас используется: <strong>{activeInfo.flag} {activeInfo.label}</strong>
            </p>
          )}
        </div>

        {loading ? (
          <div className="llm-loading">Загрузка провайдеров…</div>
        ) : (
          <>
            {error && <div className="pricing-error">{error}</div>}

            <div className="llm-providers-grid">
              {providers.map(p => (
                <button
                  key={p.id}
                  className={`llm-provider-card${selected === p.id ? ' llm-provider-card--selected' : ''}${!p.available ? ' llm-provider-card--unavailable' : ''}`}
                  onClick={() => p.available && handleSelect(p.id)}
                  disabled={!p.available}
                >
                  <div className="llm-provider-flag">{p.flag}</div>
                  <div className="llm-provider-name">{p.label}</div>
                  {!p.available && <div className="llm-provider-badge llm-provider-badge--unavail">Нет ключа</div>}
                  {p.available && selected === p.id && <div className="llm-provider-badge llm-provider-badge--selected">Выбран</div>}
                  <div className="llm-provider-desc">{p.description}</div>
                </button>
              ))}
            </div>

            {selected && (() => {
              const info = providers.find(p => p.id === selected);
              if (!info) return null;
              return (
                <div className="llm-model-row">
                  <label className="llm-model-label">Модель:</label>
                  <select
                    className="llm-model-select"
                    value={selectedModel || info.default_model}
                    onChange={e => { setSelectedModel(e.target.value); setSaved(false); }}
                  >
                    {info.models.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              );
            })()}

            {saved && !error && (
              <div className="llm-saved-note">Настройки сохранены</div>
            )}

            <div className="llm-actions">
              {selected && (
                <button className="pricing-buy-btn llm-btn-save" onClick={handleSave} disabled={saving}>
                  {saving ? 'Сохранение…' : 'Применить'}
                </button>
              )}
              <button className="pricing-buy-btn pricing-buy-btn--outline llm-btn-reset" onClick={handleReset} disabled={saving}>
                Сбросить (авто)
              </button>
            </div>

            <div className="pricing-footer">
              <p>Сброс → сервер выбирает провайдер автоматически по доступным ключам.</p>
              <p>Настройка привязана к вашему аккаунту и работает на всех устройствах.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
