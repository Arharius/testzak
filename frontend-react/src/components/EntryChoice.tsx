type Props = {
  onChooseDocx: () => void;
  onChooseManual: () => void;
  onChooseTemplate: () => void;
  lawMode: string;
  onLawModeChange: (mode: '44' | '223') => void;
};

export function EntryChoice({ onChooseDocx, onChooseManual, onChooseTemplate, lawMode, onLawModeChange }: Props) {
  return (
    <div className="entry-choice">
      <div className="entry-choice-top">
        <h1 className="entry-choice-title">Создание технического задания</h1>
        <p className="entry-choice-subtitle">
          Выберите способ подготовки ТЗ для вашей закупки
        </p>
        <div className="entry-choice-law-switch" role="group" aria-label="Режим закона">
          <button
            type="button"
            className={`entry-law-btn ${lawMode === '44' ? 'is-active' : ''}`}
            onClick={() => onLawModeChange('44')}
          >
            44-ФЗ
          </button>
          <button
            type="button"
            className={`entry-law-btn ${lawMode === '223' ? 'is-active' : ''}`}
            onClick={() => onLawModeChange('223')}
          >
            223-ФЗ
          </button>
        </div>
      </div>

      <div className="entry-choice-cards">
        <button type="button" className="entry-card entry-card--docx" onClick={onChooseDocx}>
          <div className="entry-card-icon">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect x="8" y="4" width="24" height="32" rx="3" stroke="currentColor" strokeWidth="2"/>
              <path d="M14 14h12M14 20h12M14 26h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M24 4v8h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="entry-card-body">
            <strong className="entry-card-title">У меня есть файл ТЗ</strong>
            <span className="entry-card-desc">
              Загрузите DOCX/XLSX с характеристиками — система извлечёт позиции, 
              нормализует под {lawMode === '44' ? '44-ФЗ' : '223-ФЗ'} и проверит на ФАС-риски
            </span>
            <span className="entry-card-formats">DOCX, XLSX, CSV</span>
          </div>
          <div className="entry-card-arrow">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </button>

        <button type="button" className="entry-card entry-card--manual" onClick={onChooseManual}>
          <div className="entry-card-icon">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect x="6" y="8" width="28" height="24" rx="3" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 16h16M12 22h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="30" cy="28" r="6" fill="currentColor" opacity="0.15"/>
              <path d="M28 28h4M30 26v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="entry-card-body">
            <strong className="entry-card-title">Только тип товара / модель</strong>
            <span className="entry-card-desc">
              Укажите, что закупаете — ИИ подберёт характеристики, 
              обеспечит конкуренцию ≥2 производителей и оформит под {lawMode === '44' ? '44-ФЗ' : '223-ФЗ'}
            </span>
            <span className="entry-card-hint">Модель — только как пример, она не попадёт в ТЗ</span>
          </div>
          <div className="entry-card-arrow">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </button>

        <button type="button" className="entry-card entry-card--template" onClick={onChooseTemplate}>
          <div className="entry-card-icon">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2"/>
              <rect x="22" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2"/>
              <rect x="6" y="22" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2"/>
              <rect x="22" y="22" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2"/>
            </svg>
          </div>
          <div className="entry-card-body">
            <strong className="entry-card-title">Готовый шаблон закупки</strong>
            <span className="entry-card-desc">
              Типовые наборы оборудования для быстрого старта — АРМ, серверная, 
              видеоконференцсвязь и другие
            </span>
          </div>
          <div className="entry-card-arrow">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </button>
      </div>
    </div>
  );
}
