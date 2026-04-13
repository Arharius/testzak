import { Fragment, type ChangeEvent } from 'react';
import { GOODS_CATALOG, GOODS_GROUPS } from '../data/goods-catalog';
import { GENERAL_CATALOG, GENERAL_GROUPS } from '../data/general-catalog';
import type { SpecItem } from '../utils/spec-processor';
import type { VerifyResult } from '../utils/verify';
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
    sourceCompareLabel: string;
    sourceContextText?: string;
  };
  importInfo?: ImportedRowImportInfo;
  verification?: VerifyResult;
  verifying?: boolean;
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
  hasBackendSession: boolean;
  canStartGeneration: boolean;
  generationPending: boolean;
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
  onOpenAuthPanel: () => void;
  onGenerateRow: (rowId: number) => void;
  onUpdateSpec: (rowId: number, specIdx: number, field: 'name' | 'value' | 'unit' | 'group', newVal: string) => void;
  onDeleteSpec: (rowId: number, specIdx: number) => void;
  onAddSpec: (rowId: number, afterIdx?: number) => void;
  onMoveSpec: (rowId: number, specIdx: number, direction: 'up' | 'down') => void;
  onFinishEditing: () => void;
  onSearchOkpd2?: (rowId: number, model: string) => void;
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
  hasBackendSession,
  canStartGeneration,
  generationPending,
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
  onOpenAuthPanel,
  onGenerateRow,
  onUpdateSpec,
  onDeleteSpec,
  onAddSpec,
  onMoveSpec,
  onFinishEditing,
  onSearchOkpd2,
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
            const rowNeedsAuth = row.status === 'error' && /требуется авторизац/i.test(String(row.error || ''));
            const rowStateClassName = rowActionState?.rowId === row.id
              ? 'rows-table-row is-busy'
              : row.status === 'loading'
                ? 'rows-table-row is-generating'
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
                    {!getResolvedOkpd2Code(row) && onSearchOkpd2 && row.model.trim() && (
                      <button
                        type="button"
                        className="row-inline-action"
                        style={{ fontSize: '0.7rem', padding: '1px 6px' }}
                        title="Определить ОКПД2 автоматически по наименованию"
                        onClick={() => onSearchOkpd2(row.id, row.model)}
                      >
                        🔍 Найти ОКПД2
                      </button>
                    )}
                    <span className="row-primary-pill">
                      ПП1875: {getLaw175MeasureLabel(row.meta?.law175_status || '', row.meta?.nac_regime || getUnifiedNacRegime(row.type))}
                    </span>
                    {row.importInfo?.sourceFormat === 'docx' && (
                      <span className="row-source-tag row-source-tag--docx">
                        DOCX {row.specs?.length ? `· ${row.specs.length} хар-к` : ''}
                      </span>
                    )}
                    {row.status === 'done' && !row.importInfo && (
                      <span className="row-source-tag row-source-tag--ai">
                        AI
                      </span>
                    )}
                    {row.importInfo && (
                      <span className={`row-primary-pill ${row.importInfo.confidenceLabel === 'low' ? 'row-primary-pill--warn' : row.importInfo.confidenceLabel === 'medium' ? 'row-primary-pill--accent' : 'row-primary-pill--import'}`}>
                        Импорт: {Math.round((row.importInfo.confidence || 0) * 100)}%
                      </span>
                    )}
                    {autoDetectedRow === row.id && <span className="row-primary-pill row-primary-pill--accent">auto</span>}
                  </div>
                </td>
                <td>
                  <input
                    value={row.model}
                    placeholder={
                      (row.importInfo?.sourceFormat === 'docx' && !row.model.trim())
                        ? 'Укажите наименование'
                        : (lookupCatalog(row.type)?.placeholder ?? 'Модель / описание...')
                    }
                    onChange={(event) => onChangeRowModel(row, event)}
                    onBlur={() => window.setTimeout(onHideTypeSuggestions, 300)}
                    style={
                      (row.meta?.name_needs_review === 'true' || (row.importInfo?.sourceFormat === 'docx' && !row.model.trim()))
                        ? {
                            borderColor: '#f59e0b',
                            background: 'rgba(251,191,36,0.08)',
                            boxShadow: '0 0 0 2px rgba(245,158,11,0.25)',
                          }
                        : undefined
                    }
                    title={
                      (row.meta?.name_needs_review === 'true' || (row.importInfo?.sourceFormat === 'docx' && !row.model.trim()))
                        ? 'Наименование не удалось извлечь автоматически. Укажите наименование товара.'
                        : undefined
                    }
                  />
                </td>
                <td>
                  {(() => {
                    const options = getLicenseTypeOptions(row);
                    const isSoftwareOrService = options.length > 0 || isServiceCatalogType(row.type);
                    if (!isSoftwareOrService) return <span style={{ color: '#94a3b8' }}>—</span>;
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
                  {(() => {
                    const isSoftwareOrService = getLicenseTypeOptions(row).length > 0 || isServiceCatalogType(row.type);
                    if (!isSoftwareOrService) return <span style={{ color: '#94a3b8' }}>—</span>;
                    return (
                      <input
                        value={row.term}
                        placeholder={getTermPlaceholder(row)}
                        onChange={(event) => onChangeRowTerm(row.id, event.target.value)}
                      />
                    );
                  })()}
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
                    {row.status === 'loading' ? (
                      <div className="row-skeleton-label">
                        <div className="skeleton skeleton-text" style={{ width: '70%' }} />
                        <div className="skeleton skeleton-text sm" style={{ width: '45%' }} />
                      </div>
                    ) : (
                    <span className={`row-status-label ${row.status === 'done' ? 'ok' : row.status === 'error' ? 'warn' : 'muted'}`}>
                      {row.status === 'idle' && (lookupCatalog(row.type)?.hardTemplate ? '📋 Шаблон готов' : row.importInfo?.sourceFormat === 'docx' && row.specs?.length ? `📄 Импортировано ${row.specs.length} хар-к` : 'Ожидание генерации')}
                      {row.status === 'done' && `✅ Готово · ${row.specs?.length ?? 0} характеристик`}
                      {row.status === 'error' && `❌ ${row.error ?? 'Ошибка'}`}
                    </span>
                    )}
                    {row.verifying && (
                      <span className="eis-verify-badge eis-verify-badge--checking" title="Идёт проверка соответствия требованиям 44-ФЗ и ЕИС...">
                        🔍 Проверка ЕИС…
                      </span>
                    )}
                    {!row.verifying && row.verification && (
                      <span
                        className={`eis-verify-badge ${
                          row.verification.readyForEis
                            ? 'eis-verify-badge--ok'
                            : row.verification.score >= 70
                              ? 'eis-verify-badge--warn'
                              : 'eis-verify-badge--fail'
                        }`}
                        title={(() => {
                          const v = row.verification;
                          const lines = [`ЕИС-готовность: ${v.score}%`];
                          if (v.criticalCount > 0) lines.push(`❌ Критичных нарушений: ${v.criticalCount}`);
                          if (v.warningCount > 0) lines.push(`⚠️ Предупреждений: ${v.warningCount}`);
                          const fixed = v.issues.filter(i => i.autoFixed).length;
                          if (fixed > 0) lines.push(`🔧 Авто-исправлено: ${fixed}`);
                          if (v.issues.length > 0) {
                            lines.push('');
                            lines.push('Найденные нарушения:');
                            v.issues.slice(0, 5).forEach(issue => {
                              lines.push(`• ${issue.severity === 'critical' ? '❌' : '⚠️'} ${issue.specName}: ${issue.rule}${issue.autoFixed ? ' [исправлено]' : ''}`);
                            });
                            if (v.issues.length > 5) lines.push(`  ...и ещё ${v.issues.length - 5}`);
                          }
                          if (v.readyForEis) lines.push('✅ Готово к размещению в ЕИС');
                          return lines.join('\n');
                        })()}
                      >
                        {row.verification.readyForEis ? '✅' : row.verification.score >= 70 ? '⚠️' : '❌'} ЕИС {row.verification.score}%
                        {row.verification.issues.some(i => i.autoFixed) && ' 🔧'}
                      </span>
                    )}
                    <div className="row-status-actions">
                      {row.status === 'idle' && row.model.trim() && (
                        <button
                          type="button"
                          className="row-inline-action"
                          onClick={() => onGenerateRow(row.id)}
                          disabled={!canStartGeneration || generationPending}
                          title={canStartGeneration
                            ? (row.importInfo?.sourceFormat === 'docx' && row.specs?.length
                              ? 'Нормализовать импортированные характеристики: убрать бренды, добавить «не менее / не более», проверить конкуренцию'
                              : 'Сформировать техническое задание с нулевым ФАС-риском')
                            : 'Сначала заполните строки и проверьте доступ к AI'}
                        >
                          {generationPending ? '⏳ Генерация...' : row.importInfo?.sourceFormat === 'docx' && row.specs?.length ? '⚙ Нормализовать ТЗ' : '🚀 Сгенерировать ТЗ'}
                        </button>
                      )}
                      {row.status === 'error' && row.model.trim() && (
                        <button
                          type="button"
                          className="row-inline-action"
                          onClick={() => onGenerateRow(row.id)}
                          title="Повторить поиск характеристик и генерацию ТЗ для этой строки"
                          style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.12)', color: '#f87171' }}
                        >
                          🔄 Повторить поиск
                        </button>
                      )}
                      {needsQuickClassificationAction && (
                        <button
                          type="button"
                          className="row-inline-action"
                          onClick={() => {
                            if (rowNeedsAuth && !hasBackendSession) {
                              onOpenAuthPanel();
                              return;
                            }
                            onRefreshRowClassification(row.id);
                          }}
                          disabled={rowNeedsAuth ? false : (!canUseAiAssist || !!rowActionState || publicationAutopilotRunning)}
                          title={rowNeedsAuth
                            ? (hasBackendSession
                              ? 'Сессия уже активна. Повторите уточнение для этой строки.'
                              : 'Откройте вход в аккаунт, чтобы продолжить работу с этой строкой.')
                            : !canUseAiAssist
                              ? 'Требуется доступ к backend/AI для уточнения классификации'
                              : 'Быстро добрать ОКПД2, КТРУ и статус ПП1875 для этой строки'}
                        >
                          {rowNeedsAuth
                            ? (hasBackendSession ? '🔄 Повторить' : '🔐 Войти')
                            : rowActionState?.rowId === row.id && rowActionState.source === 'classify'
                              ? '⏳ Уточнение...'
                              : '🧭 Уточнить'}
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
                      getResolvedOkpd2Code={(detailRow) => getResolvedOkpd2Code(detailRow as GoodsRowLike)}
                      getResolvedOkpd2Name={(detailRow) => getResolvedOkpd2Name(detailRow as GoodsRowLike)}
                      getResolvedKtruCode={(detailRow) => getResolvedKtruCode(detailRow as GoodsRowLike)}
                      getResolvedLaw175Meta={getResolvedLaw175Meta}
                      getUnifiedNacRegime={getUnifiedNacRegime}
                      getLaw175MeasureLabel={getLaw175MeasureLabel}
                      getClassificationSourceLabel={getClassificationSourceLabel}
                      requiresManualClassificationReview={(detailRow) => requiresManualClassificationReview(detailRow as GoodsRowLike)}
                      getLaw175EvidenceText={(detailRow) => getLaw175EvidenceText(detailRow as GoodsRowLike)}
                      isServiceCatalogType={isServiceCatalogType}
                      buildDraftSourceComparison={(sourceSpecs, draftSpecs, rowType) => buildDraftSourceComparison(sourceSpecs, draftSpecs, rowType)}
                      getBenchmarkRiskLevel={(comparison) => getBenchmarkRiskLevel(comparison)}
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 6 }}>
        <span
          title="Импорт поддерживает CSV, TSV, TXT, XLSX, DOCX. Оптимальные колонки: «Тип товара», «Модель / описание», «Тип лицензии», «Срок действия», «Количество». Из DOCX извлекаются таблицы, приложения, нумерованные перечни и характеристики."
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: '1.5px solid var(--text-muted)',
            color: 'var(--text-muted)',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'help',
            flexShrink: 0,
            lineHeight: 1,
            userSelect: 'none',
          }}
          aria-label="Форматы импорта"
        >
          i
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Форматы: CSV, TSV, TXT, XLSX, DOCX</span>
      </div>
    </div>
  );
}
