import type { ComplianceReport } from '../utils/compliance';
import type { SpecItem } from '../utils/spec-processor';
import type { LawMode } from '../utils/npa-blocks';

type GoodsRow = {
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
    source: 'internet' | 'eis' | 'ai';
    sourceCompareLabel: string;
    sourceContextText?: string;
    sourceSpecs: SpecItem[];
  };
};

type DraftSourcePair = {
  sourceSpec?: SpecItem;
  draftSpec?: SpecItem;
  score?: number;
};

type DraftSourceComparison = {
  sourceTotal: number;
  draftTotal: number;
  matched: DraftSourcePair[];
  changed: DraftSourcePair[];
  onlySource: DraftSourcePair[];
  onlyDraft: DraftSourcePair[];
};

type ReadinessActionKind = 'focus' | 'internet' | 'eis' | 'classify' | 'benchmark_missing' | 'benchmark_all' | 'service_fill_core' | 'service_fill_all' | 'legal_safe_fix';

type ReadinessIssue = {
  key: string;
  level: 'block' | 'warn';
  rowId?: number;
  text: string;
  action?: string;
  actionKind?: ReadinessActionKind;
  actionLabel?: string;
};

type ReadinessGateSummary = {
  status: 'ready' | 'warn' | 'block';
  blockers: ReadinessIssue[];
  warnings: ReadinessIssue[];
  itemsReviewed: number;
  antiFas: {
    score: number | null;
    minScore: number | null;
    critical: number;
    major: number;
    minor: number;
    blocked: boolean;
  };
  benchmark: {
    ok: number;
    warn: number;
    block: number;
    covered: number;
    withoutSource: number;
  };
  legal: {
    manualReview: number;
    missingOkpd2: number;
    missingBasis: number;
    autoDerivedBasis: number;
    pendingGeneration: number;
  };
  service: {
    reviewed: number;
    missingResult: number;
    missingTiming: number;
    missingAcceptance: number;
    missingExecution: number;
    missingQualification: number;
  };
};

type LegalSummaryRow = {
  index: string;
  item: string;
  classifier: string;
  measure: string;
  action: string;
};

type PublicationDossierRow = {
  index: string;
  item: string;
  status: 'ready' | 'review' | 'block';
  classifier: string;
  quality: string;
  action: string;
};

type PublicationDossierSummary = {
  status: 'ready' | 'warn' | 'block';
  readyItems: number;
  reviewItems: number;
  blockedItems: number;
  trustedClassification: number;
  benchmarkReady: number;
  serviceReady: number;
};

type SectionTableRowLike = {
  label: string;
  value: string;
};

type PublicationDeps = {
  lookupCatalog: (rowType: string) => { name: string; isService?: boolean };
  getUnifiedNacRegime: (rowType: string) => string;
  getResolvedOkpd2Code: (row: GoodsRow) => string;
  getResolvedOkpd2Name: (row: GoodsRow) => string;
  getResolvedKtruCode: (row: GoodsRow) => string;
  getResolvedLaw175Meta: (rowType: string, meta?: Record<string, string>) => {
    regime: string;
    status: string;
    basis: string;
    basisDisplay: string;
    basisAuto: boolean;
    basisWeak: boolean;
  };
  getLaw175MeasureLabel: (status: string, regime: string) => string;
  getClassificationSourceLabel: (meta?: Record<string, string>, rowType?: string) => string;
  requiresManualClassificationReview: (row: GoodsRow) => boolean;
  getLaw175EvidenceText: (row: GoodsRow) => string;
  normalizeLaw175StatusValue: (raw: string) => string;
  deriveLaw175StatusFromRegime: (regime: string) => string;
  isAutoDerivedLaw175Basis: (meta?: Record<string, string>) => boolean;
  isServiceCatalogType: (rowType: string) => boolean;
  buildDraftSourceComparison: (
    sourceSpecs: Array<Partial<SpecItem>> | undefined,
    draftSpecs: Array<Partial<SpecItem>> | undefined,
    goodsType?: string,
  ) => DraftSourceComparison;
  getBenchmarkRiskLevel: (comparison: DraftSourceComparison) => 'ok' | 'warn' | 'block';
  getResolvedCommercialContext: (row: GoodsRow) => { suggestedTerm?: string };
  upsertSpecBatch: (specs: SpecItem[], entries: Array<{ spec: SpecItem; aliases?: string[] }>) => SpecItem[];
  adjustSpecsForCommercialContext: (row: GoodsRow, specs: SpecItem[]) => SpecItem[];
  sanitizeProcurementSpecs: (row: Pick<GoodsRow, 'type' | 'model' | 'licenseType' | 'term'>, specs: SpecItem[]) => SpecItem[];
  normalizeResolvedMeta: (rowType: string, meta?: Record<string, string>) => Record<string, string>;
  deriveLaw175BasisText: (rowType: string, meta?: Record<string, string>) => string;
  getRowDisplayLabel: (row: GoodsRow) => string;
};

export function createWorkspacePublicationTools({
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
  normalizeLaw175StatusValue,
  deriveLaw175StatusFromRegime,
  isAutoDerivedLaw175Basis,
  isServiceCatalogType,
  buildDraftSourceComparison,
  getBenchmarkRiskLevel,
  getResolvedCommercialContext,
  upsertSpecBatch,
  adjustSpecsForCommercialContext,
  sanitizeProcurementSpecs,
  normalizeResolvedMeta,
  deriveLaw175BasisText,
  getRowDisplayLabel,
}: PublicationDeps) {
  void getLaw175EvidenceText;
  function getReadinessStatusLabel(status: ReadinessGateSummary['status']): string {
    if (status === 'block') return 'есть блокеры';
    if (status === 'warn') return 'нужна проверка';
    return 'готово';
  }

  function getLegalEvidenceAction(row: GoodsRow, lawMode: LawMode): string {
    const goods = lookupCatalog(row.type);
    const { regime, status, basis, basisAuto } = getResolvedLaw175Meta(row.type, row.meta);
    const okpd2 = getResolvedOkpd2Code(row);
    const ktru = getResolvedKtruCode(row);
    const checklist: string[] = [];

    if (!okpd2.trim()) checklist.push('уточнить код ОКПД2 до публикации закупки');
    if (ktru) checklist.push(`сверить обязательные характеристики с КТРУ ${ktru}`);
    if (requiresManualClassificationReview(row)) {
      checklist.push('вручную подтвердить классификацию, источник данных и применимость перечней ПП РФ № 1875');
    }
    if (basisAuto) {
      checklist.push(status === 'none'
        ? 'заменить автооснование по ПП РФ № 1875 на проверенную формулировку о неприменимости меры'
        : 'заменить автооснование по ПП РФ № 1875 на подтвержденную формулировку со ссылкой на документ или реестр');
    }

    if (goods.isService || regime === 'none' || status === 'none') {
      checklist.push(goods.isService
        ? 'подтвердить результат услуг, этапы, SLA, порядок приёмки и отчётные материалы'
        : 'проверить, что по позиции действительно не применяется мера нацрежима на дату публикации');
      return checklist.join('; ') + '.';
    }

    if (status === 'exception') {
      checklist.push('подготовить письменное обоснование исключения и приложить подтверждающие документы');
      if (basis) checklist.push('отразить основание исключения в извещении и документации');
      return checklist.join('; ') + '.';
    }

    if (regime === 'pp1236') {
      checklist.push('приложить выписку из реестра российского ПО Минцифры России или евразийского реестра ПО');
      checklist.push('проверить актуальную редакцию перечней ПП РФ № 1875 на дату публикации');
    } else if (regime === 'pp878') {
      checklist.push('приложить реестровую запись ГИСП / евразийского реестра и подтверждение происхождения радиоэлектронной продукции');
      checklist.push(`проверить порядок допуска по ${lawMode === '44' ? '44-ФЗ' : '223-ФЗ'} и действующую позицию перечня ПП РФ № 1875`);
    } else if (regime === 'pp616') {
      checklist.push('приложить подтверждение происхождения промышленного товара по ПП РФ № 1875 и применимым реестрам');
      checklist.push('проверить, нет ли исключения или специального основания неприменения');
    } else if (status === 'preference') {
      checklist.push('описать порядок предоставления преимущества и документы происхождения');
    }

    return checklist.join('; ') + '.';
  }

  function buildLegalSummaryRow(row: GoodsRow, index: number, lawMode: LawMode): LegalSummaryRow {
    const okpd2 = getResolvedOkpd2Code(row) || '—';
    const okpd2Name = getResolvedOkpd2Name(row);
    const ktru = getResolvedKtruCode(row);
    const { regime, basisDisplay } = getResolvedLaw175Meta(row.type, row.meta);
    const measureLabel = getLaw175MeasureLabel(row.meta?.law175_status || '', regime);
    const sourceLabel = getClassificationSourceLabel(row.meta, row.type);
    const classifierParts = [`ОКПД2: ${okpd2}${okpd2Name ? ` — ${okpd2Name}` : ''}`];
    classifierParts.push(ktru ? `КТРУ: ${ktru}` : 'КТРУ: не указан / не применяется');
    classifierParts.push(`Источник: ${sourceLabel}${requiresManualClassificationReview(row) ? ' · ручная проверка обязательна' : ''}`);

    return {
      index: String(index + 1),
      item: getRowDisplayLabel(row),
      classifier: classifierParts.join('\n'),
      measure: basisDisplay ? `${measureLabel}\n${basisDisplay}` : measureLabel,
      action: getLegalEvidenceAction(row, lawMode),
    };
  }

  function buildReadinessIssuePreview(issues: ReadinessIssue[], limit = 3): string {
    if (!issues.length) return 'замечаний нет';
    return issues.slice(0, limit).map((issue) => issue.text).join('; ');
  }

  function analyzeServiceSpecCoverage(specs: Array<Partial<SpecItem>> | undefined) {
    const text = (Array.isArray(specs) ? specs : [])
      .map((spec) => `${String(spec.group || '')} ${String(spec.name || '')} ${String(spec.value || '')} ${String(spec.unit || '')}`)
      .join(' | ')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      hasResult: /(состав услуг|состав работ|объем услуг|объем работ|результат|подтверждение результата|итог|deliverable|выходн)/.test(text),
      hasTiming: /(срок|этап|график|календарн|sla|время реакции|время восстановления|контрольн|окно работ)/.test(text),
      hasAcceptance: /(приемк|акт|отчет|отчетн|сдач|замечани|подтверждение результата)/.test(text),
      hasExecution: /(место оказания|удален|дистанцион|на территории|канал связи|доступ|пропускн|режим работ|окно проведени|на объекте)/.test(text),
      hasQualification: /(квалифик|специалист|сертификат|допуск|лиценз|ответственн|команда исполнителя)/.test(text),
    };
  }

  function buildServiceAutofillEntries(row: GoodsRow, mode: 'core' | 'all'): Array<{ spec: SpecItem; aliases?: string[] }> {
    const coverage = analyzeServiceSpecCoverage(row.specs);
    const entries: Array<{ spec: SpecItem; aliases?: string[] }> = [];
    const resolved = getResolvedCommercialContext(row);
    const scopeLabel = row.model.trim() || 'предмету закупки';
    const resolvedTerm = resolved.suggestedTerm || row.term.trim() || 'не более 20 рабочих дней';

    if (!coverage.hasResult) {
      entries.push({
        spec: {
          group: 'Общие требования',
          name: 'Состав услуг',
          value: `Оказание услуг по ${scopeLabel}, включая подготовительные действия, выполнение основного объема работ и передачу проверяемого результата Заказчику`,
          unit: '—',
        },
        aliases: ['Состав услуг', 'Состав работ', 'Объем услуг', 'Объем работ'],
      });
      entries.push({
        spec: {
          group: 'Общие требования',
          name: 'Требования к результату',
          value: 'Результат услуг должен быть завершенным, проверяемым, пригодным для использования по назначению и подтверждаться комплектом сдачных материалов',
          unit: '—',
        },
        aliases: ['Требования к результату', 'Результат услуг', 'Результат работ', 'Подтверждение результата'],
      });
    }

    if (!coverage.hasTiming) {
      entries.push({
        spec: {
          group: 'Сроки и этапы',
          name: 'Срок оказания услуг',
          value: resolvedTerm,
          unit: 'срок',
        },
        aliases: ['Срок оказания услуг', 'Срок выполнения', 'Срок оказания работ'],
      });
      entries.push({
        spec: {
          group: 'Сроки и этапы',
          name: 'Этапность оказания услуг',
          value: 'Подготовка, выполнение основного объема услуг, устранение замечаний и сдача результата по согласованному календарному плану',
          unit: '—',
        },
        aliases: ['Этапность оказания услуг', 'Этапность', 'План-график', 'Календарный план'],
      });
    }

    if (!coverage.hasAcceptance) {
      entries.push({
        spec: {
          group: 'Приемка и отчетность',
          name: 'Подтверждение результата',
          value: 'Акт сдачи-приемки, отчетные материалы и комплект подтверждающих документов по фактически оказанным услугам',
          unit: '—',
        },
        aliases: ['Подтверждение результата', 'Порядок приемки', 'Порядок приёмки', 'Приемка', 'Приёмка'],
      });
      entries.push({
        spec: {
          group: 'Приемка и отчетность',
          name: 'Отчетные материалы',
          value: 'Отчет должен содержать сведения о выполненных действиях, сроках, объеме, достигнутом результате и устранении замечаний при их наличии',
          unit: '—',
        },
        aliases: ['Отчетные материалы', 'Отчётные материалы', 'Отчет', 'Отчёт'],
      });
    }

    if (mode === 'all' && !coverage.hasExecution) {
      entries.push({
        spec: {
          group: 'Организация оказания услуг',
          name: 'Место оказания услуг',
          value: 'На территории Заказчика, дистанционно и/или на площадке Исполнителя в соответствии с Техническим заданием и согласованным графиком',
          unit: '—',
        },
        aliases: ['Место оказания услуг', 'Способ оказания услуг', 'Режим оказания услуг'],
      });
      entries.push({
        spec: {
          group: 'Организация оказания услуг',
          name: 'Режим оказания услуг',
          value: 'В согласованные окна работ с соблюдением пропускного режима, правил охраны труда, информационной безопасности и внутренних регламентов Заказчика',
          unit: '—',
        },
        aliases: ['Режим оказания услуг', 'Окна проведения работ', 'Порядок доступа'],
      });
    }

    if (mode === 'all' && !coverage.hasQualification) {
      entries.push({
        spec: {
          group: 'Требования к исполнителю',
          name: 'Квалификация исполнителя',
          value: 'Исполнитель обязан привлечь квалифицированных специалистов, обладающих необходимыми знаниями, опытом, допусками, лицензиями и сертификатами по характеру услуг',
          unit: '—',
        },
        aliases: ['Квалификация исполнителя', 'Требования к исполнителю', 'Квалификация специалистов', 'Состав команды'],
      });
    }

    return entries;
  }

  function applyServiceReadinessPatchToRow(row: GoodsRow, mode: 'core' | 'all'): GoodsRow {
    if (!isServiceCatalogType(row.type) || !row.specs?.length) return row;
    const autofillEntries = buildServiceAutofillEntries(row, mode);
    if (autofillEntries.length === 0) return row;
    const nextSpecs = upsertSpecBatch(row.specs, autofillEntries);
    const adjustedSpecs = adjustSpecsForCommercialContext(row, nextSpecs);
    const sanitizedSpecs = sanitizeProcurementSpecs({
      type: row.type,
      model: row.model,
      licenseType: row.licenseType,
      term: row.term,
    }, adjustedSpecs);
    return {
      ...row,
      status: 'done',
      specs: sanitizedSpecs,
    };
  }

  function shouldApplyLegalReadinessPatch(row: GoodsRow): boolean {
    const { status, basisWeak } = getResolvedLaw175Meta(row.type, normalizeResolvedMeta(row.type, row.meta || {}));
    return status === 'exception' && basisWeak;
  }

  function applyLegalReadinessPatchToRow(row: GoodsRow): GoodsRow {
    if (!shouldApplyLegalReadinessPatch(row)) return row;
    const normalizedMeta = normalizeResolvedMeta(row.type, row.meta || {});
    const { regime } = getResolvedLaw175Meta(row.type, normalizedMeta);
    const fallbackStatus = deriveLaw175StatusFromRegime(regime);
    const nextMeta = normalizeResolvedMeta(row.type, {
      ...normalizedMeta,
      law175_status: fallbackStatus,
      law175_basis: deriveLaw175BasisText(row.type, {
        ...normalizedMeta,
        nac_regime: regime,
        law175_status: fallbackStatus,
      }),
      law175_basis_auto: '1',
    });
    return {
      ...row,
      meta: nextMeta,
    };
  }

  function buildReadinessGateSummary(
    sourceRows: GoodsRow[],
    complianceReport: ComplianceReport | null,
    benchmarkingEnabled: boolean,
  ): ReadinessGateSummary {
    const blockers: ReadinessIssue[] = [];
    const warnings: ReadinessIssue[] = [];
    const benchmark = { ok: 0, warn: 0, block: 0, covered: 0, withoutSource: 0 };
    const legal = { manualReview: 0, missingOkpd2: 0, missingBasis: 0, autoDerivedBasis: 0, pendingGeneration: 0 };
    const service = { reviewed: 0, missingResult: 0, missingTiming: 0, missingAcceptance: 0, missingExecution: 0, missingQualification: 0 };

    sourceRows.forEach((row, idx) => {
      const rowLabel = `#${idx + 1} ${getRowDisplayLabel(row)}`;
      const okpd2 = getResolvedOkpd2Code(row);
      const { status, basisAuto, basisWeak } = getResolvedLaw175Meta(row.type, row.meta);

      if (row.status !== 'done' || !row.specs?.length) {
        legal.pendingGeneration += 1;
        blockers.push({
          key: `pending-${row.id}`,
          level: 'block',
          rowId: row.id,
          text: `${rowLabel}: позиция ещё не доведена до готового ТЗ.`,
          action: 'сгенерировать характеристики и проверить итоговую таблицу',
          actionKind: 'focus',
          actionLabel: 'Открыть строку',
        });
      }

      if (!okpd2.trim()) {
        legal.missingOkpd2 += 1;
        blockers.push({
          key: `okpd2-${row.id}`,
          level: 'block',
          rowId: row.id,
          text: `${rowLabel}: отсутствует ОКПД2.`,
          action: 'переобогатить классификацию по ЕИС / источникам и заполнить ОКПД2 до публикации',
          actionKind: 'classify',
          actionLabel: 'Уточнить ОКПД2',
        });
      }

      if (basisAuto) legal.autoDerivedBasis += 1;

      if (status === 'exception' && basisWeak) {
        legal.missingBasis += 1;
        warnings.push({
          key: `basis-${row.id}`,
          level: 'warn',
          rowId: row.id,
          text: `${rowLabel}: указано исключение по ПП1875 без подтвержденного основания.`,
          action: 'снять неподтвержденное исключение до базовой меры по режиму или заменить его документально подтвержденным основанием',
          actionKind: 'legal_safe_fix',
          actionLabel: 'Снять исключение',
        });
      } else if (row.status === 'done' && status !== 'none' && basisWeak) {
        warnings.push({
          key: `basis-review-${row.id}`,
          level: 'warn',
          rowId: row.id,
          text: `${rowLabel}: мера ПП1875 определена, но основание не подтверждено юридически.`,
          action: 'уточнить формулировку основания, источник права и подтверждающий документ до публикации',
          actionKind: 'legal_safe_fix',
          actionLabel: 'Уточнить основание',
        });
      }

      if (requiresManualClassificationReview(row)) {
        legal.manualReview += 1;
        warnings.push({
          key: `manual-review-${row.id}`,
          level: 'warn',
          rowId: row.id,
          text: `${rowLabel}: требуется ручная верификация классификации и применимости перечней ПП1875.`,
          action: 'уточнить классификацию по ЕИС / источникам, затем подтвердить ОКПД2, КТРУ и меру нацрежима перед публикацией',
          actionKind: 'classify',
          actionLabel: 'Уточнить',
        });
      }

      if (isServiceCatalogType(row.type) && row.status === 'done' && row.specs?.length) {
        const coverage = analyzeServiceSpecCoverage(row.specs);
        const serviceBlockReasons: string[] = [];
        const serviceWarnReasons: string[] = [];
        service.reviewed += 1;

        if (!coverage.hasResult) {
          service.missingResult += 1;
          serviceBlockReasons.push('проверяемый результат и состав услуг');
        }
        if (!coverage.hasTiming) {
          service.missingTiming += 1;
          serviceBlockReasons.push('сроки, этапы или SLA');
        }
        if (!coverage.hasAcceptance) {
          service.missingAcceptance += 1;
          serviceBlockReasons.push('порядок приёмки и отчётности');
        }
        if (!coverage.hasExecution) {
          service.missingExecution += 1;
          serviceWarnReasons.push('место, режим или способ оказания услуг');
        }
        if (!coverage.hasQualification) {
          service.missingQualification += 1;
          serviceWarnReasons.push('требования к квалификации исполнителя');
        }

        if (serviceBlockReasons.length > 0) {
          blockers.push({
            key: `service-block-${row.id}`,
            level: 'block',
            rowId: row.id,
            text: `${rowLabel}: в ТЗ на услугу не хватает обязательных сервисных требований (${serviceBlockReasons.join(', ')}).`,
            action: 'добавить результат услуги, сроки/этапы/SLA и порядок приёмки с отчётными материалами',
            actionKind: 'service_fill_core',
            actionLabel: 'Автодобор',
          });
        }

        if (serviceWarnReasons.length > 0) {
          warnings.push({
            key: `service-warn-${row.id}`,
            level: 'warn',
            rowId: row.id,
            text: `${rowLabel}: сервисная часть описана не полностью (${serviceWarnReasons.join(', ')}).`,
            action: 'уточнить место и режим оказания услуг, а также требования к команде исполнителя',
            actionKind: 'service_fill_all',
            actionLabel: 'Автодобор +',
          });
        }
      }

      if (benchmarkingEnabled && row.status === 'done' && row.specs?.length && !isServiceCatalogType(row.type)) {
        if (row.benchmark) {
          const comparison = buildDraftSourceComparison(row.benchmark.sourceSpecs, row.specs, row.type);
          const risk = getBenchmarkRiskLevel(comparison);
          benchmark.covered += 1;
          benchmark[risk] += 1;
          if (risk === 'block') {
            blockers.push({
              key: `benchmark-block-${row.id}`,
              level: 'block',
              rowId: row.id,
              text: `${rowLabel}: существенное расхождение с эталоном (${comparison.onlySource.length} пропущено, ${comparison.changed.length} изменено).`,
              action: 'синхронизировать позицию с эталоном из ЕИС/интернета',
              actionKind: 'benchmark_all',
              actionLabel: 'Синхронизировать',
            });
          } else if (risk === 'warn') {
            warnings.push({
              key: `benchmark-warn-${row.id}`,
              level: 'warn',
              rowId: row.id,
              text: `${rowLabel}: эталон покрыт не полностью (${comparison.onlySource.length} пропущено, ${comparison.changed.length} изменено).`,
              action: 'добрать недостающие характеристики из эталона',
              actionKind: 'benchmark_missing',
              actionLabel: 'Добрать эталон',
            });
          }
        } else {
          benchmark.withoutSource += 1;
          warnings.push({
            key: `benchmark-missing-${row.id}`,
            level: 'warn',
            rowId: row.id,
            text: `${rowLabel}: нет внешнего источника для сверки характеристик.`,
            action: 'подтянуть характеристики из интернета или ЕИС и сверить результат',
            actionKind: 'internet',
            actionLabel: 'Добавить источник',
          });
        }
      }
    });

    if (complianceReport) {
      if (complianceReport.critical > 0) {
        blockers.push({
          key: 'antifas-critical',
          level: 'block',
          text: `Anti-ФАС: ${complianceReport.critical} критичных нарушений, score ${complianceReport.score}/${complianceReport.minScore}.`,
          action: 'исправить критичные характеристики до выгрузки',
        });
      }
      if (complianceReport.major > 0 || complianceReport.minor > 0) {
        warnings.push({
          key: 'antifas-warn',
          level: 'warn',
          text: `Anti-ФАС: существенных — ${complianceReport.major}, незначительных — ${complianceReport.minor}.`,
          action: 'просмотреть замечания Anti-ФАС и скорректировать формулировки',
        });
      }
    }

    return {
      status: blockers.length > 0 ? 'block' : warnings.length > 0 ? 'warn' : 'ready',
      blockers,
      warnings,
      itemsReviewed: sourceRows.length,
      antiFas: {
        score: complianceReport?.score ?? null,
        minScore: complianceReport?.minScore ?? null,
        critical: complianceReport?.critical ?? 0,
        major: complianceReport?.major ?? 0,
        minor: complianceReport?.minor ?? 0,
        blocked: !!complianceReport?.blocked,
      },
      benchmark,
      legal,
      service,
    };
  }

  function buildStoredReadinessPayload(summary: ReadinessGateSummary) {
    return {
      status: summary.status,
      blockers: summary.blockers.map((issue) => issue.text),
      warnings: summary.warnings.map((issue) => issue.text),
      antiFas: summary.antiFas,
      benchmark: summary.benchmark,
      legal: summary.legal,
      service: summary.service,
    };
  }

  function getPublicationDossierRowStatusLabel(status: PublicationDossierRow['status']): string {
    if (status === 'block') return 'блокер';
    if (status === 'review') return 'требует проверки';
    return 'готово';
  }

  function buildPublicationDossierSummaryText(
    summary: PublicationDossierSummary,
    rowsCount: number,
    serviceRowsCount: number,
  ): string {
    return `Паспорт публикации: статус — ${getReadinessStatusLabel(summary.status)}; готово — ${summary.readyItems}; требуют проверки — ${summary.reviewItems}; блокируют публикацию — ${summary.blockedItems}. Доверенная классификация — ${summary.trustedClassification}/${rowsCount}; внешняя сверка без критичных расхождений — ${summary.benchmarkReady}/${rowsCount}; полностью готовых сервисных позиций — ${summary.serviceReady}/${serviceRowsCount || 0}.`;
  }

  function buildPublicationDossierRow(
    row: GoodsRow,
    index: number,
    benchmarkingEnabled: boolean,
  ): PublicationDossierRow {
    const goods = lookupCatalog(row.type);
    void goods;
    const okpd2 = getResolvedOkpd2Code(row) || '—';
    const okpd2Name = getResolvedOkpd2Name(row);
    const ktru = getResolvedKtruCode(row);
    const sourceLabel = getClassificationSourceLabel(row.meta, row.type);
    const classifierParts = [
      `ОКПД2: ${okpd2}${okpd2Name ? ` — ${okpd2Name}` : ''}`,
      `КТРУ: ${ktru || 'не указан / не применяется'}`,
      `Источник: ${sourceLabel}${requiresManualClassificationReview(row) ? ' · ручная верификация' : ' · источник доверенный'}`,
    ];

    const qualityParts: string[] = [];
    const actions: string[] = [];
    let status: PublicationDossierRow['status'] = 'ready';

    const escalate = (next: PublicationDossierRow['status']) => {
      if (next === 'block') {
        status = 'block';
        return;
      }
      if (status !== 'block' && next === 'review') status = 'review';
    };

    if (row.status !== 'done' || !row.specs?.length) {
      escalate('block');
      actions.push('сформировать позицию и проверить характеристики');
      qualityParts.push('Позиция ещё не доведена до готового состояния');
    }

    if (!getResolvedOkpd2Code(row)) {
      escalate('block');
      actions.push('добрать ОКПД2 и уточнить классификацию');
    }

    if (requiresManualClassificationReview(row)) {
      escalate('review');
      actions.push('подтвердить классификацию и перечни ПП1875 вручную');
    }

    const law175 = getResolvedLaw175Meta(row.type, row.meta);
    if (law175.status === 'exception' && law175.basisWeak) {
      escalate('block');
      actions.push('снять неподтвержденное исключение или подтвердить его документами');
    } else if (row.status === 'done' && law175.status !== 'none' && law175.basisWeak) {
      escalate('review');
      actions.push('уточнить основание по ПП1875');
    }
    qualityParts.push(`ПП1875: ${getLaw175MeasureLabel(row.meta?.law175_status || '', law175.regime)}${law175.basisDisplay ? `; ${law175.basisDisplay}` : ''}`);

    if (benchmarkingEnabled) {
      if (row.benchmark && row.specs?.length) {
        const comparison = buildDraftSourceComparison(row.benchmark.sourceSpecs, row.specs, row.type);
        const risk = getBenchmarkRiskLevel(comparison);
        qualityParts.push(`Внешняя сверка: ${risk.toUpperCase()} · совпало ${comparison.matched.length}, изменено ${comparison.changed.length}, пропущено ${comparison.onlySource.length}`);
        if (risk === 'block') {
          escalate('block');
          actions.push('синхронизировать позицию с эталоном источника');
        } else if (risk === 'warn') {
          escalate('review');
          actions.push('перепроверить расхождения с эталоном');
        }
      } else if (!isServiceCatalogType(row.type)) {
        qualityParts.push('Внешняя сверка: источник не найден');
        actions.push('при возможности подтвердить позицию внешним источником');
        escalate('review');
      }
    }

    if (isServiceCatalogType(row.type) && row.status === 'done' && row.specs?.length) {
      const coverage = analyzeServiceSpecCoverage(row.specs);
      const missingCore: string[] = [];
      const missingOptional: string[] = [];
      if (!coverage.hasResult) missingCore.push('результат / состав услуг');
      if (!coverage.hasTiming) missingCore.push('сроки / этапы / SLA');
      if (!coverage.hasAcceptance) missingCore.push('приёмка / отчётность');
      if (!coverage.hasExecution) missingOptional.push('режим оказания');
      if (!coverage.hasQualification) missingOptional.push('квалификация исполнителя');
      if (missingCore.length > 0) {
        escalate('block');
        actions.push(`добрать сервисные требования: ${missingCore.join(', ')}`);
      }
      if (missingOptional.length > 0) {
        escalate('review');
        actions.push(`уточнить сервисный контур: ${missingOptional.join(', ')}`);
      }
      qualityParts.push(
        missingCore.length === 0 && missingOptional.length === 0
          ? 'Сервисный контур: полный'
          : `Сервисный контур: не хватает ${[...missingCore, ...missingOptional].join(', ')}`
      );
    }

    if (status === 'ready') {
      actions.push('позиция готова к публикации после финальной проверки Заказчиком');
    }

    return {
      index: String(index + 1),
      item: getRowDisplayLabel(row),
      status,
      classifier: classifierParts.join('\n'),
      quality: qualityParts.join('\n'),
      action: actions.join('; ') + '.',
    };
  }

  function buildPublicationDossierSummary(
    rows: GoodsRow[],
    benchmarkingEnabled: boolean,
  ): PublicationDossierSummary {
    const dossierRows = rows.map((row, index) => buildPublicationDossierRow(row, index, benchmarkingEnabled));
    const readyItems = dossierRows.filter((row) => row.status === 'ready').length;
    const reviewItems = dossierRows.filter((row) => row.status === 'review').length;
    const blockedItems = dossierRows.filter((row) => row.status === 'block').length;
    const trustedClassification = rows.filter((row) => !requiresManualClassificationReview(row)).length;
    const benchmarkReady = rows.filter((row) => {
      if (!benchmarkingEnabled || isServiceCatalogType(row.type)) return true;
      if (!row.benchmark || !row.specs?.length) return false;
      return getBenchmarkRiskLevel(buildDraftSourceComparison(row.benchmark.sourceSpecs, row.specs, row.type)) === 'ok';
    }).length;
    const serviceReady = rows.filter((row) => {
      if (!isServiceCatalogType(row.type)) return true;
      if (!row.specs?.length) return false;
      const coverage = analyzeServiceSpecCoverage(row.specs);
      return coverage.hasResult && coverage.hasTiming && coverage.hasAcceptance && coverage.hasExecution && coverage.hasQualification;
    }).length;

    return {
      status: blockedItems > 0 ? 'block' : reviewItems > 0 ? 'warn' : 'ready',
      readyItems,
      reviewItems,
      blockedItems,
      trustedClassification,
      benchmarkReady,
      serviceReady,
    };
  }

  function buildPublicationDossierRows(
    rows: GoodsRow[],
    benchmarkingEnabled: boolean,
  ): PublicationDossierRow[] {
    return rows.map((row, index) => buildPublicationDossierRow(row, index, benchmarkingEnabled));
  }

  function buildPublicationDossierSummaryPayload(rows: GoodsRow[], benchmarkingEnabled: boolean) {
    const summary = buildPublicationDossierSummary(rows, benchmarkingEnabled);
    const dossierRows = buildPublicationDossierRows(rows, benchmarkingEnabled);
    return {
      status: summary.status,
      readyItems: summary.readyItems,
      reviewItems: summary.reviewItems,
      blockedItems: summary.blockedItems,
      trustedClassification: summary.trustedClassification,
      benchmarkReady: summary.benchmarkReady,
      serviceReady: summary.serviceReady,
      rows: dossierRows.map((row) => ({
        index: row.index,
        item: row.item,
        status: row.status,
        classifier: row.classifier,
        quality: row.quality,
        action: row.action,
      })),
    };
  }

  function buildStoredPublicationDossierPayload(rows: GoodsRow[], benchmarkingEnabled: boolean) {
    return buildPublicationDossierSummaryPayload(rows, benchmarkingEnabled);
  }

  function buildLegalSummaryText(rows: GoodsRow[]): string {
    const counts = { ban: 0, restriction: 0, preference: 0, exception: 0, none: 0 } as Record<string, number>;
    let withoutKtru = 0;
    let manualReview = 0;
    let autoBasis = 0;

    rows.forEach((row) => {
      const regime = row.meta?.nac_regime || getUnifiedNacRegime(row.type);
      const status = normalizeLaw175StatusValue(row.meta?.law175_status || '') || deriveLaw175StatusFromRegime(regime);
      counts[status] = (counts[status] || 0) + 1;
      if (!getResolvedKtruCode(row)) withoutKtru += 1;
      if (requiresManualClassificationReview(row)) manualReview += 1;
      if (isAutoDerivedLaw175Basis(row.meta)) autoBasis += 1;
    });

    const covered = rows.length - (counts.none || 0);
    return `Юридическое резюме закупки: позиций — ${rows.length}; под меры ПП РФ № 1875 подпадает — ${covered}; запрет — ${counts.ban || 0}; ограничение — ${counts.restriction || 0}; преимущество — ${counts.preference || 0}; исключение — ${counts.exception || 0}; без мер — ${counts.none || 0}; без КТРУ — ${withoutKtru}; требуют ручной верификации — ${manualReview}; автооснование ПП1875 — ${autoBasis}.`;
  }

  function buildPublicationDossierSectionRows(
    rows: GoodsRow[],
    benchmarkingEnabled: boolean,
  ): SectionTableRowLike[] {
    const summary = buildPublicationDossierSummary(rows, benchmarkingEnabled);
    const dossierRows = buildPublicationDossierRows(rows, benchmarkingEnabled);
    const serviceRowsCount = rows.filter((row) => isServiceCatalogType(row.type)).length;
    return [
      {
        label: 'ПП.1',
        value: buildPublicationDossierSummaryText(summary, rows.length, serviceRowsCount),
      },
      ...dossierRows.map((row) => ({
        label: `ПП.${Number(row.index) + 1}`,
        value: `Позиция №${row.index}: ${row.item}. Статус: ${getPublicationDossierRowStatusLabel(row.status)}. Классификация: ${row.classifier.replace(/\n/g, '; ')}. Качество и доказательная база: ${row.quality.replace(/\n/g, '; ')}. Что делать: ${row.action}`,
      })),
    ];
  }

  return {
    analyzeServiceSpecCoverage,
    applyLegalReadinessPatchToRow,
    applyServiceReadinessPatchToRow,
    buildLegalSummaryRow,
    buildLegalSummaryText,
    buildPublicationDossierRows,
    buildPublicationDossierSectionRows,
    buildPublicationDossierSummary,
    buildPublicationDossierSummaryText,
    buildReadinessGateSummary,
    buildReadinessIssuePreview,
    buildServiceAutofillEntries,
    buildStoredPublicationDossierPayload,
    buildStoredReadinessPayload,
    getPublicationDossierRowStatusLabel,
    shouldApplyLegalReadinessPatch,
  };
}
