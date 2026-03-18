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

type LegalSummaryRowLike = {
  index: string;
  item: string;
  classifier: string;
  measure: string;
  action: string;
};

type PublicationDossierRowLike = {
  index: string;
  item: string;
  status: 'ready' | 'review' | 'block';
  classifier: string;
  quality: string;
  action: string;
};

type PublicationDossierSummaryLike = {
  readyItems: number;
  reviewItems: number;
  blockedItems: number;
  trustedClassification: number;
  benchmarkReady: number;
  serviceReady: number;
};

type DocumentSectionBundleLike = {
  currentYear: number;
  multi: boolean;
  showCommercialTerms: boolean;
  objectName: string;
  serviceOnly: boolean;
  section1Rows: SectionTableRowLike[];
  readinessSummaryRows: SectionTableRowLike[];
  legalSummaryRows: LegalSummaryRowLike[];
  publicationDossierRows: PublicationDossierRowLike[];
  publicationDossierSummary: PublicationDossierSummaryLike;
  section2Rows: SectionTableRowLike[];
  section3Rows: SectionTableRowLike[];
  section4Rows: SectionTableRowLike[];
  section5Rows: SectionTableRowLike[];
  section6Rows: SectionTableRowLike[];
  section3Title: string;
  section4Title: string;
  section5Title: string;
  section6Title: string;
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
  publicationSummaryText: string;
  lookupCatalog: (type: string) => CatalogLike;
  getResolvedCommercialContext: (row: PreviewRow) => CommercialContextLike;
  getCommercialValue: (value?: string) => string;
  getRowQtyUnitShort: (row: PreviewRow) => string;
  getResolvedOkpd2Code: (row: PreviewRow) => string;
  getUnifiedNacRegime: (type: string) => string;
  getPublicationDossierRowStatusLabel: (status: PublicationDossierRowLike['status']) => string;
  buildAppendixPassportRows: (row: PreviewRow) => SectionTableRowLike[];
  buildBenchmarkAppendixRows: (row: PreviewRow) => SectionTableRowLike[];
  onUpdateSpec: (rowId: number, specIdx: number, field: 'name' | 'value' | 'unit' | 'group', newVal: string) => void;
  onDeleteSpec: (rowId: number, specIdx: number) => void;
  onAddSpec: (rowId: number) => void;
};

export function WorkspacePreview({
  doneRows,
  docSections,
  publicationSummaryText,
  lookupCatalog,
  getResolvedCommercialContext,
  getCommercialValue,
  getRowQtyUnitShort,
  getResolvedOkpd2Code,
  getUnifiedNacRegime,
  getPublicationDossierRowStatusLabel,
  buildAppendixPassportRows,
  buildBenchmarkAppendixRows,
  onUpdateSpec,
  onDeleteSpec,
  onAddSpec,
}: WorkspacePreviewProps) {
  if (doneRows.length === 0) return null;

  const bdr = '1px solid #555';
  const tdC = { border: bdr, padding: '4px 8px', color: '#F5F0E8' } as const;
  const pStyle = { margin: '4px 0', lineHeight: 1.5, color: '#F5F0E8' } as const;
  const boldStyle = { fontWeight: 700, margin: '10px 0 4px', color: '#F5F0E8' } as const;
  const {
    currentYear,
    multi,
    showCommercialTerms,
    objectName,
  } = docSections;

  const editCellStyle: CSSProperties = {
    ...tdC,
    padding: 0,
  };
  const editInputStyle: CSSProperties = {
    width: '100%', background: 'transparent', border: 'none', color: '#F5F0E8',
    padding: '4px 8px', fontSize: 12, fontFamily: 'inherit', outline: 'none',
  };

  const renderSpecsTable = (row: PreviewRow, specs: SpecItem[], isSW: boolean, nacRegime: string) => {
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
          <tr style={{ background: '#1F5C8B', color: '#fff' }}>
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
                <td colSpan={4} style={{ border: bdr, padding: '4px 8px', background: '#2D3A5C', fontWeight: 700, textAlign: 'center', color: '#F5F0E8' }}>{flatRow.groupLabel}</td>
              </tr>
            ) : (
              <tr key={`spec-${flatRow.idx}-${index}`} style={{ background: flatRow.spec?._warning ? '#3D3020' : undefined }}>
                <td style={editCellStyle}>
                  <input style={editInputStyle} value={flatRow.spec?.name ?? ''} onChange={(e) => onUpdateSpec(row.id, flatRow.idx, 'name', e.target.value)} title="Редактировать название" />
                </td>
                <td style={editCellStyle}>
                  <input style={editInputStyle} value={flatRow.spec?.value ?? ''} onChange={(e) => onUpdateSpec(row.id, flatRow.idx, 'value', e.target.value)} title="Редактировать значение" />
                  {flatRow.spec?._warning && <span style={{ color: '#FBBF24', fontSize: 10, display: 'block', padding: '0 8px 2px' }}>⚠️ {flatRow.spec._warning}</span>}
                </td>
                <td style={editCellStyle}>
                  <input style={{ ...editInputStyle, textAlign: 'center' }} value={flatRow.spec?.unit ?? ''} onChange={(e) => onUpdateSpec(row.id, flatRow.idx, 'unit', e.target.value)} title="Ед. измерения" />
                </td>
                <td style={{ ...tdC, textAlign: 'center', cursor: 'pointer', padding: '0 2px' }} onClick={() => onDeleteSpec(row.id, flatRow.idx)} title="Удалить характеристику">✕</td>
              </tr>
            ),
          )}
          {!isSW && (nacRegime === 'pp878' || nacRegime === 'pp616') && (
            <tr key="torp"><td style={tdC}>ТОРП</td><td style={tdC}>Да</td><td style={tdC}></td><td style={tdC}></td></tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} style={{ border: bdr, padding: '4px 8px', textAlign: 'center' }}>
              <button onClick={() => onAddSpec(row.id)} style={{ background: '#1F5C8B', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 16px', cursor: 'pointer', fontSize: 11 }}>+ Добавить характеристику</button>
            </td>
          </tr>
        </tfoot>
      </table>
    );
  };

  const renderSectionTable = (rowsData: SectionTableRowLike[], headers: [string, string] = ['Пункт', 'Содержание']) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
      <thead>
        <tr style={{ background: '#2A3444', color: '#F5F0E8' }}>
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

  const renderLegalSummaryTable = (rowsData: LegalSummaryRowLike[]) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
      <thead>
        <tr style={{ background: '#2A3444', color: '#F5F0E8' }}>
          <th style={{ border: bdr, padding: '4px 8px', width: 30 }}>№</th>
          <th style={{ border: bdr, padding: '4px 8px' }}>Позиция</th>
          <th style={{ border: bdr, padding: '4px 8px' }}>ОКПД2 / КТРУ</th>
          <th style={{ border: bdr, padding: '4px 8px' }}>ПП1875</th>
          <th style={{ border: bdr, padding: '4px 8px' }}>Что приложить / проверить</th>
        </tr>
      </thead>
      <tbody>
        {rowsData.map((row) => (
          <tr key={`${row.index}-${row.item}`}>
            <td style={{ ...tdC, textAlign: 'center' }}>{row.index}</td>
            <td style={{ ...tdC, whiteSpace: 'pre-wrap' }}>{row.item}</td>
            <td style={{ ...tdC, whiteSpace: 'pre-wrap' }}>{row.classifier}</td>
            <td style={{ ...tdC, whiteSpace: 'pre-wrap' }}>{row.measure}</td>
            <td style={{ ...tdC, whiteSpace: 'pre-wrap' }}>{row.action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderPublicationDossierTable = (rowsData: PublicationDossierRowLike[]) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
      <thead>
        <tr style={{ background: '#2A3444', color: '#F5F0E8' }}>
          <th style={{ border: bdr, padding: '4px 8px', width: 30 }}>№</th>
          <th style={{ border: bdr, padding: '4px 8px' }}>Позиция</th>
          <th style={{ border: bdr, padding: '4px 8px', width: 96 }}>Статус</th>
          <th style={{ border: bdr, padding: '4px 8px' }}>Классификация</th>
          <th style={{ border: bdr, padding: '4px 8px' }}>Качество / доказательная база</th>
          <th style={{ border: bdr, padding: '4px 8px' }}>Что делать</th>
        </tr>
      </thead>
      <tbody>
        {rowsData.map((row) => (
          <tr key={`${row.index}-${row.item}-publication`}>
            <td style={{ ...tdC, textAlign: 'center' }}>{row.index}</td>
            <td style={{ ...tdC, whiteSpace: 'pre-wrap' }}>{row.item}</td>
            <td style={{
              ...tdC,
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
              color: row.status === 'block' ? '#FCA5A5' : row.status === 'review' ? '#FDE68A' : '#86EFAC',
            }}>{getPublicationDossierRowStatusLabel(row.status)}</td>
            <td style={{ ...tdC, whiteSpace: 'pre-wrap' }}>{row.classifier}</td>
            <td style={{ ...tdC, whiteSpace: 'pre-wrap' }}>{row.quality}</td>
            <td style={{ ...tdC, whiteSpace: 'pre-wrap' }}>{row.action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="tz-preview" style={{ marginTop: 24, fontSize: 12, fontFamily: 'Times New Roman, serif', lineHeight: 1.5, color: '#F5F0E8' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <div style={{ width: 260, textAlign: 'right', color: '#F5F0E8' }}>
          <div style={{ fontWeight: 700 }}>УТВЕРЖДАЮ</div>
          <div>________________________________</div>
          <div style={{ fontSize: 11, fontStyle: 'italic', opacity: 0.8 }}>(должность)</div>
          <div>_____________ / _______________ /</div>
          <div>«___» _______ {currentYear} г.</div>
        </div>
      </div>
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 16, marginBottom: 6, color: '#F5F0E8' }}>ТЕХНИЧЕСКОЕ ЗАДАНИЕ</div>
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, marginBottom: 12, color: '#FBBF24' }}>
        {docSections.serviceOnly ? 'на оказание ' : 'на поставку '}{objectName}
      </div>

      <div style={{ ...boldStyle, fontSize: 13 }}>1. Наименование, Заказчик, Исполнитель, сроки выполнения</div>
      {renderSectionTable(docSections.section1Rows)}
      {multi ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
          <thead>
            <tr style={{ background: '#2A3444', color: '#F5F0E8' }}>
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
                  <td style={tdC}>{goods.name}{row.model ? ` (${row.model})` : ''}</td>
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

      <div style={{ ...boldStyle, fontSize: 13 }}>Сводка готовности к публикации</div>
      {renderSectionTable(docSections.readinessSummaryRows)}

      <div style={{ ...boldStyle, fontSize: 13 }}>Справочная таблица по нацрежиму и подтверждающим документам</div>
      {renderLegalSummaryTable(docSections.legalSummaryRows)}

      <div style={{ ...boldStyle, fontSize: 13 }}>Паспорт публикации</div>
      <div style={{ ...pStyle, color: '#CBD5E1', whiteSpace: 'pre-wrap' }}>
        {publicationSummaryText}
      </div>
      {renderPublicationDossierTable(docSections.publicationDossierRows)}

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

      {doneRows.map((row, idx) => {
        const goods = lookupCatalog(row.type);
        const isSoftware = !!goods.isSoftware;
        const nacRegime = row.meta?.nac_regime || getUnifiedNacRegime(row.type);
        const specs = row.specs ?? [];
        const commercial = getResolvedCommercialContext(row);
        return (
          <div key={row.id} style={{ marginTop: 32, pageBreakBefore: 'always' }}>
            <hr style={{ borderTop: '2px dashed #93C5FD', margin: '24px 0' }} />
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, color: '#FBBF24', marginBottom: 4 }}>Приложение {idx + 1}</div>
            <div style={{ textAlign: 'center', fontWeight: 600, fontSize: 13, marginBottom: 8, color: '#F5F0E8' }}>
              {goods.name}{row.model ? ` (${row.model})` : ''} — {row.qty} {getRowQtyUnitShort(row)}
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
            {renderSectionTable(buildAppendixPassportRows(row))}
            {buildBenchmarkAppendixRows(row).length > 0 && renderSectionTable(buildBenchmarkAppendixRows(row))}
            {renderSpecsTable(row, specs, isSoftware, nacRegime)}
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
