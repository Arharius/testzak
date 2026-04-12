export interface SpecItem {
  group?: string;
  name?: string;
  value?: string;
  unit?: string;
  _warning?: string;
  _fixed?: boolean;
  [key: string]: unknown;
}

const BRAND_TOKEN_PATTERN = /\b(Intel|AMD|Nvidia|Samsung|Micron|Kingston|WD|Western\s+Digital|Seagate|Toshiba|Qualcomm|Broadcom|Realtek|Marvell|Mellanox|Hynix|SK\s*Hynix|Lenovo|Huawei|Cisco|Dell|Acer|Asus|Apple|MSI|Gigabyte|Supermicro|HP|HPE|TP-?Link|D-?Link|Juniper|Aruba|ZTE|Hikvision|Dahua|Canon|Epson|Ricoh|Kyocera|Brother|Xerox|Pantum|LG|BenQ|ViewSonic|AOC|iiyama|Logitech|Jabra|Plantronics|Poly|Synology|QNAP|NetApp|MikroTik|Ubiquiti|Zyxel|Eltex|APC|Eaton|Vertiv|Noctua|Corsair|be\s*quiet|Chieftec|Thermaltake|Cooler\s*Master|DeepCool|Интел|Самсунг|Леново|Хуавей|Делл|Кэнон|Эпсон)\b/gi;
const MAX_PARAMS      = ['вес', 'масса', 'толщина', 'высота корпуса', 'уровень шума'];
const BATTERY_PARAMS  = ['ёмкость аккумулятора', 'емкость аккумулятора', 'ёмкость батареи', 'емкость батареи', 'аккумулятор'];
const SOCKET_PATTERN  = /\b(LGA\s*\d{3,4}|AM[345][+]?|FM[12]|BGA\s*\d+)\b/i;
const UPTIME_PARAMS   = ['время работы', 'время автономной', 'автономная работа', 'время от аккумулятора'];
const RESOLUTION_PARAMS = ['разрешение экрана', 'разрешение матрицы', 'разрешение дисплея'];
const MATRIX_PARAMS   = ['тип матрицы', 'матрица', 'тип экрана', 'тип дисплея', 'тип панели'];
const RAM_TYPE_PARAMS = ['тип памяти', 'тип озу', 'тип оперативной'];

function stripBrandWords(raw: string): { text: string; changed: boolean } {
  const source = String(raw || '');
  let text = source;
  text = text.replace(BRAND_TOKEN_PATTERN, ' ');
  text = text.replace(/[«»"]/g, ' ');
  text = text.replace(/\s{2,}/g, ' ').trim();
  text = text.replace(/^[,;:.\-]+|[,;:.\-]+$/g, '').trim();
  return { text, changed: text !== source };
}

// Паттерны мета-инструкций ИИ, которые не должны попасть в финальный документ
const META_INSTRUCTION_PATTERNS = [
  /^(удалить|убрать|исключить|delete|remove)\b/i,
  /уже\s+указано\s+выше/i,
  /дублирование\s+устранено/i,
  /\[указать\s+конкретный\s+срок/i,
  /\[необходимо\s+указать/i,
  /^данная\s+позиция\s+(является|представляет)/i,
];

// Имена характеристик, которые ИИ иногда генерирует как мета-строки и надо удалять
const META_NAME_PATTERNS = [
  /^ТОРП$/i,
  /^требование\s+о\s+товарах\s+российского/i,
];

// Паттерны незакрытых плейсхолдеров, оставленных ИИ
const PLACEHOLDER_PATTERNS = [
  /\[указать[^\]]*\]/i,
  /\[уточнить[^\]]*\]/i,
  /\[вписать[^\]]*\]/i,
  /\[заполнить[^\]]*\]/i,
  /\[insert[^\]]*\]/i,
];

export function postProcessSpecs(specs: SpecItem[]): SpecItem[] {
  return specs.flatMap((item) => {
    let name = String(item.name ?? '');
    let group = String(item.group ?? '');
    let value = String(item.value ?? '');
    let unit  = String(item.unit  ?? '');

    // 0a. Удаляем строки, у которых ИМЯ характеристики — мета-строка (ТОРП и т.п.)
    if (META_NAME_PATTERNS.some((p) => p.test(name.trim()))) {
      return [];
    }

    // 0b. Удаляем строки, у которых ЗНАЧЕНИЕ — мета-инструкция ИИ
    if (META_INSTRUCTION_PATTERNS.some((p) => p.test(value.trim()))) {
      return [];
    }

    // 0c. Плейсхолдеры вида [указать...] — добавляем предупреждение
    if (PLACEHOLDER_PATTERNS.some((p) => p.test(value.trim()))) {
      (item as SpecItem)._warning =
        'Значение не заполнено — плейсхолдер ИИ: укажите конкретный параметр вручную.';
    }

    const nameStripped = stripBrandWords(name);
    const groupStripped = stripBrandWords(group);
    const valueStripped = stripBrandWords(value);
    name = nameStripped.text;
    group = groupStripped.text;
    value = valueStripped.text;
    if (valueStripped.changed && !value) {
      value = 'эквивалент';
      (item as SpecItem)._fixed = true;
    }

    const nameLower  = name.toLowerCase();
    const groupLower = group.toLowerCase();

    // 2. Сокет процессора — предупреждение (нарушает ст. 33 44-ФЗ)
    if (
      SOCKET_PATTERN.test(value) &&
      (nameLower.includes('сокет') || nameLower.includes('разъем') || nameLower.includes('socket'))
    ) {
      (item as SpecItem)._warning =
        'Указание конкретного сокета ограничивает конкуренцию (ст. 33 44-ФЗ). Рекомендуется убрать эту строку.';
    }

    // 3. Вес/габариты — >= должен быть <=
    if (MAX_PARAMS.some((p) => nameLower.includes(p)) && value.startsWith('>=')) {
      value = value.replace(/^>=/, '<=');
      (item as SpecItem)._fixed = true;
    }

    // 4. Аккумулятор — Вт → Вт·ч
    if (BATTERY_PARAMS.some((p) => nameLower.includes(p))) {
      if (['Вт', 'W', 'wh', 'WH'].includes(unit)) {
        unit = 'Вт·ч';
        (item as SpecItem)._fixed = true;
      }
      if (!unit && /^\d/.test(value.replace(/^[><]=?\s*/, ''))) {
        unit = 'Вт·ч';
      }
    }

    // 5. Единицы на русском
    const unitMap: Record<string, string> = {
      GHz: 'ГГц', ghz: 'ГГц',
      MHz: 'МГц', mhz: 'МГц',
      GB:  'ГБ',  gb:  'ГБ',
      MB:  'МБ',  mb:  'МБ',
      TB:  'ТБ',  tb:  'ТБ',
    };
    if (unitMap[unit]) unit = unitMap[unit];

    // 6. DDR4 без «или выше»
    const isRamField =
      RAM_TYPE_PARAMS.some((p) => nameLower.includes(p)) ||
      (nameLower === 'тип' &&
        (groupLower.includes('оперативн') || groupLower === 'озу' || groupLower === 'ram'));
    if (isRamField) {
      const ddrMatch = value.trim().match(/^(DDR\d?)(\s*\d+)?$/i);
      if (ddrMatch && !/или выше|или DDR|or higher/i.test(value)) {
        const ddrVersion = ddrMatch[1].toUpperCase(); // DDR4, DDR5, etc.
        value = `${ddrVersion} или выше`;
        (item as SpecItem)._fixed = true;
      }
    }

    // 7. Тип матрицы без «или эквивалент»
    const isMatrixField =
      MATRIX_PARAMS.some((p) => nameLower.includes(p)) ||
      (nameLower === 'тип' &&
        (groupLower.includes('матриц') || groupLower.includes('экран') ||
         groupLower.includes('дисплей') || groupLower.includes('монитор')));
    if (isMatrixField) {
      if (/^IPS$/i.test(value.trim())) {
        value = 'IPS или эквивалент (угол обзора не менее 178°)';
        (item as SpecItem)._fixed = true;
      } else if (/^(IPS|VA|TN|OLED|AMOLED|PLS|WVA|UWVA)$/i.test(value.trim())) {
        value = value + ' или эквивалент';
        (item as SpecItem)._fixed = true;
      }
    }

    // 8. Точное разрешение → «не менее»
    if (RESOLUTION_PARAMS.some((p) => nameLower.includes(p))) {
      if (/^\d{3,4}[xх×]\d{3,4}$/.test(value.trim())) {
        value = 'не менее ' + value;
        (item as SpecItem)._fixed = true;
      }
    }

    // 9. Время работы без методики
    if (UPTIME_PARAMS.some((p) => nameLower.includes(p))) {
      if (/^(>=\s*)?\d+(\.\d+)?$/.test(value.trim()) || /^>=\s*\d+$/.test(value.trim())) {
        const hours = value.replace(/[^0-9.]/g, '');
        value = `не менее ${hours} часов в режиме офисной работы (веб-браузер, офисные приложения, яркость экрана 50%)`;
        (item as SpecItem)._fixed = true;
      }
    }

    // 10. Математические операторы → юридические формулировки
    value = value.replace(/>=\s*/g, 'не менее ');
    value = value.replace(/<=\s*/g, 'не более ');
    value = value.replace(/(?<!не )более\s+/gi, 'не менее ');
    value = value.replace(/(?<!не )менее\s+/gi, 'не более ');

    // 11. Слабый язык → императивный (44-ФЗ требует определённости)
    value = value.replace(/рекомендуется\s*/gi, '');
    value = value.replace(/желательно\s*/gi, '');
    value = value.replace(/предпочтительно\s*/gi, '');
    value = value.replace(/опционально\s*/gi, '');
    if (/^\s*$/.test(value)) value = 'Да'; // если после очистки пусто

    // 12. Единицы в тексте значения → русские
    value = value.replace(/(\d)\s*GHz\b/gi, '$1 ГГц');
    value = value.replace(/(\d)\s*MHz\b/gi, '$1 МГц');
    value = value.replace(/(\d)\s*GB\b/gi,  '$1 ГБ');
    value = value.replace(/(\d)\s*MB\b/gi,  '$1 МБ');
    value = value.replace(/(\d)\s*TB\b/gi,  '$1 ТБ');

    // 13. Конкретные артикулы / part numbers → предупреждение
    const ARTICLE_PATTERN = /\b[A-Z]{2,}\d{3,}[A-Z0-9\-]*\b/;
    if (ARTICLE_PATTERN.test(value) && !nameLower.includes('окпд') && !nameLower.includes('ктру') && !nameLower.includes('код')) {
      const hasEquiv = /или\s+эквивалент/i.test(value);
      if (!hasEquiv) {
        value = value + ' или эквивалент';
        (item as SpecItem)._warning = (item._warning ? item._warning + '; ' : '') +
          'Обнаружен артикул/part number — добавлено «или эквивалент» (ст. 33 44-ФЗ)';
      }
    }

    // 14. Голые числовые значения для ёмкости/размера → «не менее N»
    const NUMERIC_PARAMS = ['объем','объём','ёмкость','емкость','размер','диагональ','яркость','контрастность','частота','скорость','пропускная','производительность'];
    if (NUMERIC_PARAMS.some(p => nameLower.includes(p)) && /^\d+(\.\d+)?$/.test(value.trim()) && !/не менее|не более/i.test(value)) {
      value = 'не менее ' + value;
      (item as SpecItem)._fixed = true;
    }

    // 15. Автозаполнение пустых единиц измерения
    if (!unit || unit.trim() === '') {
      unit = inferUnit(nameLower, value);
    }

    // 16. Запрещённые формулировки (44-ФЗ ст. 33 — характеристики должны быть измеримыми)
    const VAGUE_PATTERNS = [
      /^по\s+треб\w*\s+(заказчика|поставщика|производителя|потребителя)/i,
      /^по\s+усмотрению\s+\w+/i,
      /^на\s+усмотрение\s+\w+/i,
      /^(согласно|в\s+соответствии\s+с?)\s+(технической?\s+документацией|требованиями?\s+заказчика|документацией\s+производителя|документации)/i,
      /^согласно\s+документации/i,
      /^уточняется?\s+(при\s+поставке|заказчиком|в\s+ходе|по\s+договору|в\s+наименовании)/i,
      /^определяется?\s+(производителем|поставщиком|заказчиком)/i,
      /^не\s+хуже\s+аналогов?/i,
      /^по\s+типу\s+(товара|устройства|оборудования)/i,
      /^при\s+необходимости/i,
      /^зависит\s+от\s+(модели|конфигурации|комплектации)/i,
      /^в\s+соответствии\s+с\s+моделью/i,
      /^по\s+запросу/i,
      /по\s+спецификации\s+производителя/i,
      /^по\s+модели\s+поставки/i,
      /по\s+составу\s+производителя/i,
      /^на\s+усмотрение\s+производителя/i,
    ];
    const isVague = VAGUE_PATTERNS.some((p) => p.test(value.trim()));
    if (isVague) {
      // Auto-fix по известным параметрам; иначе — предупреждение
      if (/архитектур/i.test(nameLower)) {
        value = 'x86-64';
        (item as SpecItem)._fixed = true;
      } else if (/частот/i.test(nameLower) && /процессор|cpu|ядр/i.test(groupLower + nameLower)) {
        value = 'не менее 2,4 ГГц';
        unit = 'ГГц';
        (item as SpecItem)._fixed = true;
      } else if (/объ[её]м|[её]мкост/i.test(nameLower) && /память|озу|ram|оперативн/i.test(groupLower + nameLower)) {
        value = 'не менее 8 ГБ';
        unit = 'ГБ';
        (item as SpecItem)._fixed = true;
      } else if (/объ[её]м|[её]мкост/i.test(nameLower) && /накопитель|диск|hdd|ssd|nvme|stor/i.test(groupLower + nameLower)) {
        value = 'не менее 256 ГБ';
        unit = 'ГБ';
        (item as SpecItem)._fixed = true;
      } else if (/кол-во ядер|количество ядер|число ядер/i.test(nameLower)) {
        value = 'не менее 4';
        unit = 'шт';
        (item as SpecItem)._fixed = true;
      } else if (/кол-во потоков|количество потоков/i.test(nameLower)) {
        value = 'не менее 8';
        unit = 'шт';
        (item as SpecItem)._fixed = true;
      } else if (/гарантия/i.test(nameLower)) {
        value = 'не менее 12 месяцев';
        unit = 'мес';
        (item as SpecItem)._fixed = true;
      } else {
        (item as SpecItem)._warning = (item._warning ? item._warning + '; ' : '') +
          'Запрещённая формулировка: укажите конкретное числовое значение (44-ФЗ ст. 33)';
      }
    }

    // 17. "up to X unit" из англоязычных даташитов → «не менее X единица» (для параметров производительности)
    //     и «не более X единица» (для веса, размеров, шума)
    const UP_TO_PATTERN = /\bup\s+to\s+([\d.,]+)\s*(GB|MB|TB|GHz|MHz|W|V|dB|mm|kg|g|m|ms|fps|Mbps|Gbps)\b/gi;
    const isMaxParam = MAX_PARAMS.some((p) => nameLower.includes(p)) ||
      /шум|уровень\s+шума|noise|масса|вес|weight|габарит|размер|dimension|thickness/i.test(nameLower);
    value = value.replace(UP_TO_PATTERN, (_match, num, eng) => {
      const ruMap: Record<string, string> = {
        GB:'ГБ', MB:'МБ', TB:'ТБ', GHz:'ГГц', MHz:'МГц',
        W:'Вт', V:'В', dB:'дБ', mm:'мм', kg:'кг', g:'г',
        m:'м', ms:'мс', fps:'кадр/с', Mbps:'Мбит/с', Gbps:'Гбит/с',
      };
      const ruUnit = ruMap[eng] ?? eng;
      const prefix = isMaxParam ? 'не более' : 'не менее';
      (item as SpecItem)._fixed = true;
      return `${prefix} ${num} ${ruUnit}`;
    });

    // 18. Wi-Fi и Bluetooth в составе ПК/серверов без явного запроса — предупреждение
    const isWifiName  = /wi-?fi|wifi|беспровод|wireless/i.test(nameLower);
    const isBtName    = /bluetooth|блютуз|bt\b/i.test(nameLower);
    const isPcContext = /системн|блок|пк\b|workstation|desktop|сервер|server|компьютер|mini\s*pc/i.test(groupLower);
    if ((isWifiName || isBtName) && isPcContext) {
      (item as SpecItem)._warning = (item._warning ? item._warning + '; ' : '') +
        'Беспроводные интерфейсы (Wi-Fi/BT) в госзакупке ПК требуют явного обоснования — как правило ИБ не допускает их наличие';
    }

    // 19. Значение на английском языке (нет кириллицы) и не является аббревиатурой/числом
    const CYRILLIC_RE = /[а-яё]/i;
    const ABBREV_RE   = /^[A-Z0-9 \-+.,;:()x×\/\\"'°%*@#]+$/i;
    const valueTrimmed = value.trim();
    const isLongEnglish = valueTrimmed.length > 10 && !CYRILLIC_RE.test(valueTrimmed);
    const isPureAbbrev  = ABBREV_RE.test(valueTrimmed) && valueTrimmed.length <= 30;
    if (isLongEnglish && !isPureAbbrev) {
      (item as SpecItem)._warning = (item._warning ? item._warning + '; ' : '') +
        'Значение на английском языке — ТЗ должно быть на русском (44-ФЗ ст. 21, Приказ Минфина № 126н)';
    }

    // 20. Точные размеры с дюймами/фунтами (характеристика конкретной модели) — предупреждение
    const MODEL_DIM_RE = /\d+(\.\d+)?\s*(inch|in\b|lbs?\b|lb\b|pt\b|liter\b)/i;
    if (MODEL_DIM_RE.test(value)) {
      (item as SpecItem)._warning = (item._warning ? item._warning + '; ' : '') +
        'Дюймы/фунты/литры — единицы конкретной модели. Укажите требования в метрических единицах (мм, кг) с «не более»';
    }

    // 21. Гарантия для ПК/серверов: если 12 мес и контекст ПК/монитор → рекомендовать 36 мес
    if (/гарантия/i.test(nameLower)) {
      const isShortWarranty = /^(не\s+менее\s+)?12\b/.test(value.trim());
      const isPcOrMonitor = /системн|пк\b|компьютер|desktop|workstation|монитор|monitor|принтер|server|сервер/i.test(groupLower);
      if (isShortWarranty && isPcOrMonitor) {
        (item as SpecItem)._warning = (item._warning ? item._warning + '; ' : '') +
          'Для ВТ рекомендуется гарантия не менее 36 месяцев (Постановление Правительства РФ № 1875 и практика ФАС)';
      }
    }

    return { ...item, group, name, value, unit };
  });
}

/** Инферит единицу измерения из контекста имени/значения характеристики */
function inferUnit(nameLower: string, value: string): string {
  const v = value.toLowerCase();
  // Массовые/весовые
  if (/масса|вес/.test(nameLower)) return 'кг';
  // Размеры
  if (/габарит|размер|ширин|высот|глубин|толщин|диаметр|длин/.test(nameLower)) return 'мм';
  // Мощность
  if (/мощност|потреблен|tdp/.test(nameLower)) return 'Вт';
  // Шум
  if (/шум|громкост/.test(nameLower)) return 'дБА';
  // Температура
  if (/температур/.test(nameLower)) return '°C';
  // Ёмкость/объём дисков
  if (/объ[её]м|[её]мкост/.test(nameLower) && /гб|тб|мб|\d/.test(v)) {
    if (/тб/i.test(v)) return 'ТБ';
    if (/мб/i.test(v)) return 'МБ';
    return 'ГБ';
  }
  // Частота
  if (/частот/.test(nameLower)) {
    if (/мгц/i.test(v)) return 'МГц';
    return 'ГГц';
  }
  // Количество
  if (/количеств|число|кол-во|портов|разъем|слот|ядер|поток/.test(nameLower)) return 'шт';
  // Гарантия / срок
  if (/гарант|срок|поддержк/.test(nameLower)) return 'мес';
  // Диагональ
  if (/диагональ/.test(nameLower)) return 'дюйм';
  // Яркость
  if (/яркост/.test(nameLower)) return 'кд/м²';
  // Скорость сети
  if (/скорост.*сет|пропускн/.test(nameLower)) return 'Мбит/с';
  // Разрешение
  if (/разрешен/.test(nameLower)) return 'пикс';
  // Чистый бинарный признак
  if (/^(да|нет|есть|имеется|предусмотрено|наличие)$/i.test(value.trim())) return 'наличие';
  // Текстовое описание
  if (/тип|вид|формат|стандарт|интерфейс|класс|категори|протокол|режим/.test(nameLower)) return '—';
  // Fallback
  return '—';
}

/**
 * Попытка восстановить обрезанный JSON (когда ИИ не уложился в max_tokens).
 * Стратегия: убираем последнюю неполную запись и закрываем скобки.
 */
function repairTruncatedJson(raw: string): string {
  let s = raw.trim();
  // Убираем trailing запятую и незавершённый объект
  // Пример: ...}, {"group":"Foo","name":"Ba  ← обрезано
  // Ищем последний полный объект в массиве specs
  const lastFullObj = s.lastIndexOf('}');
  if (lastFullObj < 0) return s;

  s = s.slice(0, lastFullObj + 1);

  // Закрываем незакрытые скобки
  const opens = { '{': 0, '[': 0 };
  for (const ch of s) {
    if (ch === '{') opens['{']++;
    if (ch === '}') opens['{']--;
    if (ch === '[') opens['[']++;
    if (ch === ']') opens['[']--;
  }
  // Закрываем в обратном порядке
  for (let i = 0; i < opens['[']; i++) s += ']';
  for (let i = 0; i < opens['{']; i++) s += '}';

  return s;
}

export function parseAiResponse(text: string): {
  meta: Record<string, string>;
  specs: SpecItem[];
} {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  // 1. Пробуем распарсить напрямую
  try {
    const obj = JSON.parse(cleaned);
    if (obj && Array.isArray(obj.specs)) {
      return { meta: obj.meta || {}, specs: obj.specs as SpecItem[] };
    }
    if (Array.isArray(obj)) {
      return { meta: {}, specs: obj as SpecItem[] };
    }
  } catch {
    // JSON невалиден — пробуем починить
  }

  // 2. Пробуем восстановить обрезанный JSON
  try {
    const repaired = repairTruncatedJson(cleaned);
    const obj = JSON.parse(repaired);
    if (obj && Array.isArray(obj.specs)) {
      return { meta: obj.meta || {}, specs: obj.specs as SpecItem[] };
    }
    if (Array.isArray(obj)) {
      return { meta: {}, specs: obj as SpecItem[] };
    }
  } catch {
    // всё равно не удалось
  }

  // 3. Последняя попытка — вытащить specs массив регуляркой
  try {
    const specsMatch = cleaned.match(/"specs"\s*:\s*\[[\s\S]*$/);
    if (specsMatch) {
      let arr = specsMatch[0].replace(/^"specs"\s*:\s*/, '');
      arr = repairTruncatedJson(arr);
      const specs = JSON.parse(arr);
      if (Array.isArray(specs)) {
        // Пробуем вытащить meta
        const metaMatch = cleaned.match(/"meta"\s*:\s*(\{[^}]*\})/);
        const meta = metaMatch ? JSON.parse(metaMatch[1]) : {};
        return { meta, specs: specs as SpecItem[] };
      }
    }
  } catch {
    // ignore
  }

  return { meta: {}, specs: [] };
}
