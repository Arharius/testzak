export interface SpecItem {
  group?: string;
  name?: string;
  value?: string;
  unit?: string;
  _warning?: string;
  _fixed?: boolean;
  [key: string]: unknown;
}

const BRAND_TOKEN_PATTERN = /\b(Intel|AMD|Nvidia|Samsung|Micron|Kingston|WD|Western\s+Digital|Seagate|Toshiba|Qualcomm|Broadcom|Realtek|Marvell|Mellanox|Hynix|SK\s*Hynix|Lenovo|Huawei|Cisco|Dell|Acer|Asus|Apple|MSI|Gigabyte|Supermicro|HP|HPE|Интел|Самсунг|Леново|Хуавей|Делл)\b/gi;
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

export function postProcessSpecs(specs: SpecItem[]): SpecItem[] {
  return specs.map((item) => {
    let name = String(item.name ?? '');
    let group = String(item.group ?? '');
    let value = String(item.value ?? '');
    let unit  = String(item.unit  ?? '');

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
      if (/^DDR\d?(\s*\d+)?$/i.test(value.trim()) && !/или выше|или DDR5|or higher/i.test(value)) {
        value = 'DDR4 или выше';
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

    return { ...item, group, name, value, unit };
  });
}

export function parseAiResponse(text: string): {
  meta: Record<string, string>;
  specs: SpecItem[];
} {
  try {
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const obj = JSON.parse(cleaned);
    if (obj && Array.isArray(obj.specs)) {
      return { meta: obj.meta || {}, specs: obj.specs as SpecItem[] };
    }
    if (Array.isArray(obj)) {
      return { meta: {}, specs: obj as SpecItem[] };
    }
  } catch {
    // ignore
  }
  return { meta: {}, specs: [] };
}
