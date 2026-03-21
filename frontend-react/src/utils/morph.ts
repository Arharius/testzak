const GENITIVE_DICT: Record<string, string> = {
  'системный блок': 'системных блоков',
  'ноутбук': 'ноутбуков',
  'моноблок': 'моноблоков',
  'сервер': 'серверов',
  'планшет': 'планшетов',
  'тонкий клиент': 'тонких клиентов',
  'монитор': 'мониторов',
  'принтер': 'принтеров',
  'многофункциональное устройство (мфу)': 'многофункциональных устройств (МФУ)',
  'сканер': 'сканеров',
  'клавиатура': 'клавиатур',
  'мышь компьютерная': 'мышей компьютерных',
  'kvm-переключатель': 'KVM-переключателей',
  'источник бесперебойного питания (ибп)': 'источников бесперебойного питания (ИБП)',
  'проектор': 'проекторов',
  'интерактивная панель (доска)': 'интерактивных панелей (досок)',
  'веб-камера': 'веб-камер',
  'гарнитура / наушники': 'гарнитур / наушников',
  'коммутатор': 'коммутаторов',
  'маршрутизатор': 'маршрутизаторов',
  'межсетевой экран (firewall / ngfw)': 'межсетевых экранов (Firewall / NGFW)',
  'точка доступа wi-fi': 'точек доступа Wi-Fi',
  'сетевое хранилище (nas)': 'сетевых хранилищ (NAS)',
  'патч-панель': 'патч-панелей',
  'медиаконвертер': 'медиаконвертеров',
  'ssd-накопитель': 'SSD-накопителей',
  'hdd-накопитель': 'HDD-накопителей',
  'оперативная память (ram)': 'оперативной памяти (RAM)',
  'флеш-накопитель (usb)': 'флеш-накопителей (USB)',
  'оптический диск (cd/dvd/bd)': 'оптических дисков (CD/DVD/BD)',
  'картридж (тонер-картридж)': 'картриджей (тонер-картриджей)',
  'барабан (фотобарабан / drum)': 'барабанов (фотобарабанов / drum)',
  'шредер (уничтожитель документов)': 'шредеров (уничтожителей документов)',
  'ламинатор': 'ламинаторов',
  'переплётная машина': 'переплётных машин',
  'внешний оптический привод (cd/dvd/bd)': 'внешних оптических приводов (CD/DVD/BD)',
  'тестер кабеля / lan / телефонный': 'тестеров кабеля / LAN / телефонных',
  'набор инструментов': 'наборов инструментов',
  'масло / смазка для шредера': 'масла / смазки для шредера',
  'колонки / акустическая система': 'колонок / акустических систем',
  'видеоадаптер / переходник (hdmi/dp/vga/usb-c)': 'видеоадаптеров / переходников (HDMI/DP/VGA/USB-C)',
  'комплект клавиатура + мышь': 'комплектов клавиатура + мышь',
  'патч-корд (кабель витая пара)': 'патч-кордов (кабелей витая пара)',
  'коннектор rj-45 / штекер 8p8c': 'коннекторов RJ-45 / штекеров 8P8C',
  'usb-токен / ключевой носитель': 'USB-токенов / ключевых носителей',
  'кабель hdmi': 'кабелей HDMI',
  'кабель displayport (dp)': 'кабелей DisplayPort (DP)',
  'кабель vga': 'кабелей VGA',
  'кабель dvi': 'кабелей DVI',
  'кабель usb (type-a / type-c / micro / mini)': 'кабелей USB (Type-A / Type-C / Micro / Mini)',
  'кабель питания (c13/c14, c19/c20, евровилка)': 'кабелей питания (C13/C14, C19/C20, евровилка)',
  'оптический кабель (патч-корд lc/sc/fc/st)': 'оптических кабелей (патч-кордов LC/SC/FC/ST)',
  'кабель ethernet cat.6a / cat.7 / cat.8': 'кабелей Ethernet Cat.6a / Cat.7 / Cat.8',
  'sfp / sfp+ / qsfp модуль (трансивер)': 'SFP / SFP+ / QSFP модулей (трансиверов)',
  'usb-хаб / usb-разветвитель': 'USB-хабов / USB-разветвителей',
  'usb-удлинитель активный / usb extender': 'USB-удлинителей активных / USB extender',
  'kvm-удлинитель / kvm extender': 'KVM-удлинителей / KVM extender',
  'usb-адаптер / переходник (usb-lan, usb-bt, usb-wi‑fi)': 'USB-адаптеров / переходников (USB-LAN, USB-BT, USB-Wi‑Fi)',
  'сетевой фильтр / защитный удлинитель': 'сетевых фильтров / защитных удлинителей',
  'удлинитель электрический': 'удлинителей электрических',
  'акб / батарейный модуль для ибп': 'АКБ / батарейных модулей для ИБП',
  'корпус системного блока': 'корпусов системных блоков',
  'raid-контроллер': 'RAID-контроллеров',
  'товар': 'товаров',
  'лицензия': 'лицензий',
  'программное обеспечение': 'программного обеспечения',
  'оборудование': 'оборудования',
  'комплекс': 'комплексов',
  'комплект': 'комплектов',
  'cd-r диск': 'CD-R дисков',
  'cd-rw диск': 'CD-RW дисков',
  'dvd-r / dvd+r диск': 'DVD-R / DVD+R дисков',
  'dvd-rw / dvd+rw диск': 'DVD-RW / DVD+RW дисков',
  'bd-r / bd-re диск': 'BD-R / BD-RE дисков',
};

function declineLastWord(word: string): string {
  const w = word.trim();
  if (!w) return w;

  if (/[аеёиоуыэюя]$/i.test(w) === false && /[а-яё]/i.test(w)) {
    if (w.endsWith('тель') || w.endsWith('Тель')) {
      return w.slice(0, -1) + 'ей';
    }
    if (w.endsWith('ль') || w.endsWith('рь') || w.endsWith('нь')) {
      return w.slice(0, -1) + 'ей';
    }
    if (w.endsWith('ец')) {
      return w.slice(0, -2) + 'цев';
    }
    if (w.endsWith('ёк') || w.endsWith('ек')) {
      return w.slice(0, -2) + 'ков';
    }
    if (w.endsWith('ок') && w.length > 3) {
      return w.slice(0, -2) + 'ков';
    }
    if (w.endsWith('й')) {
      return w.slice(0, -1) + 'ев';
    }
    if (/[жчшщ]$/i.test(w)) {
      return w + 'ей';
    }
    return w + 'ов';
  }

  if (w.endsWith('ия') || w.endsWith('Ия')) {
    return w.slice(0, -1) + 'й';
  }
  if (w.endsWith('ка') && w.length > 3) {
    const base = w.slice(0, -2);
    const lastTwo = base.slice(-2);
    if (/[йь]$/.test(base)) return base.slice(0, -1) + 'ек';
    if (/[жчшщ]к$/i.test(w.slice(-3))) return base + 'ек';
    return base + 'ок';
  }
  if (w.endsWith('ра') || w.endsWith('на') || w.endsWith('та') || w.endsWith('да') || w.endsWith('ла') || w.endsWith('ва') || w.endsWith('за') || w.endsWith('ба') || w.endsWith('па') || w.endsWith('ма') || w.endsWith('са') || w.endsWith('фа') || w.endsWith('ца') || w.endsWith('ша') || w.endsWith('жа') || w.endsWith('ха')) {
    return w.slice(0, -1);
  }
  if (w.endsWith('а')) {
    return w.slice(0, -1);
  }
  if (w.endsWith('ь') && /[а-яё]/i.test(w)) {
    return w.slice(0, -1) + 'ей';
  }

  if (w.endsWith('ие') || w.endsWith('ье')) {
    return w.slice(0, -1) + 'й';
  }
  if (w.endsWith('о')) {
    return w.slice(0, -1);
  }
  if (w.endsWith('е')) {
    return w.slice(0, -1) + 'й';
  }

  return w + 'ов';
}

function declineAdjectiveGenPlural(adj: string): string {
  if (/ый$/i.test(adj)) return adj.slice(0, -2) + 'ых';
  if (/ий$/i.test(adj)) return adj.slice(0, -2) + 'их';
  if (/ой$/i.test(adj)) return adj.slice(0, -2) + 'ых';
  if (/ая$/i.test(adj)) return adj.slice(0, -2) + 'ых';
  if (/яя$/i.test(adj)) return adj.slice(0, -2) + 'их';
  if (/ое$/i.test(adj)) return adj.slice(0, -2) + 'ых';
  if (/ее$/i.test(adj)) return adj.slice(0, -2) + 'их';
  return adj;
}

function isAdjective(word: string): boolean {
  return /(?:ый|ий|ой|ая|яя|ое|ее)$/i.test(word);
}

function declinePhraseGenPlural(phrase: string): string {
  const parenthetical = phrase.match(/^(.+?)(\s*\(.+\)\s*)$/);
  let main = parenthetical ? parenthetical[1].trim() : phrase.trim();
  const suffix = parenthetical ? parenthetical[2] : '';

  const words = main.split(/\s+/);
  if (words.length === 0) return phrase;

  const declined = words.map((w, i) => {
    if (i < words.length - 1 && isAdjective(w)) {
      return declineAdjectiveGenPlural(w);
    }
    if (i === words.length - 1) {
      return declineLastWord(w);
    }
    return w;
  });

  return declined.join(' ') + suffix;
}

export function toGenitive(name: string): string {
  if (!name || !name.trim()) return name;
  const key = name.toLowerCase().trim();
  if (GENITIVE_DICT[key]) return GENITIVE_DICT[key];
  return declinePhraseGenPlural(name.trim());
}
