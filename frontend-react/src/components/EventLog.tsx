import type { AutomationEvent } from '../types/schemas';

type Props = {
  events: AutomationEvent[];
  onClear: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
};

export function EventLog({ events, onClear, onExportCsv, onExportJson }: Props) {
  return (
    <section className="panel">
      <div className="title-row">
        <h2>Журнал автоматизации</h2>
        <div className="actions">
          <button onClick={onExportCsv} type="button">Экспорт CSV</button>
          <button onClick={onExportJson} type="button">Экспорт JSON</button>
          <button onClick={onClear} type="button">Очистить</button>
        </div>
      </div>
      <div className="log-box">
        {events.length === 0 && <div className="muted">Пока нет событий</div>}
        {events.slice().reverse().map((event, idx) => (
          <div className="log-item" key={`${event.at}-${idx}`}>
            <span>{event.at}</span>
            <b>{event.event}</b>
            <span className={event.ok ? 'ok' : 'warn'}>{event.ok ? 'OK' : 'ПРЕДУПРЕЖДЕНИЕ'}</span>
            {event.note && <span className="note">{event.note}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
