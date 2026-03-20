type Step = {
  key: string;
  label: string;
  sublabel: string;
  done: boolean;
  active: boolean;
};

type Props = {
  steps: Step[];
};

export function ProcessStepper({ steps }: Props) {
  return (
    <nav className="process-stepper" aria-label="Этапы создания ТЗ">
      {steps.map((step, i) => (
        <div
          key={step.key}
          className={`process-step ${step.active ? 'is-active' : ''} ${step.done ? 'is-done' : ''}`}
        >
          <div className="process-step-marker">
            {step.done ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <span>{i + 1}</span>
            )}
          </div>
          <div className="process-step-text">
            <span className="process-step-label">{step.label}</span>
            <span className="process-step-sub">{step.sublabel}</span>
          </div>
          {i < steps.length - 1 && <div className="process-step-connector" />}
        </div>
      ))}
    </nav>
  );
}
