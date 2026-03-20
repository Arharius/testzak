import type { DoubleEquivResult, EquivVendor } from '../utils/double-equivalent';
import type { SpecConflict } from '../utils/fetch-specs';

interface DoubleEquivalentReportProps {
  result: DoubleEquivResult | null;
  loading?: boolean;
  conflicts?: SpecConflict[];
  onRunCheck?: () => void;
  onApplyWiden?: () => void;
  modelName?: string;
}

function ConfDot({ level }: { level: 'high' | 'medium' | 'low' }) {
  return (
    <span
      className={`de-conf-dot de-conf-dot--${level}`}
      aria-hidden="true"
    />
  );
}

function VendorCard({ vendor, index }: { vendor: EquivVendor; index: number }) {
  const conf = vendor.confidence;
  const confLabel = conf === 'high' ? 'Высокая точность' : conf === 'medium' ? 'Средняя точность' : 'Низкая точность';
  const confClass = conf === 'high' ? 'de-conf-high' : conf === 'medium' ? 'de-conf-medium' : 'de-conf-low';
  return (
    <div className="de-vendor-card">
      <div className="de-vendor-header">
        <span className="de-vendor-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <div className="de-vendor-main">
          <div className="de-vendor-name">{vendor.name}</div>
          <div className="de-vendor-model">{vendor.model}</div>
        </div>
        <span className={`de-conf-badge ${confClass}`}>
          <ConfDot level={conf} />
          {confLabel}
        </span>
      </div>
      {vendor.notes && <div className="de-vendor-notes">{vendor.notes}</div>}
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const capped = Math.min(100, Math.max(0, score));
  const barClass = capped >= 80 ? 'de-score-fill--ok' : capped >= 50 ? 'de-score-fill--warn' : 'de-score-fill--bad';
  return (
    <div className="de-score-bar-wrap" role="meter" aria-valuenow={capped} aria-valuemin={0} aria-valuemax={100}>
      <div className="de-score-bar-track">
        <div className={`de-score-bar-fill ${barClass}`} style={{ width: `${capped}%` }} />
      </div>
      <span className="de-score-bar-label">{capped}%</span>
    </div>
  );
}

function StatusDot({ status }: { status: 'ok' | 'widened' | 'fail' | 'idle' }) {
  return <span className={`de-status-dot de-status-dot--${status}`} aria-hidden="true" />;
}

export function DoubleEquivalentReport({
  result,
  loading,
  conflicts,
  onRunCheck,
  onApplyWiden,
  modelName,
}: DoubleEquivalentReportProps) {
  const hasConflicts = conflicts && conflicts.length > 0;
  const hasVendors = result && result.vendors.length >= 2;

  const dotStatus: 'ok' | 'widened' | 'fail' | 'idle' = !result
    ? 'idle'
    : result.status === 'ok'
      ? 'ok'
      : result.status === 'widened'
        ? 'widened'
        : 'fail';

  const statusLabel = !result
    ? 'Не проверено'
    : result.status === 'ok'
      ? 'Соответствует — двойной эквивалент подтверждён'
      : result.status === 'widened'
        ? 'Диапазоны расширены — двойной эквивалент достигнут'
        : 'Требуется доработка — проверьте параметры';

  const statusClass = !result
    ? 'de-status-idle'
    : result.status === 'ok'
      ? 'de-status-ok'
      : result.status === 'widened'
        ? 'de-status-widened'
        : 'de-status-warn';

  return (
    <div className="de-report">

      <div className="de-report-header">
        <div className="de-report-title">
          <span className="de-report-badge" aria-hidden="true">ДЭ</span>
          <div>
            <div className="de-report-heading">Алгоритм двойного эквивалента</div>
            <div className="de-report-subheading">
              {modelName ? `Позиция: ${modelName}` : 'Проверка соответствия ФАС — минимум 2 производителя'}
            </div>
          </div>
        </div>
        {onRunCheck && (
          <button
            className="de-check-btn"
            onClick={onRunCheck}
            disabled={loading}
            type="button"
          >
            {loading ? (
              <span className="de-spinner" aria-hidden="true" />
            ) : (
              <span className="de-check-icon" aria-hidden="true" />
            )}
            {loading ? 'Проверяю…' : 'Проверить эквиваленты'}
          </button>
        )}
      </div>

      {result && (
        <div className={`de-status-bar ${statusClass}`}>
          <StatusDot status={dotStatus} />
          <span className="de-status-text">{statusLabel}</span>
          {result.score > 0 && <ScoreBar score={result.score} />}
        </div>
      )}

      {result?.message && (
        <div className="de-message">{result.message}</div>
      )}

      {result && result.vendors.length > 0 && (
        <div className="de-section">
          <div className="de-section-label">
            <span className="de-section-tag">MFR</span>
            Идентифицированные производители ({result.vendors.length})
          </div>
          <div className="de-vendors-grid">
            {result.vendors.map((v, i) => (
              <VendorCard key={i} vendor={v} index={i} />
            ))}
          </div>
          {hasVendors && (
            <div className="de-compliance-verdict">
              <span className="de-verdict-ok-tag">PASS</span>
              Данное ТЗ соответствует требованиям ФАС. Выявлены совместимые предложения:{' '}
              <strong>{result.vendors.map((v) => `${v.name} ${v.model}`).join(', ')}</strong>.
            </div>
          )}
        </div>
      )}

      {result && result.widened.length > 0 && (
        <div className="de-section">
          <div className="de-section-label">
            <span className="de-section-tag de-section-tag--blue">ADJ</span>
            Рекомендации по расширению параметров
          </div>
          <div className="de-widened-list">
            {result.widened.map((w, i) => (
              <div key={i} className="de-widened-item">
                <span className="de-widened-arrow" aria-hidden="true" />
                {w}
              </div>
            ))}
          </div>
          {onApplyWiden && (
            <button className="de-widen-btn" onClick={onApplyWiden} type="button">
              Применить расширение диапазонов
            </button>
          )}
        </div>
      )}

      {hasConflicts && (
        <div className="de-section">
          <div className="de-section-label">
            <span className="de-section-tag de-section-tag--red">CONF</span>
            Конфликты с официальными данными производителя ({conflicts!.length})
          </div>
          <div className="de-conflicts-table-wrap">
            <table className="de-conflicts-table">
              <thead>
                <tr>
                  <th>Параметр</th>
                  <th>Из документа</th>
                  <th>Официальные данные</th>
                  <th>Рекомендация (44-ФЗ)</th>
                </tr>
              </thead>
              <tbody>
                {conflicts!.map((c, i) => (
                  <tr key={i} className="de-conflict-row">
                    <td className="de-conflict-name">{c.name}</td>
                    <td className="de-conflict-uploaded">{c.uploaded}</td>
                    <td className="de-conflict-verified">{c.verified}</td>
                    <td className="de-conflict-rec">{c.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!result && !loading && (
        <div className="de-empty">
          <span className="de-empty-icon de-empty-icon--scale" aria-hidden="true" />
          <div className="de-empty-text">
            Нажмите «Проверить эквиваленты» после генерации характеристик, чтобы убедиться, что ТЗ допускает как минимум двух производителей.
          </div>
        </div>
      )}
    </div>
  );
}
