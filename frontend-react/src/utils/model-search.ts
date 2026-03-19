const GENERIC_MODEL_TOKENS = new Set([
  'системный', 'блок', 'ноутбук', 'монитор', 'сервер', 'моноблок', 'компьютер', 'рабочая', 'станция',
  'клавиатура', 'мышь', 'гарнитура', 'принтер', 'мфу', 'сканер', 'коммутатор', 'маршрутизатор',
  'точка', 'доступа', 'накопитель', 'кабель', 'адаптер', 'патч', 'корд', 'лицензия', 'подписка',
  'поддержка', 'техподдержка', 'программное', 'обеспечение', 'операционная', 'система', 'комплект',
  'оборудование', 'товар', 'изделие', 'устройство', 'цвет', 'черный', 'черная', 'черныйи',
  'размер', 'длина', 'ширина', 'высота', 'вес', 'масса', 'поставка', 'поставляемого', 'для',
  'на', 'по', 'и', 'или', 'с', 'без', 'pro', 'mini',
  'system', 'unit', 'desktop', 'pc', 'computer', 'server', 'monitor', 'printer', 'scanner',
  'switch', 'router', 'access', 'point', 'storage', 'ssd', 'hdd', 'software', 'license',
  'support', 'subscription', 'with', 'without', 'black', 'white',
]);

const BRAND_HINTS = [
  'msi', 'asus', 'acer', 'dell', 'hp', 'hewlett', 'lenovo', 'huawei', 'xiaomi', 'apple',
  'graviton', 'гравитон', 'aquarius', 'аквариус', 'iru', 'айру', 'yadro', 'ядро',
  'gigabyte', 'asrock', 'supermicro', 'hpe', 'hpе', 'ibm', 'cisco', 'juniper', 'mikrotik',
  'tp link', 'tp-link', 'zyxel', 'keenetic', 'samsung', 'kingston', 'apc', 'epson',
  'xerox', 'kyocera', 'pantum', 'ricoh', 'canon', 'brother', 'intel', 'amd', 'nvidia',
  'astra', 'рупост', 'rupost', 'termidesk', 'ald', 'brest',
];

function normalizeModelSearchText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9+./_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAlphaDigitMix(token: string): boolean {
  return /[a-zа-я]/i.test(token) && /\d/.test(token);
}

function hasStructuredCodeToken(token: string): boolean {
  return /[a-zа-я0-9]+[-_/+.][a-zа-я0-9]+/i.test(token);
}

export function looksLikeSpecificModelQuery(value: string): boolean {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (raw.length > 180) return false;

  const normalized = normalizeModelSearchText(raw);
  if (!normalized) return false;
  if (/(?:техподдерж|поддержк|support|сопровождени|оказани[ея]|услуг)/i.test(normalized)) return false;

  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length < 2) return false;

  const informativeTokens = tokens.filter((token) => !GENERIC_MODEL_TOKENS.has(token));
  if (informativeTokens.length < 2) return false;

  const hasBrandHint = BRAND_HINTS.some((brand) => normalized.includes(brand));
  const hasCodeToken = informativeTokens.some((token) => hasAlphaDigitMix(token) || hasStructuredCodeToken(token));
  const longLatinTokens = informativeTokens.filter((token) => /[a-z]/i.test(token) && token.length >= 3).length;
  const hasUpperSeries = /(?:^|[\s(])([A-Z]{2,}[A-Z0-9/+._-]{1,}|[A-Z]?\d+[A-Z0-9._/-]+)(?:$|[\s)])/u.test(raw);
  const measuredCues = raw.match(/\d+\s*(?:гб|gb|tb|тб|mhz|мгц|ггц|вт|мм|см|кг|г|шт|mah|мач|дюйм|hz)/ig) || [];
  const looksLikeSpecSentence = /[:,;]/.test(raw) || (measuredCues.length >= 2 && informativeTokens.length >= 4);

  if (looksLikeSpecSentence && !hasCodeToken) return false;
  if (hasCodeToken) return true;
  if (hasBrandHint && (longLatinTokens >= 2 || hasUpperSeries)) return true;
  if (hasUpperSeries && informativeTokens.length >= 3) {
    return hasBrandHint || informativeTokens.some((token) => hasAlphaDigitMix(token));
  }
  return false;
}
