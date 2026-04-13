import { useState, useRef, useEffect } from 'react';
import { searchTemplates, KTRU_TEMPLATES, type KTRUTemplate } from '../data/ktru_templates';

interface TemplateSelectorProps {
  onSelect: (template: KTRUTemplate) => void;
}

export function TemplateSelector({ onSelect }: TemplateSelectorProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const results = query.length > 1
    ? searchTemplates(query)
    : Object.values(KTRU_TEMPLATES);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:border-blue-400 bg-white flex items-center gap-1.5"
        title="Выбрать шаблон характеристик по КТРУ"
      >
        <span>📂</span>
        <span>Шаблоны КТРУ</span>
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-80 bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <input
              autoFocus
              placeholder="Поиск по названию или ОКПД2..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
            />
          </div>
          <div className="max-h-60 overflow-y-auto">
            {results.map(t => (
              <button
                key={t.okpd2}
                onClick={() => {
                  onSelect(t);
                  setOpen(false);
                  setQuery('');
                }}
                className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-0"
              >
                <div className="text-sm font-medium text-gray-800">{t.name}</div>
                <div className="text-xs text-gray-400 flex items-center gap-2">
                  <span className="font-mono">{t.okpd2}</span>
                  <span className="text-gray-300">·</span>
                  <span>{t.characteristics.length} характеристик</span>
                </div>
              </button>
            ))}
            {results.length === 0 && (
              <div className="text-center text-gray-400 py-4 text-sm">
                Шаблон не найден
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
