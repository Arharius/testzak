import { Fragment, type ChangeEvent } from 'react';
import { GOODS_CATALOG, GOODS_GROUPS } from '../data/goods-catalog';
import { GENERAL_CATALOG, GENERAL_GROUPS } from '../data/general-catalog';
import type { SpecItem } from '../utils/spec-processor';
import { WorkspaceRowDetailPanel } from './WorkspaceRowDetailPanel';
import { WorkspaceSpecEditor } from './WorkspaceSpecEditor';
import type { ImportedRowImportInfo } from '../utils/row-import';

type GoodsRowLike = {
  id: number;
  type: string;
  model: string;
  licenseType: string;
  term: string;
  qty: number;
  status: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
  specs?: SpecItem[];
  meta?: Record<string, string>;
  benchmark?: {
    sourceSpecs: SpecItem[];
  };
  importInfo?: ImportedRowImportInfo;
};

type CatalogLike = {
  name: string;
  okpd2?: string;
  placeholder?: string;
  hardTemplate?: unknown;
};

type RowActionStateLike = {
  rowId: number;
  source: 'internet' | 'eis' | 'classify';
} | null;

type DraftSourceComparisonLike = {
  matched: unknown[];
  changed: unknown[];
  onlySource: unknown[];
  onlyDraft: unknown[];
};

type WorkspaceRowsTableProps = {
  rows: GoodsRowLike[];
  focusedRowId: number | null;
  autoDetectedRow: number | null;
  rowActionState: RowActionStateLike;
  publicationAutopilotRunning: boolean;
  editingRowId: number | null;
  expandedRowMetaId: number | null;
  canUseAiAssist: boolean;
  benchmarkingEnabled: boolean;
  lookupCatalog: (key: string) => CatalogLike;
  getUnifiedNacRegime: (key: string) => string;
  getResolvedOkpd2Code: (row: GoodsRowLike) => string;
  getResolvedOkpd2Name: (row: GoodsRowLike) => string;
  getResolvedKtruCode: (row: GoodsRowLike) => string;
  getResolvedLaw175Meta: (rowType: string, meta?: Record<string, string>) => {
    regime: string;
    basisDisplay: string;
  };
  getLaw175MeasureLabel: (status: string, regime: string) => string;
  getClassificationSourceLabel: (meta?: Record<string, string>, rowType?: string) => string;
  requiresManualClassificationReview: (row: GoodsRowLike) => boolean;
  getLaw175EvidenceText: (row: GoodsRowLike) => string;
  getLicenseTypeOptions: (row: GoodsRowLike) => string[];
  getLicenseTypePlaceholder: (row: GoodsRowLike) => string;
  getTermPlaceholder: (row: GoodsRowLike) => string;
  isServiceCatalogType: (key: string) => boolean;
  buildDraftSourceComparison: (sourceSpecs: SpecItem[], draftSpecs: SpecItem[], rowType: string) => DraftSourceComparisonLike;
  getBenchmarkRiskLevel: (comparison: DraftSourceComparisonLike) => 'ok' | 'warn' | 'block';
  onSetRowRef: (rowId: number, node: HTMLTableRowElement | null) => void;
  onChangeRowType: (rowId: number, nextType: string) => void;
  onChangeRowModel: (row: GoodsRowLike, event: ChangeEvent<HTMLInputElement>) => void;
  onHideTypeSuggestions: () => void;
  onChangeRowLicenseType: (rowId: number, value: string) => void;
  onChangeRowTerm: (rowId: number, value: string) => void;
  onChangeRowQty: (rowId: number, value: number) => void;
  onDeleteRow: (rowId: number) => void;
  onToggleRowDetails: (rowId: number) => void;
  onToggleRowEditing: (rowId: number) => void;
  onRefreshRowClassification: (rowId: number) => void;
  onRefreshRowFromSource: (rowId: number, source: 'internet' | 'eis') => void;
  onUpdateSpec: (rowId: number, specIdx: number, field: 'name' | 'value' | 'unit' | 'group', newVal: string) => void;
  onDeleteSpec: (rowId: number, specIdx: number) => void;
  onAddSpec: (rowId: number, afterIdx?: number) => void;
  onMoveSpec: (rowId: number, specIdx: number, direction: 'up' | 'down') => void;
  onFinishEditing: () => void;
};

export function WorkspaceRowsTable({
  rows,
  focusedRowId,
  autoDetectedRow,
  rowActionState,
  publicationAutopilotRunning,
  editingRowId,
  expandedRowMetaId,
  canUseAiAssist,
  benchmarkingEnabled,
  lookupCatalog,
  getUnifiedNacRegime,
  getResolvedOkpd2Code,
  getResolvedOkpd2Name,
  getResolvedKtruCode,
  getResolvedLaw175Meta,
  getLaw175MeasureLabel,
  getClassificationSourceLabel,
  requiresManualClassificationReview,
  getLaw175EvidenceText,
  getLicenseTypeOptions,
  getLicenseTypePlaceholder,
  getTermPlaceholder,
  isServiceCatalogType,
  buildDraftSourceComparison,
  getBenchmarkRiskLevel,
  onSetRowRef,
  onChangeRowType,
  onChangeRowModel,
  onHideTypeSuggestions,
  onChangeRowLicenseType,
  onChangeRowTerm,
  onChangeRowQty,
  onDeleteRow,
  onToggleRowDetails,
  onToggleRowEditing,
  onRefreshRowClassification,
  onRefreshRowFromSource,
  onUpdateSpec,
  onDeleteSpec,
  onAddSpec,
  onMoveSpec,
  onFinishEditing,
}: WorkspaceRowsTableProps) {
  return (
    <div className="rows-table-wrap">
      <table className="rows-table">
        <colgroup>
          <col className="rows-col rows-col--num" />
          <col className="rows-col rows-col--type" />
          <col className="rows-col rows-col--model" />
          <col className="rows-col rows-col--license" />
          <col className="rows-col rows-col--term" />
          <col className="rows-col rows-col--qty" />
          <col className="rows-col rows-col--status" />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>Тип товара</th>
            <th>Модель / описание</th>
            <th>Тип лицензии</th>
            <th>Срок действия</th>
            <th>Кол-во</th>
            <th>Статус и действия</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const needsQuickClassificationAction = !getResolvedOkpd2Code(row) || requiresManualClassificationReview(row) || row.status === 'error';
            const rowStateClassName = rowActionState?.rowId === row.id
              ? 'rows-table-row is-busy'
              : focusedRowId === row.id
                ? 'rows-table-row is-focused'
                : 'rows-table-row';

            return (
              <Fragment key={row.id}>
                <tr
                  ref={(node) => {
                    if (typeof onSetRowRef === 'function') onSetRowRef(row.id, node);
                  }}
                  className={rowStateClassName}
                >
                <td className="num-cell">{idx + 1}</td>
                <td>
                  <select
                    value={row.type}
                    onChange={(event) => onChangeRowType(row.id, event.target.value)}
                    className={`row-type-select ${autoDetectedRow === row.id ? 'is-autodetected' : ''}`}
                  >
                    {[
                      <option key="manual_hdr" disabled value="" className="row-catalog-option row-catalog-option--manual">
                        {'── ⭐ Свободный ввод ──'}
                      </option>,
                      <option key="manual_goods" value="otherGoods">
                        {'  ' + GENERAL_CATALOG.otherGoods.name}
                      </option>,
                      <option key="manual_service" value="otherService">
                        {'  ' + GENERAL_CATALOG.otherService.name}
                      </option>,
                    ]}
                    <option key="it_catalog_hdr" disabled value="" className="row-catalog-option row-catalog-option--it">
                      {'── 🖥️ ИТ-каталог ──'}
                    </option>
                    {GOODS_GROUPS.flatMap((group) => [
                      <option key={`hdr_${group.label}`} disabled value="" className="row-catalog-option row-catalog-option--group">
                        {'── ' + group.label + ' ──'}
                      </option>,
                      ...group.items.map((key) => (
                        <option key={key} value={key}>
                          {'  ' + (GOODS_CATALOG[key]?.name ?? key)}
                        </option>
                      )),
                    ])}
                    <option key="general_catalog_hdr" disabled value="" className="row-catalog-option row-catalog-option--general">
                      {'── 📦 Общий каталог ──'}
                    </option>
                    {GENERAL_GROUPS.flatMap((group) => [
                      <option key={`ghdr_${group.label}`} disabled value="" className="row-catalog-option row-catalog-option--group">
                        {'── ' + group.label + ' ──'}
                      </option>,
                      ...group.items.map((key) => (
                        <option key={key} value={key}>
                          {'  ' + (GENERAL_CATALOG[key]?.name ?? key)}
                        </option>
                      )),
                    ])}
                  </select>
                  <div className="row-primary-meta">
                    <span>{getResolvedOkpd2Code(row) || 'ОКПД2 не определён'}</span>
                    <span className="row-primary-pill">
                      ПП1875: {getLaw175MeasureLabel(row.meta?.law175_status || '', row.meta?.nac_regime || getUnifiedNacRegime(row.type))}
                    </span>
                    {row.importInfo && (
                      <span className={`row-primary-pill ${row.importInfo.confidenceLabel === 'low' ? 'row-primary-pill--warn' : row.importInfo.confidenceLabel === 'medium' ? 'row-primary-pill--accent' : ''}`}>
                        Импорт: {Math.round((row.importInfo.confidence || 0) * 100)}%
                      </span>
                    )}
                    {autoDetectedRow === row.id && <span className="row-primary-pill row-primary-pill--accent">auto</span>}
                  </div>
                </td>
                <td>
                  <input
                    value={row.model}
                    placeholder={lookupCatalog(row.type)?.placeholder ?? 'Модель / описание...'}
                    onChange={(event) => onChangeRowModel(row, event)}
                    onBlur={() => window.setTimeout(onHideTypeSuggestions, 300)}
                  />
                </td>
                <td>
                  {(() => {
                    const options = getLicenseTypeOptions(row);
                    if (options.length > 0) {
                      return (
                        <select
                          value={row.licenseType}
                          onChange={(event) => onChangeRowLicenseType(row.id, event.target.value)}
                        >
                          <option value="">{getLicenseTypePlaceholder(row)}</option>
                          {options.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      );
                    }

                    return (
                      <input
                        value={row.licenseType}
                        placeholder={getLicenseTypePlaceholder(row)}
                        onChange={(event) => onChangeRowLicenseType(row.id, event.target.value)}
                      />
                    );
                  })()}
                </td>
                <td>
                  <input
                    value={row.term}
                    placeholder={getTermPlaceholder(row)}
                    onChange={(event) => onChangeRowTerm(row.id, event.target.value)}
                  />
                </td>
                <td className="qty-cell">
                  <input
                    type="number"
                    min={1}
                    value={row.qty}
                    onChange={(event) => onChangeRowQty(row.id, Math.max(1, Number(event.target.value || 1)))}
                  />
                </td>
                <td className="row-status-column">
                  <div className="row-status-cell">
                    <span className={`row-status-label ${row.status === 'done' ? 'ok' : row.status === 'error' ? 'warn' : 'muted'}`}>
                      {row.status === 'idle' && (lookupCatalog(row.type)?.hardTemplate ? '📋 Шаблон готов' : 'Ожидание')}
                      {row.status === 'loading' && '⏳ Генерация...'}
                      {row.status === 'done' && `✅ Готово (${row.specs?.length ?? 0} хар-к)`}
                      {row.status === 'error' && `❌ ${row.error ?? 'Ошибка'}`}
                    </span>
                    <div className="row-status-actions">
                      {needsQuickClassificationAction && (
                        <button
                          type="button"
                          className="row-inline-action"
                          onClick={() => onRefreshRowClassification(row.id)}
                          disabled={!canUseAiAssist || !!rowActionState || publicationAutopilotRunning}
                          title={!canUseAiAssist ? 'Требуется доступ к backend/AI для уточнения классификации' : 'Быстро добрать ОКПД2, КТРУ и статус ПП1875 для этой строки'}
                        >
                          {rowActionState?.rowId === row.id && rowActionState.source === 'classify' ? '⏳ Уточнение...' : '🧭 Уточнить'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="row-detail-toggle"
                        onClick={() => onToggleRowDetails(row.id)}
                      >
                        {expandedRowMetaId === row.id ? 'Скрыть' : 'Детали'}
                      </button>
                      <button
                        type="button"
                        className="danger-btn row-delete-inline"
                        disabled={rows.length <= 1}
                        onClick={() => onDeleteRow(row.id)}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
              {expandedRowMetaId === row.id && (
                <tr key={`meta-${row.id}`}>
                  <td colSpan={7} className="row-full-width-cell">
                    <WorkspaceRowDetailPanel
                      row={row}
                      editingRowId={editingRowId}
                      rowActionState={rowActionState}
                      publicationAutopilotRunning={publicationAutopilotRunning}
                      canUseAiAssist={canUseAiAssist}
                      benchmarkingEnabled={benchmarkingEnabled}
                      getResolvedOkpd2Code={getResolvedOkpd2Code}
                      getResolvedOkpd2Name={getResolvedOkpd2Name}
                      getResolvedKtruCode={getResolvedKtruCode}
                      getResolvedLaw175Meta={getResolvedLaw175Meta}
                      getUnifiedNacRegime={getUnifiedNacRegime}
                      getLaw175MeasureLabel={getLaw175MeasureLabel}
                      getClassificationSourceLabel={getClassificationSourceLabel}
                      requiresManualClassificationReview={requiresManualClassificationReview}
                      getLaw175EvidenceText={getLaw175EvidenceText}
                      isServiceCatalogType={isServiceCatalogType}
                      buildDraftSourceComparison={buildDraftSourceComparison}
                      getBenchmarkRiskLevel={getBenchmarkRiskLevel}
                      onToggleRowEditing={onToggleRowEditing}
                      onRefreshRowFromSource={onRefreshRowFromSource}
                      onRefreshRowClassification={onRefreshRowClassification}
                    />
                  </td>
                </tr>
              )}
              {editingRowId === row.id && row.specs && (
                <tr key={`edit-${row.id}`}>
                  <td colSpan={7} className="row-full-width-cell">
                    <WorkspaceSpecEditor
                      rowId={row.id}
                      rowType={row.type}
                      rowLabel={lookupCatalog(row.type)?.name ?? row.type}
                      specs={row.specs}
                      onUpdateSpec={onUpdateSpec}
                      onDeleteSpec={onDeleteSpec}
                      onAddSpec={onAddSpec}
                      onMoveSpec={onMoveSpec}
                      onFinishEditing={onFinishEditing}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="workspace-inline-note">
        Импорт списка поддерживает `CSV`, `TSV`, `TXT`, `XLSX`, `DOCX`. Для таблиц и служебных записок лучше всего работают колонки `Тип товара`, `Модель / описание`, `Тип лицензии`, `Срок действия`, `Количество`; в `DOCX` приложение также умеет забирать табличные позиции, приложения, нумерованные перечни лицензий и характеристики из таблиц/разделов, а рядом с каждой строкой показывает confidence импорта.
      </div>
    </div>
  );
}
