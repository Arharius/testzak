import { lazy, Suspense, useMemo, useState, useCallback, useRef, useEffect, type ChangeEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  flushAutomationQueue,
  flushPlatformQueue,
  detectBrandTypesAI,
  generateItemSpecs,
  generateItemSpecsMessages,
  postPlatformDraft,
  sendEventThroughBestChannel,
} from '../lib/api';
import {
  BACKEND_URL,
  generateWithBackend,
  isBackendApiAvailable,
  runEnterpriseAutopilot,
  searchEisSpecs,
  searchInternetSpecs,
  detectBrandTypesViaBackend,
  saveTZDocument,
  saveTZDocumentLocal,
  listTZDocuments,
  listLocalTZDocuments,
  getTZDocument,
  getLocalTZDocument,
  deleteTZDocument,
  deleteLocalTZDocument,
  isLocalTZDocumentId,
  isLoggedIn,
  type SpecFromSearch,
  type TZDocumentSummary,
  type TZValidateResponse,
  searchOkpd2,
  saveGeneration,
} from '../lib/backendApi';
import { TZValidationModal } from './TZValidationModal';
import { TZReviewPanel } from './TZReviewPanel';
import { ProcessStepper } from './ProcessStepper';
import { EntryChoice } from './EntryChoice';
import type { TZReviewIssue } from '../lib/backendApi';
import {
  appendAutomationLog,
  appendImmutableAudit,
  deleteWorkspaceTemplate,
  getWorkspaceTemplates,
  saveWorkspaceTemplate,
  type WorkspaceTemplateStored,
} from '../lib/storage';
import type { AutomationSettings, EnterpriseSettings, PlatformIntegrationSettings } from '../types/schemas';
import { GOODS_CATALOG, detectGoodsType, detectAllGoodsTypes, getNacRegime, type GoodsItem, type HardSpec } from '../data/goods-catalog';
import { GENERAL_CATALOG, detectGeneralGoodsType, detectGeneralGoodsTypes, getGeneralNacRegime, type GeneralGoodsItem } from '../data/general-catalog';
import { postProcessSpecs, parseAiResponse, type SpecItem } from '../utils/spec-processor';
import { deriveCommercialContext, resolveCommercialTerms, type LdapLicenseProfile } from '../utils/commercial-terms';
import { looksLikeSpecificModelQuery } from '../utils/model-search';
import { hasSufficientExactModelCoverage } from '../utils/model-quality';
import { type LawMode } from '../utils/npa-blocks';
import { buildOrganizationMemoryPromptBlock, getOrganizationPresetMeta } from '../utils/organization-memory';
import { toGenitive } from '../utils/morph';
import {
  getSuggestedOrganizationTemplatePacks,
  suggestTemplateNameForPreset,
  type OrganizationTemplatePack,
} from '../utils/organization-templates';
import { parseImportedRows, type ImportedRowImportInfo } from '../utils/row-import';
import { APP_BUILD_LABEL } from '../utils/build-info';
import { WorkspaceRowsTable } from './WorkspaceRowsTable';
import { createWorkspacePublicationTools } from './workspace-publication';
import { WorkspaceTypeSuggestions } from './WorkspaceTypeSuggestions';
import { DoubleEquivalentReport } from './DoubleEquivalentReport';
import { runDoubleEquivalentCheck, widenSpecsForDoubleEquiv, type DoubleEquivResult } from '../utils/double-equivalent';
import { fetchSpecsViaBackend, type SpecConflict } from '../utils/fetch-specs';

const WorkspaceSidePanels = lazy(async () => {
  const mod = await import('./WorkspacePanels');
  return { default: mod.WorkspaceSidePanels };
});

const WorkspaceReviewSections = lazy(async () => {
  const mod = await import('./WorkspacePanels');
  return { default: mod.WorkspaceReviewSections };
});

const WorkspacePreview = lazy(async () => {
  const mod = await import('./WorkspacePreview');
  return { default: mod.WorkspacePreview };
});

// ── Объединённый каталог: ИТ + не-ИТ ─────────────────────────
type CatalogMode = 'it' | 'general';

/** Адаптер: GeneralGoodsItem → GoodsItem для совместимости */
function toGoodsItem(g: GeneralGoodsItem): GoodsItem {
  return {
    name: g.name,
    okpd2: g.okpd2,
    okpd2name: g.okpd2name,
    ktruFixed: g.ktruFixed,
    placeholder: g.placeholder,
    isService: g.isService,
  };
}
/** Единый lookup по ключу из обоих каталогов */
function lookupCatalog(key: string): GoodsItem {
  return GOODS_CATALOG[key] ?? (GENERAL_CATALOG[key] ? toGoodsItem(GENERAL_CATALOG[key]) : toGoodsItem(GENERAL_CATALOG.otherGoods));
}
/** Единый getNacRegime */
function getUnifiedNacRegime(key: string): string {
  if (GOODS_CATALOG[key]) return getNacRegime(key);
  if (GENERAL_CATALOG[key]) return getGeneralNacRegime(key);
  return 'none';
}
/** Есть ли specHint в general-catalog */
function getSpecHint(key: string): string | undefined {
  return GENERAL_CATALOG[key]?.specHint;
}
function isServiceCatalogType(key: string): boolean {
  return !!lookupCatalog(key)?.isService;
}

const SERVICE_EXPLICIT_TOKENS = ['услуг', 'услуга', 'оказани', 'обслуживан', 'сопровождени', 'аутсорс', 'уборк', 'охран', 'разработк', 'внедрени', 'интеграц', 'обучени', 'консалтинг', 'аудит', 'поддержк', 'медосмотр', 'медицинск', 'осмотр', 'обследован', 'освидетельств', 'диагностик'];
const SERVICE_ACTION_TOKENS = ['монтаж', 'демонтаж', 'ремонт', 'настройка', 'настройки', 'пусконаладка', 'пусконаладочные'];
const PRODUCT_NOUN_TOKENS = ['клей', 'пена', 'лента', 'розетк', 'рулетк', 'нож', 'ведро', 'смазк', 'шпаклев', 'отвертк', 'отвёртк', 'инструмент', 'сверл', 'коронк', 'плоскогуб', 'клещ', 'патрон', 'площадк', 'зажим', 'шуруп', 'полотно', 'пилк', 'емкост', 'ёмкост'];
const DOCX_STRONG_IT_CONTEXT_TOKENS = [
  'astra', 'linux', 'windows', 'ald', 'ald pro', 'rupost', 'термидеск', 'termidesk', 'брест',
  'сервер', 'ноутбук', 'моноблок', 'мфу', 'многофункциональное', 'принтер', 'сканер',
  'картридж', 'тонер', 'монитор', 'коммутатор', 'маршрутизатор', 'точка доступа', 'vdi',
  'ldap', 'почтов', 'операционн', 'программн', 'лицензия', 'резервного', 'резервное',
  'резервный', 'резервная', 'виртуализац', 'системный блок', 'компьютер', 'ssd', 'hdd',
  'процессор', 'клавиатур', 'мышь', 'гарнитур', 'веб камера', 'usb', 'hdmi', 'dvd', 'cd r',
  'cd rw', 'оптическ', 'твердотельн', 'схд', 'ибп', 'nas', 'san', 'витая пара', 'rj45',
  'rj 45', '8p8c', 'акустическ', 'колонки', 'видеоадаптер', 'displayport', 'dp', 'vga',
  'переходник hdmi', 'переходник dp', 'внешний привод', 'привод dvd', 'привод cd', 'привод blu', 'привод оптич', 'dvd привод', 'cd привод', 'кабель адаптер видео',
  'тестер', 'мультиметр', 'накопитель', 'флеш', 'флэш', 'токен', 'рутокен', 'jacarta',
  'веб-камера', 'вебкамера', 'камера', 'коннектор', 'патч корд', 'патч-корд',
  'шредер', 'уничтожител', 'ламинатор', 'переплетчик', 'брошюровщик',
  'кабель', 'удлинител', 'сетевой фильтр', 'блок питания', 'адаптер питания',
  'наушник', 'гарнитура', 'микрофон', 'динамик', 'колонк',
  'набор инструментов', 'кримпер', 'обжимной инструмент', 'паяльник',
  'прецизионная отвертка', 'набор отверток', 'ремонтный набор',
  'внешний накопитель', 'носитель информации', 'флэш накопитель', 'флэш-накопитель',
];

function normalizeTypeMatchText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();
}

function looksLikeServiceQuery(value: string): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  const normalized = normalizeTypeMatchText(text);
  const hasMeasuredCue = /(?:\d+(?:[.,]\d+)?\s*(?:мм|см|мл|л|кг|г|шт|в|а|вт|ач|mah|м2|м3)|\d+\s*[xх×]\s*\d+)/i.test(normalized);
  const hasProductCue = hasMeasuredCue
    || ['тип продукта', 'материал', 'цвет', 'размер', 'длина', 'ширина', 'высота', 'диаметр', 'корпус', 'объем', 'объём', 'напряжение', 'мощность', 'артикул'].some((token) => normalized.includes(token))
    || PRODUCT_NOUN_TOKENS.some((token) => normalized.includes(token));
  if (normalized.includes('оказание услуг')) return true;
  const hasExplicit = SERVICE_EXPLICIT_TOKENS.some((token) => normalized.includes(token));
  if (hasExplicit && !hasProductCue) return true;
  return SERVICE_ACTION_TOKENS.some((token) => normalized.includes(token)) && !hasProductCue;
}

type Law175StatusNormalized = 'ban' | 'restriction' | 'preference' | 'exception' | 'none';

function normalizeLaw175StatusValue(raw: string): Law175StatusNormalized | '' {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return '';
  if (['forbidden', 'ban', 'banned', 'zapret', 'запрет'].includes(value)) return 'ban';
  if (['restricted', 'restriction', 'limited', 'ограничение', 'условия допуска'].includes(value)) return 'restriction';
  if (['preferred', 'preference', 'advantage', 'preferential', 'преимущество'].includes(value)) return 'preference';
  if (['exempt', 'exception', 'allowed', 'исключение', 'допускается'].includes(value)) return 'exception';
  if (['none', 'not_applicable', 'без ограничений', 'не применяется'].includes(value)) return 'none';
  return '';
}

function deriveLaw175StatusFromRegime(regime: string): Law175StatusNormalized {
  switch (regime) {
    case 'pp1236':
      return 'ban';
    case 'pp878':
      return 'restriction';
    case 'pp616':
      return 'ban';
    default:
      return 'none';
  }
}

function normalizeLaw175BasisText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// ── Очистка имени каталога от UI-символов для использования в документах ─────
function cleanCatalogName(name: string): string {
  return name
    .replace(/^[⭐★✅❌🔴🟡🟢🔵⚠️•·→►▶]+\s*/u, '')
    .replace(/\s*\(ручной\s+ввод\)/i, '')
    .replace(/\s*\(ручной\s+импорт\)/i, '')
    .trim();
}

function isPlaceholderLaw175Basis(value: string): boolean {
  const basis = normalizeLaw175BasisText(value).toLowerCase();
  if (!basis) return true;
  return (
    /кратк(ое|ий)\s+пояснен/.test(basis) ||
    /запрет\s*\/\s*ограничени/.test(basis) ||
    /преимуществ|исключени|не применяетс/.test(basis) && basis.length < 32 ||
    basis === 'требуется проверка' ||
    basis === 'нужно уточнение' ||
    basis === 'будет определено позже'
  );
}

function deriveLaw175BasisText(rowType: string, meta: Record<string, string> = {}): string {
  const goods = lookupCatalog(rowType);
  const regime = String(meta.nac_regime || getUnifiedNacRegime(rowType) || 'none');
  const status = normalizeLaw175StatusValue(meta.law175_status || '') || deriveLaw175StatusFromRegime(regime);
  const ktru = String(meta.ktru_code || goods.ktruFixed || '').trim();
  const source = getClassificationSourceLabel(meta, rowType);
  const ktruSuffix = ktru ? ` КТРУ: ${ktru}.` : '';

  if (status === 'exception') {
    return `Требуется отдельное документально подтвержденное основание исключения из защитной меры ПП РФ № 1875; до публикации закупки Заказчик обязан проверить применимость исключения и отразить его в извещении.${ktruSuffix}`;
  }
  if (status === 'none') {
    if (goods.isService) {
      return `По текущей классификации позиция относится к услугам, специальные защитные меры ПП РФ № 1875 обычно не применяются; требуется итоговая проверка отсутствия специального основания на дату публикации.${ktruSuffix}`;
    }
    return `По текущей классификации позиция не подпадает под защитную меру ПП РФ № 1875; необходимо проверить актуальную редакцию перечней и оснований неприменения на дату публикации.${ktruSuffix}`;
  }
  if (status === 'preference') {
    return `По позиции применяется преимущество по ПП РФ № 1875; необходимо описать механизм предоставления преимущества и приложить документы о происхождении товара или ПО.${ktruSuffix}`;
  }
  if (regime === 'pp1236') {
    return `Позиция классифицирована как программное обеспечение; подтверждение российского или евразийского происхождения выполняется через реестр Минцифры России или евразийский реестр ПО в рамках ПП РФ № 1875 и правил ПП РФ № 1236. Источник классификации: ${source}.${ktruSuffix}`;
  }
  if (regime === 'pp878') {
    return `Позиция классифицирована как радиоэлектронная продукция; подтверждение происхождения выполняется через ГИСП или евразийский реестр промышленной продукции в порядке ПП РФ № 1875. Источник классификации: ${source}.${ktruSuffix}`;
  }
  if (regime === 'pp616') {
    return `Позиция классифицирована как промышленный товар; подтверждение происхождения выполняется через применимые промышленные реестры и документы по ПП РФ № 1875, при необходимости с учетом ПП РФ № 719. Источник классификации: ${source}.${ktruSuffix}`;
  }
  return `Требуется проверить применимость мер ПП РФ № 1875 по текущей классификации позиции. Источник классификации: ${source}.${ktruSuffix}`;
}

function isAutoDerivedLaw175Basis(meta: Record<string, string> = {}): boolean {
  return String(meta.law175_basis_auto || '').trim() === '1';
}

function formatLaw175BasisDisplayText(value: string, autoDerived = false): string {
  const basis = normalizeLaw175BasisText(value);
  if (!basis) return '';
  // Авто-сгенерированные тексты содержат служебные фразы — не выводим в документ
  if (autoDerived) return '';
  // Фильтруем тексты-заглушки, которые не должны попасть в ТЗ
  const lower = basis.toLowerCase();
  if (
    /обычно не применяютс/.test(lower) ||
    /требуется.*провер/.test(lower) ||
    /как правило/.test(lower) ||
    /при применимости/.test(lower) ||
    /необходимо проверить/.test(lower) ||
    /требует.*уточнен/.test(lower) ||
    /будет определен/.test(lower)
  ) return '';
  return basis;
}

function getResolvedLaw175Meta(rowType: string, meta: Record<string, string> = {}) {
  const regime = String(meta.nac_regime || getUnifiedNacRegime(rowType) || 'none');
  const status = normalizeLaw175StatusValue(meta.law175_status || '') || deriveLaw175StatusFromRegime(regime);
  const basis = normalizeLaw175BasisText(meta.law175_basis || '');
  const basisAuto = isAutoDerivedLaw175Basis(meta);
  return {
    regime,
    status,
    basis,
    basisAuto,
    basisWeak: !basis || basisAuto || isPlaceholderLaw175Basis(basis),
    basisDisplay: formatLaw175BasisDisplayText(basis, basisAuto),
    promptBasis: basis || deriveLaw175BasisText(rowType, { ...meta, nac_regime: regime, law175_status: status }),
  };
}

function getLaw175MeasureLabel(status: string, regime: string): string {
  const normalized = normalizeLaw175StatusValue(status) || deriveLaw175StatusFromRegime(regime);
  switch (normalized) {
    case 'ban':
      return 'запрет';
    case 'restriction':
      return 'ограничение';
    case 'preference':
      return 'преимущество';
    case 'exception':
      return 'исключение';
    default:
      return 'без ограничений';
  }
}

function getLaw175MeasureText(status: string, regime: string, basis = ''): string {
  const normalized = normalizeLaw175StatusValue(status) || deriveLaw175StatusFromRegime(regime);
  const basisSuffix = basis ? ` Основание / уточнение: ${basis}.` : '';
  switch (normalized) {
    case 'ban':
      return `ПП РФ № 1875: применяется запрет поставки иностранной продукции / иностранного ПО по данной позиции.${basisSuffix}`;
    case 'restriction':
      return `ПП РФ № 1875: применяется ограничение допуска и требуется подтверждение страны происхождения по данной позиции.${basisSuffix}`;
    case 'preference':
      return `ПП РФ № 1875: применяется преимущество российской / евразийской продукции.${basisSuffix}`;
    case 'exception':
      return `ПП РФ № 1875: применяется исключение из защитной меры, которое должно быть подтверждено документально.${basisSuffix}`;
    default:
      return `ПП РФ № 1875: меры национального режима по данной позиции не применяются.${basisSuffix}`;
  }
}

function detectTypeByImportedOkpd2(description: string, okpd2?: string): string | null {
  const code = String(okpd2 || '').trim();
  if (!code) return null;

  if (/^26\.20\.14\./.test(code)) return 'flashDrive';

  const normalized = normalizeTypeMatchText(description);
  if (!normalized) return null;

  if (/(витая пара|патч|patch|utp|ftp|stp|s\/ftp|cat5|cat6|cat6a|rj45 кабел|ethernet|lan кабел)/.test(normalized)
    && /^27\.(31|32)\./.test(code)) {
    return 'patchCord';
  }
  if (/(коннектор|rj45|rj 45|8p8c|штекер)/.test(normalized) && /^26\.30\.30\./.test(code)) {
    return 'rj45Connector';
  }
  if (/(тестер|lan тестер|кабельн)/.test(normalized) && /^26\.51\.43\./.test(code)) {
    return 'cableTester';
  }
  if (/(акустическ|колонк|speakers|звуков)/.test(normalized) && /^26\.40\.32\./.test(code)) {
    return 'speakers';
  }
  if (/^26\.20\.40\.140$/.test(code)) return 'opticalDrive';
  if (/^26\.20\.40\.120$/.test(code)) return 'extSsd';
  if (/^26\.20\.40\.110$/.test(code)) return 'extHdd';
  if (/(набор инструментов|tool set|toolkit|набор отверток|ремонтный набор|монтажный набор|сервисный набор)/.test(normalized)
    && /^(25\.73|27\.33)/.test(code)) {
    return 'toolSet';
  }
  if (/(кримпер|обжимной инструмент|crimper|обжимка|клещи обжимные)/.test(normalized)
    && /^25\.73/.test(code)) {
    return 'crimper';
  }
  if (/(паяльник|паяльная станция|soldering)/.test(normalized)
    && /^27\.90\.31/.test(code)) {
    return 'soldering';
  }
  if (/(мультиметр|мультитестер|multimeter)/.test(normalized)
    && /^26\.51/.test(code)) {
    return 'multimeter';
  }

  return null;
}

function detectFreeformRowType(rawType: string, description: string, options?: { conservativeGeneral?: boolean; okpd2?: string; contextText?: string }): string {
  const primaryText = `${rawType} ${description}`.trim();
  const text = (options?.contextText && primaryText)
    ? `${primaryText} ${options.contextText.slice(0, 400)}`
    : primaryText;
  if (!text) return 'otherGoods';
  const normalized = normalizeTypeMatchText(text);
  if (looksLikeServiceQuery(text)) {
    return 'otherService';
  }
  // пример ввода: масло для шредера 350 мл
  if (/(масл|смазк|lubric|oil)/.test(normalized)
    && /(шредер|уничтожител|бумагоуничтожател|document shred)/.test(normalized)) {
    return 'shredderOil';
  }
  if (normalized.includes('мфу') || normalized.includes('многофункциональное устройство')) {
    return 'mfu';
  }
  if ((normalized.includes('резервного копирования') || normalized.includes('backup'))
    && (normalized.includes('лиценз') || normalized.includes('система') || normalized.includes('программ'))) {
    return 'backup_sw';
  }
  const okpd2DetectedType = detectTypeByImportedOkpd2(text, options?.okpd2);
  const itType = detectGoodsType(text, 'otherGoods');
  const generalType = detectGeneralGoodsType(text, 'otherGoods');
  const allowItType = !options?.conservativeGeneral || DOCX_STRONG_IT_CONTEXT_TOKENS.some((token) => normalized.includes(token));
  if (itType !== 'otherGoods' && allowItType && !['miscHardware', 'miscCable', 'miscConsumable', 'miscSoftware'].includes(itType)) {
    return itType;
  }
  if (okpd2DetectedType) {
    return okpd2DetectedType;
  }
  if (options?.conservativeGeneral) {
    const strongGeneralMatch = detectGeneralGoodsTypes(text, 3).find((candidate) => {
      const candidateNorm = normalizeTypeMatchText(candidate.name);
      return candidateNorm.length >= 8 && (normalized.includes(candidateNorm) || candidateNorm.includes(normalized));
    });
    return strongGeneralMatch?.type || 'otherGoods';
  }
  if (generalType !== 'otherGoods') {
    return generalType;
  }
  return itType !== 'otherGoods' ? itType : 'otherGoods';
}

function detectAllCatalogTypes(query: string): Array<{ type: string; name: string; okpd2: string }> {
  const items = [...detectAllGoodsTypes(query), ...detectGeneralGoodsTypes(query)];
  if (looksLikeServiceQuery(query)) {
    items.unshift({
      type: 'otherService',
      name: GENERAL_CATALOG.otherService.name,
      okpd2: '',
    });
  }
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item?.type || seen.has(item.type)) return false;
    seen.add(item.type);
    return true;
  });
}

function isUniversalMetaComplete(meta: Record<string, string> = {}): boolean {
  return !!String(meta.okpd2_code || '').trim() && !!String(meta.okpd2_name || '').trim();
}
import { buildAntiFasReport, buildAntiFasAutoFixes, sanitizeProcurementSpecs, validateDocumentText, type ComplianceReport, applyComplianceFixes } from '../utils/compliance';

type Provider = 'openrouter' | 'groq' | 'deepseek' | 'gigachat';

interface GoodsRow {
  id: number;
  type: string;
  typeLocked?: boolean;
  model: string;
  licenseType: string;
  term: string;
  licenseTypeAuto?: boolean;
  termAuto?: boolean;
  qty: number;
  status: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
  specs?: SpecItem[];
  meta?: Record<string, string>;
  benchmark?: RowBenchmarkEvidence;
  importInfo?: ImportedRowImportInfo;
  // Яндекс-подсказки и ссылки ЕИС (хранятся в отдельном state, не здесь)
}

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

type RowBenchmarkEvidence = {
  source: 'internet' | 'eis' | 'ai';
  sourceCompareLabel: string;
  sourceContextText?: string;
  sourceSpecs: SpecItem[];
};

type BenchmarkRiskLevel = 'ok' | 'warn' | 'block';

type ReadinessIssueLevel = 'block' | 'warn';
type ReadinessActionKind = 'focus' | 'internet' | 'eis' | 'classify' | 'benchmark_missing' | 'benchmark_all' | 'service_fill_core' | 'service_fill_all' | 'legal_safe_fix' | 'antifas_autofix';

type ReadinessIssue = {
  key: string;
  level: ReadinessIssueLevel;
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

type SpecsCandidate = {
  specs: SpecItem[];
  meta: Record<string, string>;
  source: 'internet' | 'eis' | 'ai';
  sourceSpecs?: SpecItem[];
  sourceCompareLabel?: string;
  sourceContextText?: string;
};

type GenerateOptions = {
  forceAutopilot?: boolean;
  trigger?: 'manual' | 'autopilot_button';
  rowId?: number;
};

type GenerationProgress = {
  current: number;
  total: number;
  batchSize: number;
  batchIndex: number;
  totalBatches: number;
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

type ProcurementPurposeKey =
  | 'network'
  | 'workstations'
  | 'server'
  | 'components'
  | 'peripherals'
  | 'software'
  | 'security'
  | 'consumables'
  | 'tools'
  | 'services'
  | 'general';

type ProcurementPurposeMeta = {
  key: ProcurementPurposeKey;
  label: string;
  title: string;
  order: number;
};

type ProcurementSplitGroup = ProcurementPurposeMeta & {
  count: number;
  rows: GoodsRow[];
  preview: string;
};

const PROCUREMENT_PURPOSE_META: Record<ProcurementPurposeKey, ProcurementPurposeMeta> = {
  network: { key: 'network', label: 'Сетевое', title: 'ТЗ на сетевое оборудование и СКС', order: 10 },
  workstations: { key: 'workstations', label: 'Рабочие места', title: 'ТЗ на рабочие станции и клиентские устройства', order: 20 },
  server: { key: 'server', label: 'Серверное', title: 'ТЗ на серверное оборудование и хранение данных', order: 30 },
  components: { key: 'components', label: 'Комплектующие', title: 'ТЗ на комплектующие для ПК и рабочих станций', order: 40 },
  peripherals: { key: 'peripherals', label: 'Периферия', title: 'ТЗ на периферию и оргтехнику', order: 50 },
  software: { key: 'software', label: 'ПО', title: 'ТЗ на программное обеспечение и лицензии', order: 60 },
  security: { key: 'security', label: 'ИБ', title: 'ТЗ на средства защиты информации', order: 70 },
  consumables: { key: 'consumables', label: 'Расходники', title: 'ТЗ на расходные материалы', order: 80 },
  tools: { key: 'tools', label: 'Инструменты', title: 'ТЗ на инструменты и оснастку', order: 90 },
  services: { key: 'services', label: 'Услуги', title: 'ТЗ на услуги', order: 100 },
  general: { key: 'general', label: 'Общее', title: 'ТЗ на товары общего назначения', order: 110 },
};

const PROCUREMENT_TYPE_TO_PURPOSE: Partial<Record<string, ProcurementPurposeKey>> = {
  pc: 'workstations',
  laptop: 'workstations',
  monoblock: 'workstations',
  tablet: 'workstations',
  thinClient: 'workstations',
  server: 'server',
  serverBlade: 'server',
  san: 'server',
  nas: 'server',
  tapeLib: 'server',
  serverRack: 'server',
  rackCabinet: 'server',
  pdu: 'server',
  kvm_server: 'server',
  switch: 'network',
  router: 'network',
  firewall: 'network',
  accessPoint: 'network',
  patchPanel: 'network',
  mediaConverter: 'network',
  patchCord: 'network',
  fiberCable: 'network',
  powerCable: 'network',
  hdmiCable: 'network',
  monitor: 'peripherals',
  printer: 'peripherals',
  mfu: 'peripherals',
  scanner: 'peripherals',
  kvm: 'peripherals',
  ups: 'peripherals',
  projector: 'peripherals',
  interactive: 'peripherals',
  headset: 'peripherals',
  cpu: 'components',
  gpu: 'components',
  motherboard: 'components',
  psu: 'components',
  cooling: 'components',
  ram: 'components',
  ssd: 'components',
  hdd: 'components',
  flashDrive: 'components',
  extSsd: 'components',
  extHdd: 'components',
  opticalDrive: 'components',
  extOpticalDrive: 'components',
  keyboard: 'components',
  mouse: 'components',
  keyboardMouseSet: 'components',
  webcam: 'components',
  conferenceCamera: 'components',
  speakers: 'components',
  videoAdapter: 'components',
  usbToken: 'components',
  usbHub: 'components',
  memoryCard: 'components',
  cardReader: 'components',
  dockingStation: 'components',
  parts: 'components',
  dvd: 'consumables',
  cdr: 'consumables',
  cdrw: 'consumables',
  dvdr: 'consumables',
  dvdrw: 'consumables',
  bdr: 'consumables',
  ltoTape: 'consumables',
  ltoCleaningCartridge: 'consumables',
  cartridge: 'consumables',
  paper: 'consumables',
  toner: 'consumables',
  drum: 'consumables',
  cableTester: 'network',
  toolSet: 'network',
  os: 'software',
  office: 'software',
  virt: 'software',
  vdi: 'software',
  dbms: 'software',
  erp: 'software',
  cad: 'software',
  license: 'software',
  email: 'software',
  vks: 'software',
  ecm: 'software',
  portal: 'software',
  project_sw: 'software',
  bpm: 'software',
  backup_sw: 'software',
  itsm: 'software',
  monitoring: 'software',
  mdm: 'software',
  hr: 'software',
  gis: 'software',
  antivirus: 'security',
  edr: 'security',
  firewall_sw: 'security',
  dlp: 'security',
  siem: 'security',
  crypto: 'security',
  waf: 'security',
  pam: 'security',
  iam: 'security',
  pki: 'security',
};

function trimPreviewText(value: string, maxLen = 240): string {
  const source = String(value || '').replace(/\s+/g, ' ').trim();
  if (source.length <= maxLen) return source;
  return source.slice(0, Math.max(0, maxLen - 1)) + '…';
}

function getImportedSpecs(row: GoodsRow): SpecItem[] {
  return Array.isArray(row.specs) ? row.specs : [];
}

function cloneGoodsRows(rows: GoodsRow[]): GoodsRow[] {
  return rows.map((row) => ({
    ...row,
    specs: row.specs?.map((spec) => ({ ...spec })),
    meta: row.meta ? { ...row.meta } : undefined,
    benchmark: row.benchmark ? {
      ...row.benchmark,
      sourceSpecs: row.benchmark.sourceSpecs.map((spec) => ({ ...spec })),
    } : undefined,
    importInfo: row.importInfo ? {
      ...row.importInfo,
      notes: [...row.importInfo.notes],
    } : undefined,
  }));
}

function hasImportedSeedSpecs(row: GoodsRow): boolean {
  return row.status !== 'done' && getImportedSpecs(row).length > 0;
}

function getImportedSourceContext(row: GoodsRow): string {
  return String(row.importInfo?.sourceContextText || '').trim();
}

function buildImportedSpecsPromptBlock(row: GoodsRow): string {
  const contextText = getImportedSourceContext(row);
  const importedSpecs = getImportedSpecs(row);
  if (!contextText && importedSpecs.length === 0 && !row.importInfo) return '';

  const hasDocxSpecs = importedSpecs.length > 0 && row.importInfo?.sourceFormat === 'docx';

  const specsJson = importedSpecs.length > 0
    ? JSON.stringify(
        importedSpecs.slice(0, 48).map((spec) => ({
          group: spec.group || '',
          name: spec.name || '',
          value: spec.value || '',
          unit: spec.unit || '—',
        })),
        null,
        2,
      )
    : '[]';

  const noteBlock = row.importInfo?.notes?.length
    ? row.importInfo.notes.slice(0, 6).map((note) => `- ${note}`).join('\n')
    : '';

  if (hasDocxSpecs) {
    return [
      '',
      '════════════════════════════════════════════════════════',
      'ХАРАКТЕРИСТИКИ ИЗ ФАЙЛА ЗАКАЗЧИКА — ЕДИНСТВЕННЫЙ ИСТОЧНИК ДАННЫХ',
      '════════════════════════════════════════════════════════',
      `У этой позиции ЕСТЬ ${importedSpecs.length} характеристик, загруженных из ТЗ-файла Заказчика.`,
      '',
      'ПРАВИЛО №1 — ЧИСЛА СОХРАНЯТЬ ТОЧНО БЕЗ ИСКЛЮЧЕНИЙ:',
      '  • «16 ГБ» → «не менее 16 ГБ» (ЗАПРЕЩЕНО: «не менее 8 ГБ»)',
      '  • «17.3"» → «не менее 17,3 дюйма» (ЗАПРЕЩЕНО: «не менее 15 дюймов»)',
      '  • «4.4 ГГц» → «не менее 4,4 ГГц» (ЗАПРЕЩЕНО: «не менее 2,4 ГГц»)',
      '  • «10 ядер» → «не менее 10» (ЗАПРЕЩЕНО: «не менее 8»)',
      '',
      'ПРАВИЛО №2 — СТРОКИ НЕ УДАЛЯТЬ: каждая строка ниже ОБЯЗАНА попасть в итоговую таблицу.',
      '  • Нельзя заменять конкретные характеристики шаблонными формулировками.',
      '  • Нельзя объединять несколько строк в одну, если это теряет информацию.',
      '',
      'ПРАВИЛО №3 — БРЕНДЫ: убрать ТОЛЬКО торговую марку, ВСЕ числовые параметры СОХРАНИТЬ.',
      '  • «Intel Core i5-1235U, 10 ядер, 3.3/4.4 ГГц» → «не менее 10 ядер, базовая частота не менее 3,3 ГГц, турбочастота не менее 4,4 ГГц»',
      '  • «Samsung DDR5 4800 МГц» → «DDR5, частота не менее 4800 МГц»',
      '',
      'ПРАВИЛО №4 — ЗАПРЕТ НА ГЕНЕРАЦИЮ С НУЛЯ:',
      '  • ЗАПРЕЩЕНО игнорировать данные ниже и генерировать новый список.',
      '  • ЗАПРЕЩЕНО добавлять новые строки ВМЕСТО существующих.',
      '  • Допустимо: добавить 2-3 недостающие характеристики В ДОПОЛНЕНИЕ к существующим.',
      '',
      'ПРАВИЛО №5 — КОДЫ И КЛАССИФИКАТОРЫ:',
      '  • ЗАПРЕЩЕНО включать коды ОКПД2, КТРУ в текст характеристик.',
      '  • Если в исходных данных есть коды — удалить из текста, не переносить в спеки.',
      '',
      `Характеристики из файла (${importedSpecs.length} строк):\n${specsJson}`,
      noteBlock ? `Примечания импорта:\n${noteBlock}` : '',
      contextText ? `Дополнительный контекст файла:\n${contextText}` : '',
      '════════════════════════════════════════════════════════',
      '',
    ].filter(Boolean).join('\n');
  }

  return [
    '',
    'КОНТЕКСТ ИЗ ИСХОДНОГО ФАЙЛА:',
    row.importInfo ? `- Качество импорта: ${Math.round((row.importInfo.confidence || 0) * 100)}% (${row.importInfo.confidenceLabel})` : '',
    row.importInfo?.ignoredBlocks ? `- Отфильтровано блоков требований / нормативки: ${row.importInfo.ignoredBlocks}` : '',
    noteBlock ? `Примечания импорта:\n${noteBlock}` : '',
    importedSpecs.length > 0 ? `Уже извлеченные характеристики из исходного DOCX:\n${specsJson}` : '',
    contextText ? `Смысловой контекст исходного DOCX:\n${contextText}` : '',
    '- Если в исходном DOCX уже есть полезные характеристики или ограничения, сохрани их смысл и дополняй, а не игнорируй.',
    '',
  ].filter(Boolean).join('\n');
}

function inferProcurementPurposeFromText(text: string): ProcurementPurposeKey {
  const normalized = String(text || '').toLowerCase();
  if (looksLikeServiceQuery(normalized)) return 'services';
  if (/(коммутатор|switch|router|маршрутизатор|wifi|wi-fi|сете|rj45|патч|скс|витая пара|sfp|оптич.*кабел|оптич.*волокн|тестер кабел|кабельный тестер)/i.test(normalized)) return 'network';
  if (/(сервер|схд|san|nas|ленточн|стойк|шкаф|kvm-server|хранилищ)/i.test(normalized)) return 'server';
  if (/(ноутбук|системный блок|моноблок|тонкий клиент|рабочая станция|планшет)/i.test(normalized)) return 'workstations';
  if (/(процессор|cpu|gpu|видеокарт|материнск|памят|ram|ssd|hdd|блок питания|кулер|охлажден|флеш|накопитель|клавиатур|мыш|веб.кам|колонк|токен|видеоадаптер|оптическ.*привод|внешний привод)/i.test(normalized)) return 'components';
  if (/(монитор|принтер|мфу|сканер|гарнитур|проектор|ибп)/i.test(normalized)) return 'peripherals';
  if (/(dvd|cd-r|dvd-r|rw|диск.*носитель|оптический диск|blu.ray диск|bd-r)/i.test(normalized)) return 'consumables';
  if (/(лиценз|астра|astra|ред ос|мойофис|р7|postgres|почтов|вкс|сэд|itsm|мониторинг|по\b|программн)/i.test(normalized)) return 'software';
  if (/(антивирус|siem|dlp|edr|pam|iam|крипт|скзи|межсетев|waf|иб\b|защит)/i.test(normalized)) return 'security';
  if (/(картридж|тонер|бумаг|фотобарабан|расходн)/i.test(normalized)) return 'consumables';
  if (/(инструмент|оснастк|сверл|шуруповерт|перфоратор|набор адаптеров|ключ|отвертк|бур|коронк)/i.test(normalized)) return 'tools';
  return 'general';
}

function getProcurementPurposeMeta(row: GoodsRow): ProcurementPurposeMeta {
  if (isServiceCatalogType(row.type)) return PROCUREMENT_PURPOSE_META.services;
  const direct = PROCUREMENT_TYPE_TO_PURPOSE[row.type];
  if (direct) return PROCUREMENT_PURPOSE_META[direct];
  const textKey = `${lookupCatalog(row.type).name} ${row.model}`;
  return PROCUREMENT_PURPOSE_META[inferProcurementPurposeFromText(textKey)];
}

function buildProcurementSplitGroups(rows: GoodsRow[]): ProcurementSplitGroup[] {
  const sourceRows = rows.filter((row) => row.model.trim() || row.specs?.length);
  const grouped = new Map<ProcurementPurposeKey, GoodsRow[]>();
  sourceRows.forEach((row) => {
    const purpose = getProcurementPurposeMeta(row);
    const bucket = grouped.get(purpose.key) || [];
    bucket.push(row);
    grouped.set(purpose.key, bucket);
  });

  return Array.from(grouped.entries())
    .map(([key, bucket]) => ({
      ...PROCUREMENT_PURPOSE_META[key],
      count: bucket.length,
      rows: bucket,
      preview: bucket
        .slice(0, 2)
        .map((row) => row.model || lookupCatalog(row.type).name)
        .join(' · '),
    }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'ru'));
}

function normalizeBenchmarkText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[-_/.,+()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeBenchmarkSpec(group: string, name: string, value: string, unit = ''): SpecItem {
  return { group, name, value, unit };
}

function guessSourceSpecGroup(name: string, goodsType = ''): string {
  const norm = normalizeBenchmarkText(name);
  if (!norm) return 'Основные характеристики';
  if (/наименован|описани|модел|артикул/.test(norm)) return 'Идентификация товара';
  if (/правооблад|производит|реестр|редакц|исполнени|верси|релиз/.test(norm)) return 'Общие сведения';
  if (/лиценз|подписк|право использ|рабоч.*мест|пользоват|узл|сеанс/.test(norm)) return 'Лицензирование';
  if (/функц|назначени|возможност/.test(norm)) return 'Функциональные требования';
  if (/интерфейс|порт|разъем|разъе|rest|soap|ldap|api/.test(norm)) return 'Интеграция';
  if (/совместим|ос\b|субд|инфраструктур|домен/.test(norm)) return 'Системные требования';
  if (/безопас|аудит|сертификат|фстэк|журналир|rbac|разгранич/.test(norm)) return 'Безопасность';
  if (/поддерж|обновлен|сопровожд/.test(norm)) return 'Поддержка и обновления';
  if (/комплект|поставк|ключ|дистрибутив|документац/.test(norm)) return 'Поставка';
  if (lookupCatalog(goodsType)?.isSoftware) return 'Основные характеристики';
  if (/тип|класс|мощност|частот|разрешени|объем|объе|емкост|ёмкост|скорост|габарит|форм фактор|подключени/.test(norm)) return 'Основные характеристики';
  return 'Основные характеристики';
}

function normalizeSourceSpecCollection(specs: Array<Partial<SpecItem>> | undefined, goodsType = ''): SpecItem[] {
  if (!Array.isArray(specs) || specs.length === 0) return [];
  const output: SpecItem[] = [];
  const seen = new Set<string>();

  for (const raw of specs) {
    if (!raw || typeof raw !== 'object') continue;
    const name = String(raw.name || '').replace(/\s+/g, ' ').trim();
    const value = String(raw.value || '').replace(/\s+/g, ' ').trim();
    if (!name || !value) continue;
    const unit = String(raw.unit || '').replace(/\s+/g, ' ').trim();
    const group = String(raw.group || guessSourceSpecGroup(name, goodsType)).replace(/\s+/g, ' ').trim() || 'Основные характеристики';
    const key = normalizeBenchmarkText(`${group}|${name}|${value}|${unit}`);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(makeBenchmarkSpec(group, name, value, unit));
  }

  return output;
}

function normalizeSpecCompareName(name: string): string {
  return normalizeBenchmarkText(name)
    .replace(/\b(характеристик[аи]?|параметр|значени[ея]|требовани[ея]|наличие)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSpecCompareText(value: string): string[] {
  const stop = new Set(['для', 'или', 'при', 'над', 'под', 'это', 'the', 'and', 'with', 'без', 'по', 'на', 'от']);
  return normalizeBenchmarkText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !stop.has(token));
}

function scoreSpecNameSimilarity(leftName: string, rightName: string): number {
  const left = normalizeSpecCompareName(leftName);
  const right = normalizeSpecCompareName(rightName);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return Math.max(0.82, Math.min(left.length, right.length) / Math.max(left.length, right.length));
  }
  const leftTokens = tokenizeSpecCompareText(left);
  const rightTokens = tokenizeSpecCompareText(right);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let common = 0;
  leftSet.forEach((token) => {
    if (rightSet.has(token)) common += 1;
  });
  const ratio = common / Math.max(leftSet.size, rightSet.size, 1);
  if (ratio >= 0.8) return ratio;
  if (ratio >= 0.5 && (left.includes(rightTokens[0]) || right.includes(leftTokens[0]))) return ratio + 0.12;
  return ratio;
}

function normalizeSpecCompareValue(value: string, unit = ''): string {
  return normalizeBenchmarkText(`${value || ''} ${unit || ''}`)
    .replace(/\bили эквивалент\b/g, ' ')
    .replace(/\bне менее\b/g, ' ')
    .replace(/\bне более\b/g, ' ')
    .replace(/\bв соответствии с техническ[а-я\s]+$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function areSpecValuesComparable(leftSpec?: Partial<SpecItem>, rightSpec?: Partial<SpecItem>): boolean {
  const left = normalizeSpecCompareValue(String(leftSpec?.value || ''), String(leftSpec?.unit || ''));
  const right = normalizeSpecCompareValue(String(rightSpec?.value || ''), String(rightSpec?.unit || ''));
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const leftNums = left.match(/\d+(?:[.,]\d+)?/g) || [];
  const rightNums = right.match(/\d+(?:[.,]\d+)?/g) || [];
  if (leftNums.length && rightNums.length && leftNums.join('|') === rightNums.join('|')) return true;
  const leftTokens = tokenizeSpecCompareText(left);
  const rightTokens = tokenizeSpecCompareText(right);
  if (!leftTokens.length || !rightTokens.length) return false;
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let common = 0;
  leftSet.forEach((token) => {
    if (rightSet.has(token)) common += 1;
  });
  return (common / Math.max(leftSet.size, rightSet.size, 1)) >= 0.72;
}

function buildDraftSourceComparison(
  sourceSpecs: Array<Partial<SpecItem>> | undefined,
  draftSpecs: Array<Partial<SpecItem>> | undefined,
  goodsType = '',
): DraftSourceComparison {
  const sourceList = normalizeSourceSpecCollection(sourceSpecs, goodsType);
  const draftList = normalizeSourceSpecCollection(draftSpecs, goodsType);
  const usedDraftIndexes = new Set<number>();
  const matched: DraftSourcePair[] = [];
  const changed: DraftSourcePair[] = [];
  const onlySource: DraftSourcePair[] = [];

  sourceList.forEach((sourceSpec) => {
    let bestIdx = -1;
    let bestScore = 0;
    draftList.forEach((draftSpec, idx) => {
      if (usedDraftIndexes.has(idx)) return;
      const score = scoreSpecNameSimilarity(String(sourceSpec?.name || ''), String(draftSpec?.name || ''));
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });

    if (bestIdx === -1 || bestScore < 0.56) {
      onlySource.push({ sourceSpec });
      return;
    }

    usedDraftIndexes.add(bestIdx);
    const draftSpec = draftList[bestIdx];
    if (areSpecValuesComparable(sourceSpec, draftSpec)) {
      matched.push({ sourceSpec, draftSpec, score: bestScore });
    } else {
      changed.push({ sourceSpec, draftSpec, score: bestScore });
    }
  });

  const onlyDraft = draftList
    .map((draftSpec, idx) => ({ draftSpec, idx }))
    .filter(({ idx }) => !usedDraftIndexes.has(idx))
    .map(({ draftSpec }) => ({ draftSpec }));

  return {
    sourceTotal: sourceList.length,
    draftTotal: draftList.length,
    matched,
    changed,
    onlySource,
    onlyDraft,
  };
}

function formatSpecLine(spec?: Partial<SpecItem>): string {
  if (!spec) return '—';
  const unit = String(spec.unit || '').trim();
  return `${String(spec.name || '').trim()}: ${String(spec.value || '').trim()}${unit ? ` ${unit}` : ''}`.trim();
}

function buildComparisonPreviewText(pairs: DraftSourcePair[], kind: 'changed' | 'missing' | 'added', limit = 3): string {
  if (!pairs.length) return 'не выявлено';
  return pairs.slice(0, limit).map((pair) => {
    if (kind === 'changed') {
      return `${String(pair.sourceSpec?.name || pair.draftSpec?.name || 'Характеристика')}: источник — ${String(pair.sourceSpec?.value || '').trim()}${pair.sourceSpec?.unit ? ` ${pair.sourceSpec.unit}` : ''}; наше ТЗ — ${String(pair.draftSpec?.value || '').trim()}${pair.draftSpec?.unit ? ` ${pair.draftSpec.unit}` : ''}`;
    }
    if (kind === 'missing') {
      return formatSpecLine(pair.sourceSpec);
    }
    return formatSpecLine(pair.draftSpec);
  }).join('; ');
}

function buildRowBenchmarkEvidence(
  row: GoodsRow,
  candidate: Pick<SpecsCandidate, 'source' | 'sourceSpecs' | 'sourceCompareLabel' | 'sourceContextText'>,
): RowBenchmarkEvidence | undefined {
  const normalizedSourceSpecs = normalizeSourceSpecCollection(candidate.sourceSpecs, row.type);
  if (!normalizedSourceSpecs.length) return undefined;
  return {
    source: candidate.source,
    sourceCompareLabel: String(candidate.sourceCompareLabel || (candidate.source === 'eis' ? 'ЕИС / КТРУ / площадки' : 'Интернет-источники')).trim(),
    sourceContextText: String(candidate.sourceContextText || '').trim(),
    sourceSpecs: normalizedSourceSpecs,
  };
}

function getBenchmarkRiskLevel(comparison: DraftSourceComparison): BenchmarkRiskLevel {
  const missing = comparison.onlySource.length;
  const changed = comparison.changed.length;
  if (missing === 0 && changed <= 1) return 'ok';
  if (missing >= 3 || missing + changed >= 6) return 'block';
  return 'warn';
}

function getBenchmarkRiskSummary(comparison: DraftSourceComparison): string {
  const level = getBenchmarkRiskLevel(comparison);
  if (level === 'ok') {
    return 'Эталон покрыт достаточно полно; можно переходить к финальной проверке перед публикацией.';
  }
  if (level === 'block') {
    return 'Есть существенное расхождение с эталоном; позицию нужно довести до уровня источника перед публикацией.';
  }
  return 'Есть заметные отличия от эталона; рекомендуется добрать характеристики и перепроверить формулировки.';
}

function applyBenchmarkPatchToRow(row: GoodsRow, mode: 'missing' | 'changed' | 'all'): GoodsRow {
  if (!row.benchmark || !row.specs) return row;
  const comparison = buildDraftSourceComparison(row.benchmark.sourceSpecs, row.specs, row.type);
  let nextSpecs = [...row.specs];

  if (mode === 'missing' || mode === 'all') {
    for (const item of comparison.onlySource) {
      if (!item.sourceSpec) continue;
      nextSpecs = upsertSpec(nextSpecs, item.sourceSpec as SpecItem, [String(item.sourceSpec.name || '')]);
    }
  }

  if (mode === 'changed' || mode === 'all') {
    for (const item of comparison.changed) {
      if (!item.sourceSpec) continue;
      const aliases = [String(item.sourceSpec.name || '')];
      if (item.draftSpec?.name) aliases.push(String(item.draftSpec.name));
      nextSpecs = upsertSpec(nextSpecs, item.sourceSpec as SpecItem, aliases);
    }
  }

  const commercial = getResolvedCommercialContext(row);
  const adjustedSpecs = adjustSpecsForCommercialContext(row, nextSpecs);
  const sanitizedSpecs = sanitizeProcurementSpecs({
    type: row.type,
    model: row.model,
    licenseType: commercial.suggestedLicenseType,
    term: commercial.suggestedTerm,
  }, adjustedSpecs);

  return {
    ...row,
    status: 'done',
    specs: sanitizedSpecs,
  };
}

function getRowDisplayLabel(row: GoodsRow): string {
  const goods = lookupCatalog(row.type);
  // Если тип «клавиатура», но спецификации описывают также мышь → переименовать в комплект
  if (row.type === 'keyboard' && Array.isArray(row.specs) && row.specs.length > 0) {
    const specsText = row.specs.map((s) => `${s.name || ''} ${s.value || ''}`).join(' ').toLowerCase();
    if (/мышь|манипулятор|dpi|оптическ.*датчик|кнопок мыши|клик.*мышь|сенсор.*отслежив/.test(specsText)) {
      return 'Комплект (клавиатура и манипулятор типа мышь)';
    }
  }
  // Унифицированное наименование для keyboardMouseSet согласно 44-ФЗ терминологии
  if (row.type === 'keyboardMouseSet') {
    return 'Комплект (клавиатура и манипулятор типа мышь)';
  }
  return cleanCatalogName(goods.name);
}

function buildSpecSnapshotContext(
  specs: Array<Partial<SpecItem>> | undefined,
  title: string,
  limit = 18,
): string {
  if (!Array.isArray(specs) || specs.length === 0) return '';
  const lines = normalizeSourceSpecCollection(specs)
    .slice(0, limit)
    .map((spec, idx) => `${idx + 1}. ${formatSpecLine(spec)}`);
  if (!lines.length) return '';
  return `${title}:\n${lines.join('\n')}`;
}

function normalizeResolvedOkpd2Code(value: string): string {
  const normalized = String(value || '').trim();
  return normalized === '00.00.00.000' ? '' : normalized;
}

function normalizeResolvedOkpd2Name(value: string): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return /окпд2.*определяется автоматически/i.test(normalized) ? '' : normalized;
}

function normalizeResolvedKtruCode(value: string): string {
  const normalized = String(value || '').trim();
  return normalized === '00.00.00.000' ? '' : normalized;
}

function getResolvedOkpd2Code(row: GoodsRow): string {
  return normalizeResolvedOkpd2Code(String(row.meta?.okpd2_code || lookupCatalog(row.type)?.okpd2 || ''));
}

function getResolvedOkpd2Name(row: GoodsRow): string {
  return normalizeResolvedOkpd2Name(String(row.meta?.okpd2_name || lookupCatalog(row.type)?.okpd2name || ''));
}

function getResolvedKtruCode(row: GoodsRow): string {
  return normalizeResolvedKtruCode(String(row.meta?.ktru_code || lookupCatalog(row.type)?.ktruFixed || ''));
}

const NON_BRAND_LABEL = 'без указания товарного знака (эквивалент)';

const PROCUREMENT_METHOD_LABELS: Record<string, string> = {
  auction: 'Аукцион',
  tender: 'Конкурс',
  quotation: 'Запрос котировок',
  proposal_request: 'Запрос предложений',
  single_supplier: 'Единственный поставщик',
};

const ASTRA_BUNDLE_TYPES = new Set(['os', 'ldap', 'virt', 'vdi', 'email', 'backup_sw', 'osSupport', 'supportCert']);
const ASTRA_CORE_TYPES = new Set(['os', 'ldap', 'virt', 'vdi', 'email', 'backup_sw']);
const ASTRA_KEYWORDS_RE = /(astra|астра|ald|алд|termidesk|термидеск|rupost|рупост|rubackup|бэкап|брест|brest)/i;

function normalizeBundleText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAstraBundleRow(row: GoodsRow): boolean {
  if (!ASTRA_BUNDLE_TYPES.has(row.type)) return false;
  if (row.type === 'osSupport' || row.type === 'supportCert') {
    return row.model.trim().length === 0 || ASTRA_KEYWORDS_RE.test(normalizeBundleText(row.model));
  }
  return ASTRA_KEYWORDS_RE.test(normalizeBundleText(row.model));
}

function isAstraBundleProcurement(rows: GoodsRow[]): boolean {
  const doneRows = rows.filter((row) => row.status === 'done' && row.specs);
  if (doneRows.length < 2) return false;
  if (doneRows.some((row) => !lookupCatalog(row.type)?.isSoftware)) return false;
  if (!doneRows.some((row) => ASTRA_CORE_TYPES.has(row.type))) return false;
  return doneRows.every((row) => isAstraBundleRow(row));
}

function isServiceOnlyProcurement(rows: GoodsRow[]): boolean {
  const doneRows = rows.filter((row) => row.status === 'done' && row.specs);
  return doneRows.length > 0 && doneRows.every((row) => isServiceCatalogType(row.type));
}

function getRowQtyUnitShort(row: GoodsRow): string {
  const goods = lookupCatalog(row.type);
  if (goods.isSoftware) return 'лиц.';
  if (goods.isService) return 'усл.';
  return 'шт.';
}

function getProcurementObjectName(rows: GoodsRow[]): string {
  if (isAstraBundleProcurement(rows)) {
    return 'программного обеспечения и сертификатов технической поддержки экосистемы Astra';
  }
  if (isServiceOnlyProcurement(rows)) {
    return rows.length > 1 ? `услуг (${rows.length} позиций)` : toGenitive(cleanCatalogName(lookupCatalog(rows[0]?.type ?? 'otherService').name).toLowerCase());
  }
  if (rows.length > 1) {
    return `комплекта товаров (${rows.length} позиций)`;
  }
  return toGenitive(cleanCatalogName(lookupCatalog(rows[0]?.type ?? 'otherGoods').name).toLowerCase());
}

function getProcurementIntro(rows: GoodsRow[]): string {
  if (isAstraBundleProcurement(rows)) {
    return 'Поставка лицензий на программное обеспечение и сертификатов на техническую поддержку для формирования импортонезависимой ИТ-инфраструктуры на базе решений ГК «Астра».';
  }
  if (isServiceOnlyProcurement(rows)) {
    if (rows.length > 1) {
      return `Наименование объекта закупки: оказание комплекса услуг (${rows.length} позиций) (далее — Услуги).`;
    }
    return `Наименование объекта закупки: оказание услуги «${cleanCatalogName(lookupCatalog(rows[0]?.type ?? 'otherService').name)}» (далее — Услуги).`;
  }
  if (rows.length > 1) {
    return `Наименование объекта поставки: комплект товаров (${rows.length} позиций) (далее — Товар).`;
  }
  return `Наименование объекта поставки: ${cleanCatalogName(lookupCatalog(rows[0]?.type ?? 'otherGoods').name)} (далее — Товар).`;
}

function getAstraBundleRequirementTexts(): string[] {
  return [
    'Все поставляемое программное обеспечение должно быть включено в Единый реестр российских программ для ЭВМ и баз данных (реестр Минцифры России).',
    'Программные компоненты, для которых применима сертификация по требованиям безопасности информации, должны иметь действующие сертификаты ФСТЭК России в актуальной редакции на дату поставки.',
    'Все поставляемые компоненты должны быть совместимы между собой на уровне нативной интеграции внутри экосистемы Astra.',
    'Поставщик обязан обеспечить передачу лицензий и сертификатов технической поддержки в составе, достаточном для развёртывания единой импортонезависимой инфраструктуры Заказчика.',
  ];
}

type SpecRowDef = {
  name: string;
  value: string;
  unit?: string;
};

type SpecSectionDef = {
  title: string;
  rows: SpecRowDef[];
};

function buildGroupedSpecs(sections: SpecSectionDef[]): SpecItem[] {
  const specs: SpecItem[] = [];
  for (const section of sections) {
    for (const row of section.rows) {
      specs.push({
        group: section.title,
        name: row.name,
        value: row.value,
        unit: row.unit ?? '',
      });
    }
  }
  return specs;
}

function getSupportSectionRows(term: string, extras: SpecRowDef[] = []): SpecRowDef[] {
  return [
    { name: 'Срок действия обновлений / технической поддержки', value: term },
    { name: 'Доступ к обновлениям безопасности Продукта', value: 'Наличие' },
    { name: 'Право на получение новых мажорных релизов', value: 'Наличие в период действия поддержки' },
    { name: 'Информационно-справочная поддержка по установке и обновлению', value: 'Наличие' },
    { name: 'Информационно-справочная поддержка по настройке Продукта после обновления', value: 'Наличие' },
    { name: 'Исправление ошибок, несоответствий, инцидентов и дефектов', value: 'Наличие' },
    { name: 'Моделирование сценариев на тестовом стенде Вендора', value: 'Наличие по регламенту вендора' },
    { name: 'Удаленный сбор информации о сбоях', value: 'Наличие по регламенту вендора' },
    { name: 'Информационно-справочная поддержка в гетерогенных средах', value: 'Наличие' },
    { name: 'Выделенный консультант / координатор работ', value: 'Наличие по регламенту поставки и поддержки' },
    ...extras,
  ];
}

function getFilledCommercialValue(value: string, fallback: string): string {
  return String(value || '').trim() || fallback;
}

function getAstraDeterministicSpecs(row: GoodsRow): SpecItem[] | null {
  const commercial = getResolvedCommercialContext(row);
  const haystack = normalizeBundleText(`${row.model} ${row.licenseType}`);
  const licenseType = getFilledCommercialValue(commercial.suggestedLicenseType, 'Бессрочная');
  const term = getFilledCommercialValue(commercial.suggestedTerm, '12 / 24 / 36 мес.');
  const serverOs = /(сервер|server|серверн|2 сокет|socket|sockets?|контроллер)/i.test(haystack);

  if (row.type === 'toiletPaper') {
    return buildGroupedSpecs([
      {
        title: '1. Общие характеристики',
        rows: [
          { name: 'Назначение', value: 'Бумага туалетная бытового назначения' },
          { name: 'Количество слоёв', value: 'не менее 2' },
          { name: 'Количество рулонов в упаковке', value: 'не менее 4' },
          { name: 'Длина намотки рулона', value: 'не менее 15 м' },
          { name: 'Количество листов в рулоне', value: 'не менее 120' },
          { name: 'Ширина рулона', value: 'не менее 9 см' },
          { name: 'Перфорация', value: 'Наличие' },
          { name: 'Тиснение', value: 'Наличие' },
        ],
      },
      {
        title: '2. Материал и качество',
        rows: [
          { name: 'Состав', value: 'Целлюлоза и/или вторичное волокно по типу товара' },
          { name: 'Цвет', value: 'Белый или натуральный, без посторонних включений' },
          { name: 'Растворимость в воде', value: 'Наличие' },
          { name: 'Запах', value: 'Без резкого постороннего запаха' },
          { name: 'Поверхность', value: 'Равномерная, без разрывов и грубых дефектов' },
          { name: 'Упаковка', value: 'Заводская, обеспечивающая защиту при транспортировке и хранении' },
          { name: 'Маркировка', value: 'Наличие наименования, производителя и основных характеристик на упаковке' },
        ],
      },
    ]);
  }

  if (row.type === 'shredderOil') {
    return buildGroupedSpecs([
      {
        title: '1. Общие характеристики',
        rows: [
          { name: 'Назначение', value: 'Смазка режущего блока уничтожителей документов / шредеров' },
          { name: 'Тип средства', value: 'Масло / смазка для шредеров' },
          { name: 'Форма выпуска', value: 'Жидкость во флаконе или иной дозируемой упаковке' },
          { name: 'Способ нанесения', value: 'Ручное дозированное нанесение на ножевой блок и/или бумагу по инструкции производителя' },
          { name: 'Совместимость', value: 'Совместимость с уничтожителями документов продольной и/или перекрестной резки по назначению средства' },
        ],
      },
      {
        title: '2. Состав и эксплуатационные свойства',
        rows: [
          { name: 'Состав', value: 'Смазочное средство, безопасное для ножевого блока и штатной эксплуатации шредеров' },
          { name: 'Содержание агрессивных растворителей', value: 'Не допускается наличие компонентов, способных повредить режущий механизм, пластик или резиновые элементы' },
          { name: 'Противоизносные свойства', value: 'Наличие' },
          { name: 'Антикоррозионные свойства', value: 'Наличие' },
          { name: 'Уменьшение шума и трения', value: 'Наличие эффекта снижения шума и трения при штатном применении' },
        ],
      },
      {
        title: '3. Поставка и маркировка',
        rows: [
          { name: 'Герметичность упаковки', value: 'Наличие, без подтеканий и повреждений' },
          { name: 'Маркировка', value: 'Наличие наименования средства, назначения, способа применения и мер предосторожности' },
          { name: 'Инструкция на русском языке', value: 'Наличие на упаковке и/или во вложении' },
          { name: 'Срок годности на момент поставки', value: 'Не менее 12 месяцев остаточного срока' },
        ],
      },
    ]);
  }

  if (row.type === 'ldap' && /(ald pro|алд про|служба каталогов|ldap|контроллер домена)/i.test(haystack)) {
    if (commercial.ldapProfile === 'client_device' || commercial.ldapProfile === 'client_user' || commercial.ldapProfile === 'client') {
      const metric = commercial.ldapProfile === 'client_user'
        ? 'CAL на пользователя'
        : commercial.ldapProfile === 'client_device'
          ? 'CAL на устройство'
          : 'CAL на каждое устройство или пользователя';
      const object = commercial.ldapProfile === 'client_user'
        ? '1 пользователь'
        : commercial.ldapProfile === 'client_device'
          ? '1 устройство'
          : '1 устройство или 1 пользователь';
      return buildGroupedSpecs([
        {
          title: '1. Общие требования к продукту',
          rows: [
            { name: 'Тип программного обеспечения', value: 'Клиентская лицензия службы каталогов / доменной инфраструктуры' },
            { name: 'Редакция / семейство продукта', value: 'ALD Pro Client / CAL или эквивалент' },
            { name: 'Тип лицензии', value: getFilledCommercialValue(commercial.suggestedLicenseType, 'Клиентская часть (CAL)') },
            { name: 'Срок действия лицензии', value: term },
            { name: 'Количество лицензий', value: `не менее ${row.qty}` },
            { name: 'Метрика лицензирования', value: metric },
            { name: 'Лицензируемый объект', value: object },
            { name: 'Способ поставки', value: 'Электронная' },
            { name: 'Наличие в Едином реестре российского ПО Минцифры России', value: 'Да' },
            { name: 'Сертификат ФСТЭК России', value: 'Наличие действующего сертификата ФСТЭК России не ниже 4 уровня доверия' },
            { name: 'Документация на русском языке', value: 'Да' },
          ],
        },
        {
          title: '2. Требования к клиентской части',
          rows: [
            { name: 'Работа в среде ОС с архитектурой x86_64', value: 'Наличие' },
            { name: 'Аутентификация и авторизация пользователей в доменах под управлением Продукта по LDAP и Kerberos', value: 'Наличие' },
            { name: 'Аутентификация и авторизация под учетными записями Microsoft Active Directory', value: 'Наличие' },
            { name: 'Регистрация узла в службе разрешения имен при вводе клиента в домен', value: 'Наличие' },
            { name: 'Настройка динамического обновления DNS клиента', value: 'Наличие' },
            { name: 'Удаленное подключение к рабочему столу пользователя', value: 'Наличие' },
            { name: 'Выполнение заданий автоматизации', value: 'Наличие' },
            { name: 'Политики на установку программного обеспечения', value: 'Наличие' },
            { name: 'Групповые политики', value: 'Наличие централизованного применения доменных политик и конфигураций SaltStack или эквивалентного механизма' },
            { name: 'Поддержка конфигураций SaltStack', value: 'Наличие' },
            { name: 'Поддержка централизованного применения настроек и конфигураций к рабочим станциям и серверам в домене', value: 'Наличие' },
            { name: 'Управление конфигурацией хоста', value: 'Наличие' },
            { name: 'Журналирование событий', value: 'Наличие' },
            { name: 'Просмотр личных данных пользователем', value: 'Наличие' },
            { name: 'Изменение собственного пароля', value: 'Наличие' },
            { name: 'Kerberos-аутентификация при недоступности контроллеров домена', value: 'Наличие' },
            { name: 'Ввод в домен с помощью графического интерфейса', value: 'Наличие' },
            { name: 'Подключение сетевых ресурсов общего доступа', value: 'Наличие' },
            { name: 'Назначение лицензии', value: 'Право управления рабочей станцией или сервером через доменные политики и конфигурации хоста' },
            { name: 'Поддерживаемые объекты', value: 'Рабочие станции и серверы, включенные в домен' },
          ],
        },
        {
          title: '3. Совместимость, безопасность и эксплуатация',
          rows: [
            { name: 'Совместимость с серверной частью', value: 'ALD Pro Server / контроллер домена или эквивалентная серверная часть службы каталогов' },
            { name: 'Совместимость с доменной иерархией OU', value: 'Наличие' },
            { name: 'Совместимость с LDAP / Kerberos', value: 'Наличие' },
            { name: 'Поддерживаемые клиентские ОС', value: 'Astra Linux, ALT Linux, РЕД ОС или эквивалентные ОС' },
            { name: 'Интеграция с доменной политикой', value: 'Совместимость с групповыми политиками, OU-иерархией и механизмами централизованного управления домена' },
            { name: 'Ролевая модель доступа (RBAC)', value: 'Наличие' },
            { name: 'Разграничение прав доступа', value: 'Наличие' },
            { name: 'Журналирование событий безопасности', value: 'Наличие' },
            { name: 'Аудит действий администраторов', value: 'Наличие' },
            { name: 'Шифрование трафика управления', value: 'TLS 1.2 и выше' },
            { name: 'Веб-интерфейс администрирования', value: 'Наличие административной консоли или иного штатного интерфейса управления' },
            { name: 'API / средства автоматизации', value: 'REST API, CLI, webhooks или эквивалентные средства интеграции и автоматизации' },
            { name: 'Резервное копирование конфигурации', value: 'Наличие' },
            { name: 'Масштабирование и отказоустойчивость', value: 'Поддержка масштабирования и отказоустойчивой схемы развёртывания в рамках редакции поставки' },
          ],
        },
        {
          title: '4. Требования к включенным обновлениям Тип 2 или технической поддержке',
          rows: getSupportSectionRows(term, [
            { name: 'Доступ к минорным обновлениям Продукта', value: 'Наличие' },
          ]),
        },
      ]);
    }

    return buildGroupedSpecs([
      {
        title: '1. Общие требования к продукту',
        rows: [
          { name: 'Тип программного обеспечения', value: 'Серверная часть службы каталогов / контроллер домена' },
          { name: 'Редакция / семейство продукта', value: 'ALD Pro Server или эквивалент' },
          { name: 'Тип лицензии', value: getFilledCommercialValue(commercial.suggestedLicenseType, 'Серверная часть') },
          { name: 'Срок действия лицензии', value: term },
          { name: 'Количество лицензий', value: `не менее ${row.qty}` },
          { name: 'Метрика лицензирования', value: 'На экземпляр контроллера домена' },
          { name: 'Лицензионный состав', value: 'Серверная лицензия на контроллер домена и клиентские лицензии CAL на управляемые объекты' },
          { name: 'Лицензируемый объект', value: '1 контроллер домена' },
          { name: 'Наличие в Едином реестре российского ПО Минцифры России', value: 'Да' },
          { name: 'Сертификат ФСТЭК России', value: 'Наличие действующего сертификата ФСТЭК России не ниже 4 уровня доверия' },
          { name: 'Способ поставки', value: 'Электронная' },
          { name: 'Документация на русском языке', value: 'Да' },
        ],
      },
      {
        title: '2. Требования к серверной части',
        rows: [
          { name: 'Функционирование без ограничений в контуре периметра без необходимости использования внешних сервисов', value: 'Наличие' },
          { name: 'Взаимодействие пользователей с Продуктом посредством графического интерфейса (WebUI и/или GUI)', value: 'Наличие' },
          { name: 'Поддержка светлой и темной темы интерфейса', value: 'Наличие' },
          { name: 'Работа на архитектуре x86', value: 'Наличие' },
          { name: 'Централизованное управление всеми компонентами', value: 'Наличие' },
          { name: 'Развертывание под управлением ОС Astra Linux', value: 'Наличие' },
          { name: 'Поддержка работы в сетях IPv4', value: 'Наличие' },
          { name: 'Механизмы отказоустойчивости на уровне приложения', value: 'Наличие' },
          { name: 'Горизонтальная масштабируемость', value: 'Наличие' },
          { name: 'Георезервирование с установкой независимых компонентов в различные ЦОД', value: 'Наличие' },
          { name: 'Восстановление функций после сбоев', value: 'Наличие' },
          { name: 'Аутентификация пользователей по LDAP(S) и Kerberos', value: 'Наличие' },
          { name: 'Использование единого идентификатора для доступа ко всем разрешенным ресурсам', value: 'Наличие' },
          { name: 'Авторизация пользователей домена в Продукте с использованием браузера', value: 'Наличие' },
          { name: 'Управление организационными единицами (OU)', value: 'Поддержка иерархии подразделений и делегирования административных полномочий' },
          { name: 'Создание, редактирование и удаление сайтов', value: 'Наличие' },
          { name: 'Ведение реестра серверов и ролей', value: 'Наличие' },
          { name: 'Отображение связанного графа топологии домена', value: 'Наличие' },
          { name: 'Управление сайтами и топологией репликации', value: 'Поддержка сайтов, межсайтовых связей и настройки топологии репликации каталога' },
          { name: 'Управление репликацией между контроллерами домена', value: 'Наличие' },
          { name: 'Управление параметрами групповых политик', value: 'Наличие' },
          { name: 'Управление Kerberos', value: 'Наличие' },
          { name: 'Управление параметрами пользователей и групп', value: 'Наличие' },
          { name: 'Управление глобальным каталогом и модулем синхронизации', value: 'Наличие' },
          { name: 'Управление организационной структурой, пользователями и компьютерами', value: 'Наличие' },
          { name: 'Групповые политики', value: 'Централизованное применение групповых политик и конфигураций на базе SaltStack или эквивалентного механизма' },
          { name: 'Автоматизированная установка ОС по сети', value: 'Поддержка PXE / netboot для сетевого развёртывания рабочих станций и серверов' },
          { name: 'Миграция из Microsoft Active Directory', value: 'Поддержка переноса домена, организационной структуры, пользователей и групп с сохранением структуры объектов' },
          { name: 'Удаленный доступ', value: 'Наличие' },
          { name: 'Установка и обновление программного обеспечения', value: 'Наличие' },
          { name: 'Служба разрешения имен', value: 'Наличие' },
          { name: 'Служба синхронизации времени', value: 'Наличие' },
          { name: 'Служба печати', value: 'Наличие' },
          { name: 'Общий доступ к файлам', value: 'Наличие' },
          { name: 'Управление доступом', value: 'Наличие' },
          { name: 'Управление заданиями автоматизации', value: 'Наличие' },
          { name: 'Мониторинг', value: 'Наличие' },
          { name: 'Журналирование событий', value: 'Наличие' },
          { name: 'Навигация и поиск объектов', value: 'Наличие' },
          { name: 'Справочный центр', value: 'Наличие' },
          { name: 'Личный кабинет пользователя', value: 'Наличие' },
          { name: 'Парольные политики', value: 'Наличие' },
          { name: 'Интеграция с DHCP / DNS', value: 'Интеграция со службами DHCP и DNS, включая обслуживание записей и доменной инфраструктуры' },
          { name: 'Поддержка DNS-зон', value: 'Поддержка прямых и обратных зон DNS, необходимых для доменной инфраструктуры' },
          { name: 'Поддержка LDAP / Kerberos', value: 'Наличие' },
          { name: 'Управление доверительными отношениями с доменами Продукта и Microsoft Active Directory', value: 'Наличие' },
        ],
      },
      {
        title: '3. Совместимость, безопасность и эксплуатация',
        rows: [
          { name: 'Поддерживаемые серверные ОС', value: 'Astra Linux Special Edition, ALT Linux, РЕД ОС или эквивалентные серверные ОС' },
          { name: 'Совместимость с клиентской частью', value: 'Клиентские лицензии CAL на устройства или пользователей' },
          { name: 'Репликация каталога', value: 'multi-master репликация каталога с поддержкой межсайтовой синхронизации' },
          { name: 'Поддержка межсайтовой синхронизации', value: 'Наличие' },
          { name: 'Ролевая модель доступа (RBAC)', value: 'Наличие' },
          { name: 'Разграничение прав доступа', value: 'Наличие' },
          { name: 'Журналирование системных и административных событий', value: 'Наличие' },
          { name: 'Журналирование событий безопасности', value: 'Наличие' },
          { name: 'Аудит действий администраторов', value: 'Наличие' },
          { name: 'Шифрование трафика управления', value: 'TLS 1.2 и выше' },
          { name: 'API / средства автоматизации', value: 'REST API, CLI, webhooks или эквивалентные средства интеграции и автоматизации' },
          { name: 'Резервное копирование и восстановление конфигурации', value: 'Наличие' },
          { name: 'Масштабирование и отказоустойчивость', value: 'Поддержка масштабирования и отказоустойчивой схемы развёртывания в рамках редакции поставки' },
        ],
      },
      {
        title: '4. Требования к включенным обновлениям Тип 2 или технической поддержке',
        rows: getSupportSectionRows(term, [
          { name: 'Доступ к минорным обновлениям Продукта', value: 'Наличие' },
        ]),
      },
    ]);
  }

  if (row.type === 'os' && /(astra linux|астра линукс|special edition|smolensk|voronezh|смоленск|воронеж)/i.test(haystack)) {
    return buildGroupedSpecs([
      {
        title: '1. Требования соответствия законодательным и нормативным документам',
        rows: [
          { name: 'Тип операционной системы', value: 'Защищённая многопользовательская операционная система общего назначения' },
          { name: 'Редакция / вариант поставки', value: serverOs ? 'Astra Linux Special Edition для серверов' : 'Astra Linux Special Edition для рабочих станций' },
          { name: 'Версия / номер релиза', value: 'не ниже 1.8' },
          { name: 'Исполнение / уровень защищённости', value: serverOs ? 'серверная редакция с усиленными встроенными средствами защиты информации' : 'редакция с усиленными встроенными средствами защиты информации' },
          { name: 'Тип лицензии', value: licenseType },
          { name: 'Срок действия лицензии', value: term },
          { name: 'Количество лицензий', value: `не менее ${row.qty}` },
          { name: 'Соответствие требованиям Постановления Правительства РФ от 23.12.2024 № 1875', value: 'Да' },
          { name: 'Раскрытие сведений о средствах и способах реализации функций безопасности в эксплуатационной документации', value: 'Да' },
          { name: 'Сертификат ФСТЭК России по требованиям безопасности информации к операционным системам (ФСТЭК, 2016)', value: 'Наличие' },
          { name: 'Профиль защиты операционных систем типа «А» не ниже 4 класса ИТ.ОС.А4.ПЗ', value: 'Наличие' },
          { name: 'Уровень доверия по требованиям ФСТЭК России (2020)', value: 'не ниже 4 уровня' },
          { name: 'Соответствие требованиям по безопасности информации к средствам контейнеризации (ФСТЭК, 2022)', value: 'не ниже 4 класса защиты' },
          { name: 'Соответствие требованиям по безопасности информации к средствам виртуализации (ФСТЭК, 2022)', value: 'не ниже 4 класса защиты' },
          { name: 'Соответствие требованиям по безопасности информации к системам управления базами данных (ФСТЭК, 2023)', value: 'не ниже 4 класса защиты' },
          { name: 'Соответствие ГОСТ Р 56939 (безопасная разработка)', value: 'Наличие подтверждения безопасной разработки' },
          { name: 'Наличие в Едином реестре российского ПО Минцифры России', value: 'Да' },
        ],
      },
      {
        title: '2. Требования к встроенному комплексу средств защиты информации',
        rows: [
          { name: 'Идентификация и аутентификация пользователей', value: 'Наличие встроенных сертифицированных средств' },
          { name: 'Управление средствами аутентификации', value: 'Наличие' },
          { name: 'Управление учетными записями пользователей, разграничение полномочий и назначение прав', value: 'Наличие' },
          { name: 'Реализация дискреционного разграничения доступа', value: 'Наличие' },
          { name: 'Мандатное управление доступом (MAC)', value: 'Наличие' },
          { name: 'Дискреционный контроль доступа (DAC)', value: 'Наличие' },
          { name: 'Замкнутая программная среда', value: 'Наличие' },
          { name: 'Возможность указания параметров настройки комплекса средств защиты во время создания пользователя', value: 'Наличие' },
          { name: 'Контейнеризация и изоляция процессов, выполняемых в контейнерах', value: 'Наличие' },
          { name: 'Защита аутентификационной информации с использованием функции хэширования', value: 'Наличие' },
          { name: 'Ядро, поддерживаемое Центром исследования безопасности системного программного обеспечения ИСП РАН', value: 'Наличие' },
          { name: 'Графическое средство настройки ограничений пользователя по запуску программ в изолированном окружении', value: 'Наличие' },
          { name: 'Ограничение прав пользователя на запуск приложений ядром системы', value: 'Наличие' },
          { name: 'Ограничение прав пользователя средствами графического интерфейса', value: 'Наличие' },
          { name: 'Разрешение запуска только тех программных компонентов, которые явно разрешены администратором безопасности', value: 'Наличие' },
          { name: 'Запрет запуска пользователем самостоятельно созданных программ с использованием интерпретируемых языков программирования', value: 'Наличие' },
          { name: 'Графические средства настройки защиты машинных носителей', value: 'Наличие' },
          { name: 'Идентификация устройств и сопоставление пользователя с устройством', value: 'Наличие' },
          { name: 'Управление доступом субъектов доступа к устройствам методами дискреционного управления доступом', value: 'Наличие' },
          { name: 'Аудит и журналирование событий безопасности', value: 'Наличие с учетом требований ГОСТ Р 59548-2022' },
          { name: 'Графические средства настройки контроля целостности дистрибутива и файловой системы', value: 'Наличие' },
          { name: 'Блокировка запуска исполняемых файлов и загрузки библиотек при нарушении целостности', value: 'Наличие' },
          { name: 'Ограничение полномочий пользователей по использованию консолей', value: 'Наличие' },
          { name: 'Очистка оперативной памяти и временных данных', value: 'Наличие' },
          { name: 'Включение сведений об уязвимостях в банк данных угроз безопасности информации ФСТЭК России', value: 'Наличие работ по устранению уязвимостей и публикации сведений' },
          { name: 'Защита системных и привилегированных процессов от несанкционированного доступа и управления', value: 'Наличие' },
          { name: 'Запрет операций записи в системные каталоги и файлы вне зависимости от изменения пользователем своих привилегий', value: 'Наличие' },
          { name: 'Средство настройки профиля системы с импортом и экспортом настроек комплекса средств защиты', value: 'Наличие' },
          { name: 'Работа со сторонними устройствами аутентификации - токенами', value: 'Двухфакторная авторизация, вход и разблокировка по токену, блокировка сессии при извлечении токена' },
        ],
      },
      {
        title: '3. Требования к функциональным возможностям операционной системы',
        rows: [
          { name: 'Поддерживаемые аппаратные платформы', value: 'x86_64' },
          { name: 'Разрядность', value: '64-бит' },
          { name: 'Версия ядра Linux', value: 'не ниже 6.1' },
          { name: 'Поддерживаемые локальные файловые системы', value: 'ext2/3/4, FAT, NTFS, XFS, ZFS, Btrfs или эквивалентные' },
          { name: 'Поддержка сетевых файловых систем', value: 'NFS, SMB/CIFS, WebDAV или эквивалентные' },
          { name: 'Поддержка сетевых протоколов', value: 'TCP/IP, DHCP, DNS, FTP, TFTP, SMTP, IMAP, HTTP(S), NTP, SSH, NFS, SMB' },
          { name: 'Поддержка LVM', value: 'Наличие' },
          { name: 'Поддержка шифрования разделов', value: 'Наличие' },
          { name: 'Поддержка точек восстановления (снапшотов)', value: 'Наличие' },
          { name: 'Среда функционирования для сертифицированных средств криптографической защиты информации', value: 'Наличие' },
          { name: 'Установщик с поддержкой VNC-сервера для удаленного подключения', value: 'Наличие' },
          { name: 'Автоматическая установка при помощи файла конфигурации формата .yaml', value: 'Наличие' },
          { name: 'Установка пакетов из репозитория во время установки', value: 'Наличие' },
          { name: 'Инструмент для обновления между мажорными версиями с сохранением настроек', value: 'Наличие' },
          { name: 'Поддержка виртуализации', value: 'KVM, QEMU или эквивалентные средства' },
          { name: 'Поддержка контейнеризации', value: 'LXC, Docker или эквивалентные средства' },
          { name: 'Средства локальной виртуализации с графическим интерфейсом управления', value: 'Наличие' },
          { name: serverOs ? 'Графические инструменты управления репозиториями, аудитом и компонентами подсистемы безопасности' : 'Графическая оболочка и файловый менеджер', value: 'Наличие' },
          { name: serverOs ? 'Средства мониторинга, удаленного доступа, резервного копирования и серверных служб в составе дистрибутива' : 'Поддержка нескольких мониторов и HiDPI-дисплеев', value: 'Наличие' },
          { name: serverOs ? 'Средства виртуализации должны использовать qemu версии не ниже 8.2.4 и libvirt версии не ниже 10.3' : 'Поддержка подключения к сети Wi-Fi до входа в систему и аутентификации по смарт-карте', value: 'Наличие' },
          ...(serverOs
            ? [
                { name: 'Дополнительные серверные компоненты', value: 'web-сервер Apache, почтовые сервисы, средства мониторинга, средства удаленного доступа, сервер печати, аудит и журналирование' },
                { name: 'Совместимость с отечественными СКЗИ', value: 'Поддержка средств электронной подписи и криптографической защиты' },
              ]
            : [
                { name: 'Наличие в репозитории браузера из единого реестра российских программ', value: 'Да' },
                { name: 'Ввод аутентификационных данных при входе и разблокировке экрана с использованием виртуальной клавиатуры', value: 'Наличие' },
              ]),
          { name: 'Совместимость с офисными пакетами из реестра Минцифры', value: 'Наличие' },
          { name: 'Совместимость с отечественными инфраструктурными сервисами', value: 'Совместимость со службами каталогов, виртуализации, VDI, корпоративной почтой и резервным копированием по стандартным интерфейсам и API' },
          { name: 'Поддержка печати', value: 'CUPS или эквивалентная подсистема печати' },
          { name: serverOs ? 'Совместимость с серверными службами каталогов, почты, печати и удаленного доступа' : 'Поддержка сканирования', value: serverOs ? 'Наличие' : 'SANE или эквивалентная подсистема' },
          { name: serverOs ? 'Веб-браузеры и репозитории российского ПО' : 'Поддержка веб-браузеров', value: 'Совместимость с браузерами, поддерживающими современные веб-стандарты' },
          { name: 'Система управления пакетами', value: 'apt/dpkg или эквивалентная' },
          { name: 'Средства централизованного обновления и администрирования', value: 'Наличие' },
        ],
      },
      {
        title: '4. Правовая безопасность',
        rows: [
          { name: 'Подтверждение права на поставку лицензий', value: 'Наличие действующего сублицензионного договора с разработчиком ПО или его партнером' },
        ],
      },
      {
        title: '5. Требования к включенным обновлениям Тип 2 или технической поддержке',
        rows: getSupportSectionRows(term, [
          { name: 'Прогноз совместимости оборудования', value: 'Наличие по регламенту вендора' },
        ]),
      },
    ]);
  }

  if (row.type === 'email' && /(rupost|рупост|почтов)/i.test(haystack)) {
    return buildGroupedSpecs([
      {
        title: '1. Технические требования',
        rows: [
          { name: 'Тип программного обеспечения', value: 'Корпоративный почтовый сервер' },
          { name: 'Редакция / семейство продукта', value: 'RuPost или эквивалент' },
          { name: 'Тип лицензии', value: getFilledCommercialValue(commercial.suggestedLicenseType, 'На почтовый ящик / пользователя') },
          { name: 'Срок действия лицензии', value: term },
          { name: 'Количество лицензий', value: `не менее ${row.qty}` },
          { name: 'Метрика лицензирования', value: 'По количеству пользователей / почтовых ящиков' },
          { name: 'Лицензируемый объект', value: 'Почтовый ящик пользователя' },
          { name: 'Способ поставки', value: 'Электронная' },
          { name: 'Наличие в Едином реестре российского ПО Минцифры России', value: 'Да' },
          { name: 'Поддерживаемые операционные системы', value: 'Astra Linux Special Edition, РЕД ОС, Альт Рабочая станция, Ubuntu, Microsoft Windows' },
          { name: 'Работа с СУБД PostgreSQL', value: 'Наличие' },
          { name: 'Поддержка взаимодействия с кластером БД PostgreSQL на базе Patroni', value: 'Наличие' },
          { name: 'Бесшовная интеграция и синхронизация с адресными книгами LDAP-совместимых служб каталогов', value: 'Наличие' },
          { name: 'Поддержка протоколов SMTP, IMAP, POP3', value: 'Наличие' },
          { name: 'Поддержка шифрования TLS/SSL', value: 'Наличие' },
          { name: 'Отправка и получение электронной почты', value: 'Наличие' },
          { name: 'Работа с адресными книгами', value: 'Наличие' },
          { name: 'Поддержка календарей и контактов', value: 'Наличие' },
          { name: 'Поддержка правил обработки сообщений', value: 'Наличие' },
          { name: 'Поддержка вложений файлов', value: 'Наличие' },
          { name: 'Полнотекстовый поиск по почтовым сообщениям', value: 'Наличие' },
          { name: 'Поддержка цифровых подписей и шифрования сообщений', value: 'Наличие' },
          { name: 'Поддержка ActiveSync или эквивалентной мобильной синхронизации', value: 'Наличие' },
          { name: 'Поддержка встроенной защиты от спама', value: 'Наличие' },
          { name: 'Поддержка антивирусной проверки', value: 'Наличие' },
          { name: 'Интеграция со службой каталогов', value: 'ALD Pro, LDAP, Active Directory или эквивалент' },
          { name: 'Импорт / миграция из Microsoft Exchange', value: 'Наличие с сохранением почтовых сообщений, календарей и адресных книг' },
        ],
      },
      {
        title: '2. Безопасность, эксплуатация и интеграция',
        rows: [
          { name: 'Кластеризация и иные механизмы высокой доступности', value: 'Наличие' },
          { name: 'Отказоустойчивая схема развёртывания', value: 'Поддержка' },
          { name: 'Резервное копирование конфигурации и данных', value: 'Наличие' },
          { name: 'Веб-консоль администратора', value: 'Наличие' },
          { name: 'Средства мониторинга и оповещений', value: 'Наличие' },
          { name: 'API / средства интеграции', value: 'Наличие' },
          { name: 'Экспорт данных и журналов', value: 'Наличие механизмов экспорта данных, отчётов и журналов в открытых форматах' },
          { name: 'Ролевая модель доступа (RBAC)', value: 'Наличие' },
          { name: 'Аудит действий администраторов', value: 'Наличие' },
          { name: 'Журналирование системных событий', value: 'Наличие' },
          { name: 'Шифрование трафика управления', value: 'TLS 1.2 и выше' },
          { name: 'Квоты почтовых ящиков и лимиты хранения', value: 'Наличие' },
          { name: 'Транспортные правила и маршрутизация почты', value: 'Наличие' },
          { name: 'Поддержка многодоменной конфигурации', value: 'Наличие по редакции продукта' },
        ],
      },
      {
        title: '3. Требования к включенным обновлениям Тип 2 или технической поддержке',
        rows: getSupportSectionRows(term),
      },
    ]);
  }

  if (row.type === 'backup_sw' && /(rubackup|рубэк?ап|рубак|backup|бэкап)/i.test(haystack)) {
    return buildGroupedSpecs([
      {
        title: '1. Общие требования к продукту',
        rows: [
          { name: 'Тип программного обеспечения', value: 'Система резервного копирования' },
          { name: 'Редакция / семейство продукта', value: 'RuBackup или эквивалент' },
          { name: 'Тип лицензии', value: getFilledCommercialValue(commercial.suggestedLicenseType, 'Серверная часть + агенты') },
          { name: 'Срок действия лицензии', value: term },
          { name: 'Количество лицензий', value: `не менее ${row.qty}` },
          { name: 'Метрика лицензирования', value: 'По объему данных (ТБ), клиентам и/или экземплярам серверной части' },
          { name: 'Состав поставки', value: 'Серверная часть, консоль управления, агенты для ОС, БД и приложений' },
          { name: 'Наличие в Едином реестре российского ПО Минцифры России', value: 'Да' },
          { name: 'Сертификат ФСТЭК России', value: 'Наличие действующего сертификата ФСТЭК России не ниже 4 уровня доверия' },
          { name: 'Поддерживаемые операционные системы без эмуляции', value: 'Astra Linux Special Edition, РЕД ОС, Альт Сервер, Ubuntu, Debian, CentOS, Rocky Linux, ОСь, Microsoft Windows' },
          { name: 'Централизованное управление резервным копированием', value: 'Наличие' },
          { name: 'Поддержка инкрементального резервного копирования', value: 'Наличие' },
          { name: 'Поддержка дифференциального резервного копирования', value: 'Наличие' },
          { name: 'Шифрование резервных копий', value: 'Наличие' },
          { name: 'Поддержка различных типов хранилищ', value: 'Локальные диски, сетевые хранилища (NFS, SMB), облачные хранилища' },
          { name: 'Восстановление на уровне файлов и на уровне образов системы', value: 'Наличие' },
          { name: 'Планирование заданий резервного копирования', value: 'Наличие' },
          { name: 'Уведомления о выполнении заданий резервного копирования', value: 'Наличие' },
          { name: 'Способ поставки', value: 'Электронная' },
          { name: 'Документация на русском языке', value: 'Да' },
        ],
      },
      {
        title: '2. Функциональные возможности, интеграция и безопасность',
        rows: [
          { name: 'Поддержка полных резервных копий', value: 'Наличие' },
          { name: 'Безагентное резервное копирование виртуальных машин', value: 'Наличие' },
          { name: 'Поддержка ПК Брест без установки агентов', value: 'Наличие' },
          { name: 'Глобальная дедупликация на стороне клиента и сервера', value: 'Наличие' },
          { name: 'Сжатие резервных копий', value: 'Наличие' },
          { name: 'Шифрование резервных копий по ГОСТ', value: 'Наличие' },
          { name: 'Политики хранения и ротации', value: 'Наличие' },
          { name: 'Поддержка ленточных библиотек', value: 'Наличие' },
          { name: 'Поддержка дисковых хранилищ', value: 'Наличие' },
          { name: 'Поддержка сетевых хранилищ', value: 'Наличие' },
          { name: 'Поддержка облачных хранилищ', value: 'Наличие' },
          { name: 'Каталог резервных копий и поиск по ним', value: 'Наличие' },
          { name: 'Проверка целостности резервных копий', value: 'Наличие' },
          { name: 'Средства быстрого восстановления', value: 'Наличие' },
          { name: 'Восстановление файлов, ВМ, БД и приложений', value: 'Наличие' },
          { name: 'Тестовое восстановление и верификация резервных копий', value: 'Наличие' },
          { name: 'Отчетность по заданиям резервного копирования', value: 'Наличие' },
          { name: 'Интеграция с виртуализацией и инфраструктурой Astra', value: 'Наличие' },
          { name: 'API / средства автоматизации', value: 'Наличие' },
          { name: 'Экспорт данных и журналов', value: 'Наличие механизмов экспорта данных, отчётов и журналов в открытых форматах' },
          { name: 'Ролевая модель доступа (RBAC)', value: 'Наличие' },
          { name: 'Журналирование событий и аудит действий', value: 'Наличие' },
          { name: 'Шифрование трафика управления', value: 'TLS 1.2 и выше' },
          { name: 'Централизованная консоль администрирования', value: 'Наличие' },
          { name: 'Мониторинг и уведомления', value: 'Наличие' },
          { name: 'Отказоустойчивая схема развёртывания', value: 'Поддержка' },
        ],
      },
      {
        title: '3. Требования к включенным обновлениям Тип 2 или технической поддержке',
        rows: getSupportSectionRows(term),
      },
    ]);
  }

  if (row.type === 'virt' && /(брест|brest|виртуализ)/i.test(haystack)) {
    return buildGroupedSpecs([
      {
        title: '1. Требования соответствия законодательным и нормативным документам',
        rows: [
          { name: 'Тип программного обеспечения', value: 'Платформа виртуализации и управления виртуальной инфраструктурой' },
          { name: 'Редакция / семейство продукта', value: 'ПК Брест или эквивалент' },
          { name: 'Тип лицензии', value: getFilledCommercialValue(commercial.suggestedLicenseType, 'На физический процессор (socket)') },
          { name: 'Срок действия лицензии', value: term },
          { name: 'Количество лицензий', value: `не менее ${row.qty}` },
          { name: 'Метрика лицензирования', value: 'По количеству физических процессоров (socket)' },
          { name: 'Лицензируемый объект', value: 'Физический процессор сервера виртуализации' },
          { name: 'Соответствие требованиям Постановления Правительства РФ от 23.12.2024 № 1875', value: 'Да' },
          { name: 'Уровень доверия по требованиям ФСТЭК России (2020)', value: 'не ниже 4 уровня' },
          { name: 'Соответствие требованиям по безопасности информации к средствам виртуализации (ФСТЭК, 2022)', value: 'не ниже 4 класса защиты' },
          { name: 'Применимость в информационных системах первого класса защищенности без наложенных средств защиты', value: 'Да' },
          { name: 'Наличие в Едином реестре российского ПО Минцифры России', value: 'Да' },
          { name: 'Способ поставки', value: 'Электронная' },
          { name: 'Документация на русском языке', value: 'Да' },
        ],
      },
      {
        title: '2. Требования к функциональным возможностям',
        rows: [
          { name: 'Регулярное обновление для нейтрализации угроз эксплуатации уязвимостей', value: 'предоставление обновлений безопасности, исправлений ошибок и критических патчей в период действия лицензии или технической поддержки' },
          { name: 'Функционирование в среде операционной системы из Единого реестра российского ПО', value: 'установка и эксплуатация на отечественных ОС из реестра Минцифры без применения эмуляции или дополнительных прослоек совместимости' },
          { name: 'Эмуляция аппаратного обеспечения с использованием KVM', value: 'использование гипервизора KVM/QEMU или эквивалентного механизма аппаратной виртуализации', unit: 'технология' },
          { name: 'Создание виртуальных машин, образов и шаблонов с поддержкой 32 и 64-битных гостевых ОС', value: 'поддержка создания, хранения и эксплуатации ВМ, образов и шаблонов для 32- и 64-разрядных гостевых ОС' },
          { name: 'Создание ВМ из настраиваемых шаблонов', value: 'параметризуемые шаблоны с выбором CPU, RAM, дисков, сетей и механизмов инициализации' },
          { name: 'Поддержка в ВМ до 256 виртуальных процессоров', value: 'не менее 256 vCPU на одну виртуальную машину', unit: 'vCPU' },
          { name: 'Поддержка в ВМ до 2000 ГБ оперативной памяти', value: 'не менее 2000 ГБ оперативной памяти на одну виртуальную машину', unit: 'ГБ' },
          { name: 'Идентификация и аутентификация субъектов доступа', value: 'локальная и/или централизованная аутентификация пользователей и администраторов с разграничением ролей и прав доступа' },
          { name: 'Функционирование в условиях мандатного и дискреционного разграничения доступа', value: 'эксплуатация платформы при мандатном и дискреционном разграничении доступа без утраты штатной функциональности' },
          { name: 'Запуск ВМ в виде отдельного процесса', value: 'каждая виртуальная машина исполняется отдельным процессом гипервизора с изоляцией ресурсов', unit: 'режим' },
          { name: 'Совместимость и интеграция с доменом FreeIPA и службой каталога для Linux', value: 'интеграция с FreeIPA, ALD Pro и иными службами каталогов Linux для аутентификации и централизованного управления' },
          { name: 'Интерфейс на русском языке', value: 'русскоязычный веб-интерфейс и/или графическая клиентская консоль администрирования' },
          { name: 'Совместимость с программным обеспечением для управления виртуальными рабочими местами (VDI)', value: 'совместимость с Termidesk и иными VDI-решениями по API, каталогам и механизмам размещения ВМ' },
          { name: 'Поддержка различных сценариев виртуализации рабочих мест', value: 'постоянные, непостоянные, пуловые и шаблонные сценарии предоставления виртуальных рабочих мест' },
          { name: 'Управление конфигурацией ВМ', value: 'изменение параметров CPU, RAM, дисков, сетевых интерфейсов и политик запуска через консоль управления' },
          { name: 'Изменение количества выделенных процессоров и размера ОЗУ без завершения функционирования ВМ', value: 'горячее изменение vCPU и RAM без остановки ВМ при поддержке гостевой ОС', unit: 'режим' },
          { name: 'Подключение к ВМ устройств из состава аппаратных средств', value: 'подключение ISO-образов, USB-устройств, сетевых адаптеров и иных поддерживаемых устройств к виртуальной машине' },
          { name: 'Добавление виртуальных дисков без остановки ВМ', value: 'горячее добавление и подключение виртуальных дисков без остановки виртуальной машины', unit: 'режим' },
          { name: 'Клонирование ВМ', value: 'полное и/или связанное клонирование виртуальных машин и шаблонов', unit: 'операция' },
          { name: 'Сохранение ВМ как шаблона', value: 'преобразование эталонной виртуальной машины в шаблон для массового развёртывания', unit: 'операция' },
          { name: 'Создание кластеров высокой доступности', value: 'HA-кластеры с контролем состояния узлов и автоматическим перезапуском виртуальных машин', unit: 'кластер' },
          { name: 'Выполнение миграции работающих ВМ между узлами кластера', value: 'live migration виртуальных машин между узлами без остановки прикладного сервиса', unit: 'режим' },
          { name: 'Ручная балансировка нагрузки', value: 'ручное перераспределение виртуальных машин и ресурсов между хостами кластера', unit: 'режим' },
          { name: 'Автоматическое распределение ресурсов между работающими ВМ', value: 'автоматическое размещение виртуальных машин и балансировка нагрузки по правилам кластера', unit: 'режим' },
          { name: 'Защита файлов-образов ВМ от модификации', value: 'контроль доступа, права, снапшоты и иные механизмы защиты образов и дисков виртуальных машин' },
          { name: 'Централизованное управление кластерами, хранилищами и виртуальными коммутаторами', value: 'единая консоль управления хостами, кластерами, сетями, хранилищами и политиками платформы' },
          { name: 'Мониторинг работоспособности и использования ресурсов ВМ', value: 'мониторинг CPU, RAM, дисков, сети, состояний и событий виртуальных машин и узлов' },
          { name: 'Поддержка VLAN/VXLAN', value: 'виртуальные сети с сегментацией и изоляцией трафика на базе VLAN/VXLAN', unit: 'технология' },
          { name: 'Регистрация событий', value: 'централизованное журналирование административных, системных и инфраструктурных событий', unit: 'режим' },
          { name: 'Централизованное хранение конфигурационной информации', value: 'хранение настроек кластера, сетей, хранилищ и шаблонов в централизованной базе или репозитории' },
          { name: 'Подключение к ВМ по протоколу SPICE', value: 'доступ к консоли виртуальных машин по SPICE и/или VNC через защищённые механизмы подключения', unit: 'протокол' },
          { name: 'Встроенная консоль в веб-интерфейсе', value: 'встроенная web-console для управления виртуальными машинами без установки отдельного толстого клиента' },
          { name: 'Перенос ВМ между узлами кластера без прерывания сетевого трафика', value: 'миграция запущенных ВМ с сохранением сетевой связности, IP-параметров и открытых сеансов', unit: 'режим' },
          { name: 'Миграция дисков работающих ВМ между хранилищами', value: 'storage live migration между поддерживаемыми хранилищами без остановки ВМ', unit: 'режим' },
          { name: 'Ограничение сетевого и дискового ввода-вывода ВМ', value: 'квотирование и лимитирование IOPS, throughput и сетевой полосы для виртуальных машин', unit: 'механизм' },
          { name: 'Поддержка протокола IPMI 2.0', value: 'интеграция с BMC/IPMI 2.0 для управления питанием и аппаратным состоянием узлов', unit: 'протокол' },
          { name: 'Поддержка расширения количества управляемых ВМ до 10 000', value: 'масштабирование платформы до не менее 10 000 управляемых виртуальных машин', unit: 'ВМ' },
          { name: 'Поддержка кластером управления до 1250 серверов виртуализации', value: 'кластер управления масштабом не менее 1250 серверов виртуализации', unit: 'сервер' },
          { name: 'Поддержка сервером виртуализации до 32 процессоров', value: 'не менее 32 физических процессоров на один сервер виртуализации', unit: 'процессор' },
          { name: 'Поддержка сервером виртуализации до 384 физических ядер', value: 'не менее 384 физических ядер на один сервер виртуализации', unit: 'ядро' },
          { name: 'Поддержка сервером виртуализации до 6 ТБ оперативной памяти', value: 'не менее 6 ТБ оперативной памяти на один сервер виртуализации', unit: 'ТБ' },
          { name: 'Групповое создание 500 и более ВМ из шаблонов', value: 'массовое развёртывание не менее 500 виртуальных машин из шаблонов в пакетном режиме', unit: 'ВМ' },
          { name: 'Поддержка механизмов оптимизации оперативной памяти', value: 'баллонирование, overcommit, deduplication или иные штатные механизмы оптимизации памяти', unit: 'механизм' },
          { name: 'Автоматический ввод ВМ в домен', value: 'автоматизация включения виртуальных машин в домен или каталог при развёртывании', unit: 'режим' },
          { name: 'Наличие клиентского приложения с графическим интерфейсом', value: 'графический клиент и/или web-интерфейс администратора для работы с платформой' },
          { name: 'Работа с хранилищем LVM', value: 'создание, подключение и управление хранилищами на базе LVM', unit: 'технология' },
          { name: 'Создание и использование распределённого блочного хранилища Ceph', value: 'интеграция с Ceph RBD и управление пулами, томами и политиками размещения', unit: 'технология' },
          { name: 'Наличие сервисного режима обслуживания узла', value: 'вывод узла в сервисный режим для обслуживания без нарушения работы кластера', unit: 'режим' },
          { name: 'Возможность создания доменных пользователей', value: 'использование доменных учётных записей и групп для доступа к платформе', unit: 'объект' },
          { name: 'Встроенное резервное копирование для ВМ', value: 'штатные механизмы резервного копирования и восстановления виртуальных машин либо интеграция с backup-системами', unit: 'механизм' },
          { name: 'Расширение диска ВМ он-лайн', value: 'online resize виртуальных дисков без остановки виртуальной машины', unit: 'режим' },
          { name: 'Поддержка виртуальной машиной до 52 виртуальных дисков', value: 'не менее 52 виртуальных дисков на одну виртуальную машину', unit: 'диск' },
          { name: 'Поддержка виртуальной машиной до 26 сетевых интерфейсов', value: 'не менее 26 виртуальных сетевых интерфейсов на одну виртуальную машину', unit: 'интерфейс' },
          { name: 'Расширение хранилищ он-лайн', value: 'online expansion датасторов, томов и пулов хранения без остановки сервисов', unit: 'режим' },
          { name: 'Наличие провайдера для Terraform', value: 'Terraform provider или эквивалентный механизм IaC-автоматизации', unit: 'средство' },
          { name: 'Развертывание продукта с использованием подхода IaaC', value: 'автоматизация развёртывания и конфигурирования средствами Infrastructure as Code', unit: 'подход' },
          { name: 'Создание изолированных тенантов', value: 'многоарендность с изоляцией ресурсов, сетей и прав доступа по тенантам', unit: 'режим' },
          { name: 'Развертывание географически распределенной инфраструктуры', value: 'поддержка нескольких площадок и централизованного управления геораспределённой инфраструктурой', unit: 'схема' },
          { name: 'Интеграция с Microsoft AD DS через доверительные отношения', value: 'аутентификация и авторизация через доверительные отношения с Microsoft AD DS', unit: 'интеграция' },
          { name: 'Поддержка технологии единого входа - SSO Kerberos', value: 'единый вход пользователей по Kerberos/SSO без повторного ввода учётных данных', unit: 'технология' },
          { name: 'Поддержка Affinity / Anti-Affinity правил', value: 'правила совместного и раздельного размещения виртуальных машин по узлам кластера', unit: 'правило' },
          { name: 'Поддержка групп ВМ с общим жизненным циклом', value: 'группы виртуальных машин с общими политиками запуска, остановки, обновления и размещения', unit: 'группа' },
          { name: 'Инициализация ВМ', value: 'cloud-init, guest initialization или эквивалентные механизмы первичной настройки виртуальных машин', unit: 'механизм' },
          { name: 'Квоты на использование ресурсов', value: 'лимиты на CPU, RAM, диски и сети по пользователю, проекту или тенанту', unit: 'квота' },
          { name: 'Тарификация использования ресурсов', value: 'учёт потребления ресурсов для расчётов, биллинга или внутренней аллокации', unit: 'механизм' },
          { name: 'Создание виртуальных дата центров', value: 'логические виртуальные дата-центры с выделенными пулами ресурсов и сетями', unit: 'объект' },
          { name: 'Реализация модели доступа на базе ACL', value: 'списки контроля доступа для объектов платформы, ВМ, сетей и хранилищ', unit: 'модель' },
          { name: 'Фильтрация трафика для виртуальных сетей', value: 'правила фильтрации и изоляции трафика на уровне виртуальных сетей', unit: 'механизм' },
          { name: 'Визуализация топологии сети', value: 'графическое представление связей между сетями, узлами, виртуальными машинами и сервисами', unit: 'интерфейс' },
          { name: 'Создание виртуальных сетей из шаблонов', value: 'типовые шаблоны виртуальных сетей и сегментов с повторным использованием', unit: 'шаблон' },
          { name: 'Централизованный источник шаблонов ВМ', value: 'единый каталог образов и шаблонов виртуальных машин', unit: 'каталог' },
          { name: 'Загрузка образов дисков с HTTP-ресурсов', value: 'импорт образов дисков по HTTP/HTTPS и из внешних репозиториев', unit: 'способ' },
          { name: 'Горячее подключение сетевых интерфейсов и дисков к ВМ', value: 'hot-plug сетевых интерфейсов и дисков без остановки виртуальной машины', unit: 'режим' },
          { name: 'Снимки состояния ВМ и дисков', value: 'снапшоты виртуальных машин и дисков с возможностью отката', unit: 'механизм' },
          { name: 'Наличие DRS', value: 'DRS или эквивалентный механизм динамического распределения ресурсов', unit: 'механизм' },
          { name: 'Панель в веб-интерфейсе с основной информацией о платформе', value: 'дашборд с состоянием кластера, ресурсов, аварий и производительности', unit: 'интерфейс' },
        ],
      },
      {
        title: '3. Безопасность, совместимость и эксплуатация',
        rows: [
          { name: 'Интеграция со службой каталогов', value: 'интеграция с ALD Pro, FreeIPA, LDAP/AD DS или эквивалентными службами каталогов', unit: 'интеграция' },
          { name: 'Совместимость с Termidesk', value: 'штатная совместимость с Termidesk для сценариев VDI и доставки виртуальных рабочих мест', unit: 'совместимость' },
          { name: 'Совместимость с RuBackup', value: 'интеграция с RuBackup для резервного копирования виртуальных машин, конфигурации и инфраструктурных объектов', unit: 'совместимость' },
          { name: 'Ролевая модель доступа (RBAC)', value: 'разделение ролей администраторов, операторов, аудиторов и иных категорий пользователей', unit: 'модель' },
          { name: 'Журналирование событий и аудит действий', value: 'протоколирование входов, изменений конфигурации, операций с ВМ и системных событий', unit: 'механизм' },
          { name: 'Мандатное управление доступом к виртуальным машинам', value: 'встроенные механизмы разграничения доступа к виртуальным машинам по уровням и ролям', unit: 'механизм' },
          { name: 'Шифрование трафика управления', value: 'TLS 1.2 и выше' },
          { name: 'Централизованная консоль управления', value: 'единый web-интерфейс и/или графическая консоль управления платформой', unit: 'интерфейс' },
          { name: 'Мониторинг ресурсов кластера', value: 'контроль загрузки узлов, виртуальных машин, сетей, хранилищ и аварийных состояний в реальном времени', unit: 'механизм' },
          { name: 'Отказоустойчивая схема развёртывания', value: 'кластерная и/или резервированная схема развёртывания компонентов управления', unit: 'схема' },
        ],
      },
      {
        title: '4. Требования к включенным обновлениям Тип 2 или технической поддержке',
        rows: getSupportSectionRows(term),
      },
    ]);
  }

  if (row.type === 'vdi' && /(termidesk|термидеск|vdi)/i.test(haystack)) {
    return buildGroupedSpecs([
      {
        title: '1. Общее описание решения',
        rows: [
          { name: 'Тип программного обеспечения', value: 'Платформа виртуальных рабочих мест' },
          { name: 'Редакция / семейство продукта', value: 'Termidesk или эквивалент' },
          { name: 'Тип лицензии', value: getFilledCommercialValue(commercial.suggestedLicenseType, 'Конкурентные пользователи (CCU)') },
          { name: 'Срок действия лицензии', value: term },
          { name: 'Количество лицензий', value: `не менее ${row.qty}` },
          { name: 'Метрика лицензирования', value: 'По конкурентным пользователям (CCU) и/или именованным пользователям' },
          { name: 'Лицензируемый объект', value: 'Пользователь / конкурентная сессия' },
          { name: 'Наличие в Едином реестре российского ПО Минцифры России', value: 'Да' },
          { name: 'Функционирование в среде ОС Astra Linux Special Edition 1.8 или эквивалент', value: 'Наличие (Обоснование: в связи с необходимостью обеспечения взаимодействия с товарами, используемыми Заказчиком)' },
          { name: 'Поддержка встроенных механизмов безопасности: замкнутая программная среда и мандатный контроль целостности', value: 'Наличие' },
          { name: 'Управление полным жизненным циклом рабочих мест', value: 'Создание, настройка, включение, выключение, безопасное выключение, перезагрузка, эксплуатация и удаление' },
          { name: 'Горизонтальное масштабирование диспетчеров и шлюзов', value: 'Наличие' },
          { name: 'Высокая доступность', value: 'Наличие' },
          { name: 'Способ поставки', value: 'Электронная' },
          { name: 'Документация на русском языке', value: 'Да' },
        ],
      },
      {
        title: '2. Требования к решению',
        rows: [
          { name: 'Поддержка платформ виртуализации', value: 'ПК СВ Брест, zVirt, oVirt, VMware vSphere, VMmanager, OpenStack, РЕД Виртуализация' },
          { name: 'Ограничение максимального количества одновременных сеансов', value: 'Наличие' },
          { name: 'Режим «Техническое обслуживание»', value: 'Наличие' },
          { name: 'Развертывание из шаблона нескольких типов рабочих мест', value: 'Наличие' },
          { name: 'Режимы развертывания «полные клоны» и «связанные клоны»', value: 'Наличие' },
          { name: 'Использование генератора имен рабочих мест', value: 'Наличие' },
          { name: 'Развертывание рабочих мест из снапшота ВМ', value: 'Наличие' },
          { name: 'Возврат к первоначальному состоянию рабочих мест без их пересоздания', value: 'Наличие' },
          { name: 'Работа с терминальными сессиями Microsoft Remote Desktop Services', value: 'Наличие' },
          { name: 'Работа с терминальными Linux-сессиями', value: 'Наличие' },
          { name: 'Работа с удалённым доступом к физическим ПК', value: 'Наличие' },
          { name: 'Балансировка пользовательских сессий между терминальными серверами', value: 'Наличие' },
          { name: 'Поддержка технологии единого входа', value: 'Наличие' },
          { name: 'Получение сведений о пользователях и группах из серверов каталогов', value: 'ALD Pro, FreeIPA, Microsoft Active Directory, Альт Домен' },
          { name: 'Аутентификация пользователей по SAML', value: 'Наличие' },
          { name: 'Аутентификация пользователей по OpenID Connect', value: 'Наличие' },
          { name: 'Поддержка двусторонней взаимной аутентификации по mTLS', value: 'Наличие' },
          { name: 'Поддержка единого входа Kerberos', value: 'Наличие' },
          { name: 'Аутентификация пользователей по смарт-картам и токенам Рутокен, JaCarta, eToken', value: 'Наличие' },
          { name: 'Идентификация пользователей по IP-адресу', value: 'Наличие' },
          { name: 'Поддержка двухфакторной аутентификации на основе TOTP', value: 'Наличие' },
          { name: 'Предоставление удалённого доступа к рабочим местам по RDP, SPICE, TERA, Loudplay и HTML5', value: 'Наличие' },
          { name: 'Подключение по протоколу UDP', value: 'Наличие' },
          { name: 'Предоставление удалённого доступа к рабочим местам с vGPU, разрешением до 4К и 60 кадрами/сек.', value: 'Наличие' },
          { name: 'Поддержка режимов прямого соединения и соединения через «Шлюз»', value: 'Наличие' },
          { name: 'Поддержка шлюза подключений без обязательного использования VPN', value: 'Наличие' },
          { name: 'Настраиваемое перенаправление аппаратных устройств и буфера обмена', value: 'Наличие' },
          { name: 'Ограничение перенаправления USB-устройств', value: 'Наличие' },
          { name: 'Перенаправление домашнего каталога пользователя', value: 'Наличие' },
          { name: 'Использование выделенного виртуального диска для хранения пользовательских данных', value: 'Наличие' },
          { name: 'Доставка виртуальных рабочих столов', value: 'Наличие' },
          { name: 'Доставка отдельных приложений', value: 'Наличие' },
          { name: 'Доступ через HTML5-браузер', value: 'Наличие' },
          { name: 'Доступ через тонкий клиент', value: 'Наличие' },
          { name: 'Мультиарендность', value: 'Наличие' },
          { name: 'Управление пулами рабочих столов', value: 'Наличие' },
          { name: 'Поддержка терминального режима', value: 'Наличие' },
          { name: 'Поддержка VDI-режима', value: 'Наличие' },
          { name: 'Средства публикации приложений', value: 'Наличие' },
          { name: 'Поддержка USB, буфера обмена и печати в сессии', value: 'Наличие' },
        ],
      },
      {
        title: '3. Требования к компоненту «Универсальный диспетчер»',
        rows: [
          { name: 'Наличие установщика, работающего в диалоговом режиме', value: 'Наличие' },
          { name: 'Возможность выбора типа установки СУБД PostgreSQL', value: 'Наличие' },
          { name: 'Выполнение установки в соответствии с заданной ролью узла', value: 'Наличие' },
          { name: 'Возможность совмещения нескольких ролей на одном узле', value: 'Наличие' },
          { name: 'Настройка параметров доступа к системе', value: 'Наличие' },
          { name: 'Наличие аудита действий администратора', value: 'Наличие' },
          { name: 'Возможность хранения паролей во внешних хранилищах секретов', value: 'Наличие' },
          { name: 'Доступ к графическому интерфейсу управления из веб-обозревателя по HTTPS', value: 'Наличие' },
          { name: 'Наглядный графический веб-интерфейс', value: 'Наличие' },
          { name: 'Настройка параметров конфигурации гостевых ОС', value: 'Наличие' },
          { name: 'Поиск в графическом веб-интерфейсе', value: 'Наличие' },
          { name: 'CLI-интерфейс', value: 'Наличие' },
          { name: 'REST API-интерфейс', value: 'Наличие' },
          { name: 'Визуализация событий аудита', value: 'Наличие' },
          { name: 'Сбор и хранение статистики', value: 'Наличие' },
          { name: 'Управление электропитанием рабочих мест', value: 'Наличие' },
        ],
      },
      {
        title: '4. Требования к компоненту «Клиент»',
        rows: [
          { name: 'Поддерживаемые операционные системы компонента «Клиент»', value: 'Microsoft Windows 10+, macOS 13+, Astra Linux Special Edition 1.7+, Альт Рабочая станция 10+, Ubuntu 20.04+, РЕД ОС 8+' },
          { name: 'Консольный и графический режим запуска', value: 'Наличие' },
          { name: 'Подключение к нескольким инсталляциям ПО', value: 'Наличие' },
          { name: 'Визуализация списка доступных рабочих мест', value: 'Наличие' },
          { name: 'Перенаправление клавиатуры и указателя мыши', value: 'Наличие' },
          { name: 'Работа с несколькими мониторами', value: 'Наличие' },
          { name: 'Передача текстовых данных через буфер обмена', value: 'Наличие' },
          { name: 'Автоматическое переподключение при потере соединения', value: 'Наличие' },
        ],
      },
      {
        title: '5. Требования к компоненту «Агент»',
        rows: [
          { name: 'Поддерживаемые гостевые ОС компонента «Агент»', value: 'Microsoft Windows 10+, Windows Server 2016+, Astra Linux Special Edition 1.7+, Альт Рабочая станция 10+, РЕД ОС 7.3+' },
          { name: 'Установка в гостевую ОС для обеспечения взаимодействия с компонентом «Универсальный диспетчер»', value: 'Наличие' },
          { name: 'Поддержка автозапуска при старте гостевой ОС', value: 'Наличие' },
          { name: 'Наличие графического интерфейса конфигурации', value: 'Наличие' },
        ],
      },
      {
        title: '6. Требования к включенным обновлениям Тип 2 или технической поддержке',
        rows: getSupportSectionRows(term),
      },
    ]);
  }

  return null;
}

function getLicenseTypePlaceholder(row: GoodsRow): string {
  if (row.type === 'supportCert' || row.type === 'osSupport') {
    return 'Стандарт / Привилегированная';
  }
  if (row.type === 'ldap') {
    return 'Серверная / CAL / срочная';
  }
  if (row.type === 'virt') {
    return 'Бессрочная / на сокет';
  }
  if (row.type === 'vdi') {
    return 'Подписка / конкурентная';
  }
  if (lookupCatalog(row.type)?.isSoftware) {
    return 'Бессрочная / срочная / подписка';
  }
  return 'Если применимо';
}

function getLicenseTypeOptions(row: GoodsRow): string[] {
  if (row.type === 'ldap') {
    return [
      'Серверная часть',
      'Клиентская часть (CAL)',
      'CAL на устройство',
      'CAL на пользователя',
      'Серверная часть + CAL',
    ];
  }
  if (row.type === 'supportCert' || row.type === 'osSupport') {
    return ['Стандарт', 'Привилегированная'];
  }
  if (row.type === 'vdi') {
    return ['Конкурентные пользователи (CCU)', 'Именованные пользователи'];
  }
  if (row.type === 'virt') {
    return ['На физический процессор (socket)'];
  }
  if (row.type === 'email') {
    return ['На почтовый ящик / пользователя'];
  }
  if (row.type === 'backup_sw') {
    return ['По объему данных (ТБ)', 'Серверная часть + агенты'];
  }
  return [];
}

function getTermPlaceholder(row: GoodsRow): string {
  if (row.type === 'supportCert' || row.type === 'osSupport') {
    return '12 / 24 / 36 мес.';
  }
  if (lookupCatalog(row.type)?.isSoftware) {
    return '12 / 24 / 36 мес. / бессрочно';
  }
  return 'Если применимо';
}

function getCommercialValue(value: string): string {
  return value.trim() || '—';
}

function getResolvedCommercialContext(row: GoodsRow) {
  return resolveCommercialTerms({
    type: row.type,
    model: row.model,
    licenseType: row.licenseType,
    term: row.term,
  });
}

function applyAutoCommercialTerms<T extends GoodsRow>(row: T): T {
  const derived = deriveCommercialContext({
    type: row.type,
    model: row.model,
    licenseType: row.licenseTypeAuto ? '' : row.licenseType,
    term: row.termAuto ? '' : row.term,
  });
  const next = { ...row } as T;

  if (derived.suggestedLicenseType) {
    if (!row.licenseType.trim() || row.licenseTypeAuto) {
      next.licenseType = derived.suggestedLicenseType;
      next.licenseTypeAuto = true;
    }
  } else if (row.licenseTypeAuto) {
    next.licenseType = '';
    next.licenseTypeAuto = false;
  }

  if (derived.suggestedTerm) {
    if (!row.term.trim() || row.termAuto) {
      next.term = derived.suggestedTerm;
      next.termAuto = true;
    }
  } else if (row.termAuto) {
    next.term = '';
    next.termAuto = false;
  }

  return next;
}

function hasCommercialFields(row: GoodsRow): boolean {
  const commercial = getResolvedCommercialContext(row);
  return Boolean(commercial.suggestedLicenseType || commercial.suggestedTerm);
}

function shouldShowCommercialTerms(rows: GoodsRow[]): boolean {
  return rows.some((row) => lookupCatalog(row.type)?.isSoftware || hasCommercialFields(row));
}

type SectionTableRow = {
  label: string;
  value: string;
};

type DocumentSectionBundle = {
  currentYear: number;
  contractWord: string;
  objectName: string;
  introText: string;
  multi: boolean;
  hasHW: boolean;
  hasSW: boolean;
  hasService: boolean;
  serviceOnly: boolean;
  astraBundle: boolean;
  regimes: Set<string>;
  showCommercialTerms: boolean;
  section3Title: string;
  section4Title: string;
  section5Title: string;
  section6Title: string;
  section7Title: string;
  approvalPersonName: string;
  approvalPersonTitle: string;
  approvalOrgName: string;
  section1Rows: SectionTableRow[];
  readinessSummaryRows: SectionTableRow[];
  legalSummaryRows: LegalSummaryRow[];
  section2Rows: SectionTableRow[];
  section3Rows: SectionTableRow[];
  section4Rows: SectionTableRow[];
  section5Rows: SectionTableRow[];
  section6Rows: SectionTableRow[];
  section7Rows: SectionTableRow[];
  publicationDossierRows: PublicationDossierRow[];
  publicationDossierSummary: PublicationDossierSummary;
};

function getReadinessStatusLabel(status: ReadinessGateSummary['status']): string {
  switch (status) {
    case 'ready':
      return 'готово к публикации';
    case 'warn':
      return 'есть предупреждения';
    default:
      return 'есть блокеры';
  }
}

function buildReadinessSummaryRows(summary: ReadinessGateSummary): SectionTableRow[] {
  const rows: SectionTableRow[] = [
    {
      label: 'Р.1',
      value: `Итоговый статус готовности: ${getReadinessStatusLabel(summary.status)}. Проверено позиций: ${summary.itemsReviewed}. Блокеров: ${summary.blockers.length}. Предупреждений: ${summary.warnings.length}.`,
    },
    {
      label: 'Р.2',
      value: `Anti-ФАС: score ${summary.antiFas.score ?? '—'}/${summary.antiFas.minScore ?? '—'}; критичных — ${summary.antiFas.critical}; существенных — ${summary.antiFas.major}; незначительных — ${summary.antiFas.minor}.`,
    },
    {
      label: 'Р.3',
      value: `Внешняя сверка: с подтверждающим источником — ${summary.benchmark.covered}; OK — ${summary.benchmark.ok}; Warn — ${summary.benchmark.warn}; Block — ${summary.benchmark.block}; без источника — ${summary.benchmark.withoutSource}.`,
    },
    {
      label: 'Р.4',
      value: `Юридическая полнота: ручная верификация — ${summary.legal.manualReview}; без ОКПД2 — ${summary.legal.missingOkpd2}; исключение без основания — ${summary.legal.missingBasis}; автооснование ПП1875 — ${summary.legal.autoDerivedBasis}; незавершённых позиций — ${summary.legal.pendingGeneration}.`,
    },
    {
      label: 'Р.5',
      value: `Полнота ТЗ на услуги: проверено сервисных позиций — ${summary.service.reviewed}; без результата / состава услуг — ${summary.service.missingResult}; без сроков / этапов / SLA — ${summary.service.missingTiming}; без приёмки / отчётности — ${summary.service.missingAcceptance}; без режима оказания — ${summary.service.missingExecution}; без требований к квалификации — ${summary.service.missingQualification}.`,
    },
    {
      label: 'Р.6',
      value: `Блокирующие замечания: ${buildReadinessIssuePreview(summary.blockers)}.`,
    },
    {
      label: 'Р.7',
      value: `Предупреждения и что проверить вручную: ${buildReadinessIssuePreview(summary.warnings)}.`,
    },
  ];
  return rows;
}

function getClassificationSourceKey(meta: Record<string, string> = {}, rowType = ''): string {
  const raw = String(meta.classification_source || '').trim().toLowerCase();
  if (raw) return raw;
  return isUniversalGoodsType(rowType) ? 'ai' : 'catalog';
}

function getClassificationSourceLabel(meta: Record<string, string> = {}, rowType = ''): string {
  switch (getClassificationSourceKey(meta, rowType)) {
    case 'catalog':
    case 'template':
      return 'каталог / шаблон позиции';
    case 'docx_import':
      return 'импорт из DOCX / служебной записки';
    case 'import':
      return 'импорт из файла';
    case 'internet':
      return 'интернет / документация производителя';
    case 'eis':
      return 'ЕИС / КТРУ / закупочные площадки';
    case 'ai':
      return 'ИИ-классификация по описанию';
    default:
      return isUniversalGoodsType(rowType) ? 'ИИ-классификация по описанию' : 'каталог / шаблон позиции';
  }
}

function hasTrustedClassificationEvidence(row: GoodsRow): boolean {
  const sourceKey = getClassificationSourceKey(row.meta, row.type);
  if (sourceKey === 'catalog' || sourceKey === 'template') return true;
  if (sourceKey !== 'eis') return false;
  const normalizedMeta = normalizeResolvedMeta(row.type, row.meta || {});
  if (!isUniversalMetaComplete(normalizedMeta)) return false;
  const { status } = getResolvedLaw175Meta(row.type, normalizedMeta);
  if (status === 'exception') return false;
  return true;
}

function requiresManualClassificationReview(row: GoodsRow): boolean {
  const sourceKey = getClassificationSourceKey(row.meta, row.type);
  if (isUniversalGoodsType(row.type)) {
    return !hasTrustedClassificationEvidence(row) || !!row.importInfo?.needsReview;
  }
  if (row.importInfo?.needsReview && (!getResolvedOkpd2Code(row) || sourceKey === 'docx_import' || sourceKey === 'import')) {
    return true;
  }
  return sourceKey === 'ai' || sourceKey === 'internet';
}

function buildRowClassificationContext(row: GoodsRow): string {
  const parts: string[] = [];
  const goods = lookupCatalog(row.type);
  const okpd2 = getResolvedOkpd2Code(row);
  const okpd2Name = getResolvedOkpd2Name(row);
  const ktru = getResolvedKtruCode(row);

  parts.push(`Описание позиции: ${row.model || cleanCatalogName(goods.name)}`);
  parts.push(`Текущая классификация: ОКПД2 ${okpd2 || 'не заполнен'}${okpd2Name ? ` — ${okpd2Name}` : ''}; КТРУ ${ktru || 'не указан'}; источник ${getClassificationSourceLabel(row.meta, row.type)}.`);

  const currentSpecsBlock = buildSpecSnapshotContext(row.specs, 'Текущие характеристики ТЗ', 16);
  if (currentSpecsBlock) parts.push(currentSpecsBlock);

  if (row.importInfo?.sourcePreview) {
    parts.push(`Фрагмент исходного файла: ${row.importInfo.sourcePreview}`);
  }

  if (row.importInfo?.sourceContextText) {
    parts.push(`Контекст исходного файла:\n${trimPreviewText(row.importInfo.sourceContextText, 1600)}`);
  }

  if (row.benchmark?.sourceContextText) {
    parts.push(`Контекст внешнего источника:\n${trimPreviewText(row.benchmark.sourceContextText, 1600)}`);
  }

  const sourceSpecsBlock = buildSpecSnapshotContext(row.benchmark?.sourceSpecs, `Характеристики источника (${row.benchmark?.sourceCompareLabel || 'benchmark'})`, 16);
  if (sourceSpecsBlock) parts.push(sourceSpecsBlock);

  return parts.filter(Boolean).join('\n\n').slice(0, 5000);
}

function getLaw175EvidenceItems(row: GoodsRow): string[] {
  const { regime, status, basisAuto } = getResolvedLaw175Meta(row.type, row.meta);
  const items: string[] = [];

  if (status === 'exception') {
    items.push('документально подтвержденное обоснование применения исключения из защитной меры');
  }

  switch (regime) {
    case 'pp1236':
      items.push('номер реестровой записи в Едином реестре российских программ для ЭВМ и БД Минцифры России или евразийского реестра ПО');
      break;
    case 'pp878':
      items.push('номера реестровых записей из реестра российской промышленной продукции или евразийского реестра промышленной продукции');
      items.push('документы по ПП РФ № 1875 и, при применимости, по Решению Совета ЕЭК № 105');
      break;
    case 'pp616':
      items.push('реестровая запись российской / евразийской промышленной продукции (ГИСП) и документы по ПП РФ № 1875');
      items.push('подтверждение по ПП РФ № 719 при применимости к позиции товара');
      break;
    default:
      if (isServiceCatalogType(row.type)) {
        items.push('специальные подтверждающие документы по ПП РФ № 1875 не требуются');
      } else {
        items.push('страна происхождения указывается в документах поставки; специальных подтверждений по ПП РФ № 1875 не требуется');
      }
      break;
  }

  if (basisAuto) {
    items.push('юридически проверенная замена автосформированного основания по ПП РФ № 1875');
  }

  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function getLaw175EvidenceText(row: GoodsRow): string {
  return getLaw175EvidenceItems(row).join('; ');
}

function buildDocumentSectionBundle(
  doneRows: GoodsRow[],
  lawMode: LawMode,
  readinessSummary: ReadinessGateSummary | null = null,
  benchmarkingEnabled = true,
  platformSettings?: PlatformIntegrationSettings,
): DocumentSectionBundle {
  const contractWord = lawMode === '44' ? 'контракта' : 'договора';
  const currentYear = new Date().getFullYear();
  const multi = doneRows.length > 1;
  const hasService = doneRows.some((r) => isServiceCatalogType(r.type));
  const serviceOnly = doneRows.length > 0 && doneRows.every((r) => isServiceCatalogType(r.type));
  const hasHW = doneRows.some((r) => !(lookupCatalog(r.type)?.isSoftware) && !isServiceCatalogType(r.type));
  const hasSW = doneRows.some((r) => !!(lookupCatalog(r.type)?.isSoftware));
  const astraBundle = isAstraBundleProcurement(doneRows);
  const showCommercialTerms = shouldShowCommercialTerms(doneRows);
  const objectName = getProcurementObjectName(doneRows);
  const introText = getProcurementIntro(doneRows);
  const regimes = new Set(doneRows.map((r) => (r.meta?.nac_regime) || getUnifiedNacRegime(r.type)));
  const resolvedReadinessSummary = readinessSummary ?? buildReadinessGateSummary(doneRows, null, benchmarkingEnabled);

  const ps = platformSettings;
  const orgFull = ps?.orgName?.trim() || '';
  const inn = ps?.customerInn?.trim() || '';
  const kpp = ps?.customerKpp?.trim() || '';
  const legalAddress = ps?.customerAddress?.trim() || '';
  const deliveryAddress = ps?.deliveryAddress?.trim() || '';
  const deliveryDays = ps?.deliveryDays ?? 60;
  const contactName = ps?.contactPersonName?.trim() || '';
  const contactTitle = ps?.contactPersonTitle?.trim() || '';
  const contactPhone = ps?.contactPersonPhone?.trim() || '';
  const contactEmail = ps?.contactPersonEmail?.trim() || '';

  const orgInnKpp = [orgFull, inn ? `ИНН ${inn}` : '', kpp ? `КПП ${kpp}` : ''].filter(Boolean).join(', ');
  const customerLine = orgInnKpp || '_______________________________________________';

  const section1Rows: SectionTableRow[] = [];
  const pushSection1 = (value: string) => section1Rows.push({ label: `1.${section1Rows.length + 1}`, value });
  pushSection1(introText);
  pushSection1(`Заказчик: ${customerLine}`);
  if (legalAddress) pushSection1(`Юридический адрес Заказчика: ${legalAddress}`);
  pushSection1('Исполнитель: определяется по результатам закупочных процедур.');
  pushSection1(`Сроки выполнения: не позднее ${deliveryDays} (${numText(deliveryDays)}) календарных дней с даты заключения ${contractWord}.`);
  if (contactName) {
    const contactParts = [contactTitle, contactName].filter(Boolean).join(', ');
    const contactComm = [contactPhone, contactEmail].filter(Boolean).join(', ');
    pushSection1(`Контактное лицо Заказчика: ${contactParts}${contactComm ? ` (${contactComm})` : ''}`);
  }
  if (!multi) {
    const row0 = doneRows[0];
    const goods0 = lookupCatalog(row0.type);
    const commercial0 = getResolvedCommercialContext(row0);
    const resolvedRegime = row0.meta?.nac_regime || getUnifiedNacRegime(row0.type);
    const law175Label = getLaw175MeasureLabel(row0.meta?.law175_status || '', resolvedRegime);
    pushSection1(
      serviceOnly
        ? `Требования к объему оказываемых Услуг: ${row0.qty} (${numText(row0.qty)}) ${row0.qty === 1 ? 'условная единица' : 'условные единицы'}.`
        : `Требования к количеству поставляемого Товара: ${row0.qty} (${numText(row0.qty)}) ${goods0.isSoftware ? 'лицензий' : 'штук'}.`
    );
    pushSection1(`Национальный режим (ПП РФ № 1875): ${law175Label}.`);
    const basisDisplay = getResolvedLaw175Meta(row0.type, row0.meta).basisDisplay;
    if (basisDisplay) {
      pushSection1(`Основание / исключение по ПП РФ № 1875: ${basisDisplay}.`);
    }
    if (showCommercialTerms && commercial0.suggestedLicenseType) {
      pushSection1(`Тип лицензии / сертификата технической поддержки: ${commercial0.suggestedLicenseType}.`);
    }
    if (showCommercialTerms && commercial0.suggestedTerm) {
      pushSection1(`Срок действия лицензии / поддержки: ${commercial0.suggestedTerm}.`);
    }
  } else {
    pushSection1(
      serviceOnly
        ? `Перечень оказываемых Услуг и сопутствующих параметров приведён в сводной таблице и приложениях № 1–${doneRows.length}.`
        : `Перечень поставляемого Товара и сопутствующих параметров приведён в сводной таблице и приложениях № 1–${doneRows.length}.`
    );
  }

  const readinessSummaryRows = buildReadinessSummaryRows(resolvedReadinessSummary);
  const legalSummaryRows = doneRows.map((row, idx) => buildLegalSummaryRow(row, idx, lawMode));
  const publicationDossierRows = buildPublicationDossierRows(doneRows, benchmarkingEnabled);
  const publicationDossierSummary = buildPublicationDossierSummary(doneRows, benchmarkingEnabled);

  const section2Rows: SectionTableRow[] = [];
  const pushSection2 = (value: string) => section2Rows.push({ label: `2.${section2Rows.length + 1}`, value });
  pushSection2(serviceOnly
    ? (multi
      ? `Требования к составу, объёму, срокам, качеству и результату оказания Услуг представлены в Спецификациях (Приложения № 1–${doneRows.length} к настоящему Техническому заданию).`
      : 'Требования к составу, объёму, срокам, качеству и результату оказания Услуг представлены в Спецификации (Приложение № 1 к настоящему Техническому заданию).')
    : (multi
      ? `Требования к характеристикам поставляемого Товара представлены в Спецификациях (Приложения № 1–${doneRows.length} к настоящему Техническому заданию).`
      : 'Требования к характеристикам поставляемого Товара представлены в Спецификации (Приложение № 1 к настоящему Техническому заданию).'));

  if (astraBundle) {
    getAstraBundleRequirementTexts().forEach(pushSection2);
  }
  if (serviceOnly) {
    [
      'Исполнитель обязан оказать услуги в полном объёме, в сроки и с качеством, предусмотренными настоящим Техническим заданием и приложениями к нему.',
      'Результат оказания услуг должен быть проверяемым, воспроизводимым и подтверждаться актом сдачи-приёмки, отчётными материалами, протоколами, журналами или иными документами в зависимости от характера услуг.',
      'При оказании услуг должны соблюдаться требования законодательства Российской Федерации, нормативных документов, правил охраны труда, техники безопасности и внутреннего режима Заказчика.',
      'Исполнитель обязан обеспечить достаточную квалификацию персонала, наличие необходимых допусков, сертификатов, лицензий и разрешительных документов, если они требуются для оказания соответствующих услуг.',
    ].forEach(pushSection2);
  }
  if (hasHW) {
    [
      'Поставщик обязан осуществить поставку средств вычислительной техники и оборудования, а также комплектующих и расходных материалов к ним (далее — Товар) в порядке и на условиях, предусмотренных Контрактом и настоящим Техническим заданием, а также в соответствии с требованиями нормативных правовых актов, указанных в разделе 7 настоящего Технического задания.',
      'Поставляемый Товар должен соответствовать следующим требованиям: техническим и качественным характеристикам, установленным настоящим Техническим заданием; действующим государственным и международным стандартам и актам Российской Федерации; требованиям технических регламентов Таможенного союза (ТР ТС 004/2011 «О безопасности низковольтного оборудования», ТР ТС 020/2011 «Электромагнитная совместимость технических средств»); требованиям пожарной, санитарной и электрической безопасности; стандартам Российской Федерации в части входных и выходных разъёмов и уровней сигналов. В комплект поставки должны входить все интерфейсные шнуры и кабели питания, необходимые для полнофункциональной эксплуатации. Поставляемый Товар, в отношении которого утверждён класс энергетической эффективности, должен соответствовать классу энергетической эффективности не ниже «А». Товар должен быть предназначен для эксплуатации в рабочих помещениях.',
      'Для взаимодействия с Заказчиком Поставщик обязан в течение 1 (одного) рабочего дня с даты заключения Контракта назначить ответственное контактное лицо, выделить номер телефона, а также адрес электронной почты для приёма данных (запросов, заявок) в электронной форме и уведомить об этом Заказчика. Об изменении контактной информации ответственного лица Поставщик обязан уведомить Заказчика в течение 1 (одного) рабочего дня со дня возникновения таких изменений.',
      'Товар должен быть поставлен в рабочие часы Заказчика: понедельник–четверг с 08:00 до 17:00, пятница с 08:00 до 15:30 по московскому времени, в срок и по адресу, указанному в спецификации. Поставщик вправе досрочно осуществить поставку по согласованию с Заказчиком.',
      'Поставщик поставляет Товар в соответствии с пропускным и внутриобъектовым режимами, установленными по адресу поставки, в порядке, согласованном с Заказчиком не позднее чем за 3 (три) рабочих дня до даты фактической поставки. Поставка осуществляется силами и за счёт Поставщика.',
      'Поставщик предоставляет Заказчику комплект отчётных документов и электронный структурированный Документ о приёмке, подписанный усиленной квалифицированной электронной подписью (УКЭП) и размещённый в единой информационной системе в сфере закупок (ЕИС). Комплект отчётной документации включает: документы, подтверждающие гарантийные обязательства Поставщика и изготовителя (гарантийные карты) в отношении всех единиц Товара; копии сертификата(-ов) или декларации(-й) о соответствии, подтверждающих соответствие Товара требованиям технических регламентов. Гарантийная карта направляется в электронном виде на адрес электронной почты Заказчика и/или на бумажном носителе при поставке.',
      'Поставляемый Товар должен быть обеспечен комплектом документации на русском языке, включающим инструкции по эксплуатации (руководство пользователя, руководство администратора), а также технический паспорт на Товар, если данная документация предусмотрена производителем. Комплектация документацией в виде копий не допускается.',
      'Не допускается поставка Товара, имеющего повреждения и/или Товара, условия хранения которого были нарушены.',
      'Товар должен быть укомплектован в соответствии с эксплуатационной документацией необходимыми приспособлениями и инструментом для безопасных регулировок, технического обслуживания и применения по назначению.',
      'Уборка и вывоз тары, упаковки, вспомогательных упаковочных и укупорочных средств осуществляются Поставщиком за свой счёт в течение 1 (одного) рабочего дня с даты фактической поставки Товара.',
      'Товар должен быть свободен от прав третьих лиц.',
      'Заказчик вправе в течение 4 (четырёх) календарных дней с даты заключения Контракта направить Поставщику письменное требование о предоставлении в установленный срок (не менее 3 (трёх) календарных дней) по 1 (одной) единице подлежащих поставке Товаров для проверки соответствия Товара требованиям Технического задания.',
    ].forEach(pushSection2);
  }
  if (hasSW) {
    [
      'Поставляемое программное обеспечение должно быть лицензионно чистым. Поставщик гарантирует правомерность использования ПО.',
      'ПО должно быть полнофункциональным, не лимитированным по сроку использования и не быть демонстрационным.',
      'Право использования ПО передаётся Заказчику на основании лицензионного договора (сублицензионного соглашения) в соответствии с частью IV ГК РФ.',
    ].forEach(pushSection2);
    if (lawMode === '44') {
      pushSection2('В соответствии с ч. 3 ст. 33 Федерального закона от 05.04.2013 № 44-ФЗ Участник закупки вправе предложить программное обеспечение, эквивалентное указанному в Техническом задании, при условии полного соответствия всем функциональным требованиям настоящего ТЗ, включая: наличие в Едином реестре российских программ для ЭВМ и БД Минцифры России (если применимо), совместимость с указанными операционными системами и системами Заказчика, наличие требуемых сертификатов безопасности.');
    }
  }
  if (hasService) {
    doneRows
      .filter((row) => isServiceCatalogType(row.type))
      .forEach((row) => {
        const { regime, basisDisplay } = getResolvedLaw175Meta(row.type, row.meta);
        const measureText = getLaw175MeasureText(row.meta?.law175_status || '', regime, basisDisplay);
        if (measureText) pushSection2(measureText);
        // Требование лицензии для лицензируемых видов деятельности
        const desc = (row.model || '').toLowerCase();
        const isLicensedActivity =
          /медицин|медосмотр|фармац|охран|детектив|образован|дополнительн.*образован|профессиональн.*подготовк|строительств|проектирован|изыскан|геодез|картограф|связь|телекоммуник|перевозк|транспортир|опасн.*отход|обезвреживан|утилизац|огнеопасн|взрывчат|алкогол|табак|ломбард|аудит|нотариал|адвокат|частн.*охран|управлени.*многоквартир/.test(desc);
        if (isLicensedActivity) {
          pushSection2('Исполнитель обязан иметь лицензию на осуществление соответствующего вида деятельности, выданную уполномоченным органом в соответствии с действующим законодательством Российской Федерации. Копия действующей лицензии представляется в составе заявки на участие в закупке.');
        }
      });
  }
  if (regimes.has('pp878')) {
    pushSection2('Товар должен иметь подтверждение производства промышленной продукции на территории Российской Федерации (номера реестровых записей из реестра российской промышленной продукции или евразийского реестра промышленной продукции) в соответствии с ПП РФ от 23.12.2024 № 1875 и ПП РФ от 17.07.2015 № 719.');
  }
  if (regimes.has('pp1236')) {
    pushSection2('Программное обеспечение должно быть включено в Единый реестр российских программ для ЭВМ и баз данных (реестр Минцифры) в соответствии с ПП РФ от 16.11.2015 № 1236. Участник закупки обязан указать в составе заявки номер реестровой записи программного обеспечения в Едином реестре российских программ.');
  }
  if (regimes.has('pp616')) {
    pushSection2('Промышленные товары должны иметь подтверждение производства на территории государств — членов ЕАЭС. Подтверждение осуществляется документами в соответствии с ПП РФ от 23.12.2024 № 1875 и ПП РФ от 17.07.2015 № 719.');
  }
  if (doneRows.some((r) => ['pc', 'laptop', 'monoblock', 'server', 'tablet', 'thinClient'].includes(r.type))) {
    pushSection2('Вычислительная техника должна быть совместима с отечественными операционными системами, включёнными в Единый реестр российских программ для ЭВМ и БД Минцифры России, или эквивалентными (ч. 3 ст. 33 Федерального закона от 05.04.2013 № 44-ФЗ).');
  }
  if (doneRows.some((r) => ['switch', 'router', 'firewall', 'accessPoint', 'firewall_sw', 'siem', 'edr', 'dlp', 'waf'].includes(r.type))) {
    pushSection2('Поставляемое оборудование/ПО должно обладать функциональными возможностями для интеграции в существующую инфраструктуру Заказчика, включая поддержку SSHv2 и отправки журналов syslog по UDP и/или TCP при применимости.');
  }
  pushSection2(`Цена Договора является твёрдой и определяется на весь срок исполнения Договора.`);

  const section3Rows: SectionTableRow[] = serviceOnly
    ? [
        {
          label: '3.1',
          value: 'Оказание услуг должно выполняться по согласованному с Заказчиком плану-графику, этапам и контрольным точкам, если такие этапы предусмотрены предметом закупки.',
        },
        {
          label: '3.2',
          value: 'До начала оказания услуг Исполнитель обязан представить Заказчику календарный план, перечень задействованных специалистов, ответственных лиц и состав применяемых ресурсов (при необходимости).',
        },
        {
          label: '3.3',
          value: 'При оказании услуг на территории Заказчика Исполнитель обязан соблюдать пропускной режим, требования охраны труда, пожарной безопасности, информационной безопасности и внутренние регламенты Заказчика.',
        },
        {
          label: '3.4',
          value: 'Исполнитель обязан незамедлительно информировать Заказчика о рисках срыва сроков, выявленных препятствиях, необходимости согласований, а также о завершении каждого этапа оказания услуг.',
        },
      ]
    : [
        {
          label: '3.1',
          value: hasSW && !hasHW
            ? 'Пуско-наладочные работы включают установку программного обеспечения, передачу лицензий и первоначальную настройку в объёме, предусмотренном документацией производителя.'
            : 'Пуско-наладочные работы не требуются.',
        },
        ...(hasSW && !hasHW ? [{
          label: '3.2',
          value: 'Если в состав пуско-наладочных работ входит настройка сертифицированных средств защиты информации (СЗИ), Исполнитель обязан иметь действующую лицензию ФСТЭК России на деятельность по технической защите конфиденциальной информации (ТЗКИ) в соответствии с Постановлением Правительства РФ от 03.02.2012 № 79.',
        }] : []),
      ];

  const section4Rows: SectionTableRow[] = [];
  const pushSection4 = (value: string) => section4Rows.push({ label: `4.${section4Rows.length + 1}`, value });
  if (serviceOnly) {
    pushSection4('Исполнитель гарантирует надлежащее качество оказываемых услуг и соответствие результата оказания услуг требованиям настоящего Технического задания.');
    pushSection4('При выявлении недостатков Заказчик вправе предъявить мотивированные замечания, а Исполнитель обязан устранить недостатки за свой счёт в срок, установленный Заказчиком или договором.');
    pushSection4('Если по характеру услуги применим гарантийный срок на результат работ/услуг, такой срок должен составлять не менее 12 месяцев с даты подписания акта сдачи-приёмки, если иной срок не установлен предметом закупки.');
    pushSection4('Если результат услуг не соответствует требованиям Технического задания, Исполнитель обязан выполнить доработку, повторное оказание услуг и/или замену результата без дополнительной оплаты в сроки, согласованные с Заказчиком.');
    pushSection4('Исполнитель несёт ответственность за качество используемых материалов, документов, программных средств, методик и иных ресурсов, применяемых при оказании услуг, если такие ресурсы используются для достижения результата.');
  } else {
    if (hasHW) {
      pushSection4('Поставщик обязан предоставить Заказчику документы, подтверждающие гарантийные обязательства производителя Товара (гарантийные карты), составленные на все единицы поставляемого Товара, на срок не менее 12 (двенадцати) месяцев, если иной срок не указан в Спецификации. Гарантийная карта направляется в электронном виде посредством электронной почты и/или на бумажном носителе при поставке. Гарантийное обслуживание осуществляется на территории Российской Федерации в авторизованных сервисных центрах производителя или силами Поставщика.');
      pushSection4('Поставщик обязан предоставить Заказчику копии сертификата(-ов) или декларации(-й) о соответствии, подтверждающих соответствие Товара требованиям технических регламентов Таможенного союза.');
    }
    if (hasSW) {
      pushSection4('Поставщик обязан предоставить лицензионный договор (сублицензионное соглашение), регистрационные документы с указанием номера реестровой записи в Едином реестре российских программ, а также право на получение обновлений и технической поддержки в объёме поставки.');
    }
    pushSection4('Поставщик в срок не позднее 5 (пяти) рабочих дней после фактической поставки Товара (исполнения обязательств) представляет Заказчику Документ о приёмке в электронной форме, подписанный усиленной квалифицированной электронной подписью (УКЭП) лица, имеющего право действовать от имени Поставщика, и размещает его в единой информационной системе в сфере закупок (ЕИС).');
    pushSection4('Не позднее 20 (двадцати) рабочих дней после получения Документа о приёмке Заказчик рассматривает результаты и подписывает УКЭП и размещает в ЕИС Документ о приёмке либо формирует и размещает в ЕИС мотивированный отказ с указанием причин. Для проверки соответствия поставленного Товара условиям Контракта Заказчик проводит экспертизу своими силами или с привлечением экспертов.');
    pushSection4('В течение срока гарантии Поставщик гарантирует надлежащее качество Товара. В случае обнаружения дефектов Поставщик обязан в течение 15 (пятнадцати) рабочих дней с момента получения уведомления устранить неисправность или произвести замену Товара аналогичными характеристиками или выше. Все мероприятия гарантийного обслуживания (доставка, погрузка, разгрузка) осуществляются силами и за счёт Поставщика.');
    pushSection4('Если Поставщик не устраняет недостатки в установленные сроки, Заказчик вправе произвести замену Товара и устранить недостатки силами третьих лиц за счёт Поставщика.');
    if (hasHW) {
      pushSection4(`Дата выпуска поставляемого Товара должна быть не ранее 1 января ${currentYear} г. Актуальность версии подтверждается серийным номером или сопроводительными документами производителя.`);
    }
  }

  const section5Rows: SectionTableRow[] = [];
  const pushSection5 = (value: string) => section5Rows.push({ label: `5.${section5Rows.length + 1}`, value });
  if (serviceOnly) {
    [
      'По завершении оказания услуг Исполнитель обязан представить Заказчику отчётные материалы, предусмотренные Техническим заданием, а также акт сдачи-приёмки оказанных услуг.',
      'Заказчик вправе проводить проверку полноты, качества, сроков и результата оказания услуг, включая выборочный контроль документов и фактически выполненных действий.',
      'Услуги считаются оказанными после подписания Заказчиком акта сдачи-приёмки при отсутствии замечаний либо после устранения замечаний Исполнителем.',
      'В случае выявления замечаний Заказчик направляет Исполнителю мотивированный перечень замечаний, а Исполнитель обязан устранить их и повторно представить результат оказания услуг в согласованный срок.',
      'Отчётные материалы должны содержать сведения о фактически выполненных действиях, достигнутом результате, датах, объёмах, применённых решениях и подтверждающих документах в зависимости от характера услуг.',
    ].forEach(pushSection5);
  } else if (hasHW) {
    [
      'Поставщик обязан поставить Товар в таре и упаковке, обеспечивающей его сохранность, товарный вид и предохраняющей от повреждений при транспортировке.',
      'Товар должен быть упакован и маркирован в соответствии с технической (эксплуатационной) документацией производителя. Вся маркировка должна быть нанесена способом, обеспечивающим чёткость и сохранность надписей в течение всего срока эксплуатации.',
      'Упаковка должна обеспечивать защиту от воздействия механических и климатических факторов во время транспортирования и хранения поставляемого Товара.',
      'Упаковка должна исключать перемещение Товара в таре при доставке (отгрузке), а также способна предотвратить его повреждение или порчу.',
      'Эксплуатационная документация (при её наличии) должна быть вложена в потребительскую тару или транспортную тару вместе с Товаром.',
    ].forEach(pushSection5);
  } else {
    [
      'Поставка программного обеспечения осуществляется в электронной форме, если иное не предусмотрено документацией производителя и условиями поставки.',
      'Поставщик обязан передать дистрибутивы, ключи активации, лицензионные документы, сертификаты технической поддержки и эксплуатационную документацию в составе, достаточном для ввода ПО в эксплуатацию.',
    ].forEach(pushSection5);
  }

  const section6Rows: SectionTableRow[] = [];
  const pushSection6 = (value: string) => section6Rows.push({ label: `6.${section6Rows.length + 1}`, value });
  if (serviceOnly) {
    pushSection6('Место оказания услуг: _______________________________________________');
    pushSection6(`Срок оказания услуг: не более 60 (шестидесяти) календарных дней с даты заключения ${contractWord}, если иные этапы и сроки не определены в Спецификации.`);
    pushSection6('Исполнитель обязан согласовать с Заказчиком график оказания услуг, состав ответственных лиц, окна проведения работ и порядок допуска на объект не позднее чем за 2 (два) рабочих дня до начала оказания услуг.');
    pushSection6('Оказание услуг осуществляется в рабочее время Заказчика, если иное не предусмотрено предметом закупки, локальными регламентами Заказчика или согласованным календарным планом.');
    pushSection6('Если услуги оказываются дистанционно и/или на территории Исполнителя, порядок удалённого взаимодействия, состав передаваемых материалов, каналы связи и сроки предоставления доступа определяются Техническим заданием и календарным планом.');
    pushSection6('При необходимости доступа к объектам, информационным системам, оборудованию или документам Заказчика Исполнитель обязан использовать доступ исключительно для целей оказания услуг и соблюдать требования конфиденциальности и защиты информации.');
  } else {
    const deliveryAddrDisplay = deliveryAddress || legalAddress || '_______________________________________________';
    pushSection6(`Место доставки Товара: ${deliveryAddrDisplay}`);
    if (hasSW && hasHW) {
      pushSection6(`Передача неисключительных прав (электронных лицензий) — в течение 10 (десяти) рабочих дней с даты заключения ${contractWord}.`);
      pushSection6(`Выполнение пуско-наладочных работ — в течение ${deliveryDays} (${numText(deliveryDays)}) рабочих дней с даты передачи лицензий.`);
    } else if (hasSW) {
      pushSection6(`Передача неисключительных прав (электронных лицензий) — в течение 10 (десяти) рабочих дней с даты заключения ${contractWord}.`);
      pushSection6(`Выполнение пуско-наладочных работ (при наличии) — в течение ${deliveryDays} (${numText(deliveryDays)}) рабочих дней с даты передачи лицензий.`);
    } else {
      pushSection6(`Срок поставки Товара: не более ${deliveryDays} (${numText(deliveryDays)}) календарных дней с даты заключения ${contractWord}.`);
    }
    pushSection6('Поставщик обязан согласовать с Заказчиком (представителем Заказчика) дату и время поставки Товара не позднее чем за 2 (два) рабочих дня до даты поставки.');
    pushSection6('Поставка осуществляется в рабочее время Заказчика (понедельник–четверг с 08:00 до 17:00, пятница с 08:00 до 15:30 по московскому времени, исключение — выходные и праздничные дни). Поставщик за счёт собственных средств осуществляет доставку, разгрузку и подъём Товара до места эксплуатации.');
  }
  const section3Title = serviceOnly ? '3. Требования к порядку оказания услуг' : '3. Требования к пуско-наладочным работам';
  const section4Title = serviceOnly ? '4. Требования к качеству услуг и гарантийным обязательствам' : '4. Требования к сроку предоставления гарантии качества';
  const section5Title = serviceOnly ? '5. Требования к порядку сдачи-приемки и отчетности' : '5. Требования к таре и упаковке товара';
  const section6Title = serviceOnly ? '6. Место, сроки и условия оказания услуг' : '6. Место, сроки и условия поставки товара';
  const section7Title = '7. Перечень нормативных правовых актов';

  const section7Rows: SectionTableRow[] = [];
  const pushSection7 = (value: string) => section7Rows.push({ label: `7.${section7Rows.length + 1}`, value });

  const is223final = lawMode === '223';
  if (!serviceOnly) {
    if (is223final) {
      pushSection7('Федеральный закон от 18.07.2011 № 223-ФЗ «О закупках товаров, работ, услуг отдельными видами юридических лиц»');
    } else {
      pushSection7('Федеральный закон от 05.04.2013 № 44-ФЗ «О контрактной системе в сфере закупок товаров, работ, услуг для обеспечения государственных и муниципальных нужд»');
    }
    pushSection7('Постановление Правительства РФ от 23.12.2024 № 1875 «О мерах по обеспечению приоритетного использования российских товаров, работ и услуг»');
    if (hasHW) {
      pushSection7('Технический регламент Таможенного союза «О безопасности низковольтного оборудования» (ТР ТС 004/2011)');
      pushSection7('Технический регламент Таможенного союза «Электромагнитная совместимость технических средств» (ТР ТС 020/2011)');
    }
    if (regimes.has('pp878') || hasHW) {
      pushSection7('Постановление Правительства РФ от 17.07.2015 № 719 «О подтверждении производства промышленной продукции на территории Российской Федерации»');
      pushSection7('Решение Совета Евразийской экономической комиссии от 23.11.2020 № 105 «О Перечне радиоэлектронной продукции, происходящей из иностранных государств, в отношении которой устанавливаются ограничения допуска для целей осуществления закупок»');
    }
    if (regimes.has('pp1236') || hasSW) {
      pushSection7('Постановление Правительства РФ от 16.11.2015 № 1236 «Об установлении запрета на допуск программного обеспечения, происходящего из иностранных государств, для целей осуществления закупок»');
    }
    if (hasHW) {
      pushSection7('Постановление Правительства РФ от 31.12.2020 № 2463 «Об утверждении правил продажи товаров по договору розничной купли-продажи» (в части требований к сопроводительной документации)');
      pushSection7('Постановление Правительства РФ от 26.09.1994 № 1090 и иные акты об энергетической эффективности товаров (в части требования к классу энергетической эффективности не ниже «А»)');
      pushSection7('ГОСТ Р 55062-2012 «Информационные технологии. Системы промышленной автоматизации и интеграция. Совместимость оборудования» (при применимости)');
      pushSection7('ГОСТ 12.2.007.0-75 «Изделия электротехнические. Общие требования безопасности»');
      pushSection7('ГОСТ Р 51318.22-2006 / ГОСТ Р 51317.3.2-2006 «Требования электромагнитной совместимости технических средств»');
    }
    if (!is223final) {
      pushSection7('Приказ Министерства финансов Российской Федерации от 04.06.2018 № 126н «Об условиях допуска товаров, происходящих из иностранного государства или группы иностранных государств, для целей осуществления закупок»');
    }
    pushSection7('Федеральный закон от 06.04.2011 № 63-ФЗ «Об электронной подписи» (в части требований к применению УКЭП при оформлении Документа о приёмке в ЕИС)');
    if (!is223final) {
      pushSection7('Решение Федеральной антимонопольной службы России (ФАС) и правоприменительная практика в части требований к описанию объекта закупки (ст. 33 44-ФЗ): запрет на ограничение конкуренции, обязательное указание «или эквивалент» при ссылке на товарный знак');
    }
  } else {
    if (is223final) {
      pushSection7('Федеральный закон от 18.07.2011 № 223-ФЗ «О закупках товаров, работ, услуг отдельными видами юридических лиц»');
    } else {
      pushSection7('Федеральный закон от 05.04.2013 № 44-ФЗ «О контрактной системе в сфере закупок товаров, работ, услуг для обеспечения государственных и муниципальных нужд»');
    }
    pushSection7('Постановление Правительства РФ от 23.12.2024 № 1875 «О мерах по обеспечению приоритетного использования российских товаров, работ и услуг» (при применимости к закупаемым услугам)');
    pushSection7('Федеральный закон от 06.04.2011 № 63-ФЗ «Об электронной подписи» (в части требований к применению УКЭП при оформлении Документа о приёмке)');
  }

  return {
    currentYear,
    contractWord,
    objectName,
    introText,
    multi,
    hasHW,
    hasSW,
    hasService,
    serviceOnly,
    astraBundle,
    regimes,
    showCommercialTerms,
    section3Title,
    section4Title,
    section5Title,
    section6Title,
    section7Title,
    approvalPersonName: ps?.approvalPersonName?.trim() ?? '',
    approvalPersonTitle: ps?.approvalPersonTitle?.trim() ?? '',
    approvalOrgName: ps?.orgNameShort?.trim() || ps?.orgName?.trim() || '',
    section1Rows,
    readinessSummaryRows,
    legalSummaryRows,
    section2Rows,
    section3Rows,
    section4Rows,
    section5Rows,
    section6Rows,
    section7Rows,
    publicationDossierRows,
    publicationDossierSummary,
  };
}

function isUniversalGoodsType(type: string): boolean {
  return type === 'otherGoods' || type === 'otherService';
}

function isUniversalServiceType(type: string): boolean {
  return type === 'otherService';
}

function normalizeResolvedMeta(rowType: string, meta: Record<string, string> = {}): Record<string, string> {
  const next = { ...meta };
  if (!String(next.classification_source || '').trim()) {
    next.classification_source = isUniversalGoodsType(rowType) ? 'ai' : 'catalog';
  }
  if (isUniversalGoodsType(rowType)) {
    if (!['pp878', 'pp1236', 'pp616', 'none'].includes(String(next.nac_regime || ''))) {
      next.nac_regime = 'none';
    }
    if (next.okpd2_code === '00.00.00.000') delete next.okpd2_code;
    if (next.okpd2_name === 'ОКПД2 определяется автоматически по описанию товара') delete next.okpd2_name;
    if (next.okpd2_name === 'ОКПД2 услуги определяется автоматически по описанию') delete next.okpd2_name;
    if (next.ktru_code === '00.00.00.000') delete next.ktru_code;
    const normalizedStatus = normalizeLaw175StatusValue(next.law175_status || '');
    const derivedStatus = deriveLaw175StatusFromRegime(next.nac_regime || 'none');
    const providedBasis = normalizeLaw175BasisText(next.law175_basis || '');
    next.law175_status = normalizedStatus === 'exception' && !providedBasis && derivedStatus !== 'none'
      ? derivedStatus
      : (normalizedStatus || derivedStatus);
    if (!providedBasis || isPlaceholderLaw175Basis(providedBasis)) {
      next.law175_basis = deriveLaw175BasisText(rowType, next);
      next.law175_basis_auto = '1';
    } else {
      next.law175_basis = providedBasis;
      delete next.law175_basis_auto;
    }
    return next;
  }

  const catalogEntry = lookupCatalog(rowType);
  const correctRegime = getUnifiedNacRegime(rowType);
  if (!next.nac_regime || next.nac_regime !== correctRegime) {
    next.nac_regime = correctRegime;
  }
  if (catalogEntry?.okpd2) {
    next.okpd2_code = catalogEntry.okpd2;
    if (catalogEntry.okpd2name) next.okpd2_name = catalogEntry.okpd2name;
  }
  if (catalogEntry?.ktruFixed && !next.ktru_code) {
    next.ktru_code = catalogEntry.ktruFixed;
  }
  const normalizedStatus = normalizeLaw175StatusValue(next.law175_status || '');
  const derivedStatus = deriveLaw175StatusFromRegime(next.nac_regime || correctRegime);
  next.law175_status = (!normalizedStatus || (normalizedStatus === 'exception' && !String(next.law175_basis || '').trim() && derivedStatus !== 'none'))
    ? derivedStatus
    : normalizedStatus;
  const providedBasis = normalizeLaw175BasisText(next.law175_basis || '');
  if (!providedBasis || isPlaceholderLaw175Basis(providedBasis)) {
    next.law175_basis = deriveLaw175BasisText(rowType, next);
    next.law175_basis_auto = '1';
  } else {
    next.law175_basis = providedBasis;
    delete next.law175_basis_auto;
  }
  return next;
}

function buildSearchSpecsContext(specs: SpecFromSearch[]): string {
  return specs
    .slice(0, 40)
    .map((spec, idx) => {
      const unit = spec.unit && spec.unit !== '—' ? ` (${spec.unit})` : '';
      return `${idx + 1}. ${spec.name}: ${spec.value}${unit}`;
    })
    .join('\n')
    .slice(0, 4000);
}

function buildUniversalSearchPrompt(
  row: GoodsRow,
  sourceLabel: string,
  contextText = '',
  platformSettings?: PlatformIntegrationSettings
): string {
  const trimmedContext = contextText.trim().slice(0, 5000);
  const contextBlock = trimmedContext
    ? `\nКонтекст найденных характеристик (${sourceLabel}):\n---\n${trimmedContext}\n---\n`
    : `\nКонтекст ${sourceLabel} недоступен. Используй описание товара и отраслевые знания о типичных характеристиках этого класса изделий.\n`;
  const importedBlock = buildImportedSpecsPromptBlock(row);
  const organizationBlock = buildOrganizationMemoryPromptBlock(platformSettings, isUniversalServiceType(row.type));
  const commercial = getResolvedCommercialContext(row);
  const minSpecs = getMinimumSpecCount(row, commercial);
  if (isUniversalServiceType(row.type)) {
    const law175Example = getResolvedLaw175Meta(row.type, { nac_regime: 'none' });
    return `Ты — эксперт по государственным закупкам услуг в РФ. Сформируй детализированные, проверяемые требования к услуге.
${contextBlock}
Предмет закупки: ${row.model}
Количество / объем: ${row.qty}
${commercial.suggestedTerm ? `Срок / период оказания услуг: ${commercial.suggestedTerm}\n` : ''}${commercial.suggestedLicenseType ? `Тип услуги / формат сопровождения: ${commercial.suggestedLicenseType}\n` : ''}
${importedBlock}
${organizationBlock}

Определи и верни:
1. Код ОКПД2 услуги
2. Полное наименование ОКПД2
3. Код КТРУ, если применимо
4. Национальный режим по ПП РФ № 1875 (обычно "none" для услуг, но если требуется исключение/особый режим — укажи явно)
5. Не менее ${minSpecs} требований к услуге: состав, объем, этапы, сроки, SLA, место оказания, требования к результату, квалификации исполнителя, отчетности, приемке, безопасности и совместимости

Правила для meta:
- Не оставляй поле law175_basis пустым.
- Если law175_status = none, кратко объясни, почему мера ПП РФ № 1875 по позиции не применяется.
- Если law175_status = exception, укажи только документированное основание исключения.

Ответ строго в JSON:
{
  "meta": {
    "okpd2_code": "XX.XX.XX.XXX",
    "okpd2_name": "Наименование услуги по ОКПД2",
    "ktru_code": "",
    "nac_regime": "none",
    "law175_status": "${law175Example.status}",
    "law175_basis": "${law175Example.promptBasis}"
  },
  "specs": [
    {"group":"Общие требования","name":"Состав услуг","value":"конкретный перечень действий и результата","unit":"—"},
    {"group":"Сроки и SLA","name":"Время реакции","value":"не более 4","unit":"ч"},
    {"group":"Приемка","name":"Подтверждение результата","value":"акт оказанных услуг и отчетные материалы","unit":"—"}
  ]
}`;
  }
  const explicitCommercialTermsBlock = [
    commercial.suggestedLicenseType ? `- Тип лицензии / сертификата: ${commercial.suggestedLicenseType}` : '',
    commercial.suggestedTerm ? `- Срок действия / технической поддержки: ${commercial.suggestedTerm}` : '',
  ].filter(Boolean).join('\n');
  const law175Example = getResolvedLaw175Meta(row.type, { nac_regime: 'pp616' });

  return `Ты — ведущий эксперт по формированию технических заданий для государственных закупок РФ (44-ФЗ/223-ФЗ).
Товар отсутствует в каталоге типовых позиций. Нужно определить его класс, ОКПД2, применимый нацрежим и полный набор характеристик для ТЗ.

Исходное описание товара: "${row.model}"
Количество: ${row.qty} шт.
${explicitCommercialTermsBlock ? `Коммерческие параметры из заявки:\n${explicitCommercialTermsBlock}\n` : ''}${contextBlock}
${importedBlock}
${organizationBlock}
ТВОЯ ЗАДАЧА:
1. Определить тип товара и его назначение
2. Определить корректный ОКПД2 и полное наименование ОКПД2
3. Определить КТРУ (если применимо, иначе пустая строка)
4. Определить нацрежим: "pp878", "pp1236", "pp616" или "none"
5. Сформировать ПОДРОБНЫЙ перечень характеристик для ТЗ

ТРЕБОВАНИЯ К ХАРАКТЕРИСТИКАМ:
- Не менее ${minSpecs} характеристик
- Максимально детально, как в реальных ТЗ ЕИС
- Без торговых марок, производителей, артикулов и точных моделей
- Числовые значения через «не менее» / «не более»
- Поле "unit" заполнять всегда: мм, кг, Вт, шт, мес, тип, наличие, — и т.д.
- Если источник дал мало данных — дострой типовыми параметрами именно для этого класса товаров
- Не оставляй поле meta.law175_basis пустым: объясни выбранную меру ПП РФ № 1875 либо неприменимость меры; exception допустим только при документированном основании

Ответ СТРОГО в JSON без markdown и пояснений:
{
  "meta": {
    "okpd2_code": "XX.XX.XX.XXX",
    "okpd2_name": "Полное название ОКПД2",
    "ktru_code": "",
    "nac_regime": "pp616",
    "law175_status": "${law175Example.status}",
    "law175_basis": "${law175Example.promptBasis}"
  },
  "specs": [
    {"group":"Общие сведения","name":"Тип изделия","value":"конкретный тип товара","unit":"тип"},
    {"group":"Технические характеристики","name":"Ключевой параметр","value":"не менее 1","unit":"шт"}
  ]
}`;
}

function buildUniversalMetaPrompt(
  row: GoodsRow,
  contextText = '',
  platformSettings?: PlatformIntegrationSettings
): string {
  const isService = isUniversalServiceType(row.type);
  const trimmedContext = contextText.trim().slice(0, 4000);
  const contextBlock = trimmedContext
    ? `\nКонтекст для классификации:\n---\n${trimmedContext}\n---\n`
    : '';
  const importedBlock = buildImportedSpecsPromptBlock(row);
  const organizationBlock = buildOrganizationMemoryPromptBlock(platformSettings, isService);
  return `Ты — эксперт по классификации предметов закупки для РФ.
Нужно определить только метаданные позиции без генерации полного перечня характеристик.

Предмет закупки: ${row.model}
Тип позиции: ${isService ? 'услуга' : 'товар'}
Количество / объем: ${row.qty}
${contextBlock}${importedBlock}
${organizationBlock}
Верни строго один JSON:
{
  "meta": {
    "okpd2_code": "обязательный код ОКПД2",
    "okpd2_name": "обязательное полное наименование ОКПД2",
    "ktru_code": "код КТРУ или пустая строка",
    "nac_regime": "${isService ? 'none' : 'pp878|pp1236|pp616|none'}",
    "law175_status": "ban|restriction|preference|exception|none",
    "law175_basis": "краткое пояснение: запрет / ограничение / преимущество / исключение / не применяется"
  },
  "specs": []
}

Правила:
- Для Постановления Правительства РФ от 23.12.2024 № 1875 статус должен быть ОДНОЗНАЧНЫМ: запрет, ограничение, преимущество, исключение или не применяется.
- Для услуг по умолчанию укажи "nac_regime": "none" и "law175_status": "none", если нет специального основания.
- Не оставляй пустыми okpd2_code и okpd2_name.
- Не добавляй текст вне JSON.`;
}

// ── РАСШИРЕННЫЕ specHints (уровень детализации ЕИС) ──
// Для ПО: 25-50 параметров, для оборудования: 15-30 параметров
// Вынесены на уровень модуля для доступа из buildPrompt, buildSpecSearchPrompt и buildEisStylePrompt
const specHintsMap: Record<string, string> = {
    // ═══════ ОБОРУДОВАНИЕ ═══════
    pc: [
      '⚠️ ПРАВИЛА ДЛЯ ОФИСНОГО ПК В ГОСЗАКУПКЕ:',
      '  1. Форм-фактор: НЕ фиксировать как конкретный тип (не пишем только "SFF" или только "Tower").',
      '     Писать: "Tower или компактный (SFF/USFF) — на усмотрение поставщика" или вообще не указывать.',
      '  2. Wi-Fi и Bluetooth: НЕ включать по умолчанию (требования ИБ в госорганах часто запрещают).',
      '     Включать ТОЛЬКО если заказчик явно указал необходимость беспроводного подключения.',
      '  3. Сетевой интерфейс для офисного ПК: Ethernet RJ-45, 1000 Мбит/с — достаточно.',
      '',
      '- Корпус (тип: Tower / SFF / USFF — на усмотрение поставщика; цвет, материал)',
      '- Процессор (тип, кол-во ядер, кол-во потоков, базовая частота, турбо-частота, кэш L3, TDP)',
      '- Оперативная память (тип DDR4 или выше, объём, частота, кол-во модулей, макс. объём, кол-во слотов)',
      '- Накопитель (тип SSD/HDD, интерфейс SATA/NVMe, объём, форм-фактор)',
      '- Видеокарта (тип: интегрированная/дискретная, видеопамять, поддержка мониторов)',
      '- Интерфейсы передней панели (USB 2.0, USB 3.2, аудио 3.5мм)',
      '- Интерфейсы задней панели (USB 2.0, USB 3.2, HDMI, DisplayPort, аудио)',
      '- Сетевые интерфейсы (Ethernet RJ-45, скорость не менее 1000 Мбит/с)',
      '- Слоты расширения (PCI Express x16, PCI Express x1)',
      '- Внутренние отсеки (3.5\", 2.5\", M.2)',
      '- Блок питания (мощность, сертификат 80 PLUS)',
      '- Клавиатура в комплекте (тип, интерфейс)',
      '- Мышь в комплекте (тип, интерфейс)',
      '- Предустановленная ОС (наличие, тип)',
      '- Совместимость с отечественными ОС (или эквивалентными)',
      '- Потребляемая мощность (не более, Вт)',
      '- Уровень шума (не более, дБА)',
      '- Габаритные размеры (ШxВxГ, мм)',
      '- Масса (не более, кг)',
      '- Гарантия производителя (мес)',
    ].join('\n'),

    laptop: [
      '- Экран: диагональ (дюймы)',
      '- Экран: разрешение (не менее)',
      '- Экран: тип матрицы (IPS или эквивалент)',
      '- Экран: яркость (не менее, кд/м²)',
      '- Экран: покрытие (антибликовое/глянцевое)',
      '- Процессор (тип, кол-во ядер, кол-во потоков, частота, кэш L3, TDP)',
      '- Оперативная память (тип, объём, частота, макс. объём, кол-во слотов, возможность расширения)',
      '- Накопитель (тип SSD NVMe, объём, интерфейс)',
      '- Видеокарта (тип: интегрированная/дискретная, видеопамять)',
      '- Аккумулятор (ёмкость, Вт·ч)',
      '- Время автономной работы (не менее, час, в режиме офисной работы)',
      '- Клавиатура (тип, подсветка, цифровой блок)',
      '- Тачпад (тип, мультитач)',
      '- Веб-камера (разрешение, шторка конфиденциальности)',
      '- Микрофон (встроенный, шумоподавление)',
      '- Динамики (встроенные, кол-во)',
      '- Интерфейсы (USB 3.2, USB Type-C, HDMI, аудио 3.5мм, картридер)',
      '- Сетевые интерфейсы (Ethernet RJ-45, Wi-Fi стандарт, Bluetooth версия)',
      '- Совместимость с отечественными ОС (или эквивалентными)',
      '- Предустановленная ОС',
      '- Замок безопасности (Kensington или эквивалент)',
      '- Сканер отпечатков пальцев',
      '- Масса (не более, кг)',
      '- Габаритные размеры (ШxГxВ, мм)',
      '- Зарядное устройство (мощность, тип разъёма)',
      '- Гарантия производителя (мес)',
    ].join('\n'),

    monoblock: [
      '- Экран: диагональ (дюймы)',
      '- Экран: разрешение (не менее)',
      '- Экран: тип матрицы (IPS или эквивалент)',
      '- Экран: яркость (не менее, кд/м²)',
      '- Экран: сенсорный (при наличии)',
      '- Процессор (тип, кол-во ядер, частота, кэш L3)',
      '- Оперативная память (тип, объём, частота, макс. объём)',
      '- Накопитель (тип SSD, объём, интерфейс)',
      '- Видеокарта (тип, видеопамять)',
      '- Веб-камера (разрешение)',
      '- Микрофон встроенный',
      '- Динамики встроенные (мощность)',
      '- Интерфейсы (USB 2.0, USB 3.2, USB Type-C, HDMI, DisplayPort, аудио)',
      '- Сетевые интерфейсы (Ethernet, Wi-Fi, Bluetooth)',
      '- Крепление VESA',
      '- Регулировка наклона',
      '- Совместимость с отечественными ОС (или эквивалентными)',
      '- Предустановленная ОС',
      '- Клавиатура и мышь в комплекте',
      '- Потребляемая мощность (не более, Вт)',
      '- Габариты (ШxВxГ, мм), масса (не более, кг)',
    ].join('\n'),

    tablet: [
      '- Экран: диагональ (дюймы)',
      '- Экран: разрешение (не менее)',
      '- Экран: тип матрицы (IPS или эквивалент)',
      '- Экран: сенсорный ёмкостный, мультитач',
      '- Экран: яркость (не менее, кд/м²)',
      '- Экран: защитное стекло',
      '- Процессор (тип, кол-во ядер, частота)',
      '- Оперативная память (объём)',
      '- Встроенная память (объём)',
      '- Поддержка карт памяти (тип, макс. объём)',
      '- Камера основная (разрешение, Мп)',
      '- Камера фронтальная (разрешение, Мп)',
      '- Аккумулятор (ёмкость, мА·ч)',
      '- Время автономной работы (не менее, час)',
      '- Беспроводные интерфейсы (Wi-Fi, Bluetooth, LTE/5G, NFC)',
      '- Навигация (ГЛОНАСС, GPS)',
      '- Интерфейсы (USB Type-C, аудио)',
      '- Датчики (акселерометр, гироскоп, компас, освещённости)',
      '- ОС',
      '- Совместимость с отечественными ОС (или эквивалентными)',
      '- Поддержка стилуса',
      '- Масса (не более, г)',
      '- Габариты (мм)',
      '- Защита (IP-рейтинг)',
    ].join('\n'),

    thinClient: [
      '- Процессор (тип, кол-во ядер, частота)',
      '- Оперативная память (тип, объём, макс. объём)',
      '- Встроенный накопитель (тип, объём)',
      '- Видеовыходы (HDMI, DisplayPort, VGA, кол-во подключаемых мониторов)',
      '- Сетевые интерфейсы (Ethernet RJ-45, скорость, Wi-Fi, Bluetooth)',
      '- USB-порты (тип, кол-во)',
      '- Аудио (выход, микрофон)',
      '- Поддерживаемые протоколы удалённого доступа (RDP, ICA, PCoIP, SPICE, Blast или эквивалент)',
      '- ОС',
      '- Совместимость с отечественными ОС (или эквивалентными)',
      '- Поддержка VDI-платформ',
      '- Средства безопасности (TPM, Kensington или эквивалент)',
      '- Монтаж (VESA, на мониторе)',
      '- Потребляемая мощность (не более, Вт)',
      '- Уровень шума (не более, дБА)',
      '- Габариты (мм), масса (не более, кг)',
    ].join('\n'),

    server: [
      '- Форм-фактор (Tower/Rack 1U/2U/4U)',
      '- Процессор (тип, кол-во сокетов, кол-во ядер на процессор, частота, кэш L3, TDP)',
      '- Макс. кол-во процессоров',
      '- Оперативная память (тип, объём установленной, кол-во слотов DIMM, макс. объём)',
      '- Частота ОП (МГц), поддержка ECC/RDIMM/LRDIMM',
      '- Накопители (тип HDD/SSD, форм-фактор 2.5"/3.5", интерфейс SAS/SATA/NVMe)',
      '- Кол-во дисковых отсеков, поддержка горячей замены',
      '- Макс. объём дисковой подсистемы',
      '- RAID-контроллер (поддерживаемые уровни RAID, кэш)',
      '- Сетевые интерфейсы (кол-во портов Ethernet, скорость 1/10/25 Гбит/с)',
      '- Слоты расширения PCIe (тип, кол-во)',
      '- Блок питания (мощность, резервирование N+1, сертификат 80 PLUS)',
      '- Управление (IPMI/BMC, удалённая консоль, виртуальные носители)',
      '- Вентиляция (кол-во вентиляторов, горячая замена)',
      '- Поддерживаемые ОС',
      '- Совместимость с отечественными ОС (или эквивалентными)',
      '- Рельсы для монтажа в стойку (в комплекте)',
      '- Габариты (ШxГxВ, мм), масса (не более, кг)',
      '- Потребляемая мощность (не более, Вт)',
      '- Гарантия производителя (мес)',
    ].join('\n'),

    monitor: [
      '⚠️ ОФИСНЫЙ СТАНДАРТ ДЛЯ ГОСЗАКУПКИ (использовать если заказчик не указал «профессиональный», «для дизайна/CAD» или конкретную дорогую модель):',
      '  Диагональ: не менее 21.5 дюйма | Разрешение: не менее 1920×1080 (Full HD) | Матрица: IPS, VA или эквивалент | Яркость: не менее 250 кд/м² | Частота: не менее 60 Гц | Видеовход: не менее 1 порта HDMI версии не ниже 1.4 | Регулировка наклона от −5° до +20°',
      '  НЕ включать по умолчанию: Pivot (портретный режим), USB-C, FreeSync/G-Sync, USB-хаб — только если явно запрошено.',
      '',
      '- Диагональ экрана (не менее, дюймы)',
      '- Разрешение (не менее, пикс., например 1920×1080)',
      '- Тип матрицы (IPS, VA или эквивалентная технология; угол обзора не менее 178°)',
      '- Яркость (не менее, кд/м²)',
      '- Контрастность статическая (не менее)',
      '- Время отклика GtG (не более, мс)',
      '- Частота обновления (не менее, Гц)',
      '- Видеовходы (тип, количество, версия; например: HDMI 1.4 — не менее 1 шт.)',
      '- Регулировка наклона (диапазон, градусов)',
      '- VESA крепление (размер, при наличии)',
      '- Технология защиты зрения (Flicker-free, Low Blue Light или эквивалент)',
      '- Потребляемая мощность (не более, Вт)',
      '- Габариты с подставкой (ШxВxГ, мм)',
      '- Масса с подставкой (не более, кг)',
      '- Кабели в комплекте',
    ].join('\n'),

    printer: [
      '- Тип печати (лазерный/светодиодный/струйный)',
      '- Цветность (монохромный/цветной)',
      '- Формат бумаги (A4/A3)',
      '- Скорость печати ч/б (не менее, стр/мин)',
      '- Скорость печати цветная (не менее, стр/мин, при цветной)',
      '- Разрешение печати (не менее, dpi)',
      '- Время выхода первой страницы (не более, с)',
      '- Ресурс стартового картриджа (стр)',
      '- Ресурс полноразмерного картриджа (стр)',
      '- Лоток подачи основной (ёмкость, листов)',
      '- Лоток подачи обходной/многоцелевой (ёмкость)',
      '- Выходной лоток (ёмкость, листов)',
      '- Двусторонняя печать (автоматическая)',
      '- Плотность бумаги (диапазон, г/м²)',
      '- Интерфейсы (USB, Ethernet, Wi-Fi)',
      '- Мобильная печать (AirPrint, Mopria или эквивалент)',
      '- Рекомендуемая месячная нагрузка (стр/мес)',
      '- Максимальная месячная нагрузка (стр/мес)',
      '- Процессор (частота), ОЗУ (объём)',
      '- Уровень шума (не более, дБА)',
      '- Потребляемая мощность (не более, Вт)',
      '- Габариты (ШxГxВ, мм), масса (не более, кг)',
    ].join('\n'),

    mfu: [
      '- Функции (печать, копирование, сканирование, факс)',
      '- Тип печати (лазерный/светодиодный)',
      '- Цветность',
      '- Формат бумаги (A4/A3)',
      '- Скорость печати ч/б (не менее, стр/мин)',
      '- Скорость печати цветная (не менее, стр/мин)',
      '- Разрешение печати (не менее, dpi)',
      '- Разрешение сканирования (не менее, dpi)',
      '- Скорость сканирования (стр/мин)',
      '- Время выхода первой страницы (не более, с)',
      '- Устройство автоподачи документов ADF (ёмкость, листов)',
      '- Двусторонняя автоподача (RADF)',
      '- Двусторонняя печать (автоматическая)',
      '- Лоток подачи основной (ёмкость, листов)',
      '- Лоток подачи обходной (ёмкость)',
      '- Выходной лоток (ёмкость)',
      '- Плотность бумаги (диапазон, г/м²)',
      '- Панель управления (ЖК-дисплей, сенсорный)',
      '- Интерфейсы (USB, Ethernet, Wi-Fi)',
      '- Рекомендуемая месячная нагрузка (стр/мес)',
      '- Процессор (частота), ОЗУ (объём)',
      '- Уровень шума (не более, дБА)',
      '- Потребляемая мощность (не более, Вт)',
      '- Габариты (ШxГxВ, мм), масса (не более, кг)',
    ].join('\n'),

    scanner: [
      '- Тип сканера (планшетный/потоковый/документ-сканер)',
      '- Формат (A4/A3)',
      '- Оптическое разрешение (не менее, dpi)',
      '- Скорость сканирования односторонняя (не менее, стр/мин)',
      '- Скорость сканирования двусторонняя (не менее, стр/мин)',
      '- Устройство автоподачи ADF (ёмкость, листов)',
      '- Двусторонняя автоподача (RADF)',
      '- Режимы сканирования (ч/б, полутоновый, цветной)',
      '- Плотность оригиналов (диапазон, г/м²)',
      '- Интерфейсы (USB, Ethernet, Wi-Fi)',
      '- Поддерживаемые форматы (PDF, PDF/A, JPEG, TIFF, BMP)',
      '- Функция OCR (при наличии)',
      '- Суточная нагрузка (стр/день)',
      '- Потребляемая мощность (не более, Вт)',
      '- Габариты (мм), масса (не более, кг)',
    ].join('\n'),

    switch: [
      '- Кол-во портов Ethernet (тип, скорость: 100 Мбит/с, 1 Гбит/с, 10 Гбит/с)',
      '- Кол-во uplink-портов SFP/SFP+',
      '- Управляемость (управляемый L2/L3, неуправляемый)',
      '- Поддержка PoE/PoE+ (бюджет мощности, Вт)',
      '- Коммутационная матрица (не менее, Гбит/с)',
      '- Производительность пакетной коммутации (Mpps)',
      '- Таблица MAC-адресов (не менее, записей)',
      '- Количество VLAN (не менее)',
      '- Протоколы (802.1Q, STP/RSTP/MSTP, LACP, IGMP, SNMP v1/v2c/v3, QoS)',
      '- Списки доступа (ACL)',
      '- Стекирование (при наличии)',
      '- Консольный порт (RJ-45/USB)',
      '- Монтаж (rack 19\"/desktop)',
      '- Потребляемая мощность (не более, Вт)',
      '- Габариты (мм), масса (не более, кг)',
    ].join('\n'),

    router: [
      '- Кол-во WAN-портов (тип, скорость)',
      '- Кол-во LAN-портов (скорость)',
      '- SFP/SFP+ порты',
      '- Пропускная способность (не менее, Мбит/с)',
      '- Кол-во одновременных сессий (не менее)',
      '- Протоколы маршрутизации (OSPF, BGP, RIP, статическая)',
      '- NAT, DHCP-сервер, DNS relay',
      '- VPN (IPsec, L2TP, GRE, OpenVPN или эквивалент, кол-во туннелей)',
      '- Межсетевой экран (Stateful Firewall, ACL)',
      '- QoS (управление полосой пропускания)',
      '- Протоколы (VLAN, SNMP, NTP)',
      '- Процессор, оперативная память',
      '- Монтаж (rack 19\"/desktop)',
      '- Потребляемая мощность (не более, Вт)',
      '- Габариты (мм), масса (не более, кг)',
    ].join('\n'),

    firewall: [
      '- Пропускная способность межсетевого экрана (не менее, Гбит/с)',
      '- Пропускная способность IPS (не менее, Гбит/с)',
      '- Пропускная способность VPN (не менее, Гбит/с)',
      '- Кол-во портов Ethernet (тип, скорость)',
      '- SFP/SFP+ порты',
      '- Кол-во VPN-туннелей (не менее)',
      '- Кол-во одновременных сессий (не менее)',
      '- Новых сессий в секунду (не менее)',
      '- Функциональность (IPS/IDS, DPI, URL-фильтрация, антивирус, антиспам, контроль приложений)',
      '- Высокая доступность (Active-Passive, Active-Active)',
      '- Управление (веб-интерфейс, CLI, централизованное)',
      '- Журналирование и отчёты',
      '- Сертификат ФСТЭК (профиль защиты МЭ)',
      '- Монтаж (rack 19\")',
      '- Потребляемая мощность (не более, Вт)',
      '- Габариты (мм), масса (не более, кг)',
    ].join('\n'),

    accessPoint: [
      '- Стандарт Wi-Fi (Wi-Fi 5/6/6E или эквивалент)',
      '- Частотные диапазоны (2.4 ГГц, 5 ГГц, 6 ГГц)',
      '- Максимальная скорость передачи (не менее, Мбит/с по диапазонам)',
      '- Кол-во одновременных клиентов (не менее)',
      '- Антенны (тип, кол-во, коэффициент усиления, дБи)',
      '- Технологии (MU-MIMO, OFDMA, BSS Coloring или эквивалент)',
      '- Порты Ethernet (скорость)',
      '- Питание PoE (802.3af/at)',
      '- Безопасность (WPA3, WPA2, 802.1X, гостевой портал)',
      '- Управление (контроллерное/standalone/облачное)',
      '- Бесшовный роуминг (802.11r/k/v или эквивалент)',
      '- Монтаж (потолок/стена, крепёж в комплекте)',
      '- Класс защиты (IP)',
      '- Потребляемая мощность (не более, Вт)',
    ].join('\n'),

    ups: [
      '- Тип (линейно-интерактивный/онлайн с двойным преобразованием)',
      '- Мощность (не менее, ВА / Вт)',
      '- Входное напряжение (диапазон, В)',
      '- Выходное напряжение (В)',
      '- Форма выходного сигнала (чистая синусоида/ступенчатая)',
      '- Время автономной работы при 50% нагрузке (не менее, мин)',
      '- Время автономной работы при 100% нагрузке (не менее, мин)',
      '- Кол-во выходных розеток (тип IEC320 C13/C19/Schuko)',
      '- Защита от перегрузки и короткого замыкания',
      '- Интерфейсы управления (USB, RS-232, Ethernet/SNMP-карта)',
      '- Индикация (ЖК-дисплей, светодиоды)',
      '- Тип аккумулятора (свинцово-кислотный необслуживаемый)',
      '- Возможность замены аккумулятора (горячая замена)',
      '- Подключение дополнительных батарейных модулей',
      '- Форм-фактор (напольный/rack/универсальный)',
      '- Монтаж в стойку (при rack, высота U)',
      '- Габариты (ШxГxВ, мм), масса (не более, кг)',
    ].join('\n'),

    projector: [
      '- Технология (DLP/LCD/LCoS)',
      '- Яркость (не менее, лм)',
      '- Разрешение (не менее)',
      '- Контрастность (не менее)',
      '- Срок службы источника света (не менее, часов)',
      '- Проекционное отношение',
      '- Размер изображения (диагональ, диапазон)',
      '- Коррекция трапеции (вертикальная/горизонтальная)',
      '- Интерфейсы (HDMI, VGA, USB, аудио)',
      '- Встроенный динамик (мощность)',
      '- Уровень шума (не более, дБА)',
      '- Потребляемая мощность (не более, Вт)',
      '- Масса (не более, кг)',
    ].join('\n'),

    webcam: '- Разрешение видео (Full HD 1080p / 4K)\n- Частота кадров (не менее, fps)\n- Угол обзора (не менее, градусов)\n- Микрофон встроенный (наличие, шумоподавление)\n- Автофокус\n- Коррекция освещённости\n- Интерфейс (USB, версия)\n- Крепление (клипса для монитора / штатив, резьба 1/4\")\n- Длина кабеля (не менее, м)\n- Индикатор работы (светодиод)\n- Шторка конфиденциальности\n- Совместимость с ОС (или эквивалентными)\n- Совместимость с ВКС-платформами',
    headset: '- Тип (накладные/вкладыши/полноразмерные)\n- Подключение (USB/Jack 3.5 мм/Bluetooth)\n- Микрофон (тип: на штанге/встроенный, шумоподавление)\n- Частотный диапазон динамиков (Гц)\n- Импеданс (Ом)\n- Чувствительность (не менее, дБ)\n- Длина кабеля (не менее, м)\n- Регулировка громкости на кабеле/чашке\n- Кнопка отключения микрофона\n- Совместимость с UC-платформами (Microsoft Teams, Zoom или эквивалент)\n- Совместимость с ОС (или эквивалентными)\n- Масса (не более, г)',
    ssd:        '- Форм-фактор (2.5\"/M.2/U.2)\n- Интерфейс (SATA III/NVMe PCIe 3.0/4.0)\n- Объём (ГБ/ТБ)\n- Скорость последовательного чтения (не менее, МБ/с)\n- Скорость последовательной записи (не менее, МБ/с)\n- Скорость случайного чтения IOPS (не менее)\n- Скорость случайной записи IOPS (не менее)\n- Ресурс записи TBW (не менее)\n- MTBF (не менее, часов)\n- Рабочая температура (диапазон)',
    hdd:        '- Форм-фактор (3.5\"/2.5\")\n- Интерфейс (SATA III/SAS 12 Гбит/с)\n- Объём (ТБ)\n- Скорость вращения (об/мин)\n- Объём кэша (МБ)\n- Скорость передачи данных (не менее, МБ/с)\n- Назначение (серверный/NAS/десктопный)\n- MTBF (не менее, часов)\n- Уровень шума (не более, дБА)\n- Рабочая температура (диапазон)',
    ram:        '- Тип (DDR4 или выше/DDR5)\n- Форм-фактор (DIMM/SO-DIMM/RDIMM/LRDIMM)\n- Объём модуля (ГБ)\n- Частота (не менее, МГц)\n- Латентность (CL)\n- ECC (да/нет)\n- Напряжение (В)\n- Количество рангов\n- Радиатор охлаждения',
    nas: [
      '- Кол-во отсеков для дисков',
      '- Поддерживаемые диски (3.5\"/2.5\", HDD/SSD)',
      '- Горячая замена дисков',
      '- Процессор (кол-во ядер, частота)',
      '- Оперативная память (объём, макс. объём)',
      '- Сетевые интерфейсы (Ethernet, скорость, кол-во портов)',
      '- RAID (поддерживаемые уровни)',
      '- Протоколы (SMB/CIFS, NFS, iSCSI, AFP, FTP/SFTP)',
      '- USB-порты (тип, кол-во)',
      '- Шифрование данных (AES-256)',
      '- Потребляемая мощность (не более, Вт)',
      '- Уровень шума (не более, дБА)',
      '- Габариты (мм), масса (не более, кг)',
    ].join('\n'),

    san: [
      '- Форм-фактор (Rack, высота U)',
      '- Кол-во дисковых отсеков',
      '- Поддерживаемые накопители (HDD/SSD, интерфейс SAS/NL-SAS/NVMe)',
      '- Горячая замена накопителей',
      '- Контроллеры (кол-во, резервирование Active-Active)',
      '- Кэш контроллера (объём)',
      '- Интерфейсы подключения хостов (FC 16/32 Гбит/с, iSCSI 10/25 Гбит/с, SAS 12 Гбит/с)',
      '- RAID (поддерживаемые уровни)',
      '- Макс. сырой объём (ТБ)',
      '- Поддержка тонкого выделения (Thin Provisioning)',
      '- Поддержка снимков (Snapshots)',
      '- Поддержка репликации',
      '- Управление (веб-консоль, CLI)',
      '- Блок питания (резервирование)',
      '- Габариты (мм), масса (не более, кг)',
    ].join('\n'),

    // ═══════ ПРОГРАММНОЕ ОБЕСПЕЧЕНИЕ (РАСШИРЕННЫЕ ДЛЯ ЕИС) ═══════
    os: [
      '--- ГРУППА: Общие сведения ---',
      '- Тип ОС (десктопная/серверная)',
      '- Редакция / вариант поставки',
      '- Версия / номер релиза',
      '- Исполнение / уровень защищённости (например, «Воронеж» / «Смоленск» или эквивалент)',
      '- Поддерживаемые аппаратные платформы (x86_64, ARM, Эльбрус или эквивалент)',
      '- Тип ядра (монолитное/гибридное, версия ядра)',
      '- Разрядность (64-бит)',
      '--- ГРУППА: Файловые системы ---',
      '- Поддерживаемые файловые системы (ext4, XFS, Btrfs, NTFS, FAT32 или эквивалент)',
      '- Поддержка шифрования разделов на уровне ФС',
      '- Поддержка LVM (управление логическими томами)',
      '- Поддержка сетевых ФС (NFS, CIFS/SMB)',
      '--- ГРУППА: Графический интерфейс ---',
      '- Графическая оболочка (наличие, тип)',
      '- Оконный менеджер',
      '- Файловый менеджер с графическим интерфейсом',
      '- Поддержка нескольких мониторов',
      '- Поддержка экранов высокого разрешения (HiDPI)',
      '--- ГРУППА: Средства безопасности ---',
      '- Мандатный контроль доступа (MAC)',
      '- Дискреционный контроль доступа (DAC)',
      '- Контроль целостности исполняемых файлов и загрузки',
      '- Замкнутая программная среда',
      '- Маркировка документов по уровню конфиденциальности',
      '- Изоляция процессов и пользователей',
      '- Очистка оперативной памяти и временных данных при завершении защищённых сессий',
      '- Аудит событий безопасности (журналирование)',
      '- Встроенный межсетевой экран (netfilter/iptables или эквивалент)',
      '- Средства антивирусной защиты (интеграция или встроенные)',
      '--- ГРУППА: Сетевые возможности ---',
      '- Поддержка сетевых протоколов (TCP/IP, IPv4, IPv6)',
      '- Поддержка VPN (IPsec, OpenVPN, WireGuard или эквивалент)',
      '- Служба каталогов / доменный вход (FreeIPA, LDAP, Samba AD или эквивалент)',
      '- DHCP-клиент и сервер',
      '- DNS-клиент',
      '--- ГРУППА: Средства виртуализации ---',
      '- Поддержка виртуализации (KVM, QEMU или эквивалент)',
      '- Поддержка контейнеризации (LXC, Docker или эквивалент)',
      '--- ГРУППА: Средства администрирования ---',
      '- Безопасные протоколы администрирования и автоматизации',
      '- Система управления пакетами (dpkg/rpm/apt/dnf или эквивалент)',
      '- Средства централизованного обновления',
      '- Средства групповых политик (аналог GPO)',
      '- Резервное копирование (встроенные средства)',
      '--- ГРУППА: Совместимость ---',
      '- Совместимость с отечественными средствами электронной подписи и СКЗИ или эквивалентными решениями',
      '- Совместимость с офисными пакетами из реестра Минцифры',
      '- Совместимость с отечественными инфраструктурными сервисами по стандартным интерфейсам и API',
      '- Поддержка печати (CUPS, сетевая печать)',
      '- Поддержка сканирования (SANE или эквивалент)',
      '- Поддержка мультимедиа (аудио, видео)',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Сертификат ФСТЭК России (если применимо, номер/уровень)',
      '- Тип лицензии (бессрочная/подписка/OEM)',
      '- Количество лицензий',
      '- Срок технической поддержки (мес)',
      '- Носитель (дистрибутив: электронная поставка / физический носитель)',
      '- Документация (руководство пользователя, руководство администратора)',
    ].join('\n'),

    office: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия ПО',
      '- Тип поставки (коробочная / электронная лицензия)',
      '- Состав пакета (текстовый процессор, табличный процессор, средство подготовки презентаций, почтовый клиент)',
      '--- ГРУППА: Функциональные возможности текстового процессора ---',
      '- Создание и редактирование документов',
      '- Рецензирование (отслеживание изменений, комментарии)',
      '- Вставка таблиц, изображений, диаграмм',
      '- Оглавление, нумерация, колонтитулы, стили',
      '- Проверка правописания (русский, английский)',
      '--- ГРУППА: Функциональные возможности табличного процессора ---',
      '- Формулы и функции (не менее 300)',
      '- Диаграммы и графики',
      '- Сводные таблицы',
      '- Макросы и автоматизация',
      '- Условное форматирование, фильтрация, сортировка',
      '--- ГРУППА: Функциональные возможности средства подготовки презентаций ---',
      '- Создание слайдов с шаблонами',
      '- Анимация и переходы',
      '- Встраивание мультимедиа',
      '--- ГРУППА: Совместимость форматов ---',
      '- Поддержка форматов OOXML (.docx, .xlsx, .pptx)',
      '- Поддержка форматов ODF (.odt, .ods, .odp)',
      '- Экспорт в PDF',
      '- Совместимость с макросами VBA (при наличии)',
      '--- ГРУППА: Совместимость и интеграция ---',
      '- Поддерживаемые ОС (российские ОС из реестра Минцифры, или эквивалентные)',
      '- Режим совместной работы (одновременное редактирование документов)',
      '- Интеграция с облачным хранилищем',
      '- Интеграция со средствами электронной подписи и СКЗИ или эквивалентными решениями',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Тип лицензии (бессрочная/подписка)',
      '- Кол-во рабочих мест (лицензий)',
      '- Срок технической поддержки (мес)',
      '- Документация на русском языке',
    ].join('\n'),

    antivirus: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия ПО',
      '- Тип решения (для рабочих станций / серверов / комплексная защита)',
      '--- ГРУППА: Компоненты защиты рабочих станций ---',
      '- Файловый антивирус (проверка при доступе, on-demand)',
      '- Веб-антивирус (защита веб-трафика, HTTP/HTTPS)',
      '- Почтовый антивирус (проверка входящей/исходящей почты)',
      '- Проактивная защита / поведенческий анализ',
      '- Защита от шифровальщиков (антикриптор)',
      '- Защита от эксплойтов',
      '- Контроль устройств (USB, CD/DVD, принтеры)',
      '- Контроль приложений (белые/чёрные списки)',
      '- Веб-контроль (фильтрация URL-адресов по категориям)',
      '- Персональный межсетевой экран',
      '- Защита от сетевых атак (IDS/IPS на хосте)',
      '--- ГРУППА: Компоненты защиты серверов ---',
      '- Защита файловых серверов',
      '- Защита почтовых серверов (при наличии)',
      '- Защита серверов совместной работы (при наличии)',
      '--- ГРУППА: Централизованное управление ---',
      '- Консоль администратора (веб-консоль / приложение)',
      '- Централизованное развёртывание агентов',
      '- Централизованное обновление баз и модулей',
      '- Политики безопасности (создание, назначение по группам)',
      '- Мониторинг состояния защиты в реальном времени',
      '- Система отчётов и уведомлений',
      '- Интеграция со службой каталогов (AD, LDAP, FreeIPA или эквивалент)',
      '--- ГРУППА: Обновление и производительность ---',
      '- Автоматическое обновление антивирусных баз',
      '- Частота обновления баз',
      '- Возможность работы без подключения к Интернету (локальный сервер обновлений)',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые ОС рабочих станций (Windows, российские Linux-ОС или эквивалентные)',
      '- Поддерживаемые ОС серверов (Windows Server, Linux)',
      '- Поддерживаемые мобильные ОС (Android, iOS — при наличии)',
      '- Совместимость с системами виртуализации',
      '--- ГРУППА: Количественные параметры ---',
      '- Количество защищаемых рабочих станций (лицензий)',
      '- Количество защищаемых серверов (лицензий)',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Сертификат ФСТЭК России (номер, профиль защиты)',
      '- Тип лицензии (подписка / бессрочная)',
      '- Срок действия лицензии (мес)',
      '- Срок технической поддержки (мес)',
      '- Документация на русском языке',
    ].join('\n'),

    dbms: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия СУБД',
      '- Тип СУБД (реляционная, объектно-реляционная)',
      '- Совместимость с SQL-стандартом (SQL:2011/SQL:2016 или выше)',
      '- Совместимость с PostgreSQL (при наличии)',
      '--- ГРУППА: Функциональные возможности ---',
      '- Поддержка ACID-транзакций',
      '- Поддержка хранимых процедур и функций (PL/pgSQL, PL/Python или эквивалент)',
      '- Поддержка триггеров и представлений',
      '- Полнотекстовый поиск',
      '- Поддержка JSON/JSONB',
      '- Поддержка XML',
      '- Секционирование таблиц (Partitioning)',
      '- Материализованные представления',
      '- Параллельное выполнение запросов',
      '--- ГРУППА: Производительность и масштабирование ---',
      '- Потоковая репликация (синхронная/асинхронная)',
      '- Логическая репликация',
      '- Кластеризация (автоматическое переключение при сбое)',
      '- Пул соединений (встроенный/внешний)',
      '- Шардирование (горизонтальное масштабирование)',
      '--- ГРУППА: Безопасность ---',
      '- Аутентификация (пароль, LDAP, Kerberos, сертификаты)',
      '- Шифрование данных при передаче (TLS/SSL)',
      '- Шифрование данных на диске (TDE)',
      '- Аудит операций',
      '- Ролевая модель доступа (RBAC)',
      '- Мандатный контроль доступа (при наличии)',
      '--- ГРУППА: Резервное копирование ---',
      '- Горячее резервное копирование (без остановки сервера)',
      '- Инкрементальное резервное копирование',
      '- Point-In-Time Recovery (PITR)',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые ОС (российские ОС из реестра Минцифры, или эквивалентные)',
      '- Поддерживаемые платформы (x86_64, ARM, Эльбрус или эквивалент)',
      '- Интеграция с 1С:Предприятие (при необходимости)',
      '--- ГРУППА: Средства администрирования ---',
      '- Графическая консоль управления',
      '- Мониторинг производительности',
      '- Средства миграции с других СУБД',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Сертификат ФСТЭК России (если применимо)',
      '- Тип лицензии (по ядрам / по серверам / по пользователям / подписка)',
      '- Кол-во ядер / серверов',
      '- Срок технической поддержки (мес)',
      '- Документация на русском языке',
    ].join('\n'),

    crypto: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия СКЗИ',
      '- Тип СКЗИ (программное / программно-аппаратное)',
      '- Класс защиты (не ниже КС1)',
      '--- ГРУППА: Криптографические алгоритмы ---',
      '- Электронная подпись (ГОСТ Р 34.10-2012)',
      '- Хэширование (ГОСТ Р 34.11-2012 «Стрибог»)',
      '- Шифрование (ГОСТ Р 34.12-2015, ГОСТ 28147-89)',
      '- Протокол TLS с поддержкой российских криптоалгоритмов (ГОСТ TLS)',
      '--- ГРУППА: Функциональные возможности ---',
      '- Создание и проверка ЭП (электронной подписи)',
      '- Шифрование и расшифрование файлов и данных',
      '- Формирование и проверка ЭП формата CAdES (BES, T, X Long Type 1)',
      '- Формирование и проверка ЭП формата XAdES',
      '- Работа с контейнерами закрытых ключей',
      '- Поддержка ключевых носителей (токенов, смарт-карт)',
      '- Интеграция с PKI (работа с сертификатами X.509)',
      '--- ГРУППА: Интеграция ---',
      '- Интеграция с веб-браузерами (плагин ЭП)',
      '- Интеграция с офисными пакетами (ЭП в документах)',
      '- Интеграция с системами ЭДО',
      '- Интеграция с ЕИС (zakupki.gov.ru)',
      '- CSP-интерфейс (Microsoft CryptoAPI / PKCS#11)',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые ОС (Windows, российские Linux-ОС или эквивалентные, macOS)',
      '- Поддерживаемые платформы (x86_64, ARM)',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Сертификат ФСБ России (номер, класс, срок действия)',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Тип лицензии (бессрочная/годовая)',
      '- Количество лицензий',
      '- Срок технической поддержки (мес)',
      '- Документация на русском языке (руководство пользователя, формуляр, правила пользования)',
    ].join('\n'),

    vdi: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия платформы VDI',
      '- Тип решения (VDI / терминальный доступ / гибридное)',
      '- Вариант поставки (индивидуальные ВМ / терминальный режим)',
      '--- ГРУППА: Функциональные возможности ---',
      '- Количество виртуальных рабочих мест (лицензий)',
      '- Метрика лицензирования (конкурентные пользователи CCU / именованные пользователи)',
      '- Количество конкурентных сессий (не менее)',
      '- Типы рабочих мест (персистентные / непереистентные)',
      '- Протоколы доступа (RDP, PCoIP, SPICE, Blast или эквивалент)',
      '- Управление профилями пользователей',
      '- Перенаправление USB-устройств',
      '- Перенаправление аудио/видео',
      '- Перенаправление принтеров',
      '- Поддержка нескольких мониторов',
      '- Полноэкранный режим',
      '- Буфер обмена (двусторонний)',
      '--- ГРУППА: Управление и администрирование ---',
      '- Веб-консоль администратора',
      '- Автоматическое развёртывание рабочих мест из шаблонов',
      '- Балансировка нагрузки',
      '- Мониторинг сессий в реальном времени',
      '- Политики подключения',
      '- Мультиарендность',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые гипервизоры',
      '- Совместимость с платформой виртуализации Брест или эквивалентной',
      '- Поддерживаемые гостевые ОС (Windows, российские Linux-ОС или эквивалентные)',
      '- Поддерживаемые клиентские ОС (тонкие клиенты, Linux, Windows)',
      '- Поддерживаемые клиентские устройства (ПК, ноутбук, тонкий клиент, мобильные)',
      '- Работа через веб-браузер (HTML5) без установки толстого клиента',
      '- Работа через шлюз подключений без обязательного использования VPN, если такой режим предусмотрен правообладателем',
      '--- ГРУППА: Безопасность ---',
      '- Шифрование каналов связи (TLS)',
      '- Двухфакторная аутентификация',
      '- Интеграция со службой каталогов (AD, FreeIPA или эквивалент)',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Сертификат ФСТЭК России (если применимо)',
      '- Тип лицензии (конкурентные пользователи CCU / именованные пользователи / подписка)',
      '- Срок технической поддержки (мес)',
      '- Документация на русском языке',
    ].join('\n'),

    virt: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия платформы виртуализации',
      '- Тип (серверная виртуализация, гипервизор bare-metal)',
      '--- ГРУППА: Функциональные возможности ---',
      '- Макс. кол-во виртуальных машин на хост',
      '- Макс. кол-во vCPU на ВМ',
      '- Макс. объём ОП на ВМ',
      '- Макс. кол-во виртуальных дисков на ВМ',
      '- Live-миграция ВМ (без остановки)',
      '- Миграция хранилища (Storage Migration)',
      '- Снимки ВМ (Snapshots)',
      '- Клонирование ВМ',
      '- Шаблоны ВМ',
      '--- ГРУППА: Высокая доступность ---',
      '- Кластеризация (HA)',
      '- Автоматический перезапуск ВМ при сбое хоста',
      '- Балансировка нагрузки (DRS или эквивалент)',
      '- Отказоустойчивость (Fault Tolerance)',
      '- Встроенные средства защиты информации Astra Linux, включая мандатное управление доступом к виртуальным машинам, либо эквивалентные механизмы разграничения доступа',
      '--- ГРУППА: Хранение данных ---',
      '- Поддерживаемые хранилища (локальные, NFS, iSCSI, FC, Ceph или эквивалент)',
      '- Управление хранилищами LVM / Ceph или эквивалентными',
      '- Поддержка программно-определяемого хранилища Ceph',
      '- Распределённое хранилище (SDS)',
      '- Тонкое выделение дисков (Thin Provisioning)',
      '--- ГРУППА: Сетевые возможности ---',
      '- Виртуальные сети (VLAN, VXLAN)',
      '- Виртуальный коммутатор',
      '- Виртуальный маршрутизатор / МЭ',
      '--- ГРУППА: Управление ---',
      '- Веб-консоль управления',
      '- REST API',
      '- Интеграция со службой каталогов',
      '- Мониторинг и отчёты',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые гостевые ОС (Windows, российские Linux-ОС или эквивалентные)',
      '- Поддерживаемые серверные платформы (x86_64)',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Сертификат ФСТЭК России (если применимо)',
      '- Тип лицензии (по сокетам / по серверам / подписка)',
      '- Лицензирование по количеству физических процессоров (сокетов) на серверах виртуализации',
      '- Срок технической поддержки (мес)',
      '- Документация на русском языке',
    ].join('\n'),

    vks: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия ПО ВКС',
      '- Тип решения (серверное / облачное / гибридное)',
      '--- ГРУППА: Видеоконференцсвязь ---',
      '- Макс. кол-во участников конференции (не менее)',
      '- Макс. кол-во одновременных конференций',
      '- Качество видео (не менее Full HD 1080p)',
      '- Адаптивный битрейт (автоподстройка под канал связи)',
      '- Раскладки экрана (несколько режимов отображения)',
      '--- ГРУППА: Функциональные возможности ---',
      '- Демонстрация экрана (с выбором окна/монитора)',
      '- Запись конференций (локально/на сервер)',
      '- Чат (текстовый, групповой, личный)',
      '- Обмен файлами в конференции',
      '- Виртуальная доска (совместное рисование)',
      '- Голосование / опросы в конференции',
      '- Поднятие руки',
      '- Планирование конференций (календарь)',
      '- Виртуальный фон / размытие фона',
      '--- ГРУППА: Интеграция ---',
      '- Интеграция с календарями (CalDAV, Exchange или эквивалент)',
      '- Интеграция с почтой (приглашения)',
      '- Интеграция с SIP/H.323 (аппаратные ВКС-терминалы)',
      '- API для интеграции с корпоративными системами',
      '--- ГРУППА: Безопасность ---',
      '- Шифрование медиапотоков (TLS, SRTP)',
      '- Шифрование сигнализации',
      '- Аутентификация участников',
      '- PIN-код для входа в конференцию',
      '- Зал ожидания (модерация входа)',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые ОС (Windows, российские Linux-ОС или эквивалентные, macOS)',
      '- Мобильные клиенты (Android, iOS)',
      '- Веб-клиент (без установки ПО, через браузер)',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Тип лицензии (по участникам / по серверу / подписка)',
      '- Срок технической поддержки (мес)',
      '- Документация на русском языке',
    ].join('\n'),

    email: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия почтового сервера',
      '- Тип решения (серверное / облачное)',
      '--- ГРУППА: Протоколы и стандарты ---',
      '- SMTP (отправка)',
      '- IMAP (получение)',
      '- POP3 (получение)',
      '- CalDAV (календари)',
      '- CardDAV (контакты)',
      '- Exchange ActiveSync или эквивалент (синхронизация мобильных)',
      '--- ГРУППА: Функциональные возможности ---',
      '- Макс. кол-во почтовых ящиков (не менее)',
      '- Объём хранилища на ящик (не менее, ГБ)',
      '- Макс. размер вложения (не менее, МБ)',
      '- Веб-интерфейс (Webmail)',
      '- Встроенная панель управления',
      '- Календарь (личный и общий)',
      '- Контакты (адресная книга, глобальная и персональная)',
      '- Задачи и заметки',
      '- Общие папки',
      '- Автоответчик (Out-of-Office)',
      '- Правила обработки почты (фильтры, пересылка)',
      '- Поиск по почте (полнотекстовый)',
      '- Кластеризация / высокая доступность',
      '- Миграция с Microsoft Exchange с сохранением писем, календарей и адресных книг',
      '--- ГРУППА: Безопасность ---',
      '- Антиспам (встроенный фильтр)',
      '- Антивирусная проверка вложений',
      '- Шифрование каналов (TLS/SSL)',
      '- Поддержка S/MIME и ЭП',
      '- DKIM, SPF, DMARC',
      '- Двухфакторная аутентификация',
      '--- ГРУППА: Интеграция ---',
      '- Интеграция со службой каталогов (AD, LDAP, FreeIPA или эквивалент)',
      '- Интеграция с ALD Pro / LDAP-каталогом или эквивалентной службой каталогов',
      '- Интеграция с ВКС',
      '- API для интеграции',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые ОС сервера (российские Linux-ОС или эквивалентные)',
      '- Поддерживаемые почтовые клиенты',
      '- Мобильные клиенты (Android, iOS)',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Тип лицензии (по ящикам / по серверу / подписка)',
      '- Лицензирование по количеству почтовых ящиков (пользователей)',
      '- Срок технической поддержки (мес)',
      '- Документация на русском языке',
    ].join('\n'),

    ecm: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия СЭД/ECM',
      '- Тип системы (СЭД / ECM / BPM-СЭД)',
      '--- ГРУППА: Документооборот ---',
      '- Регистрация входящих/исходящих/внутренних документов',
      '- Маршруты согласования (последовательные, параллельные, смешанные)',
      '- Контроль исполнения (поручения, сроки, напоминания)',
      '- Версионирование документов',
      '- Полнотекстовый поиск по содержимому документов',
      '- Шаблоны документов',
      '- Штрихкодирование / QR-кодирование',
      '--- ГРУППА: Электронная подпись ---',
      '- Поддержка ЭП (квалифицированная, неквалифицированная)',
      '- Интеграция с отечественными СКЗИ или эквивалентными решениями',
      '- Визуализация ЭП в документах',
      '--- ГРУППА: Хранение ---',
      '- Архивное хранение документов',
      '- Управление номенклатурой дел',
      '- Контроль сроков хранения',
      '--- ГРУППА: Интеграция ---',
      '- Интеграция с 1С:Предприятие или эквивалент',
      '- Интеграция со СМЭВ/МЭДО',
      '- Интеграция со службой каталогов (AD, LDAP, FreeIPA)',
      '- Интеграция с почтовыми системами',
      '- REST API / Web Services',
      '--- ГРУППА: Мобильный доступ ---',
      '- Мобильное приложение (Android, iOS)',
      '- Веб-клиент (без установки ПО)',
      '--- ГРУППА: Безопасность ---',
      '- Ролевая модель доступа (RBAC)',
      '- Журналирование действий пользователей',
      '- Разграничение доступа к документам',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Тип лицензии (по пользователям / по серверу / подписка)',
      '- Кол-во пользователей (лицензий)',
      '- Срок технической поддержки (мес)',
      '- Документация на русском языке',
    ].join('\n'),

    backup_sw: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия ПО резервного копирования',
      '- Метрика лицензирования (по суммарному объёму данных, ТБ, и/или по количеству клиентов)',
      '--- ГРУППА: Типы резервного копирования ---',
      '- Полное резервное копирование',
      '- Инкрементальное резервное копирование',
      '- Дифференциальное резервное копирование',
      '- Синтетическое полное резервное копирование',
      '--- ГРУППА: Поддерживаемые источники ---',
      '- Файлы и каталоги',
      '- Образы дисков (bare-metal)',
      '- Виртуальные машины (KVM, VMware, Hyper-V или эквивалент)',
      '- Виртуальные машины на платформе Брест без установки агентов (agentless), если такой режим поддерживается',
      '- Базы данных (PostgreSQL, MySQL, MS SQL, Oracle или эквивалент)',
      '- Приложения (1С, Exchange, SharePoint или эквивалент)',
      '- Контейнеры',
      '--- ГРУППА: Хранилища назначения ---',
      '- Локальное хранилище (диск, NAS)',
      '- Сетевое хранилище (NFS, SMB/CIFS)',
      '- Объектное хранилище (S3-совместимое)',
      '- Ленточное хранилище (LTO)',
      '--- ГРУППА: Функциональные возможности ---',
      '- Дедупликация данных',
      '- Глобальная дедупликация на стороне клиента и сервера',
      '- Компрессия',
      '- Шифрование резервных копий по ГОСТ и/или сертифицированным криптографическим алгоритмам',
      '- Расписание заданий (по времени, по событиям)',
      '- Верификация резервных копий',
      '- Гранулярное восстановление (отдельные файлы, объекты)',
      '- Мгновенное восстановление ВМ (Instant Recovery)',
      '- Состав поставки (серверная часть и агенты для БД / приложений)',
      '--- ГРУППА: Управление ---',
      '- Веб-консоль управления',
      '- Ролевая модель доступа (RBAC)',
      '- Мониторинг заданий',
      '- Отчёты (успешность, объёмы, SLA)',
      '- Уведомления (email)',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые ОС (Windows, российские Linux-ОС или эквивалентные)',
      '- Поддерживаемые платформы виртуализации',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Сертификат ФСТЭК России (если применимо)',
      '- Тип лицензии (по серверам / по ВМ / по объёму / подписка)',
      '- Лицензирование по суммарному объёму данных до сжатия (ТБ) и/или по количеству клиентов',
      '- Срок технической поддержки (мес)',
      '- Документация на русском языке',
    ].join('\n'),

    dlp: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия DLP-системы',
      '--- ГРУППА: Контролируемые каналы ---',
      '- Электронная почта (SMTP, IMAP)',
      '- Веб-трафик (HTTP/HTTPS)',
      '- Мессенджеры',
      '- Съёмные носители (USB, CD/DVD)',
      '- Сетевые хранилища (SMB, NFS)',
      '- Облачные хранилища',
      '- Принтеры (локальные, сетевые)',
      '- Буфер обмена',
      '- Снимки экрана',
      '--- ГРУППА: Методы анализа контента ---',
      '- Лингвистический анализ',
      '- Регулярные выражения',
      '- Цифровые отпечатки документов (Fingerprints)',
      '- Оптическое распознавание текста (OCR)',
      '- Анализ архивов',
      '- Детектирование замаскированных данных',
      '--- ГРУППА: Режимы работы ---',
      '- Режим мониторинга (пассивный)',
      '- Режим блокировки (активный)',
      '- Карантин',
      '- Уведомление пользователя и администратора',
      '--- ГРУППА: Расследование инцидентов ---',
      '- Архив перехваченных данных',
      '- Граф связей сотрудников',
      '- Досье сотрудника',
      '- Поиск по архиву',
      '- Отчёты по инцидентам',
      '--- ГРУППА: Управление ---',
      '- Веб-консоль администратора',
      '- Политики безопасности (настройка правил)',
      '- Ролевая модель доступа к консоли',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые ОС агентов (Windows, российские Linux-ОС или эквивалентные)',
      '- Кол-во защищаемых рабочих мест (не менее)',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Сертификат ФСТЭК России',
      '- Тип лицензии (по рабочим местам / подписка)',
      '- Срок технической поддержки (мес)',
      '- Документация на русском языке',
    ].join('\n'),

    siem: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия SIEM-системы',
      '--- ГРУППА: Сбор событий ---',
      '- Производительность (не менее, событий в секунду EPS)',
      '- Поддерживаемые источники (Syslog, WMI, SNMP, NetFlow, API, агенты)',
      '- Кол-во встроенных коннекторов к источникам',
      '- Нормализация и обогащение событий',
      '--- ГРУППА: Корреляция и аналитика ---',
      '- Корреляция событий в реальном времени',
      '- Встроенные правила детектирования (кол-во)',
      '- Поддержка пользовательских правил',
      '- Детектирование аномалий (поведенческий анализ)',
      '- Ретроспективный анализ',
      '--- ГРУППА: Управление инцидентами ---',
      '- Карточка инцидента',
      '- Workflow обработки инцидентов',
      '- Автоматическое реагирование (playbooks)',
      '- Уведомления (email, Syslog)',
      '--- ГРУППА: Хранение и поиск ---',
      '- Хранение событий (объём, срок хранения)',
      '- Полнотекстовый поиск по событиям',
      '- Построение отчётов и дашбордов',
      '--- ГРУППА: Интеграция ---',
      '- Интеграция с активами (инвентаризация)',
      '- Интеграция со сканерами уязвимостей',
      '- Интеграция с IDS/IPS',
      '- API для интеграции',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые ОС сервера (российские Linux-ОС или эквивалентные)',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Сертификат ФСТЭК России',
      '- Тип лицензии (по EPS / по серверу / подписка)',
      '- Срок технической поддержки (мес)',
      '- Документация на русском языке',
    ].join('\n'),

    firewall_sw: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия ПО межсетевого экрана',
      '--- ГРУППА: Функциональные возможности ---',
      '- Stateful Firewall (инспекция с учётом состояния)',
      '- NAT (SNAT, DNAT, Port Forwarding)',
      '- IPS/IDS (система обнаружения и предотвращения вторжений)',
      '- VPN (IPsec, OpenVPN, L2TP, WireGuard или эквивалент)',
      '- Контроль приложений (Application Control)',
      '- URL-фильтрация (по категориям)',
      '- Антивирусный шлюз',
      '- Антиспам',
      '- DPI (Deep Packet Inspection)',
      '- Кластеризация (Active-Passive, Active-Active)',
      '--- ГРУППА: Производительность ---',
      '- Пропускная способность МЭ (не менее, Мбит/с)',
      '- Пропускная способность IPS (не менее, Мбит/с)',
      '- Пропускная способность VPN (не менее, Мбит/с)',
      '- Кол-во одновременных сессий (не менее)',
      '- Кол-во защищаемых узлов (не менее)',
      '--- ГРУППА: Управление ---',
      '- Веб-интерфейс управления',
      '- CLI (командная строка)',
      '- Централизованное управление несколькими устройствами',
      '- Журналирование и отчёты',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые ОС (российские Linux-ОС или эквивалентные)',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Сертификат ФСТЭК России (профиль защиты МЭ, уровень доверия)',
      '- Тип лицензии (по узлам / по пользователям / подписка)',
      '- Срок технической поддержки (мес)',
      '- Документация на русском языке',
    ].join('\n'),

    edr: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия EDR-решения',
      '--- ГРУППА: Детектирование ---',
      '- Сигнатурное обнаружение',
      '- Поведенческий анализ',
      '- Обнаружение бесфайловых атак',
      '- Обнаружение аномалий',
      '- Индикаторы компрометации (IoC)',
      '- Обнаружение горизонтального перемещения (Lateral Movement)',
      '--- ГРУППА: Расследование ---',
      '- Телеметрия конечных точек (процессы, файлы, реестр, сеть)',
      '- Построение цепочки атаки (Kill Chain)',
      '- Ретроспективный поиск по телеметрии',
      '- Визуализация инцидентов',
      '--- ГРУППА: Реагирование ---',
      '- Изоляция хоста от сети',
      '- Удалённый запуск команд',
      '- Карантин файлов',
      '- Автоматическое реагирование (playbooks)',
      '--- ГРУППА: Управление ---',
      '- Централизованная консоль управления',
      '- Развёртывание агентов',
      '- Политики безопасности',
      '- Интеграция с SIEM',
      '- API для интеграции',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые ОС (Windows, российские Linux-ОС или эквивалентные)',
      '- Кол-во защищаемых конечных точек (не менее)',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Сертификат ФСТЭК России',
      '- Тип лицензии (по конечным точкам / подписка)',
      '- Срок технической поддержки (мес)',
      '- Документация на русском языке',
    ].join('\n'),

    waf: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия WAF',
      '--- ГРУППА: Защита ---',
      '- Защита от OWASP Top 10 (SQL Injection, XSS, CSRF и др.)',
      '- Защита от DDoS на уровне приложений',
      '- Виртуальный патчинг',
      '- Защита API (REST, SOAP, GraphQL)',
      '- Защита от ботов',
      '- Машинное обучение для обнаружения аномалий',
      '--- ГРУППА: Производительность ---',
      '- Пропускная способность (не менее, Мбит/с)',
      '- Кол-во одновременных соединений (не менее)',
      '- Кол-во защищаемых веб-приложений (не менее)',
      '--- ГРУППА: Управление ---',
      '- Веб-консоль управления',
      '- Журналирование и отчёты',
      '- Уведомления об инцидентах',
      '--- ГРУППА: Совместимость ---',
      '- Режимы развёртывания (Reverse Proxy, Transparent, модуль веб-сервера)',
      '- Поддерживаемые протоколы (HTTP/HTTPS, HTTP/2, WebSocket)',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Сертификат ФСТЭК России',
      '- Тип лицензии (по веб-приложениям / по трафику / подписка)',
      '- Срок технической поддержки (мес)',
    ].join('\n'),

    pam: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия PAM-системы',
      '--- ГРУППА: Управление привилегированным доступом ---',
      '- Хранение учётных данных (Vault)',
      '- Автоматическая ротация паролей',
      '- Сессионное управление (запись сессий)',
      '- Контроль команд в SSH/RDP-сессиях',
      '- Проксирование привилегированных сессий',
      '- Двухфакторная аутентификация',
      '- Запрос и согласование доступа',
      '--- ГРУППА: Поддерживаемые протоколы ---',
      '- SSH, RDP, HTTP/HTTPS, VNC',
      '- Подключение к БД (SQL)',
      '--- ГРУППА: Аудит ---',
      '- Запись видео сессий',
      '- Журналирование действий',
      '- Поиск по журналам',
      '--- ГРУППА: Интеграция ---',
      '- Интеграция со службой каталогов (AD, LDAP)',
      '- Интеграция с SIEM',
      '- API для интеграции',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Сертификат ФСТЭК России (если применимо)',
      '- Тип лицензии (по серверам / по пользователям / подписка)',
      '- Срок технической поддержки (мес)',
    ].join('\n'),

    iam: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия IAM/IdM-системы',
      '--- ГРУППА: Управление идентификацией ---',
      '- Автоматизация жизненного цикла учётных записей (создание, изменение, блокировка, удаление)',
      '- Ролевая модель доступа (RBAC)',
      '- Запрос и согласование доступа (workflow)',
      '- Самообслуживание пользователей (сброс пароля, запрос доступа)',
      '- Рекомпиляция прав доступа',
      '--- ГРУППА: Аутентификация ---',
      '- Единая точка входа (SSO)',
      '- Многофакторная аутентификация (MFA)',
      '- Поддерживаемые протоколы (SAML, OAuth 2.0, OpenID Connect, Kerberos)',
      '--- ГРУППА: Интеграция ---',
      '- Коннекторы к целевым системам (AD, LDAP, 1С, БД, REST)',
      '- Интеграция с кадровой системой (HR-источник)',
      '- Кол-во встроенных коннекторов (не менее)',
      '--- ГРУППА: Аудит ---',
      '- Аудит прав доступа',
      '- Отчёты по доступам',
      '- Выявление избыточных прав',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Сертификат ФСТЭК России (если применимо)',
      '- Тип лицензии (по пользователям / подписка)',
      '- Кол-во управляемых учётных записей (не менее)',
      '- Срок технической поддержки (мес)',
    ].join('\n'),

    pki: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия УЦ',
      '--- ГРУППА: Функциональные возможности ---',
      '- Выпуск и управление сертификатами X.509',
      '- Поддержка российских криптоалгоритмов (ГОСТ Р 34.10-2012, ГОСТ Р 34.11-2012)',
      '- Поддержка международных криптоалгоритмов (RSA, ECDSA)',
      '- Списки отзыва сертификатов (CRL)',
      '- Протокол проверки статуса (OCSP)',
      '- Шаблоны сертификатов',
      '- Веб-портал для пользователей',
      '--- ГРУППА: Интеграция ---',
      '- Интеграция с СКЗИ',
      '- Интеграция со службой каталогов',
      '- Интеграция с ЭДО',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Сертификат ФСБ России',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Тип лицензии',
      '- Срок технической поддержки (мес)',
    ].join('\n'),

    erp: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия ERP/учётной системы',
      '- Тип системы (ERP / бухгалтерский учёт / комплексная автоматизация)',
      '--- ГРУППА: Функциональные подсистемы ---',
      '- Бухгалтерский и налоговый учёт',
      '- Управление закупками',
      '- Управление продажами',
      '- Складской учёт и логистика',
      '- Управление производством (при наличии)',
      '- Управление персоналом и расчёт заработной платы',
      '- Бюджетирование и финансовое планирование',
      '- Управление основными средствами',
      '--- ГРУППА: Отчётность ---',
      '- Регламентированная бухгалтерская отчётность',
      '- Налоговая отчётность (электронная сдача)',
      '- Управленческая отчётность',
      '- Конструктор отчётов',
      '--- ГРУППА: Интеграция ---',
      '- Обмен с банками (банк-клиент)',
      '- Интеграция с ГИС (ЕИС, ГИС ЖКХ, ЕГАИС или эквивалент)',
      '- Интеграция со СМЭВ',
      '- Обмен с контрагентами (ЭДО)',
      '- API / веб-сервисы',
      '--- ГРУППА: Безопасность и доступ ---',
      '- Ролевая модель доступа',
      '- Журналирование действий пользователей',
      '- Многопользовательский режим',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые ОС (Windows, российские Linux-ОС или эквивалентные)',
      '- Поддерживаемые СУБД',
      '- Веб-клиент',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Тип лицензии (по рабочим местам / серверная / подписка)',
      '- Кол-во рабочих мест (лицензий)',
      '- Срок технической поддержки (мес)',
      '- Документация на русском языке',
    ].join('\n'),

    cad: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия САПР',
      '- Тип САПР (2D/3D, машиностроение/архитектура/универсальная)',
      '--- ГРУППА: Функциональные возможности ---',
      '- 2D-черчение и оформление чертежей по ЕСКД',
      '- 3D-моделирование (твердотельное, поверхностное)',
      '- Параметрическое моделирование',
      '- Сборочное проектирование',
      '- Генерация спецификаций',
      '- Расчёт масс-инерционных характеристик',
      '--- ГРУППА: Форматы ---',
      '- Поддерживаемые форматы (DWG, DXF, STEP, IGES, SAT)',
      '- Экспорт в PDF',
      '- Импорт/экспорт 3D-моделей',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые ОС (Windows, российские Linux-ОС или эквивалентные)',
      '- Интеграция с PLM/PDM-системами',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Тип лицензии (по рабочим местам / сетевая / подписка)',
      '- Кол-во рабочих мест (лицензий)',
      '- Срок технической поддержки (мес)',
    ].join('\n'),

    monitoring: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия системы мониторинга',
      '--- ГРУППА: Объекты мониторинга ---',
      '- Серверы (физические, виртуальные)',
      '- Сетевое оборудование (коммутаторы, маршрутизаторы)',
      '- Операционные системы',
      '- Сервисы и приложения',
      '- Базы данных',
      '- Контейнеры и кластеры',
      '--- ГРУППА: Сбор данных ---',
      '- Протоколы (SNMP v1/v2c/v3, ICMP, WMI, SSH, JMX, IPMI)',
      '- Агентный и безагентный мониторинг',
      '- Кол-во метрик (не менее)',
      '- Кол-во контролируемых узлов (не менее)',
      '--- ГРУППА: Оповещения ---',
      '- Пороговые значения (триггеры)',
      '- Эскалация оповещений',
      '- Каналы уведомлений (email, SMS, мессенджеры)',
      '--- ГРУППА: Визуализация ---',
      '- Дашборды',
      '- Графики',
      '- Карты сети',
      '- Отчёты',
      '--- ГРУППА: Интеграция ---',
      '- API для интеграции',
      '- Интеграция с ITSM',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Тип лицензии (по узлам / по метрикам / подписка)',
      '- Срок технической поддержки (мес)',
    ].join('\n'),

    itsm: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование и версия ITSM-системы',
      '--- ГРУППА: Процессы ITIL ---',
      '- Управление инцидентами',
      '- Управление запросами на обслуживание',
      '- Управление проблемами',
      '- Управление изменениями',
      '- Управление конфигурациями (CMDB)',
      '- Управление уровнем сервиса (SLA)',
      '- Каталог услуг',
      '- База знаний',
      '--- ГРУППА: Функциональные возможности ---',
      '- Портал самообслуживания',
      '- Автоматическая маршрутизация заявок',
      '- Эскалация по SLA',
      '- Отчёты и дашборды',
      '- Конструктор бизнес-процессов',
      '--- ГРУППА: Интеграция ---',
      '- Интеграция с системами мониторинга',
      '- Интеграция с почтой',
      '- Интеграция со службой каталогов (AD, LDAP)',
      '- REST API',
      '--- ГРУППА: Сертификация и лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры России',
      '- Тип лицензии (по операторам / по пользователям / подписка)',
      '- Срок технической поддержки (мес)',
    ].join('\n'),

    cartridge:  '- Совместимость (модели принтеров/МФУ — через «или эквивалент»)\n- Тип (оригинальный/совместимый)\n- Цвет (чёрный/голубой/пурпурный/жёлтый)\n- Ресурс (не менее, стр, при 5% заполнении)\n- Тип (лазерный/струйный)\n- Упаковка (оригинальная)',
    paper:      '- Формат (A4/A3)\n- Плотность (г/м²)\n- Белизна (не менее, % CIE)\n- Непрозрачность (не менее, %)\n- Кол-во листов в пачке\n- Кол-во пачек в коробке\n- Класс (A/B/C)',

    // ═══════ ПО: НЕДОСТАЮЩИЕ ТИПЫ ═══════
    ldap: [
      '--- ГРУППА: Общие сведения ---',
      '- Тип программного обеспечения (служба каталогов / контроллер домена)',
      '- Поддерживаемые протоколы (LDAP v3, Kerberos 5, DNS, DHCP)',
      '- Совместимость с Active Directory (уровень: полная/частичная)',
      '--- ГРУППА: Управление пользователями ---',
      '- Макс. количество учётных записей (не менее)',
      '- Макс. количество доменов',
      '- Групповые политики (количество встроенных шаблонов)',
      '- Групповые политики на базе SaltStack или эквивалентного механизма конфигурационного управления',
      '- Иерархия подразделений / организационных единиц (OU)',
      '- Управление сайтами и топологией репликации',
      '- Делегирование административных полномочий',
      '- Управление паролями (политики сложности, истечение, блокировка)',
      '- Двухфакторная аутентификация (поддержка)',
      '- Аутентификация через смарт-карты / токены',
      '- Автоматизированная установка ОС по сети (PXE / netboot или эквивалент)',
      '--- ГРУППА: Инфраструктура ---',
      '- Репликация каталога (multi-master)',
      '- Межсайтовая репликация каталога',
      '- Отказоустойчивость (кластеризация)',
      '- Поддержка DNS-зон (прямые и обратные)',
      '- Интеграция с DHCP / DNS-сервисами',
      '- Интеграция с RADIUS / IEEE 802.1X',
      '- Поддержка схемы каталога (расширяемость)',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые серверные ОС (Astra Linux, ALT Linux, РЕД ОС или эквивалентные)',
      '- Поддерживаемые клиентские ОС',
      '- Интеграция с почтовыми системами (РуПост, Mailion или эквивалентные)',
      '- Интеграция с ВКС (TrueConf или эквивалентные)',
      '- Миграция из Microsoft Active Directory с сохранением структуры домена и объектов',
      '--- ГРУППА: Безопасность ---',
      '- Сертификат ФСТЭК России (уровень доверия)',
      '- Шифрование трафика (TLS 1.2 и выше)',
      '- Аудит действий администраторов',
      '- Журналирование событий безопасности',
      '--- ГРУППА: Лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры',
      '- Тип лицензии (серверная часть / CAL на устройство / CAL на пользователя)',
      '- Лицензионный состав (серверная лицензия на контроллер домена + CAL / управляемые объекты)',
      '- Клиентские лицензии обеспечивают право управления рабочими станциями и серверами через доменные политики',
      '- Срок технической поддержки (мес)',
      '- Обновления (включены в поддержку)',
      '- Документация на русском языке',
    ].join('\n'),

    license: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование программного обеспечения',
      '- Версия / редакция (не ниже)',
      '- Тип лицензии (бессрочная / подписка / SaaS)',
      '- Срок действия лицензии (мес)',
      '--- ГРУППА: Объём лицензирования ---',
      '- Единица лицензирования (на пользователя / на устройство / на сервер / на ядро)',
      '- Количество лицензий (не менее, шт)',
      '- Архитектурная возможность масштабирования системы (расширения лицензии) в будущем',
      '--- ГРУППА: Функциональные возможности ---',
      '- Основные функциональные модули (не менее 10 пунктов)',
      '- Поддержка многопользовательского режима',
      '- Централизованное управление лицензиями',
      '- Удалённый доступ (веб-интерфейс / тонкий клиент)',
      '- API / интеграция с внешними системами',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые серверные ОС (или эквивалентные)',
      '- Поддерживаемые клиентские ОС (или эквивалентные)',
      '- Поддерживаемые СУБД (или эквивалентные)',
      '- Поддерживаемые браузеры (или эквивалентные)',
      '- Минимальные системные требования (RAM, CPU, HDD)',
      '--- ГРУППА: Безопасность и сертификация ---',
      '- Наличие в Едином реестре российского ПО Минцифры',
      '- Сертификат ФСТЭК России (при применимости)',
      '- Шифрование данных (тип, стандарт)',
      '- Разграничение прав доступа (ролевая модель)',
      '--- ГРУППА: Поддержка ---',
      '- Техническая поддержка (срок, режим: 8x5 / 24x7)',
      '- Обновления (включены в поддержку / доп. оплата)',
      '- Документация на русском языке',
      '- Обучение / инструкции пользователя',
    ].join('\n'),

    osSupport: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование ПО (ОС), к которому приобретается поддержка',
      '- Версия / редакция ОС (не ниже)',
      '- Количество сертификатов техподдержки (шт)',
      '--- ГРУППА: Условия техподдержки ---',
      '- Уровень техподдержки (Стандарт / Расширенная / Привилегированная)',
      '- Срок действия сертификата техподдержки (12 / 24 / 36 мес)',
      '- Время реакции на обращение (не более, часов)',
      '- Время решения критических инцидентов (не более, часов)',
      '- Время решения некритических инцидентов (не более, рабочих дней)',
      '- Режим работы техподдержки (8x5 / 12x5 / 12x7 / 24x7)',
      '- Для привилегированного уровня: режим 24x7 и время реакции на критический инцидент не более 1 часа',
      '- Каналы обращения (портал, email, телефон, чат)',
      '- Количество обращений за период (лимитированное / безлимитное)',
      '- Наличие выделенного инженера (при привилегированном уровне)',
      '--- ГРУППА: Обновления ---',
      '- Право на обновления версий ОС в период поддержки',
      '- Доступ к репозиториям обновлений безопасности',
      '- Получение патчей безопасности (срок выпуска)',
      '- Право на обновление до новых мажорных версий',
      '- Право на получение новых мажорных релизов ОС (например, переход с версии 1.8 на 1.9)',
      '- Способ доставки обновлений (онлайн-репозиторий / офлайн)',
      '--- ГРУППА: Документация и обучение ---',
      '- Доступ к базе знаний вендора',
      '- Доступ к технической документации',
      '- Доступ к обучающим материалам / вебинарам',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые аппаратные платформы',
      '- Совместимость с отечественными инфраструктурными сервисами и смежными решениями',
      '--- ГРУППА: Сертификация ---',
      '- Наличие ПО в Едином реестре российского ПО Минцифры',
      '- Действующий сертификат ФСТЭК (номер / уровень доверия)',
      '- Поддержание сертификата ФСТЭК в период действия поддержки',
      '- Поддержка экосистемной совместимости с отечественными инфраструктурными сервисами',
    ].join('\n'),

    supportCert: [
      '--- ГРУППА: Общие сведения ---',
      '- Наименование ПО, к которому приобретается поддержка',
      '- Версия / редакция ПО (не ниже)',
      '- Количество сертификатов техподдержки (шт)',
      '- Продукт экосистемы Astra (ALD Pro / Брест / Termidesk / RuPost / RuBackup или эквивалент)',
      '--- ГРУППА: Условия техподдержки ---',
      '- Уровень техподдержки (Стандарт / Расширенная / Привилегированная / Platinum)',
      '- Срок действия сертификата (12 / 24 / 36 мес)',
      '- Время реакции на обращение (не более, часов)',
      '- Время решения критических инцидентов (не более, часов)',
      '- Время решения некритических инцидентов (не более, рабочих дней)',
      '- Режим работы техподдержки (8x5 / 12x5 / 24x7)',
      '- Для привилегированного уровня: режим 24x7 и время реакции на критический инцидент не более 1 часа',
      '- Каналы обращения (портал, email, телефон)',
      '- Количество обращений за период (лимитированное / безлимитное)',
      '--- ГРУППА: Обновления ---',
      '- Право на обновления версий в период поддержки',
      '- Доступ к репозиториям обновлений и патчей безопасности',
      '- Право на обновление до новых мажорных версий',
      '- Право на получение новых мажорных релизов продуктов экосистемы Astra без дополнительной оплаты в период действия поддержки',
      '--- ГРУППА: Лицензионный состав ---',
      '- Единица лицензирования поддержки (на пользователя / на сервер / на кол-во лицензий)',
      '- Количество поддерживаемых экземпляров / лицензий (шт)',
      '--- ГРУППА: Документация ---',
      '- Доступ к базе знаний вендора',
      '- Документация на русском языке',
      '--- ГРУППА: Сертификация ---',
      '- Наличие ПО в Едином реестре российского ПО Минцифры',
      '- Действующий сертификат ФСТЭК (при применимости)',
    ].join('\n'),

    hr: [
      '--- ГРУППА: Общие сведения ---',
      '- Тип ПО (управление персоналом / кадровый учёт / расчёт зарплаты)',
      '- Версия / редакция (не ниже)',
      '--- ГРУППА: Кадровый учёт ---',
      '- Ведение штатного расписания',
      '- Учёт сотрудников (приём, перевод, увольнение)',
      '- Табельный учёт рабочего времени',
      '- Учёт отпусков, больничных, командировок',
      '- Воинский учёт',
      '- Формирование кадровых приказов (унифицированные формы)',
      '--- ГРУППА: Расчёт зарплаты ---',
      '- Расчёт заработной платы (все виды начислений и удержаний)',
      '- Расчёт НДФЛ, страховых взносов',
      '- Формирование расчётных листков',
      '- Отчётность в ПФР, ФСС, ФНС (электронные форматы)',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые ОС (или эквивалентные)',
      '- Интеграция с 1С:Бухгалтерия (или эквивалент)',
      '- Наличие в Едином реестре российского ПО Минцифры',
      '- Тип лицензии',
      '- Срок технической поддержки (мес)',
      '- Документация на русском языке',
    ].join('\n'),

    gis: [
      '--- ГРУППА: Общие сведения ---',
      '- Тип ПО (ГИС / геоинформационная система)',
      '- Поддерживаемые форматы данных (SHP, GeoJSON, KML, GeoTIFF и др.)',
      '--- ГРУППА: Функциональность ---',
      '- Создание и редактирование карт',
      '- Пространственный анализ (буферные зоны, оверлей, геокодирование)',
      '- Тематическое картографирование',
      '- 3D-визуализация рельефа',
      '- Поддержка систем координат (не менее)',
      '- Работа с растровыми данными',
      '- Работа с векторными данными',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые СУБД (PostgreSQL/PostGIS или эквивалентные)',
      '- Поддерживаемые ОС (или эквивалентные)',
      '- Веб-интерфейс (публикация карт)',
      '- Наличие в Едином реестре российского ПО Минцифры',
      '- Тип лицензии',
      '- Срок технической поддержки (мес)',
    ].join('\n'),

    mdm: [
      '--- ГРУППА: Общие сведения ---',
      '- Тип ПО (управление мобильными устройствами / MDM)',
      '--- ГРУППА: Управление устройствами ---',
      '- Поддерживаемые платформы (Android, iOS, Аврора или эквивалентные)',
      '- Макс. количество управляемых устройств (не менее)',
      '- Удалённая настройка и конфигурирование',
      '- Удалённая блокировка и стирание данных',
      '- Установка/удаление приложений удалённо',
      '- Геолокация устройств',
      '--- ГРУППА: Безопасность ---',
      '- Контейнеризация (разделение личных и корпоративных данных)',
      '- VPN-профили',
      '- Управление сертификатами',
      '- Политики паролей',
      '- Сертификат ФСТЭК России (при применимости)',
      '--- ГРУППА: Лицензирование ---',
      '- Наличие в Едином реестре российского ПО Минцифры',
      '- Тип лицензии (по устройствам)',
      '- Срок технической поддержки (мес)',
    ].join('\n'),

    portal: [
      '--- ГРУППА: Общие сведения ---',
      '- Тип ПО (корпоративный портал / интранет)',
      '--- ГРУППА: Функциональность ---',
      '- Новости и объявления',
      '- Структура организации (оргсхема)',
      '- Каталог сотрудников (профили, контакты)',
      '- Документооборот (совместная работа с документами)',
      '- Задачи и проекты',
      '- Календарь и планирование',
      '- Чат и видеозвонки',
      '- Хранилище файлов (объём, ГБ)',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые ОС сервера (или эквивалентные)',
      '- Поддерживаемые браузеры',
      '- Мобильное приложение (Android, iOS)',
      '- Интеграция с LDAP / Active Directory',
      '- Наличие в Едином реестре российского ПО Минцифры',
      '- Тип лицензии',
      '- Срок технической поддержки (мес)',
    ].join('\n'),

    project_sw: [
      '--- ГРУППА: Общие сведения ---',
      '- Тип ПО (управление проектами / трекер задач)',
      '--- ГРУППА: Функциональность ---',
      '- Канбан-доски',
      '- Диаграмма Ганта',
      '- Спринты / Agile-методологии',
      '- Учёт рабочего времени',
      '- Отчётность и аналитика',
      '- Интеграция с системами версионирования (Git)',
      '- API для внешних интеграций',
      '--- ГРУППА: Совместимость ---',
      '- Веб-интерфейс',
      '- Мобильное приложение',
      '- Наличие в Едином реестре российского ПО Минцифры',
      '- Тип лицензии (по пользователям)',
      '- Срок технической поддержки (мес)',
    ].join('\n'),

    bpm: [
      '--- ГРУППА: Общие сведения ---',
      '- Тип ПО (BPM / управление бизнес-процессами)',
      '--- ГРУППА: Функциональность ---',
      '- Визуальный редактор процессов (BPMN 2.0)',
      '- Формы задач (конструктор, без программирования)',
      '- Маршрутизация задач (параллельная, последовательная, условная)',
      '- Электронные согласования и подписи',
      '- Аналитика и KPI процессов',
      '- Интеграция с СЭД',
      '- API / REST',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые ОС (или эквивалентные)',
      '- Поддерживаемые СУБД (или эквивалентные)',
      '- Наличие в Едином реестре российского ПО Минцифры',
      '- Тип лицензии',
      '- Срок технической поддержки (мес)',
    ].join('\n'),

    vpn: [
      '--- ГРУППА: Общие сведения ---',
      '- Тип ПО (VPN-клиент / VPN-сервер)',
      '--- ГРУППА: Функциональность ---',
      '- Поддерживаемые протоколы (IPsec, IKEv2, OpenVPN или эквивалентные)',
      '- Шифрование (ГОСТ Р 34.12-2015, AES-256 или эквивалентное)',
      '- Макс. количество одновременных подключений (не менее)',
      '- Пропускная способность (не менее, Мбит/с)',
      '- Двухфакторная аутентификация',
      '- Интеграция с СКЗИ (КриптоПро или эквивалент)',
      '--- ГРУППА: Сертификация ---',
      '- Сертификат ФСТЭК России',
      '- Сертификат ФСБ России (при применимости)',
      '- Наличие в Едином реестре российского ПО Минцифры',
      '- Тип лицензии',
      '- Срок технической поддержки (мес)',
    ].join('\n'),

    // ═══════ ОБОРУДОВАНИЕ: НЕДОСТАЮЩИЕ ТИПЫ ═══════
    keyboard: '- Тип (мембранная/механическая/ножничная)\n- Интерфейс подключения (USB/PS2/Bluetooth/RF 2.4 ГГц)\n- Раскладка (русская + латинская, QWERTY)\n- Цифровой блок (наличие)\n- Подсветка клавиш (наличие, цвет, регулировка яркости)\n- Мультимедийные клавиши (наличие, кол-во)\n- Ресурс клавиш (не менее, нажатий)\n- Длина кабеля (не менее, м)\n- Совместимость с ОС (или эквивалентными)\n- Цвет корпуса\n- Масса (не более, г)',
    mouse: '- Тип (оптическая/лазерная)\n- Интерфейс подключения (USB/Bluetooth/RF 2.4 ГГц)\n- Разрешение сенсора (не менее, dpi)\n- Кол-во кнопок\n- Колесо прокрутки\n- Длина кабеля (не менее, м) — для проводной\n- Время автономной работы (не менее, мес) — для беспроводной\n- Тип питания (батарея/аккумулятор) — для беспроводной\n- Совместимость с ОС (или эквивалентными)\n- Масса (не более, г)',
    kvm: '- Кол-во портов (подключаемых ПК)\n- Тип видеоинтерфейса (VGA/DVI/HDMI/DisplayPort)\n- Поддерживаемое разрешение видео (не менее)\n- Порты USB для клавиатуры/мыши\n- Дополнительные USB-порты (для периферии)\n- Аудио (переключение)\n- Горячие клавиши переключения\n- Каскадирование (при наличии)\n- Управление (кнопки/горячие клавиши/OSD-меню)\n- Монтаж (desktop/rack 19\")\n- Габариты (мм), масса (не более, кг)',
    interactive: [
      '- Диагональ экрана (дюймы)',
      '- Разрешение (не менее, пикс.)',
      '- Технология сенсора (инфракрасный/ёмкостный/электромагнитный)',
      '- Кол-во одновременных касаний (не менее)',
      '- Время отклика сенсора (не более, мс)',
      '- Яркость (не менее, кд/м²)',
      '- Контрастность (не менее)',
      '- Встроенные динамики (мощность, Вт)',
      '- Интерфейсы (HDMI, VGA, USB, RS-232)',
      '- Встроенный ПК (при наличии: процессор, ОЗУ, накопитель)',
      '- Поддерживаемые ОС (или эквивалентные)',
      '- ПО для интерактивной работы (в комплекте)',
      '- Монтаж (настенный, напольная стойка, крепёж в комплекте)',
      '- Потребляемая мощность (не более, Вт)',
      '- Габариты (мм), масса (не более, кг)',
    ].join('\n'),

    cpu: [
      '- Семейство процессора',
      '- Кол-во ядер (не менее)',
      '- Кол-во потоков (не менее)',
      '- Базовая тактовая частота (не менее, ГГц)',
      '- Турбо-частота (не менее, ГГц)',
      '- Кэш L3 (не менее, МБ)',
      '- TDP (не более, Вт)',
      '- Техпроцесс (нм)',
      '- Поддерживаемые типы памяти (DDR4/DDR5)',
      '- Макс. объём памяти (не менее, ГБ)',
      '- Кол-во каналов памяти',
      '- Линии PCIe (версия, кол-во)',
      '- Интегрированная графика (при наличии)',
      '- Поддержка виртуализации (VT-x, VT-d или эквивалент)',
      '- Гарантия производителя (мес)',
    ].join('\n'),
    gpu: [
      '- Тип (дискретная)',
      '- Объём видеопамяти (не менее, ГБ)',
      '- Тип видеопамяти (GDDR6 или выше)',
      '- Разрядность шины памяти (бит)',
      '- Интерфейс подключения (PCIe, версия)',
      '- Видеовыходы (HDMI, DisplayPort, кол-во)',
      '- Макс. разрешение вывода (не менее)',
      '- Кол-во подключаемых мониторов (не менее)',
      '- Поддержка API (DirectX, OpenGL, Vulkan или эквивалент)',
      '- Поддержка аппаратного кодирования видео',
      '- Система охлаждения (активная/пассивная)',
      '- TDP / потребляемая мощность (не более, Вт)',
      '- Требования к блоку питания (не менее, Вт)',
      '- Дополнительное питание (разъёмы)',
      '- Габариты (длина, мм)',
    ].join('\n'),
    motherboard: [
      '- Форм-фактор (ATX/Micro-ATX/Mini-ITX)',
      '- Сокет процессора',
      '- Чипсет',
      '- Слоты оперативной памяти (тип DDR4/DDR5, кол-во, макс. объём)',
      '- Макс. частота ОЗУ (не менее, МГц)',
      '- Поддержка ECC (да/нет)',
      '- Слоты расширения PCIe (тип, версия, кол-во)',
      '- Разъёмы M.2 (кол-во, поддерживаемые типы)',
      '- Порты SATA (кол-во)',
      '- USB-разъёмы на задней панели (тип, кол-во)',
      '- USB-разъёмы внутренние (тип, кол-во)',
      '- Видеовыходы (HDMI, DisplayPort, VGA)',
      '- Сетевой интерфейс (Ethernet, скорость)',
      '- Wi-Fi / Bluetooth (при наличии)',
      '- Аудио (кодек, кол-во каналов)',
      '- Система питания (фазы VRM)',
      '- Разъём питания (24-pin + 8-pin)',
    ].join('\n'),
    psu: '- Мощность (не менее, Вт)\n- Сертификат энергоэффективности (80 PLUS: Bronze/Silver/Gold/Platinum)\n- Форм-фактор (ATX/SFX)\n- Модульная кабельная система (да/нет)\n- Разъёмы (24-pin ATX, 4+4-pin CPU, 6+2-pin PCIe, SATA, Molex)\n- Тип вентилятора (диаметр, мм)\n- Уровень шума (не более, дБА)\n- Входное напряжение (диапазон, В)\n- Защиты (OVP, OCP, SCP, OPP, UVP)\n- Длина кабелей основных разъёмов (не менее, мм)\n- Габариты (мм), масса (не более, кг)\n- Гарантия производителя (мес)',
    cooling: '- Тип (воздушное/жидкостное)\n- Совместимые сокеты\n- Рассеиваемая мощность TDP (не менее, Вт)\n- Для воздушного: размер радиатора (мм), кол-во тепловых трубок\n- Вентилятор(ы): диаметр (мм), скорость (об/мин), уровень шума (не более, дБА)\n- Для жидкостного: размер радиатора (120/240/360 мм)\n- Тип подшипника\n- Разъём питания (4-pin PWM)\n- Габариты (мм), масса (не более, кг)',
    parts: '- Наименование комплектующего\n- Тип / назначение\n- Совместимость (с каким оборудованием)\n- Интерфейс подключения\n- Основные технические параметры (указать по типу)\n- Гарантия производителя (мес)',
    flashDrive: '- Объём памяти (не менее, ГБ)\n- Интерфейс (USB 2.0 / USB 3.0 / USB 3.2 / USB Type-C)\n- Скорость чтения (не менее, МБ/с)\n- Скорость записи (не менее, МБ/с)\n- Материал корпуса\n- Защита от влаги/пыли/ударов (при наличии, IP-рейтинг)\n- Аппаратное шифрование (при наличии)\n- Габариты (мм), масса (не более, г)',
    dvd: '- Тип носителя (DVD-R / DVD-RW / CD-R / CD-RW / Blu-ray)\n- Объём (ГБ)\n- Скорость записи (x)\n- Кол-во дисков в упаковке\n- Кол-во упаковок',
    tapeLib: [
      '- Форм-фактор (Rack, высота U)',
      '- Кол-во слотов для картриджей (не менее)',
      '- Кол-во ленточных приводов (не менее)',
      '- Тип картриджей (LTO-8/LTO-9 или эквивалент)',
      '- Ёмкость без сжатия (не менее, ТБ)',
      '- Ёмкость со сжатием (не менее, ТБ)',
      '- Скорость передачи данных на привод (не менее, МБ/с)',
      '- Интерфейс подключения (SAS, FC)',
      '- Поддержка шифрования (AES-256)',
      '- Управление (веб-интерфейс)',
      '- Совместимость с ПО резервного копирования (или эквивалентным)',
      '- Потребляемая мощность (не более, Вт)',
      '- Габариты (мм), масса (не более, кг)',
    ].join('\n'),
    patchPanel: '- Кол-во портов (12/24/48)\n- Тип (экранированная/неэкранированная)\n- Категория (Cat5e/Cat6/Cat6a)\n- Тип разъёмов (RJ-45)\n- Монтаж (rack 19\", высота U)\n- IDC-контакты (тип: 110/Krone)\n- Материал корпуса\n- Маркировка портов',
    mediaConverter: '- Тип преобразования (медь-оптика / оптика-оптика)\n- Скорость (100 Мбит/с / 1 Гбит/с / 10 Гбит/с)\n- Порт медный (RJ-45)\n- Порт оптический (SFP/SC/LC)\n- Тип оптического волокна (одномодовое/многомодовое)\n- Дальность передачи (не менее, км)\n- Питание (внешний адаптер / PoE)\n- Рабочая температура (диапазон)',
    patchCord: '- Категория (Cat5e/Cat6/Cat6a)\n- Тип (экранированный FTP/STP / неэкранированный UTP)\n- Длина (м)\n- Тип разъёмов (RJ-45)\n- Тип проводника (медь/омеднённый)\n- Сечение проводника (AWG)\n- Цвет оболочки\n- Материал оболочки (PVC/LSZH)',
    fiberCable: '- Тип волокна (одномодовое SM / многомодовое MM)\n- Кол-во волокон (не менее)\n- Категория (OM3/OM4 для MM, OS1/OS2 для SM)\n- Тип разъёмов (SC/LC/FC/ST)\n- Длина (м)\n- Тип оболочки (внутренняя/наружная/бронированная)\n- Материал оболочки (PVC/LSZH)',
    hdmiCable: '- Версия HDMI (1.4/2.0/2.1)\n- Длина (м)\n- Макс. разрешение (4K@60Гц / 8K@60Гц)\n- Поддержка ARC/eARC\n- Поддержка HDR\n- Тип разъёмов (HDMI Type A / Mini / Micro)\n- Материал проводника\n- Экранирование',
    powerCable: '- Тип разъёма (IEC C13-C14 / C19-C20 / Schuko / вилка-розетка)\n- Длина (м)\n- Сечение проводника (мм²)\n- Макс. ток (А)\n- Макс. мощность (Вт)\n- Цвет',
    rackCabinet: [
      '- Высота (U)',
      '- Тип (напольный/настенный)',
      '- Ширина (600/800 мм)',
      '- Глубина (мм)',
      '- Макс. статическая нагрузка (не менее, кг)',
      '- Материал корпуса (сталь, толщина, мм)',
      '- Передняя дверь (стеклянная/перфорированная, замок)',
      '- Задняя дверь (перфорированная/сплошная, замок)',
      '- Боковые панели (съёмные, замок)',
      '- Перфорация (не менее, % площади дверей)',
      '- Вентиляция (верхняя панель с вент. отверстиями/модулями)',
      '- Кабельные вводы (верх/низ)',
      '- Комплектация (вертикальные направляющие 19\", крепёж, заземление)',
      '- Регулируемые ножки и ролики',
      '- Класс защиты (IP)',
      '- Цвет (RAL)',
    ].join('\n'),
    serverRack: '- Высота (U)\n- Тип (открытая стойка / закрытый шкаф)\n- Ширина (600/800 мм)\n- Глубина (мм)\n- Макс. статическая нагрузка (не менее, кг)\n- Материал (сталь, толщина)\n- Направляющие 19\" (регулировка глубины)\n- Кабельные органайзеры\n- Заземление\n- Цвет (RAL)',
    serverBlade: [
      '- Форм-фактор (блейд)',
      '- Шасси (кол-во слотов)',
      '- Процессоры на модуль (кол-во сокетов, тип, ядра, частота)',
      '- Оперативная память на модуль (тип, объём, макс. объём, слоты DIMM)',
      '- Накопители на модуль (тип, кол-во, объём)',
      '- Сетевые интерфейсы (Ethernet, скорость, кол-во)',
      '- Коммутационный модуль (тип, пропускная способность)',
      '- Блоки питания шасси (мощность, резервирование)',
      '- Управление (IPMI/BMC)',
      '- Поддерживаемые ОС (или эквивалентные)',
      '- Потребляемая мощность шасси (не более, Вт)',
      '- Габариты шасси (мм), масса (не более, кг)',
    ].join('\n'),
    pdu: '- Тип (базовый / управляемый / с мониторингом / с переключением)\n- Входное напряжение (В)\n- Входной разъём (IEC C20 / IEC 60309 / клеммный блок)\n- Макс. входной ток (А)\n- Макс. мощность (кВА / Вт)\n- Кол-во выходных розеток (тип IEC C13, IEC C19)\n- Мониторинг (напряжение, ток, мощность, температура)\n- Интерфейс управления (Ethernet, SNMP, веб-интерфейс)\n- Монтаж (вертикальный rack 0U / горизонтальный 1U)\n- Длина кабеля питания (не менее, м)\n- Габариты (мм)',
    kvm_server: [
      '- Кол-во портов (подключаемых серверов)',
      '- Тип доступа (по IP / локальный)',
      '- Поддерживаемое разрешение видео (не менее)',
      '- Интерфейсы подключения серверов (USB, PS/2, VGA/DVI/HDMI)',
      '- Сетевые интерфейсы (Ethernet, кол-во)',
      '- Кол-во одновременных пользователей (не менее)',
      '- Виртуальные носители (ISO, USB-образы)',
      '- Шифрование (TLS, AES)',
      '- Аутентификация (LDAP, RADIUS)',
      '- Каскадирование (при наличии)',
      '- Монтаж (rack 19\", высота U)',
      '- Потребляемая мощность (не более, Вт)',
    ].join('\n'),
    toner: '- Совместимость (модели принтеров/МФУ — через «или эквивалент»)\n- Цвет (чёрный/голубой/пурпурный/жёлтый)\n- Объём / масса (г)\n- Ресурс (не менее, стр, при 5% заполнении)\n- Тип (оригинальный/совместимый)\n- Упаковка (оригинальная)',
    drum: '- Совместимость (модели принтеров/МФУ — через «или эквивалент»)\n- Ресурс (не менее, стр)\n- Тип (оригинальный/совместимый)\n- Цвет\n- Упаковка (оригинальная)',

    // ═══════ ПО: ДОПОЛНИТЕЛЬНЫЕ ТИПЫ ═══════
    crm: [
      '--- ГРУППА: Общие сведения ---',
      '- Тип ПО (CRM / управление взаимоотношениями с клиентами)',
      '- Версия / редакция',
      '--- ГРУППА: Функциональность ---',
      '- Ведение базы клиентов и контрагентов',
      '- Воронка продаж и сделки',
      '- Задачи и календарь',
      '- Электронная почта (интеграция)',
      '- Телефония (интеграция)',
      '- Отчётность и аналитика (дашборды)',
      '- Маркетинговые рассылки',
      '- Автоматизация бизнес-процессов',
      '- Управление заявками (тикеты)',
      '--- ГРУППА: Совместимость ---',
      '- Мобильное приложение (Android, iOS)',
      '- Веб-интерфейс',
      '- API для внешних интеграций',
      '- Интеграция с 1С (при необходимости)',
      '- Наличие в Едином реестре российского ПО Минцифры',
      '- Тип лицензии (по пользователям / подписка)',
      '- Срок технической поддержки (мес)',
    ].join('\n'),
    bi: [
      '--- ГРУППА: Общие сведения ---',
      '- Тип ПО (BI / аналитика данных)',
      '--- ГРУППА: Функциональность ---',
      '- Подключение к источникам данных (БД, файлы, API)',
      '- Визуализация (графики, диаграммы, карты)',
      '- Дашборды и отчёты',
      '- Интерактивные фильтры и drill-down',
      '- Расчётные показатели (формулы, DAX или эквивалент)',
      '- Совместный доступ и публикация отчётов',
      '- Экспорт (PDF, Excel, PNG)',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые СУБД (PostgreSQL, ClickHouse или эквивалентные)',
      '- Веб-интерфейс',
      '- Мобильное приложение',
      '- Наличие в Едином реестре российского ПО Минцифры',
      '- Тип лицензии',
      '- Срок технической поддержки (мес)',
    ].join('\n'),
    reporting: [
      '--- ГРУППА: Общие сведения ---',
      '- Тип ПО (система отчётности / генератор отчётов)',
      '--- ГРУППА: Функциональность ---',
      '- Конструктор отчётов (визуальный)',
      '- Шаблоны отчётов (кол-во встроенных)',
      '- Поддержка форматов вывода (PDF, Excel, Word, HTML)',
      '- Параметризованные отчёты',
      '- Расписание автоматической генерации отчётов',
      '- Распределение отчётов (e-mail, файловое хранилище)',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые СУБД (или эквивалентные)',
      '- Веб-интерфейс',
      '- Наличие в Едином реестре российского ПО Минцифры',
      '- Тип лицензии',
      '- Срок технической поддержки (мес)',
    ].join('\n'),
    rpa: [
      '--- ГРУППА: Общие сведения ---',
      '- Тип ПО (RPA / роботизация процессов)',
      '--- ГРУППА: Функциональность ---',
      '- Визуальный конструктор сценариев (low-code / no-code)',
      '- Запись действий пользователя',
      '- Работа с веб-приложениями (браузерная автоматизация)',
      '- Работа с десктоп-приложениями',
      '- Интеграция с API (REST, SOAP)',
      '- Оркестрация роботов (централизованное управление)',
      '- Журналирование и отчётность',
      '- Расписание запуска сценариев',
      '--- ГРУППА: Совместимость ---',
      '- Поддерживаемые ОС (или эквивалентные)',
      '- Наличие в Едином реестре российского ПО Минцифры',
      '- Тип лицензии (по роботам / по сценариям)',
      '- Срок технической поддержки (мес)',
    ].join('\n'),

    // ═══════ ОБОРУДОВАНИЕ: ИНСТРУМЕНТЫ И РАСХОДНЫЕ ═══════
    speakerphone: '- Тип (спикерфон для конференц-связи)\n- Кол-во встроенных микрофонов (не менее)\n- Зона покрытия микрофонов (не менее, м)\n- Подавление шума и эхо (наличие)\n- Динамик (мощность, Вт)\n- Подключение (USB / Bluetooth / NFC)\n- Каскадирование (подключение нескольких устройств)\n- Индикация (LED-кольцо)\n- Совместимость с ВКС-платформами (или эквивалентными)\n- Время автономной работы (не менее, час) — для беспроводных\n- Масса (не более, г)',
    speakers: '- Тип (2.0 / 2.1 / звуковая панель)\n- Суммарная мощность (не менее, Вт RMS)\n- Частотный диапазон (Гц)\n- Интерфейсы (USB / Jack 3.5 мм / Bluetooth)\n- Регулировка громкости\n- Питание (USB / сетевой адаптер)\n- Масса (не более, кг)',
    microphone: '- Тип (конденсаторный/динамический)\n- Направленность (кардиоидная/всенаправленная/двунаправленная)\n- Частотный диапазон (Гц)\n- Чувствительность (дБ)\n- Подключение (USB / XLR / Jack 3.5 мм)\n- Разрядность АЦП (бит) — для USB\n- Частота дискретизации (кГц) — для USB\n- Подавление шума\n- Крепление (настольная стойка / пантограф)\n- Поп-фильтр (в комплекте)\n- Совместимость с ОС',
    battery: '- Тип (Li-Ion / Li-Pol)\n- Ёмкость (не менее, мА·ч или Вт·ч)\n- Напряжение (В)\n- Совместимость (модели ноутбуков/устройств — через «или эквивалент»)\n- Кол-во ячеек\n- Гарантия (мес)',
    charger: '- Мощность (не менее, Вт)\n- Тип разъёма (USB Type-C / proprietary)\n- Поддержка быстрой зарядки (PD, QC или эквивалент)\n- Входное напряжение (диапазон, В)\n- Выходное напряжение/ток (В/А)\n- Длина кабеля (не менее, м)\n- Совместимость (модели устройств — через «или эквивалент»)',
    multimeter: '- Тип (цифровой)\n- Измеряемые параметры (напряжение AC/DC, ток AC/DC, сопротивление, ёмкость, частота, температура)\n- Диапазон измерения напряжения (В)\n- Диапазон измерения тока (А)\n- Точность (не хуже, %)\n- Дисплей (разрядность)\n- Автовыбор диапазона\n- Защита от перегрузки\n- Класс безопасности (CAT)\n- Питание (батарея)\n- Комплектация (щупы, термопара)',
    crimper: '- Тип (обжимной инструмент для разъёмов RJ-45 / RJ-11)\n- Поддерживаемые разъёмы\n- Встроенный стриппер (снятие оболочки кабеля)\n- Встроенный резак (обрезка кабеля)\n- Материал корпуса\n- Материал рукояток (резиновые накладки)',
    soldering: '- Мощность (не менее, Вт)\n- Тип (паяльная станция / паяльник)\n- Диапазон температур (°C)\n- Стабильность температуры (не хуже, °C)\n- Тип нагревательного элемента (керамический)\n- Сменные жала (в комплекте)\n- Антистатическая защита (ESD-safe)\n- Дисплей (индикация температуры)',
    flux: '- Тип (канифольный / безотмывочный / водосмываемый)\n- Форма (жидкий / гель / паста)\n- Объём (мл/г)\n- Температура активации (°C)\n- Остаток после пайки (чистый/требует промывки)',
    laminator: '- Формат (A4 / A3)\n- Макс. толщина плёнки (мкм)\n- Скорость ламинирования (не менее, мм/мин)\n- Время нагрева (не более, мин)\n- Кол-во валов (2/4/6)\n- Горячее и холодное ламинирование\n- Потребляемая мощность (не более, Вт)\n- Габариты (мм), масса (не более, кг)',
    shredder: '- Уровень секретности (DIN 66399, P-4/P-5/P-6/P-7)\n- Тип нарезки (перекрёстная / микронарезка)\n- Размер частиц (мм)\n- Кол-во листов за проход (не менее)\n- Скорость уничтожения (не менее, м/мин)\n- Объём корзины (не менее, л)\n- Уничтожение скрепок, скобок, пластиковых карт, CD/DVD\n- Автоматическая подача (при наличии)\n- Уровень шума (не более, дБА)\n- Потребляемая мощность (не более, Вт)',
    cleaner: '- Тип (спрей / салфетки / набор)\n- Назначение (для экранов / для оргтехники / универсальный)\n- Объём (мл) — для спрея\n- Кол-во салфеток в упаковке\n- Антистатический эффект\n- Безопасность для покрытий',
    faceplate: '- Кол-во портов (1/2/3)\n- Тип разъёмов (Keystone RJ-45 / оптический)\n- Монтаж (в стену / на DIN-рейку)\n- Материал (пластик)\n- Цвет\n- Маркировка',
};

const toolSetHint = [
  '- Назначение набора (универсальный / монтажный / сетевой / сервисный)',
  '- Количество предметов (не менее, шт)',
  '- Состав набора (отвертки, биты, торцевые головки, пассатижи, стриппер или эквивалент)',
  '- Материал рабочей части (CrV / S2 / инструментальная сталь или эквивалент)',
  '- Материал рукояток (двухкомпонентные / диэлектрические)',
  '- Наличие кейса / органайзера',
  '- Масса набора (не более, кг)',
  '- Гарантия производителя (мес)',
].join('\n');

const serviceElectronicsHint = [
  '- Назначение и тип изделия',
  '- Совместимость / поддерживаемые операции',
  '- Материал рабочей части / корпуса',
  '- Защитные свойства (ESD / антистатическое исполнение / термостойкость)',
  '- Габариты (мм), масса (не более, г)',
  '- Комплект поставки',
  '- Гарантия производителя (мес)',
].join('\n');

const keyboardMouseSetHint = [
  '- Состав комплекта (клавиатура и компьютерная мышь)',
  '- Тип подключения (проводное USB / беспроводное RF 2,4 ГГц / Bluetooth)',
  '- Раскладка клавиатуры (русская и латинская, заводская маркировка)',
  '- Количество клавиш клавиатуры (не менее, шт)',
  '- Тип клавишного механизма',
  '- Наличие цифрового блока',
  '- Тип сенсора мыши (оптический / лазерный)',
  '- Разрешение сенсора мыши (не менее, dpi)',
  '- Количество кнопок мыши (не менее, шт)',
  '- Беспроводной приёмник / кабель подключения',
  '- Длина кабеля или время автономной работы',
  '- Совместимость с ОС (или эквивалентными)',
  '- Цвет исполнения',
  '- Гарантия производителя (мес)',
].join('\n');

const cableTesterHint = [
  '- Тип устройства (LAN-тестер / кабельный тестер / телефонный тестер с генератором)',
  '- Поддерживаемые типы кабелей (витая пара, телефонный кабель, коаксиальный или эквивалент)',
  '- Поддерживаемые категории кабелей (Cat5e / Cat6 / Cat6A)',
  '- Поддерживаемые разъёмы (RJ-45, RJ-11, RJ-12, BNC или эквивалент)',
  '- Функции тестирования (обрыв, короткое замыкание, перепутанные пары, split pair, экранирование, трассировка кабеля, генерация тона при применимости)',
  '- Дальность тестирования (не менее, м)',
  '- Тип индикации (LED / LCD)',
  '- Наличие удалённого модуля и/или индуктивного щупа',
  '- Питание (батареи / аккумулятор)',
  '- Комплектность (основной блок, remote unit, батареи, чехол, документация)',
].join('\n');

const mobileAccessoryHint = [
  '- Назначение изделия',
  '- Совместимая диагональ / форм-фактор устройства',
  '- Материал корпуса / поверхности / крепления',
  '- Допустимая нагрузка (не менее, кг) или размеры совместимого устройства',
  '- Способ крепления / фиксации',
  '- Регулировки / эргономика (угол наклона, длина ремня, размеры карманов или эквивалент)',
  '- Цвет исполнения',
  '- Габариты (мм), масса (не более, г)',
  '- Гарантия производителя (мес)',
].join('\n');

const securePeripheralHint = [
  '- Назначение изделия',
  '- Интерфейс подключения (USB-A / USB-C / Bluetooth или эквивалент)',
  '- Поддерживаемые стандарты / форматы данных / типы носителей',
  '- Наличие аппаратной криптографической поддержки / защищённого исполнения (при применимости)',
  '- Совместимость с ОС и прикладным ПО (или эквивалентными)',
  '- Наличие драйверов / SDK / middleware',
  '- Включение в Реестр российской промышленной продукции (Минпромторг России) или реестр евразийской промышленной продукции в соответствии с ПП РФ от 23.12.2024 № 1875',
  '- Габариты (мм), масса (не более, г)',
  '- Комплект поставки',
  '- Гарантия производителя (мес)',
].join('\n');

const collaborationDisplayHint = [
  '- Назначение и тип устройства',
  '- Диагональ / поле обзора / рабочая область',
  '- Разрешение видео / изображения (не менее)',
  '- Яркость / контрастность / частота кадров / угол обзора (по типу изделия)',
  '- Поддерживаемые интерфейсы (HDMI, DisplayPort, USB, LAN, Wi‑Fi или эквивалент)',
  '- Встроенные динамики / микрофоны / сенсорный ввод (при наличии)',
  '- Поддержка крепления / монтажа и комплект поставки',
  '- Совместимость с ОС и ВКС-платформами (или эквивалентными)',
  '- Потребляемая мощность (не более, Вт)',
  '- Габариты (мм), масса (не более, кг)',
].join('\n');

const telephonyHint = [
  '- Тип устройства (IP-телефон / шлюз / контроллер / модем)',
  '- Поддерживаемые протоколы (SIP, RTP, SRTP, MGCP, LTE Cat или эквивалент)',
  '- Количество линий / каналов / SIM-слотов / абонентов (по типу изделия)',
  '- Поддерживаемые кодеки / частотные диапазоны / стандарты связи',
  '- Интерфейсы подключения (Ethernet, USB, FXS/FXO, RJ-11, консольный порт или эквивалент)',
  '- Питание (PoE / внешний адаптер / 12В DC или эквивалент)',
  '- Функции безопасности и управления (VLAN, VPN, QoS, веб-консоль, TR-069 или эквивалент)',
  '- Совместимость с АТС / платформами телефонии / операторами',
  '- Габариты (мм), масса (не более, кг)',
].join('\n');

const networkTransceiverHint = [
  '- Тип изделия (SFP / SFP+ / DAC / инжектор / сплиттер / сетевой адаптер)',
  '- Скорость передачи данных (не менее, Мбит/с или Гбит/с)',
  '- Тип портов / разъёмов (RJ-45, SFP, USB, PCIe, DC jack или эквивалент)',
  '- Дальность передачи / длина кабеля (не менее, м)',
  '- Поддержка PoE / стандартов 802.3af/at/bt / Auto-Negotiation (при применимости)',
  '- Поддерживаемая среда передачи (медь, одномод, многомод, twinax)',
  '- Совместимость с оборудованием / чипсетами / ОС (или эквивалентными)',
  '- Потребляемая мощность (не более, Вт)',
  '- Рабочая температура',
].join('\n');

const copperPassiveHint = [
  '- Тип изделия (коннектор / keystone-модуль / розетка / coupler)',
  '- Категория СКС (Cat5e / Cat6 / Cat6A)',
  '- Экранирование (UTP / FTP / STP)',
  '- Тип разъёма / конфигурация контактов (RJ-45 8P8C или эквивалент)',
  '- Совместимый проводник (одножильный / многожильный, AWG)',
  '- Материал контактов и покрытие',
  '- Тип монтажа (обжим / punch-down / tool-less / настенный)',
  '- Материал корпуса',
  '- Цвет / маркировка / комплектация',
].join('\n');

const fiberPassiveHint = [
  '- Тип изделия (патч-корд / пигтейл / панель / сплайс-кассета)',
  '- Тип волокна (SM OS2 / MM OM3/OM4 или эквивалент)',
  '- Тип коннекторов (LC / SC / FC / ST, UPC/APC)',
  '- Количество волокон / портов / адаптеров (не менее)',
  '- Длина кабеля / ёмкость кассеты / высота панели',
  '- Тип полировки и цветовая маркировка',
  '- Материал оболочки / корпуса, класс пожарной безопасности',
  '- Совместимость с типоразмерами стоек и кроссов',
  '- Комплект поставки',
].join('\n');

const storageAccessoryHint = [
  '- Тип изделия (внешний SSD/HDD, карта памяти, кардридер, привод, кассета или аксессуар)',
  '- Ёмкость / поддерживаемый объём (не менее, ГБ/ТБ)',
  '- Интерфейс подключения (USB 3.2, Type-C, SATA, SD, microSD, SAS, LTO или эквивалент)',
  '- Скорость чтения / записи или скорость передачи данных (не менее)',
  '- Поддерживаемые форматы носителей / типы карт / поколения лент',
  '- Совместимость с ОС и оборудованием (или эквивалентными)',
  '- Материал корпуса / наличие защитного кейса',
  '- Габариты (мм), масса (не более, г)',
  '- Гарантия производителя (мес)',
].join('\n');

const adapterCableHint = [
  '- Тип изделия и назначение',
  '- Тип входных и выходных разъёмов',
  '- Поддерживаемые стандарты / версии интерфейса',
  '- Максимальная длина линии / длина кабеля (не менее, м)',
  '- Максимальное поддерживаемое разрешение / пропускная способность / ток (по типу изделия)',
  '- Материал проводника и экранирование',
  '- Поддержка питания по шине / внешний адаптер (при необходимости)',
  '- Совместимость с оборудованием и ОС (или эквивалентными)',
  '- Комплект поставки',
].join('\n');

const rackAccessoryHint = [
  '- Тип изделия (полка / шкаф / органайзер / заглушка / комплект крепежа / рельсы)',
  '- Совместимый стандарт монтажа (19", 10", глубина стойки, U)',
  '- Материал корпуса / металла и толщина',
  '- Допустимая нагрузка (не менее, кг)',
  '- Тип крепления и регулировка по глубине / высоте',
  '- Покрытие и цвет (RAL)',
  '- Наличие крепежа / заземления / кабельных колец / роликов (по типу изделия)',
  '- Габариты (мм), масса (не более, кг)',
].join('\n');

const printerConsumableHint = [
  '- Тип расходного материала / узла',
  '- Совместимость с моделями печатающих устройств (через «или эквивалент»)',
  '- Цвет / тип печати / назначение',
  '- Ресурс (не менее, стр.) или объём / масса',
  '- Оригинальный / совместимый / восстановленный статус',
  '- Упаковка и защитная маркировка',
  '- Условия хранения / срок годности',
].join('\n');

const electricalConsumableHint = [
  '- Тип изделия и назначение',
  '- Размер / длина / диаметр / сечение',
  '- Материал основы / проводника / изоляции',
  '- Рабочее напряжение / температурный диапазон',
  '- Цвет исполнения',
  '- Класс горючести / термоусадка / клеевой слой (при применимости)',
  '- Количество в упаковке',
].join('\n');

const pcComponentHint = [
  '- Тип комплектующего и назначение',
  '- Интерфейс подключения / совместимый слот / разъём',
  '- Основные технические параметры по типу изделия',
  '- Совместимость с платформами, ОС и серверным/клиентским оборудованием (или эквивалентными)',
  '- Поддерживаемые стандарты / версии интерфейса',
  '- Потребляемая мощность / тепловыделение (при применимости)',
  '- Комплект поставки',
  '- Гарантия производителя (мес)',
].join('\n');

const remoteAccessSoftwareHint = [
  '--- ГРУППА: Общие сведения ---',
  '- Наименование и версия ПО удалённого доступа',
  '- Тип решения (удалённая поддержка / защищённый доступ / remote desktop gateway)',
  '--- ГРУППА: Функциональные возможности ---',
  '- Поддерживаемые протоколы доступа (RDP, VNC, SSH, HTTPS или эквивалент)',
  '- Количество одновременных сессий / операторов / администрируемых узлов (не менее)',
  '- Передача файлов, буфер обмена, печать и перенаправление USB (при наличии)',
  '- Запись сессий и журналирование действий',
  '- Ролевая модель доступа и разграничение прав',
  '- Двухфакторная аутентификация',
  '- Веб-консоль администратора / thick client',
  '--- ГРУППА: Совместимость ---',
  '- Поддерживаемые серверные и клиентские ОС (или эквивалентные)',
  '- Интеграция со службой каталогов (AD, LDAP, FreeIPA или эквивалент)',
  '- Наличие в Едином реестре российского ПО Минцифры',
  '- Тип лицензии (по операторам / по узлам / подписка)',
  '- Срок технической поддержки (мес)',
].join('\n');

const genericHardwareHint = [
  '- Тип изделия и функциональное назначение',
  '- Основные технические параметры и рабочие характеристики',
  '- Совместимость с оборудованием / ОС / стандартами (или эквивалентными)',
  '- Интерфейсы, разъёмы, крепление или способ монтажа',
  '- Материал корпуса / класс защиты / цвет',
  '- Габариты (мм), масса (не более, кг)',
  '- Комплект поставки',
  '- Гарантия производителя (мес)',
].join('\n');

const genericCableHint = [
  '- Тип кабеля / переходника и назначение',
  '- Типы разъёмов на концах',
  '- Длина (не менее, м)',
  '- Поддерживаемый стандарт / версия интерфейса',
  '- Материал проводника, экранирование, оболочка',
  '- Пропускная способность / допустимый ток / максимальное разрешение (по типу изделия)',
  '- Цвет и маркировка',
].join('\n');

const genericConsumableHint = [
  '- Тип расходного материала',
  '- Назначение / совместимость',
  '- Объём / масса / размер / количество в упаковке',
  '- Состав / материал',
  '- Срок годности / условия хранения',
  '- Упаковка и маркировка',
].join('\n');

const genericSoftwareHint = [
  '--- ГРУППА: Общие сведения ---',
  '- Наименование, версия и редакция ПО',
  '- Функциональное назначение продукта',
  '--- ГРУППА: Функциональность ---',
  '- Ключевые функциональные модули и сценарии использования',
  '- Веб-интерфейс / thick client / mobile client (при наличии)',
  '- API и механизмы интеграции',
  '- Ролевая модель доступа и аудит действий',
  '--- ГРУППА: Совместимость ---',
  '- Поддерживаемые ОС, СУБД, браузеры и аппаратные платформы (или эквивалентные)',
  '- Интеграция со службой каталогов / корпоративными системами',
  '--- ГРУППА: Лицензирование ---',
  '- Наличие в Едином реестре российского ПО Минцифры',
  '- Тип лицензии (по пользователям / серверу / подписка)',
  '- Срок технической поддержки (мес)',
  '- Документация на русском языке',
].join('\n');

const supplementalSpecHintsMap: Record<string, string> = {
  toolSet: toolSetHint,
  precisionScrewdriver: serviceElectronicsHint,
  desolderPump: serviceElectronicsHint,
  antistaticWristStrap: serviceElectronicsHint,
  antistaticMat: serviceElectronicsHint,
  keyboardMouseSet: keyboardMouseSetHint,
  cableTester: cableTesterHint,
  dockingStation: [
    '- Тип изделия (USB-C / Thunderbolt / универсальная док-станция)',
    '- Поддерживаемые видеовыходы (HDMI, DisplayPort, VGA), количество мониторов',
    '- Разрешение подключаемых мониторов (не менее)',
    '- Порты USB (тип, количество, скорость)',
    '- Сетевой интерфейс Ethernet (скорость)',
    '- Наличие кардридера, аудиоразъёма, Power Delivery',
    '- Совместимость с ОС и моделями ноутбуков (или эквивалентными)',
    '- Мощность питания PD (не менее, Вт)',
    '- Габариты (мм), масса (не более, г)',
  ].join('\n'),
  smartCardReader: securePeripheralHint,
  usbToken: securePeripheralHint,
  signaturePad: securePeripheralHint,
  graphicsTablet: securePeripheralHint,
  barcodeScanner: [
    '- Тип сканера (ручной / настольный / беспроводной)',
    '- Поддерживаемые форматы кодов (1D / 2D / QR / DataMatrix)',
    '- Дальность считывания (не менее, мм)',
    '- Интерфейс подключения (USB / Bluetooth / RF 2,4 ГГц)',
    '- Устойчивость к падениям / класс защиты IP',
    '- Скорость декодирования и индикация считывания',
    '- Совместимость с ОС и учётными системами',
    '- Комплект поставки и гарантия',
  ].join('\n'),
  labelPrinter: [
    '- Тип печати (термо / термотрансферная)',
    '- Ширина печати (не менее, мм)',
    '- Разрешение печати (не менее, dpi)',
    '- Скорость печати (не менее, мм/с)',
    '- Поддерживаемые размеры этикеток и втулки',
    '- Интерфейсы подключения (USB, Ethernet, Wi‑Fi, RS-232 или эквивалент)',
    '- Поддержка языков печати (ZPL, EPL, TSPL или эквивалент)',
    '- Ресурс печатающей головки и совместимые расходные материалы',
  ].join('\n'),
  receiptPrinter: [
    '- Тип печати (термопечать)',
    '- Ширина чековой ленты (57/80 мм)',
    '- Скорость печати (не менее, мм/с)',
    '- Разрешение печати (не менее, dpi)',
    '- Наличие автоотреза',
    '- Интерфейсы подключения (USB, Ethernet, Bluetooth, Wi‑Fi, RS-232 или эквивалент)',
    '- Поддержка команд ESC/POS или эквивалент',
    '- Ресурс термоголовки и автоотреза',
  ].join('\n'),
  monitorArm: mobileAccessoryHint,
  laptopBag: mobileAccessoryHint,
  laptopStand: mobileAccessoryHint,
  mousePad: mobileAccessoryHint,
  presentationClicker: mobileAccessoryHint,
  privacyFilter: mobileAccessoryHint,
  laptopLock: mobileAccessoryHint,
  touchMonitor: collaborationDisplayHint,
  conferenceCamera: collaborationDisplayHint,
  documentCamera: collaborationDisplayHint,
  projectorScreen: collaborationDisplayHint,
  tvPanel: collaborationDisplayHint,
  ipPhone: telephonyHint,
  voipGateway: telephonyHint,
  wifiController: telephonyHint,
  lteModem: telephonyHint,
  consoleServer: telephonyHint,
  sfpModule: networkTransceiverHint,
  sfpDac: networkTransceiverHint,
  poeInjector: networkTransceiverHint,
  poeSplitter: networkTransceiverHint,
  networkAdapter: networkTransceiverHint,
  rj45Connector: copperPassiveHint,
  keystoneJack: copperPassiveHint,
  networkSocket: copperPassiveHint,
  rj45Coupler: copperPassiveHint,
  fiberPatchCord: fiberPassiveHint,
  fiberPigtail: fiberPassiveHint,
  fiberPatchPanel: fiberPassiveHint,
  spliceTray: fiberPassiveHint,
  extSsd: storageAccessoryHint,
  extHdd: storageAccessoryHint,
  memoryCard: storageAccessoryHint,
  cardReader: storageAccessoryHint,
  opticalDrive: storageAccessoryHint,
  ltoTape: storageAccessoryHint,
  ltoCleaningCartridge: storageAccessoryHint,
  discCase: storageAccessoryHint,
  discSleeve: storageAccessoryHint,
  audioCable: adapterCableHint,
  serialCable: adapterCableHint,
  consoleCable: adapterCableHint,
  hdmiSplitter: adapterCableHint,
  hdmiSwitcher: adapterCableHint,
  usbExtender: adapterCableHint,
  kvmExtender: adapterCableHint,
  usbAdapter: adapterCableHint,
  videoAdapter: adapterCableHint,
  surgeProtector: adapterCableHint,
  extensionCord: adapterCableHint,
  plugAdapter: adapterCableHint,
  rackShelf: rackAccessoryHint,
  wallCabinet: rackAccessoryHint,
  cableManagerRack: rackAccessoryHint,
  blankPanel: rackAccessoryHint,
  cageNutSet: rackAccessoryHint,
  serverRailKit: rackAccessoryHint,
  inkCartridge: printerConsumableHint,
  thermalPaper: printerConsumableHint,
  fuserUnit: printerConsumableHint,
  transferBelt: printerConsumableHint,
  wasteToner: printerConsumableHint,
  developerUnit: printerConsumableHint,
  maintenanceKitPrinter: printerConsumableHint,
  printHead: printerConsumableHint,
  electricalTape: electricalConsumableHint,
  heatShrinkTube: electricalConsumableHint,
  solderWire: electricalConsumableHint,
  cableTie: electricalConsumableHint,
  cableChannel: electricalConsumableHint,
  pcCase: pcComponentHint,
  caseFan: pcComponentHint,
  tpmModule: pcComponentHint,
  soundCard: pcComponentHint,
  captureCard: pcComponentHint,
  raidController: pcComponentHint,
  hbaAdapter: pcComponentHint,
  upsBattery: pcComponentHint,
  remoteAccessSw: remoteAccessSoftwareHint,
  miscHardware: genericHardwareHint,
  miscCable: genericCableHint,
  miscConsumable: genericConsumableHint,
  miscSoftware: genericSoftwareHint,
};

function getDetailedSpecHint(type: string): string {
  return specHintsMap[type] ?? supplementalSpecHintsMap[type] ?? '';
}

const SIMPLE_SUPPLY_TYPES = new Set([
  'flashDrive', 'dvd', 'patchCord', 'fiberCable', 'hdmiCable', 'powerCable', 'cartridge', 'paper', 'toner', 'drum',
  'battery', 'batteryLithium', 'thermalPaste', 'cleaningSet', 'usbCable', 'labelTape', 'mousePad', 'shredderOil',
  'presentationClicker', 'rj45Connector', 'keystoneJack', 'networkSocket', 'rj45Coupler', 'fiberPatchCord',
  'fiberPigtail', 'spliceTray', 'discCase', 'discSleeve', 'audioCable', 'serialCable', 'consoleCable',
  'usbAdapter', 'surgeProtector', 'extensionCord', 'plugAdapter', 'electricalTape', 'heatShrinkTube',
  'solderWire', 'cableTie', 'cableChannel', 'thermalPaper', 'wasteToner',
]);

const COMPUTE_HW_TYPES = new Set([
  'pc', 'laptop', 'monoblock', 'server', 'tablet', 'thinClient', 'serverBlade', 'nas', 'san', 'miniPc',
  'industrialPc', 'workstation', 'aioPc',
]);

const DISPLAY_AV_TYPES = new Set([
  'monitor', 'touchMonitor', 'tvPanel', 'interactive', 'projector', 'projectorScreen', 'webcam', 'conferenceCamera',
  'documentCamera', 'headset', 'speakers', 'microphone', 'speakerphone', 'graphicsTablet', 'signaturePad',
]);

const NETWORK_INFRA_TYPES = new Set([
  'switch', 'router', 'firewall', 'accessPoint', 'mediaConverter', 'patchPanel', 'kvm_server', 'voipGateway',
  'wifiController', 'lteModem', 'consoleServer', 'sfpModule', 'sfpDac', 'poeInjector', 'poeSplitter',
  'networkAdapter', 'fiberPatchPanel', 'wallCabinet', 'rackCabinet', 'serverRack', 'pdu',
]);

const PRINT_DOC_TYPES = new Set([
  'printer', 'mfu', 'scanner', 'barcodeScanner', 'receiptPrinter', 'labelPrinter', 'laminator', 'shredder',
  'smartCardReader',
]);

const STORAGE_COMPONENT_TYPES = new Set([
  'ssd', 'hdd', 'ram', 'tapeLib', 'cpu', 'gpu', 'motherboard', 'psu', 'cooling', 'parts', 'extSsd', 'extHdd',
  'memoryCard', 'cardReader', 'opticalDrive', 'ltoTape', 'ltoCleaningCartridge', 'pcCase', 'caseFan',
  'tpmModule', 'soundCard', 'captureCard', 'raidController', 'hbaAdapter', 'upsBattery',
]);

const ACCESSORY_TYPES = new Set([
  'keyboard', 'mouse', 'keyboardMouseSet', 'kvm', 'ups', 'dockingStation', 'monitorArm', 'laptopBag',
  'laptopStand', 'charger', 'usbToken', 'privacyFilter', 'laptopLock', 'cleaner', 'faceplate', 'usbHub',
  'kvmExtender', 'usbExtender', 'videoAdapter', 'hdmiSplitter', 'hdmiSwitcher', 'rackShelf', 'blankPanel',
  'cageNutSet', 'serverRailKit',
]);

const SOFTWARE_INFRA_TYPES = new Set([
  'os', 'office', 'virt', 'vdi', 'dbms', 'backup_sw', 'itsm', 'monitoring', 'mdm', 'gis', 'email', 'ldap',
  'remoteAccessSw', 'license',
]);

const SOFTWARE_SECURITY_TYPES = new Set([
  'antivirus', 'edr', 'firewall_sw', 'dlp', 'siem', 'crypto', 'waf', 'pam', 'iam', 'pki', 'vpn',
]);

const SOFTWARE_BUSINESS_TYPES = new Set([
  'erp', 'cad', 'vks', 'ecm', 'portal', 'project_sw', 'bpm', 'hr',
]);

const GENERIC_SPEC_VALUE_RE = /(по типу( товара| программного обеспечения)?|по назначению|в соответствии с технической документацией производителя( и требованиями заказчика)?|по условиям поставки и требованиям заказчика|актуальная поддерживаемая версия по документации производителя|в соответствии с требованиями заказчика|при необходимости|по описанию|по согласованию с заказчиком|типовая конфигурация|конкретное значение|согласно документации|согласно требованиям|или иное по требованию|или иное — по требованию|уточнить при необходимости)/i;

type SpecUpsertEntry = { spec: SpecItem; aliases?: string[] };

function isWeakSpecValue(spec: SpecItem): boolean {
  const value = String(spec.value || '').replace(/\s+/g, ' ').trim();
  if (!value) return true;
  return GENERIC_SPEC_VALUE_RE.test(value);
}

function getWeakSpecEntries(specs: SpecItem[]): SpecItem[] {
  return specs.filter(isWeakSpecValue);
}

function isBackendTimeoutMessage(message: string): boolean {
  const text = String(message || '').toLowerCase();
  return text.includes('превышено время ожидания сервера')
    || text.includes('application failed to respond')
    || text.includes('timeout')
    || text.includes('timed out')
    || text.includes('failed to fetch')
    || text.includes('network');
}

function normalizeSourceFailureMessage(message: string, source: 'internet' | 'eis' | 'ai' = 'ai'): string {
  if (!isBackendTimeoutMessage(message)) return message;
  if (source === 'eis') return 'поиск в ЕИС занял слишком много времени';
  if (source === 'internet') return 'поиск характеристик занял слишком много времени';
  return 'генерация заняла слишком много времени';
}

function isAiProviderAuthErrorMessage(message: string): boolean {
  const text = String(message || '').toLowerCase();
  return text.includes('ai error 401')
    || text.includes('invalid api key')
    || text.includes('authentication fails')
    || text.includes('authentication_error')
    || text.includes('unauthorized');
}

function normalizeRowFailureMessage(
  row: Pick<GoodsRow, 'type' | 'model'>,
  message: string,
  source: 'internet' | 'eis' | 'ai' = 'ai',
): string {
  const raw = String(message || '').trim();
  const normalized = normalizeSourceFailureMessage(raw, source);
  if (!looksLikeSpecificModelQuery(row.model)) {
    return normalized || 'характеристики не найдены';
  }
  const failureLooksLikeNoData = !raw
    || raw === 'error'
    || raw === 'generation_error'
    || /характеристики не найдены|данные еис не найдены|failed|abort|timeout|timed out|application failed to respond/i.test(raw);
  if (failureLooksLikeNoData || isBackendTimeoutMessage(raw)) {
    return 'не удалось найти подтвержденные характеристики указанной модели';
  }
  return normalized || 'не удалось найти подтвержденные характеристики указанной модели';
}

const SPECIFIC_MODEL_TEMPLATE_FALLBACK_TYPES = new Set([
  ...SIMPLE_SUPPLY_TYPES,
  'toolSet', 'precisionScrewdriver', 'handTools',
  'paperA4', 'paperA3', 'stationerySet', 'pen', 'folder', 'envelope',
  'detergent', 'trashBin', 'paperTowelDispenser', 'toiletPaper',
  'usbToken', 'smartCardReader', 'dockingStation', 'monitorArm',
  'laptopBag', 'laptopStand', 'keyboardMouseSet', 'mousePad',
  'graphicsTablet', 'signaturePad', 'headset', 'speakers', 'microphone',
  'webcam', 'videoAdapter', 'discCase', 'discSleeve',
]);

function canFallbackToCatalogTemplateForSpecificModel(type: string): boolean {
  return SPECIFIC_MODEL_TEMPLATE_FALLBACK_TYPES.has(type);
}

function buildCatalogTemplateFallback(row: GoodsRow): { specs: SpecItem[]; meta: Record<string, string> } | null {
  const g = lookupCatalog(row.type);
  const deterministicSpecs = getAstraDeterministicSpecs(row);
  if (deterministicSpecs && deterministicSpecs.length > 0) {
    return {
      specs: adjustSpecsForCommercialContext(row, deterministicSpecs),
      meta: normalizeResolvedMeta(row.type, {
        okpd2_code: g.okpd2,
        okpd2_name: g.okpd2name,
        ktru_code: g.ktruFixed ?? '',
        classification_source: 'catalog',
      }),
    };
  }
  if (g.hardTemplate && g.hardTemplate.length > 0) {
    return {
      specs: adjustSpecsForCommercialContext(
        row,
        (g.hardTemplate as HardSpec[]).map((s) => ({ group: s.group, name: s.name, value: s.value, unit: s.unit ?? '' })),
      ),
      meta: normalizeResolvedMeta(row.type, {
        okpd2_code: g.okpd2,
        okpd2_name: g.okpd2name,
        ktru_code: g.ktruFixed ?? '',
        nac_regime: getUnifiedNacRegime(row.type),
        classification_source: 'catalog',
      }),
    };
  }
  return null;
}

function getTypeFamilyMinimum(row: GoodsRow): number {
  if (SIMPLE_SUPPLY_TYPES.has(row.type)) return 24;
  if (ACCESSORY_TYPES.has(row.type)) return 28;
  if (DISPLAY_AV_TYPES.has(row.type) || NETWORK_INFRA_TYPES.has(row.type) || COMPUTE_HW_TYPES.has(row.type) || STORAGE_COMPONENT_TYPES.has(row.type) || PRINT_DOC_TYPES.has(row.type)) {
    return 30;
  }
  return 30;
}

function getMinimumSpecCount(row: GoodsRow, resolvedCommercial = getResolvedCommercialContext(row)): number {
  const g = lookupCatalog(row.type);
  const isSW = !!g.isSoftware;
  const isService = !!g.isService;
  const modelLower = String(row.model || '').toLowerCase().replace(/ё/g, 'е');
  const isLicenseContext = Boolean(resolvedCommercial.suggestedLicenseType) || /лицензи[яию]|license|подписк[аи]/i.test(modelLower);
  const isSupportContext = row.type === 'supportCert'
    || row.type === 'osSupport'
    || /техподдержк|тех[\.\s]*поддержк|support|сопровождени/i.test(modelLower);

  if (row.type === 'ldap' && (
    resolvedCommercial.ldapProfile === 'client_device'
    || resolvedCommercial.ldapProfile === 'client_user'
    || resolvedCommercial.ldapProfile === 'client'
  )) {
    return 28;
  }
  if (row.type === 'ldap' && (
    resolvedCommercial.ldapProfile === 'server'
    || resolvedCommercial.ldapProfile === 'combined'
  )) {
    return 38;
  }
  if (row.type === 'os' && isAstraLinuxContext(row)) {
    return 45;
  }
  if (isLicenseContext || isSupportContext) {
    return 40;
  }
  if (isService) {
    return 22;
  }
  return isSW ? 40 : getTypeFamilyMinimum(row);
}

function getCatalogDepthProfileEntries(row: GoodsRow, resolved = getResolvedCommercialContext(row)): SpecUpsertEntry[] {
  const isSW = !!lookupCatalog(row.type)?.isSoftware;
  const isService = !!lookupCatalog(row.type)?.isService;
  const entries: SpecUpsertEntry[] = [];

  if (isSW) {
    entries.push(
      { spec: { group: 'Эксплуатация', name: 'Веб-интерфейс администрирования', value: 'наличие административной консоли или иного штатного интерфейса управления', unit: 'наличие' } },
      { spec: { group: 'Безопасность', name: 'Ролевая модель доступа (RBAC)', value: 'наличие разграничения прав пользователей и администраторов', unit: 'наличие' } },
      { spec: { group: 'Безопасность', name: 'Аудит действий пользователей и администраторов', value: 'наличие регистрации действий с возможностью последующего анализа', unit: 'наличие' } },
      { spec: { group: 'Безопасность', name: 'Журналирование системных событий', value: 'наличие журналов работы, ошибок и событий безопасности', unit: 'наличие' } },
      { spec: { group: 'Интеграция', name: 'Интеграция со службой каталогов', value: 'LDAP, Active Directory, ALD Pro или эквивалентные механизмы при поддержке производителем', unit: 'совместимость' } },
      { spec: { group: 'Интеграция', name: 'API / средства автоматизации', value: 'REST API, CLI, webhooks или эквивалентные средства интеграции и автоматизации', unit: 'наличие' } },
      { spec: { group: 'Эксплуатация', name: 'Масштабирование и отказоустойчивость', value: 'поддержка масштабирования и отказоустойчивой схемы развёртывания в рамках редакции поставки', unit: 'наличие' } },
      { spec: { group: 'Эксплуатация', name: 'Резервное копирование конфигурации', value: 'наличие штатных средств экспорта, резервного копирования и восстановления конфигурации', unit: 'наличие' } },
      { spec: { group: 'Лицензирование', name: 'Способ поставки', value: 'электронная поставка лицензий, ключей активации и дистрибутива', unit: 'тип' } },
      { spec: { group: 'Лицензирование', name: 'Обновления и исправления безопасности', value: 'предоставление обновлений и патчей безопасности в период действия лицензии или техподдержки', unit: 'наличие' } },
      { spec: { group: 'Лицензирование', name: 'Документация на русском языке', value: 'руководство администратора и/или пользователя в электронном виде', unit: 'наличие' } },
      { spec: { group: 'Лицензирование', name: 'Наличие в Едином реестре российского ПО Минцифры России', value: 'наличие', unit: 'наличие' }, aliases: ['Наличие в Едином реестре российского ПО Минцифры России'] },
    );
  } else if (!isService) {
    entries.push(
      { spec: { group: 'Общие сведения', name: 'Состояние товара', value: 'новый, не бывший в эксплуатации, не восстановленный и не бывший в ремонте', unit: 'состояние' } },
      { spec: { group: 'Общие сведения', name: 'Комплект поставки', value: 'изделие, штатные кабели/крепёж/адаптеры питания и эксплуатационная документация по составу производителя', unit: 'комплект' } },
      { spec: { group: 'Общие сведения', name: 'Документация на русском языке', value: 'наличие паспорта, руководства пользователя или иной эксплуатационной документации на русском языке', unit: 'наличие' } },
      { spec: { group: 'Гарантийные обязательства', name: 'Гарантия производителя', value: 'не менее 12', unit: 'мес' } },
      { spec: { group: 'Гарантийные обязательства', name: 'Упаковка', value: 'заводская упаковка, обеспечивающая защиту изделия при транспортировании и хранении', unit: 'тип' } },
    );
  }

  if (new Set(['pc', 'server', 'thinClient', 'monoblock']).has(row.type)) {
    entries.push(
      { spec: { group: 'Совместимость', name: 'Совместимость с отечественными ОС', value: 'Astra Linux, ALT Linux, РЕД ОС или эквивалентные операционные системы при поддержке производителем', unit: 'совместимость' } },
      { spec: { group: 'Интерфейсы и коммуникации', name: 'Сетевой интерфейс', value: 'не менее 1 порта Ethernet RJ-45 со скоростью не ниже 1 Гбит/с', unit: 'порт' } },
    );
  } else if (new Set(['laptop', 'tablet']).has(row.type)) {
    entries.push(
      { spec: { group: 'Совместимость', name: 'Совместимость с отечественными ОС', value: 'Astra Linux, ALT Linux, РЕД ОС или эквивалентные операционные системы при поддержке производителем', unit: 'совместимость' } },
    );
  }

  if (DISPLAY_AV_TYPES.has(row.type)) {
    entries.push(
      { spec: { group: 'Изображение и звук', name: 'Основные интерфейсы подключения', value: 'HDMI, DisplayPort, USB, аудиоинтерфейсы или эквивалентные интерфейсы по типу устройства', unit: 'интерфейс' } },
      { spec: { group: 'Изображение и звук', name: 'Яркость / чувствительность / громкость', value: 'не ниже значений, достаточных для штатной эксплуатации в офисных и учебных помещениях', unit: 'соответствие' } },
      { spec: { group: 'Изображение и звук', name: 'Поддержка мультимедийных функций', value: 'наличие встроенных средств воспроизведения/захвата аудио и видео по типу устройства', unit: 'наличие' } },
      { spec: { group: 'Монтаж и размещение', name: 'Крепление / размещение', value: 'наличие штатных средств настольного, настенного или стоечного размещения по типу устройства', unit: 'наличие' } },
      { spec: { group: 'Монтаж и размещение', name: 'Антибликовое исполнение / эргономика', value: 'наличие мер, снижающих блики и обеспечивающих длительную эксплуатацию без ухудшения качества изображения', unit: 'наличие' } },
    );
  }

  if (NETWORK_INFRA_TYPES.has(row.type)) {
    entries.push(
      { spec: { group: 'Сетевые функции', name: 'Поддержка IPv4 / IPv6', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Сетевые функции', name: 'Поддержка VLAN и сегментации трафика', value: 'наличие в рамках функционального класса устройства', unit: 'наличие' } },
      { spec: { group: 'Сетевые функции', name: 'Поддержка QoS / приоритизации трафика', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Управление и мониторинг', name: 'Протоколы управления и мониторинга', value: 'SSHv2, HTTPS, SNMP, Syslog или эквивалентные механизмы', unit: 'протокол' } },
      { spec: { group: 'Управление и мониторинг', name: 'Обновление встроенного ПО', value: 'наличие штатных средств загрузки и установки обновлений микропрограмм', unit: 'наличие' } },
      { spec: { group: 'Монтаж и питание', name: 'Исполнение для монтажа', value: 'настольное, настенное или стоечное исполнение в зависимости от класса устройства', unit: 'исполнение' } },
    );
  }

  if (PRINT_DOC_TYPES.has(row.type)) {
    entries.push(
      { spec: { group: 'Функциональные возможности', name: 'Поддерживаемые форматы носителей', value: 'наличие поддержки основных форматов бумаги и носителей по классу устройства', unit: 'формат' } },
      { spec: { group: 'Функциональные возможности', name: 'Автоматический двусторонний режим', value: 'наличие для печати и/или сканирования при применимости к классу устройства', unit: 'наличие' } },
      { spec: { group: 'Функциональные возможности', name: 'Сетевой доступ и совместное использование', value: 'поддержка подключения по USB, Ethernet, Wi‑Fi или эквивалентным интерфейсам по типу устройства', unit: 'наличие' } },
      { spec: { group: 'Функциональные возможности', name: 'Поддержка драйверов и стандартов печати / сканирования', value: 'TWAIN, WIA, ESC/POS, PCL, PostScript или эквивалентные стандарты при применимости', unit: 'стандарт' } },
      { spec: { group: 'Эксплуатация', name: 'Ресурс и производительность', value: 'значения месячной нагрузки, ресурса узлов и производительности не ниже требований заявленного класса устройства', unit: 'соответствие' } },
    );
  }

  if (STORAGE_COMPONENT_TYPES.has(row.type)) {
    entries.push(
      { spec: { group: 'Основные характеристики', name: 'Интерфейс подключения / шина данных', value: 'SATA, SAS, NVMe, PCIe, DIMM, M.2, U.2 или эквивалент по типу изделия', unit: 'интерфейс' } },
      { spec: { group: 'Основные характеристики', name: 'Форм-фактор / исполнение', value: 'значение по типу изделия и совместимому оборудованию', unit: 'форм-фактор' } },
      { spec: { group: 'Надёжность и защита данных', name: 'Поддержка механизмов контроля состояния', value: 'SMART, ECC, мониторинг температуры, ошибок или эквивалентные механизмы при применимости', unit: 'наличие' } },
      { spec: { group: 'Надёжность и защита данных', name: 'Показатели надёжности', value: 'параметры ресурса, MTBF, TBW или иные показатели надёжности не ниже класса изделия', unit: 'соответствие' } },
      { spec: { group: 'Совместимость', name: 'Совместимость с платформой', value: 'совместимость с серверными, настольными или мобильными платформами по назначению изделия', unit: 'совместимость' } },
    );
  }

  if (ACCESSORY_TYPES.has(row.type) || SIMPLE_SUPPLY_TYPES.has(row.type)) {
    entries.push(
      { spec: { group: 'Совместимость', name: 'Совместимость и применимость', value: 'совместимость с типовыми устройствами и инфраструктурой по назначению изделия', unit: 'совместимость' } },
      { spec: { group: 'Материалы и исполнение', name: 'Материал корпуса / оболочки / расходного элемента', value: 'материал, обеспечивающий штатную эксплуатацию по назначению изделия', unit: 'материал' } },
      { spec: { group: 'Эксплуатация', name: 'Условия хранения и транспортирования', value: 'в соответствии с требованиями производителя и типом изделия без ухудшения потребительских свойств', unit: 'условие' } },
    );
  }

  if (SOFTWARE_INFRA_TYPES.has(row.type)) {
    entries.push(
      { spec: { group: 'Эксплуатация', name: 'Поддержка отказоустойчивой схемы развёртывания', value: 'наличие возможности развёртывания в отказоустойчивой или кластерной конфигурации в рамках редакции поставки', unit: 'наличие' } },
      { spec: { group: 'Интеграция', name: 'Импорт / миграция данных и настроек', value: 'наличие штатных средств импорта, миграции и передачи конфигурации из смежных систем или предыдущих версий', unit: 'наличие' } },
      { spec: { group: 'Интеграция', name: 'Экспорт данных и журналов', value: 'наличие механизмов экспорта данных, отчётов и журналов в открытых форматах', unit: 'наличие' } },
      { spec: { group: 'Эксплуатация', name: 'Средства мониторинга и оповещений', value: 'наличие штатных механизмов контроля состояния, уведомлений и диагностических сообщений', unit: 'наличие' } },
    );
  }

  if (SOFTWARE_SECURITY_TYPES.has(row.type)) {
    entries.push(
      { spec: { group: 'Безопасность', name: 'Двухфакторная аутентификация администраторов', value: 'поддержка при необходимости', unit: 'наличие' } },
      { spec: { group: 'Безопасность', name: 'Шифрование трафика управления', value: 'TLS 1.2 и выше', unit: 'версия' } },
      { spec: { group: 'Безопасность', name: 'Срок хранения журналов безопасности', value: 'не менее 365', unit: 'сут' } },
      { spec: { group: 'Безопасность', name: 'Интеграция с внешними системами мониторинга ИБ', value: 'поддержка Syslog, SIEM, внешних оповещений или эквивалентных механизмов', unit: 'наличие' } },
      { spec: { group: 'Безопасность', name: 'Разграничение административных ролей', value: 'наличие', unit: 'наличие' } },
    );
  }

  if (SOFTWARE_BUSINESS_TYPES.has(row.type)) {
    entries.push(
      { spec: { group: 'Функциональные возможности', name: 'Веб-клиент / рабочее место пользователя', value: 'наличие веб-клиента, desktop-клиента или иного штатного пользовательского интерфейса', unit: 'наличие' } },
      { spec: { group: 'Функциональные возможности', name: 'Поиск, фильтрация и отчётность', value: 'наличие штатных средств поиска, фильтрации, построения отчётов и выгрузки данных', unit: 'наличие' } },
      { spec: { group: 'Функциональные возможности', name: 'Уведомления и маршрутизация событий', value: 'наличие уведомлений, задач, маршрутов согласования или иных событийных механизмов по классу продукта', unit: 'наличие' } },
      { spec: { group: 'Интеграция', name: 'Импорт / экспорт данных в открытых форматах', value: 'наличие', unit: 'наличие' } },
    );
  }

  if (resolved.suggestedLicenseType) {
    entries.push({
      spec: {
        group: 'Лицензирование',
        name: 'Метрика лицензирования',
        value: row.type === 'ldap'
          ? 'серверная часть, клиентские лицензии CAL, CAL на устройство или CAL на пользователя в зависимости от выбранного состава'
          : resolved.suggestedLicenseType,
        unit: 'метрика',
      },
      aliases: ['Метрика лицензирования'],
    });
  }

  return entries;
}

function enrichSpecsByCatalogDepth(row: GoodsRow, specs: SpecItem[], resolved = getResolvedCommercialContext(row)): SpecItem[] {
  return upsertSpecBatch(specs, getCatalogDepthProfileEntries(row, resolved));
}

// ── Промпты по типу товара ────────────────────────────────────────────────────
function getLdapRoleHint(profile: LdapLicenseProfile, effectiveLicenseType: string): string {
  if (profile === 'server') {
    return `ДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ ДЛЯ ALD PRO SERVER:
- Закупается серверная часть / контроллер домена
- Обязательно включить характеристики контроллера домена: иерархия подразделений, сайты, топология репликации, multi-master, интеграция с DHCP/DNS, PXE/netboot
- Включить миграцию из Microsoft Active Directory с сохранением структуры
- Включить групповые политики на базе SaltStack или эквивалентного механизма
- В характеристиках лицензирования указать: "${effectiveLicenseType || 'Серверная часть'}"
`;
  }

  if (profile === 'client_device' || profile === 'client_user' || profile === 'client') {
    const licenseObject = profile === 'client_user'
      ? 'пользователь'
      : profile === 'client_device'
        ? 'устройство'
        : 'устройство или пользователь';
    return `ДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ ДЛЯ ALD PRO CLIENT / CAL:
- Закупается ТОЛЬКО клиентская лицензия CAL, не серверная часть
- Не включать серверные инфраструктурные характеристики контроллера домена: сайты, репликация каталога, multi-master, DNS-зоны, DHCP/DNS-сервисы, PXE/netboot, отказоустойчивый кластер
- Сделать акцент на правах клиентской лицензии: право управления одним объектом (${licenseObject}) через доменные политики и конфигурации хоста
- Обязательно включить совместимость с серверной частью ALD Pro и применение групповых политик / SaltStack-конфигураций
- В характеристиках лицензирования указать: "${effectiveLicenseType || 'Клиентская часть (CAL)'}"
`;
  }

  if (profile === 'combined') {
    return `ДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ ДЛЯ ALD PRO:
- Закупается комплект "серверная часть + CAL"
- Включить как характеристики контроллера домена, так и права клиентских лицензий на управление устройствами/пользователями
- В характеристиках лицензирования указать комплектный состав: "${effectiveLicenseType || 'Серверная часть + CAL'}"
`;
  }

  return '';
}

function normalizeSpecName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAldProContext(row: GoodsRow): boolean {
  if (row.type !== 'ldap') return false;
  const haystack = normalizeBundleText(`${row.model} ${row.licenseType}`);
  return /(ald pro|алд про|astra linux directory|astra ald|ред адм|red adm)/.test(haystack);
}

function isAstraLinuxContext(row: GoodsRow): boolean {
  if (row.type !== 'os') return false;
  const haystack = normalizeBundleText(`${row.model} ${row.licenseType}`);
  return /(astra linux|астра линукс|астра linux|special edition|smolensk|voronezh|смоленск|воронеж)/.test(haystack);
}

function upsertSpec(
  specs: SpecItem[],
  spec: SpecItem,
  aliases: string[] = [String(spec.name || '')],
): SpecItem[] {
  const aliasSet = new Set(aliases.map(normalizeSpecName));
  const idx = specs.findIndex((item) => aliasSet.has(normalizeSpecName(String(item.name || ''))));
  if (idx >= 0) {
    const next = [...specs];
    next[idx] = { ...next[idx], ...spec };
    return next;
  }
  return [...specs, spec];
}

function upsertSpecBatch(
  specs: SpecItem[],
  entries: Array<{ spec: SpecItem; aliases?: string[] }>,
): SpecItem[] {
  let next = [...specs];
  for (const entry of entries) {
    next = upsertSpec(next, entry.spec, entry.aliases);
  }
  return next;
}

function adjustSpecsForCommercialContext(row: GoodsRow, specs: SpecItem[]): SpecItem[] {
  const resolved = getResolvedCommercialContext(row);
  let next = [...specs];
  const isAldPro = isAldProContext(row);
  const isAstraLinux = isAstraLinuxContext(row);

  if (isAstraLinux) {
    next = upsertSpecBatch(next, [
      { spec: { group: 'Общие сведения', name: 'Тип операционной системы', value: 'защищённая многопользовательская операционная система общего назначения', unit: 'тип' } },
      { spec: { group: 'Общие сведения', name: 'Редакция / вариант поставки', value: 'Special Edition для серверов и рабочих станций', unit: 'редакция' } },
      { spec: { group: 'Общие сведения', name: 'Версия / номер релиза', value: 'не ниже 1.8', unit: 'версия' } },
      { spec: { group: 'Общие сведения', name: 'Исполнение / уровень защищённости', value: 'редакция с усиленными встроенными средствами защиты информации', unit: 'уровень' } },
      { spec: { group: 'Ядро и платформы', name: 'Поддерживаемые аппаратные платформы', value: 'x86_64', unit: 'платформа' } },
      { spec: { group: 'Ядро и платформы', name: 'Разрядность', value: '64-бит', unit: 'разрядность' } },
      { spec: { group: 'Ядро и платформы', name: 'Версия ядра Linux', value: 'не ниже 6.1', unit: 'версия' } },
      { spec: { group: 'Ядро и платформы', name: 'Тип ядра', value: 'монолитное', unit: 'тип' } },
      { spec: { group: 'Файловые системы', name: 'Поддерживаемые локальные файловые системы', value: 'ext4, XFS, Btrfs или эквивалентные', unit: 'ФС' } },
      { spec: { group: 'Файловые системы', name: 'Поддержка сетевых файловых систем', value: 'NFS, CIFS/SMB или эквивалентные', unit: 'ФС' } },
      { spec: { group: 'Файловые системы', name: 'Поддержка LVM', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Файловые системы', name: 'Поддержка шифрования разделов', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Интерфейс пользователя', name: 'Графическая оболочка', value: 'наличие графического пользовательского интерфейса для рабочих мест', unit: 'наличие' } },
      { spec: { group: 'Интерфейс пользователя', name: 'Файловый менеджер', value: 'наличие графического файлового менеджера', unit: 'наличие' } },
      { spec: { group: 'Интерфейс пользователя', name: 'Поддержка нескольких мониторов', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Интерфейс пользователя', name: 'Поддержка HiDPI-дисплеев', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Средства безопасности', name: 'Мандатное управление доступом (MAC)', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Средства безопасности', name: 'Дискреционный контроль доступа (DAC)', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Средства безопасности', name: 'Замкнутая программная среда', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Средства безопасности', name: 'Контроль целостности загрузки и исполняемых файлов', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Средства безопасности', name: 'Маркировка объектов по уровням конфиденциальности', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Средства безопасности', name: 'Изоляция процессов и пользователей', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Средства безопасности', name: 'Очистка оперативной памяти и временных данных', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Средства безопасности', name: 'Журналирование событий безопасности', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Средства безопасности', name: 'Встроенный межсетевой экран', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Сетевые возможности', name: 'Поддержка сетевых протоколов', value: 'TCP/IP, IPv4, IPv6', unit: 'протокол' } },
      { spec: { group: 'Сетевые возможности', name: 'Поддержка VPN', value: 'IPsec, OpenVPN, WireGuard или эквивалентные', unit: 'VPN' } },
      { spec: { group: 'Сетевые возможности', name: 'Доменная аутентификация', value: 'поддержка LDAP, Kerberos и интеграции со службой каталогов или эквивалентным решением', unit: 'наличие' } },
      { spec: { group: 'Сетевые возможности', name: 'Поддержка DHCP-клиента', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Сетевые возможности', name: 'Поддержка DNS-клиента', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Администрирование', name: 'Система управления пакетами', value: 'apt/dpkg или эквивалентная', unit: 'тип' } },
      { spec: { group: 'Администрирование', name: 'Средства централизованного обновления', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Администрирование', name: 'Средства централизованного администрирования', value: 'поддержка сценариев автоматизации и централизованного управления конфигурацией', unit: 'наличие' } },
      { spec: { group: 'Администрирование', name: 'Средства резервного копирования пользовательских настроек', value: 'наличие встроенных или штатно поддерживаемых средств', unit: 'наличие' } },
      { spec: { group: 'Виртуализация и контейнеры', name: 'Поддержка виртуализации', value: 'KVM, QEMU или эквивалентные средства', unit: 'наличие' } },
      { spec: { group: 'Виртуализация и контейнеры', name: 'Поддержка контейнеризации', value: 'LXC, Docker или эквивалентные средства', unit: 'наличие' } },
      { spec: { group: 'Совместимость', name: 'Совместимость с отечественными СКЗИ', value: 'поддержка средств электронной подписи и криптографической защиты или эквивалентных решений', unit: 'совместимость' } },
      { spec: { group: 'Совместимость', name: 'Совместимость с офисными пакетами из реестра Минцифры', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Совместимость', name: 'Совместимость с отечественными инфраструктурными сервисами', value: 'совместимость со службами каталогов, виртуализации, VDI, корпоративной почтой и резервным копированием по стандартным интерфейсам и API', unit: 'совместимость' } },
      { spec: { group: 'Совместимость', name: 'Поддержка печати', value: 'CUPS или эквивалентная подсистема печати', unit: 'наличие' } },
      { spec: { group: 'Совместимость', name: 'Поддержка сканирования', value: 'SANE или эквивалентная подсистема', unit: 'наличие' } },
      { spec: { group: 'Совместимость', name: 'Поддержка веб-браузеров', value: 'совместимость с браузерами, поддерживающими современные веб-стандарты', unit: 'совместимость' } },
      { spec: { group: 'Сертификация и лицензирование', name: 'Наличие в Едином реестре российского ПО Минцифры России', value: 'наличие', unit: 'наличие' } },
      { spec: { group: 'Сертификация и лицензирование', name: 'Сертификат ФСТЭК России', value: 'наличие действующего сертификата ФСТЭК России для применения в ГИС, ИСПДн и иных защищаемых системах', unit: 'наличие' } },
      { spec: { group: 'Сертификация и лицензирование', name: 'Тип лицензии', value: resolved.suggestedLicenseType || 'бессрочная', unit: 'тип' }, aliases: ['Тип лицензии', 'Тип лицензии / права использования'] },
      { spec: { group: 'Сертификация и лицензирование', name: 'Количество лицензий', value: `не менее ${row.qty}`, unit: 'шт' } },
      { spec: { group: 'Сертификация и лицензирование', name: 'Срок технической поддержки', value: resolved.suggestedTerm || 'не менее 12', unit: 'мес' } },
      { spec: { group: 'Сертификация и лицензирование', name: 'Носитель поставки', value: 'электронная поставка', unit: 'тип' } },
      { spec: { group: 'Сертификация и лицензирование', name: 'Документация на русском языке', value: 'руководство пользователя и руководство администратора в электронном виде', unit: 'наличие' } },
    ]);
  }

  if (row.type === 'ldap') {
    if (resolved.ldapProfile === 'client_device' || resolved.ldapProfile === 'client_user' || resolved.ldapProfile === 'client') {
      const serverOnlyPatterns = [
        /репликац/i,
        /multi-master/i,
        /dns-зон/i,
        /dhcp/i,
        /pxe/i,
        /netboot/i,
        /сайт/i,
        /тополог/i,
        /кластер/i,
        /макс\.\s*количеств[ао]\s*домен/i,
        /поддержк[аи]\s*схем[ыа]\s*каталог/i,
        /организационн(ых|ые)\s*единиц|иерархи/i,
        /миграц/i,
      ];
      next = next.filter((spec) => !serverOnlyPatterns.some((pattern) => pattern.test(String(spec.name || ''))));

      next = upsertSpecBatch(next, [
        {
          spec: {
            group: 'Общие сведения',
            name: 'Тип программного обеспечения',
            value: isAldPro
              ? 'клиентская лицензия CAL ALD Pro для управления хостом в домене'
              : 'клиентская лицензия CAL для управления хостом в домене',
            unit: 'тип',
          },
          aliases: ['Тип программного обеспечения', 'Тип ПО'],
        },
        {
          spec: {
            group: 'Лицензирование',
            name: 'Тип лицензии',
            value: resolved.suggestedLicenseType || 'Клиентская часть (CAL)',
            unit: 'тип',
          },
          aliases: ['Тип лицензии', 'Тип лицензии / права использования'],
        },
        {
          spec: {
            group: 'Лицензирование',
            name: 'Метрика лицензирования',
            value: resolved.ldapProfile === 'client_user'
              ? 'CAL на пользователя'
              : resolved.ldapProfile === 'client_device'
                ? 'CAL на устройство'
                : 'CAL на каждое устройство или пользователя',
            unit: 'метрика',
          },
        },
        {
          spec: {
            group: 'Лицензирование',
            name: 'Лицензируемый объект',
            value: resolved.ldapProfile === 'client_user'
              ? '1 пользователь'
              : resolved.ldapProfile === 'client_device'
                ? '1 устройство'
                : '1 устройство или 1 пользователь',
            unit: 'объект',
          },
        },
        {
          spec: {
            group: 'Лицензирование',
            name: 'Право использования',
            value: resolved.ldapProfile === 'client_user'
              ? 'право управления одним пользователем, введённым в домен'
              : resolved.ldapProfile === 'client_device'
                ? 'право управления одним устройством, введённым в домен'
                : 'право управления одним устройством или одним пользователем, введённым в домен',
            unit: 'право',
          },
        },
        {
          spec: {
            group: 'Функциональные возможности',
            name: 'Назначение лицензии',
            value: 'право управления рабочей станцией или сервером через доменные политики и конфигурации хоста',
            unit: 'назначение',
          },
        },
        {
          spec: {
            group: 'Функциональные возможности',
            name: 'Управление конфигурацией хоста',
            value: 'поддержка централизованного применения настроек и конфигураций к рабочим станциям и серверам в домене',
            unit: 'наличие',
          },
        },
        {
          spec: {
            group: 'Функциональные возможности',
            name: 'Применение групповых политик',
            value: 'централизованное применение доменных политик и конфигураций SaltStack или эквивалентного механизма',
            unit: 'наличие',
          },
        },
        {
          spec: {
            group: 'Совместимость',
            name: 'Совместимость с серверной частью',
            value: 'ALD Pro Server / контроллер домена или эквивалентная серверная часть службы каталогов',
            unit: 'совместимость',
          },
        },
        {
          spec: {
            group: 'Совместимость',
            name: 'Поддерживаемые объекты управления',
            value: 'рабочие станции и серверы, введённые в домен',
            unit: 'объект',
          },
        },
        {
          spec: {
            group: 'Совместимость',
            name: 'Интеграция с доменной политикой',
            value: 'совместимость с групповыми политиками, OU-иерархией и механизмами централизованного управления домена',
            unit: 'наличие',
          },
        },
      ]);
    } else if (resolved.ldapProfile === 'server' || resolved.ldapProfile === 'combined') {
      next = upsertSpec(next, {
        group: 'Лицензирование',
        name: 'Тип лицензии',
        value: resolved.suggestedLicenseType || (resolved.ldapProfile === 'combined' ? 'Серверная часть + CAL' : 'Серверная часть'),
        unit: 'тип',
      }, ['Тип лицензии', 'Тип лицензии / права использования']);

      next = upsertSpec(next, {
        group: 'Лицензирование',
        name: 'Лицензируемый объект',
        value: resolved.ldapProfile === 'combined'
          ? '1 контроллер домена + CAL на управляемые объекты'
          : '1 контроллер домена',
        unit: 'объект',
      });

      if (isAldPro) {
        next = upsertSpecBatch(next, [
          {
            spec: {
              group: 'Общие сведения',
              name: 'Тип программного обеспечения',
              value: 'серверная часть службы каталогов / контроллер домена ALD Pro',
              unit: 'тип',
            },
            aliases: ['Тип программного обеспечения', 'Тип ПО'],
          },
          {
            spec: {
              group: 'Лицензирование',
              name: 'Метрика лицензирования',
              value: resolved.ldapProfile === 'combined'
                ? 'серверная часть на экземпляр контроллера домена + CAL на устройства или пользователей'
                : 'серверная часть на экземпляр контроллера домена',
              unit: 'метрика',
            },
          },
          {
            spec: {
              group: 'Лицензирование',
              name: 'Лицензионный состав',
              value: resolved.ldapProfile === 'combined'
                ? 'серверная лицензия на контроллер домена и клиентские лицензии CAL на управляемые объекты'
                : 'серверная лицензия на контроллер домена',
              unit: 'состав',
            },
          },
          {
            spec: {
              group: 'Функциональные возможности',
              name: 'Управление организационными единицами (OU)',
              value: 'поддержка иерархии подразделений и делегирования административных полномочий',
              unit: 'наличие',
            },
          },
          {
            spec: {
              group: 'Функциональные возможности',
              name: 'Управление сайтами и топологией репликации',
              value: 'поддержка сайтов, межсайтовых связей и настройки топологии репликации каталога',
              unit: 'наличие',
            },
          },
          {
            spec: {
              group: 'Функциональные возможности',
              name: 'Групповые политики',
              value: 'централизованное применение групповых политик и конфигураций на базе SaltStack или эквивалентного механизма',
              unit: 'наличие',
            },
          },
          {
            spec: {
              group: 'Функциональные возможности',
              name: 'Автоматизированная установка ОС по сети',
              value: 'поддержка PXE / netboot для сетевого развёртывания рабочих станций и серверов',
              unit: 'наличие',
            },
          },
          {
            spec: {
              group: 'Функциональные возможности',
              name: 'Миграция из Microsoft Active Directory',
              value: 'поддержка переноса домена, организационной структуры, пользователей и групп с сохранением структуры объектов',
              unit: 'наличие',
            },
          },
          {
            spec: {
              group: 'Инфраструктура',
              name: 'Репликация каталога',
              value: 'multi-master репликация каталога с поддержкой межсайтовой синхронизации',
              unit: 'тип',
            },
          },
          {
            spec: {
              group: 'Инфраструктура',
              name: 'Интеграция с DHCP / DNS',
              value: 'интеграция со службами DHCP и DNS, включая обслуживание записей и доменной инфраструктуры',
              unit: 'наличие',
            },
          },
          {
            spec: {
              group: 'Инфраструктура',
              name: 'Поддержка DNS-зон',
              value: 'поддержка прямых и обратных зон DNS, необходимых для доменной инфраструктуры',
              unit: 'наличие',
            },
          },
          {
            spec: {
              group: 'Совместимость',
              name: 'Поддерживаемые серверные ОС',
              value: 'Astra Linux Special Edition, ALT Linux, РЕД ОС или эквивалентные серверные ОС',
              unit: 'ОС',
            },
          },
        ]);
      }
    }
  }

  if (resolved.suggestedLicenseType) {
    next = upsertSpec(next, {
      group: 'Лицензирование',
      name: 'Тип лицензии',
      value: resolved.suggestedLicenseType,
      unit: 'тип',
    }, ['Тип лицензии', 'Тип лицензии / права использования']);
  }

  if (resolved.suggestedTerm) {
    next = upsertSpec(next, {
      group: row.type === 'supportCert' || row.type === 'osSupport' ? 'Условия техподдержки' : 'Лицензирование',
      name: row.type === 'supportCert' || row.type === 'osSupport'
        ? 'Срок действия сертификата техподдержки'
        : 'Срок действия лицензии',
      value: resolved.suggestedTerm,
      unit: 'мес',
    }, ['Срок действия лицензии', 'Срок действия сертификата техподдержки', 'Срок технической поддержки']);
  }

  return enrichSpecsByCatalogDepth(row, next, resolved);
}

// ── Batch generation helpers ─────────────────────────────────────────────────
function canBatchRow(row: GoodsRow): boolean {
  return (
    !hasImportedSeedSpecs(row) &&
    isUniversalGoodsType(row.type) &&
    !looksLikeSpecificModelQuery(row.model) &&
    !(getAstraDeterministicSpecs(row)?.length) &&
    !(lookupCatalog(row.type).hardTemplate?.length)
  );
}

// ── Стандартные слова в наименовании товара (не бренды) ───────────────────────
const KNOWN_PRODUCT_WORDS_WS = new Set([
  'системный','блок','ноутбук','монитор','сервер','моноблок','компьютер','рабочая','станция',
  'клавиатура','мышь','гарнитура','принтер','мфу','сканер','коммутатор','маршрутизатор',
  'точка','доступа','накопитель','кабель','адаптер','патч','корд','лицензия','подписка',
  'поддержка','техподдержка','программное','обеспечение','операционная','система','комплект',
  'оборудование','товар','изделие','устройство','мини','пк','нетбук','планшет','проектор',
  'system','unit','desktop','pc','mini','computer','server','monitor','printer','scanner',
  'switch','router','access','point','storage','ssd','hdd','software','license','support',
  'subscription','pro','plus','gen','tower','slim','ultra','max','lite','air','home',
  'office','business','enterprise','standard','advanced','professional','new','series',
  'version','edition','full','nano','rack','blade','usff','sff','atx','matx','itx',
]);
const KNOWN_BRANDS_WS = new Set([
  'msi','asus','acer','dell','hp','hewlett','lenovo','huawei','xiaomi','apple',
  'graviton','гравитон','aquarius','аквариус','iru','айру','yadro','gigabyte',
  'asrock','supermicro','hpe','ibm','cisco','juniper','mikrotik','samsung',
  'kingston','apc','epson','xerox','kyocera','pantum','ricoh','canon','brother',
  'intel','amd','nvidia','astra','рупост','rupost','termidesk','ald','brest',
  'tp','link','zyxel','keenetic','tplink','seagate','western','digital','wd',
  'toshiba','hitachi','lg','sony','benq','viewsonic','iiyama','nec','philips',
  'eaton','ippon','powercom','bixolon','zebra','honeywell','advantech','moxa',
]);

/**
 * Извлекает подсказки из «голого» наименования товара (без спецификаций).
 * Используется для улучшения промпта когда пользователь ввёл только название.
 */
function parseProductNameHints(model: string, type: string): string[] {
  const hints: string[] = [];
  const normalized = String(model || '')
    .toLowerCase().replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = normalized.split(' ').filter(Boolean);

  // Обнаружение неизвестного бренда/модели: чисто-буквенный токен 2–6 символов,
  // которого нет ни в словаре типовых слов, ни в известных брендах
  const unknownBrandCandidates = tokens.filter(t =>
    /^[a-zа-я]{2,6}$/.test(t) &&
    !KNOWN_PRODUCT_WORDS_WS.has(t) &&
    !KNOWN_BRANDS_WS.has(t)
  );
  if (unknownBrandCandidates.length > 0) {
    hints.push(
      `В наименовании присутствует токен «${unknownBrandCandidates.map(t => t.toUpperCase()).join(', ')}» — вероятно, неизвестный бренд или обозначение модели. ИГНОРИРУЙ его: характеристики формируй исключительно исходя из типа товара и типовых требований, а НЕ из этого названия.`
    );
  }

  // Диагональ монитора/дисплея: число 17–100 в наименовании
  const isMonitorContext = type === 'monitor' || /монитор|дисплей/i.test(model);
  if (isMonitorContext) {
    const diagToken = tokens.find(t =>
      /^\d{2,3}([.,]\d)?$/.test(t) &&
      +t.replace(',', '.') >= 17 &&
      +t.replace(',', '.') <= 100
    );
    if (diagToken) {
      hints.push(
        `Диагональ экрана: не менее ${diagToken} дюймов (указана в наименовании — обязательно отразить в поле «Диагональ экрана»).`
      );
    }
  }

  // Мини-ПК форм-фактор
  if (/мини[\s-]?пк|mini[\s-]?pc|мини[\s-]?компьютер/i.test(model)) {
    hints.push(`Форм-фактор: компактный мини-ПК (USFF / Mini-ITX или аналог) — корпус малых габаритов.`);
  }

  // Стоечный сервер (Ux в названии)
  const uMatch = model.match(/\b([1-4])[uу]\b/i);
  if (uMatch && (type === 'server' || /сервер/i.test(model))) {
    hints.push(`Форм-фактор: ${uMatch[1]}U (стоечный, высота ${uMatch[1]}U).`);
  }

  return hints;
}

function buildBatchPrompt(rows: GoodsRow[], lawMode: LawMode): string {
  const law = lawMode === '223' ? '223-ФЗ' : '44-ФЗ';
  const items = rows.map((row, idx) => {
    const okpd2 = getResolvedOkpd2Code(row) || lookupCatalog(row.type).okpd2 || '';
    const name = row.model || lookupCatalog(row.type).name || '';
    const ctx = row.importInfo?.sourceContextText?.trim();
    return `[${idx}] ОКПД2: ${okpd2} | Наименование: ${name}${ctx ? `\n    Контекст: ${ctx.slice(0, 300)}` : ''}`;
  }).join('\n');

  return `Ты эксперт по госзакупкам (${law}). Сгенерируй технические характеристики для каждого товара.

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА:
• Измеримые параметры с «не менее X»/«не более X», без точечных значений
• Без брендов, торговых марок, конкретных моделей; формулировка подходит ≥2 производителям

СТОП-ЛИСТ — не включать в характеристики:
• Артикулы в скобках (72821) — удалить
• Вес нетто/брутто, размеры упаковки — не указывать
• SKU, арт., код 1С — удалить
• Бренды чипсетов: Intel I219V → «Ethernet ≥ 1 Гбит/с»; Realtek ALC897 → «аудиокодек HDA»; Intel AX211 → «Wi-Fi ≥ 802.11ax»
• Отрицательные характеристики («антистатик: нет») — не упоминать
• Для услуг: ПП №1875 не применять
• Для инструмента: цвет рукояток — не указывать; материал рабочей части — ОБЯЗАТЕЛЬНО

ОБРАБОТКА РАЗМЕРОВ В НАИМЕНОВАНИИ:
• «Монитор 27» → Диагональ: «не менее 27 дюймов»
• «d6мм», «30-130мм», «8×35мм» → характеристика с диапазоном

Ответь СТРОГО только JSON (без пояснений):
{"items":[{"idx":0,"specs":[{"group":"...","name":"...","value":"...","unit":"..."}]},{"idx":1,"specs":[...]},...]}

Товары:
${items}`;
}

function parseBatchResponse(raw: string): { items: { idx: number; specs: { group: string; name: string; value: string; unit: string }[] }[] } {
  let text = raw.trim();
  const jsonMatch = text.match(/\{[\s\S]*"items"[\s\S]*\}/);
  if (jsonMatch) text = jsonMatch[0];
  try {
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.items)) return parsed;
  } catch { /* continue */ }
  return { items: [] };
}
// ── End batch generation helpers ─────────────────────────────────────────────

function buildPrompt(
  row: GoodsRow,
  lawMode: LawMode,
  platformSettings?: PlatformIntegrationSettings
): { system: string; user: string } {
  const g = lookupCatalog(row.type);
  const goodsName = g.name;
  const okpd2 = g.okpd2;
  const ktru = g.ktruFixed ?? '';
  const law = lawMode === '223' ? '223-ФЗ' : '44-ФЗ';
  const isSW = !!g.isSoftware;
  const isUniversal = isUniversalGoodsType(row.type);
  const isService = !!g.isService || isUniversalServiceType(row.type);
  const resolvedCommercial = getResolvedCommercialContext(row);
  const explicitLicenseType = resolvedCommercial.suggestedLicenseType;
  const explicitTerm = resolvedCommercial.suggestedTerm;
  const explicitCommercialTermsBlock = [
    explicitLicenseType ? `- Тип лицензии / сертификата: ${explicitLicenseType}` : '',
    explicitTerm ? `- Срок действия / технической поддержки: ${explicitTerm}` : '',
  ].filter(Boolean).join('\n');
  const importedBlock = buildImportedSpecsPromptBlock(row);
  const organizationBlock = buildOrganizationMemoryPromptBlock(platformSettings, isService);

  // ── Единый SYSTEM-промпт для всех типов ──
  const systemPrompt = `Ты — юрист‑закупщик и технический эксперт по государственным и корпоративным закупкам в России. Твоя задача — подготовить техническое задание (ТЗ) для закупки товара по законодательству РФ: при закупках по 44‑ФЗ соблюдать требования 44‑ФЗ, при закупках по 223‑ФЗ — требования 223‑ФЗ и внутренних документов заказчика. Документ должен быть готов к размещению в ЕИС без правок.

ТЗ должно обеспечивать конкуренцию и недискриминацию участников, не содержать необоснованных указаний на конкретные бренды и модели, позволять участие не менее двух производителей, использовать нейтральные формулировки («или эквивалент», «не менее», «не более») и только измеримые, проверяемые характеристики.

ОПИСАНИЕ ОБЪЕКТА ЗАКУПКИ ДОЛЖНО ПОЗВОЛЯТЬ УЧАСТИЕ НЕ МЕНЕЕ ДВУХ ПРОИЗВОДИТЕЛЕЙ. Формулируй характеристики так, чтобы по ним могли быть предложены товары минимум от двух разных производителей; если исходные требования слишком узкие и фактически оставляют одного производителя, аккуратно расширь формулировки (диапазоны, несколько допустимых типов/стандартов), не снижая функциональные требования.

РЕЖИМ ЗАКУПКИ: ${law}.
${lawMode === '44' ? `СТРОГИЙ РЕЖИМ 44-ФЗ:
• Абсолютный запрет на бренды, торговые марки, конкретные модели в описании объекта закупки (ст. 33 44-ФЗ).
• Коды ОКПД2, КТРУ и другие классификаторы ЗАПРЕЩЕНО включать в текст характеристик — система обрабатывает их отдельно.
• Каждая характеристика ОБЯЗАНА допускать участие не менее двух производителей.
• Если исходные требования фактически описывают продукцию одного производителя — расширь диапазоны без снижения функциональности.
• Формулировки: «не менее», «не более», «или эквивалент», «совместимый с ... или аналогичным решением».`
: `РЕЖИМ 223-ФЗ:
• Допустимо указание марки/бренда с обязательной пометкой «или эквивалент», если это обосновано потребностью заказчика.
• Коды ОКПД2, КТРУ и другие классификаторы НЕ включать в текст характеристик — система обрабатывает их отдельно.
• Конкуренция: характеристики должны позволять участие не менее двух производителей.
• Формулировки: «не менее», «не более», «или эквивалент» — применять по аналогии с 44-ФЗ.`}

Все упоминания брендов, торговых марок и конкретных моделей (например, «ПК Брест», «ALD Pro Server», «HP ProBook 450», «Cisco Catalyst») нужно заменить на нейтральные формулировки уровня категории/класса оборудования («персональный компьютер», «серверное оборудование», «маршрутизатор» и т.п.) с «или эквивалент» при необходимости. Числовые параметры из названия модели СОХРАНИТЬ (размер экрана, частота, количество ядер и т.д.).

ПРАВИЛА ЦВЕТА И ВНЕШНЕГО ВИДА:
• Если цвет не обусловлен функцией (маскировка, корпоративный стандарт с обоснованием) — указывай обобщённо: «тёмных тонов» вместо «чёрный», «светлых тонов» вместо «белый».
• Конкретный цвет (RAL, Pantone, «чёрный с оранжевыми элементами») = потенциальная жалоба в ФАС.
• Исключение: цвет как технический параметр (сигнальные цвета ГОСТ Р 12.4.026, маркировка проводов по ГОСТ 23594) — указывать обязательно.

ПРАВИЛА ТОВАРНЫХ ЗНАКОВ И БРЕНДОВ:
• Если марка упоминается в наименовании позиции (Рутокен, JaCarta, Astra Linux, КриптоПро) — в спецификации обязательно добавить строку:
  name: «Наименование», value: «или эквивалент, соответствующий следующим характеристикам»
  и перечислить функциональные критерии эквивалентности как отдельные строки характеристик.
• Для ПО: совместимость с отечественными ОС указывать перечислением с «или эквивалент»: «Astra Linux, РЕД ОС, ALT Linux или эквивалент».

ПРАВИЛА НАИМЕНОВАНИЯ МАТЕРИАЛОВ:
• Не указывай торговые названия материалов как единственный вариант.
• «победит» → «твёрдый сплав (карбид вольфрама WC или аналог)»
• «поликарбонат» (если не критично) → «ударопрочный пластик»
• «Ф4» (PTFE) → «фторопласт (политетрафторэтилен PTFE или аналог)»

НОРМАТИВНАЯ БАЗА (применять правильно):
• ПП РФ от 23.12.2024 № 1875 — национальный режим для промышленных товаров и оборудования (АКТУАЛЬНЫЙ).
• ПП РФ от 17.07.2015 № 719 — подтверждение производства на территории ЕАЭС.
• ПП РФ от 16.11.2015 № 1236 — реестр Минцифры для программного обеспечения.
• НЕ ссылаться на ПП №878, №616, №925 — эти постановления утратили силу и заменены ПП №1875.
• Для ПО ссылаться только на ПП №1236, не на ПП №1875.
• Для услуг, не являющихся поставкой промтоваров: ПП №1875 не применяется.

ПРИМЕРЫ ПРАВИЛЬНОГО ПРЕОБРАЗОВАНИЯ (datasheet → ТЗ):
• "Процессор Intel Core i5-12500"      → "не менее 10 ядер, частота не менее 3,0 ГГц, кеш не менее 18 МБ"
• "RAM 16 GB DDR5"                     → "Объём оперативной памяти: ≥ 16 ГБ"
• "SSD 512 GB NVMe"                    → "Накопитель SSD, объём ≥ 512 ГБ, интерфейс NVMe или SATA"
• "Цвет: серебристый"                  → не включать (не функциональный параметр)
• "Windows 11 Pro"                     → "Совместимость с Astra Linux, РЕД ОС, ALT Linux или эквивалент"
• "Гарантия производителя 1 год"       → "Гарантийный срок: не менее 12 месяцев"
• "Intel NIC 1GbE"                     → "Сетевой интерфейс: Ethernet, скорость не менее 1 Гбит/с"
• "USB-токен Рутокен ЭЦП 3.0"          → "USB-токен криптографический или эквивалент: поддержка ГОСТ Р 34.10-2012, память ≥ 64 КБ, интерфейс USB Type-A"

АЛГОРИТМ ПРИ ОТСУТСТВИИ ХАРАКТЕРИСТИК:
1. Первый выбор: характеристики из КТРУ (zakupki.gov.ru/epz/ktru/) — если позиция там есть, их нельзя игнорировать.
2. Второй выбор: типовые параметры из аналогичных ТЗ на zakupki.gov для данного типа товара.
3. Третий выбор: параметры из действующего ГОСТ для данной категории.
4. Если ничего нет — используй отраслевые стандарты. Лучше 8 точных параметров, чем 20 размытых.

АБСОЛЮТНЫЕ ЗАПРЕТЫ (нарушают требования к ТЗ):
• Никаких emoji и символов интерфейса (⭐ 🔴 ✅ ❌ ★ ✓ и любых других) в тексте характеристик или заголовках.
• Никаких комментариев и оговорок: «требуется проверка», «при применимости уточните», «обычно не применяется», «как правило», «по умолчанию», «необходимо проверить», «требует уточнения» — ТЗ юридический документ, в нём нет места предположениям.
• Никаких фраз «ручной ввод», «своя услуга», «свой товар», «ручной импорт» — только корректные наименования объектов закупки.
• Никаких незакрытых плейсхолдеров [ВСТАВИТЬ], [УКАЗАТЬ], [НАИМЕНОВАНИЕ], [ФИО] — если данных нет, оставь поле незаполненным через прочерк «___» или опусти параметр.
• Никаких ссылок на ПП №878, №616, №925 — они утратили силу и заменены ПП №1875.
• Никаких пояснений для пользователя системы внутри документа.
• Конкретный производитель без «или эквивалент» — запрещено по 44-ФЗ ст. 33 ч. 3.
• ЗАПРЕЩЕНО ставить требования к опыту и стажу персонала («опыт не менее 3 лет», «стаж от 5 лет») в раздел ТЗ — это критерии оценки заявок (ч. 1 ст. 32 44-ФЗ), а не ТЗ. В ТЗ допустимо только требование наличия лицензий / допусков / сертификатов ФСТЭК/ФСБ, если они обязательны по закону.
• ЗАПРЕЩЕНО применять ПП №1875 и ПП №1236 в ТЗ на услуги (не являющиеся поставкой промышленной продукции).
• Точечные значения без диапазона, если нет технического обоснования.
• КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНЫ РАСПЛЫВЧАТЫЕ ЗНАЧЕНИЯ — нарушение 44-ФЗ ст. 33:
  – «по требованиям Заказчика» → НЕЛЬЗЯ: указать конкретное число или стандарт
  – «по усмотрению Заказчика» / «на усмотрение поставщика» → НЕЛЬЗЯ
  – «согласно технической документации» → НЕЛЬЗЯ: дать конкретный параметр
  – «уточняется при поставке» / «определяется производителем» → НЕЛЬЗЯ
  – «не хуже аналогов» / «при необходимости» → НЕЛЬЗЯ
  ПРАВИЛО: каждое поле "value" в JSON — конкретное число + единица + модификатор (не менее / не более / от X до Y).

СТОП-ЛИСТ — НИКОГДА не включать в ТЗ из входящего документа:
• Артикулы поставщика в скобках (72821), (9421), (37834404) — удалить полностью из наименования и характеристик
• Вес нетто / вес брутто — не указывать
• Размеры упаковки / габариты в упаковке — не указывать
• Внутренние коды поставщика: «SKU», «арт.», код 1С, штрихкод — удалить
• Бренды чипсетов и компонентов (Intel I219V, Realtek ALC897, Intel AX211) — заменить на нейтральные характеристики: «сетевой контроллер ≥ 1 Гбит/с», «аудиокодек HDA», «Wi-Fi ≥ 802.11ax»
• Отрицательные характеристики («Функция антистатик: нет», «Подсветка: нет») — если функции нет, просто не упоминать; в ТЗ перечисляем только то, что ЕСТЬ и требуется

ОБРАБОТКА РАЗМЕРОВ И КОДОВ ИЗ НАИМЕНОВАНИЯ:
• Размеры в наименовании (d6мм, 8×35мм, 30-130мм, 5м) → перенести как характеристику с «не менее» или «от X до Y мм»
• Число после «Монитор» → диагональ «не менее N дюймов» (например, «Монитор 27» → «Диагональ экрана: не менее 27 дюймов»)
• Код в скобках (72821) — артикул поставщика, УДАЛИТЬ из наименования ТЗ
• Диапазон в наименовании (30-130мм) → характеристика «Диапазон диаметров: от 30 до 130 мм»

ПРАВИЛА ДЛЯ ИНСТРУМЕНТА И ОСНАСТКИ (сверла, биты, коронки, плоскогубцы, ключи и т.д.):
• Материал рабочей части — ОБЯЗАТЕЛЬНАЯ характеристика (сталь HSS, твёрдый сплав, легированная сталь или эквивалент)
• Совместимость: указывать тип инструмента («для дрели», «для перфоратора», «для лобзика») и тип хвостовика
• Геометрические параметры (диаметр, длина, шаг резьбы) — через «не менее N мм» или диапазон «от X до Y мм»
• Группировать позиции с одинаковым ОКПД2 в одну строку характеристик если это набор
• ИСКЛЮЧИТЬ из ТЗ: цвет рукояток (не функциональный), вес нетто, антистатик (если не является функциональным требованием)

ПРАВИЛА ДЛЯ УСЛУГ (медосмотр, охрана, уборка, обучение):
• ПП РФ №1875 от 23.12.2024 — НЕ применять к услугам; в поле nac_regime ставить "none"
• Лицензионные требования → ссылка на закон (ФЗ, ПП), НЕ на конкретную лицензирующую организацию
• Гарантийный срок на результат услуги — 12 месяцев если применимо
• Структура характеристик: состав услуг, объём, сроки, SLA, требования к исполнителю, место оказания, отчётность, приёмка

БЛОК ОБРАБОТКИ ИМПОРТИРОВАННЫХ ХАРАКТЕРИСТИК

ПУТЬ А: У позиции ЕСТЬ импортированные характеристики из DOCX (JSON imported specs ниже):
Эти характеристики — ЕДИНСТВЕННАЯ основа итоговой таблицы. Альтернативный список генерировать ЗАПРЕЩЕНО.

ДОПУСТИМЫЕ ОПЕРАЦИИ:
✅ Добавить «не менее»/«не более»/«или эквивалент» к числовым значениям (${lawMode === '44' ? '44-ФЗ требует' : '223-ФЗ рекомендует'})
✅ Нормализовать единицы измерения (ГБ, МГц, мм, Вт·ч)
✅ Убрать ТОЛЬКО торговую марку/бренд, СОХРАНИВ все числовые параметры
✅ Объединить явные дубликаты БЕЗ потери информации
✅ Знак ≥/≤ → «не менее»/«не более» с ТЕМ ЖЕ числом
✅ Добавить 2-3 недостающие характеристики В ДОПОЛНЕНИЕ (не вместо)

ЗАПРЕЩЕНО — НАРУШЕНИЕ ПРИВЕДЁТ К ОТКЛОНЕНИЮ ЗАКУПКИ:
❌ ИЗМЕНЯТЬ ЧИСЛА: «16 ГБ» → только «не менее 16 ГБ», НЕЛЬЗЯ «не менее 8 ГБ»
❌ ОКРУГЛЯТЬ: 4.4 ГГц → 4.0 ГГц — ЗАПРЕЩЕНО
❌ УДАЛЯТЬ строки из импорта
❌ ЗАМЕНЯТЬ конкретные характеристики шаблонными («многоядерный процессор» вместо «не менее 10 ядер»)
❌ ГЕНЕРИРОВАТЬ список с нуля, игнорируя импорт
❌ ДОБАВЛЯТЬ строки ВМЕСТО существующих
❌ Включать коды ОКПД2, КТРУ в текст характеристик

Пример: «Intel Core i5-1235U, 10 ядер, 3.3/4.4 ГГц, 12 МБ кеш» → «не менее 10 ядер, базовая частота не менее 3,3 ГГц, турбочастота не менее 4,4 ГГц, кеш не менее 12 МБ» (бренд убран, числа сохранены на 100%).

ПУТЬ Б: У позиции НЕТ импортированных характеристик (список пустой):
Сформируй перечень технических характеристик С НУЛЯ на основе типа товара и описания ниже.

ОБЯЗАТЕЛЬНЫЕ ТРЕБОВАНИЯ К ГЕНЕРАЦИИ:
• Каждая характеристика ОБЯЗАНА допускать участие не менее двух производителей
• ЗАПРЕЩЕНО: бренды, торговые марки, конкретные модели${lawMode === '44' ? ' (ст. 33 44-ФЗ)' : ''}
• ЗАПРЕЩЕНО: коды ОКПД2, КТРУ в тексте характеристик
• Формулировки: «не менее», «не более», «или эквивалент»
• Все характеристики — измеримые и проверяемые при приёмке
• Конкретные числа, диапазоны, ссылки на стандарты (ГОСТ, ISO), но НЕ на коммерческие линейки

СТОП-СЛОВА — АБСОЛЮТНЫЙ ЗАПРЕТ. Эти фразы НЕЛЬЗЯ использовать ни в каком поле "value":
❌ «по требованиям Заказчика» — ЗАПРЕЩЕНО
❌ «по усмотрению Заказчика» — ЗАПРЕЩЕНО
❌ «на усмотрение поставщика» — ЗАПРЕЩЕНО
❌ «согласно технической документации» — ЗАПРЕЩЕНО
❌ «уточняется при поставке» — ЗАПРЕЩЕНО
❌ «определяется производителем» — ЗАПРЕЩЕНО
❌ «не хуже аналогов» — ЗАПРЕЩЕНО
❌ «при необходимости» — ЗАПРЕЩЕНО
❌ Любая формулировка БЕЗ конкретного числа или стандарта — ЗАПРЕЩЕНО

Если точное значение неизвестно — используй минимальный отраслевой стандарт.
НИКОГДА не оставляй характеристику без конкретного измеримого значения.

ШАБЛОНЫ ДЛЯ ОБЯЗАТЕЛЬНЫХ ПАРАМЕТРОВ:
• Процессор — Количество ядер: "не менее 4" (тип: шт), Тактовая частота: "не менее 2,4" (тип: ГГц), Кэш L3: "не менее 6" (тип: МБ), Архитектура: "x86-64" (тип: —)
• ОЗУ — Объём: "не менее 8" (тип: ГБ), Тип: "DDR4 или DDR5" (тип: —), Частота: "не менее 3200" (тип: МГц)
• Накопитель — Объём: "не менее 256" (тип: ГБ), Тип: "SSD (NVMe или SATA)" (тип: —), Скорость чтения: "не менее 500" (тип: МБ/с)

ПРАВИЛА JSON-ответа:
- Поле "unit": ОБЯЗАТЕЛЬНО для каждой характеристики.
  Числовые: "ГБ","ГГц","МГц","мм","кг","Вт","дБА","°C","шт","мес","м","ч","Мбит/с","Гбит/с"
  Текстовые: "тип","наличие","соответствие","версия","класс","—"
  НИКОГДА не оставляй "unit" пустым "". Если нет единицы — ставь "—"
- Поле "value": КОНКРЕТНОЕ значение с «не менее»/«не более» или конкретное описание.
  ЗАПРЕЩЕНО: «по типу товара», «согласно назначению», «в соответствии с...», «по требованию»
- Поле "group": группируй логически (Общие сведения, Процессор, Оперативная память, Хранилище, Интерфейсы, Питание, Надёжность, Физические характеристики, Программное обеспечение, Сертификация)
- МИНИМУМ характеристик: для аппаратного ИТ — не менее 25, для ПО — не менее 18, для услуг — не менее 15
- Каждый параметр ДОЛЖЕН быть измеримым/проверяемым при приёмке товара
- Детализация: уровень реальных опубликованных ТЗ из ЕИС (zakupki.gov.ru)`;

  // ── Специальный промпт для универсального типа «Любой товар» ──
  if (isUniversal && isService) {
    const law175Example = getResolvedLaw175Meta(row.type, { nac_regime: 'none' });
    return {
      system: systemPrompt,
      user: `Пользователь хочет закупить услугу. Описание: "${row.model}"
Количество / объем: ${row.qty}
${explicitCommercialTermsBlock ? `Коммерческие параметры из заявки:\n${explicitCommercialTermsBlock}\n` : ''}
${importedBlock}
${organizationBlock}

ТВОЯ ЗАДАЧА:
1. Определить правильный код ОКПД2 услуги
2. Полное наименование ОКПД2 услуги
3. Код КТРУ (если применимо, иначе пустая строка)
4. Национальный режим: для услуг обычно "none"; если есть явное исключение/особый режим — укажи его и основание
5. Полный набор требований к услуге — НЕ МЕНЕЕ 18 штук: состав, объем, сроки, этапы, SLA, место оказания, требования к результату, квалификации исполнителя, отчетности, приемке, режиму работ и безопасности. ОБЯЗАТЕЛЬНО включи:
   - Если вид деятельности лицензируется (медицина, охрана, образование, строительство, перевозки опасных грузов, фармация и т.д.) — требование к наличию лицензии: «Исполнитель должен иметь лицензию на ... (указать вид) согласно [закон / НПА]»
   - Требования к квалификации и составу персонала
   - Требования к результату: измеримые, проверяемые показатели
   - Порядок приёмки и состав отчётности

Правила для meta:
- Не оставляй поле law175_basis пустым.
- Если law175_status = none, объясни неприменимость ПП РФ № 1875.
- Если law175_status = exception, укажи только документированное основание исключения.

Ответ СТРОГО в JSON:
{
  "meta": {
    "okpd2_code": "XX.XX.XX.XXX",
    "okpd2_name": "Полное название услуги по ОКПД2",
    "ktru_code": "",
    "nac_regime": "none",
    "law175_status": "${law175Example.status}",
    "law175_basis": "${law175Example.promptBasis}"
  },
  "specs": [
    {"group":"Общие требования","name":"Состав услуг","value":"конкретный перечень услуг и результата","unit":"—"},
    {"group":"Сроки и SLA","name":"Срок оказания услуг","value":"не более 30","unit":"календарных дней"},
    {"group":"Приемка","name":"Подтверждение результата","value":"акт оказанных услуг и комплект отчетных материалов","unit":"—"}
  ]
}`
    };
  }

  if (isUniversal) {
    const law175Example = getResolvedLaw175Meta(row.type, { nac_regime: 'pp616' });
    return {
      system: systemPrompt,
      user: `Пользователь хочет закупить товар. Описание: "${row.model}"
Количество: ${row.qty} шт.
${explicitCommercialTermsBlock ? `Коммерческие параметры из заявки:\n${explicitCommercialTermsBlock}\n` : ''}
${importedBlock}
${organizationBlock}

ТВОЯ ЗАДАЧА:
1. Определить правильный код ОКПД2 (до 3 знаков после точки минимум)
2. Полное наименование ОКПД2
3. Код КТРУ (если есть в каталоге КТРУ, иначе пустая строка)
4. Национальный режим: "pp878" (радиоэлектроника РЭПР), "pp1236" (ПО из реестра Минцифры), "pp616" (промтовары), "none" (без ограничений)
5. Полный набор технических характеристик — НЕ МЕНЕЕ 20 штук, сгруппированных по разделам

Характеристики должны быть РЕАЛЬНЫМИ и КОНКРЕТНЫМИ для данного товара. Используй свои знания о реальных параметрах.
Для каждой характеристики ОБЯЗАТЕЛЬНО укажи единицу измерения в поле "unit".
- Не оставляй \`meta.law175_basis\` пустым: кратко объясни меру ПП РФ № 1875 либо неприменимость; \`exception\` допустим только при документированном основании.

Ответ СТРОГО в JSON (без markdown, без пояснений, без \`\`\`json):
{
  "meta": {
    "okpd2_code": "XX.XX.XX.XXX",
    "okpd2_name": "Полное название по ОКПД2",
    "ktru_code": "",
    "nac_regime": "pp616",
    "law175_status": "${law175Example.status}",
    "law175_basis": "${law175Example.promptBasis}"
  },
  "specs": [
    {"group":"Общие сведения","name":"Тип изделия","value":"конкретный тип","unit":"тип"},
    {"group":"Технические характеристики","name":"Высота","value":"не менее 400","unit":"мм"},
    {"group":"Материалы","name":"Материал корпуса","value":"сталь или эквивалент","unit":"—"}
  ]
}`
    };
  }

  // ── Определение контекста «лицензия» / «техподдержка» в описании модели ──
  const modelLower = row.model.toLowerCase().replace(/ё/g, 'е');
  const isLicenseContext = Boolean(explicitLicenseType) || /лицензи[яию]|license|подписк[аи]/i.test(modelLower);
  const isSupportContext = row.type === 'supportCert'
    || row.type === 'osSupport'
    || /техподдержк|тех[\.\s]*поддержк|support|сопровождени/i.test(modelLower);

  // Дополнительные подсказки для контекста лицензии / техподдержки
  const licenseContextHint = isLicenseContext ? `
КОНТЕКСТ ЗАКУПКИ — ЛИЦЕНЗИЯ НА ПО:
Характеристики ОБЯЗАТЕЛЬНО должны включать:
- Тип лицензии (бессрочная / срочная / подписка / SaaS)
- Вариант лицензии (серверная / клиентская CAL / на рабочее место / на ядро CPU)
- Срок действия лицензии (мес)
- Количество лицензируемых объектов (пользователи / устройства / ядра)
- Права на обновления (мажорные / минорные) в период действия
- Условия активации (онлайн / офлайн / ключ)
- Наличие в Едином реестре российского ПО Минцифры
- Право на использование на территории РФ
- Электронный документ подтверждения лицензии
- Носитель дистрибутива (электронная поставка / физ. носитель)
ПОМИМО лицензионных, добавь ФУНКЦИОНАЛЬНЫЕ характеристики самого ПО (не менее 15).
` : '';

  const supportContextHint = isSupportContext ? `
КОНТЕКСТ ЗАКУПКИ — ТЕХНИЧЕСКАЯ ПОДДЕРЖКА ПО:
Характеристики ОБЯЗАТЕЛЬНО должны включать:
- Уровень техподдержки (Стандартная / Расширенная / Привилегированная / Platinum)
- Срок оказания техподдержки (12 / 24 / 36 мес)
- Время реакции на обращение (не более X часов)
- Время решения критических инцидентов (не более X часов)
- Режим работы техподдержки (8x5 / 12x5 / 24x7)
- Каналы обращения (портал / email / телефон / чат)
- Количество обращений (лимитированное / безлимитное)
- Право на обновления версий в период поддержки
- Право на получение патчей безопасности
- Доступ к базе знаний и документации
- Количество поддерживаемых экземпляров/лицензий
- Наличие выделенного инженера (при привилегированном уровне)
ПОМИМО параметров поддержки, укажи КРАТКИЕ функциональные характеристики самого ПО (не менее 10).
` : '';

  // ── Стандартный промпт для каталожных типов ──
  const generalHint = getSpecHint(row.type);
  let hint = generalHint
    ? generalHint.split(',').map(s => `- ${s.trim()}`).join('\n')
    : (getDetailedSpecHint(row.type)
      ?? (isSW ? '- Наименование и версия ПО\n- Тип лицензии (бессрочная/подписка/SaaS)\n- Количество лицензий\n- Срок действия лицензии\n- Функциональные возможности (подробно, не менее 10 пунктов)\n- Поддерживаемые ОС (с указанием «или эквивалентные»)\n- Совместимость с другими системами\n- Средства безопасности (аутентификация, шифрование, аудит)\n- Централизованное управление\n- Масштабируемость\n- API/интеграции\n- Наличие в Едином реестре российского ПО Минцифры России\n- Сертификат ФСТЭК России (если применимо)\n- Документация на русском языке\n- Срок технической поддержки\n- Обновления (частота, способ доставки)\n- Требования к серверу/клиенту (RAM, CPU, HDD)'
               : '- Наименование и тип изделия\n- Назначение / область применения\n- Материал (при наличии)\n- Основные технические параметры (конкретные числа: размеры, мощность, ёмкость, скорость, частота)\n- Совместимость (с каким оборудованием — через «или эквивалент»)\n- Интерфейсы подключения (при наличии)\n- Стандарты и нормативы (ГОСТ, класс защиты, IP-рейтинг — при применимости)\n- Комплектация\n- Цвет / внешний вид (при значимости)\n- Габаритные размеры (ШxГxВ, мм)\n- Масса (не более, кг или г)\n- Гарантия производителя (мес)\n- Упаковка'));

  const ldapRoleHint = row.type === 'ldap'
    ? getLdapRoleHint(resolvedCommercial.ldapProfile, explicitLicenseType)
    : '';

  if (row.type === 'ldap' && (resolvedCommercial.ldapProfile === 'client_device' || resolvedCommercial.ldapProfile === 'client_user' || resolvedCommercial.ldapProfile === 'client')) {
    hint = [
      '- Тип программного обеспечения (клиентская лицензия CAL)',
      '- Назначение лицензии (право управления рабочей станцией или сервером в домене)',
      '- Тип лицензии (CAL на устройство / CAL на пользователя)',
      '- Лицензируемый объект (1 устройство / 1 пользователь)',
      '- Совместимость с серверной частью ALD Pro / контроллером домена',
      '- Применение доменных политик и конфигураций SaltStack',
      '- Централизованное управление конфигурацией хоста',
      '- Поддерживаемые клиентские ОС',
      '- Наличие в реестре российского ПО Минцифры',
      '- Срок действия лицензии',
      '- Срок технической поддержки',
      '- Обновления в период поддержки',
      '- Электронный документ подтверждения лицензии',
      '- Документация на русском языке',
    ].join('\n');
  }

  const minSpecs = getMinimumSpecCount(row, resolvedCommercial);
  const law175Example = getResolvedLaw175Meta(row.type, { nac_regime: getUnifiedNacRegime(row.type), ktru_code: ktru });

  // Подсказки из «голого» наименования (неизвестный бренд, диагональ, форм-фактор)
  const nameHints = parseProductNameHints(row.model, row.type);
  const nameHintsBlock = nameHints.length > 0
    ? `\nПОДСКАЗКИ ИЗ НАИМЕНОВАНИЯ (обязательно учесть при генерации):\n${nameHints.map(h => `• ${h}`).join('\n')}\n`
    : '';

  return {
    system: systemPrompt,
    user: `Сформируй технические характеристики для закупки по ${law}.

Тип товара: ${goodsName}
Модель/описание (для ориентира — НЕ копировать марку/модель в ответ): ${row.model}${nameHintsBlock}
Количество: ${row.qty} шт.
${explicitCommercialTermsBlock ? `Коммерческие параметры из заявки:\n${explicitCommercialTermsBlock}\n- Отрази эти параметры в итоговых характеристиках без изменения их смысла.\n` : ''}
${importedBlock}
${organizationBlock}
ОКПД2: ${okpd2}${ktru ? '\nКТРУ: ' + ktru : ''}

${isSW ? `Национальный режим — ПО (ПП РФ № 1875 + ПП РФ № 1236):
- ПО ОБЯЗАТЕЛЬНО в реестре Минцифры России
- Сертификация ФСТЭК/ФСБ где применимо`
: `Национальный режим (ПП РФ № 1875 от 23.12.2024):
- Для ОКПД2 26.*: подтверждение через РЭПР (ГИСП) или евразийский реестр
- Подтверждение страны происхождения: выписка из ГИСП`}

ОБЯЗАТЕЛЬНЫЕ параметры (МИНИМУМ — добавь ещё для полноты, нужно НЕ МЕНЕЕ ${minSpecs} характеристик):
${hint}
${licenseContextHint}${supportContextHint}${ldapRoleHint}
ВАЖНО — ОБЯЗАТЕЛЬНЫЕ РАЗДЕЛЫ (для аппаратного ИТ-оборудования):
${!isSW && !isService ? `► Производительность: процессор (частота ГГц, кол-во ядер), RAM (объём ГБ, тип DDR), хранилище (объём ГБ/ТБ, скорость Мбит/с)
► Интерфейсы: USB (тип и версия), видео-выход (DisplayPort/HDMI и версия), RJ-45 (скорость Гбит/с), Wi-Fi (стандарт IEEE 802.11)
► Питание: TDP процессора (Вт), КПД блока питания (не менее N%), потребление в режиме ожидания (Вт)
► Надёжность: MTBF (не менее N часов), диапазон рабочих температур (от … до … °C), гарантия производителя (мес)
► Физические: габариты ШxГxВ (мм), масса (не более N кг), форм-фактор` : ''}
- Каждый параметр — КОНКРЕТНЫЙ, ИЗМЕРИМЫЙ, ПРОВЕРЯЕМЫЙ при приёмке товара
- Каждое поле "unit" ОБЯЗАТЕЛЬНО заполнено (мм, кг, ГБ, шт, мес, тип, наличие, — и т.д.)
- Каждое поле "value" содержит конкретное значение, НЕ общие фразы вроде «зависит от типа»
- Группируй по разделам через "group"
- Всего НЕ МЕНЕЕ ${minSpecs} характеристик (для ноутбуков/серверов/ПК — не менее 25)
- Не оставляй \`meta.law175_basis\` пустым: кратко обоснуй меру ПП РФ № 1875 или ее неприменимость; \`exception\` допустим только при документированном основании

Ответ СТРОГО в JSON (без markdown, без \`\`\`json, без пояснений):
{
  "meta": {
    "okpd2_code": "${okpd2}",
    "okpd2_name": "${g.okpd2name}",
    "ktru_code": "${ktru}",
    "nac_regime": "${getUnifiedNacRegime(row.type)}",
    "law175_status": "${law175Example.status}",
    "law175_basis": "${law175Example.promptBasis}"
  },
  "specs": [
    {"group":"Общие сведения","name":"Тип","value":"конкретное значение","unit":"тип"},
    {"group":"Процессор","name":"Количество ядер","value":"не менее 8","unit":"шт"},
    {"group":"Габариты","name":"Масса","value":"не более 2.5","unit":"кг"}
  ]
}`
  };
}

// ── Список типов ПО для определения нацрежима ────────────────────────────────
const SW_PROMPT_TYPES = ['os','office','antivirus','crypto','dbms','erp','virt','vdi','backup_sw',
  'dlp','siem','firewall_sw','edr','waf','pam','iam','pki','email','vks','ecm','portal',
  'project_sw','bpm','itsm','monitoring','mdm','hr','gis','ldap','vpn','reporting','cad','license'];

// ── Проверка: есть ли реальные значения характеристик (не «не указан» заглушки) ──
const PLACEHOLDER_RE = /^(не\s*указан[аоы]?|н[\/ ]?[аду]|—|-|отсутствует|нет\s*данных|неизвестн[аоы]?|n[\/ ]?a|unknown)$/i;

function hasRealSpecValues(specs: SpecItem[]): boolean {
  if (specs.length === 0) return false;
  const total = specs.length;
  let placeholders = 0;
  for (const s of specs) {
    const v = String(s.value ?? '').trim();
    if (!v || PLACEHOLDER_RE.test(v)) placeholders++;
  }
  // If more than 40% of specs are placeholders, consider it useless
  return placeholders / total < 0.4;
}

// ── Промпт: поиск реальных характеристик конкретной модели через ИИ ───────────
function buildSpecSearchPrompt(
  row: GoodsRow,
  g: GoodsItem,
  platformSettings?: PlatformIntegrationSettings
): string {
  if (isUniversalGoodsType(row.type)) {
    return buildUniversalSearchPrompt(row, 'интернет-поиск', '', platformSettings);
  }
  const nac = SW_PROMPT_TYPES.includes(row.type) ? 'pp1236' : 'pp878';
  const isSW = !!g.isSoftware;
  const resolvedCommercial = getResolvedCommercialContext(row);
  const exactModelRequested = looksLikeSpecificModelQuery(row.model);
  const minSpecs = exactModelRequested
    ? Math.min(getMinimumSpecCount(row, resolvedCommercial), isSW ? 14 : 12)
    : getMinimumSpecCount(row, resolvedCommercial);
  const hint = getDetailedSpecHint(row.type);
  const importedBlock = buildImportedSpecsPromptBlock(row);
  const organizationBlock = buildOrganizationMemoryPromptBlock(platformSettings, !!g.isService);
  const ldapRoleHint = row.type === 'ldap'
    ? getLdapRoleHint(resolvedCommercial.ldapProfile, resolvedCommercial.suggestedLicenseType)
    : '';
  const law175Example = getResolvedLaw175Meta(row.type, { nac_regime: nac, ktru_code: g.ktruFixed ?? '' });
  return `Ты — эксперт по ИТ-оборудованию и ПО для госзакупок РФ (44-ФЗ). Найди точные технические характеристики конкретного товара.

Исходный запрос (только для поиска, не копировать в ответ): "${row.model}"
Тип: ${g.name}
ОКПД2: ${g.okpd2}
${importedBlock}
${organizationBlock}

Задача: укажи реальные характеристики именно этой модели/версии, как указаны у производителя и в открытых спецификациях. Характеристики должны быть МАКСИМАЛЬНО ДЕТАЛЬНЫМИ — уровень реальных ТЗ из ЕИС (zakupki.gov.ru).

КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать «не указан», «не указано», «не указаны», «н/д», «неизвестно», «нет данных» в значениях.
${exactModelRequested
  ? 'Если точное значение для этой модели не подтверждено источниками, НЕ подставляй типичное значение класса товара и не заменяй его общим требованием. Запрещены формулировки вида «по требованиям Заказчика», «в соответствии с типом товара», «SSD и/или HDD», «интегрированный и/или дискретный», «в количестве, достаточном для эксплуатации».'
  : 'Если точное значение неизвестно — укажи ТИПИЧНОЕ значение для данного класса товаров с формулировкой «не менее» / «не более».'
}

ПРИНЦИП ДВОЙНОГО ЭКВИВАЛЕНТА (обязательно):
- Числовые значения через «не менее X» / «не более X», допускающие ≥2 производителей
- Сокеты процессора — НЕ УКАЗЫВАТЬ (ограничивают конкуренцию)
- НЕ привязывай параметры к конкретной модели/серии одного вендора

Правила формулировок (44-ФЗ, ст. 33):
- Не указывать торговые марки, производителей, артикулы и точные модели
- Использовать обезличенные формулировки «без указания товарного знака (эквивалент)»
- Числа: «не менее X» (не «>= X»)
- Единицы: ГГц, МГц, ГБ, МБ, ТБ (не GHz/GB/MB)
- Тип матрицы: «IPS или эквивалент (угол обзора не менее 178°)»
- Разрешение: «не менее 1920x1080»
- Для ОП: «DDR4 или выше»${isSW ? '\n- ПО: наличие в реестре Минцифры России (ПП РФ № 1236)\n- Указать все функциональные модули и возможности' : ''}
- Поле meta.law175_basis не оставлять пустым: кратко обоснуй выбранную меру ПП РФ № 1875 либо неприменимость; исключение указывай только при документированном основании

Обязательные разделы для аппаратного ИТ (если применимо):
- Производительность процессора (частота, ядра, кэш ГБ)
- Оперативная память (объём ГБ, тип DDR, частота МГц)
- Хранилище (объём ТБ/ГБ, тип SSD/HDD, скорость Мбит/с)
- Интерфейсы (USB версий, DisplayPort/HDMI версий, RJ-45 Гбит/с, Wi-Fi стандарт)
- Питание (TDP Вт, КПД блока питания %, потребление в режиме ожидания Вт)
- Надёжность (MTBF часов, гарантия мес, диапазон рабочих температур °C)
- Физические параметры (габариты ШxГxВ мм, масса кг)

ВАЖНО по количеству: необходимо сформировать не менее ${minSpecs} характеристик, сгруппированных по разделам.
${hint ? 'Включить как минимум:\n' + hint.split('\n').filter((l: string) => l.startsWith('- ')).slice(0, 15).join('\n') : ''}
${ldapRoleHint}

Ответ СТРОГО в JSON без пояснений и без markdown:
{"meta":{"okpd2_code":"${g.okpd2}","okpd2_name":"${g.okpd2name}","ktru_code":"${g.ktruFixed ?? ''}","nac_regime":"${nac}","law175_status":"${law175Example.status}","law175_basis":"${law175Example.promptBasis}"},"specs":[{"group":"Группа","name":"Характеристика","value":"Значение","unit":"тип"}]}`;
}

// ── Извлечь текст из HTML ЕИС/КТРУ (DOMParser) ────────────────────────────────
function extractEisText(html: string): string {
  if (!html) return '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, nav, footer, header, .search-bar, .page-header').forEach((el) => el.remove());
    // Пробуем вытащить таблицу характеристик КТРУ
    const tables = Array.from(doc.querySelectorAll('table'));
    const tableParts: string[] = [];
    for (const tbl of tables) {
      const rows = Array.from(tbl.querySelectorAll('tr'));
      for (const tr of rows) {
        const cells = Array.from(tr.querySelectorAll('td, th')).map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim());
        if (cells.length >= 2 && cells.some((c) => c.length > 2)) {
          tableParts.push(cells.join(' | '));
        }
      }
      if (tableParts.length > 30) break;
    }
    if (tableParts.length > 0) return tableParts.join('\n').slice(0, 2500);
    // Фолбэк — весь текст страницы
    const body = doc.querySelector('main') ?? doc.querySelector('.search-results') ?? doc.body;
    return (body?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  } catch {
    return '';
  }
}

// ── Получить контекст из zakupki.gov.ru через наш nginx-proxy ──────────────────
async function fetchEisContext(g: GoodsItem, searchQuery: string, signal: AbortSignal): Promise<string> {
  const parts: string[] = [];
  // 1. Поиск по КТРУ-каталогу zakupki.gov.ru
  const ktruQ = encodeURIComponent(`${searchQuery} ${g.name}`);
  const ktruPath = `/proxy/zakupki/epz/ktru/ws/search/common/?searchString=${ktruQ}&morphology=on&pageNumber=1&recordsPerPage=5`;
  try {
    const r = await fetch(ktruPath, { signal });
    if (r.ok) {
      const html = await r.text();
      const extracted = extractEisText(html);
      if (extracted.length > 50) parts.push('=== КТРУ-каталог ===\n' + extracted);
    }
  } catch { /* proxy недоступен — продолжаем */ }

  // 2. Поиск закупок по 44-ФЗ с данным товаром
  const eiQ = encodeURIComponent(`${searchQuery} ${g.name}`);
  const eisPath = `/proxy/zakupki/epz/order/extendedsearch/results.html?searchString=${eiQ}&morphology=on&fz44=on&sortBy=UPDATE_DATE&pageNumber=1&recordsPerPage=_5&showLotsInfoHidden=false`;
  try {
    const r2 = await fetch(eisPath, { signal });
    if (r2.ok) {
      const html2 = await r2.text();
      const extracted2 = extractEisText(html2);
      if (extracted2.length > 50) parts.push('=== Результаты поиска ЕИС ===\n' + extracted2);
    }
  } catch { /* продолжаем без контекста ЕИС */ }

  return parts.join('\n\n').slice(0, 3000);
}

// ── Промпт: генерация ТЗ в стиле реальных закупок ЕИС ────────────────────────
function buildEisStylePrompt(
  row: GoodsRow,
  g: GoodsItem,
  eisContext: string,
  platformSettings?: PlatformIntegrationSettings
): string {
  if (isUniversalGoodsType(row.type)) {
    return buildUniversalSearchPrompt(row, 'ЕИС / закупочные площадки', eisContext, platformSettings);
  }
  const nac = SW_PROMPT_TYPES.includes(row.type) ? 'pp1236' : 'pp878';
  const isSW = !!g.isSoftware;
  const resolvedCommercial = getResolvedCommercialContext(row);
  const exactModelRequested = looksLikeSpecificModelQuery(row.model);
  const minSpecs = exactModelRequested
    ? Math.min(getMinimumSpecCount(row, resolvedCommercial), isSW ? 14 : 12)
    : getMinimumSpecCount(row, resolvedCommercial);
  const hint = getDetailedSpecHint(row.type);
  const organizationBlock = buildOrganizationMemoryPromptBlock(platformSettings, !!g.isService);
  const ldapRoleHint = row.type === 'ldap'
    ? getLdapRoleHint(resolvedCommercial.ldapProfile, resolvedCommercial.suggestedLicenseType)
    : '';
  const law175Example = getResolvedLaw175Meta(row.type, { nac_regime: nac, ktru_code: g.ktruFixed ?? '' });
  const ctx = eisContext
    ? `\nКонтекст из ЕИС / закупочных площадок / реестровых источников (zakupki.gov.ru, Rostender, Минпромторг/ГИСП) — используй как образец реальных требований:\n---\n${eisContext}\n---`
    : '\n(Контекст ЕИС/закупочных площадок недоступен — используй знания о типичных ТЗ из ЕИС, Rostender и реестровых источников Минпромторга/ГИСП для данного класса товаров. Сгенерируй характеристики уровня реальных закупок.)';
  return `Ты — эксперт по госзакупкам РФ. Составь ТЗ для закупки по 44-ФЗ в стиле реальных документов ЕИС, закупочных площадок и реестровых источников Минпромторга.

Исходный запрос (только для поиска и контекста, не копировать в ответ): "${row.model}"
Тип товара: ${g.name}
ОКПД2: ${g.okpd2}
${ctx}
${organizationBlock}

Требования к ТЗ:
- Реалистичные характеристики для российского рынка поставщиков
- МАКСИМАЛЬНАЯ ДЕТАЛИЗАЦИЯ — уровень реальных ТЗ из ЕИС
- Не указывать торговые марки, производителей, артикулы и точные модели
- Использовать обезличенные формулировки «без указания товарного знака (эквивалент)»
- Числа: «не менее X»
- Единицы: ГГц, МГц, ГБ, МБ, ТБ
- Сокеты процессора НЕ УКАЗЫВАТЬ${isSW ? '\n- ПО: реестр Минцифры (ПП РФ № 1236), сертификаты ФСТЭК/ФСБ где применимо\n- Перечислить ВСЕ функциональные модули и возможности' : ''}
- Не менее ${minSpecs} характеристик, сгруппированных по разделам
- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать «не указан», «не указано», «не указаны», «н/д», «неизвестно» в значениях.
${exactModelRequested
  ? '- Для конкретной модели запрещено подставлять типовые характеристики класса товара, если они не подтверждены найденными источниками.'
  : '- Если точное значение неизвестно — укажи ТИПИЧНОЕ значение для данного класса с «не менее»/«не более».'
}
- Поле meta.law175_basis не оставлять пустым: кратко обоснуй выбранную меру ПП РФ № 1875 либо неприменимость; исключение указывай только при документированном основании.
${hint ? '\nВключить как минимум:\n' + hint.split('\n').filter((l: string) => l.startsWith('- ')).slice(0, 20).join('\n') : ''}
${ldapRoleHint}

Ответ СТРОГО в JSON без пояснений и markdown:
{"meta":{"okpd2_code":"${g.okpd2}","okpd2_name":"${g.okpd2name}","ktru_code":"${g.ktruFixed ?? ''}","nac_regime":"${nac}","law175_status":"${law175Example.status}","law175_basis":"${law175Example.promptBasis}"},"specs":[{"group":"Группа","name":"Характеристика","value":"Значение","unit":"тип"}]}`;
}

// ── Вспомогательные функции DOCX ─────────────────────────────────────────────
const FONT = 'Times New Roman';
const FONT_SIZE = 22; // half-points → 11pt
// Full font object — ensures Cyrillic (Complex Scripts) renders correctly in Word/LibreOffice
const FONT_PROP = { ascii: FONT, cs: FONT, hAnsi: FONT } as const;
const DOCX_PAGE_MARGINS = { top: 1041, right: 1003, bottom: 1539, left: 1129 };
const DOCX_TEXT_WIDTH = 9768;
const DOCX_CELL_MARGINS = { top: 60, bottom: 60, left: 80, right: 80 };
const DOCX_COMPACT_MARGINS = { top: 35, bottom: 35, left: 50, right: 50 };
// Spec-table column widths in DXA (must sum to DOCX_TEXT_WIDTH = 9768)
const DOCX_SPEC_COL = { name: 4884, value: 3480, unit: 1404 } as const;
const DOCX_SUMMARY_WIDTHS = {
  commercial: { idx: 420, name: 4380, license: 1750, term: 1100, qty: 720, appendix: 1398 },
  default: { idx: 420, name: 6700, qty: 1000, appendix: 1648 },
};


function numText(n: number): string {
  const ones = ['','один','два','три','четыре','пять','шесть','семь','восемь','девять',
                 'десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать',
                 'шестнадцать','семнадцать','восемнадцать','девятнадцать'];
  const tens = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
  if (n === 0) return 'ноль';
  if (n < 20) return ones[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return tens[t] + (o ? ' ' + ones[o] : '');
}

// ── Функция генерации DOCX (структура по шаблону) ────────────────────────────
async function buildDocx(
  rows: GoodsRow[],
  lawMode: LawMode,
  readinessSummary: ReadinessGateSummary | null = null,
  benchmarkingEnabled = true,
  platformSettings?: PlatformIntegrationSettings,
): Promise<Blob> {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    HeightRule,
    Packer,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableLayoutType,
    TableRow,
    TextRun,
    VerticalAlign,
    WidthType,
  } = await import('docx');
  type DocxAlignment = (typeof AlignmentType)[keyof typeof AlignmentType];
  type DocxParagraph = InstanceType<typeof Paragraph>;
  type DocxTable = InstanceType<typeof Table>;
  type DocxTableRow = InstanceType<typeof TableRow>;
  const doneRows = rows.filter((r) => r.status === 'done' && r.specs);
  if (doneRows.length === 0) throw new Error('Нет готовых позиций для экспорта');

  function cellShade(fill: string) {
    return { fill, type: ShadingType.CLEAR, color: 'auto' };
  }

  function noBorders() {
    const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    return { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
  }

  function docxRuns(text: string, opts: { bold?: boolean; color?: string; size?: number; italics?: boolean } = {}) {
    const parts = String(text || '').split('\n');
    return parts.flatMap((part, idx) => {
      const runs = [
        new TextRun({
          text: part,
          bold: opts.bold ?? false,
          color: opts.color,
          italics: opts.italics ?? false,
          font: FONT_PROP,
          size: opts.size ?? FONT_SIZE,
        }),
      ];
      if (idx < parts.length - 1) runs.push(new TextRun({ break: 1 }));
      return runs;
    });
  }

  function allBorders() {
    const b = { style: BorderStyle.SINGLE, size: 4, color: 'A0AEC0' };
    return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
  }

  function hCell(
    text: string,
    opts: {
      span?: number;
      w?: number;
      size?: number;
      margins?: { top: number; bottom: number; left: number; right: number };
    } = {},
  ) {
    return new TableCell({
      children: [new Paragraph({
        children: docxRuns(text, { bold: true, color: 'FFFFFF', size: opts.size ?? FONT_SIZE }),
        alignment: AlignmentType.CENTER,
        keepLines: true,
      })],
      columnSpan: opts.span,
      width: opts.w ? { size: opts.w, type: WidthType.DXA } : undefined,
      shading: cellShade('1F5C8B'),
      verticalAlign: VerticalAlign.CENTER,
      borders: allBorders(),
      margins: opts.margins ?? DOCX_CELL_MARGINS,
    });
  }

  function dCell(
    text: string,
    opts: {
      span?: number;
      w?: number;
      align?: DocxAlignment;
      size?: number;
      margins?: { top: number; bottom: number; left: number; right: number };
    } = {},
  ) {
    return new TableCell({
      children: [new Paragraph({
        children: docxRuns(text || '—', { size: opts.size ?? FONT_SIZE }),
        alignment: opts.align ?? AlignmentType.CENTER,
        keepLines: true,
      })],
      columnSpan: opts.span,
      width: opts.w ? { size: opts.w, type: WidthType.DXA } : undefined,
      verticalAlign: VerticalAlign.CENTER,
      borders: allBorders(),
      margins: opts.margins ?? DOCX_CELL_MARGINS,
    });
  }

  function buildDocxSectionParas(rows0: SectionTableRow[]): DocxParagraph[] {
    return rows0.map((row) => new Paragraph({
      children: [
        new TextRun({ text: `${row.label}. `, bold: true, font: FONT_PROP, size: FONT_SIZE }),
        ...docxRuns(row.value),
      ],
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 100 },
      keepLines: true,
    }));
  }

  function specGroupRow3(text: string) {
    return new TableRow({
      cantSplit: true,
      children: [new TableCell({
        columnSpan: 3,
        children: [new Paragraph({
          children: docxRuns(text, { bold: true, size: FONT_SIZE }),
          alignment: AlignmentType.CENTER,
          keepLines: true,
        })],
        shading: cellShade('DBEAFE'),
        borders: allBorders(),
        margins: DOCX_CELL_MARGINS,
      })],
    });
  }

  function spec3DataRow(name: string, value: string, unit: string, _warning?: string) {
    // БАГ 1: в DOCX ячейку пишем ТОЛЬКО чистое значение — без [!] и текста предупреждения.
    // Предупреждение отображается только в UI (жёлтая подсветка), в документ не попадает.
    const valText = value.replace(/\s*\[!?\][^[\]]*$/, '').replace(/\(?\[!?\][^[\]]*\)?/g, '').trim() || value;
    return new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          children: [new Paragraph({ children: docxRuns(name, { size: FONT_SIZE }), keepLines: true })],
          width: { size: DOCX_SPEC_COL.name, type: WidthType.DXA },
          borders: allBorders(),
          margins: DOCX_CELL_MARGINS,
        }),
        new TableCell({
          children: [new Paragraph({ children: docxRuns(valText, { size: FONT_SIZE }), keepLines: true })],
          width: { size: DOCX_SPEC_COL.value, type: WidthType.DXA },
          borders: allBorders(),
          margins: DOCX_CELL_MARGINS,
        }),
        new TableCell({
          children: [new Paragraph({ children: docxRuns(unit, { size: FONT_SIZE }), keepLines: true })],
          width: { size: DOCX_SPEC_COL.unit, type: WidthType.DXA },
          borders: allBorders(),
          margins: DOCX_CELL_MARGINS,
        }),
      ],
    });
  }

  const children: Array<DocxParagraph | DocxTable> = [];
  const docSections = buildDocumentSectionBundle(doneRows, lawMode, readinessSummary, benchmarkingEnabled, platformSettings);
  const {
    currentYear,
    objectName,
    multi,
    showCommercialTerms,
  } = docSections;

  // ── Вспомогательные параграфы ──────────────────────────────────
  // Заголовки разделов: bold, 13pt
  const sectionHead = (text: string, spacingBefore = 200) => new Paragraph({
    children: docxRuns(text, { bold: true, size: 26 }),
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: spacingBefore, after: 100 },
    keepLines: true,
    keepNext: true,
  });
  // Обычный текст: по ширине
  const regPara = (text: string) => new Paragraph({
    children: docxRuns(text, { size: FONT_SIZE }),
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 80 },
    keepLines: true,
  });
  // Центрированный текст
  const centerPara = (text: string, opts?: { bold?: boolean; size?: number; spacing?: number }) => new Paragraph({
    children: docxRuns(text, { bold: opts?.bold ?? false, size: opts?.size ?? FONT_SIZE }),
    alignment: AlignmentType.CENTER,
    spacing: { before: opts?.spacing ?? 0, after: 80 },
    keepLines: true,
  });

  const borderlessCell = (paragraphs: DocxParagraph[], w: number) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    borders: noBorders(),
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    children: paragraphs,
    verticalAlign: VerticalAlign.CENTER,
  });

  const approvalTitle = platformSettings?.approvalPersonTitle?.trim() || '';
  const approvalName = platformSettings?.approvalPersonName?.trim() || '';
  const approvalOrg = platformSettings?.orgNameShort?.trim() || platformSettings?.orgName?.trim() || '';
  const buildApprovalBlock = () => new Table({
    layout: TableLayoutType.FIXED,
    width: { size: DOCX_TEXT_WIDTH, type: WidthType.DXA },
    borders: noBorders(),
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          borderlessCell([new Paragraph({ children: [] })], 5600),
          borderlessCell([
            new Paragraph({
              children: docxRuns('УТВЕРЖДАЮ', { bold: true, size: FONT_SIZE }),
              alignment: AlignmentType.CENTER,
              spacing: { after: 40 },
              keepLines: true,
              keepNext: true,
            }),
            ...(approvalOrg ? [new Paragraph({
              children: docxRuns(approvalOrg, { size: FONT_SIZE }),
              alignment: AlignmentType.CENTER,
              spacing: { after: 20 },
              keepLines: true,
              keepNext: true,
            })] : []),
            new Paragraph({
              children: docxRuns(approvalTitle || '________________________________', { size: FONT_SIZE, italics: !approvalTitle }),
              alignment: AlignmentType.CENTER,
              spacing: { after: 10 },
              keepLines: true,
              keepNext: true,
            }),
            new Paragraph({
              children: approvalName
                ? docxRuns(`_____________ / ${approvalName} /`, { size: FONT_SIZE })
                : docxRuns('_____________ / _______________ /', { size: FONT_SIZE }),
              alignment: AlignmentType.CENTER,
              spacing: { after: 40 },
              keepLines: true,
              keepNext: true,
            }),
            new Paragraph({
              children: docxRuns(`«___» _______ ${currentYear} г.`, { size: FONT_SIZE }),
              alignment: AlignmentType.CENTER,
              spacing: { after: 120 },
              keepLines: true,
            }),
          ], DOCX_TEXT_WIDTH - 5600),
        ],
      }),
    ],
  });

  const buildSummaryTable = () => {
    const summaryRows: DocxTableRow[] = [];

    if (showCommercialTerms) {
      const widths = DOCX_SUMMARY_WIDTHS.commercial;
      summaryRows.push(new TableRow({
        tableHeader: true,
        cantSplit: true,
        height: { value: 400, rule: HeightRule.ATLEAST },
        children: [
          hCell('№', { w: widths.idx, size: 16, margins: DOCX_COMPACT_MARGINS }),
          hCell('Наименование', { w: widths.name, size: 16, margins: DOCX_COMPACT_MARGINS }),
          hCell('Тип лицензии', { w: widths.license, size: 16, margins: DOCX_COMPACT_MARGINS }),
          hCell('Срок\nдействия', { w: widths.term, size: 16, margins: DOCX_COMPACT_MARGINS }),
          hCell('Кол-\nво', { w: widths.qty, size: 16, margins: DOCX_COMPACT_MARGINS }),
          hCell('Прил.\n№', { w: widths.appendix, size: 16, margins: DOCX_COMPACT_MARGINS }),
        ],
      }));

      doneRows.forEach((row, idx) => {
        const commercial = getResolvedCommercialContext(row);
        summaryRows.push(new TableRow({
          cantSplit: true,
          children: [
            dCell(String(idx + 1), { w: widths.idx, align: AlignmentType.CENTER, size: 16, margins: DOCX_COMPACT_MARGINS }),
            dCell(getRowDisplayLabel(row), {
              w: widths.name,
              align: AlignmentType.LEFT,
              size: 16,
              margins: DOCX_COMPACT_MARGINS,
            }),
            dCell(getCommercialValue(commercial.suggestedLicenseType), {
              w: widths.license,
              align: AlignmentType.LEFT,
              size: 16,
              margins: DOCX_COMPACT_MARGINS,
            }),
            dCell(getCommercialValue(commercial.suggestedTerm), {
              w: widths.term,
              align: AlignmentType.CENTER,
              size: 16,
              margins: DOCX_COMPACT_MARGINS,
            }),
            dCell(`${row.qty} ${getRowQtyUnitShort(row)}`, {
              w: widths.qty,
              align: AlignmentType.CENTER,
              size: 16,
              margins: DOCX_COMPACT_MARGINS,
            }),
            dCell(`Прил. ${idx + 1}`, {
              w: widths.appendix,
              align: AlignmentType.CENTER,
              size: 16,
              margins: DOCX_COMPACT_MARGINS,
            }),
          ],
        }));
      });
    } else {
      const widths = DOCX_SUMMARY_WIDTHS.default;
      summaryRows.push(new TableRow({
        tableHeader: true,
        cantSplit: true,
        height: { value: 400, rule: HeightRule.ATLEAST },
        children: [
          hCell('№', { w: widths.idx, size: 16, margins: DOCX_COMPACT_MARGINS }),
          hCell('Наименование', { w: widths.name, size: 16, margins: DOCX_COMPACT_MARGINS }),
          hCell('Кол-\nво', { w: widths.qty, size: 16, margins: DOCX_COMPACT_MARGINS }),
          hCell('Прил.\n№', { w: widths.appendix, size: 16, margins: DOCX_COMPACT_MARGINS }),
        ],
      }));

      doneRows.forEach((row, idx) => {
        summaryRows.push(new TableRow({
          cantSplit: true,
          children: [
            dCell(String(idx + 1), { w: widths.idx, align: AlignmentType.CENTER, size: 16, margins: DOCX_COMPACT_MARGINS }),
            dCell(getRowDisplayLabel(row), {
              w: widths.name,
              align: AlignmentType.LEFT,
              size: 16,
              margins: DOCX_COMPACT_MARGINS,
            }),
            dCell(`${row.qty} ${getRowQtyUnitShort(row)}`, {
              w: widths.qty,
              align: AlignmentType.CENTER,
              size: 16,
              margins: DOCX_COMPACT_MARGINS,
            }),
            dCell(`Прил. ${idx + 1}`, {
              w: widths.appendix,
              align: AlignmentType.CENTER,
              size: 16,
              margins: DOCX_COMPACT_MARGINS,
            }),
          ],
        }));
      });
    }

    return new Table({
      layout: TableLayoutType.FIXED,
      width: { size: DOCX_TEXT_WIDTH, type: WidthType.DXA },
      rows: summaryRows,
    });
  };

  // ── Helper: builds spec table rows with product name header ──
  // Filter out specs that are physically unmeasurable/unverifiable at delivery acceptance.
  // Keeps: numeric values, boolean (Да/Нет), standards references, multi-word descriptions.
  // Removes: single vague adjectives that cannot be physically tested.
  function isDocxVerifiableSpec(spec: SpecItem): boolean {
    const value = String(spec.value || '').trim();
    if (!value) return false;
    if (/\d/.test(value)) return true;
    if (/^(да|нет|наличие|есть|имеется|поддерживается|не поддерживается)$/i.test(value)) return true;
    if (/не менее|не более|или эквивалент|или выше|usb\s*\d|hdmi|displayport|rj-45|ieee\s*802|ddr\d|nvme|sata|pcie|tls|ssl|gost|гост|ips|ва|oled|amoled|фстэк|ldap|smtp/i.test(value)) return true;
    if (value.split(/\s+/).length >= 4) return true;
    const VAGUE_SINGLE = /^(высокая?|высокий|хорошая?|хороший|стандартная?|стандартный|большой|большая|быстрый|быстрая|надёжный|надёжная|качественный|качественная|современный|современная|передовой|передовая|эффективный|эффективная|оптимальный|оптимальная|по\s+требованию|определяется|устанавливается|соответствует|произвольный|любой|любая|в\s+соответствии|согласно|допустимый|допустимая)$/i;
    if (VAGUE_SINGLE.test(value)) return false;
    return true;
  }

  const buildSpecTableWithHeader = (
    productName: string, specs: SpecItem[]
  ): DocxTableRow[] => {
    const rows: DocxTableRow[] = [];
    // Filter to only physically verifiable specs in the exported document
    specs = specs.filter(isDocxVerifiableSpec);
    // Row 0: product name spanning all 3 columns
    rows.push(new TableRow({
      cantSplit: true,
      children: [new TableCell({
        columnSpan: 3,
        children: [new Paragraph({
          children: docxRuns(productName, { bold: true, size: FONT_SIZE }),
          alignment: AlignmentType.CENTER,
          keepLines: true,
        })],
        shading: cellShade('F3F4F6'),
        borders: allBorders(),
        margins: DOCX_CELL_MARGINS,
      })],
    }));
    // Row 1: column headers (widths match DOCX_SPEC_COL so FIXED layout renders correctly)
    rows.push(new TableRow({
      tableHeader: true,
      cantSplit: true,
      height: { value: 400, rule: HeightRule.ATLEAST },
      children: [
        hCell('Наименование характеристики', { w: DOCX_SPEC_COL.name }),
        hCell('Значение характеристики', { w: DOCX_SPEC_COL.value }),
        hCell('Единица измерения', { w: DOCX_SPEC_COL.unit }),
      ],
    }));
    // Row 2+: groups and data (stable-sort by group to prevent duplicate group headers)
    const groupOrder: string[] = [];
    const seenForOrder = new Set<string>();
    for (const spec of specs) {
      const g = spec.group ?? '';
      if (g && !seenForOrder.has(g)) { seenForOrder.add(g); groupOrder.push(g); }
    }
    const sortedSpecs = [...specs].sort((a, b) => {
      const ga = groupOrder.indexOf(a.group ?? '');
      const gb = groupOrder.indexOf(b.group ?? '');
      return ga - gb;
    });
    // БАГ 4: дедупликация — убираем строки с одинаковым именем внутри одной группы
    const seenSpecKeys = new Set<string>();
    const dedupedSpecs = sortedSpecs.filter((spec) => {
      const normName = String(spec.name ?? '').toLowerCase().trim().replace(/[^\wа-яёА-ЯЁ]/g, '');
      const normGroup = String(spec.group ?? '').toLowerCase().trim().replace(/[^\wа-яёА-ЯЁ]/g, '');
      const key = `${normGroup}::${normName}`;
      if (!normName) return true; // пустые имена не дедуплицируем
      if (seenSpecKeys.has(key)) return false;
      seenSpecKeys.add(key);
      return true;
    });
    let curGroup = '';
    for (const spec of dedupedSpecs) {
      if (spec.group && spec.group !== curGroup) {
        curGroup = spec.group;
        rows.push(specGroupRow3(curGroup));
      }
      const warn = spec._warning ? String(spec._warning) : undefined;
      rows.push(spec3DataRow(String(spec.name ?? ''), String(spec.value ?? ''), String(spec.unit ?? ''), warn));
    }
    return rows;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // ШАПКА: УТВЕРЖДАЮ + название ТЗ
  // ═══════════════════════════════════════════════════════════════════════════
  {
    children.push(buildApprovalBlock());

    // Заголовок ТЗ (по центру, жирный)
    children.push(centerPara('Техническое задание', { bold: true, size: 28 }));
    children.push(centerPara(`${docSections.serviceOnly ? 'на оказание' : 'на поставку'} ${objectName}`, { size: 24, spacing: 0 }));
    children.push(new Paragraph({ children: [], spacing: { after: 160 } }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // РАЗДЕЛ 1: Наименование, Заказчик, Исполнитель, сроки выполнения
  // ═══════════════════════════════════════════════════════════════════════════
  {
    children.push(sectionHead('1. Наименование, Заказчик, Исполнитель, сроки выполнения', 0));
    children.push(...buildDocxSectionParas(docSections.section1Rows));
    if (!multi) {
      // Для одной позиции отдельная сводная таблица не требуется.
    } else {
      if (doneRows.length > 5) {
        children.push(new Paragraph({ children: [], pageBreakBefore: true }));
    } else {
      children.push(new Paragraph({ children: [], spacing: { after: 60 } }));
    }
    children.push(buildSummaryTable());
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // РАЗДЕЛ 2: Требования к предмету закупки
  // ═══════════════════════════════════════════════════════════════════════════
  children.push(sectionHead('2. Требования к предмету закупки'));
  children.push(...buildDocxSectionParas(docSections.section2Rows));

  // ═══════════════════════════════════════════════════════════════════════════
  // РАЗДЕЛ 3: Требования к пуско-наладочным работам
  // ═══════════════════════════════════════════════════════════════════════════
  children.push(sectionHead(docSections.section3Title));
  children.push(...buildDocxSectionParas(docSections.section3Rows));

  // ═══════════════════════════════════════════════════════════════════════════
  // РАЗДЕЛ 4: Требования к сроку предоставления гарантии качества
  // ═══════════════════════════════════════════════════════════════════════════
  children.push(sectionHead(docSections.section4Title));
  children.push(...buildDocxSectionParas(docSections.section4Rows));

  // ═══════════════════════════════════════════════════════════════════════════
  // РАЗДЕЛ 5: Требования к таре и упаковке товара
  // ═══════════════════════════════════════════════════════════════════════════
  children.push(sectionHead(docSections.section5Title));
  children.push(...buildDocxSectionParas(docSections.section5Rows));

  // ═══════════════════════════════════════════════════════════════════════════
  // РАЗДЕЛ 6: Место, сроки и условия поставки товара
  // ═══════════════════════════════════════════════════════════════════════════
  children.push(sectionHead(docSections.section6Title));
  children.push(...buildDocxSectionParas(docSections.section6Rows));

  // ═══════════════════════════════════════════════════════════════════════════
  // РАЗДЕЛ 7: Перечень нормативных правовых актов
  // ═══════════════════════════════════════════════════════════════════════════
  if (docSections.section7Rows && docSections.section7Rows.length > 0) {
    children.push(sectionHead(docSections.section7Title ?? '7. Перечень нормативных правовых актов'));
    children.push(...buildDocxSectionParas(docSections.section7Rows));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ПРИЛОЖЕНИЯ (Спецификации — по одному на каждую позицию)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    for (let i = 0; i < doneRows.length; i++) {
      const row = doneRows[i];
      const g = lookupCatalog(row.type);
      const isSW = !!g.isSoftware;
      const specs = row.specs ?? [];
      const commercial = getResolvedCommercialContext(row);
      const productName = getRowDisplayLabel(row);
      const commercialCaption = [commercial.suggestedLicenseType, commercial.suggestedTerm].filter(Boolean).join(' / ');

      children.push(new Paragraph({ pageBreakBefore: true, children: [] }));
      children.push(centerPara(multi ? `Приложение № ${i + 1}` : 'Приложение № 1', { bold: true, size: 24 }));
      children.push(new Paragraph({ children: [], spacing: { after: 40 } }));
      children.push(centerPara(
        docSections.serviceOnly
          ? 'Требования к составу, порядку оказания и результату услуг'
          : (isSW ? 'Требования к техническим характеристикам программного обеспечения' : 'Требования к техническим характеристикам поставляемого товара'),
        { size: FONT_SIZE }
      ));
      if (commercialCaption) {
        children.push(centerPara(commercialCaption, { size: 20, spacing: 0 }));
      }
      children.push(new Paragraph({ children: [], spacing: { after: 100 } }));

      // Таблица характеристик с заголовком-названием товара
      if (specs.length > 0) {
        const specTableRows = buildSpecTableWithHeader(productName, specs);
        children.push(new Table({
          layout: TableLayoutType.FIXED,
          width: { size: DOCX_TEXT_WIDTH, type: WidthType.DXA },
          rows: specTableRows,
        }));
      }
    }
  }

  // ── Единый финальный блок подписи и даты ──
  {
    const sigTitle = platformSettings?.approvalPersonTitle?.trim() || 'Специалист';
    const sigName = platformSettings?.approvalPersonName?.trim() || '';
    children.push(new Paragraph({ children: [], spacing: { before: 400 } }));
    children.push(regPara(`${sigTitle} ___________________________ ${sigName ? `/ ${sigName} /` : ''}`));
    children.push(new Paragraph({ children: [], spacing: { after: 40 } }));
    children.push(regPara(`«____» _______________ ${currentYear} г.                                     _______________`));
  }

  const allSpecTexts: string[] = [];
  for (const row of doneRows) {
    if (!row.specs) continue;
    for (const spec of row.specs) {
      allSpecTexts.push(`${spec.name || ''} ${spec.value || ''}`);
    }
  }
  const allSectionRows = [
    docSections.section1Rows,
    docSections.section2Rows,
    docSections.section3Rows,
    docSections.section4Rows,
    docSections.section5Rows,
    docSections.section6Rows,
  ];
  for (const sectionArr of allSectionRows) {
    for (const row of sectionArr) {
      const { text: fixedValue, fixes } = applyComplianceFixes(row.value);
      if (fixes.length > 0) {
        row.value = fixedValue;
      }
    }
  }
  const sectionTexts = allSectionRows.flat().map((r) => r.value);
  const fullDocText = [...allSpecTexts, ...sectionTexts].join('\n');
  const _swTypeSet = new Set(['os', 'office', 'virt', 'vdi', 'dbms', 'erp', 'cad', 'license', 'antivirus', 'edr', 'firewall_sw', 'dlp', 'siem', 'crypto', 'waf', 'pam', 'iam', 'pki', 'email', 'vks', 'ecm', 'portal', 'project_sw', 'bpm', 'backup_sw', 'itsm', 'monitoring', 'mdm', 'hr', 'gis', 'ldap', 'osSupport', 'supportCert', 'remoteAccessSw']);
  const hasSoftware = doneRows.some((r) => _swTypeSet.has(r.type));
  const hasHardware = doneRows.some((r) => !_swTypeSet.has(r.type) && r.type !== 'otherService');
  const docValidation = validateDocumentText(fullDocText, { lawMode, hasSoftware, hasHardware });
  if (docValidation.violations.length > 0) {
    console.warn(`[ФАС Compliance] Финальная проверка документа: ${docValidation.violations.length} нарушений обнаружено`);
    for (const v of docValidation.violations) {
      console.warn(`  ${v.logMessage}: ${v.reason}`);
    }
  }
  // docValidation.passed items logged implicitly via audit

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT_PROP, size: FONT_SIZE } } } },
    sections: [{
      properties: { page: { margin: DOCX_PAGE_MARGINS } },
      children,
    }],
  });

  return Packer.toBlob(doc);
}

const {
  analyzeServiceSpecCoverage,
  applyLegalReadinessPatchToRow,
  applyServiceReadinessPatchToRow,
  buildLegalSummaryRow,
  buildLegalSummaryText,
  buildPublicationDossierRows,
  buildPublicationDossierSummary,
  buildReadinessGateSummary,
  buildReadinessIssuePreview,
  buildServiceAutofillEntries,
  buildStoredPublicationDossierPayload,
  buildStoredReadinessPayload,
  shouldApplyLegalReadinessPatch,
} = createWorkspacePublicationTools({
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
});

// ── Компонент ─────────────────────────────────────────────────────────────────
type Props = {
  automationSettings: AutomationSettings;
  platformSettings: PlatformIntegrationSettings;
  enterpriseSettings: EnterpriseSettings;
  preferredProvider?: Provider;
  preferredModel?: string;
  backendUser?: {
    email: string;
    role: string;
    tz_count: number;
    tz_limit: number;
    trial_active?: boolean;
    trial_days_left?: number;
    payment_required?: boolean;
    access_tier?: 'admin' | 'pro' | 'trial' | 'payment_required';
  } | null;
};

export function Workspace({ automationSettings, platformSettings, enterpriseSettings, backendUser, preferredProvider, preferredModel }: Props) {
  // Hosted mode: use backend when explicit BACKEND_URL is configured.
  // Local mode keeps previous behavior (requires signed-in user).
  const useBackend = !!(BACKEND_URL || isBackendApiAvailable());
  const hasBackendSession = !!backendUser || isLoggedIn();
  const [lawMode, setLawMode] = useState<LawMode>('44');
  const [catalogMode, setCatalogMode] = useState<CatalogMode>('it');
  const [provider, setProvider] = useState<Provider>((preferredProvider as Provider) || 'deepseek');
  const [apiKey] = useState(''); // Client-side keys disabled — all AI through backend
  const [model, setModel] = useState(preferredModel || 'deepseek-chat');
  const [authPanelOpen, setAuthPanelOpen] = useState<boolean>(() => !useBackend);

  useEffect(() => {
    if (preferredProvider) setProvider(preferredProvider as Provider);
    if (preferredModel) setModel(preferredModel);
  }, [preferredProvider, preferredModel]);
  const [rows, setRows] = useState<GoodsRow[]>([{ id: 1, type: 'pc', typeLocked: false, model: '', licenseType: '', term: '', licenseTypeAuto: false, termAuto: false, qty: 1, status: 'idle' }]);
  const [docxReady, setDocxReady] = useState(false);
  const [qaAutoRunKey, setQaAutoRunKey] = useState(0);
  const [pendingAutoGenerate, setPendingAutoGenerate] = useState(false);
  const [complianceReport, setComplianceReport] = useState<ComplianceReport | null>(null);
  const [showReviewPanel, setShowReviewPanel] = useState(false);
  const [entryDismissed, setEntryDismissed] = useState(false);
  const [repairResult, setRepairResult] = useState<{ protocol: string; fixed_text: string; violation_count: number; provider_used: string } | null>(null);
  const [repairLoading, setRepairLoading] = useState(false);
  const [auditResult, setAuditResult] = useState<{ report: string; verdict: string; pass_count: number; fail_count: number } | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [deResult, setDeResult] = useState<DoubleEquivResult | null>(null);
  const [deConflicts, setDeConflicts] = useState<SpecConflict[]>([]);
  const [deLoading, setDeLoading] = useState(false);

  // Общий статус поиска по ЕИС (резерв)
  const [_eisSearching, setEisSearching] = useState(false); void _eisSearching;
  // Общий статус подтягивания из интернета (резерв)
  const [_internetSearching, setInternetSearching] = useState(false); void _internetSearching;
  // Toast-уведомление
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [validationResult, setValidationResult] = useState<TZValidateResponse | null>(null);
  const [pendingExportFn, setPendingExportFn] = useState<(() => void) | null>(null);
  // Автодетект: ID строки, где только что сменился тип (для подсветки)
  const [autoDetectedRow, setAutoDetectedRow] = useState<number | null>(null);
  const [focusedRowId, setFocusedRowId] = useState<number | null>(null);
  const [rowActionState, setRowActionState] = useState<{ rowId: number; source: 'internet' | 'eis' | 'classify' } | null>(null);
  const [publicationAutopilotRunning, setPublicationAutopilotRunning] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [splitSourceRows, setSplitSourceRows] = useState<GoodsRow[] | null>(null);
  const [activeSplitGroupKey, setActiveSplitGroupKey] = useState<ProcurementPurposeKey | null>(null);
  const [splitSaving, setSplitSaving] = useState(false);
  const [splitPlannerOpen, setSplitPlannerOpen] = useState(false);
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);
  // Inline spec editing
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [expandedRowMetaId, setExpandedRowMetaId] = useState<number | null>(null);
  // TZ history
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<TZDocumentSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);
  const [customTemplates, setCustomTemplates] = useState<WorkspaceTemplateStored[]>(() => getWorkspaceTemplates());

  useEffect(() => {
    if (!hasBackendSession) return;
    setRows((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (row.status === 'error' && /требуется авторизац/i.test(String(row.error || ''))) {
          changed = true;
          return {
            ...row,
            status: row.specs?.length ? ('done' as const) : ('idle' as const),
            error: '',
          };
        }
        return row;
      });
      return changed ? next : prev;
    });
  }, [hasBackendSession, rows]);
  // Выпадающая таблица типов при вводе бренда
  const [typeSuggestions, setTypeSuggestions] = useState<{ rowId: number; items: Array<{ type: string; name: string; okpd2: string }>; loading?: boolean; rect?: { top: number; left: number; width: number } } | null>(null);
  const aiSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiSearchCacheRef = useRef<Record<string, string[]>>({});
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const repairFileInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});
  // Ref для скролла к превью
  const previewRef = useRef<HTMLDivElement>(null);
  const portalContainerRef = useRef<HTMLDivElement | null>(null);
  const templatePresetMeta = useMemo(() => getOrganizationPresetMeta(platformSettings.industryPreset), [platformSettings.industryPreset]);
  const suggestedTemplatePacks = useMemo(
    () => getSuggestedOrganizationTemplatePacks(platformSettings.industryPreset),
    [platformSettings.industryPreset]
  );
  // Lazy-create a dedicated portal container (avoids React reconciliation conflicts with document.body)
  const getPortalContainer = useCallback(() => {
    if (!portalContainerRef.current) {
      const el = document.createElement('div');
      el.id = 'tz-portal-root';
      el.setAttribute('translate', 'no');
      document.body.appendChild(el);
      portalContainerRef.current = el;
    }
    return portalContainerRef.current;
  }, []);

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const refreshCustomTemplates = useCallback(() => {
    setCustomTemplates(getWorkspaceTemplates());
  }, []);

  const scrollToPreview = useCallback(() => {
    setTimeout(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  }, []);
  const focusRow = useCallback((rowId: number, openEditor = false) => {
    if (openEditor) setEditingRowId(rowId);
    setFocusedRowId(rowId);
    window.setTimeout(() => {
      rowRefs.current[rowId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    window.setTimeout(() => {
      setFocusedRowId((current) => (current === rowId ? null : current));
    }, 2600);
  }, []);
  const setRowRef = useCallback((rowId: number, node: HTMLTableRowElement | null) => {
    rowRefs.current[rowId] = node;
  }, []);

  const handleImportFile = useCallback(async (file: File) => {
    try {
      const imported = await parseImportedRows(file);
      if (imported.length === 0) {
        showToast(`❌ В файле «${file.name}» не найдено ни одной позиции. Build: ${APP_BUILD_LABEL}`, false);
        return;
      }
      const now = Date.now();
      const mappedRows = imported.map((item, idx) => {
        const type = detectFreeformRowType(item.rawType, item.description, {
          conservativeGeneral: item.importInfo.sourceFormat === 'docx',
          okpd2: item.meta?.okpd2_code || item.meta?.okpd2,
          contextText: item.importInfo.sourceContextText,
        });
        const classificationSource = item.importInfo.sourceFormat === 'docx' ? 'docx_import' : 'import';
        const hasSeedSpecs = !!item.specs?.length;
        return applyAutoCommercialTerms({
          id: now + idx,
          type,
          typeLocked: false,
          model: item.description || item.rawType,
          licenseType: item.licenseType,
          term: item.term,
          licenseTypeAuto: false,
          termAuto: false,
          qty: item.qty || 1,
          status: hasSeedSpecs ? 'done' as const : 'idle' as const,
          specs: item.specs,
          meta: normalizeResolvedMeta(type, {
            ...(item.meta || {}),
            classification_source: classificationSource,
            ...(item.nameNeedsReview ? { name_needs_review: 'true' } : {}),
          }),
          importInfo: item.importInfo,
        });
      });
      setSplitSourceRows(null);
      setActiveSplitGroupKey(null);
      setSplitPlannerOpen(false);
      setRows((prev) => {
        const existingReal = prev.filter((r) => r.model.trim() !== '' || !!(r.specs?.length));
        return [...existingReal, ...mappedRows];
      });
      setCurrentDocId(null);
      setExpandedRowMetaId(null);
      setEditingRowId(null);
      setFocusedRowId(null);
      setTypeSuggestions(null);
      setRowActionState(null);
      setAutoDetectedRow(null);
      setComplianceReport(null);
      const hasSeeds = mappedRows.some((row) => row.status === 'done' && !!row.specs?.length);
      setDocxReady(hasSeeds);
      if (mappedRows.some((row) => isServiceCatalogType(row.type) || row.type === 'otherGoods' || row.type === 'otherService')) {
        setCatalogMode('general');
      }
      const seededRows = mappedRows.filter((row) => row.specs?.length).length;
      const lowConfidenceRows = mappedRows.filter((row) => (row.importInfo?.confidence || 0) < 0.75).length;
      if (!hasSeeds) setPendingAutoGenerate(true);
      showToast(
        `✅ Добавлено ${mappedRows.length} позиций из «${file.name}»${seededRows ? `, seed-спеки: ${seededRows}` : ''}${lowConfidenceRows ? `, проверьте вручную: ${lowConfidenceRows}` : ''}. Запускаю генерацию ТЗ...`,
        true,
      );
    } catch (error) {
      showToast(`❌ Ошибка импорта: ${error instanceof Error ? error.message : 'не удалось разобрать файл'}`, false);
    }
  }, [showToast]);

  const handleImportMultipleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    if (fileArray.length === 1) {
      void handleImportFile(fileArray[0]);
      return;
    }
    try {
      showToast(`⏳ Загружаю ${fileArray.length} файлов...`, true);
      const now = Date.now();
      const results = await Promise.all(
        fileArray.map((file) => parseImportedRows(file).catch(() => []))
      );
      const allImported = results.flat();
      if (allImported.length === 0) {
        showToast(`❌ Ни в одном из ${fileArray.length} файлов не найдено позиций.`, false);
        return;
      }
      const mappedRows = allImported.map((item, idx) => {
        const type = detectFreeformRowType(item.rawType, item.description, {
          conservativeGeneral: item.importInfo.sourceFormat === 'docx',
          okpd2: item.meta?.okpd2_code || item.meta?.okpd2,
          contextText: item.importInfo.sourceContextText,
        });
        const classificationSource = item.importInfo.sourceFormat === 'docx' ? 'docx_import' : 'import';
        const hasSeedSpecs = !!item.specs?.length;
        return applyAutoCommercialTerms({
          id: now + idx,
          type,
          typeLocked: false,
          model: item.description || item.rawType,
          licenseType: item.licenseType,
          term: item.term,
          licenseTypeAuto: false,
          termAuto: false,
          qty: item.qty || 1,
          status: hasSeedSpecs ? 'done' as const : 'idle' as const,
          specs: item.specs,
          meta: normalizeResolvedMeta(type, {
            ...(item.meta || {}),
            classification_source: classificationSource,
          }),
          importInfo: item.importInfo,
        });
      });
      setSplitSourceRows(null);
      setActiveSplitGroupKey(null);
      setSplitPlannerOpen(false);
      setRows((prev) => {
        const existingReal = prev.filter((r) => r.model.trim() !== '' || !!(r.specs?.length));
        return [...existingReal, ...mappedRows];
      });
      setCurrentDocId(null);
      setExpandedRowMetaId(null);
      setEditingRowId(null);
      setFocusedRowId(null);
      setTypeSuggestions(null);
      setRowActionState(null);
      setAutoDetectedRow(null);
      setComplianceReport(null);
      const hasSeeds = mappedRows.some((row) => row.status === 'done' && !!row.specs?.length);
      setDocxReady(hasSeeds);
      if (mappedRows.some((row) => isServiceCatalogType(row.type) || row.type === 'otherGoods' || row.type === 'otherService')) {
        setCatalogMode('general');
      }
      if (!hasSeeds) setPendingAutoGenerate(true);
      const fileNames = fileArray.map((f) => f.name).join(', ');
      showToast(
        `✅ Добавлено ${mappedRows.length} позиций из ${fileArray.length} файлов: ${fileNames}. Запускаю генерацию ТЗ...`,
        true,
      );
    } catch (error) {
      showToast(`❌ Ошибка импорта: ${error instanceof Error ? error.message : 'не удалось разобрать файлы'}`, false);
    }
  }, [handleImportFile, showToast]);

  const hasUserApiKey = false; // Client-side API keys disabled — all AI through backend
  const useBackendAi = useBackend;
  const handleRowModelChange = useCallback((row: GoodsRow, event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    const inputEl = event.target as HTMLElement;
    const inputRect = inputEl.getBoundingClientRect();
    const rectData = { top: inputRect.bottom + 4, left: inputRect.left, width: Math.max(inputRect.width, 460) };

    const allTypes = detectAllCatalogTypes(value);
    if (allTypes.length > 1) {
      setTypeSuggestions({ rowId: row.id, items: allTypes, rect: rectData });
    } else if (value.trim().length >= 3) {
      setTypeSuggestions({ rowId: row.id, items: allTypes, loading: true, rect: rectData });
    } else {
      setTypeSuggestions(null);
    }

    if (aiSearchTimerRef.current) clearTimeout(aiSearchTimerRef.current);
    if (value.trim().length >= 3 && (apiKey.trim() || useBackend)) {
      const query = value.trim().toLowerCase();
      aiSearchTimerRef.current = setTimeout(async () => {
        if (aiSearchCacheRef.current[query]) {
          const cached = aiSearchCacheRef.current[query];
          const items = cached.map((key) => ({ type: key, name: lookupCatalog(key)?.name ?? key, okpd2: lookupCatalog(key)?.okpd2 ?? '' }));
          if (items.length > 0) {
            const input = document.querySelector('input[placeholder*="Например"]') as HTMLElement | null;
            const rect = input ? input.getBoundingClientRect() : inputRect;
            setTypeSuggestions({ rowId: row.id, items, rect: { top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 460) } });
          }
          return;
        }

        const keys = [...Object.keys(GOODS_CATALOG), ...Object.keys(GENERAL_CATALOG)];
        const labels: Record<string, string> = {};
        keys.forEach((key) => { labels[key] = lookupCatalog(key)?.name ?? key; });

        try {
          const aiTypes = (useBackendAi && !apiKey.trim())
            ? await detectBrandTypesViaBackend(provider, model, query, keys, labels)
            : await detectBrandTypesAI(provider, apiKey, model, query, keys, labels);
          aiSearchCacheRef.current[query] = aiTypes;
          if (aiTypes.length > 0) {
            const seen = new Set(allTypes.map((item) => item.type));
            const merged = [...allTypes];
            for (const key of aiTypes) {
              const item = lookupCatalog(key);
              if (!seen.has(key) && item) {
                seen.add(key);
                merged.push({ type: key, name: item.name, okpd2: item.okpd2 });
              }
            }
            const input = document.querySelector('input[placeholder*="Например"]') as HTMLElement | null;
            const rect = input ? input.getBoundingClientRect() : inputRect;
            setTypeSuggestions({ rowId: row.id, items: merged, rect: { top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 460) } });
          } else if (allTypes.length <= 1) {
            setTypeSuggestions(null);
          }
        } catch {
          if (allTypes.length <= 1) setTypeSuggestions(null);
        }
      }, 600);
    }

    const detected = row.typeLocked
      ? row.type
      : (allTypes.length > 0
        ? allTypes[0].type
        : (value.trim().length > 0 ? detectFreeformRowType('', value) : row.type));
    if (!row.typeLocked && detected !== row.type) {
      setAutoDetectedRow(row.id);
      setTimeout(() => setAutoDetectedRow(null), 2500);
    }
    setRows((prev) =>
      prev.map((item) => {
        if (item.id !== row.id) return item;
        let updatedMeta = item.meta;
        if (item.meta?.name_needs_review) {
          const { name_needs_review: _removed, ...rest } = item.meta as Record<string, string | undefined>;
          void _removed;
          updatedMeta = rest as Record<string, string>;
        }
        return applyAutoCommercialTerms({ ...item, model: value, type: detected, meta: updatedMeta });
      }),
    );
  }, [apiKey, model, provider, useBackend, useBackendAi]);
  const clearTypeSuggestions = useCallback(() => {
    setTypeSuggestions(null);
  }, []);
  const handleSearchOkpd2ForRow = useCallback(async (rowId: number, query: string) => {
    if (!useBackend || !query.trim()) return;
    try {
      const results = await searchOkpd2(query.trim().slice(0, 120), 3);
      if (results.length > 0) {
        const best = results[0];
        setRows((prev) =>
          prev.map((row) =>
            row.id === rowId
              ? { ...row, meta: { ...row.meta, okpd2_code: best.code, okpd2_name: best.name } }
              : row,
          ),
        );
        showToast(`✅ ОКПД2 определён: ${best.code} — ${best.name}`, true);
      } else {
        showToast('❌ ОКПД2 не найден для указанного наименования', false);
      }
    } catch {
      showToast('❌ Ошибка при поиске ОКПД2', false);
    }
  }, [useBackend]);

  const handleRowTypeChange = useCallback((rowId: number, nextType: string) => {
    if (!nextType) return;
    setRows((prev) => prev.map((row) => (
      row.id === rowId ? applyAutoCommercialTerms({ ...row, type: nextType, typeLocked: true }) : row
    )));
  }, []);
  const handleRowLicenseTypeChange = useCallback((rowId: number, licenseType: string) => {
    setRows((prev) => prev.map((row) => (
      row.id === rowId ? { ...row, licenseType, licenseTypeAuto: false } : row
    )));
  }, []);
  const handleRowTermChange = useCallback((rowId: number, term: string) => {
    setRows((prev) => prev.map((row) => (
      row.id === rowId ? { ...row, term, termAuto: false } : row
    )));
  }, []);
  const handleRowQtyChange = useCallback((rowId: number, qty: number) => {
    setRows((prev) => prev.map((row) => (
      row.id === rowId ? { ...row, qty } : row
    )));
  }, []);
  const toggleExpandedRow = useCallback((rowId: number) => {
    setExpandedRowMetaId((current) => current === rowId ? null : rowId);
  }, []);
  const toggleEditingRow = useCallback((rowId: number) => {
    setEditingRowId((current) => current === rowId ? null : rowId);
  }, []);
  const deleteRow = useCallback((rowId: number) => {
    setRows((prev) => prev.length > 1 ? prev.filter((row) => row.id !== rowId) : prev);
    setExpandedRowMetaId((current) => current === rowId ? null : current);
    setEditingRowId((current) => current === rowId ? null : current);
    setFocusedRowId((current) => current === rowId ? null : current);
    setRowActionState((current) => current?.rowId === rowId ? null : current);
    setAutoDetectedRow((current) => current === rowId ? null : current);
    setTypeSuggestions((current) => current?.rowId === rowId ? null : current);
  }, []);
  const handleSelectTypeSuggestion = useCallback((rowId: number, nextType: string) => {
    handleRowTypeChange(rowId, nextType);
    setAutoDetectedRow(rowId);
    window.setTimeout(() => setAutoDetectedRow((current) => current === rowId ? null : current), 2500);
    setTypeSuggestions(null);
  }, [handleRowTypeChange]);
  const liveLegalSummarySourceRows = useMemo(
    () => {
      const isBlankDraft = rows.length === 1 && rows[0].status === 'idle' && !rows[0].model.trim() && !rows[0].specs?.length;
      if (isBlankDraft) return [];
      return rows;
    },
    [lawMode, rows]
  );
  const liveLegalSummaryRows = useMemo(
    () => liveLegalSummarySourceRows.map((row, idx) => buildLegalSummaryRow(row, idx, lawMode)),
    [lawMode, liveLegalSummarySourceRows]
  );
  const liveBenchmarkRows = useMemo(
    () => liveLegalSummarySourceRows
      .map((row, idx) => {
        if (!row.benchmark || !row.specs?.length) return null;
        const comparison = buildDraftSourceComparison(row.benchmark.sourceSpecs, row.specs, row.type);
        return {
          row,
          index: idx + 1,
          label: row.benchmark.sourceCompareLabel,
          comparison,
          contextPreview: trimPreviewText(row.benchmark.sourceContextText || '', 260),
          riskLevel: getBenchmarkRiskLevel(comparison),
          riskSummary: getBenchmarkRiskSummary(comparison),
        };
      })
      .filter(Boolean) as Array<{
        row: GoodsRow;
        index: number;
        label: string;
        comparison: DraftSourceComparison;
        contextPreview: string;
        riskLevel: BenchmarkRiskLevel;
        riskSummary: string;
      }>,
    [liveLegalSummarySourceRows]
  );
  const liveBenchmarkGate = useMemo(() => {
    const summary = { ok: 0, warn: 0, block: 0 };
    liveBenchmarkRows.forEach((item) => {
      summary[item.riskLevel] += 1;
    });
    return summary;
  }, [liveBenchmarkRows]);
  const liveBenchmarkPanelRows = useMemo(
    () => liveBenchmarkRows.map((item) => ({
      id: item.row.id,
      index: item.index,
      goodsName: lookupCatalog(item.row.type).name,
      model: item.row.model,
      label: item.label,
      comparison: item.comparison,
      contextPreview: item.contextPreview,
      riskLevel: item.riskLevel,
      riskSummary: item.riskSummary,
      changedPreview: buildComparisonPreviewText(item.comparison.changed, 'changed'),
      missingPreview: buildComparisonPreviewText(item.comparison.onlySource, 'missing'),
      addedPreview: buildComparisonPreviewText(item.comparison.onlyDraft, 'added'),
    })),
    [liveBenchmarkRows]
  );
  const readinessGate = useMemo(
    () => buildReadinessGateSummary(liveLegalSummarySourceRows, complianceReport, enterpriseSettings.benchmarking),
    [complianceReport, enterpriseSettings.benchmarking, liveLegalSummarySourceRows]
  );
  const canUseAiAssist = useMemo(() => useBackend || !!apiKey.trim(), [apiKey, useBackend]);
  const exportBlockingIssues = useMemo(
    () => readinessGate.blockers.filter((issue) => issue.key !== 'antifas-critical' || enterpriseSettings.antiFasStrictMode),
    [enterpriseSettings.antiFasStrictMode, readinessGate.blockers]
  );
  const benchmarkBulkActions = useMemo(() => liveBenchmarkRows.reduce((acc, item) => {
    if (item.comparison.onlySource.length > 0) acc.missingRows += 1;
    if (item.comparison.changed.length > 0) acc.changedRows += 1;
    if (item.comparison.onlySource.length > 0 || item.comparison.changed.length > 0) acc.allRows += 1;
    return acc;
  }, { missingRows: 0, changedRows: 0, allRows: 0 }), [liveBenchmarkRows]);
  const legalBulkActions = useMemo(() => liveLegalSummarySourceRows.reduce((acc, row) => {
    if (shouldApplyLegalReadinessPatch(row)) acc.safeFixRows += 1;
    return acc;
  }, { safeFixRows: 0 }), [liveLegalSummarySourceRows]);
  const serviceBulkActions = useMemo(() => liveLegalSummarySourceRows.reduce((acc, row) => {
    if (!isServiceCatalogType(row.type) || row.status !== 'done' || !row.specs?.length) return acc;
    const coverage = analyzeServiceSpecCoverage(row.specs);
    const hasCoreGap = !coverage.hasResult || !coverage.hasTiming || !coverage.hasAcceptance;
    const hasAnyGap = hasCoreGap || !coverage.hasExecution || !coverage.hasQualification;
    if (hasCoreGap) acc.coreRows += 1;
    if (hasAnyGap) acc.allRows += 1;
    return acc;
  }, { coreRows: 0, allRows: 0 }), [liveLegalSummarySourceRows]);
  const classificationBulkActions = useMemo(() => liveLegalSummarySourceRows.reduce((acc, row) => {
    if (!row.model.trim()) return acc;
    const missingOkpd2 = !getResolvedOkpd2Code(row);
    const needsReview = requiresManualClassificationReview(row);
    if (missingOkpd2) acc.missingOkpd2Rows += 1;
    if (needsReview) acc.reviewRows += 1;
    if (missingOkpd2 || needsReview) acc.allRows += 1;
    return acc;
  }, { missingOkpd2Rows: 0, reviewRows: 0, allRows: 0 }), [liveLegalSummarySourceRows]);
  const readinessAutofixActions = useMemo(() => {
    const ids = new Set<number>();
    if (enterpriseSettings.benchmarking) {
      liveBenchmarkRows.forEach((item) => {
        if (item.comparison.onlySource.length > 0 || item.comparison.changed.length > 0) ids.add(item.row.id);
      });
    }
    liveLegalSummarySourceRows.forEach((row) => {
      if (shouldApplyLegalReadinessPatch(row)) ids.add(row.id);
      if (!isServiceCatalogType(row.type) || row.status !== 'done' || !row.specs?.length) return;
      if (buildServiceAutofillEntries(row, 'all').length > 0) ids.add(row.id);
    });
    return {
      totalRows: ids.size,
      benchmarkRows: enterpriseSettings.benchmarking ? benchmarkBulkActions.allRows : 0,
      legalRows: legalBulkActions.safeFixRows,
      serviceRows: serviceBulkActions.allRows,
    };
  }, [
    benchmarkBulkActions.allRows,
    enterpriseSettings.benchmarking,
    legalBulkActions.safeFixRows,
    liveBenchmarkRows,
    liveLegalSummarySourceRows,
    serviceBulkActions.allRows,
  ]);
  const publicationAutopilotActions = useMemo(() => {
    const ids = new Set<number>();
    liveLegalSummarySourceRows.forEach((row) => {
      if (!row.model.trim()) return;
      if (!getResolvedOkpd2Code(row) || requiresManualClassificationReview(row)) ids.add(row.id);
      if (shouldApplyLegalReadinessPatch(row)) ids.add(row.id);
      if (isServiceCatalogType(row.type) && row.status === 'done' && row.specs?.length && buildServiceAutofillEntries(row, 'all').length > 0) ids.add(row.id);
      if (enterpriseSettings.benchmarking && row.benchmark && row.specs?.length) {
        const comparison = buildDraftSourceComparison(row.benchmark.sourceSpecs, row.specs, row.type);
        if (comparison.onlySource.length > 0 || comparison.changed.length > 0) ids.add(row.id);
      }
    });
    return { totalRows: ids.size };
  }, [enterpriseSettings.benchmarking, liveLegalSummarySourceRows]);
  const splitPlannerRows = useMemo(
    () => (splitSourceRows?.length ? splitSourceRows : rows).filter((row) => row.model.trim() || row.specs?.length),
    [rows, splitSourceRows],
  );
  const splitGroups = useMemo(
    () => buildProcurementSplitGroups(splitPlannerRows),
    [splitPlannerRows],
  );
  const splitFeatureVisible = splitGroups.length > 1;

  const allRowsHaveTemplate = useMemo(() => rows.every((r) => !!lookupCatalog(r.type)?.hardTemplate), [rows]);
  const allRowsSeededFromImport = useMemo(
    () => rows.every((r) => hasImportedSeedSpecs(r) || !!lookupCatalog(r.type)?.hardTemplate),
    [rows],
  );
  const canRunGenerationWithoutAi = useMemo(
    () => allRowsHaveTemplate || allRowsSeededFromImport,
    [allRowsHaveTemplate, allRowsSeededFromImport],
  );
  const isAdmin = backendUser?.role === 'admin';
  const paymentRequired = isAdmin ? false : !!backendUser?.payment_required;
  const canGenerate = useMemo(
    () => (useBackend || allRowsHaveTemplate || allRowsSeededFromImport) && rows.every((r) => r.model.trim().length > 0 || !!lookupCatalog(r.type)?.hardTemplate),
    [useBackend, allRowsHaveTemplate, allRowsSeededFromImport, rows]
  );
  const ensurePaidFeatureAccess = useCallback((message?: string) => {
    if (!paymentRequired) return true;
    showToast(message || 'Пробный период завершён. Оформите Pro Business для продолжения работы.', false);
    window.dispatchEvent(new Event('tz:open-pricing'));
    return false;
  }, [paymentRequired, showToast]);
  const shouldRunEnterpriseAutopilot = useMemo(() => {
    if (!useBackend) return false;
    if (enterpriseSettings.simulationMode) return true;
    return Boolean(
      (enterpriseSettings.etpBidirectionalStatus && enterpriseSettings.etpEndpoint) ||
      enterpriseSettings.ecmEndpoint ||
      enterpriseSettings.erpEndpoint ||
      enterpriseSettings.cryptoEndpoint
    );
  }, [
    enterpriseSettings.cryptoEndpoint,
    enterpriseSettings.ecmEndpoint,
    enterpriseSettings.erpEndpoint,
    enterpriseSettings.etpBidirectionalStatus,
    enterpriseSettings.etpEndpoint,
    enterpriseSettings.simulationMode,
    useBackend,
  ]);
  const exportsBlockedByReadiness = !!(
    enterpriseSettings.blockExportsOnFail &&
    exportBlockingIssues.length > 0
  );
  const readyRowsCount = useMemo(() => rows.filter((row) => row.status === 'done' && row.specs?.length).length, [rows]);
  const draftedRowsCount = useMemo(() => rows.filter((row) => row.model.trim().length > 0 || row.specs?.length).length, [rows]);
  const uiPhase = useMemo<'empty' | 'working' | 'ready'>(() => {
    if (docxReady) return 'ready';
    if (rows.some(r => r.model.trim() || r.specs?.length)) return 'working';
    return 'empty';
  }, [rows, docxReady]);
  const serviceRowsCount = useMemo(() => rows.filter((row) => isServiceCatalogType(row.type)).length, [rows]);
  const hasPublicationBaseline = useMemo(
    () => rows.some((row) => row.status === 'done' || !!row.specs?.length),
    [rows],
  );
  const publicationStatusLabel = draftedRowsCount === 0
    ? 'Нет позиций'
    : !hasPublicationBaseline
      ? 'Нужна генерация'
      : readinessGate.status === 'block'
        ? 'Есть блокеры'
        : readinessGate.status === 'warn'
          ? 'Нужна проверка'
          : 'Готово к публикации';
  const publicationStatusTone = draftedRowsCount === 0
    ? 'neutral'
    : !hasPublicationBaseline
      ? 'neutral'
      : readinessGate.status === 'block'
        ? 'block'
        : readinessGate.status === 'warn'
          ? 'warn'
          : 'ready';
  const publicationLeadText = liveLegalSummarySourceRows.length === 0
    ? 'Добавьте хотя бы одну позицию и опишите модель или услугу.'
    : !hasPublicationBaseline
      ? 'Файл загружен. Проверьте позиции и нажмите «Сгенерировать ТЗ». Публикационная проверка включится после появления характеристик.'
      : readinessGate.status === 'block'
        ? buildReadinessIssuePreview(readinessGate.blockers, 2)
        : readinessGate.status === 'warn'
          ? buildReadinessIssuePreview(readinessGate.warnings, 2)
          : 'Критичных замечаний нет, документ можно выгружать и сохранять.';
  const visibleReadinessBlockers = hasPublicationBaseline ? readinessGate.blockers.length : 0;
  const visibleReadinessWarnings = hasPublicationBaseline ? readinessGate.warnings.length : 0;
  const exportReadinessTitle = useMemo(() => {
    if (draftedRowsCount > 0 && !hasPublicationBaseline) {
      return 'Сначала проверьте позиции и нажмите «Сгенерировать ТЗ»';
    }
    if (exportsBlockedByReadiness) {
      return `Экспорт заблокирован: ${buildReadinessIssuePreview(exportBlockingIssues, 2)}`;
    }
    if (readinessGate.status === 'block') {
      return `В ТЗ остались блокеры перед публикацией: ${buildReadinessIssuePreview(readinessGate.blockers, 2)}`;
    }
    if (readinessGate.status === 'warn') {
      return `Перед публикацией проверьте: ${buildReadinessIssuePreview(readinessGate.warnings, 2)}`;
    }
    return 'ТЗ готово к выгрузке';
  }, [draftedRowsCount, exportBlockingIssues, exportsBlockedByReadiness, hasPublicationBaseline, readinessGate.blockers, readinessGate.status, readinessGate.warnings]);
  const previewDoneRows = useMemo(
    () => rows.filter((row) => row.status === 'done' && row.specs),
    [rows]
  );
  const previewDocSections = useMemo(
    () => previewDoneRows.length > 0
      ? buildDocumentSectionBundle(previewDoneRows, lawMode, readinessGate, enterpriseSettings.benchmarking, platformSettings)
      : null,
    [enterpriseSettings.benchmarking, lawMode, platformSettings, previewDoneRows, readinessGate]
  );
  const expandSpecsToMinimum = useCallback(async (
    row: GoodsRow,
    specs: SpecItem[],
    meta?: Record<string, string>,
  ): Promise<SpecItem[]> => {
    const resolvedCommercial = getResolvedCommercialContext(row);
    const seededSpecs = enrichSpecsByCatalogDepth(row, specs, resolvedCommercial);
    const target = getMinimumSpecCount(row, resolvedCommercial);
    const weakSpecs = getWeakSpecEntries(seededSpecs);
    if (seededSpecs.length >= target && weakSpecs.length === 0) {
      return sanitizeProcurementSpecs({
        type: row.type,
        model: row.model,
        licenseType: resolvedCommercial.suggestedLicenseType,
        term: resolvedCommercial.suggestedTerm,
      }, seededSpecs);
    }

    try {
      const g = lookupCatalog(row.type);
      const { system } = buildPrompt(row, lawMode, platformSettings);
      const missing = Math.max(1, target - seededSpecs.length);
      const hint = getDetailedSpecHint(row.type)
        .split('\n')
        .filter((line) => line.trim().startsWith('- '))
        .slice(0, 24)
        .join('\n');
      const weakSpecJson = weakSpecs.length > 0
        ? JSON.stringify(
            weakSpecs.slice(0, 20).map((spec) => ({
              group: spec.group || '',
              name: spec.name || '',
              value: spec.value || '',
              unit: spec.unit || '—',
            })),
            null,
            2,
          )
        : '[]';
      const currentJson = JSON.stringify(
        seededSpecs.map((spec) => ({
          group: spec.group || '',
          name: spec.name || '',
          value: spec.value || '',
          unit: spec.unit || '—',
        })),
        null,
        2,
      );
      const promptLaw175 = getResolvedLaw175Meta(row.type, meta || {});

      const user = `Уже есть набор технических характеристик для закупки по ${lawMode === '223' ? '223-ФЗ' : '44-ФЗ'}.

Тип товара: ${g.name}
Модель/описание: ${row.model}
Текущих характеристик: ${seededSpecs.length}
Требуемый минимум: ${target}
Нужно добавить минимум ${missing} НОВЫХ уникальных характеристик или конкретизировать существующие размытые характеристики.

Текущие характеристики:
${currentJson}

Слабые / размытые характеристики, которые нужно конкретизировать:
${weakSpecJson}

Обязательные ориентиры по классу товара:
${hint || '- Используй детальные, проверяемые эксплуатационные, функциональные и совместимые параметры именно для данного класса товара'}

ТРЕБОВАНИЯ:
- Не повторяй существующие характеристики без необходимости
- Если характеристика уже существует, но значение размытое, общее или формальное, верни ТУ ЖЕ характеристику с конкретизированным значением
- Добавь недостающие, более глубокие и проверяемые характеристики
- Используй конкретные значения и непустые units
- Сфокусируйся на реальных эксплуатационных, функциональных, совместимых, лицензионных и защитных параметрах
- Избегай формулировок "по документации производителя", "по требованиям заказчика", "при необходимости", "по типу товара"
- Не оставляй meta.law175_basis пустым: сохрани или уточни краткое юридическое обоснование меры ПП РФ № 1875 / ее неприменимости

Ответ СТРОГО в JSON без пояснений:
{
  "meta": {
    "okpd2_code": "${meta?.okpd2_code || g.okpd2}",
    "okpd2_name": "${meta?.okpd2_name || g.okpd2name}",
    "ktru_code": "${meta?.ktru_code || g.ktruFixed || ''}",
    "nac_regime": "${promptLaw175.regime}",
    "law175_status": "${promptLaw175.status}",
    "law175_basis": "${promptLaw175.promptBasis}"
  },
  "specs": [
    {"group":"Дополнительные характеристики","name":"Наименование новой характеристики","value":"конкретное значение","unit":"тип"}
  ]
}`;

      const messages = [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ];

      const raw = useBackendAi
        ? await generateWithBackend(provider, model, messages, 0.1, 4096)
        : await generateItemSpecsMessages(provider, apiKey, model, messages);

      const { specs: extraSpecs } = parseAiResponse(raw);
      const processedExtra = postProcessSpecs(extraSpecs);
      let merged = [...seededSpecs];
      for (const spec of processedExtra) {
        merged = upsertSpec(merged, spec);
      }
      return sanitizeProcurementSpecs({
        type: row.type,
        model: row.model,
        licenseType: resolvedCommercial.suggestedLicenseType,
        term: resolvedCommercial.suggestedTerm,
      }, adjustSpecsForCommercialContext(row, merged));
    } catch {
      return sanitizeProcurementSpecs({
        type: row.type,
        model: row.model,
        licenseType: resolvedCommercial.suggestedLicenseType,
        term: resolvedCommercial.suggestedTerm,
      }, seededSpecs);
    }
  }, [apiKey, lawMode, model, platformSettings, provider, useBackendAi]);

  const resolveUniversalMeta = useCallback(async (
    row: GoodsRow,
    meta: Record<string, string> = {},
    contextText = '',
  ): Promise<Record<string, string>> => {
    const normalized = normalizeResolvedMeta(row.type, meta);
    if (!isUniversalGoodsType(row.type) || isUniversalMetaComplete(normalized)) {
      return normalized;
    }
    try {
      const prompt = buildUniversalMetaPrompt(row, contextText, platformSettings);
      const raw = useBackendAi
        ? await generateWithBackend(provider, model, [{ role: 'user', content: prompt }], 0.1, 2048)
        : await generateItemSpecs(provider, apiKey, model, prompt);
      const { meta: classifiedMeta } = parseAiResponse(raw);
      return normalizeResolvedMeta(row.type, { ...normalized, ...classifiedMeta });
    } catch {
      return normalized;
    }
  }, [apiKey, model, platformSettings, provider, useBackendAi]);

  const runComplianceGate = useCallback((sourceRows: GoodsRow[]): ComplianceReport => {
    const report = buildAntiFasReport(
      sourceRows.map((row) => ({
        id: row.id,
        type: row.type,
        model: row.model,
        licenseType: getResolvedCommercialContext(row).suggestedLicenseType,
        term: getResolvedCommercialContext(row).suggestedTerm,
        status: row.status,
        specs: row.specs,
        strictMinSpecs: getMinimumSpecCount(row),
      })),
      enterpriseSettings.antiFasMinScore
    );
    setComplianceReport(report);
    appendAutomationLog({
      at: new Date().toISOString(),
      event: 'compliance.antifas.scored',
      ok: !report.blocked,
      note: `score=${report.score}; critical=${report.critical}; major=${report.major}; minor=${report.minor}`,
    });
    if (enterpriseSettings.immutableAudit) {
      appendImmutableAudit('compliance.antifas.scored', {
        score: report.score,
        blocked: report.blocked,
        critical: report.critical,
        major: report.major,
        minor: report.minor,
      });
    }
    return report;
  }, [
    enterpriseSettings.antiFasMinScore,
    enterpriseSettings.immutableAudit,
  ]);

  // ── Inline spec editing helpers ──
  const updateSpec = useCallback((rowId: number, specIdx: number, field: 'name' | 'value' | 'unit' | 'group', newVal: string) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== rowId || !r.specs) return r;
      const specs = [...r.specs];
      specs[specIdx] = { ...specs[specIdx], [field]: newVal };
      return { ...r, specs };
    }));
  }, []);

  const deleteSpec = useCallback((rowId: number, specIdx: number) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== rowId || !r.specs) return r;
      const specs = r.specs.filter((_, i) => i !== specIdx);
      return { ...r, specs };
    }));
  }, []);

  const addSpec = useCallback((rowId: number, afterIdx?: number) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== rowId) return r;
      const specs = [...(r.specs ?? [])];
      const newSpec: SpecItem = { name: '', value: '', unit: '' };
      if (afterIdx !== undefined && afterIdx < specs.length) {
        // Inherit group from previous spec
        const prevGroup = specs[afterIdx]?.group;
        if (prevGroup) newSpec.group = prevGroup;
        specs.splice(afterIdx + 1, 0, newSpec);
      } else {
        specs.push(newSpec);
      }
      return { ...r, specs };
    }));
  }, []);

  const moveSpec = useCallback((rowId: number, specIdx: number, direction: 'up' | 'down') => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== rowId || !r.specs) return r;
      const specs = [...r.specs];
      const targetIdx = direction === 'up' ? specIdx - 1 : specIdx + 1;
      if (targetIdx < 0 || targetIdx >= specs.length) return r;
      [specs[specIdx], specs[targetIdx]] = [specs[targetIdx], specs[specIdx]];
      return { ...r, specs };
    }));
  }, []);

  const finishEditing = useCallback(() => {
    setEditingRowId(null);
    runComplianceGate(rows);
  }, [rows, runComplianceGate]);

  const buildTzTextForReview = useCallback(() => {
    return rows
      .filter((r) => r.status === 'done' && r.specs && r.specs.length > 0)
      .map((r) => {
        const header = `[${r.type}] ${r.model || 'Без модели'}`;
        const specsText = (r.specs ?? [])
          .map((s) => `  ${s.name}: ${s.value}${s.unit ? ' ' + s.unit : ''}`)
          .join('\n');
        return `${header}\n${specsText}`;
      })
      .join('\n\n');
  }, [rows]);

  const handleApplyReviewFixes = useCallback((fixes: TZReviewIssue[]) => {
    let appliedCount = 0;

    // Normalize for fuzzy matching: strip trademarks, trailing dashes, collapse spaces
    const normMatch = (s: string) => s
      .replace(/[®™©]/g, '')
      .replace(/\s*[—–-]+\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    setRows((prev) => {
      const updated = prev.map((row) => {
        if (!row.specs || row.specs.length === 0) return row;
        let changed = false;

        // Collect per-spec decisions first to avoid double-counting
        const specsToRemove = new Set<number>();
        const specReplacements = new Map<number, typeof row.specs[0]>();

        row.specs.forEach((spec, specIdx) => {
          const specText = `${spec.name}: ${spec.value}${spec.unit ? ' ' + spec.unit : ''}`;
          const specNameNorm = normMatch(spec.name ?? '');

          for (const fix of fixes) {
            if (specReplacements.has(specIdx) || specsToRemove.has(specIdx)) break;

            const isDeletion = /^(удалить|убрать|исключить|delete|remove)\b/i.test(fix.suggestedText.trim());

            // ── Strategy 1: match by spec name extracted from "SpecName: ..." format ──
            const colonIdx = fix.originalText.indexOf(': ');
            if (colonIdx > 0) {
              const origSpecName = normMatch(fix.originalText.substring(0, colonIdx));
              if (origSpecName === specNameNorm) {
                if (isDeletion) {
                  specsToRemove.add(specIdx);
                } else {
                  const sugColonIdx = fix.suggestedText.indexOf(': ');
                  const sugSpecName = sugColonIdx > 0 ? normMatch(fix.suggestedText.substring(0, sugColonIdx)) : '';
                  const newValue = (sugColonIdx > 0 && sugSpecName === specNameNorm)
                    ? fix.suggestedText.substring(sugColonIdx + 2).trim()
                    : fix.suggestedText;
                  specReplacements.set(specIdx, { ...spec, value: newValue });
                }
                changed = true;
                appliedCount++;
                break;
              }
            }

            // ── Strategy 2: normalized fuzzy substring match ──
            const normOrig = normMatch(fix.originalText);
            // Strip leading non-alphanumeric (e.g. "® Core" → "core") to handle AI truncation
            const normOrigTrimmed = normOrig.replace(/^[^а-яёa-z\d]*/i, '');
            const normSpecText = normMatch(specText);
            const normSpecVal = normMatch(spec.value ?? '');

            const fuzzyMatch = normSpecText.includes(normOrig) || normSpecVal.includes(normOrig) ||
              (normOrigTrimmed.length > 5 && (normSpecText.includes(normOrigTrimmed) || normSpecVal.includes(normOrigTrimmed)));

            if (fuzzyMatch) {
              if (isDeletion) {
                specsToRemove.add(specIdx);
              } else {
                const sugColonIdx = fix.suggestedText.indexOf(': ');
                const sugSpecName = sugColonIdx > 0 ? normMatch(fix.suggestedText.substring(0, sugColonIdx)) : '';
                const newValue = (sugColonIdx > 0 && sugSpecName === specNameNorm)
                  ? fix.suggestedText.substring(sugColonIdx + 2).trim()
                  : fix.suggestedText;
                specReplacements.set(specIdx, { ...spec, value: newValue });
              }
              changed = true;
              appliedCount++;
              break;
            }
          }
        });

        if (!changed) return row;

        const newSpecs = row.specs
          .map((spec, idx) => specReplacements.has(idx) ? specReplacements.get(idx)! : spec)
          .filter((_, idx) => !specsToRemove.has(idx));

        return { ...row, specs: newSpecs };
      });
      runComplianceGate(updated);
      return updated;
    });

    if (appliedCount > 0) {
      showToast(`✅ Применено ${appliedCount} исправлений по рецензии`, true);
    } else {
      showToast('ℹ️ Совпадений не найдено в характеристиках. Нажмите «Исправить автоматически» в блоке Anti-ФАС.', false);
    }
    setShowReviewPanel(false);
  }, [runComplianceGate, showToast]);

  const applyBenchmarkPatch = useCallback((rowId: number, mode: 'missing' | 'changed' | 'all') => {
    const nextRows = rows.map((row) => (
      row.id === rowId ? applyBenchmarkPatchToRow(row, mode) : row
    ));
    setRows(nextRows);
    runComplianceGate(nextRows);
    setDocxReady(nextRows.some((row) => row.status === 'done' && !!row.specs?.length));
    const modeLabel = mode === 'missing'
      ? 'пропущенные характеристики добавлены из эталона'
      : mode === 'changed'
        ? 'значения синхронизированы с эталоном'
      : 'позиция синхронизирована с эталоном';
    showToast(`✅ ${modeLabel}`, true);
  }, [rows, runComplianceGate, showToast]);
  const applyBenchmarkPatchBulk = useCallback((mode: 'missing' | 'changed' | 'all') => {
    let changedRows = 0;
    const nextRows = rows.map((row) => {
      if (!row.benchmark || !row.specs?.length) return row;
      const comparison = buildDraftSourceComparison(row.benchmark.sourceSpecs, row.specs, row.type);
      const shouldApply = mode === 'missing'
        ? comparison.onlySource.length > 0
        : mode === 'changed'
          ? comparison.changed.length > 0
          : (comparison.onlySource.length > 0 || comparison.changed.length > 0);
      if (!shouldApply) return row;
      changedRows += 1;
      return applyBenchmarkPatchToRow(row, mode);
    });
    if (changedRows === 0) {
      showToast('ℹ️ Нет позиций для массовой синхронизации с эталоном', false);
      return;
    }
    setRows(nextRows);
    runComplianceGate(nextRows);
    setDocxReady(nextRows.some((row) => row.status === 'done' && !!row.specs?.length));
    const modeLabel = mode === 'missing'
      ? 'добавлены пропущенные характеристики по эталону'
      : mode === 'changed'
        ? 'синхронизированы изменённые значения по эталону'
        : 'позиции синхронизированы с эталоном';
    showToast(`✅ Массовое обновление: ${modeLabel} (${changedRows})`, true);
  }, [rows, runComplianceGate, showToast]);

  // ── TZ History functions ──
  const loadHistory = useCallback(async () => {
    if (!isLoggedIn()) return;
    setHistoryLoading(true);
    try {
      const [backendRes, localRes] = await Promise.allSettled([
        listTZDocuments(50, 0),
        listLocalTZDocuments(50, 0),
      ]);
      const merged = new Map<string, TZDocumentSummary>();
      if (backendRes.status === 'fulfilled' && backendRes.value.ok) {
        for (const item of backendRes.value.items) merged.set(item.id, item);
      }
      if (localRes.status === 'fulfilled' && localRes.value.ok) {
        for (const item of localRes.value.items) merged.set(item.id, item);
      }
      const items = [...merged.values()].sort((a, b) => {
        const aTime = Date.parse(a.updated_at || a.created_at || '') || 0;
        const bTime = Date.parse(b.updated_at || b.created_at || '') || 0;
        return bTime - aTime;
      });
      setHistoryItems(items);
    } catch (err) {
      console.warn('Failed to load TZ history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const saveTZ = useCallback(async () => {
    if (!ensurePaidFeatureAccess('Пробный период завершён. Оформите Pro Business, чтобы сохранять ТЗ в историю.')) {
      return;
    }
    const doneRows = rows.filter((r) => r.status === 'done');
    if (doneRows.length === 0) {
      showToast('❌ Нет готовых позиций для сохранения', false);
      return;
    }
    try {
      const saveReadiness = buildReadinessGateSummary(doneRows, complianceReport, enterpriseSettings.benchmarking);
      const publicationDossier = buildStoredPublicationDossierPayload(doneRows, enterpriseSettings.benchmarking);
      const payload = {
        law_mode: lawMode,
        rows: doneRows.map((r) => ({
          ...(() => {
            const commercial = getResolvedCommercialContext(r);
            return {
              licenseType: commercial.suggestedLicenseType,
              term: commercial.suggestedTerm,
            };
          })(),
          type: r.type,
          model: r.model,
          qty: r.qty,
          specs: r.specs ?? [],
          meta: r.meta ?? {},
          benchmark: r.benchmark ?? null,
          import_info: r.importInfo ?? null,
        })),
        compliance_score: complianceReport?.score ?? null,
        readiness: buildStoredReadinessPayload(saveReadiness),
        publication_dossier: publicationDossier,
        title: (() => {
          const objectName = getProcurementObjectName(doneRows).trim();
          return objectName ? `${objectName.charAt(0).toUpperCase()}${objectName.slice(1)}` : 'Без названия';
        })(),
      };
      try {
        const res = await saveTZDocument(payload);
        if (res.ok) {
          setCurrentDocId(res.id);
          showToast(`✅ ТЗ сохранено: ${res.title}`, true);
          void loadHistory();
          return;
        }
      } catch (remoteErr) {
        const message = remoteErr instanceof Error ? remoteErr.message : String(remoteErr || '');
        if (message.includes('Пробный период') || message.includes('подписку Pro') || message.includes('402')) {
          showToast('Пробный период завершён. Оформите Pro Business, чтобы сохранять ТЗ в историю.', false);
          window.dispatchEvent(new Event('tz:open-pricing'));
          return;
        }
        console.warn('Remote TZ save failed, falling back to local history:', remoteErr);
      }
      const localRes = await saveTZDocumentLocal(payload);
      if (localRes.ok) {
        setCurrentDocId(localRes.id);
        showToast(`✅ ТЗ сохранено локально: ${localRes.title}`, true);
        void loadHistory();
      }
    } catch (err) {
      showToast(`❌ Ошибка сохранения: ${err instanceof Error ? err.message : 'неизвестная'}`, false);
    }
  }, [complianceReport, enterpriseSettings.benchmarking, ensurePaidFeatureAccess, lawMode, loadHistory, rows, showToast]);

  const loadTZ = useCallback(async (docId: string) => {
    try {
      const res = isLocalTZDocumentId(docId)
        ? await getLocalTZDocument(docId)
        : await getTZDocument(docId).catch(async (remoteErr) => {
          console.warn('Remote TZ load failed, trying local history:', remoteErr);
          return getLocalTZDocument(docId);
        });
      if (!res.ok || !res.doc) return;
      const doc = res.doc;
      setLawMode((doc.law_mode || '44') as LawMode);
      const loadedRows: GoodsRow[] = doc.rows.map((r, idx) => ({
        id: Date.now() + idx,
        type: r.type || 'pc',
        model: r.model || '',
        licenseType: r.licenseType || '',
        term: r.term || '',
        licenseTypeAuto: false,
        termAuto: false,
        qty: r.qty || 1,
        status: (r.status && ['idle', 'loading', 'done', 'error'].includes(r.status) ? r.status : ((r.specs as SpecItem[])?.length ? 'done' : 'idle')) as GoodsRow['status'],
        error: r.error || '',
        specs: (r.specs as SpecItem[]) ?? [],
        meta: r.meta ?? {},
        benchmark: (r as { benchmark?: RowBenchmarkEvidence | null }).benchmark ?? undefined,
        importInfo: (r as { import_info?: ImportedRowImportInfo | null }).import_info ?? undefined,
      }));
      if (loadedRows.length > 0) {
        setSplitSourceRows(null);
        setActiveSplitGroupKey(null);
        setRows(loadedRows);
        setCurrentDocId(docId);
        setDocxReady(loadedRows.some((row) => row.status === 'done' && !!row.specs?.length));
        runComplianceGate(loadedRows);
        showToast(`✅ Загружено: ${doc.title}`, true);
        setHistoryOpen(false);
      }
    } catch (err) {
      showToast(`❌ Ошибка загрузки: ${err instanceof Error ? err.message : 'неизвестная'}`, false);
    }
  }, [runComplianceGate]);

  const deleteTZ = useCallback(async (docId: string) => {
    try {
      if (isLocalTZDocumentId(docId)) {
        await deleteLocalTZDocument(docId);
      } else {
        try {
          await deleteTZDocument(docId);
        } catch (remoteErr) {
          console.warn('Remote TZ delete failed, trying local history:', remoteErr);
          await deleteLocalTZDocument(docId);
        }
      }
      setHistoryItems((prev) => prev.filter((d) => d.id !== docId));
      if (currentDocId === docId) setCurrentDocId(null);
      showToast('✅ ТЗ удалено', true);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : 'Ошибка'}`, false);
    }
  }, [currentDocId]);

  const buildPayload = useCallback((sourceRows: GoodsRow[], sourceComplianceReport: ComplianceReport | null = complianceReport) => {
    const payloadReadiness = buildReadinessGateSummary(sourceRows, sourceComplianceReport, enterpriseSettings.benchmarking);
    const publicationDossier = buildStoredPublicationDossierPayload(sourceRows, enterpriseSettings.benchmarking);
    return {
      law: lawMode === '223' ? '223-FZ' : '44-FZ',
      profile: platformSettings.profile,
      procurementMethod: platformSettings.procurementMethod,
      procurementMethodLabel: PROCUREMENT_METHOD_LABELS[platformSettings.procurementMethod] || platformSettings.procurementMethod,
      organization: platformSettings.orgName,
      customerInn: platformSettings.customerInn,
      organizationProfile: platformSettings.industryPreset,
      organizationProfileLabel: getOrganizationPresetMeta(platformSettings.industryPreset).label,
      organizationInstructions: platformSettings.organizationInstructions,
      defaultWarrantyMonths: platformSettings.defaultWarrantyMonths || null,
      readiness: buildStoredReadinessPayload(payloadReadiness),
      publicationDossier,
      items: sourceRows.map((r) => ({
        ...(() => {
          const commercial = getResolvedCommercialContext(r);
          return {
            licenseType: commercial.suggestedLicenseType,
            term: commercial.suggestedTerm,
          };
        })(),
        type: r.type,
        model: NON_BRAND_LABEL,
        qty: r.qty,
        status: r.status,
        okpd2: getResolvedOkpd2Code(r),
        ktru: getResolvedKtruCode(r),
        nacRegime: r.meta?.nac_regime || getUnifiedNacRegime(r.type),
        law175Status: getLaw175MeasureLabel(r.meta?.law175_status || '', r.meta?.nac_regime || getUnifiedNacRegime(r.type)),
        law175Basis: r.meta?.law175_basis || '',
        classificationSource: getClassificationSourceLabel(r.meta, r.type),
        importSource: r.importInfo?.sourceKind || '',
        importConfidence: r.importInfo ? Math.round((r.importInfo.confidence || 0) * 100) : null,
        importNeedsReview: !!r.importInfo?.needsReview,
        benchmarkSource: r.benchmark?.sourceCompareLabel || '',
        benchmarkMatched: r.benchmark && r.specs ? buildDraftSourceComparison(r.benchmark.sourceSpecs, r.specs, r.type).matched.length : 0,
        benchmarkChanged: r.benchmark && r.specs ? buildDraftSourceComparison(r.benchmark.sourceSpecs, r.specs, r.type).changed.length : 0,
        benchmarkMissing: r.benchmark && r.specs ? buildDraftSourceComparison(r.benchmark.sourceSpecs, r.specs, r.type).onlySource.length : 0,
      })),
    };
  }, [
    complianceReport,
    enterpriseSettings.benchmarking,
    lawMode,
    platformSettings.profile,
    platformSettings.procurementMethod,
    platformSettings.orgName,
    platformSettings.customerInn,
    platformSettings.industryPreset,
    platformSettings.organizationInstructions,
    platformSettings.defaultWarrantyMonths,
  ]);

  const exportPackage = useCallback((sourceRows: GoodsRow[] = rows, sourceComplianceReport: ComplianceReport | null = complianceReport): boolean => {
    if (!ensurePaidFeatureAccess('Пробный период завершён. Оформите Pro Business для экспорта пакета ТЗ.')) {
      return false;
    }
    const exportReadiness = buildReadinessGateSummary(sourceRows, sourceComplianceReport, enterpriseSettings.benchmarking);
    const publicationDossier = buildStoredPublicationDossierPayload(sourceRows, enterpriseSettings.benchmarking);
    const exportBlockers = exportReadiness.blockers.filter((issue) => issue.key !== 'antifas-critical' || enterpriseSettings.antiFasStrictMode);
    if (enterpriseSettings.blockExportsOnFail && exportBlockers.length > 0) {
      const preview = buildReadinessIssuePreview(exportBlockers);
      showToast(`❌ Экспорт JSON заблокирован: ${preview}`, false);
      appendAutomationLog({
        at: new Date().toISOString(),
        event: 'compliance.readiness.blocked_export_json',
        ok: false,
        note: preview,
      });
      if (enterpriseSettings.immutableAudit) {
        appendImmutableAudit('compliance.readiness.blocked_export_json', {
          blockers: exportBlockers.map((issue) => issue.text),
          format: 'json',
        });
      }
      return false;
    }
    if (exportReadiness.status !== 'ready') {
      showToast(`⚠️ Перед публикацией проверьте: ${buildReadinessIssuePreview(exportReadiness.status === 'block' ? exportReadiness.blockers : exportReadiness.warnings)}`, false);
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      law: lawMode === '223' ? '223-FZ' : '44-FZ',
      profile: platformSettings.profile,
      procurementMethod: platformSettings.procurementMethod,
      procurementMethodLabel: PROCUREMENT_METHOD_LABELS[platformSettings.procurementMethod] || platformSettings.procurementMethod,
      organization: platformSettings.orgName,
      customerInn: platformSettings.customerInn,
      organizationProfile: platformSettings.industryPreset,
      organizationProfileLabel: getOrganizationPresetMeta(platformSettings.industryPreset).label,
      organizationInstructions: platformSettings.organizationInstructions,
      defaultWarrantyMonths: platformSettings.defaultWarrantyMonths || null,
      readiness: buildStoredReadinessPayload(exportReadiness),
      publicationDossier,
      items: sourceRows.map((r) => ({
        ...(() => {
          const commercial = getResolvedCommercialContext(r);
          return {
            licenseType: commercial.suggestedLicenseType,
            term: commercial.suggestedTerm,
          };
        })(),
        type: r.type,
        model: NON_BRAND_LABEL,
        qty: r.qty,
        okpd2: getResolvedOkpd2Code(r),
        ktru: getResolvedKtruCode(r),
        nacRegime: r.meta?.nac_regime || getUnifiedNacRegime(r.type),
        law175Status: getLaw175MeasureLabel(r.meta?.law175_status || '', r.meta?.nac_regime || getUnifiedNacRegime(r.type)),
        law175Basis: r.meta?.law175_basis || '',
        classificationSource: getClassificationSourceLabel(r.meta, r.type),
        importSource: r.importInfo?.sourceKind || '',
        importConfidence: r.importInfo ? Math.round((r.importInfo.confidence || 0) * 100) : null,
        importNeedsReview: !!r.importInfo?.needsReview,
        benchmarkSource: r.benchmark?.sourceCompareLabel || '',
        benchmarkMatched: r.benchmark && r.specs ? buildDraftSourceComparison(r.benchmark.sourceSpecs, r.specs, r.type).matched.length : 0,
        benchmarkChanged: r.benchmark && r.specs ? buildDraftSourceComparison(r.benchmark.sourceSpecs, r.specs, r.type).changed.length : 0,
        benchmarkMissing: r.benchmark && r.specs ? buildDraftSourceComparison(r.benchmark.sourceSpecs, r.specs, r.type).onlySource.length : 0,
        specsCount: r.specs?.length ?? 0,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `procurement_pack_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  }, [
    complianceReport,
    ensurePaidFeatureAccess,
    enterpriseSettings.antiFasStrictMode,
    enterpriseSettings.benchmarking,
    enterpriseSettings.blockExportsOnFail,
    enterpriseSettings.immutableAudit,
    lawMode,
    platformSettings.profile,
    platformSettings.procurementMethod,
    platformSettings.orgName,
    platformSettings.customerInn,
    platformSettings.industryPreset,
    platformSettings.organizationInstructions,
    platformSettings.defaultWarrantyMonths,
    rows,
    showToast,
  ]);

  const fetchInternetCandidateForRow = useCallback(async (row: GoodsRow): Promise<SpecsCandidate | null> => {
    if (!row.model.trim()) return null;
    const g = lookupCatalog(row.type);
    const isUniversal = isUniversalGoodsType(row.type);
    const specificModelRequested = looksLikeSpecificModelQuery(row.model);
    let universalContext = '';
    let exactModelContext = '';
    let sourceSpecs: SpecItem[] = [];

    const deterministicSpecs = getAstraDeterministicSpecs(row);
    if (!specificModelRequested && deterministicSpecs && deterministicSpecs.length > 0) {
      const baseMeta = normalizeResolvedMeta(row.type, {
        okpd2_code: g.okpd2,
        okpd2_name: g.okpd2name,
        ktru_code: g.ktruFixed ?? '',
      });
      const enrichedSpecs = await expandSpecsToMinimum(row, adjustSpecsForCommercialContext(row, deterministicSpecs), baseMeta);
      return {
        source: 'internet',
        specs: enrichedSpecs,
        meta: baseMeta,
      };
    }

    if (useBackend) {
      try {
        const backendSpecs = await searchInternetSpecs(row.model.trim(), row.type);
        if (backendSpecs.length > 0) {
          exactModelContext = buildSearchSpecsContext(backendSpecs);
          sourceSpecs = normalizeSourceSpecCollection(
            backendSpecs.map((s) => ({ name: s.name, value: s.value, unit: s.unit })),
            row.type,
          );
          if (!isUniversal) {
            const mappedSpecs = adjustSpecsForCommercialContext(
              row,
              backendSpecs.map((s) => ({ name: s.name, value: s.value, unit: s.unit, group: '' })),
            );
            const preparedSpecs = sanitizeProcurementSpecs({
              type: row.type,
              model: row.model,
              licenseType: getResolvedCommercialContext(row).suggestedLicenseType,
              term: getResolvedCommercialContext(row).suggestedTerm,
            }, mappedSpecs);
            const finalSpecs = specificModelRequested
              ? preparedSpecs
              : await expandSpecsToMinimum(row, mappedSpecs, {
                okpd2_code: g.okpd2,
                okpd2_name: g.okpd2name,
                ktru_code: g.ktruFixed ?? '',
              });
            if (specificModelRequested && !isUniversalGoodsType(row.type) && !hasSufficientExactModelCoverage(finalSpecs)) {
              console.warn('[internet] backend search returned weak exact-model result, continuing with AI fallback');
            } else {
            return {
              source: 'internet',
              specs: finalSpecs,
              meta: normalizeResolvedMeta(row.type, {
                okpd2_code: g.okpd2,
                okpd2_name: g.okpd2name,
                ktru_code: g.ktruFixed ?? '',
              }),
              sourceSpecs,
              sourceCompareLabel: 'Интернет-источники',
              sourceContextText: buildSearchSpecsContext(backendSpecs),
            };
            }
          }
          universalContext = buildSearchSpecsContext(backendSpecs);
        }
      } catch (error) {
        console.warn('[internet] backend search failed, continuing with AI fallback:', error);
      }
    }

    const prompt = isUniversal && universalContext
      ? buildUniversalSearchPrompt(row, 'интернет-поиск', universalContext, platformSettings)
      : (specificModelRequested && exactModelContext
        ? `${buildSpecSearchPrompt(row, g, platformSettings)}\n\nНайденный контекст по модели:\n${exactModelContext}\n\nИспользуй только подтвержденные характеристики именно этой модели. Не подставляй типовые параметры класса товара.`
        : buildSpecSearchPrompt(row, g, platformSettings));
    let raw: string;
    if (useBackendAi) {
      raw = await generateWithBackend(provider, model, [{ role: 'user', content: prompt }], 0.1, 4096);
    } else {
      raw = await generateItemSpecs(provider, apiKey, model, prompt);
    }
    const { meta, specs } = parseAiResponse(raw);
    const processed = adjustSpecsForCommercialContext(row, postProcessSpecs(specs));
    const enriched = specificModelRequested
      ? sanitizeProcurementSpecs({
        type: row.type,
        model: row.model,
        licenseType: getResolvedCommercialContext(row).suggestedLicenseType,
        term: getResolvedCommercialContext(row).suggestedTerm,
      }, processed)
      : await expandSpecsToMinimum(row, processed, meta);
    const resolvedMeta = await resolveUniversalMeta(row, meta, universalContext);
    // Reject candidate if most spec values are placeholders (but allow for universal/generic goods)
    if (!isUniversal && !hasRealSpecValues(enriched)) {
      console.warn('[autopilot] Internet AI candidate rejected: mostly placeholder values');
      return null;
    }
    if (specificModelRequested && !isUniversalGoodsType(row.type) && !hasSufficientExactModelCoverage(enriched)) {
      console.warn('[autopilot] Internet AI candidate rejected: exact model still has weak/generic values');
      return null;
    }
    return {
      source: 'internet',
      specs: enriched,
      meta: resolvedMeta,
      sourceSpecs,
      sourceCompareLabel: 'Интернет-источники',
      sourceContextText: universalContext,
    };
  }, [useBackend, useBackendAi, provider, model, apiKey, expandSpecsToMinimum, platformSettings, resolveUniversalMeta]);

  const fetchEisCandidateForRow = useCallback(async (row: GoodsRow): Promise<SpecsCandidate | null> => {
    if (!row.model.trim()) return null;
    const g = lookupCatalog(row.type);
    const isUniversal = isUniversalGoodsType(row.type);
    const specificModelRequested = looksLikeSpecificModelQuery(row.model);
    let universalContext = '';
    let exactModelContext = '';
    let sourceSpecs: SpecItem[] = [];

    const deterministicSpecs = getAstraDeterministicSpecs(row);
    if (!specificModelRequested && deterministicSpecs && deterministicSpecs.length > 0) {
      const baseMeta = normalizeResolvedMeta(row.type, {
        okpd2_code: g.okpd2,
        okpd2_name: g.okpd2name,
        ktru_code: g.ktruFixed ?? '',
      });
      const enrichedSpecs = await expandSpecsToMinimum(row, adjustSpecsForCommercialContext(row, deterministicSpecs), baseMeta);
      return {
        source: 'eis',
        specs: enrichedSpecs,
        meta: baseMeta,
      };
    }

    if (useBackend) {
      try {
        const eisSpecs = await searchEisSpecs(row.model.trim(), row.type);
        if (eisSpecs.length > 0) {
          exactModelContext = buildSearchSpecsContext(eisSpecs);
          sourceSpecs = normalizeSourceSpecCollection(
            eisSpecs.map((s) => ({ name: s.name, value: s.value, unit: s.unit })),
            row.type,
          );
          if (!isUniversal) {
            const mappedSpecs = adjustSpecsForCommercialContext(
              row,
              eisSpecs.map((s) => ({ name: s.name, value: s.value, unit: s.unit, group: '' })),
            );
            const preparedSpecs = sanitizeProcurementSpecs({
              type: row.type,
              model: row.model,
              licenseType: getResolvedCommercialContext(row).suggestedLicenseType,
              term: getResolvedCommercialContext(row).suggestedTerm,
            }, mappedSpecs);
            const finalSpecs = specificModelRequested
              ? preparedSpecs
              : await expandSpecsToMinimum(row, mappedSpecs, {
                okpd2_code: g.okpd2,
                okpd2_name: g.okpd2name,
                ktru_code: g.ktruFixed ?? '',
              });
            if (specificModelRequested && !isUniversalGoodsType(row.type) && !hasSufficientExactModelCoverage(finalSpecs)) {
              console.warn('[eis] backend search returned weak exact-model result, continuing with AI fallback');
            } else {
            return {
              source: 'eis',
              specs: finalSpecs,
              meta: normalizeResolvedMeta(row.type, {
                okpd2_code: g.okpd2,
                okpd2_name: g.okpd2name,
                ktru_code: g.ktruFixed ?? '',
              }),
              sourceSpecs,
              sourceCompareLabel: 'ЕИС / КТРУ / площадки',
              sourceContextText: buildSearchSpecsContext(eisSpecs),
            };
            }
          }
          universalContext = buildSearchSpecsContext(eisSpecs);
        }
      } catch (error) {
        console.warn('[eis] backend search failed, continuing with AI fallback:', error);
      }
    }

    let eisContext = '';
    try {
      const controller = new AbortController();
      const tid = window.setTimeout(() => controller.abort(), 20000);
      try {
        eisContext = await fetchEisContext(g, row.model.trim(), controller.signal);
      } finally {
        clearTimeout(tid);
      }
    } catch {
      // proxy недоступен
    }
    const prompt = isUniversal && universalContext
      ? buildUniversalSearchPrompt(row, 'ЕИС / закупочные площадки / Минпромторг', `${universalContext}${eisContext ? `\n\n${eisContext}` : ''}`, platformSettings)
      : (specificModelRequested && exactModelContext
        ? `${buildEisStylePrompt(row, g, eisContext, platformSettings)}\n\nНайденный контекст по модели:\n${exactModelContext}\n\nИспользуй только подтвержденные характеристики именно этой модели. Не подставляй типовые параметры класса товара.`
        : buildEisStylePrompt(row, g, eisContext, platformSettings));
    let raw: string;
    if (useBackendAi) {
      raw = await generateWithBackend(provider, model, [{ role: 'user', content: prompt }], 0.1, 4096);
    } else {
      raw = await generateItemSpecs(provider, apiKey, model, prompt);
    }
    const { meta, specs } = parseAiResponse(raw);
    const processed = adjustSpecsForCommercialContext(row, postProcessSpecs(specs));
    const enriched = specificModelRequested
      ? sanitizeProcurementSpecs({
        type: row.type,
        model: row.model,
        licenseType: getResolvedCommercialContext(row).suggestedLicenseType,
        term: getResolvedCommercialContext(row).suggestedTerm,
      }, processed)
      : await expandSpecsToMinimum(row, processed, meta);
    const resolvedMeta = await resolveUniversalMeta(row, meta, `${universalContext}${eisContext ? `\n\n${eisContext}` : ''}`);
    // Reject candidate if most spec values are placeholders (but allow for universal/generic goods)
    if (!isUniversal && !hasRealSpecValues(enriched)) {
      console.warn('[autopilot] EIS AI candidate rejected: mostly placeholder values');
      return null;
    }
    if (specificModelRequested && !isUniversalGoodsType(row.type) && !hasSufficientExactModelCoverage(enriched)) {
      console.warn('[autopilot] EIS AI candidate rejected: exact model still has weak/generic values');
      return null;
    }
    return {
      source: 'eis',
      specs: enriched,
      meta: resolvedMeta,
      sourceSpecs,
      sourceCompareLabel: 'ЕИС / КТРУ / площадки',
      sourceContextText: `${universalContext}${eisContext ? `${universalContext ? '\n\n' : ''}${eisContext}` : ''}`.trim(),
    };
  }, [useBackend, useBackendAi, provider, model, apiKey, expandSpecsToMinimum, platformSettings, resolveUniversalMeta]);

  const getMinimumSearchSpecs = useCallback((row: GoodsRow): number => {
    const catalogItem = lookupCatalog(row.type);
    if (looksLikeSpecificModelQuery(row.model)) {
      return catalogItem?.isSoftware ? 10 : 8;
    }
    if (isUniversalServiceType(row.type) || isServiceCatalogType(row.type)) {
      return catalogItem?.isSoftware ? 12 : 10;
    }
    const isUniversal = isUniversalGoodsType(row.type);
    if (isUniversal) {
      return catalogItem?.isSoftware ? 18 : 14;
    }
    return catalogItem?.isSoftware ? 14 : 10;
  }, []);

  const pickBestCandidate = useCallback((
    row: GoodsRow,
    internetCandidate: SpecsCandidate | null,
    eisCandidate: SpecsCandidate | null,
    autoPickTopCandidate: boolean,
  ): SpecsCandidate | null => {
    if (!internetCandidate && !eisCandidate) return null;
    const minQualitySpecs = getMinimumSearchSpecs(row);
    const specificModelRequested = looksLikeSpecificModelQuery(row.model);
    const isAcceptable = (candidate: SpecsCandidate | null) => {
      if (!candidate) return false;
      if (candidate.specs.length < minQualitySpecs) return false;
      if (!specificModelRequested || isUniversalGoodsType(row.type)) return true;
      return hasSufficientExactModelCoverage(candidate.specs);
    };
    if (!autoPickTopCandidate) {
      if (isAcceptable(eisCandidate)) return eisCandidate;
      if (isAcceptable(internetCandidate)) return internetCandidate;
      const c = eisCandidate ?? internetCandidate;
      if (c && c.specs.length < minQualitySpecs) {
        console.warn(`[Quality] Поисковый результат содержит ${c.specs.length} хар-к (мин. ${minQualitySpecs}), переход к ИИ-генерации.`);
        return null;
      }
      return c;
    }
    if (isAcceptable(eisCandidate)) {
      return eisCandidate;
    }
    let best: SpecsCandidate | null = internetCandidate ?? eisCandidate;
    if (best && best.specs.length < minQualitySpecs) {
      console.warn(`[Quality] Лучший поисковый результат: ${best.specs.length} хар-к (мин. ${minQualitySpecs}), переход к ИИ-генерации.`);
      return null;
    }
    return best;
  }, [getMinimumSearchSpecs]);

  const mutation = useMutation({
    mutationFn: async (options?: GenerateOptions) => {
      if (!ensurePaidFeatureAccess('Пробный период завершён. Оформите Pro Business для генерации ТЗ.')) {
        return;
      }
      const autopilotEnabled = !!options?.forceAutopilot;
      const targetRowId = options?.rowId ?? null;
      const targetRows = targetRowId ? rows.filter((row) => row.id === targetRowId) : rows;
      if (targetRows.length === 0) {
        showToast('❌ Строка для генерации не найдена', false);
        return;
      }
      if (!targetRows.every((r) => r.model.trim().length > 0 || !!lookupCatalog(r.type)?.hardTemplate)) {
        showToast('❌ Заполните поле «Модель / описание» для всех строк', false);
        return;
      }
      // Allow generation if all rows have hardTemplate (no API key needed)
      const allHaveTemplate = targetRows.every((r) => !!lookupCatalog(r.type)?.hardTemplate);
      if (!useBackend && !hasUserApiKey && !allHaveTemplate) {
        const allRowsCanUseSeedSpecs = targetRows.every((r) => hasImportedSeedSpecs(r) || !!lookupCatalog(r.type)?.hardTemplate);
        if (!allRowsCanUseSeedSpecs) {
          showToast('❌ Нужен вход в аккаунт или API-ключ', false);
          return;
        }
      }

      const next = [...rows];
      const sourceStats = { template: 0, imported: 0, internet: 0, eis: 0, ai: 0, error: 0 };
      const targetIndices = targetRowId
        ? next.map((row, index) => row.id === targetRowId ? index : -1).filter((index) => index >= 0)
        : next.map((row, index) => (row.status === 'done' && row.specs && row.specs.length > 0) ? -1 : index).filter((index) => index >= 0);

      // ── Авто-определение ОКПД2 для строк без кода ───────────────────────────
      if (useBackend) {
        const rowsNeedingOkpd2 = targetIndices.filter((idx) => {
          const row = next[idx];
          const catalogOkpd2 = lookupCatalog(row.type)?.okpd2;
          const metaOkpd2 = row.meta?.okpd2_code;
          const hasCode = !!(metaOkpd2 && metaOkpd2 !== 'XX.XX.XX.XXX') || !!(catalogOkpd2);
          return !hasCode && !!(row.model.trim() || row.type);
        });
        if (rowsNeedingOkpd2.length > 0) {
          const okpd2Results = await Promise.allSettled(
            rowsNeedingOkpd2.map((idx) => {
              const row = next[idx];
              const query = (row.model.trim() || row.type).slice(0, 120);
              return searchOkpd2(query, 3);
            }),
          );
          rowsNeedingOkpd2.forEach((idx, i) => {
            const result = okpd2Results[i];
            if (result.status === 'fulfilled' && result.value.length > 0) {
              const best = result.value[0];
              next[idx] = {
                ...next[idx],
                meta: {
                  ...next[idx].meta,
                  okpd2_code: best.code,
                  okpd2_name: best.name,
                },
              };
            }
          });
        }
      }

      const totalRowsToProcess = targetIndices.length;
      const hasUniversalRows = targetIndices.some((index) => isUniversalGoodsType(next[index].type));
      const batchSize = totalRowsToProcess >= 240
        ? 24
        : totalRowsToProcess >= 160
          ? 20
          : totalRowsToProcess >= 100
            ? 16
            : totalRowsToProcess >= 60
              ? 12
              : totalRowsToProcess >= 30
                ? 8
                : Math.max(1, totalRowsToProcess);
      const totalBatches = Math.max(1, Math.ceil(totalRowsToProcess / batchSize));

      if (autopilotEnabled || hasUniversalRows) {
        setInternetSearching(true);
        setEisSearching(true);
      }
      setGenerationProgress({
        current: 0,
        total: totalRowsToProcess,
        batchSize,
        batchIndex: totalRowsToProcess > 0 ? 1 : 0,
        totalBatches,
      });
      setDocxReady(false);
      let nextTaskIdx = 0;
      let completedCount = 0;
      let shouldStop = false;
      const CONCURRENCY_LIMIT = Math.min(3, totalRowsToProcess);

      const BATCH_SIZE_ROWS = 5;

      const runWorker = async (workerIndex: number): Promise<void> => {
        // Небольшой сдвиг чтобы не бить одновременным залпом по DeepSeek
        if (workerIndex > 0) await new Promise(r => setTimeout(r, workerIndex * 1500));

        while (!shouldStop) {
          // ── Попытка пакетной обработки (batch) ──────────────────────────────
          const batchStart = nextTaskIdx; // peek без инкремента
          const batchAbleIs: number[] = [];
          for (let k = 0; k < BATCH_SIZE_ROWS && (batchStart + k) < targetIndices.length; k++) {
            const ri = targetIndices[batchStart + k];
            if (!canBatchRow(next[ri])) break;
            batchAbleIs.push(ri);
          }
          if (batchAbleIs.length >= 2) {
            nextTaskIdx += batchAbleIs.length; // атомарно занимаем
            for (const ri of batchAbleIs) {
              next[ri] = { ...next[ri], status: 'loading', error: '' };
            }
            setRows([...next]);
            // Хелпер: индивидуальная генерация одной строки (фолбэк из батча)
            const generateSingleRowFallback = async (ri: number): Promise<void> => {
              const currentRow = next[ri];
              try {
                const { system: sysMsg, user: userMsg } = buildPrompt(currentRow, lawMode, platformSettings);
                const msgs = [{ role: 'system', content: sysMsg }, { role: 'user', content: userMsg }];
                const raw = await generateWithBackend(provider, model, msgs, 0.1, 2048);
                const { meta, specs } = parseAiResponse(raw);
                const processed = postProcessSpecs(specs);
                const validatedMeta = await resolveUniversalMeta(currentRow, meta);
                const adjustedSpecs = adjustSpecsForCommercialContext(currentRow, processed);
                const enrichedSpecs = await expandSpecsToMinimum(currentRow, adjustedSpecs, validatedMeta);
                if (enrichedSpecs.length > 0 && hasRealSpecValues(enrichedSpecs)) {
                  next[ri] = { ...currentRow, status: 'done', specs: enrichedSpecs, meta: normalizeResolvedMeta(currentRow.type, { ...validatedMeta, classification_source: 'ai' }), benchmark: undefined };
                  sourceStats.ai += 1;
                } else {
                  next[ri] = { ...currentRow, status: 'error', error: 'характеристики не найдены' };
                  sourceStats.error += 1;
                }
              } catch (fbErr) {
                const msg = normalizeRowFailureMessage(currentRow, fbErr instanceof Error ? fbErr.message : 'generation_error', 'ai');
                next[ri] = { ...currentRow, status: 'error', error: msg };
                sourceStats.error += 1;
              }
              completedCount++;
            };

            try {
              const batchRows = batchAbleIs.map(ri => next[ri]);
              const batchPrompt = buildBatchPrompt(batchRows, lawMode);
              const batchRaw = await generateWithBackend(provider, model, [{ role: 'user', content: batchPrompt }], 0.1, 2048);
              const batchResult = parseBatchResponse(batchRaw);
              // Параллельно обрабатываем каждую строку из батча
              await Promise.allSettled(batchAbleIs.map(async (ri, j) => {
                const currentRow = next[ri];
                const g = lookupCatalog(currentRow.type);
                const item = batchResult.items.find(x => x.idx === j);
                if (item && item.specs && item.specs.length > 0) {
                  const processed = postProcessSpecs(item.specs);
                  const adjustedSpecs = adjustSpecsForCommercialContext(currentRow, processed);
                  const meta = normalizeResolvedMeta(currentRow.type, {
                    okpd2_code: getResolvedOkpd2Code(currentRow) || g.okpd2,
                    okpd2_name: getResolvedOkpd2Name(currentRow) || g.okpd2name,
                    ktru_code: getResolvedKtruCode(currentRow) || g.ktruFixed || '',
                    classification_source: 'ai',
                  });
                  const enrichedSpecs = await expandSpecsToMinimum(currentRow, adjustedSpecs, meta);
                  if (enrichedSpecs.length > 0 && hasRealSpecValues(enrichedSpecs)) {
                    next[ri] = { ...currentRow, status: 'done', specs: enrichedSpecs, meta, benchmark: undefined };
                    sourceStats.ai += 1;
                    completedCount++;
                  } else {
                    // Пакет дал плохие спеки — ретрай индивидуально
                    await generateSingleRowFallback(ri);
                  }
                } else {
                  // Строка отсутствует в ответе пакета — ретрай индивидуально
                  await generateSingleRowFallback(ri);
                }
              }));
            } catch (batchErr) {
              // Весь пакет упал — ретрай всех строк индивидуально
              await Promise.allSettled(batchAbleIs.map(ri => generateSingleRowFallback(ri)));
            }
            setRows([...next]);
            setGenerationProgress({
              current: completedCount,
              total: totalRowsToProcess,
              batchSize,
              batchIndex: Math.floor(completedCount / batchSize) + 1,
              totalBatches,
            });
            continue; // следующая итерация while
          }
          // ── Конец batch; далее — единичная обработка ─────────────────────────

          const processedIndex = nextTaskIdx++;
          if (processedIndex >= targetIndices.length) break;

          await (async () => {
            const i = targetIndices[processedIndex];
            next[i] = { ...next[i], status: 'loading', error: '' };
            setRows([...next]);

            const currentRow = next[i];
            const g = lookupCatalog(currentRow.type);

            const finishRow = () => {
              completedCount++;
              setRows([...next]);
              setGenerationProgress({
                current: completedCount,
                total: totalRowsToProcess,
                batchSize,
                batchIndex: Math.floor(completedCount / batchSize) + 1,
                totalBatches,
              });
            };

            if (hasImportedSeedSpecs(currentRow)) {
              const baseMeta = normalizeResolvedMeta(currentRow.type, {
                okpd2_code: currentRow.meta?.okpd2_code || g.okpd2,
                okpd2_name: currentRow.meta?.okpd2_name || g.okpd2name,
                ktru_code: currentRow.meta?.ktru_code || g.ktruFixed || '',
                ...(currentRow.meta || {}),
                classification_source: currentRow.meta?.classification_source || (currentRow.importInfo?.sourceFormat === 'docx' ? 'docx_import' : 'import'),
              });
              const resolvedMeta = await resolveUniversalMeta(currentRow, baseMeta, getImportedSourceContext(currentRow));
              const enrichedSpecs = await expandSpecsToMinimum(
                currentRow,
                adjustSpecsForCommercialContext(currentRow, getImportedSpecs(currentRow)),
                resolvedMeta,
              );
              next[i] = {
                ...currentRow,
                status: 'done',
                specs: enrichedSpecs,
                meta: normalizeResolvedMeta(currentRow.type, {
                  ...resolvedMeta,
                  classification_source: currentRow.meta?.classification_source || (currentRow.importInfo?.sourceFormat === 'docx' ? 'docx_import' : 'import'),
                }),
                benchmark: undefined,
              };
              sourceStats.imported += 1;
              finishRow();
              return;
            }

            const specificModelRequested = looksLikeSpecificModelQuery(currentRow.model);
            const catalogTemplateFallback = buildCatalogTemplateFallback(currentRow);

            const deterministicSpecs = getAstraDeterministicSpecs(currentRow);
            if (!specificModelRequested && deterministicSpecs && deterministicSpecs.length > 0) {
              const meta = normalizeResolvedMeta(currentRow.type, {
                okpd2_code: g.okpd2,
                okpd2_name: g.okpd2name,
                ktru_code: g.ktruFixed ?? '',
                classification_source: 'catalog',
              });
              const enrichedSpecs = await expandSpecsToMinimum(currentRow, adjustSpecsForCommercialContext(currentRow, deterministicSpecs), meta);
              next[i] = { ...currentRow, status: 'done', specs: enrichedSpecs, meta, benchmark: undefined };
              sourceStats.template += 1;
              finishRow();
              return;
            }

            // Если для типа товара есть жёсткий шаблон — пропускаем AI
            if (!specificModelRequested && g.hardTemplate && g.hardTemplate.length > 0) {
              const specs = (g.hardTemplate as HardSpec[]).map((s) => ({ group: s.group, name: s.name, value: s.value, unit: s.unit ?? '' }));
              const meta: Record<string, string> = {
                okpd2_code: g.okpd2,
                okpd2_name: g.okpd2name,
                ktru_code: g.ktruFixed ?? '',
                nac_regime: 'pp616',
                classification_source: 'catalog',
              };
              const enrichedSpecs = await expandSpecsToMinimum(currentRow, adjustSpecsForCommercialContext(currentRow, specs), meta);
              next[i] = { ...currentRow, status: 'done', specs: enrichedSpecs, meta, benchmark: undefined };
              sourceStats.template += 1;
              finishRow();
              return;
            }

            try {
              // DOCX-строки уже имеют контекст из документа — интернет-поиск пропускаем,
              // AI сгенерирует спеки по названию товара напрямую (экономим 20-35с на строку)
              const hasDocxSourceContext = Boolean(currentRow.importInfo?.sourceContextText?.trim());
              const shouldSearchBeforeGenerate =
                !hasDocxSourceContext && (
                  autopilotEnabled
                  || isUniversalGoodsType(currentRow.type)
                  || specificModelRequested
                );
              if (shouldSearchBeforeGenerate) {
                const [internetResult, eisResult] = await Promise.allSettled([
                  fetchInternetCandidateForRow(currentRow),
                  fetchEisCandidateForRow(currentRow),
                ]);
                const internetCandidate = internetResult.status === 'fulfilled' ? internetResult.value : null;
                const eisCandidate = eisResult.status === 'fulfilled' ? eisResult.value : null;

                const picked = pickBestCandidate(currentRow, internetCandidate, eisCandidate, automationSettings.autoPickTopCandidate);
                if (picked) {
                  const pickedMeta = normalizeResolvedMeta(currentRow.type, { ...picked.meta, classification_source: picked.source });
                  next[i] = {
                    ...currentRow,
                    status: 'done',
                    specs: picked.specs,
                    meta: pickedMeta,
                    benchmark: enterpriseSettings.benchmarking ? buildRowBenchmarkEvidence(currentRow, picked) : undefined,
                  };
                  if (picked.source === 'internet') sourceStats.internet += 1;
                  else sourceStats.eis += 1;
                  finishRow();
                  return;
                }
              }

              const modelAwarePrompt = specificModelRequested ? buildSpecSearchPrompt(currentRow, g, platformSettings) : '';
              const { system: sysMsg, user: userMsg } = specificModelRequested ? { system: '', user: '' } : buildPrompt(currentRow, lawMode, platformSettings);
              let raw: string;
              const messages = specificModelRequested
                ? [{ role: 'user', content: modelAwarePrompt }]
                : [
                  { role: 'system', content: sysMsg },
                  { role: 'user', content: userMsg },
                ];

              // Retry logic: при таймауте или сетевой ошибке — повторяем до 2 раз
              const MAX_RETRIES = 2;
              let lastError: Error | null = null;
              for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                  if (attempt > 0) {
                    next[i] = { ...next[i], status: 'loading', error: `Повтор ${attempt}/${MAX_RETRIES}...` };
                    setRows([...next]);
                  }
                  if (useBackendAi) {
                    raw = await generateWithBackend(provider, model, messages, 0.1, 2048);
                  } else {
                    raw = await generateItemSpecsMessages(provider, apiKey, model, messages);
                  }
                  lastError = null;
                  break; // Success
                } catch (retryErr) {
                  lastError = retryErr instanceof Error ? retryErr : new Error(String(retryErr));
                  const isTimeout = lastError.message.includes('Превышено время') || lastError.message.includes('timeout') || lastError.message.includes('aborted') || lastError.message.includes('network');
                  const is5xx = /50[0-9]/.test(lastError.message);
                  if ((isTimeout || is5xx) && attempt < MAX_RETRIES) {
                    console.warn(`[AI retry] attempt ${attempt + 1} failed: ${lastError.message}, retrying...`);
                    await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); // 2s, 4s backoff
                    continue;
                  }
                  throw lastError;
                }
              }
              if (lastError) throw lastError;

              const { meta, specs } = parseAiResponse(raw!);
              const processed = postProcessSpecs(specs);
              const validatedMeta = await resolveUniversalMeta(currentRow, meta);
              const adjustedSpecs = adjustSpecsForCommercialContext(currentRow, processed);
              const enrichedSpecs = specificModelRequested
                ? sanitizeProcurementSpecs({
                  type: currentRow.type,
                  model: currentRow.model,
                  licenseType: getResolvedCommercialContext(currentRow).suggestedLicenseType,
                  term: getResolvedCommercialContext(currentRow).suggestedTerm,
                }, adjustedSpecs)
                : await expandSpecsToMinimum(currentRow, adjustedSpecs, validatedMeta);
              const isGenericGoods = isUniversalGoodsType(currentRow.type);
              if (enrichedSpecs.length === 0) {
                throw new Error('характеристики не найдены');
              }
              if (!isGenericGoods && !hasRealSpecValues(enrichedSpecs)) {
                throw new Error('характеристики не найдены');
              }
              if (specificModelRequested && !isGenericGoods && !hasSufficientExactModelCoverage(enrichedSpecs)) {
                throw new Error('характеристики не найдены');
              }
              const finalMeta = normalizeResolvedMeta(currentRow.type, { ...validatedMeta, classification_source: 'ai' });
              next[i] = {
                ...currentRow,
                status: 'done',
                specs: enrichedSpecs,
                meta: finalMeta,
                benchmark: undefined,
              };
              sourceStats.ai += 1;
            } catch (e) {
              const rawMsg = e instanceof Error ? e.message : 'generation_error';
              const providerAuthFailed = isAiProviderAuthErrorMessage(rawMsg);
              const isGenericGoods = isUniversalGoodsType(currentRow.type);
              const shouldTrySearchFallback = providerAuthFailed || isBackendTimeoutMessage(rawMsg) || !specificModelRequested || isGenericGoods;
              if (shouldTrySearchFallback) {
                try {
                  const [internetResult, eisResult] = await Promise.allSettled([
                    fetchInternetCandidateForRow(currentRow),
                    fetchEisCandidateForRow(currentRow),
                  ]);
                  const internetCandidate = internetResult.status === 'fulfilled' ? internetResult.value : null;
                  const eisCandidate = eisResult.status === 'fulfilled' ? eisResult.value : null;
                  const picked = pickBestCandidate(currentRow, internetCandidate, eisCandidate, true);
                  if (picked) {
                    next[i] = {
                      ...currentRow,
                      status: 'done',
                      specs: picked.specs,
                      meta: normalizeResolvedMeta(currentRow.type, { ...picked.meta, classification_source: picked.source }),
                      benchmark: enterpriseSettings.benchmarking ? buildRowBenchmarkEvidence(currentRow, picked) : undefined,
                    };
                    if (picked.source === 'internet') sourceStats.internet += 1;
                    else sourceStats.eis += 1;
                    finishRow();
                    return;
                  }
                } catch (fallbackError) {
                  console.warn('[generation] AI provider auth failed and search fallback also failed:', fallbackError);
                }
              }
              const msg = normalizeRowFailureMessage(currentRow, rawMsg, 'ai');
              const is402 = msg.includes('402')
                || msg.includes('лимит')
                || msg.includes('Достигнут лимит')
                || msg.includes('Пробный период')
                || msg.includes('подписку Pro');
              if (is402) {
                showToast('Пробный период завершён. Оформите Pro Business для продолжения работы.', false);
                window.dispatchEvent(new Event('tz:open-pricing'));
                next[i] = { ...currentRow, status: 'error', error: 'Требуется активная подписка Pro Business' };
                sourceStats.error += 1;
                shouldStop = true;
                finishRow();
                return;
              }
              if (
                specificModelRequested
                && canFallbackToCatalogTemplateForSpecificModel(currentRow.type)
                && catalogTemplateFallback
              ) {
                const enrichedSpecs = await expandSpecsToMinimum(currentRow, catalogTemplateFallback.specs, catalogTemplateFallback.meta);
                next[i] = {
                  ...currentRow,
                  status: 'done',
                  specs: enrichedSpecs,
                  meta: normalizeResolvedMeta(currentRow.type, {
                    ...catalogTemplateFallback.meta,
                    classification_source: 'catalog_fallback',
                  }),
                  benchmark: undefined,
                };
                sourceStats.template += 1;
              } else {
                next[i] = { ...currentRow, status: 'error', error: msg };
                sourceStats.error += 1;
              }
            }
            finishRow();
          })();
        }
      };

      try {
        await Promise.allSettled(Array.from({ length: CONCURRENCY_LIMIT }, (_, idx) => runWorker(idx)));

        const doneRows = next.filter((r) => r.status === 'done');
        const report = runComplianceGate(next);
        const readinessAfterGeneration = buildReadinessGateSummary(next, report, enterpriseSettings.benchmarking);
        const readinessBlockingIssues = readinessAfterGeneration.blockers.filter(
          (issue) => issue.key !== 'antifas-critical' || enterpriseSettings.antiFasStrictMode,
        );
        const complianceBlocksIntegrations = (
          enterpriseSettings.blockIntegrationsOnFail &&
          readinessBlockingIssues.length > 0
        );
        const complianceBlocksExports = (
          enterpriseSettings.blockExportsOnFail &&
          readinessBlockingIssues.length > 0
        );
        const payload = buildPayload(next, report);
        let integrationsOk = !complianceBlocksIntegrations;

        if (!complianceBlocksIntegrations) {
          if (automationSettings.autoSend) {
            const ok = await sendEventThroughBestChannel(automationSettings, 'tz.generated.react', payload);
            integrationsOk = integrationsOk && ok;
          }
          if (platformSettings.autoSendDraft) {
            const draftEndpoint = platformSettings.endpoint || '/api/v1/integration/draft';
            const ok = await postPlatformDraft(
              draftEndpoint,
              platformSettings.apiToken,
              payload,
              { profile: platformSettings.profile }
            );
            integrationsOk = integrationsOk && ok;
          }
          if (platformSettings.autoExport) {
            if (complianceBlocksExports) {
              appendAutomationLog({
                at: new Date().toISOString(),
                event: 'platform.auto_export',
                ok: false,
                note: `blocked_by_readiness blockers=${readinessBlockingIssues.length}`,
              });
            } else {
              try {
                const exported = exportPackage(next, report);
                integrationsOk = integrationsOk && exported;
                appendAutomationLog({ at: new Date().toISOString(), event: 'platform.auto_export', ok: exported });
              } catch {
                integrationsOk = false;
                appendAutomationLog({ at: new Date().toISOString(), event: 'platform.auto_export', ok: false });
              }
            }
          }
          if (shouldRunEnterpriseAutopilot) {
            try {
              const enterprise = await runEnterpriseAutopilot(
                payload as Record<string, unknown>,
                enterpriseSettings as unknown as Record<string, unknown>,
              );
              const ok = !!enterprise?.result?.ok && (enterprise?.result?.stages_failed ?? 0) === 0;
              integrationsOk = integrationsOk && ok;
              appendAutomationLog({
                at: new Date().toISOString(),
                event: 'enterprise.autopilot',
                ok,
                note: `stages=${enterprise?.result?.stages_total ?? 0}; failed=${enterprise?.result?.stages_failed ?? 0}; queued=${enterprise?.result?.queued_retry_records?.length ?? 0}`,
              });
            } catch (e) {
              integrationsOk = false;
              appendAutomationLog({
                at: new Date().toISOString(),
                event: 'enterprise.autopilot',
                ok: false,
                note: e instanceof Error ? e.message.slice(0, 180) : 'enterprise_autopilot_failed',
              });
            }
          }
          const automationQueueResult = await flushAutomationQueue(automationSettings);
          integrationsOk = integrationsOk && automationQueueResult.remaining === 0;
          if (platformSettings.autoFlushQueue) {
            const draftEndpoint = platformSettings.endpoint || '/api/v1/integration/draft';
            const platformQueueResult = await flushPlatformQueue(
              draftEndpoint,
              platformSettings.apiToken,
              platformSettings.profile
            );
            integrationsOk = integrationsOk && platformQueueResult.remaining === 0;
          }
        } else {
          appendAutomationLog({
            at: new Date().toISOString(),
            event: 'compliance.readiness.blocked_integrations',
            ok: false,
            note: buildReadinessIssuePreview(readinessBlockingIssues),
          });
          if (enterpriseSettings.immutableAudit) {
            appendImmutableAudit('compliance.readiness.blocked_integrations', {
              blockers: readinessBlockingIssues.map((issue) => issue.text),
            });
          }
        }

        const totalSpecs = doneRows.reduce((s, r) => s + (r.specs?.length ?? 0), 0);
        const eventName = autopilotEnabled ? 'react.autopilot' : 'react.generate';
        appendAutomationLog({
          at: new Date().toISOString(),
          event: eventName,
          ok: doneRows.length > 0 && integrationsOk,
          note: `rows=${next.length}; done=${doneRows.length}; src=t${sourceStats.template}/d${sourceStats.imported}/i${sourceStats.internet}/e${sourceStats.eis}/a${sourceStats.ai}/err${sourceStats.error}`,
        });

        setDocxReady(doneRows.length > 0);
        if (doneRows.length > 0) {
          setQaAutoRunKey((k) => k + 1);
        }
        if (doneRows.length > 0 && (useBackendAi || apiKey.trim())) {
          void runDeCheck(next);
        }
        if (doneRows.length > 0) {
          const prefix = autopilotEnabled ? 'Автопилот завершён' : 'ТЗ сформировано';
          if (complianceBlocksIntegrations) {
            showToast(`⚠️ ${prefix}, но интеграции заблокированы: ${buildReadinessIssuePreview(readinessBlockingIssues, 2)}`, false);
          } else if (readinessAfterGeneration.status === 'block') {
            showToast(`⚠️ ${prefix}, но перед публикацией нужно устранить блокеры: ${buildReadinessIssuePreview(readinessAfterGeneration.blockers, 2)}`, false);
          } else if (readinessAfterGeneration.status === 'warn') {
            showToast(`⚠️ ${prefix}, но перед публикацией осталось проверить: ${buildReadinessIssuePreview(readinessAfterGeneration.warnings, 2)}`, false);
          } else if (integrationsOk) {
            showToast(`✅ ${prefix}: ${doneRows.length} позиц., ${totalSpecs} характеристик`);
          } else {
            showToast(`⚠️ ${prefix}, но часть интеграций не отправлена`, false);
          }
          scrollToPreview();
        } else {
          showToast('❌ Не удалось сформировать ТЗ', false);
        }
      } finally {
        setGenerationProgress(null);
        if (autopilotEnabled || hasUniversalRows) {
          setInternetSearching(false);
          setEisSearching(false);
        }
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'неизвестная ошибка генерации';
      console.error('[generation] unexpected mutation error:', error);
      showToast(`❌ Генерация прервана: ${message}`, false);
    },
  });
  const canStartGeneration = !paymentRequired && canGenerate && !mutation.isPending && (canUseAiAssist || canRunGenerationWithoutAi) && !publicationAutopilotRunning;

  useEffect(() => {
    if (!pendingAutoGenerate) return;
    if (!canStartGeneration) return;
    setPendingAutoGenerate(false);
    mutation.mutate({ trigger: 'manual' });
  }, [pendingAutoGenerate, canStartGeneration, mutation]);

  useEffect(() => {
    const runAutopilot = () => {
      if (mutation.isPending) return;
      if (!ensurePaidFeatureAccess('Пробный период завершён. Оформите Pro Business для автодоводки и публикации.')) return;
      mutation.mutate({ forceAutopilot: true, trigger: 'autopilot_button' });
    };
    window.addEventListener('tz:autopilot:run', runAutopilot as EventListener);
    return () => window.removeEventListener('tz:autopilot:run', runAutopilot as EventListener);
  }, [ensurePaidFeatureAccess, mutation.isPending, mutation.mutate]);

  const addRowWithType = useCallback((nextType: string) => {
    setSplitSourceRows(null);
    setActiveSplitGroupKey(null);
    setRows((prev) => [...prev, { id: Date.now(), type: nextType, typeLocked: false, model: '', licenseType: '', term: '', licenseTypeAuto: false, termAuto: false, qty: 1, status: 'idle' }]);
    if (nextType === 'otherGoods' || nextType === 'otherService' || isServiceCatalogType(nextType)) {
      setCatalogMode('general');
    }
  }, [isServiceCatalogType]);

  const addRow = useCallback(() => {
    addRowWithType(catalogMode === 'general' ? 'otherGoods' : 'pc');
  }, [addRowWithType, catalogMode]);

  const replaceWorkspaceRows = useCallback((nextRows: GoodsRow[]) => {
    setRows(nextRows);
    setCurrentDocId(null);
    setExpandedRowMetaId(null);
    setEditingRowId(null);
    setFocusedRowId(null);
    setTypeSuggestions(null);
    setRowActionState(null);
    setAutoDetectedRow(null);
    const hasServices = nextRows.some((row) => isServiceCatalogType(row.type) || row.type === 'otherService');
    setCatalogMode(hasServices ? 'general' : nextRows.some((row) => row.type === 'otherGoods') ? 'general' : 'it');
    runComplianceGate(nextRows);
    setDocxReady(nextRows.some((row) => row.status === 'done' && !!row.specs?.length));
  }, [runComplianceGate]);

  const mapTemplateRowsToDraft = useCallback((templateRows: Array<{
    type: string;
    model: string;
    licenseType?: string;
    term?: string;
    qty: number;
  }>): GoodsRow[] => {
    const seed = Date.now();
    return templateRows.map((row, idx) => ({
      id: seed + idx,
      type: row.type,
      typeLocked: false,
      model: row.model,
      licenseType: row.licenseType || '',
      term: row.term || '',
      licenseTypeAuto: false,
      termAuto: false,
      qty: Math.max(1, Number(row.qty || 1)),
      status: 'idle',
    }));
  }, []);

  const applyTemplatePack = useCallback((
    template: Pick<OrganizationTemplatePack, 'name' | 'rows'> | Pick<WorkspaceTemplateStored, 'name' | 'rows'>,
    mode: 'replace' | 'append' = 'replace'
  ) => {
    if (!template.rows.length) {
      showToast('⚠️ В шаблоне нет позиций', false);
      return;
    }
    const nextRows = mapTemplateRowsToDraft(template.rows);
    setCurrentDocId(null);
    if (mode === 'append') {
      setRows((prev) => [...prev, ...nextRows]);
      setDocxReady(false);
      setComplianceReport(null);
    } else {
      setSplitSourceRows(null);
      setActiveSplitGroupKey(null);
      setSplitPlannerOpen(false);
      replaceWorkspaceRows(nextRows);
      setComplianceReport(null);
      setDocxReady(false);
    }
    showToast(`✅ Шаблон "${template.name}" ${mode === 'append' ? 'добавлен' : 'загружен'}`, true);
    appendAutomationLog({
      at: new Date().toISOString(),
      event: mode === 'append' ? 'workspace.template.append' : 'workspace.template.load',
      ok: true,
      note: template.name,
    });
    if (enterpriseSettings.immutableAudit) {
      appendImmutableAudit(mode === 'append' ? 'workspace.template.append' : 'workspace.template.load', {
        template: template.name,
        rows: template.rows.length,
      });
    }
  }, [enterpriseSettings.immutableAudit, mapTemplateRowsToDraft, replaceWorkspaceRows, showToast]);

  const saveCurrentDraftAsTemplate = useCallback(() => {
    const rowsForTemplate = rows
      .filter((row) => row.model.trim() || row.licenseType.trim() || row.term.trim() || row.qty !== 1 || row.type !== 'pc')
      .map((row) => {
        const catalog = lookupCatalog(row.type);
        return {
          type: row.type,
          model: row.model.trim() || catalog.placeholder || cleanCatalogName(catalog.name),
          licenseType: row.licenseType.trim() || undefined,
          term: row.term.trim() || undefined,
          qty: Math.max(1, Number(row.qty || 1)),
        };
      });
    if (rowsForTemplate.length === 0) {
      showToast('⚠️ Сначала соберите хотя бы одну осмысленную позицию', false);
      return;
    }
    const suggestedName = suggestTemplateNameForPreset(platformSettings.industryPreset, platformSettings.orgName);
    const name = window.prompt('Название шаблона организации', suggestedName)?.trim();
    if (!name) return;
    const template: WorkspaceTemplateStored = {
      id: `tpl_${Date.now()}`,
      name,
      description: `${rowsForTemplate.length} поз. · ${templatePresetMeta.shortLabel}`,
      industryPreset: platformSettings.industryPreset,
      updatedAt: new Date().toISOString(),
      rows: rowsForTemplate,
    };
    saveWorkspaceTemplate(template);
    refreshCustomTemplates();
    showToast(`✅ Шаблон "${name}" сохранён`, true);
    appendAutomationLog({
      at: new Date().toISOString(),
      event: 'workspace.template.saved',
      ok: true,
      note: `${name}; rows=${rowsForTemplate.length}`,
    });
    if (enterpriseSettings.immutableAudit) {
      appendImmutableAudit('workspace.template.saved', {
        template: name,
        rows: rowsForTemplate.length,
        preset: platformSettings.industryPreset,
      });
    }
  }, [
    enterpriseSettings.immutableAudit,
    platformSettings.industryPreset,
    platformSettings.orgName,
    refreshCustomTemplates,
    rows,
    showToast,
    templatePresetMeta.shortLabel,
  ]);

  const removeCustomTemplate = useCallback((templateId: string, templateName: string) => {
    if (!window.confirm(`Удалить шаблон "${templateName}"?`)) return;
    deleteWorkspaceTemplate(templateId);
    refreshCustomTemplates();
    showToast(`✅ Шаблон "${templateName}" удалён`, true);
    appendAutomationLog({
      at: new Date().toISOString(),
      event: 'workspace.template.deleted',
      ok: true,
      note: templateName,
    });
    if (enterpriseSettings.immutableAudit) {
      appendImmutableAudit('workspace.template.deleted', {
        template: templateName,
        id: templateId,
      });
    }
  }, [enterpriseSettings.immutableAudit, refreshCustomTemplates, showToast]);

  const resetWorkspaceDraft = useCallback(() => {
    setSplitSourceRows(null);
    setActiveSplitGroupKey(null);
    setSplitPlannerOpen(false);
    setCurrentDocId(null);
    setComplianceReport(null);
    replaceWorkspaceRows([{
      id: Date.now(),
      type: catalogMode === 'general' ? 'otherGoods' : 'pc',
      typeLocked: false,
      model: '',
      licenseType: '',
      term: '',
      licenseTypeAuto: false,
      termAuto: false,
      qty: 1,
      status: 'idle',
    }]);
    showToast('✅ Черновик очищен. Можно загружать файл заново.', true);
  }, [catalogMode, replaceWorkspaceRows, showToast]);

  const openSplitGroup = useCallback((groupKey: ProcurementPurposeKey) => {
    const sourceRows = splitSourceRows?.length ? splitSourceRows : rows;
    const groups = buildProcurementSplitGroups(sourceRows);
    const target = groups.find((group) => group.key === groupKey);
    if (!target) {
      showToast('❌ Группа для отдельного ТЗ не найдена', false);
      return;
    }
    if (!splitSourceRows?.length) {
      setSplitSourceRows(cloneGoodsRows(sourceRows));
    }
    setActiveSplitGroupKey(groupKey);
    setSplitPlannerOpen(true);
    const base = Date.now();
    replaceWorkspaceRows(cloneGoodsRows(target.rows).map((row, idx) => ({ ...row, id: base + idx })));
    showToast(`✅ Открыто отдельное ТЗ: ${target.title}`, true);
  }, [replaceWorkspaceRows, rows, showToast, splitSourceRows]);

  const restoreSplitGroupsSource = useCallback(() => {
    if (!splitSourceRows?.length) return;
    const base = Date.now();
    replaceWorkspaceRows(cloneGoodsRows(splitSourceRows).map((row, idx) => ({ ...row, id: base + idx })));
    setSplitSourceRows(null);
    setActiveSplitGroupKey(null);
    setSplitPlannerOpen(false);
    showToast('✅ Восстановлен полный список позиций из исходного файла', true);
  }, [replaceWorkspaceRows, showToast, splitSourceRows]);

  const saveSplitGroupsLocally = useCallback(async () => {
    if (!ensurePaidFeatureAccess('Пробный период завершён. Оформите Pro Business для сохранения отдельных ТЗ.')) {
      return;
    }
    const sourceRows = splitSourceRows?.length ? splitSourceRows : rows;
    const groups = buildProcurementSplitGroups(sourceRows);
    if (groups.length < 2) {
      showToast('ℹ️ Для разбиения нужен хотя бы один файл с несколькими группами позиций', false);
      return;
    }
    setSplitSaving(true);
    try {
      for (const group of groups) {
        await saveTZDocumentLocal({
          title: group.title,
          law_mode: lawMode,
          rows: group.rows.map((row) => ({
            type: row.type,
            model: row.model,
            licenseType: row.licenseType,
            term: row.term,
            qty: row.qty,
            status: row.status,
            error: row.error || '',
            specs: row.specs ?? [],
            meta: row.meta ?? {},
            benchmark: row.benchmark ?? null,
            import_info: row.importInfo ?? null,
            split_group: group.key,
          })),
          compliance_score: null,
          readiness: null,
          publication_dossier: null,
        });
      }
      void loadHistory();
      showToast(`✅ Разбиение сохранено: ${groups.length} отдельных ТЗ`, true);
    } catch (error) {
      showToast(`❌ Не удалось сохранить разбивку: ${error instanceof Error ? error.message : 'ошибка'}`, false);
    } finally {
      setSplitSaving(false);
    }
  }, [ensurePaidFeatureAccess, lawMode, loadHistory, rows, showToast, splitSourceRows]);

  // ── Двойной эквивалент: проверить ≥2 производителей ────────────────────────
  const runDeCheck = useCallback(async (rowsOverride?: typeof rows) => {
    const targetRows = rowsOverride ?? rows;
    const doneRows = targetRows.filter((r) => r.status === 'done' && r.specs && r.specs.length > 0);
    if (doneRows.length === 0) {
      showToast('Сначала сгенерируйте характеристики позиций', false);
      return;
    }
    setDeLoading(true);
    setDeResult(null);
    setDeConflicts([]);
    try {
      const row = doneRows[0];
      const backendGen = useBackendAi
        ? (p: string, m: string, msgs: { role: string; content: string }[]) => generateWithBackend(p, m, msgs)
        : undefined;

      const [deCheckResult, conflictResult] = await Promise.allSettled([
        runDoubleEquivalentCheck(
          row.model || lookupCatalog(row.type).name,
          row.specs ?? [],
          provider,
          apiKey,
          model,
          backendGen,
        ),
        useBackendAi && row.model.trim()
          ? fetchSpecsViaBackend(
              row.model.trim(),
              row.specs ?? [],
              row.type,
              (p, m, msgs) => generateWithBackend(p, m, msgs),
              provider,
              model,
              searchInternetSpecs,
            )
          : Promise.resolve(null),
      ]);

      if (deCheckResult.status === 'fulfilled') {
        setDeResult(deCheckResult.value);
      }
      if (conflictResult.status === 'fulfilled' && conflictResult.value) {
        const fetched = conflictResult.value;
        if (fetched.conflicts.length > 0) {
          setDeConflicts(fetched.conflicts);
        }
      }
    } catch (e) {
      showToast(`Ошибка проверки двойного эквивалента: ${e instanceof Error ? e.message : String(e)}`, false);
    } finally {
      setDeLoading(false);
    }
  }, [apiKey, model, provider, rows, showToast, useBackendAi]);

  // ── Применить расширение диапазонов для двойного эквивалента ─────────────────
  const handleApplyWiden = useCallback(() => {
    if (!deResult || deResult.widened.length === 0) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.status !== 'done' || !r.specs || r.specs.length === 0) return r;
        const widened = widenSpecsForDoubleEquiv(r.specs, deResult.widened);
        return { ...r, specs: widened };
      }),
    );
    showToast('Диапазоны расширены — ТЗ теперь допускает ≥2 производителей', true);
  }, [deResult, showToast]);

  // ── Подтянуть реальные характеристики товара ────────────────────────────────
  const enrichFromInternet = useCallback(async () => {
    if (!ensurePaidFeatureAccess('Пробный период завершён. Оформите Pro Business для поиска характеристик в интернете.')) {
      return;
    }
    const filledRows = rows.filter((r) => r.model.trim().length > 0);
    if (filledRows.length === 0) {
      alert('Заполните поле «Модель / описание» хотя бы в одной строке');
      return;
    }
    if (!useBackend && !apiKey.trim()) {
      alert('Войдите в систему для поиска через интернет, или введите API-ключ');
      return;
    }
    setInternetSearching(true);
    const next = [...rows];
    for (let i = 0; i < next.length; i++) {
      if (!next[i].model.trim()) continue;
      next[i] = { ...next[i], status: 'loading', error: '' };
      setRows([...next]);
      try {
        const candidate = await fetchInternetCandidateForRow(next[i]);
        if (!candidate || candidate.specs.length === 0) {
          throw new Error('характеристики не найдены');
        }
        next[i] = {
          ...next[i],
          status: 'done',
          specs: candidate.specs,
          meta: normalizeResolvedMeta(next[i].type, { ...candidate.meta, classification_source: candidate.source }),
          benchmark: enterpriseSettings.benchmarking ? buildRowBenchmarkEvidence(next[i], candidate) : undefined,
        };
      } catch (e) {
        const message = normalizeRowFailureMessage(next[i], e instanceof Error ? e.message : 'error', 'internet');
        next[i] = { ...next[i], status: 'error', error: message };
      }
      setRows([...next]);
    }
    setInternetSearching(false);
    const done = next.filter((r) => r.status === 'done');
    const totalSpecs = done.reduce((s, r) => s + (r.specs?.length ?? 0), 0);
    if (done.length > 0) {
      runComplianceGate(next);
      setDocxReady(true);
      showToast(`✅ Характеристики добавлены в ТЗ: ${totalSpecs} параметров`);
      scrollToPreview();
    } else {
      const firstError = next.find((r) => r.status === 'error' && r.error)?.error || '';
      showToast(
        firstError
          ? `❌ Не удалось получить характеристики: ${firstError}`
          : '❌ Не удалось получить характеристики',
        false
      );
    }
  }, [apiKey, enterpriseSettings.benchmarking, ensurePaidFeatureAccess, fetchInternetCandidateForRow, rows, runComplianceGate, scrollToPreview, showToast, useBackend]);

  // ── Найти ТЗ в ЕИС (zakupki.gov.ru) ─────────────────────────────────────────
  const searchZakupki = useCallback(async () => {
    if (!ensurePaidFeatureAccess('Пробный период завершён. Оформите Pro Business для поиска ТЗ в ЕИС.')) {
      return;
    }
    const filledRows = rows.filter((r) => r.model.trim().length > 0);
    if (filledRows.length === 0) {
      alert('Заполните поле «Модель / описание» хотя бы в одной строке');
      return;
    }
    if (!useBackend && !apiKey.trim()) {
      alert('Войдите в систему для поиска в ЕИС, или введите API-ключ');
      return;
    }
    setEisSearching(true);
    const next = [...rows];
    for (let i = 0; i < next.length; i++) {
      if (!next[i].model.trim()) continue;
      next[i] = { ...next[i], status: 'loading', error: '' };
      setRows([...next]);

      try {
        const candidate = await fetchEisCandidateForRow(next[i]);
        if (!candidate || candidate.specs.length === 0) {
          throw new Error('данные ЕИС не найдены');
        }
        const eisMeta = normalizeResolvedMeta(next[i].type, { ...candidate.meta, classification_source: candidate.source });
        next[i] = {
          ...next[i],
          status: 'done',
          specs: candidate.specs,
          meta: eisMeta,
          benchmark: enterpriseSettings.benchmarking ? buildRowBenchmarkEvidence(next[i], candidate) : undefined,
        };
      } catch (e) {
        const message = normalizeRowFailureMessage(next[i], e instanceof Error ? e.message : 'error', 'eis');
        next[i] = { ...next[i], status: 'error', error: message };
      }
      setRows([...next]);
    }
    setEisSearching(false);
    const done2 = next.filter((r) => r.status === 'done');
    const totalSpecs2 = done2.reduce((s, r) => s + (r.specs?.length ?? 0), 0);
    if (done2.length > 0) {
      runComplianceGate(next);
      setDocxReady(true);
      showToast(`✅ Данные из ЕИС добавлены в ТЗ: ${totalSpecs2} характеристик`);
      scrollToPreview();
    } else {
      const firstError = next.find((r) => r.status === 'error' && r.error)?.error || '';
      showToast(
        firstError
          ? `❌ Не удалось получить данные из ЕИС: ${firstError}`
          : '❌ Не удалось получить данные из ЕИС',
        false
      );
    }
  }, [apiKey, enterpriseSettings.benchmarking, ensurePaidFeatureAccess, fetchEisCandidateForRow, rows, runComplianceGate, scrollToPreview, showToast, useBackend]);
  const refreshRowFromSource = useCallback(async (rowId: number, source: 'internet' | 'eis') => {
    if (!ensurePaidFeatureAccess(`Пробный период завершён. Оформите Pro Business для ${source === 'eis' ? 'поиска в ЕИС' : 'подтягивания источников'}.`)) {
      return;
    }
    const currentRow = rows.find((row) => row.id === rowId);
    if (!currentRow) return;
    if (!currentRow.model.trim()) {
      showToast('❌ Сначала заполните поле «Модель / описание» для этой строки', false);
      focusRow(rowId, true);
      return;
    }
    if (!useBackend && !apiKey.trim()) {
      showToast(`❌ ${source === 'eis' ? 'Для поиска в ЕИС' : 'Для поиска источника'} требуется вход в аккаунт или API-ключ`, false);
      return;
    }
    setRowActionState({ rowId, source });
    setRows((prev) => prev.map((row) => (
      row.id === rowId ? { ...row, status: 'loading', error: '' } : row
    )));
    try {
      let candidate = source === 'eis'
        ? await fetchEisCandidateForRow(currentRow)
        : await fetchInternetCandidateForRow(currentRow);
      if ((!candidate || candidate.specs.length === 0) && canFallbackToCatalogTemplateForSpecificModel(currentRow.type)) {
        const fallback = buildCatalogTemplateFallback(currentRow);
        if (fallback && fallback.specs.length > 0) {
          const enriched = await expandSpecsToMinimum(currentRow, fallback.specs, fallback.meta);
          candidate = {
            source: 'internet',
            specs: enriched,
            meta: normalizeResolvedMeta(currentRow.type, { ...fallback.meta, classification_source: 'catalog_fallback' }),
          };
        }
      }
      if (!candidate || candidate.specs.length === 0) {
        throw new Error(source === 'eis' ? 'данные ЕИС не найдены' : 'характеристики не найдены');
      }
      let nextRows: GoodsRow[] = rows;
      setRows((prev) => {
        nextRows = prev.map((row) => (
          row.id === rowId
            ? {
                ...row,
                status: 'done',
                specs: candidate.specs,
                meta: normalizeResolvedMeta(row.type, { ...candidate.meta, classification_source: candidate.source }),
                benchmark: enterpriseSettings.benchmarking ? buildRowBenchmarkEvidence(row, candidate) : undefined,
              }
            : row
        ));
        return nextRows;
      });
      runComplianceGate(nextRows);
      setDocxReady(nextRows.some((row) => row.status === 'done' && !!row.specs?.length));
      showToast(`✅ ${source === 'eis' ? 'Позиция обновлена по данным ЕИС' : 'Источник для позиции подтянут'}`, true);
      focusRow(rowId, true);
    } catch (error) {
      const message = normalizeRowFailureMessage(currentRow, error instanceof Error ? error.message : 'error', source);
      setRows((prev) => prev.map((row) => (
        row.id === rowId ? { ...row, status: 'error', error: message } : row
      )));
      showToast(`❌ ${source === 'eis' ? 'Не удалось обновить позицию из ЕИС' : 'Не удалось подтянуть источник'}: ${message}`, false);
      focusRow(rowId, true);
    } finally {
      setRowActionState(null);
    }
  }, [
    rows,
    ensurePaidFeatureAccess,
    useBackend,
    apiKey,
    fetchEisCandidateForRow,
    fetchInternetCandidateForRow,
    expandSpecsToMinimum,
    enterpriseSettings.benchmarking,
    focusRow,
    runComplianceGate,
    showToast,
  ]);
  const assistClassificationForRow = useCallback(async (row: GoodsRow) => {
    let preferredSource: 'eis' | 'internet' | 'ai' = getClassificationSourceKey(row.meta, row.type) === 'eis' ? 'eis' : 'ai';
    let benchmark = row.benchmark;
    let fallbackSpecs: SpecItem[] | undefined;
    const contextParts = [buildRowClassificationContext(row)];

    const candidateFetchers: Array<() => Promise<SpecsCandidate | null>> = [
      () => fetchEisCandidateForRow(row),
      () => fetchInternetCandidateForRow(row),
    ];

    for (const fetchCandidate of candidateFetchers) {
      let candidate: SpecsCandidate | null = null;
      try {
        candidate = await fetchCandidate();
      } catch {
        candidate = null;
      }
      if (!candidate) continue;

      preferredSource = candidate.source === 'eis'
        ? 'eis'
        : preferredSource === 'eis'
          ? 'eis'
          : candidate.source;

      if (!fallbackSpecs?.length && candidate.specs?.length) {
        fallbackSpecs = candidate.specs;
      }
      if (enterpriseSettings.benchmarking) {
        benchmark = buildRowBenchmarkEvidence(row, candidate) ?? benchmark;
      }

      const candidateMeta = normalizeResolvedMeta(row.type, {
        ...(row.meta || {}),
        ...candidate.meta,
        classification_source: candidate.source,
      });
      if (isUniversalMetaComplete(candidateMeta)) {
        return {
          meta: candidateMeta,
          benchmark,
          specs: !row.specs?.length ? candidate.specs : undefined,
          sourceLabel: candidate.source === 'eis' ? 'ЕИС / КТРУ' : 'интернет-источники',
        };
      }

      if (candidate.sourceContextText) {
        contextParts.push(candidate.sourceContextText);
      }
      const candidateSpecsContext = buildSpecSnapshotContext(
        candidate.sourceSpecs || candidate.specs,
        candidate.source === 'eis' ? 'Характеристики ЕИС / КТРУ' : 'Характеристики интернет-источника',
        16,
      );
      if (candidateSpecsContext) {
        contextParts.push(candidateSpecsContext);
      }
    }

    const resolvedMeta = await resolveUniversalMeta(row, row.meta || {}, contextParts.filter(Boolean).join('\n\n'));
    return {
      meta: normalizeResolvedMeta(row.type, {
        ...(row.meta || {}),
        ...resolvedMeta,
        classification_source: preferredSource,
      }),
      benchmark,
      specs: !row.specs?.length ? fallbackSpecs : undefined,
      sourceLabel: preferredSource === 'eis'
        ? 'ЕИС + ИИ-классификация'
        : preferredSource === 'internet'
          ? 'интернет + ИИ-классификация'
          : 'ИИ-классификация',
    };
  }, [
    enterpriseSettings.benchmarking,
    fetchEisCandidateForRow,
    fetchInternetCandidateForRow,
    resolveUniversalMeta,
  ]);
  const refreshRowClassification = useCallback(async (rowId: number) => {
    if (!ensurePaidFeatureAccess('Пробный период завершён. Оформите Pro Business для уточнения классификации.')) {
      return;
    }
    const currentRow = rows.find((row) => row.id === rowId);
    if (!currentRow) return;
    if (!currentRow.model.trim()) {
      showToast('❌ Сначала заполните поле «Модель / описание» для этой строки', false);
      focusRow(rowId, true);
      return;
    }
    if (!canUseAiAssist) {
      showToast('❌ Для уточнения классификации требуется доступ к backend/AI', false);
      return;
    }
    setRowActionState({ rowId, source: 'classify' });
    setRows((prev) => prev.map((row) => (
      row.id === rowId ? { ...row, status: 'loading', error: '' } : row
    )));
    try {
      const patch = await assistClassificationForRow(currentRow);
      let nextRows: GoodsRow[] = rows;
      setRows((prev) => {
        nextRows = prev.map((row) => {
          if (row.id !== rowId) return row;
          return {
            ...row,
            status: row.specs?.length || patch.specs?.length ? 'done' : currentRow.status,
            error: '',
            specs: row.specs?.length ? row.specs : (patch.specs || row.specs),
            meta: patch.meta,
            benchmark: patch.benchmark ?? row.benchmark,
          };
        });
        return nextRows;
      });
      runComplianceGate(nextRows);
      setDocxReady(nextRows.some((row) => row.status === 'done' && !!row.specs?.length));
      showToast(`✅ Классификация обновлена: ${patch.sourceLabel}`, true);
      focusRow(rowId, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'error';
      setRows((prev) => prev.map((row) => (
        row.id === rowId ? { ...currentRow, error: message } : row
      )));
      showToast(`❌ Не удалось уточнить классификацию: ${message}`, false);
      focusRow(rowId, true);
    } finally {
      setRowActionState(null);
    }
  }, [assistClassificationForRow, canUseAiAssist, ensurePaidFeatureAccess, focusRow, rows, runComplianceGate, showToast]);
  const refreshClassificationBulk = useCallback(async (mode: 'missing' | 'review' | 'all' = 'all') => {
    if (!ensurePaidFeatureAccess('Пробный период завершён. Оформите Pro Business для пакетной классификации.')) {
      return;
    }
    const sourceRows = [...rows];
    const targets = sourceRows.filter((row) => {
      if (!row.model.trim()) return false;
      const missingOkpd2 = !getResolvedOkpd2Code(row);
      const needsReview = requiresManualClassificationReview(row);
      if (mode === 'missing') return missingOkpd2;
      if (mode === 'review') return needsReview;
      return missingOkpd2 || needsReview;
    });
    if (!targets.length) {
      showToast('ℹ️ Нет позиций, требующих переобогащения классификации', true);
      return;
    }
    if (!canUseAiAssist) {
      showToast('❌ Для переобогащения классификации требуется доступ к backend/AI', false);
      return;
    }

    let workingRows = sourceRows;
    let updated = 0;
    let filledOkpd2 = 0;
    let clearedReview = 0;

    for (const target of targets) {
      const current = workingRows.find((row) => row.id === target.id);
      if (!current) continue;
      const beforeMissingOkpd2 = !getResolvedOkpd2Code(current);
      const beforeReview = requiresManualClassificationReview(current);
      setRowActionState({ rowId: current.id, source: 'classify' });
      try {
        const patch = await assistClassificationForRow(current);
        const nextRow: GoodsRow = {
          ...current,
          status: current.specs?.length || patch.specs?.length ? 'done' : current.status,
          error: '',
          specs: current.specs?.length ? current.specs : (patch.specs || current.specs),
          meta: patch.meta,
          benchmark: patch.benchmark ?? current.benchmark,
        };
        const afterMissingOkpd2 = !getResolvedOkpd2Code(nextRow);
        const afterReview = requiresManualClassificationReview(nextRow);
        if (beforeMissingOkpd2 && !afterMissingOkpd2) filledOkpd2 += 1;
        if (beforeReview && !afterReview) clearedReview += 1;
        updated += 1;
        workingRows = workingRows.map((row) => (row.id === current.id ? nextRow : row));
        setRows(workingRows);
      } catch {
        // продолжаем для остальных строк
      } finally {
        setRowActionState(null);
      }
    }

    runComplianceGate(workingRows);
    setDocxReady(workingRows.some((row) => row.status === 'done' && !!row.specs?.length));
    if (updated === 0) {
      showToast('❌ Не удалось переобогатить классификацию ни по одной позиции', false);
      return;
    }
    showToast(`✅ Классификация обновлена: ${updated}; закрыто без ОКПД2 — ${filledOkpd2}; снято ручных проверок — ${clearedReview}`, true);
  }, [assistClassificationForRow, canUseAiAssist, ensurePaidFeatureAccess, rows, runComplianceGate, showToast]);
  const runPublicationAutopilot = useCallback(async () => {
    if (!ensurePaidFeatureAccess('Пробный период завершён. Оформите Pro Business для publication autopilot.')) {
      return;
    }
    const sourceRows = [...rows];
    if (sourceRows.length === 0) {
      showToast('ℹ️ Нет строк для доведения до публикации', true);
      return;
    }

    setPublicationAutopilotRunning(true);
    let workingRows = sourceRows;
    let classificationUpdated = 0;
    let classificationFilledOkpd2 = 0;
    let classificationClearedReview = 0;
    let classificationSkipped = 0;
    let benchmarkUpdated = 0;
    let serviceUpdated = 0;
    let legalUpdated = 0;

    try {
      const classificationTargets = workingRows.filter((row) => row.model.trim() && (!getResolvedOkpd2Code(row) || requiresManualClassificationReview(row)));

      if (classificationTargets.length > 0) {
        if (canUseAiAssist) {
          for (const target of classificationTargets) {
            const current = workingRows.find((row) => row.id === target.id);
            if (!current) continue;
            const beforeMissingOkpd2 = !getResolvedOkpd2Code(current);
            const beforeReview = requiresManualClassificationReview(current);
            setRowActionState({ rowId: current.id, source: 'classify' });
            try {
              const patch = await assistClassificationForRow(current);
              const nextRow: GoodsRow = {
                ...current,
                status: current.specs?.length || patch.specs?.length ? 'done' : current.status,
                error: '',
                specs: current.specs?.length ? current.specs : (patch.specs || current.specs),
                meta: patch.meta,
                benchmark: patch.benchmark ?? current.benchmark,
              };
              const afterMissingOkpd2 = !getResolvedOkpd2Code(nextRow);
              const afterReview = requiresManualClassificationReview(nextRow);
              if (beforeMissingOkpd2 && !afterMissingOkpd2) classificationFilledOkpd2 += 1;
              if (beforeReview && !afterReview) classificationClearedReview += 1;
              classificationUpdated += 1;
              workingRows = workingRows.map((row) => (row.id === current.id ? nextRow : row));
              setRows(workingRows);
            } catch {
              // продолжаем с остальными строками
            } finally {
              setRowActionState(null);
            }
          }
        } else {
          classificationSkipped = classificationTargets.length;
        }
      }

      workingRows = workingRows.map((row) => {
        let nextRow = row;

        if (shouldApplyLegalReadinessPatch(nextRow)) {
          const patched = applyLegalReadinessPatchToRow(nextRow);
          if (patched !== nextRow) {
            nextRow = patched;
            legalUpdated += 1;
          }
        }

        if (enterpriseSettings.benchmarking && nextRow.benchmark && nextRow.specs?.length) {
          const comparison = buildDraftSourceComparison(nextRow.benchmark.sourceSpecs, nextRow.specs, nextRow.type);
          if (comparison.onlySource.length > 0 || comparison.changed.length > 0) {
            nextRow = applyBenchmarkPatchToRow(nextRow, 'all');
            benchmarkUpdated += 1;
          }
        }

        if (isServiceCatalogType(nextRow.type) && nextRow.status === 'done' && nextRow.specs?.length) {
          const patched = applyServiceReadinessPatchToRow(nextRow, 'all');
          if (patched !== nextRow) {
            nextRow = patched;
            serviceUpdated += 1;
          }
        }

        return nextRow;
      });

      setRows(workingRows);
      const report = runComplianceGate(workingRows);
      setDocxReady(workingRows.some((row) => row.status === 'done' && !!row.specs?.length));
      const readinessAfter = buildReadinessGateSummary(workingRows, report, enterpriseSettings.benchmarking);
      appendAutomationLog({
        at: new Date().toISOString(),
        event: 'compliance.publication_autopilot',
        ok: readinessAfter.status !== 'block',
        note: `classification=${classificationUpdated}; okpd2=${classificationFilledOkpd2}; review=${classificationClearedReview}; benchmark=${benchmarkUpdated}; service=${serviceUpdated}; legal=${legalUpdated}; skipped=${classificationSkipped}`,
      });

      const summaryParts: string[] = [];
      if (classificationUpdated > 0) summaryParts.push(`классификация ${classificationUpdated}`);
      if (classificationFilledOkpd2 > 0) summaryParts.push(`ОКПД2 ${classificationFilledOkpd2}`);
      if (classificationClearedReview > 0) summaryParts.push(`верификация ${classificationClearedReview}`);
      if (benchmarkUpdated > 0) summaryParts.push(`benchmark ${benchmarkUpdated}`);
      if (serviceUpdated > 0) summaryParts.push(`сервисы ${serviceUpdated}`);
      if (legalUpdated > 0) summaryParts.push(`юридика ${legalUpdated}`);
      if (classificationSkipped > 0) summaryParts.push(`классификация пропущена ${classificationSkipped}`);

      if (summaryParts.length === 0) {
        showToast('ℹ️ Publication autopilot не нашёл позиций для доработки', true);
        return;
      }

      if (classificationSkipped > 0) {
        showToast(`⚠️ Publication autopilot: ${summaryParts.join(', ')}`, false);
      } else if (readinessAfter.status === 'block') {
        showToast(`⚠️ Publication autopilot завершён: ${summaryParts.join(', ')}. Остались блокеры: ${buildReadinessIssuePreview(readinessAfter.blockers, 2)}`, false);
      } else if (readinessAfter.status === 'warn') {
        showToast(`⚠️ Publication autopilot завершён: ${summaryParts.join(', ')}. Остались предупреждения: ${buildReadinessIssuePreview(readinessAfter.warnings, 2)}`, false);
      } else {
        showToast(`✅ Publication autopilot: ${summaryParts.join(', ')}`, true);
      }
    } finally {
      setPublicationAutopilotRunning(false);
      setRowActionState(null);
    }
  }, [
    appendAutomationLog,
    assistClassificationForRow,
    canUseAiAssist,
    ensurePaidFeatureAccess,
    enterpriseSettings.benchmarking,
    rows,
    runComplianceGate,
    showToast,
  ]);
  const applyServiceReadinessPatch = useCallback((rowId: number, mode: 'core' | 'all') => {
    let nextRows: GoodsRow[] = rows;
    setRows((prev) => {
      nextRows = prev.map((row) => (
        row.id === rowId ? applyServiceReadinessPatchToRow(row, mode) : row
      ));
      return nextRows;
    });
    runComplianceGate(nextRows);
    setDocxReady(nextRows.some((row) => row.status === 'done' && !!row.specs?.length));
    showToast(mode === 'all'
      ? '✅ Сервисные требования и организация оказания услуг автоматически дополнены'
      : '✅ Базовые сервисные требования автоматически дополнены', true);
    focusRow(rowId, true);
  }, [focusRow, rows, runComplianceGate, showToast]);
  const applyServiceReadinessPatchBulk = useCallback((mode: 'core' | 'all') => {
    let touched = 0;
    let nextRows: GoodsRow[] = rows;
    setRows((prev) => {
      nextRows = prev.map((row) => {
        if (row.status !== 'done') return row;
        const nextRow = applyServiceReadinessPatchToRow(row, mode);
        if (nextRow === row) return row;
        touched += 1;
        return nextRow;
      });
      return nextRows;
    });
    if (touched === 0) {
      showToast('ℹ️ Сервисные требования уже заполнены', true);
      return;
    }
    runComplianceGate(nextRows);
    setDocxReady(nextRows.some((row) => row.status === 'done' && !!row.specs?.length));
    showToast(mode === 'all'
      ? `✅ Сервисный контур автоматически дополнен для ${touched} позиций`
      : `✅ Базовые сервисные требования автоматически дополнены для ${touched} позиций`, true);
  }, [rows, runComplianceGate, showToast]);
  const applyLegalReadinessPatch = useCallback((rowId: number) => {
    let changed = false;
    const nextRows = rows.map((row) => {
      if (row.id !== rowId) return row;
      const nextRow = applyLegalReadinessPatchToRow(row);
      if (nextRow !== row) changed = true;
      return nextRow;
    });
    if (!changed) {
      showToast('ℹ️ Для этой позиции нет безопасного юридического автоисправления', false);
      focusRow(rowId, true);
      return;
    }
    setRows(nextRows);
    runComplianceGate(nextRows);
    setDocxReady(nextRows.some((row) => row.status === 'done' && !!row.specs?.length));
    showToast('✅ Неподтвержденное исключение снято, применена базовая мера по режиму', true);
    focusRow(rowId, true);
  }, [focusRow, rows, runComplianceGate, showToast]);
  const applyLegalReadinessPatchBulk = useCallback(() => {
    let touched = 0;
    const nextRows = rows.map((row) => {
      const nextRow = applyLegalReadinessPatchToRow(row);
      if (nextRow !== row) touched += 1;
      return nextRow;
    });
    if (touched === 0) {
      showToast('ℹ️ Неподтвержденных исключений для безопасного автоисправления не найдено', false);
      return;
    }
    setRows(nextRows);
    runComplianceGate(nextRows);
    setDocxReady(nextRows.some((row) => row.status === 'done' && !!row.specs?.length));
    showToast(`✅ Юридический safe-fix применён для ${touched} позиций`, true);
  }, [rows, runComplianceGate, showToast]);
  const applyReadinessSafeAutofix = useCallback(() => {
    let benchmarkTouched = 0;
    let serviceTouched = 0;
    let legalTouched = 0;
    const nextRows = rows.map((row) => {
      let nextRow = row;
      if (shouldApplyLegalReadinessPatch(nextRow)) {
        const patched = applyLegalReadinessPatchToRow(nextRow);
        if (patched !== nextRow) {
          nextRow = patched;
          legalTouched += 1;
        }
      }
      if (enterpriseSettings.benchmarking && nextRow.benchmark && nextRow.specs?.length) {
        const comparison = buildDraftSourceComparison(nextRow.benchmark.sourceSpecs, nextRow.specs, nextRow.type);
        if (comparison.onlySource.length > 0 || comparison.changed.length > 0) {
          nextRow = applyBenchmarkPatchToRow(nextRow, 'all');
          benchmarkTouched += 1;
        }
      }
      if (isServiceCatalogType(nextRow.type) && nextRow.status === 'done' && nextRow.specs?.length) {
        const patched = applyServiceReadinessPatchToRow(nextRow, 'all');
        if (patched !== nextRow) {
          nextRow = patched;
          serviceTouched += 1;
        }
      }
      return nextRow;
    });
    if (benchmarkTouched === 0 && serviceTouched === 0 && legalTouched === 0) {
      showToast('ℹ️ Для safe auto-fix не найдено исправляемых позиций', false);
      return;
    }
    setRows(nextRows);
    runComplianceGate(nextRows);
    setDocxReady(nextRows.some((row) => row.status === 'done' && !!row.specs?.length));
    const summaryParts: string[] = [];
    if (benchmarkTouched > 0) summaryParts.push(`benchmark ${benchmarkTouched}`);
    if (serviceTouched > 0) summaryParts.push(`сервисы ${serviceTouched}`);
    if (legalTouched > 0) summaryParts.push(`юридика ${legalTouched}`);
    showToast(`✅ Safe auto-fix: ${summaryParts.join(', ')}`, true);
  }, [enterpriseSettings.benchmarking, rows, runComplianceGate, showToast]);

  const applyAntiFasAutoFix = useCallback(() => {
    const complianceRows = rows.map((row) => ({
      id: row.id,
      type: row.type,
      model: row.model,
      licenseType: getResolvedCommercialContext(row).suggestedLicenseType,
      term: getResolvedCommercialContext(row).suggestedTerm,
      status: row.status,
      specs: row.specs,
      strictMinSpecs: getMinimumSpecCount(row),
    }));
    const fixes = buildAntiFasAutoFixes(complianceRows);
    if (fixes.length === 0) {
      showToast('ℹ️ Нет автоматически исправимых нарушений Anti-ФАС', false);
      return;
    }
    const rowsToDeleteSpecs = new Set<string>();
    fixes.forEach((f) => {
      if (f.field === 'name' && f.newText === '') {
        rowsToDeleteSpecs.add(`${f.rowId}_${f.specIdx}`);
      }
    });
    const nextRows = rows.map((row) => {
      const rowFixes = fixes.filter((f) => f.rowId === row.id);
      if (rowFixes.length === 0 || !row.specs) return row;
      let specs = row.specs.map((spec, idx) => {
        const fix = rowFixes.find((f) => f.specIdx === idx);
        if (!fix) return spec;
        if (fix.field === 'name' && fix.newText === '') return null;
        return { ...spec, [fix.field]: fix.newText };
      }).filter(Boolean) as typeof row.specs;
      return { ...row, specs };
    });
    setRows(nextRows);
    const report = runComplianceGate(nextRows);
    setDocxReady(nextRows.some((row) => row.status === 'done' && !!row.specs?.length));
    showToast(`✅ Anti-ФАС: исправлено ${fixes.length} нарушений. Score: ${report.score}`, true);
  }, [rows, runComplianceGate, showToast]);

  const handleReadinessIssueAction = useCallback((issue: ReadinessIssue) => {
    if (!issue.actionKind) return;
    if (!issue.rowId && issue.actionKind !== 'benchmark_all' && issue.actionKind !== 'antifas_autofix') return;
    switch (issue.actionKind) {
      case 'focus':
        focusRow(issue.rowId!, true);
        break;
      case 'internet':
        void refreshRowFromSource(issue.rowId!, 'internet');
        break;
      case 'eis':
        void refreshRowFromSource(issue.rowId!, 'eis');
        break;
      case 'classify':
        void refreshRowClassification(issue.rowId!);
        break;
      case 'benchmark_missing':
        applyBenchmarkPatch(issue.rowId!, 'missing');
        focusRow(issue.rowId!, true);
        break;
      case 'benchmark_all':
        applyBenchmarkPatch(issue.rowId!, 'all');
        focusRow(issue.rowId!, true);
        break;
      case 'service_fill_core':
        applyServiceReadinessPatch(issue.rowId!, 'core');
        break;
      case 'service_fill_all':
        applyServiceReadinessPatch(issue.rowId!, 'all');
        break;
      case 'legal_safe_fix':
        applyLegalReadinessPatch(issue.rowId!);
        break;
      case 'antifas_autofix':
        applyAntiFasAutoFix();
        break;
    }
  }, [applyAntiFasAutoFix, applyBenchmarkPatch, applyLegalReadinessPatch, applyServiceReadinessPatch, focusRow, refreshRowClassification, refreshRowFromSource]);

  const exportDocx = async () => {
    if (!ensurePaidFeatureAccess('Пробный период завершён. Оформите Pro Business для экспорта DOCX.')) {
      return;
    }
    if (exportsBlockedByReadiness) {
      const preview = buildReadinessIssuePreview(exportBlockingIssues);
      showToast(`❌ Экспорт DOCX заблокирован: ${preview}`, false);
      appendAutomationLog({
        at: new Date().toISOString(),
        event: 'compliance.readiness.blocked_export_docx',
        ok: false,
        note: preview,
      });
      if (enterpriseSettings.immutableAudit) {
        appendImmutableAudit('compliance.readiness.blocked_export_docx', {
          blockers: exportBlockingIssues.map((issue) => issue.text),
        });
      }
      return;
    }
    const nonAntifasBlockers = readinessGate.blockers.filter((b) => b.key !== 'antifas-critical');
    if (nonAntifasBlockers.length > 0) {
      showToast(`❌ Экспорт DOCX заблокирован: ${buildReadinessIssuePreview(nonAntifasBlockers)}`, false);
      return;
    }
    if (readinessGate.status === 'block') {
      showToast(`⚠️ Anti-ФАС: остались нарушения. Рекомендуется исправить перед публикацией.`, false);
    }
    if (readinessGate.status !== 'ready' && nonAntifasBlockers.length === 0 && readinessGate.warnings.length > 0) {
      showToast(`⚠️ Перед публикацией проверьте: ${buildReadinessIssuePreview(readinessGate.warnings)}`, false);
    }
    const doExport = async () => {
      const blob = await buildDocx(rows, lawMode, readinessGate, enterpriseSettings.benchmarking, platformSettings);

      let finalBlob = blob;
      try {
        const formData = new FormData();
        formData.append('file', new File([blob], 'tz.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
        const resp = await fetch('/api/fix-docx', { method: 'POST', body: formData });
        if (resp.ok) {
          finalBlob = await resp.blob();
        } else {
          console.warn('[DOCX] Backend fix-docx failed, using original blob');
        }
      } catch (e) {
        console.warn('[DOCX] Backend fix-docx unavailable, using original blob', e);
      }

      const date = new Date().toISOString().slice(0, 10);
      const filename = `TZ_${date}.docx`;
      const blobUrl = URL.createObjectURL(finalBlob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.target = '_blank';
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      showToast('DOCX скачивается. Запускаем аудит ТЗ...', true);
      appendAutomationLog({ at: new Date().toISOString(), event: 'react.export_docx', ok: true });

      // Сохранить генерацию в историю (fire-and-forget, только для авторизованных)
      if (isLoggedIn()) {
        void (async () => {
          try {
            const tzText = buildTzTextForReview();
            const reader = new FileReader();
            const base64: string = await new Promise((resolve, reject) => {
              reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
              reader.onerror = reject;
              reader.readAsDataURL(finalBlob);
            });
            const firstRow = rows.find((r) => r.status === 'done');
            const title = (firstRow?.model || firstRow?.type || tzText.slice(0, 80) || 'ТЗ').slice(0, 80);
            await saveGeneration({
              title,
              source_type: 'text',
              text: tzText,
              docx_base64: base64,
              word_count: tzText.split(/\s+/).filter(Boolean).length,
            });
          } catch (e) {
            console.warn('[History] Failed to save generation:', e);
          }
        })();
      }

      // Автоматический аудит ТЗ после экспорта
      setAuditLoading(true);
      setAuditResult(null);
      (async () => {
        try {
          const auditForm = new FormData();
          auditForm.append('file', new File([finalBlob], 'tz.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
          auditForm.append('law_mode', lawMode);
          const auditResp = await fetch('/api/audit-tz', { method: 'POST', body: auditForm });
          if (auditResp.ok) {
            const auditData = await auditResp.json() as { report: string; verdict: string; pass_count: number; fail_count: number };
            setAuditResult(auditData);
            setShowAuditModal(true);
          } else {
            console.warn('[Audit] /api/audit-tz returned', auditResp.status);
          }
        } catch (e) {
          console.warn('[Audit] Аудит недоступен:', e);
        } finally {
          setAuditLoading(false);
        }
      })();
    };

    try {
      await doExport();
    } catch (e) {
      console.error('[DOCX] Export failed:', e);
      alert(e instanceof Error ? e.message : 'Ошибка экспорта DOCX');
    }
  };

  const exportPdf = async () => {
    if (!ensurePaidFeatureAccess('Пробный период завершён. Оформите Pro Business для экспорта PDF.')) {
      return;
    }
    if (exportsBlockedByReadiness) {
      const preview = buildReadinessIssuePreview(exportBlockingIssues);
      showToast(`❌ Экспорт PDF заблокирован: ${preview}`, false);
      appendAutomationLog({
        at: new Date().toISOString(),
        event: 'compliance.readiness.blocked_export_pdf',
        ok: false,
        note: preview,
      });
      if (enterpriseSettings.immutableAudit) {
        appendImmutableAudit('compliance.readiness.blocked_export_pdf', {
          blockers: exportBlockingIssues.map((issue) => issue.text),
        });
      }
      return;
    }
    const nonAntifasBlockersPdf = readinessGate.blockers.filter((b) => b.key !== 'antifas-critical');
    if (nonAntifasBlockersPdf.length > 0) {
      showToast(`❌ Экспорт PDF заблокирован: ${buildReadinessIssuePreview(nonAntifasBlockersPdf)}`, false);
      return;
    }
    if (readinessGate.status === 'block') {
      showToast(`⚠️ Anti-ФАС: остались нарушения. Рекомендуется исправить перед публикацией.`, false);
    }
    if (readinessGate.status !== 'ready' && nonAntifasBlockersPdf.length === 0 && readinessGate.warnings.length > 0) {
      showToast(`⚠️ Перед публикацией проверьте: ${buildReadinessIssuePreview(readinessGate.warnings)}`, false);
    }
    const done = rows.filter((r) => r.status === 'done' && r.specs);
    if (done.length === 0) {
      alert('Нет готовых позиций для экспорта');
      return;
    }

    const { jsPDF } = await import('jspdf');
    const docSections = buildDocumentSectionBundle(done, lawMode, readinessGate, enterpriseSettings.benchmarking, platformSettings);
    const doc = new jsPDF({ unit: 'pt', format: 'a4', putOnlyUsedFonts: true });
    const margin = 42;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    const addPage = () => {
      doc.addPage();
      y = margin;
    };

    const ensureSpace = (height: number, repeatHeader?: () => void) => {
      if (y + height > pageHeight - margin) {
        addPage();
        repeatHeader?.();
      }
    };

    const setFont = (bold = false, size = 10) => {
      doc.setFont('times', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
    };

    const addCenteredBlock = (text: string, opts: { bold?: boolean; size?: number; gap?: number } = {}) => {
      setFont(opts.bold ?? false, opts.size ?? 12);
      const lines = doc.splitTextToSize(text, contentWidth - 40) as string[];
      for (const line of lines) {
        ensureSpace((opts.size ?? 12) + 6);
        doc.text(line, pageWidth / 2, y, { align: 'center' });
        y += (opts.size ?? 12) + 4;
      }
      y += opts.gap ?? 4;
    };

    const addRightAlignedBlock = (text: string, width = 220, opts: { bold?: boolean; size?: number; gap?: number } = {}) => {
      setFont(opts.bold ?? false, opts.size ?? 10);
      const lines = doc.splitTextToSize(text, width) as string[];
      const lineHeight = (opts.size ?? 10) + 3;
      for (const line of lines) {
        ensureSpace(lineHeight);
        doc.text(line, pageWidth - margin, y, { align: 'right' });
        y += lineHeight;
      }
      y += opts.gap ?? 3;
    };

    const addParagraph = (text: string, opts: { bold?: boolean; size?: number; gap?: number } = {}) => {
      setFont(opts.bold ?? false, opts.size ?? 10);
      const lines = doc.splitTextToSize(text, contentWidth) as string[];
      const lineHeight = (opts.size ?? 10) + 3;
      for (const line of lines) {
        ensureSpace(lineHeight);
        doc.text(line, margin, y);
        y += lineHeight;
      }
      y += opts.gap ?? 4;
    };

    const drawTable = (
      headers: string[],
      rowsData: string[][],
      ratios: number[],
      opts: { fontSize?: number; headerSize?: number; align?: ('left' | 'center')[] } = {},
    ) => {
      const fontSize = opts.fontSize ?? 9;
      const headerSize = opts.headerSize ?? fontSize;
      const paddingX = 4;
      const paddingY = 4;
      const lineHeight = fontSize + 2;
      const total = ratios.reduce((sum, value) => sum + value, 0);
      const widths = ratios.map((value) => (value / total) * contentWidth);

      const drawHeader = () => {
        setFont(true, headerSize);
        const headerLines = headers.map((header, idx) => doc.splitTextToSize(header, Math.max(widths[idx] - paddingX * 2, 20)) as string[]);
        const rowHeight = Math.max(...headerLines.map((lines) => lines.length)) * (headerSize + 1) + paddingY * 2;
        ensureSpace(rowHeight);
        let x = margin;
        doc.setFillColor(31, 92, 139);
        doc.setDrawColor(160, 174, 192);
        for (let i = 0; i < headers.length; i++) {
          doc.rect(x, y, widths[i], rowHeight, 'FD');
          doc.setTextColor(255, 255, 255);
          const startY = y + paddingY + headerSize;
          headerLines[i].forEach((line, lineIdx) => {
            doc.text(line, x + widths[i] / 2, startY + lineIdx * (headerSize + 1), { align: 'center' });
          });
          x += widths[i];
        }
        doc.setTextColor(0, 0, 0);
        y += rowHeight;
      };

      drawHeader();
      for (const rowData of rowsData) {
        setFont(false, fontSize);
        const cellLines = rowData.map((cell, idx) => doc.splitTextToSize(String(cell || '—'), Math.max(widths[idx] - paddingX * 2, 20)) as string[]);
        const rowHeight = Math.max(...cellLines.map((lines) => lines.length)) * lineHeight + paddingY * 2;
        ensureSpace(rowHeight, drawHeader);
        let x = margin;
        doc.setDrawColor(160, 174, 192);
        for (let i = 0; i < rowData.length; i++) {
          doc.rect(x, y, widths[i], rowHeight);
          const cellAlign = opts.align?.[i] ?? 'left';
          const textX = cellAlign === 'center' ? x + widths[i] / 2 : x + paddingX;
          const textY = y + paddingY + fontSize;
          cellLines[i].forEach((line, lineIdx) => {
            doc.text(line, textX, textY + lineIdx * lineHeight, { align: cellAlign });
          });
          x += widths[i];
        }
        y += rowHeight;
      }
      y += 10;
    };

    const drawSpecsTable = (row: GoodsRow) => {
      const g = lookupCatalog(row.type);
      const specs = [...(row.specs ?? [])];
      void g;

      const colRatios = [4.2, 4.2, 1.3];
      const total = colRatios.reduce((sum, value) => sum + value, 0);
      const widths = colRatios.map((value) => (value / total) * contentWidth);
      const paddingX = 4;
      const paddingY = 4;
      const fontSize = 8.8;
      const lineHeight = fontSize + 2;

      const drawHeader = () => {
        setFont(true, 9.2);
        const headers = ['Наименование характеристики', 'Значение характеристики', 'Ед. изм.'];
        const headerLines = headers.map((header, idx) => doc.splitTextToSize(header, Math.max(widths[idx] - paddingX * 2, 20)) as string[]);
        const rowHeight = Math.max(...headerLines.map((lines) => lines.length)) * 10 + paddingY * 2;
        ensureSpace(rowHeight);
        let x = margin;
        doc.setFillColor(31, 92, 139);
        doc.setDrawColor(160, 174, 192);
        headers.forEach((_header, idx) => {
          doc.rect(x, y, widths[idx], rowHeight, 'FD');
          doc.setTextColor(255, 255, 255);
          headerLines[idx].forEach((line, lineIdx) => {
            doc.text(line, x + widths[idx] / 2, y + paddingY + 9.2 + lineIdx * 10, { align: 'center' });
          });
          x += widths[idx];
        });
        doc.setTextColor(0, 0, 0);
        y += rowHeight;
      };

      drawHeader();
      let currentGroup = '';
      for (const spec of specs) {
        if (spec.group && spec.group !== currentGroup) {
          currentGroup = spec.group;
          setFont(true, 9);
          const groupLines = doc.splitTextToSize(currentGroup, contentWidth - paddingX * 2) as string[];
          const groupHeight = groupLines.length * 10 + paddingY * 2;
          ensureSpace(groupHeight, drawHeader);
          doc.setFillColor(219, 234, 254);
          doc.setDrawColor(160, 174, 192);
          doc.rect(margin, y, contentWidth, groupHeight, 'FD');
          groupLines.forEach((line, lineIdx) => {
            doc.text(line, margin + contentWidth / 2, y + paddingY + 9 + lineIdx * 10, { align: 'center' });
          });
          y += groupHeight;
        }

        setFont(false, fontSize);
        const rowData = [
          String(spec.name ?? '—'),
          `${String(spec.value ?? '—')}${spec._warning ? ` ⚠ ${String(spec._warning)}` : ''}`,
          String(spec.unit ?? ''),
        ];
        const cellLines = rowData.map((cell, idx) => doc.splitTextToSize(cell, Math.max(widths[idx] - paddingX * 2, 20)) as string[]);
        const rowHeight = Math.max(...cellLines.map((lines) => lines.length)) * lineHeight + paddingY * 2;
        ensureSpace(rowHeight, drawHeader);
        let x = margin;
        doc.setDrawColor(160, 174, 192);
        rowData.forEach((_cell, idx) => {
          doc.rect(x, y, widths[idx], rowHeight);
          const textX = idx === 2 ? x + widths[idx] / 2 : x + paddingX;
          const align = idx === 2 ? 'center' : 'left';
          cellLines[idx].forEach((line, lineIdx) => {
            doc.text(line, textX, y + paddingY + fontSize + lineIdx * lineHeight, { align });
          });
          x += widths[idx];
        });
        y += rowHeight;
      }
      y += 10;
    };

    {
      const pdfApprovalOrg = platformSettings?.orgNameShort?.trim() || platformSettings?.orgName?.trim() || '';
      const pdfApprovalTitle = platformSettings?.approvalPersonTitle?.trim() || '';
      const pdfApprovalName = platformSettings?.approvalPersonName?.trim() || '';
      addRightAlignedBlock('УТВЕРЖДАЮ', 240, { bold: true, size: 10.5, gap: 2 });
      if (pdfApprovalOrg) addRightAlignedBlock(pdfApprovalOrg, 240, { size: 9.5, gap: 1 });
      addRightAlignedBlock(pdfApprovalTitle || '________________________________', 240, { size: 10, gap: 1 });
      addRightAlignedBlock(pdfApprovalName ? `_____________ / ${pdfApprovalName} /` : '_____________ / _______________ /', 240, { size: 10, gap: 2 });
      addRightAlignedBlock(`«___» _______ ${docSections.currentYear} г.`, 160, { size: 10, gap: 10 });
    }

    addCenteredBlock('Техническое задание', { bold: true, size: 16, gap: 4 });
    addCenteredBlock(`${docSections.serviceOnly ? 'на оказание' : 'на поставку'} ${docSections.objectName}`, { size: 12, gap: 12 });

    const drawSectionParas = (rows: Array<{ label: string; value: string }>) => {
      for (const row of rows) {
        addParagraph(`${row.label}. ${row.value}`, { size: 9.5, gap: 3 });
      }
    };

    addParagraph('1. Наименование, Заказчик, Исполнитель, сроки выполнения', { bold: true, size: 12, gap: 6 });
    drawSectionParas(docSections.section1Rows);

    if (docSections.multi) {
      if (done.length > 5) addPage();
      drawTable(
        docSections.showCommercialTerms
          ? ['№', 'Наименование', 'Тип лицензии', 'Срок действия', 'Кол-во', 'ОКПД2', 'Прил. №']
          : ['№', 'Наименование', 'Кол-во', 'ОКПД2', 'Прил. №'],
        done.map((row, idx) => {
          const commercial = getResolvedCommercialContext(row);
          return docSections.showCommercialTerms
            ? [
                String(idx + 1),
                getRowDisplayLabel(row),
                getCommercialValue(commercial.suggestedLicenseType),
                getCommercialValue(commercial.suggestedTerm),
                `${row.qty} ${getRowQtyUnitShort(row)}`,
                getResolvedOkpd2Code(row) || '—',
                `Прил. ${idx + 1}`,
              ]
            : [
                String(idx + 1),
                getRowDisplayLabel(row),
                `${row.qty} ${getRowQtyUnitShort(row)}`,
                getResolvedOkpd2Code(row) || '—',
                `Прил. ${idx + 1}`,
              ];
        }),
        docSections.showCommercialTerms ? [0.45, 3.35, 1.75, 1.15, 0.8, 1.45, 1.05] : [0.5, 5.6, 1.0, 1.55, 1.15],
        {
          fontSize: 7.9,
          headerSize: 8.2,
          align: docSections.showCommercialTerms
            ? ['center', 'left', 'left', 'center', 'center', 'center', 'center']
            : ['center', 'left', 'center', 'center', 'center'],
        },
      );
    }

    addParagraph('2. Требования к предмету закупки', { bold: true, size: 12, gap: 6 });
    drawSectionParas(docSections.section2Rows);

    addParagraph(docSections.section3Title, { bold: true, size: 12, gap: 6 });
    drawSectionParas(docSections.section3Rows);

    addParagraph(docSections.section4Title, { bold: true, size: 12, gap: 6 });
    drawSectionParas(docSections.section4Rows);

    addParagraph(docSections.section5Title, { bold: true, size: 12, gap: 6 });
    drawSectionParas(docSections.section5Rows);

    addParagraph(docSections.section6Title, { bold: true, size: 12, gap: 6 });
    drawSectionParas(docSections.section6Rows);

    if (docSections.section7Rows && docSections.section7Rows.length > 0) {
      addParagraph(docSections.section7Title ?? '7. Перечень нормативных правовых актов', { bold: true, size: 12, gap: 6 });
      drawSectionParas(docSections.section7Rows);
    }

    done.forEach((row, idx) => {
      addPage();
      const g = lookupCatalog(row.type);
      const commercial = getResolvedCommercialContext(row);
      const appendixTitle = docSections.multi ? `Приложение ${idx + 1}` : 'Приложение 1';
      addCenteredBlock(appendixTitle, { bold: true, size: 13, gap: 3 });
      addCenteredBlock(`${getRowDisplayLabel(row)} — ${row.qty} ${getRowQtyUnitShort(row)}`, { bold: true, size: 11, gap: 2 });
      const caption = [commercial.suggestedLicenseType, commercial.suggestedTerm].filter(Boolean).join(' / ');
      if (caption) addCenteredBlock(caption, { size: 10, gap: 8 });
      addParagraph(
        docSections.serviceOnly
          ? 'Требования к составу, порядку оказания и результату услуг'
          : (g.isSoftware
            ? 'Требования к техническим характеристикам программного обеспечения'
            : 'Требования к техническим характеристикам поставляемого товара'),
        { bold: true, size: 11, gap: 6 },
      );
      drawSpecsTable(row);
    });

    ensureSpace(42);
    {
      const pdfSigTitle = platformSettings?.approvalPersonTitle?.trim() || 'Специалист';
      const pdfSigName = platformSettings?.approvalPersonName?.trim() || '';
      addParagraph(`${pdfSigTitle} ___________________________ ${pdfSigName ? `/ ${pdfSigName} /` : ''}`, { size: 10, gap: 4 });
    }
    addParagraph(`«____» _______________ ${docSections.currentYear} г.                                     _______________`, { size: 10, gap: 0 });

    const date = new Date().toISOString().slice(0, 10);
    doc.save(`TZ_${date}.pdf`);
    appendAutomationLog({ at: new Date().toISOString(), event: 'react.export_pdf', ok: true });
  };

  const showEntryScreen = !entryDismissed && rows.length <= 1 && rows[0]?.status === 'idle' && !rows[0]?.model && !rows[0]?.specs?.length;

  const processSteps = useMemo(() => {
    const hasData = rows.some(r => r.model || (r.specs && r.specs.length > 0));
    const hasSpecs = rows.some(r => r.status === 'done' && r.specs && r.specs.length > 0);
    const isReviewing = showReviewPanel;
    const isReadyToPublish = hasSpecs && readinessGate.status === 'ready';

    let activeStep = 'input';
    if (hasSpecs) activeStep = 'specs';
    if (hasSpecs && docxReady) activeStep = 'tz';
    if (isReviewing || isReadyToPublish) activeStep = 'review';

    return [
      {
        key: 'input',
        label: 'Исходные данные',
        sublabel: hasData ? `${rows.length} поз.` : 'Файл или тип товара',
        done: hasData,
        active: activeStep === 'input',
      },
      {
        key: 'specs',
        label: 'Характеристики',
        sublabel: hasSpecs ? `${readyRowsCount} готово` : 'Генерация ТЗ',
        done: hasSpecs,
        active: activeStep === 'specs',
      },
      {
        key: 'tz',
        label: 'Техническое задание',
        sublabel: docxReady ? 'Документ собран' : 'DOCX / PDF',
        done: docxReady,
        active: activeStep === 'tz',
      },
      {
        key: 'review',
        label: 'Проверка',
        sublabel: isReadyToPublish ? 'Готово' : 'ФАС-контроль',
        done: isReadyToPublish,
        active: activeStep === 'review',
      },
    ];
  }, [rows, readyRowsCount, showReviewPanel, readinessGate.status, docxReady]);

  const handleEntryDocx = useCallback(() => {
    setEntryDismissed(true);
    setTimeout(() => importFileInputRef.current?.click(), 100);
  }, []);

  const handleEntryManual = useCallback(() => {
    setEntryDismissed(true);
  }, []);

  const handleEntryTemplate = useCallback(() => {
    setEntryDismissed(true);
  }, []);

  const handleEntryRepair = useCallback(() => {
    setTimeout(() => repairFileInputRef.current?.click(), 100);
  }, []);

  const handleRepairFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      showToast('Поддерживается только формат .docx', false);
      return;
    }
    setRepairLoading(true);
    setRepairResult(null);
    showToast('AI анализирует документ на нарушения 44-ФЗ/223-ФЗ…', true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('law_mode', lawMode);
      const resp = await fetch('/api/ai-repair-docx', { method: 'POST', body: formData });
      if (!resp.ok) {
        const detail = await resp.json().catch(() => ({ detail: 'Ошибка сервера' }));
        showToast(`Ошибка: ${detail.detail ?? 'не удалось обработать файл'}`, false);
        return;
      }
      const data = await resp.json();
      setRepairResult(data);
      showToast(
        data.violation_count > 0
          ? `AI нашёл ${data.violation_count} нарушений — исправлено`
          : 'AI проверил документ — нарушений не обнаружено',
        true,
      );
    } catch {
      showToast('Не удалось подключиться к серверу. Проверьте соединение.', false);
    } finally {
      setRepairLoading(false);
    }
  }, [showToast, lawMode]);

  return (
    <section className="panel">
      {/* Toast-уведомление */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 9999,
          background: toast.ok ? '#065F46' : '#7F1D1D',
          color: '#fff', padding: '12px 20px', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)', fontSize: 14, maxWidth: 360,
          animation: 'fadeIn 0.2s ease',
        }}>
          {toast.msg}
        </div>
      )}

      <ProcessStepper steps={processSteps} />

      {showEntryScreen ? (
        <>
          <EntryChoice
            onChooseDocx={handleEntryDocx}
            onChooseManual={handleEntryManual}
            onChooseTemplate={handleEntryTemplate}
            onChooseRepair={handleEntryRepair}
            lawMode={lawMode}
            onLawModeChange={setLawMode}
          />
          <input
            ref={importFileInputRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.docx"
            multiple
            style={{ display: 'none' }}
            onChange={(event) => {
              const files = event.target.files;
              if (files && files.length > 0) void handleImportMultipleFiles(files);
              event.currentTarget.value = '';
            }}
          />
          <input
            ref={repairFileInputRef}
            type="file"
            accept=".docx"
            style={{ display: 'none' }}
            onChange={handleRepairFileSelected}
          />
        </>
      ) : (
      <>
      <div className="workspace-header">
        <div>
          <h2 className="workspace-title-main">Сборка ТЗ</h2>
          <p className="workspace-lead">
            {!hasPublicationBaseline
              ? 'Добавьте позиции и запустите генерацию характеристик'
              : 'Проверьте характеристики и скачайте документ'}
          </p>
        </div>
        <div className="workspace-kpis" aria-label="Сводка рабочей области">
          <span className="workspace-kpi-chip">
            <strong>{draftedRowsCount}</strong>
            <span>в работе</span>
          </span>
          <span className="workspace-kpi-chip">
            <strong>{readyRowsCount}</strong>
            <span>готово</span>
          </span>
          <span className={`workspace-kpi-chip workspace-kpi-chip--${publicationStatusTone}`}>
            <strong>{visibleReadinessBlockers}</strong>
            <span>{publicationStatusLabel}</span>
          </span>
          <span className="workspace-kpi-chip">
            <strong>{serviceRowsCount}</strong>
            <span>услуги</span>
          </span>
        </div>
      </div>

      <div className="workspace-mode-switch" role="group" aria-label="Режим закона">
        <button
          type="button"
          className={`workspace-mode-btn ${lawMode === '44' ? 'is-active' : ''}`}
          onClick={() => setLawMode('44')}
          aria-pressed={lawMode === '44'}
        >
          44-ФЗ
        </button>
        <button
          type="button"
          className={`workspace-mode-btn ${lawMode === '223' ? 'is-active' : ''}`}
          onClick={() => setLawMode('223')}
          aria-pressed={lawMode === '223'}
        >
          223-ФЗ
        </button>
      </div>

      <div className="workspace-progress-strip">
        {mutation.isPending && generationProgress && (
          <div
            className="workspace-gen-progress-bar"
            style={{ '--gen-pct': `${Math.round((generationProgress.current / generationProgress.total) * 100)}%` } as React.CSSProperties}
            aria-label={`Прогресс генерации: ${generationProgress.current} из ${generationProgress.total}`}
          />
        )}
        <div className="workspace-progress-copy">
          <span className={`workspace-status-badge workspace-status-badge--${publicationStatusTone}`}>
            {publicationStatusLabel}
          </span>
          <div className="workspace-progress-main">
            <strong>
              {mutation.isPending && generationProgress
                ? `Генерация ${generationProgress.current} / ${generationProgress.total} позиций · пакет ${generationProgress.batchIndex}/${generationProgress.totalBatches}`
                : !hasPublicationBaseline
                  ? `${draftedRowsCount || rows.length} позиций загружено — генерация ещё не запускалась`
                  : `${readyRowsCount} / ${draftedRowsCount || rows.length} позиций готовы к публикационному контуру`}
            </strong>
            <span>{mutation.isPending && generationProgress ? `Пакетная обработка, размер пакета: ${generationProgress.batchSize} позиций — ${Math.round((generationProgress.current / generationProgress.total) * 100)}% завершено` : publicationLeadText}</span>
          </div>
        </div>
        <div className="workspace-progress-actions">
          {hasPublicationBaseline ? (
            <>
              <span className="workspace-mini-chip is-block">Блокеры: {visibleReadinessBlockers}</span>
              <span className="workspace-mini-chip is-warn">Предупреждения: {visibleReadinessWarnings}</span>
            </>
          ) : (
            <span className="workspace-mini-chip">Следующий шаг: сгенерировать ТЗ</span>
          )}
          {hasPublicationBaseline && publicationAutopilotActions.totalRows > 0 && (
            <button
              type="button"
              onClick={() => void runPublicationAutopilot()}
              disabled={paymentRequired || publicationAutopilotRunning || !!rowActionState}
              className="workspace-progress-primary"
            >
              {publicationAutopilotRunning ? 'Исправляю...' : `Исправить (${publicationAutopilotActions.totalRows})`}
            </button>
          )}
        </div>
      </div>

      <div className="workspace-layout">
        <div className="workspace-primary">

      <div className="workspace-side-card workspace-composer-card">
        <div className="workspace-side-head">
          <div>
            <div className="micro-label">Позиции закупки</div>
            <strong>Добавьте товары и услуги</strong>
          </div>
          <span className="workspace-side-meta">{lawMode}-ФЗ · {catalogMode === 'general' ? 'все категории' : 'ИТ'}</span>
        </div>
        <div className="workspace-chip-row workspace-chip-row--dense">
          <span className="workspace-mini-chip">Позиций: {rows.length}</span>
          <span className="workspace-mini-chip">Готово: {readyRowsCount}</span>
          {serviceRowsCount > 0 && <span className="workspace-mini-chip">Услуги: {serviceRowsCount}</span>}
          <span className={`workspace-mini-chip ${canUseAiAssist ? '' : 'is-warn'}`}>
            {canUseAiAssist ? 'ИИ подключён' : 'ИИ недоступен — войдите'}
          </span>
        </div>
        <div className="workspace-composer-stack">
          <div className="workspace-catalog-switch">
            <button
              type="button"
              onClick={() => setCatalogMode('it')}
              className={`workspace-catalog-btn ${catalogMode === 'it' ? 'is-active is-it' : ''}`}
            >
              <span className="workspace-catalog-tag">IT</span>
              ИТ-оборудование и ПО
              <span className="workspace-catalog-count">({Object.keys(GOODS_CATALOG).length})</span>
            </button>
            <button
              type="button"
              onClick={() => setCatalogMode('general')}
              className={`workspace-catalog-btn ${catalogMode === 'general' ? 'is-active is-general' : ''}`}
            >
              <span className="workspace-catalog-tag workspace-catalog-tag--general">UNV</span>
              Любой товар
              <span className="workspace-catalog-count">({Object.keys(GENERAL_CATALOG).length})</span>
            </button>
          </div>
          <div className="workspace-inline-note">
            Выберите категорию из каталога или добавьте свой товар. В поле «Модель/описание» укажите пример — он используется только для подбора характеристик и <strong>не попадёт в текст ТЗ</strong>.
          </div>
          <div className="workspace-chip-row workspace-chip-row--dense">
            <button type="button" className="workspace-quick-add" onClick={() => addRowWithType('otherGoods')}>+ Свой товар</button>
            <button type="button" className="workspace-quick-add" onClick={() => addRowWithType('otherService')}>+ Своя услуга</button>
          </div>
        </div>
        {false && (<div className="workspace-template-planner">
          <div className="workspace-side-head workspace-side-head--split">
            <div>
              <div className="micro-label">Быстрый старт</div>
              <strong>Шаблоны типовых закупок</strong>
            </div>
            <span className="workspace-side-meta">{suggestedTemplatePacks.length} типовых · {customTemplates.length} своих</span>
          </div>
          <div className="workspace-inline-note">
            Профиль <strong>{templatePresetMeta.label}</strong> уже учитывается в генерации. Здесь можно быстро загрузить типовой набор позиций и сохранить свой рабочий шаблон команды.
          </div>
          <div className="workspace-chip-row workspace-chip-row--dense workspace-chip-row--split-summary">
            <span className="workspace-mini-chip">Профиль: {templatePresetMeta.shortLabel}</span>
            <span className="workspace-mini-chip">Свои шаблоны: {customTemplates.length}</span>
          </div>
          <div className="workspace-split-toolbar">
            <button
              type="button"
              className="row-detail-toggle"
              onClick={() => setTemplateLibraryOpen((open) => !open)}
            >
              {templateLibraryOpen ? 'Скрыть библиотеку шаблонов' : `Показать библиотеку шаблонов (${suggestedTemplatePacks.length + customTemplates.length})`}
            </button>
            <button type="button" onClick={saveCurrentDraftAsTemplate}>
              Сохранить набор как шаблон
            </button>
          </div>
          {templateLibraryOpen ? (
            <>
              <div className="workspace-template-section">
                <div className="micro-label">Рекомендуемые наборы</div>
                <div className="workspace-template-grid">
                  {suggestedTemplatePacks.map((template) => (
                    <div key={template.id} className="workspace-template-card">
                      <div className="workspace-template-card-head">
                        <strong>{template.name}</strong>
                        <span>{template.rows.length} поз.</span>
                      </div>
                      <div className="workspace-template-card-copy">{template.description}</div>
                      <div className="workspace-template-card-tags">
                        {template.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="workspace-mini-chip">{tag}</span>
                        ))}
                      </div>
                      <div className="workspace-template-actions">
                        <button type="button" className="row-detail-toggle" onClick={() => applyTemplatePack(template, 'replace')}>Загрузить</button>
                        <button type="button" className="row-inline-action" onClick={() => applyTemplatePack(template, 'append')}>Добавить</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {customTemplates.length > 0 ? (
                <div className="workspace-template-section">
                  <div className="micro-label">Сохранённые шаблоны команды</div>
                  <div className="workspace-template-grid">
                    {customTemplates.map((template) => (
                      <div key={template.id} className="workspace-template-card workspace-template-card--custom">
                        <div className="workspace-template-card-head">
                          <strong>{template.name}</strong>
                          <span>{template.rows.length} поз.</span>
                        </div>
                        <div className="workspace-template-card-copy">
                          {template.description || 'Пользовательский шаблон организации'}
                          <br />
                          <span className="muted">Обновлён: {new Date(template.updatedAt).toLocaleDateString('ru-RU')}</span>
                        </div>
                        <div className="workspace-template-actions">
                          <button type="button" className="row-detail-toggle" onClick={() => applyTemplatePack(template, 'replace')}>Загрузить</button>
                          <button type="button" className="row-inline-action" onClick={() => applyTemplatePack(template, 'append')}>Добавить</button>
                          <button type="button" className="danger-btn row-delete-inline" onClick={() => removeCustomTemplate(template.id, template.name)}>Удалить</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>)}
        <div className="workspace-action-grid workspace-action-grid--toolbar">
          <button type="button" onClick={addRow}>+ Добавить позицию</button>
          <button type="button" onClick={() => importFileInputRef.current?.click()}>📥 Загрузить файлы</button>
          {uiPhase === 'ready' && (
            <button type="button" onClick={resetWorkspaceDraft}>↺ Начать заново</button>
          )}
          <input
            ref={importFileInputRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.docx"
            multiple
            style={{ display: 'none' }}
            onChange={(event) => {
              const files = event.target.files;
              if (files && files.length > 0) void handleImportMultipleFiles(files);
              event.currentTarget.value = '';
            }}
          />
          {uiPhase !== 'ready' && (
            <button
              type="button"
              disabled={paymentRequired || !canGenerate || mutation.isPending || (!canUseAiAssist && !canRunGenerationWithoutAi) || publicationAutopilotRunning}
              onClick={() => (canUseAiAssist || canRunGenerationWithoutAi) ? mutation.mutate({ trigger: 'manual' }) : undefined}
              style={{ background: !paymentRequired && canGenerate && !mutation.isPending && (canUseAiAssist || canRunGenerationWithoutAi) && !publicationAutopilotRunning ? '#1F5C8B' : undefined, color: !paymentRequired && canGenerate && !mutation.isPending && (canUseAiAssist || canRunGenerationWithoutAi) && !publicationAutopilotRunning ? '#fff' : undefined }}
              title={paymentRequired
                ? 'Trial завершён: оформите тарифный план'
                : !canUseAiAssist && !canRunGenerationWithoutAi
                  ? 'Требуется вход для генерации ТЗ'
                  : 'Сгенерировать технические характеристики для каждой позиции'}
            >
              {mutation.isPending && generationProgress
                ? `Генерация ${generationProgress.current} / ${generationProgress.total}`
                : mutation.isPending
                  ? 'Генерация...'
                  : publicationAutopilotRunning
                    ? 'Автодоводка...'
                    : paymentRequired
                      ? 'Trial завершён'
                    : !canUseAiAssist && !canRunGenerationWithoutAi
                      ? 'Нет доступа к AI'
                      : !canUseAiAssist && canRunGenerationWithoutAi
                        ? '▶ Подготовить из файла'
                      : '▶ Сгенерировать ТЗ'}
            </button>
          )}
          {uiPhase === 'working' && null}
        </div>
        {docxReady && !paymentRequired && !publicationAutopilotRunning && (
          <div className="workspace-review-cta">
            <button
              type="button"
              className="workspace-review-btn"
              onClick={() => {
                setShowReviewPanel(true);
              }}
            >
              🔍 Проверить ТЗ
            </button>
            <span className="workspace-review-hint">
              Экспертная проверка на ФАС-риски, юридические и технические ошибки по {lawMode}-ФЗ
            </span>
          </div>
        )}
        {false && splitFeatureVisible && (
          <div className="workspace-split-planner">
            <div className="workspace-side-head workspace-side-head--split">
              <div>
                <div className="micro-label">Split</div>
                <strong>Разделить файл на отдельные ТЗ</strong>
              </div>
              <span className="workspace-side-meta">{splitGroups.length} групп</span>
            </div>
            <div className="workspace-inline-note">
              Это необязательно. Если нужен один общий документ, просто игнорируйте этот блок. Разделение пригодится только когда хотите быстро вынести, например, ПО, серверы или услуги в отдельные ТЗ.
            </div>
            <div className="workspace-chip-row workspace-chip-row--dense workspace-chip-row--split-summary">
              {splitGroups.slice(0, 5).map((group) => (
                <span
                  key={group.key}
                  className={`workspace-mini-chip ${activeSplitGroupKey === group.key ? 'is-ready' : ''}`}
                >
                  {group.label}: {group.count}
                </span>
              ))}
              {splitGroups.length > 5 ? (
                <span className="workspace-mini-chip">+ ещё {splitGroups.length - 5}</span>
              ) : null}
            </div>
            <div className="workspace-split-toolbar">
              <button
                type="button"
                className="row-detail-toggle"
                onClick={() => setSplitPlannerOpen((open) => !open)}
              >
                {splitPlannerOpen ? 'Скрыть варианты разбиения' : `Показать варианты разбиения (${splitGroups.length})`}
              </button>
              {splitSourceRows?.length ? (
                <button type="button" onClick={restoreSplitGroupsSource}>
                  ↩️ Вернуть полный список
                </button>
              ) : null}
            </div>
            {splitPlannerOpen ? (
              <>
                <div className="workspace-split-grid">
                  {splitGroups.map((group) => (
                    <div
                      key={group.key}
                      className={`workspace-split-card ${activeSplitGroupKey === group.key ? 'is-active' : ''}`}
                    >
                      <div className="workspace-split-card-head">
                        <strong>{group.title}</strong>
                        <span>{group.count} поз.</span>
                      </div>
                      <div className="workspace-split-card-copy">{group.preview || 'Без явного примера позиции'}</div>
                      <button
                        type="button"
                        className="row-detail-toggle"
                        onClick={() => openSplitGroup(group.key)}
                      >
                        {activeSplitGroupKey === group.key ? 'Открыто в работе' : 'Открыть как отдельное ТЗ'}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="workspace-action-grid workspace-action-grid--toolbar workspace-action-grid--split">
                  <button
                    type="button"
                    onClick={() => void saveSplitGroupsLocally()}
                    disabled={paymentRequired || splitSaving}
                  >
                    {splitSaving ? '⏳ Сохраняю группы...' : `🗂️ Сохранить ${splitGroups.length} отдельных ТЗ`}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}
        <div className="workspace-side-note">
          Сначала задайте позиции, затем при необходимости доберите внешний источник или классификацию. Правая колонка оставлена только для готовности к публикации и выгрузки.
        </div>
        {false && <div className="workspace-auth-shell workspace-auth-shell--embedded">
          <button
            type="button"
            className="workspace-auth-toggle"
            onClick={() => setAuthPanelOpen((v) => !v)}
            aria-expanded={authPanelOpen}
          >
            <span className="workspace-auth-toggle-title">
              <span className={`workspace-auth-dot ${backendUser ? 'is-backend' : 'is-local'}`} aria-hidden="true"></span>
              Доступ и лимиты
            </span>
            <span className="workspace-auth-toggle-meta">
              {backendUser ? (backendUser.role === 'pro' || backendUser.role === 'admin' ? 'Pro' : backendUser.payment_required ? 'Оплата нужна' : backendUser.trial_active ? 'Trial' : 'Trial') : 'Требуется вход'}
            </span>
            <span className={`workspace-auth-toggle-chevron ${authPanelOpen ? 'open' : ''}`} aria-hidden="true">▾</span>
          </button>

          <div className={`workspace-auth-collapse ${authPanelOpen ? 'open' : ''}`}>
            <div className="workspace-auth-collapse-inner">
              {backendUser ? (
                <div style={{ background: '#0F3B1E', border: '1px solid #166534', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
                  <span style={{ color: '#86EFAC' }}>
                    ✅ {backendUser.email}
                  </span>
                  <span style={{ color: '#4ADE80', fontSize: 12, fontWeight: 600 }}>
                    {backendUser.role === 'admin'
                      ? 'Безлимит (Admin)'
                      : backendUser.role === 'pro'
                        ? '♾️ Pro Business — безлимитные ТЗ'
                        : backendUser.payment_required
                          ? '⛔ Trial завершён — требуется оплата'
                          : backendUser.trial_active
                            ? `⚡ Trial (${backendUser.trial_days_left} дн.) — полный доступ`
                            : 'Trial'}
                  </span>
                  {backendUser.role === 'free' && backendUser.payment_required && (
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: '#FBBF24' }}>
                      Доступ закрыт? <strong style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => { const evt = new CustomEvent('tz:open-pricing'); window.dispatchEvent(evt); }}>Оформите Pro Business</strong>
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 8, padding: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 15, color: '#E2E8F0', marginBottom: 8 }}>
                    🔐 Для генерации ТЗ необходима авторизация
                  </div>
                  <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 12 }}>
                    Войдите или зарегистрируйтесь (кнопка «Войти» вверху справа).<br/>
                    Новым пользователям — <strong style={{ color: '#FBBF24' }}>14 дней полного Pro-trial</strong>.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>}
      </div>

      {hasPublicationBaseline && (
        <div className="compliance-summary-bar" role="region" aria-label="Правовые проверки ТЗ">
          <div className="compliance-summary-title">
            Правовые проверки по {lawMode === '44' ? '44-ФЗ' : '223-ФЗ'}
          </div>
          <div className="compliance-checks-row">
            {(() => {
              const brandIssues = complianceReport?.issues.filter(i => i.reason.toLowerCase().includes('бренд') || i.reason.toLowerCase().includes('торгов')) || [];
              const okpdIssues = complianceReport?.issues.filter(i => i.reason.toLowerCase().includes('окпд') || i.reason.toLowerCase().includes('ктру')) || [];
              const competitionOk = !complianceReport?.issues.some(i => i.reason.toLowerCase().includes('конкуренц') || i.reason.toLowerCase().includes('один производитель'));
              const importedCount = rows.filter(r => r.importInfo && r.importInfo.sourceFormat === 'docx').length;
              const aiGeneratedCount = rows.filter(r => r.status === 'done' && !r.importInfo).length;
              const importedWithSpecsCount = rows.filter(r => r.importInfo?.sourceFormat === 'docx' && (r.specs?.length ?? 0) > 0).length;
              return (
                <>
                  <span className={`compliance-check ${brandIssues.length === 0 ? 'compliance-check--ok' : 'compliance-check--fail'}`}>
                    {brandIssues.length === 0 ? '✓' : '✗'} Бренды
                    {brandIssues.length > 0 && <span className="compliance-check-count">{brandIssues.length}</span>}
                  </span>
                  <span className={`compliance-check ${okpdIssues.length === 0 ? 'compliance-check--ok' : 'compliance-check--fail'}`}>
                    {okpdIssues.length === 0 ? '✓' : '✗'} ОКПД2/КТРУ
                    {okpdIssues.length > 0 && <span className="compliance-check-count">{okpdIssues.length}</span>}
                  </span>
                  <span className={`compliance-check ${competitionOk ? 'compliance-check--ok' : 'compliance-check--fail'}`}>
                    {competitionOk ? '✓' : '✗'} Конкуренция ≥2
                  </span>
                  <span className={`compliance-check ${(complianceReport?.score ?? 100) >= (complianceReport?.minScore ?? 70) ? 'compliance-check--ok' : 'compliance-check--warn'}`}>
                    Антикоррупция: {complianceReport?.score ?? '—'}%
                  </span>
                  {importedCount > 0 && (
                    <span className="compliance-check compliance-check--info">
                      Из DOCX: {importedWithSpecsCount}/{importedCount}
                    </span>
                  )}
                  {aiGeneratedCount > 0 && (
                    <span className="compliance-check compliance-check--info">
                      AI: {aiGeneratedCount}
                    </span>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Онбординг-баннер: показывается пока ни одна строка не заполнена */}
      {rows.length === 1 && rows[0].status === 'idle' && !rows[0].model.trim() && !rows[0].specs?.length && (
        <div className="onboarding-banner">
          <div className="onboarding-banner-left">
            <div className="onboarding-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div className="onboarding-text">
              <div className="onboarding-title">Добро пожаловать в Генератор ТЗ</div>
              <div className="onboarding-sub">Создайте юридически чистое техническое задание для госзакупки по 44/223-ФЗ за 3 простых шага</div>
            </div>
          </div>
          <div className="onboarding-banner-right">
            <div className="onboarding-steps">
              <span className="onboarding-step">
                <span className="onboarding-step-num">1</span>
                Выберите тип товара
              </span>
              <span className="onboarding-step-arrow">→</span>
              <span className="onboarding-step">
                <span className="onboarding-step-num">2</span>
                Введите модель или описание
              </span>
              <span className="onboarding-step-arrow">→</span>
              <span className="onboarding-step">
                <span className="onboarding-step-num">3</span>
                Нажмите «Сгенерировать ТЗ»
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Таблица позиций */}
      <WorkspaceRowsTable
        rows={rows}
        autoDetectedRow={autoDetectedRow}
        focusedRowId={focusedRowId}
        rowActionState={rowActionState}
        publicationAutopilotRunning={publicationAutopilotRunning}
        editingRowId={editingRowId}
        expandedRowMetaId={expandedRowMetaId}
        canUseAiAssist={canUseAiAssist}
        hasBackendSession={hasBackendSession}
        canStartGeneration={canStartGeneration}
        generationPending={mutation.isPending}
        benchmarkingEnabled={enterpriseSettings.benchmarking}
        onOpenAuthPanel={() => setAuthPanelOpen(true)}
        onGenerateRow={(rowId) => mutation.mutate({ trigger: 'manual', rowId })}
        onSetRowRef={setRowRef}
        lookupCatalog={lookupCatalog}
        getUnifiedNacRegime={getUnifiedNacRegime}
        getResolvedOkpd2Code={(row) => getResolvedOkpd2Code(row as GoodsRow)}
        getResolvedOkpd2Name={(row) => getResolvedOkpd2Name(row as GoodsRow)}
        getResolvedKtruCode={(row) => getResolvedKtruCode(row as GoodsRow)}
        getResolvedLaw175Meta={getResolvedLaw175Meta}
        getClassificationSourceLabel={getClassificationSourceLabel}
        getLaw175MeasureLabel={getLaw175MeasureLabel}
        getLaw175EvidenceText={(row) => getLaw175EvidenceText(row as GoodsRow)}
        requiresManualClassificationReview={(row) => requiresManualClassificationReview(row as GoodsRow)}
        buildDraftSourceComparison={(sourceSpecs, draftSpecs, rowType) => buildDraftSourceComparison(sourceSpecs, draftSpecs, rowType)}
        getBenchmarkRiskLevel={(comparison) => getBenchmarkRiskLevel(comparison as DraftSourceComparison)}
        getLicenseTypeOptions={(row) => getLicenseTypeOptions(row as GoodsRow)}
        getLicenseTypePlaceholder={(row) => getLicenseTypePlaceholder(row as GoodsRow)}
        getTermPlaceholder={(row) => getTermPlaceholder(row as GoodsRow)}
        isServiceCatalogType={isServiceCatalogType}
        onChangeRowType={handleRowTypeChange}
        onChangeRowModel={(row, event) => handleRowModelChange(row as GoodsRow, event)}
        onHideTypeSuggestions={clearTypeSuggestions}
        onChangeRowLicenseType={handleRowLicenseTypeChange}
        onChangeRowTerm={handleRowTermChange}
        onChangeRowQty={handleRowQtyChange}
        onRefreshRowClassification={(rowId) => { void refreshRowClassification(rowId); }}
        onToggleRowDetails={toggleExpandedRow}
        onToggleRowEditing={toggleEditingRow}
        onDeleteRow={deleteRow}
        onRefreshRowFromSource={(rowId, source) => { void refreshRowFromSource(rowId, source); }}
        onUpdateSpec={updateSpec}
        onDeleteSpec={deleteSpec}
        onAddSpec={addSpec}
        onMoveSpec={moveSpec}
        onFinishEditing={finishEditing}
        onSearchOkpd2={(rowId, query) => { void handleSearchOkpd2ForRow(rowId, query); }}
      />

      {docxReady && (
        <div className="de-report-section">
          <DoubleEquivalentReport
            result={deResult}
            loading={deLoading}
            conflicts={deConflicts}
            onRunCheck={() => { void runDeCheck(); }}
            onApplyWiden={deResult && deResult.widened.length > 0 ? handleApplyWiden : undefined}
            modelName={rows.find((r) => r.status === 'done')?.model || undefined}
          />
        </div>
      )}
      </div>

      <aside className="workspace-sidecar">
        <Suspense fallback={<div className="workspace-inline-note">Загружаю панель публикации…</div>}>
          <WorkspaceSidePanels
            publicationStatusTone={publicationStatusTone}
            publicationStatusLabel={publicationStatusLabel}
            publicationLeadText={publicationLeadText}
            readinessGate={readinessGate}
            readyRowsCount={readyRowsCount}
            loggedIn={isLoggedIn()}
            historyOpen={historyOpen}
            historyLoading={historyLoading}
            historyItems={historyItems}
            currentDocId={currentDocId}
            docxReady={docxReady}
            exportReadinessTitle={exportReadinessTitle}
            exportsBlockedByReadiness={exportsBlockedByReadiness}
            buildTzText={buildTzTextForReview}
            qaAutoRunKey={qaAutoRunKey}
            onExportPackage={() => exportPackage()}
            onExportDocx={() => { void exportDocx(); }}
            onExportPdf={exportPdf}
            onSaveTZ={() => { void saveTZ(); }}
            onToggleHistory={() => {
              setHistoryOpen((v) => !v);
              if (!historyOpen) void loadHistory();
            }}
            onCloseHistory={() => setHistoryOpen(false)}
            onLoadHistoryItem={(docId) => { void loadTZ(docId); }}
            onDeleteHistoryItem={(docId) => { void deleteTZ(docId); }}
          />
        </Suspense>
      </aside>
      </div>

      <Suspense fallback={<div className="workspace-inline-note">Загружаю контроль публикации…</div>}>
        <WorkspaceReviewSections
          showPublicationControl={false}
          publicationStatusTone={publicationStatusTone}
          publicationStatusLabel={publicationStatusLabel}
          readinessGate={readinessGate}
          publicationAutopilotActions={publicationAutopilotActions}
          publicationAutopilotRunning={publicationAutopilotRunning}
          rowActionBusy={!!rowActionState}
          readinessAutofixActions={readinessAutofixActions}
          legalBulkActions={legalBulkActions}
          classificationBulkActions={classificationBulkActions}
          benchmarkBulkActions={benchmarkBulkActions}
          serviceBulkActions={serviceBulkActions}
          canUseAiAssist={canUseAiAssist}
          onRunPublicationAutopilot={() => void runPublicationAutopilot()}
          onApplyReadinessSafeAutofix={applyReadinessSafeAutofix}
          onApplyLegalReadinessPatchBulk={applyLegalReadinessPatchBulk}
          onRefreshClassificationBulk={(mode) => { void refreshClassificationBulk(mode); }}
          onApplyBenchmarkPatchBulk={applyBenchmarkPatchBulk}
          onApplyServiceReadinessPatchBulk={applyServiceReadinessPatchBulk}
          onHandleReadinessIssueAction={(issue) => handleReadinessIssueAction(issue as ReadinessIssue)}
          complianceReport={complianceReport}
          evidenceRows={liveLegalSummaryRows}
          evidenceSummaryText={buildLegalSummaryText(liveLegalSummarySourceRows)}
          showBenchmarking={enterpriseSettings.benchmarking}
          benchmarkSummary={liveBenchmarkGate}
          benchmarkRows={liveBenchmarkPanelRows}
          onApplyBenchmarkPatch={applyBenchmarkPatch}
          readyRowsCount={readyRowsCount}
          previewRef={previewRef}
          previewContent={previewDocSections ? (
            <Suspense fallback={<div className="workspace-inline-note">Готовлю предпросмотр ТЗ…</div>}>
              <WorkspacePreview
                doneRows={previewDoneRows}
                docSections={previewDocSections}
                lookupCatalog={lookupCatalog}
                getResolvedCommercialContext={(row) => getResolvedCommercialContext(row as GoodsRow)}
                getCommercialValue={(value) => getCommercialValue(value ?? '')}
                getRowQtyUnitShort={(row) => getRowQtyUnitShort(row as GoodsRow)}
                getResolvedOkpd2Code={(row) => getResolvedOkpd2Code(row as GoodsRow)}
                onUpdateSpec={updateSpec}
                onDeleteSpec={deleteSpec}
                onAddSpec={(rowId) => addSpec(rowId)}
              />
            </Suspense>
          ) : null}
        />
      </Suspense>

      {mutation.isError && (
        <div className="warn" style={{ marginTop: 8 }}>
          Ошибка: {mutation.error instanceof Error ? mutation.error.message : 'Неизвестная ошибка'}
        </div>
      )}

      <WorkspaceTypeSuggestions
        typeSuggestions={typeSuggestions}
        rows={rows}
        getUnifiedNacRegime={getUnifiedNacRegime}
        getPortalContainer={getPortalContainer}
        onSelectSuggestion={handleSelectTypeSuggestion}
      />

      </>
      )}
      {validationResult && (
        <TZValidationModal
          result={validationResult}
          onAutoFix={() => {
            applyAntiFasAutoFix();
          }}
          onClose={() => {
            setValidationResult(null);
            setPendingExportFn(null);
          }}
          onProceed={async () => {
            setValidationResult(null);
            if (pendingExportFn) {
              try {
                await pendingExportFn();
              } catch (e) {
                alert(e instanceof Error ? e.message : 'Ошибка экспорта DOCX');
              }
              setPendingExportFn(null);
            }
          }}
        />
      )}
      {showReviewPanel && (
        <TZReviewPanel
          tzText={buildTzTextForReview()}
          lawMode={lawMode}
          onApplyFixes={handleApplyReviewFixes}
          onClose={() => setShowReviewPanel(false)}
        />
      )}

      {(repairLoading || repairResult) && (
        <div className="tz-review-overlay" onClick={(e) => { if (e.target === e.currentTarget && !repairLoading) setRepairResult(null); }}>
          <div className="repair-result-panel">
            <div className="repair-result-header">
              <h3 className="repair-result-title">
                {repairLoading ? 'AI анализирует документ…' : `Анализ завершён — найдено ${repairResult!.violation_count} нарушений`}
              </h3>
              {!repairLoading && (
                <button type="button" className="modal-close-btn" onClick={() => setRepairResult(null)}>✕</button>
              )}
            </div>

            {repairLoading ? (
              <div className="repair-result-loading">
                <div className="repair-skeleton" />
                <div className="repair-skeleton repair-skeleton--short" />
                <div className="repair-skeleton" />
              </div>
            ) : repairResult && (
              <>
                <div className="repair-result-protocol">
                  <h4 className="repair-section-title">Протокол исправлений</h4>
                  <pre className="repair-protocol-text">{repairResult.protocol}</pre>
                </div>
                <div className="repair-result-fixed">
                  <h4 className="repair-section-title">Исправленный текст ТЗ</h4>
                  <pre className="repair-fixed-text">{repairResult.fixed_text}</pre>
                </div>
                <div className="repair-result-footer">
                  <span className="repair-provider-hint">AI: {repairResult.provider_used}</span>
                  <button
                    type="button"
                    className="repair-download-btn"
                    onClick={() => {
                      const content = `ПРОТОКОЛ ИСПРАВЛЕНИЙ\n\n${repairResult.protocol}\n\n${'═'.repeat(60)}\n\nИСПРАВЛЕННОЕ ТЗ\n\n${repairResult.fixed_text}`;
                      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `TZ_исправлен_${new Date().toISOString().slice(0,10)}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Скачать исправленный текст
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {(auditLoading || showAuditModal) && (
        <div className="tz-review-overlay" onClick={(e) => { if (e.target === e.currentTarget && !auditLoading) setShowAuditModal(false); }}>
          <div className="audit-result-panel">
            <div className="audit-result-header">
              {auditLoading ? (
                <h3 className="audit-result-title">Аудит ТЗ — проверяем документ…</h3>
              ) : auditResult ? (
                <div className="audit-result-header-inner">
                  <h3 className="audit-result-title">
                    Аудит ТЗ — {auditResult.pass_count} из 9 пунктов пройдено
                  </h3>
                  <span className={`audit-verdict-badge ${auditResult.verdict === 'ГОТОВО К ЕИС' ? 'audit-verdict--ok' : 'audit-verdict--fail'}`}>
                    {auditResult.verdict || 'Результат получен'}
                  </span>
                </div>
              ) : null}
              {!auditLoading && (
                <button type="button" className="modal-close-btn" onClick={() => setShowAuditModal(false)}>✕</button>
              )}
            </div>

            {auditLoading ? (
              <div className="repair-result-loading">
                <div className="repair-skeleton" />
                <div className="repair-skeleton repair-skeleton--short" />
                <div className="repair-skeleton" />
                <div className="repair-skeleton repair-skeleton--short" />
                <div className="repair-skeleton" />
              </div>
            ) : auditResult && (
              <>
                <div className="audit-result-body">
                  <pre className="audit-report-text">{auditResult.report}</pre>
                </div>
                <div className="repair-result-footer">
                  <button
                    type="button"
                    className="repair-download-btn"
                    onClick={() => {
                      const blob = new Blob([auditResult.report], { type: 'text/plain;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `Аудит_ТЗ_${new Date().toISOString().slice(0,10)}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Скачать отчёт аудита
                  </button>
                  <button type="button" className="de-close-btn" onClick={() => setShowAuditModal(false)}>
                    Закрыть
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
