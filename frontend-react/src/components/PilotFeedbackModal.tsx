import { useState } from 'react';

const QUESTIONS = [
  {
    id: 'satisfaction',
    label: 'Насколько вы довольны системой в целом? (1 — неудовлетворительно, 10 — отлично)',
    type: 'scale',
    min: 1,
    max: 10,
  },
  {
    id: 'use_cases',
    label: 'Для каких задач вы используете систему?',
    type: 'text',
  },
  {
    id: 'missing_features',
    label: 'Чего не хватает? Что мешает работе?',
    type: 'text',
  },
  {
    id: 'would_recommend',
    label: 'Порекомендовали бы вы систему коллегам?',
    type: 'choice',
    options: ['Да, определённо', 'Возможно', 'Пока нет'],
  },
  {
    id: 'other',
    label: 'Дополнительные комментарии',
    type: 'text',
    optional: true,
  },
];

type PilotFeedbackModalProps = {
  onClose: () => void;
  onSubmit: (answers: Record<string, string>) => Promise<void>;
};

export function PilotFeedbackModal({ onClose, onSubmit }: PilotFeedbackModalProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  };

  const handleSubmit = async () => {
    const required = QUESTIONS.filter((q) => !q.optional);
    const missing = required.some((q) => !answers[q.id]?.trim());
    if (missing) {
      setError('Пожалуйста, ответьте на все обязательные вопросы');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onSubmit(answers);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка отправки');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9000,
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 14,
          padding: '32px 36px',
          width: '100%',
          maxWidth: 540,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
        }}
      >
        {done ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
              Спасибо за отзыв!
            </h2>
            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>
              Ваши ответы помогут нам улучшить систему.
            </p>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 28px',
                background: '#1d4ed8',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Закрыть
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                  Пилотная программа — обратная связь
                </h2>
                <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
                  Займёт 2–3 минуты. Ваше мнение важно для нас.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#94a3b8', lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {QUESTIONS.map((q) => (
                <div key={q.id}>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 8 }}>
                    {q.label}
                    {!q.optional && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
                  </label>
                  {q.type === 'text' && (
                    <textarea
                      value={answers[q.id] ?? ''}
                      onChange={(e) => handleChange(q.id, e.target.value)}
                      placeholder={q.optional ? 'Необязательно' : 'Ваш ответ...'}
                      rows={3}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #e2e8f0',
                        borderRadius: 8,
                        fontSize: 14,
                        color: '#1e293b',
                        resize: 'vertical',
                        boxSizing: 'border-box',
                      }}
                    />
                  )}
                  {q.type === 'scale' && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {Array.from({ length: (q.max ?? 10) - (q.min ?? 1) + 1 }, (_, i) => String(i + (q.min ?? 1))).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => handleChange(q.id, v)}
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            border: answers[q.id] === v ? '2px solid #1d4ed8' : '1px solid #e2e8f0',
                            background: answers[q.id] === v ? '#eff6ff' : '#f8fafc',
                            color: answers[q.id] === v ? '#1d4ed8' : '#475569',
                            fontWeight: answers[q.id] === v ? 700 : 400,
                            cursor: 'pointer',
                            fontSize: 13,
                          }}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  )}
                  {q.type === 'choice' && q.options && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {q.options.map((opt) => (
                        <label
                          key={opt}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            cursor: 'pointer',
                            fontSize: 14,
                            color: '#334155',
                          }}
                        >
                          <input
                            type="radio"
                            name={q.id}
                            value={opt}
                            checked={answers[q.id] === opt}
                            onChange={() => handleChange(q.id, opt)}
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {error && (
              <div style={{ fontSize: 13, color: '#b91c1c', marginTop: 16 }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button
                type="button"
                onClick={() => { void handleSubmit(); }}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: loading ? '#93c5fd' : '#1d4ed8',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Отправляю...' : 'Отправить отзыв'}
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '12px 20px',
                  background: '#f1f5f9',
                  color: '#475569',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                Позже
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
