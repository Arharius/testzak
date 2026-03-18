import type { SpecItem } from '../utils/spec-processor';

type WorkspaceSpecEditorProps = {
  rowId: number;
  rowType: string;
  rowLabel: string;
  specs: SpecItem[];
  onUpdateSpec: (rowId: number, specIdx: number, field: 'name' | 'value' | 'unit' | 'group', newVal: string) => void;
  onDeleteSpec: (rowId: number, specIdx: number) => void;
  onAddSpec: (rowId: number, afterIdx?: number) => void;
  onMoveSpec: (rowId: number, specIdx: number, direction: 'up' | 'down') => void;
  onFinishEditing: () => void;
};

export function WorkspaceSpecEditor({
  rowId,
  rowType,
  rowLabel,
  specs,
  onUpdateSpec,
  onDeleteSpec,
  onAddSpec,
  onMoveSpec,
  onFinishEditing,
}: WorkspaceSpecEditorProps) {
  return (
    <div className="spec-editor">
      <div className="spec-editor__header">
        <strong className="spec-editor__title">✏️ Редактирование характеристик — {rowLabel}</strong>
        <div className="spec-editor__actions">
          <button type="button" className="spec-editor__button spec-editor__button--add" onClick={() => onAddSpec(rowId)}>
            + Добавить
          </button>
          <button type="button" className="spec-editor__button spec-editor__button--done" onClick={onFinishEditing}>
            ✓ Готово
          </button>
        </div>
      </div>

      <table className="spec-editor__table">
        <thead>
          <tr className="spec-editor__head-row">
            <th className="spec-editor__head-cell spec-editor__head-cell--index">#</th>
            <th className="spec-editor__head-cell">Группа</th>
            <th className="spec-editor__head-cell">Наименование</th>
            <th className="spec-editor__head-cell">Значение</th>
            <th className="spec-editor__head-cell spec-editor__head-cell--unit">Ед.изм.</th>
            <th className="spec-editor__head-cell spec-editor__head-cell--actions">Действия</th>
          </tr>
        </thead>
        <tbody>
          {specs.map((spec, specIndex) => {
            const rowClassName = spec._warning
              ? 'spec-editor__row is-warning'
              : specIndex % 2 === 0
                ? 'spec-editor__row is-even'
                : 'spec-editor__row is-odd';
            const lastRow = specIndex === specs.length - 1;

            return (
              <tr key={`${rowType}-${specIndex}`} className={rowClassName}>
                <td className="spec-editor__cell spec-editor__cell--index">{specIndex + 1}</td>
                <td className="spec-editor__cell">
                  <input
                    value={spec.group ?? ''}
                    onChange={(event) => onUpdateSpec(rowId, specIndex, 'group', event.target.value)}
                    className="spec-editor__input spec-editor__input--meta"
                    placeholder="Группа..."
                  />
                </td>
                <td className="spec-editor__cell">
                  <input
                    value={spec.name ?? ''}
                    onChange={(event) => onUpdateSpec(rowId, specIndex, 'name', event.target.value)}
                    className="spec-editor__input"
                    placeholder="Наименование..."
                  />
                </td>
                <td className="spec-editor__cell">
                  <input
                    value={spec.value ?? ''}
                    onChange={(event) => onUpdateSpec(rowId, specIndex, 'value', event.target.value)}
                    className="spec-editor__input"
                    placeholder="Значение..."
                  />
                </td>
                <td className="spec-editor__cell">
                  <input
                    value={spec.unit ?? ''}
                    onChange={(event) => onUpdateSpec(rowId, specIndex, 'unit', event.target.value)}
                    className="spec-editor__input spec-editor__input--meta"
                    placeholder="шт."
                  />
                </td>
                <td className="spec-editor__cell spec-editor__cell--actions">
                  <button
                    type="button"
                    className="spec-editor__icon-button"
                    onClick={() => onMoveSpec(rowId, specIndex, 'up')}
                    disabled={specIndex === 0}
                    title="Вверх"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="spec-editor__icon-button"
                    onClick={() => onMoveSpec(rowId, specIndex, 'down')}
                    disabled={lastRow}
                    title="Вниз"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className="spec-editor__icon-button spec-editor__icon-button--add"
                    onClick={() => onAddSpec(rowId, specIndex)}
                    title="Добавить после"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="spec-editor__icon-button spec-editor__icon-button--delete"
                    onClick={() => onDeleteSpec(rowId, specIndex)}
                    title="Удалить"
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="spec-editor__footer">
        <span className="spec-editor__summary">Всего характеристик: {specs.length}</span>
        <div className="spec-editor__actions">
          <button type="button" className="spec-editor__button spec-editor__button--add" onClick={() => onAddSpec(rowId)}>
            + Добавить характеристику
          </button>
          <button type="button" className="spec-editor__button spec-editor__button--done" onClick={onFinishEditing}>
            ✓ Сохранить и закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
