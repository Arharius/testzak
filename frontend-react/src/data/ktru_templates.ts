export interface KTRUCharacteristic {
  name: string;
  value: string;
  unit: string;
}

export interface KTRUTemplate {
  name: string;
  okpd2: string;
  category: string;
  characteristics: KTRUCharacteristic[];
}

export const KTRU_TEMPLATES: Record<string, KTRUTemplate> = {
  "26.20.15.110": {
    name: "Компьютер персональный",
    okpd2: "26.20.15.110",
    category: "ТОВАР",
    characteristics: [
      { name: "Тип", value: "Настольный (Desktop)", unit: "тип" },
      { name: "Форм-фактор корпуса", value: "Tower, SFF или USFF", unit: "тип" },
      { name: "Архитектура процессора", value: "x86-64", unit: "тип" },
      { name: "Количество ядер процессора", value: "не менее 4", unit: "шт" },
      { name: "Тактовая частота процессора (базовая)", value: "не менее 2.4", unit: "ГГц" },
      { name: "Объём оперативной памяти", value: "не менее 8", unit: "ГБ" },
      { name: "Тип оперативной памяти", value: "DDR4 или DDR5", unit: "тип" },
      { name: "Объём накопителя", value: "не менее 256", unit: "ГБ" },
      { name: "Тип накопителя", value: "SSD", unit: "тип" },
      { name: "Порты USB 3.0 и выше", value: "не менее 4", unit: "шт" },
      { name: "Видеовыход", value: "HDMI или DisplayPort, не менее 1", unit: "шт" },
      { name: "Сетевой интерфейс", value: "Ethernet RJ-45, не менее 1 Гбит/с", unit: "тип" },
      { name: "Потребляемая мощность", value: "не более 65", unit: "Вт" },
      { name: "Класс энергоэффективности", value: "не ниже «А»", unit: "класс" },
      { name: "Совместимость с отечественными ОС", value: "Astra Linux, ALT Linux или эквивалент из реестра Минцифры", unit: "совместимость" },
      { name: "Гарантийный срок", value: "не менее 36", unit: "мес" },
    ]
  },
  "26.20.17.110": {
    name: "Монитор",
    okpd2: "26.20.17.110",
    category: "ТОВАР",
    characteristics: [
      { name: "Диагональ экрана", value: "не менее 21.5", unit: "дюйм" },
      { name: "Разрешение", value: "не менее 1920 x 1080 (FHD)", unit: "пикс" },
      { name: "Тип матрицы", value: "IPS, VA или эквивалент", unit: "тип" },
      { name: "Яркость", value: "не менее 250", unit: "кд/м²" },
      { name: "Контрастность", value: "не менее 1000:1", unit: "—" },
      { name: "Время отклика", value: "не более 8", unit: "мс" },
      { name: "Угол обзора", value: "не менее 178° по горизонтали и вертикали", unit: "°" },
      { name: "Частота обновления", value: "не менее 60", unit: "Гц" },
      { name: "Видеовход HDMI", value: "не менее 1 порта, версия не ниже 1.4", unit: "шт" },
      { name: "Покрытие экрана", value: "матовое, антибликовое", unit: "тип" },
      { name: "Регулировка наклона", value: "от -5° до +20°", unit: "°" },
      { name: "Крепление VESA", value: "75x75 или 100x100 мм", unit: "мм" },
      { name: "Потребляемая мощность", value: "не более 25", unit: "Вт" },
      { name: "Класс энергоэффективности", value: "не ниже «А»", unit: "класс" },
      { name: "Гарантийный срок", value: "не менее 36", unit: "мес" },
    ]
  },
  "26.80.13.000": {
    name: "DVD-привод внешний USB",
    okpd2: "26.80.13.000",
    category: "ТОВАР",
    characteristics: [
      { name: "Интерфейс", value: "USB 3.0", unit: "тип" },
      { name: "Скорость записи DVD-R", value: "не менее 8x", unit: "—" },
      { name: "Скорость чтения DVD", value: "не менее 16x", unit: "—" },
      { name: "Поддерживаемые форматы", value: "DVD-R/RW, DVD+R/RW, CD-R/RW", unit: "—" },
      { name: "Буфер", value: "не менее 2", unit: "МБ" },
      { name: "Шум при работе", value: "не более 45", unit: "дБ" },
      { name: "Потребляемая мощность", value: "не более 5", unit: "Вт" },
      { name: "Гарантийный срок", value: "не менее 12", unit: "мес" },
    ]
  },
  "26.20.22.000": {
    name: "Ноутбук",
    okpd2: "26.20.22.000",
    category: "ТОВАР",
    characteristics: [
      { name: "Диагональ экрана", value: "не менее 14", unit: "дюйм" },
      { name: "Разрешение", value: "не менее 1920 x 1080 (FHD)", unit: "пикс" },
      { name: "Количество ядер процессора", value: "не менее 4", unit: "шт" },
      { name: "Тактовая частота", value: "не менее 2.0", unit: "ГГц" },
      { name: "Объём оперативной памяти", value: "не менее 8", unit: "ГБ" },
      { name: "Объём накопителя", value: "не менее 256", unit: "ГБ" },
      { name: "Тип накопителя", value: "SSD NVMe или SATA", unit: "тип" },
      { name: "Ёмкость аккумулятора", value: "не менее 40", unit: "Вт·ч" },
      { name: "Время работы от аккумулятора", value: "не менее 6", unit: "час" },
      { name: "Порт USB 3.0 и выше", value: "не менее 2", unit: "шт" },
      { name: "Видеовыход HDMI", value: "не менее 1", unit: "шт" },
      { name: "Сетевой интерфейс Ethernet", value: "не менее 100 Мбит/с", unit: "тип" },
      { name: "Класс энергоэффективности", value: "не ниже «А»", unit: "класс" },
      { name: "Совместимость с ОС", value: "Astra Linux, ALT Linux или эквивалент из реестра Минцифры", unit: "совместимость" },
      { name: "Гарантийный срок", value: "не менее 12", unit: "мес" },
    ]
  },
  "28.23.13.000": {
    name: "МФУ лазерное",
    okpd2: "28.23.13.000",
    category: "ТОВАР",
    characteristics: [
      { name: "Тип печати", value: "Лазерный", unit: "тип" },
      { name: "Функции", value: "печать, копирование, сканирование", unit: "тип" },
      { name: "Формат", value: "A4", unit: "тип" },
      { name: "Скорость печати (ч/б)", value: "не менее 25", unit: "стр/мин" },
      { name: "Разрешение печати", value: "не менее 1200 x 1200", unit: "dpi" },
      { name: "Объём лотка", value: "не менее 250", unit: "листов" },
      { name: "Двусторонняя печать", value: "автоматическая, наличие", unit: "наличие" },
      { name: "Интерфейс USB", value: "USB 2.0, не менее 1", unit: "шт" },
      { name: "Сетевой интерфейс", value: "Ethernet RJ-45, не менее 100 Мбит/с", unit: "тип" },
      { name: "Ресурс картриджа", value: "не менее 3000", unit: "стр" },
      { name: "Класс энергоэффективности", value: "не ниже «А»", unit: "класс" },
      { name: "Гарантийный срок", value: "не менее 12", unit: "мес" },
    ]
  },
  "27.20.26.000": {
    name: "ИБП",
    okpd2: "27.20.26.000",
    category: "ТОВАР",
    characteristics: [
      { name: "Топология", value: "Line-Interactive или Off-line", unit: "тип" },
      { name: "Мощность (ВА)", value: "не менее 600", unit: "ВА" },
      { name: "Мощность (Вт)", value: "не менее 360", unit: "Вт" },
      { name: "Время работы при нагрузке 50%", value: "не менее 10", unit: "мин" },
      { name: "Розеток с защитой", value: "не менее 4", unit: "шт" },
      { name: "Интерфейс управления", value: "USB", unit: "тип" },
      { name: "Гарантийный срок", value: "не менее 24", unit: "мес" },
    ]
  },
  "26.20.16.110": {
    name: "Сервер",
    okpd2: "26.20.16.110",
    category: "ТОВАР",
    characteristics: [
      { name: "Форм-фактор", value: "Tower или 1U rack", unit: "тип" },
      { name: "Количество процессоров", value: "не менее 1", unit: "шт" },
      { name: "Количество ядер на процессор", value: "не менее 8", unit: "шт" },
      { name: "Объём ОЗУ", value: "не менее 32", unit: "ГБ" },
      { name: "Тип ОЗУ", value: "DDR4 ECC или DDR5 ECC", unit: "тип" },
      { name: "Объём дискового пространства", value: "не менее 1", unit: "ТБ" },
      { name: "Тип накопителей", value: "SSD или HDD SATA/SAS", unit: "тип" },
      { name: "Сетевой интерфейс", value: "Ethernet 1 Гбит/с, не менее 2 портов", unit: "тип" },
      { name: "Порты USB", value: "не менее 4", unit: "шт" },
      { name: "Управление (IPMI/iDRAC/iLO)", value: "наличие", unit: "наличие" },
      { name: "Совместимость с отечественными ОС", value: "Astra Linux, ALT Linux или РЕД ОС", unit: "совместимость" },
      { name: "Гарантийный срок", value: "не менее 36", unit: "мес" },
    ]
  },
  "26.20.40.000": {
    name: "Коммутатор Ethernet",
    okpd2: "26.20.40.000",
    category: "ТОВАР",
    characteristics: [
      { name: "Тип устройства", value: "Коммутатор (Switch) управляемый", unit: "тип" },
      { name: "Количество портов RJ-45", value: "не менее 24", unit: "шт" },
      { name: "Скорость портов", value: "не менее 1 Гбит/с", unit: "Гбит/с" },
      { name: "Таблица MAC-адресов", value: "не менее 8192", unit: "записей" },
      { name: "Пропускная способность", value: "не менее 56 Гбит/с", unit: "Гбит/с" },
      { name: "Uplink порты SFP/SFP+", value: "не менее 2", unit: "шт" },
      { name: "Поддержка VLAN (802.1Q)", value: "наличие", unit: "наличие" },
      { name: "Управление", value: "Web-интерфейс, CLI, SNMP v2c/v3", unit: "тип" },
      { name: "Совместимость с ОС", value: "Astra Linux, РЕД ОС", unit: "совместимость" },
      { name: "Гарантийный срок", value: "не менее 36", unit: "мес" },
    ]
  },
  "58.29.29.000": {
    name: "Программное обеспечение (лицензия)",
    okpd2: "58.29.29.000",
    category: "ПО",
    characteristics: [
      { name: "Тип лицензии", value: "Постоянная (бессрочная)", unit: "тип" },
      { name: "Количество рабочих мест", value: "не менее 1", unit: "раб. мест" },
      { name: "Наличие в реестре Минцифры", value: "включено в реестр отечественного ПО", unit: "статус" },
      { name: "Техническая поддержка", value: "не менее 12", unit: "мес" },
      { name: "Способ активации", value: "офлайн-активация без подключения к интернету", unit: "тип" },
      { name: "Передача прав", value: "права на использование передаются заказчику", unit: "тип" },
    ]
  },
};

export function getTemplate(okpd2: string): KTRUTemplate | null {
  return KTRU_TEMPLATES[okpd2] || null;
}

export function searchTemplates(query: string): KTRUTemplate[] {
  const q = query.toLowerCase();
  return Object.values(KTRU_TEMPLATES).filter(t =>
    t.name.toLowerCase().includes(q) ||
    t.okpd2.includes(q)
  );
}
