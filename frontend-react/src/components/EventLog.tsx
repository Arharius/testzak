import type { AutomationEvent } from '../types/schemas';

type Props = {
  events: AutomationEvent[];
  onClear: () => void;
};

export function EventLog({ events, onClear }: Props) {
  return (
    <section className="panel">
      <div className="title-row">
        <h2>Журнал автоматизации</h2>
        <button onClick={onClear} type="button">Очистить</button>
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
