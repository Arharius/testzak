import type { SpecItem } from './spec-processor';

const GENERIC_EXACT_MODEL_VALUE_RE = /(по типу( товара| программного обеспечения)?|по назначению|по требованиям заказчика|в соответствии с (типом товара|требованиями заказчика)|в количестве, достаточном|достаточном для эксплуатации|типовая конфигурация|согласно требованиям|согласно документации|по спецификации производителя|при необходимости|по согласованию с заказчиком|новый, не бывший|заводская упаковка|эксплуатационной документации|наличие заводской маркировки)/i;
const CORE_EXACT_MODEL_NAME_RE = /(процессор|оперативн|памят|накопител|ssd|hdd|nvme|графическ|видеокарт|сетев|ethernet|wi-?fi|bluetooth|порт|usb|hdmi|displayport|vga|dvi|размер|габарит|вес|масса|питан|блок питания|мощност|диагонал|разрешен|матриц|камера|аккумулятор|батаре|чипсет|сокет|слот|интерфейс|форм-фактор|корпус|монтаж|vesa|tpm|операционная система|ос)/i;
const TECH_DETAIL_VALUE_RE = /(\d+\s*(гб|мб|тб|ггц|мгц|вт|дюйм|мм|см|кг|г|mah|мач|гбит\/с|мбит\/с|fps|dpi|порт|порта|портов))|ddr\d|nvme|pcie|usb\s*\d|usb-c|type-c|hdmi|displayport|vga|dvi|wi-?fi\s*\d|bluetooth\s*\d|ethernet|rj-?45|intel|amd|core\s*i[3579]|ryzen|geforce|radeon|uhd|iris|windows|linux|sata|m\.2|vesa|tpm|ips|va|oled|lcd/i;
const THIN_THRESHOLD_ONLY_RE = /^не\s+(?:менее|более)\s+\d+(?:[.,]\d+)?\s*(гб|мб|тб|ггц|мгц|вт|дюйм|мм|см|кг|г|порт(?:а|ов)?|ядер?|поток(?:ов)?|мес)?$/i;

function normalizeText(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isWeakExactModelSpec(spec: Pick<SpecItem, 'name' | 'value'>): boolean {
  const name = normalizeText(String(spec.name || '')).toLowerCase().replace(/ё/g, 'е');
  const value = normalizeText(String(spec.value || ''));
  const normalizedValue = value.toLowerCase().replace(/ё/g, 'е');

  if (!name || !value) return true;
  if (GENERIC_EXACT_MODEL_VALUE_RE.test(normalizedValue)) return true;
  if (normalizedValue.includes('и/или') && !TECH_DETAIL_VALUE_RE.test(value)) return true;
  if (CORE_EXACT_MODEL_NAME_RE.test(name) && THIN_THRESHOLD_ONLY_RE.test(normalizedValue)) return true;
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
    if (!CORE_EXACT_MODEL_NAME_RE.test(name)) return false;
    if (isWeakExactModelSpec(spec)) return false;
    return TECH_DETAIL_VALUE_RE.test(value) || /\d/.test(value);
  }).length;
}

export function hasSufficientExactModelCoverage(specs: SpecItem[]): boolean {
  if (!Array.isArray(specs) || specs.length < 10) return false;
  const weak = getWeakExactModelSpecs(specs).length;
  const concrete = countConcreteExactModelSpecs(specs);
  return concrete >= 6 && weak <= Math.max(3, Math.floor(specs.length * 0.25));
}
