import type { SpecItem } from './spec-processor';

const GENERIC_EXACT_MODEL_VALUE_RE = /(по типу( товара| программного обеспечения)?|по назначению|по требованиям заказчика|в соответствии с (типом товара|требованиями заказчика)|в количестве, достаточном|достаточном для эксплуатации|типовая конфигурация|согласно требованиям|согласно документации|по спецификации производителя|при необходимости|по согласованию с заказчиком|новый, не бывший|заводская упаковка|эксплуатационной документации|наличие заводской маркировки)/i;
const FORMAL_EXACT_MODEL_NAME_RE = /^(состояние(?:\s+товара)?|комплект\s+поставки|документац.*|маркировк.*|гаранти.*|упаковка(?:\s+и\s+маркировка)?|страна\s+происхождения|условия\s+поставки|удал[её]нное\s+администрирование(?:\s*\/\s*мониторинг\s+состояния)?|поддержка\s+модернизации\s+и\s+замены\s+компонентов)$/i;
const CORE_EXACT_MODEL_NAME_RE = /(процессор|оперативн|памят|накопител|ssd|hdd|nvme|графическ|видеокарт|сетев|ethernet|wi-?fi|bluetooth|порт|usb|hdmi|displayport|vga|dvi|размер|габарит|длина|ширина|высота|глубина|диаметр|толщин|вес|масса|питан|блок питания|мощност|диагонал|разрешен|матриц|камера|аккумулятор|батаре|чипсет|сокет|слот|интерфейс|форм-фактор|корпус|монтаж|vesa|tpm|операционная система|ос|типоразмер|тип(?!\s+товара)|материал|состав|объем|объём|емкост|ёмкост|плотност|цвет|класс|сорт|формат|фасовк|колич|сло|лист|рулон|намотк|покрыти|твердост|нагрузк|производительност|давлени|расход|температур|напряжен|ток|ресурс|срок годности|срок хранения|совместимост|стандарт|гост|ip|snr|выпуск|смыв|сидень|арматур|белизн|непрозрачност|химическ|бит|жало|насадк|клавиш|кнопок|раскладк|механизм|сенсор|радиоканал|приемник|приёмник|кабел|разъем|разъе[мё]|категори|индикац|модул|функц(?:ии)? тестирован|тон-?генератор|генератор тона|щуп)/i;
const QUALITATIVE_DETAIL_VALUE_RE = /^(щелочн|алкалин|литиев|первичн(ая|ой)? целлюлоз|вторичн(ое|ой) сыр[ьеё]|cr-v|s2|нержаве(ющая|ющая сталь)?|латун|керамик|полипропилен|полиэтилен|микрофибр|сенсорн|механическ|мембран|ножничн|оптическ|светодиодн|жк|lcd|led|компакт|подвесн|горизонтальн|косой|двойн(?:ой|ое)|кругов(?:ой|ое)|аккумуляторн|сетев(?:ой|ое)|ударн|бесщеточн|бел(?:ый|ая)|сер(?:ый|ая)|черн(?:ый|ая)|матов(?:ый|ая)|глянцев(?:ый|ая)|перфорированн|тиснен(?:ие|ый)|однослойн|двухслойн|трехслойн|трёхслойн)/i;
const STRUCTURED_EXACT_MODEL_VALUE_RE = /(\d+\s*(gb|mb|tb|ghz|mhz|hz|w|kg|g|mm|cm|m|v|a)\b|\d+gb\(\d+gb[*x]\d+\)|\d+x\s*(?:\(v?\d(?:\.\d+)?\))?|\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?(?:\s*x\s*\d+(?:\.\d+)?)?|\b(?:ddr\d|so-?dimm|sdram|wi-?fi\s*\d[\w.+-]*|bluetooth|intel\s+core|amd\s+ryzen|h\d{3,4}|q\d{3,4}|b\d{3,4}|z\d{3,4}|rj-?45|usb\s*\d(?:\.\d)?|hdmi|displayport|nvme|m\.?2|sata)\b)/i;
const TECH_DETAIL_VALUE_RE = /(\d+\s*(гб|мб|тб|ггц|мгц|вт|дюйм|мм|см|м|кг|г|мл|л|м²|м2|м³|м3|мкм|бар|об\/мин|л\/мин|м\/с|лист(?:ов)?|рулон(?:ов)?|сло(?:й|я|ев)|шт\.?|пар|mah|мач|ah|ач|в|а|°c|°с|дб|db|лм|lm|cie|dpi|ppi|snr|ip\d{2}|pei|гбит\/с|мбит\/с|fps))|aa|aaa|lr6|lr03|cr2032|cr2025|cr2016|cr-v|torx|ph\d|pz\d|sl\d|tx\d|e27|e14|gu10|ral\s*\d+|no frost|ffp\d|pn\d|m\d{1,2}|a4|a3|fsc|гост|ту|щелочн|алкалин|литиев|целлюлоз|макулатур|нержаве|латун|керамик|полипропилен|полиэтилен|микрофибр|двойной слив|круговой смыв|горизонтальный выпуск|косой выпуск|компакт|подвесной|сенсорный|механический|мембран|ножничн|оптическ|светодиодн|жк|lcd|led|аккумуляторный|сетевой|ударный|бесщеточный|phillips|pozidriv|utp|ftp|stp|cat\.?\s*\d|rj-?11|rj-?12|rj-?45/i;
const THIN_THRESHOLD_ONLY_RE = /^не\s+(?:менее|более)\s+\d+(?:[.,]\d+)?\s*(гб|мб|тб|ггц|мгц|вт|дюйм|мм|см|м|кг|г|мл|л|лист(?:ов)?|рулон(?:ов)?|сло(?:й|я|ев)|шт\.?|пар|mah|мач|ah|ач|в|а|порт(?:а|ов)?|ядер?|поток(?:ов)?|мес)?$/i;
const ALLOW_THRESHOLD_ONLY_EXACT_MODEL_NAME_RE = /(размер|габарит|длина|ширина|высота|глубина|диаметр|толщин|вес|масса|объем|объём|емкост|ёмкост|мощност|диагонал|напряжен|ток|колич|лист|рулон|сло|намотк|ресурс|срок годности|срок хранения)/i;
const ALLOW_PLAIN_NUMERIC_EXACT_MODEL_NAME_RE = /(ядер|поток|слот|порт|вес|масса|размер|габарит|длина|ширина|высота|глубина|диаметр|толщин|объем|объём|емкост|ёмкост|частот|скорост)/i;

function normalizeText(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAlphaDigitMix(value: string): boolean {
  return /[a-zа-я]/i.test(value) && /\d/.test(value);
}

function hasStructuredCodeToken(value: string): boolean {
  return /[a-zа-я0-9]+[+._/-][a-zа-я0-9]+/i.test(value);
}

export function isWeakExactModelSpec(spec: Pick<SpecItem, 'name' | 'value'>): boolean {
  const name = normalizeText(String(spec.name || '')).toLowerCase().replace(/ё/g, 'е');
  const value = normalizeText(String(spec.value || ''));
  const normalizedValue = value.toLowerCase().replace(/ё/g, 'е');
  const normalizedTokens = normalizedValue.split(/\s+/).filter(Boolean);
  const hasStructuredToken = normalizedTokens.some((token) => hasAlphaDigitMix(token) || hasStructuredCodeToken(token));

  if (!name || !value) return true;
  if (GENERIC_EXACT_MODEL_VALUE_RE.test(normalizedValue)) return true;
  if (normalizedValue.includes('и/или') && !TECH_DETAIL_VALUE_RE.test(value)) return true;
  if (CORE_EXACT_MODEL_NAME_RE.test(name) && THIN_THRESHOLD_ONLY_RE.test(normalizedValue) && !ALLOW_THRESHOLD_ONLY_EXACT_MODEL_NAME_RE.test(name)) return true;
  if (FORMAL_EXACT_MODEL_NAME_RE.test(name)) return true;
  if (CORE_EXACT_MODEL_NAME_RE.test(name) && QUALITATIVE_DETAIL_VALUE_RE.test(normalizedValue)) return false;
  if (CORE_EXACT_MODEL_NAME_RE.test(name) && /^\d+(?:[.,]\d+)?$/.test(normalizedValue) && ALLOW_PLAIN_NUMERIC_EXACT_MODEL_NAME_RE.test(name)) return false;
  if (CORE_EXACT_MODEL_NAME_RE.test(name) && (STRUCTURED_EXACT_MODEL_VALUE_RE.test(normalizedValue) || hasStructuredToken)) return false;
  if (CORE_EXACT_MODEL_NAME_RE.test(name) && !TECH_DETAIL_VALUE_RE.test(value) && normalizedValue.split(/\s+/).length <= 6) return true;
  return false;
}

export function getWeakExactModelSpecs(specs: SpecItem[]): SpecItem[] {
  return specs.filter((spec) => isWeakExactModelSpec(spec));
}

export function countConcreteExactModelSpecs(specs: SpecItem[]): number {
  return specs.filter((spec) => {
    const name = normalizeText(String(spec.name || ''));
    const value = normalizeText(String(spec.value || ''));
    if (!name || !value) return false;
    if (FORMAL_EXACT_MODEL_NAME_RE.test(name)) return false;
    if (!CORE_EXACT_MODEL_NAME_RE.test(name)) return false;
    if (isWeakExactModelSpec(spec)) return false;
    return TECH_DETAIL_VALUE_RE.test(value) || QUALITATIVE_DETAIL_VALUE_RE.test(value.toLowerCase()) || /\d/.test(value);
  }).length;
}

export function hasSufficientExactModelCoverage(specs: SpecItem[]): boolean {
  if (!Array.isArray(specs) || specs.length < 7) return false;
  const weak = getWeakExactModelSpecs(specs).length;
  const concrete = countConcreteExactModelSpecs(specs);
  return concrete >= 5 && weak <= Math.max(4, Math.floor(specs.length * 0.35));
}
