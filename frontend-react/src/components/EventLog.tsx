import type { AutomationEvent } from '../types/schemas';

type Props = {
  events: AutomationEvent[];
  onClear: () => void;
};

export function EventLog({ events, onClear }: Props) {
  return (
    <section className="panel">
      <div className="title-row">
        <h2>Automation Log</h2>
        <button onClick={onClear} type="button">clear</button>
      </div>
      <div className="log-box">
        {events.length === 0 && <div className="muted">No events yet</div>}
        {events.slice().reverse().map((event, idx) => (
          <div className="log-item" key={`${event.at}-${idx}`}>
            <span>{event.at}</span>
            <b>{event.event}</b>
            <span className={event.ok ? 'ok' : 'warn'}>{event.ok ? 'OK' : 'WARN'}</span>
            {event.note && <span className="note">{event.note}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
