import type { CSSProperties } from 'react';
import type { SpecItem } from '../utils/spec-processor';

type PreviewRow = {
  id: number;
  type: string;
  model: string;
  qty: number;
  specs?: SpecItem[];
  meta?: Record<string, string>;
};

type SectionTableRowLike = {
  label: string;
  value: string;
};

type DocumentSectionBundleLike = {
  currentYear: number;
  multi: boolean;
  showCommercialTerms: boolean;
  objectName: string;
  serviceOnly: boolean;
  section1Rows: SectionTableRowLike[];
  readinessSummaryRows: SectionTableRowLike[];
  section2Rows: SectionTableRowLike[];
  section3Rows: SectionTableRowLike[];
  section4Rows: SectionTableRowLike[];
  section5Rows: SectionTableRowLike[];
  section6Rows: SectionTableRowLike[];
  section7Rows?: SectionTableRowLike[];
  section3Title: string;
  section4Title: string;
  section5Title: string;
  section6Title: string;
  section7Title?: string;
};

type CatalogLike = {
  name: string;
  isSoftware?: boolean;
};

type CommercialContextLike = {
  suggestedLicenseType?: string;
  suggestedTerm?: string;
};

type WorkspacePreviewProps = {
  doneRows: PreviewRow[];
  docSections: DocumentSectionBundleLike;
  lookupCatalog: (type: string) => CatalogLike;
  getResolvedCommercialContext: (row: PreviewRow) => CommercialContextLike;
  getCommercialValue: (value?: string) => string;
  getRowQtyUnitShort: (row: PreviewRow) => string;
  getResolvedOkpd2Code: (row: PreviewRow) => string;
  onUpdateSpec: (rowId: number, specIdx: number, field: 'name' | 'value' | 'unit' | 'group', newVal: string) => void;
  onDeleteSpec: (rowId: number, specIdx: number) => void;
  onAddSpec: (rowId: number) => void;
};

export function WorkspacePreview({
  doneRows,
  docSections,
  lookupCatalog,
  getResolvedCommercialContext,
  getCommercialValue,
  getRowQtyUnitShort,
  getResolvedOkpd2Code,
  onUpdateSpec,
  onDeleteSpec,
  onAddSpec,
}: WorkspacePreviewProps) {
  if (doneRows.length === 0) return null;

  const bdr = '1px solid var(--doc-table-border)';
  const tdC = { border: bdr, padding: '6px 10px', color: 'var(--doc-text)' } as const;
  const pStyle = { margin: '4px 0', lineHeight: 1.58, color: 'var(--doc-text-soft)' } as const;
  const boldStyle = { fontWeight: 700, margin: '14px 0 6px', color: 'var(--doc-heading)' } as const;
  const {
    currentYear,
    multi,
    showCommercialTerms,
    objectName,
  } = docSections;

  const editCellStyle: CSSProperties = {
    ...tdC,
    padding: 0,
    background: 'transparent',
  };
  const editInputStyle: CSSProperties = {
    width: '100%',
    background: 'transparent',
    border: 'none',
    color: 'var(--doc-text)',
    padding: '6px 10px',
    fontSize: 12,
    fontFamily: 'inherit',
    outline: 'none',
  };

  const renderSpecsTable = (row: PreviewRow, specs: SpecItem[]) => {
    const flatRows: Array<{ type: 'group' | 'spec'; idx: number; spec?: SpecItem; groupLabel?: string }> = [];
    let prevGroup = '';
    for (let si = 0; si < specs.length; si++) {
      const spec = specs[si];
      if (spec.group && spec.group !== prevGroup) {
        prevGroup = spec.group;
        flatRows.push({ type: 'group', idx: si, groupLabel: spec.group });
      }
      flatRows.push({ type: 'spec', idx: si, spec });
    }
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 8 }}>
        <thead>
          <tr style={{ background: 'var(--doc-table-head-bg)', color: 'var(--doc-table-head-text)' }}>
            <th style={{ border: bdr, padding: '4px 8px' }}>Наименование характеристики</th>
            <th style={{ border: bdr, padding: '4px 8px' }}>Значение характеристики</th>
            <th style={{ border: bdr, padding: '4px 8px', width: 90 }}>Ед. изм.</th>
            <th style={{ border: bdr, padding: '4px 4px', width: 32 }}>🗑</th>
          </tr>
        </thead>
        <tbody>
          {flatRows.map((flatRow, index) =>
            flatRow.type === 'group' ? (
              <tr key={`grp-${flatRow.idx}`}>
                <td
                  colSpan={4}
                  style={{
                    border: bdr,
                    padding: '6px 10px',
                    background: 'var(--doc-table-group-bg)',
                    fontWeight: 700,
                    textAlign: 'center',
                    color: 'var(--doc-heading)',
                  }}
                >
                  {flatRow.groupLabel}
                </td>
              </tr>
            ) : (
              <tr key={`spec-${flatRow.idx}-${index}`} style={{ background: flatRow.spec?._warning ? 'var(--doc-warning-bg)' : undefined }}>
                <td style={editCellStyle}>
                  <input style={editInputStyle} value={flatRow.spec?.name ?? ''} onChange={(e) => onUpdateSpec(row.id, flatRow.idx, 'name', e.target.value)} title="Редактировать название" />
                </td>
                <td style={editCellStyle}>
                  <input style={editInputStyle} value={flatRow.spec?.value ?? ''} onChange={(e) => onUpdateSpec(row.id, flatRow.idx, 'value', e.target.value)} title="Редактировать значение" />
                  {flatRow.spec?._warning && (
                    <span style={{ color: 'var(--doc-warning-text)', fontSize: 10, display: 'block', padding: '0 8px 4px' }}>
                      ⚠️ {flatRow.spec._warning}
                    </span>
                  )}
                </td>
                <td style={editCellStyle}>
                  <input style={{ ...editInputStyle, textAlign: 'center' }} value={flatRow.spec?.unit ?? ''} onChange={(e) => onUpdateSpec(row.id, flatRow.idx, 'unit', e.target.value)} title="Ед. измерения" />
                </td>
                <td style={{ ...tdC, textAlign: 'center', cursor: 'pointer', padding: '0 2px' }} onClick={() => onDeleteSpec(row.id, flatRow.idx)} title="Удалить характеристику">✕</td>
              </tr>
            ),
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} style={{ border: bdr, padding: '4px 8px', textAlign: 'center' }}>
              <button
                onClick={() => onAddSpec(row.id)}
                style={{
                  background: 'var(--doc-button-bg)',
                  color: 'var(--doc-button-text)',
                  border: 'none',
                  borderRadius: 999,
                  padding: '6px 18px',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                + Добавить характеристику
              </button>
            </td>
          </tr>
        </tfoot>
      </table>
    );
  };

  const renderSectionTable = (rowsData: SectionTableRowLike[], headers: [string, string] = ['Пункт', 'Содержание']) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
      <thead>
        <tr style={{ background: 'var(--doc-table-head-bg)', color: 'var(--doc-table-head-text)' }}>
          <th style={{ border: bdr, padding: '4px 8px', width: 90 }}>{headers[0]}</th>
          <th style={{ border: bdr, padding: '4px 8px' }}>{headers[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rowsData.map((row) => (
          <tr key={`${headers[0]}-${row.label}`}>
            <td style={{ ...tdC, textAlign: 'center', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{row.label}</td>
            <td style={{ ...tdC, whiteSpace: 'pre-wrap' }}>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div
      className="tz-preview"
      style={{
        marginTop: 24,
        fontSize: 12.5,
        fontFamily: 'var(--font-doc)',
        lineHeight: 1.58,
        color: 'var(--doc-text)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <div style={{ width: 260, textAlign: 'right', color: 'var(--doc-text)' }}>
          <div style={{ fontWeight: 700 }}>УТВЕРЖДАЮ</div>
          <div>________________________________</div>
          <div style={{ fontSize: 11, fontStyle: 'italic', opacity: 0.8 }}>(должность)</div>
          <div>_____________ / _______________ /</div>
          <div>«___» _______ {currentYear} г.</div>
        </div>
      </div>
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 16, marginBottom: 6, color: 'var(--doc-heading)' }}>ТЕХНИЧЕСКОЕ ЗАДАНИЕ</div>
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, marginBottom: 12, color: 'var(--doc-accent)' }}>
        {docSections.serviceOnly ? 'на оказание ' : 'на поставку '}{objectName}
      </div>

      <div style={{ ...boldStyle, fontSize: 13 }}>1. Наименование, Заказчик, Исполнитель, сроки выполнения</div>
      {renderSectionTable(docSections.section1Rows)}
      {multi ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
          <thead>
            <tr style={{ background: 'var(--doc-table-head-bg)', color: 'var(--doc-table-head-text)' }}>
              <th style={{ border: bdr, padding: '4px 8px', width: 30 }}>№</th>
              <th style={{ border: bdr, padding: '4px 8px' }}>Наименование</th>
              {showCommercialTerms && <th style={{ border: bdr, padding: '4px 8px' }}>Тип лицензии</th>}
              {showCommercialTerms && <th style={{ border: bdr, padding: '4px 8px' }}>Срок действия</th>}
              <th style={{ border: bdr, padding: '4px 8px' }}>Кол-во</th>
              <th style={{ border: bdr, padding: '4px 8px' }}>ОКПД2</th>
              <th style={{ border: bdr, padding: '4px 8px', width: 96 }}>Прил. №</th>
            </tr>
          </thead>
          <tbody>
            {doneRows.map((row, idx) => {
              const goods = lookupCatalog(row.type);
              const commercial = getResolvedCommercialContext(row);
              return (
                <tr key={row.id}>
                  <td style={tdC}>{idx + 1}</td>
                  <td style={tdC}>{goods.name}</td>
                  {showCommercialTerms && <td style={tdC}>{getCommercialValue(commercial.suggestedLicenseType)}</td>}
                  {showCommercialTerms && <td style={tdC}>{getCommercialValue(commercial.suggestedTerm)}</td>}
                  <td style={tdC}>{row.qty} {getRowQtyUnitShort(row)}</td>
                  <td style={tdC}>{getResolvedOkpd2Code(row) || '—'}</td>
                  <td style={tdC}>Прил. {idx + 1}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      <div style={{ ...boldStyle, fontSize: 13 }}>2. Требования к предмету закупки</div>
      {renderSectionTable(docSections.section2Rows)}

      <div style={{ ...boldStyle, fontSize: 13 }}>{docSections.section3Title}</div>
      {renderSectionTable(docSections.section3Rows)}

      <div style={{ ...boldStyle, fontSize: 13 }}>{docSections.section4Title}</div>
      {renderSectionTable(docSections.section4Rows)}

      <div style={{ ...boldStyle, fontSize: 13 }}>{docSections.section5Title}</div>
      {renderSectionTable(docSections.section5Rows)}

      <div style={{ ...boldStyle, fontSize: 13 }}>{docSections.section6Title}</div>
      {renderSectionTable(docSections.section6Rows)}

      {docSections.section7Rows && docSections.section7Rows.length > 0 && (
        <>
          <div style={{ ...boldStyle, fontSize: 13 }}>{docSections.section7Title ?? '7. Перечень нормативных правовых актов'}</div>
          {renderSectionTable(docSections.section7Rows)}
        </>
      )}

      {doneRows.map((row, idx) => {
        const goods = lookupCatalog(row.type);
        const isSoftware = !!goods.isSoftware;
        const specs = row.specs ?? [];
        const commercial = getResolvedCommercialContext(row);
        return (
          <div key={row.id} style={{ marginTop: 32, pageBreakBefore: 'always' }}>
            <hr style={{ borderTop: '2px dashed color-mix(in srgb, var(--doc-accent) 58%, transparent)', margin: '24px 0' }} />
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, color: 'var(--doc-accent)', marginBottom: 4 }}>Приложение {idx + 1}</div>
            <div style={{ textAlign: 'center', fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--doc-heading)' }}>
              {goods.name} — {row.qty} {getRowQtyUnitShort(row)}
              {[commercial.suggestedLicenseType, commercial.suggestedTerm].filter(Boolean).length > 0
                ? ` / ${[commercial.suggestedLicenseType, commercial.suggestedTerm].filter(Boolean).join(' / ')}`
                : ''}
            </div>
            <p style={{ ...pStyle, fontWeight: 600 }}>
              {docSections.serviceOnly
                ? 'Требования к составу, порядку оказания и результату услуг:'
                : (isSoftware
                  ? 'Требования к техническим характеристикам программного обеспечения:'
                  : 'Требования к техническим характеристикам поставляемого товара:')}
            </p>
            {renderSpecsTable(row, specs)}
          </div>
        );
      })}

      <div style={{ marginTop: 28 }}>
        <p style={pStyle}>Специалист ___________________________</p>
        <p style={pStyle}>«____» _______________ {currentYear} г.                                     _______________</p>
      </div>
    </div>
  );
}
