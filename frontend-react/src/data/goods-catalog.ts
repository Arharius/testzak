export type GoodsType = string;

export interface HardSpec {
  group: string;
  name: string;
  value: string;
  unit?: string;
}

export interface GoodsItem {
  name: string;
  okpd2: string;
  okpd2name: string;
  ktruFixed?: string;
  ktruByRam?: Array<{ min: number; code: string }>;
  isSoftware?: boolean;
  placeholder?: string;
  hardTemplate?: HardSpec[];
}

export const GOODS_CATALOG: Record<string, GoodsItem> = {
  // ── Компьютеры ──
  pc: {
    name: 'Системный блок',
    okpd2: '26.20.15.000',
    okpd2name: 'Машины вычислительные электронные прочие и их блоки',
    ktruByRam: [
      { min: 128, code: '26.20.15.000-00000031' },
      { min: 64,  code: '26.20.15.000-00000030' },
      { min: 32,  code: '26.20.15.000-00000029' },
      { min: 16,  code: '26.20.15.000-00000028' },
      { min: 8,   code: '26.20.15.000-00000026' },
      { min: 0,   code: '26.20.15.000-00000024' },
    ],
    placeholder: 'Например: Intel NUC 13 Pro, IRU 310H6SM, Yadro Vegman N110...',
  },
  laptop: {
    name: 'Ноутбук',
    okpd2: '26.20.11.110',
    okpd2name: 'Ноутбуки, в том числе портативные в защищённом исполнении',
    ktruFixed: '26.20.11.110-00000001',
    placeholder: 'Например: Aquarius Cmp NS685U, Huawei MateBook D16, Yadro Tardis...',
  },
  monoblock: {
    name: 'Моноблок',
    okpd2: '26.20.11.130',
    okpd2name: 'Персональные компьютеры в форм-факторе моноблок',
    ktruFixed: '26.20.11.130-00000001',
    placeholder: 'Например: IRU Office 225, iRU 2310, Aquarius Imb T894...',
  },
  server: {
    name: 'Сервер',
    okpd2: '26.20.14.000',
    okpd2name: 'Серверы вычислительные',
    ktruFixed: '26.20.14.000-00000189',
    placeholder: 'Например: Aquarius Server T50 D224, Yadro Vegman R2212...',
  },
  tablet: {
    name: 'Планшет',
    okpd2: '26.20.11.120',
    okpd2name: 'Планшетные компьютеры',
    ktruFixed: '26.20.11.120-00000001',
    placeholder: 'Например: Aquarius Cmp T836, Irbis TW101...',
  },
  thinClient: {
    name: 'Тонкий клиент',
    okpd2: '26.20.15.000',
    okpd2name: 'Машины вычислительные электронные прочие и их блоки',
    ktruFixed: '26.20.15.000-00000443',
    placeholder: 'Например: Wyse 5070, HP t640, Тонкий клиент Kraftway...',
  },
  // ── Периферия и оргтехника ──
  monitor: {
    name: 'Монитор',
    okpd2: '26.20.17.110',
    okpd2name: 'Мониторы для компьютеров с плоским экраном',
    ktruFixed: '26.20.17.110-00000003',
    placeholder: 'Например: IRU F2200, Aquarius AQMON-M238H, BenQ GW2480...',
  },
  printer: {
    name: 'Принтер',
    okpd2: '26.20.16.120',
    okpd2name: 'Принтеры для вычислительных машин',
    ktruFixed: '26.20.16.120-00000004',
    placeholder: 'Например: Xerox B210, HP LaserJet Pro M404dn...',
  },
  mfu: {
    name: 'Многофункциональное устройство (МФУ)',
    okpd2: '26.20.18.000',
    okpd2name: 'Многофункциональные устройства',
    ktruFixed: '26.20.18.000-00000001',
    placeholder: 'Например: Xerox B235, Pantum BM5100ADW, HP LaserJet MFP M236d...',
  },
  scanner: {
    name: 'Сканер',
    okpd2: '26.20.16.130',
    okpd2name: 'Сканеры для вычислительных машин',
    ktruFixed: '26.20.16.130-00000002',
    placeholder: 'Например: Canon DR-M260, Fujitsu fi-8150...',
  },
  keyboard: {
    name: 'Клавиатура',
    okpd2: '26.20.16.110',
    okpd2name: 'Клавиатуры для компьютеров',
    ktruFixed: '26.20.16.110-00000002',
    placeholder: 'Например: Гарда КМ-33, Оклик 140M, Genius Smart KB-100...',
  },
  mouse: {
    name: 'Мышь компьютерная',
    okpd2: '26.20.16.170',
    okpd2name: 'Манипуляторы типа «мышь»',
    ktruFixed: '26.20.16.170-00000002',
    placeholder: 'Например: Оклик 185MW, Гарда МШ-52, Logitech M100...',
  },
  kvm: {
    name: 'KVM-переключатель',
    okpd2: '26.20.16.190',
    okpd2name: 'Устройства ввода-вывода прочие',
    ktruFixed: '26.20.16.190-00000001',
    placeholder: 'Например: ATEN CS1308, TRENDnet TK-803R...',
  },
  ups: {
    name: 'Источник бесперебойного питания (ИБП)',
    okpd2: '27.11.60.000',
    okpd2name: 'Источники бесперебойного электропитания',
    ktruFixed: '27.11.60.000-00000001',
    placeholder: 'Например: Systeme Electric SMVS2000RU, APC BX1400UI...',
  },
  projector: {
    name: 'Проектор',
    okpd2: '26.70.19.110',
    okpd2name: 'Проекторы проекционные',
    ktruFixed: '26.70.19.110-00000001',
    placeholder: 'Например: Optoma X400LVe, Casio XJ-V100W...',
  },
  interactive: {
    name: 'Интерактивная панель (доска)',
    okpd2: '26.20.17.190',
    okpd2name: 'Устройства отображения информации прочие',
    ktruFixed: '26.20.17.190-00000001',
    placeholder: 'Например: Newline TT-75QB, BenQ RM7502K...',
  },
  webcam: {
    name: 'Веб-камера',
    okpd2: '26.20.16.190',
    okpd2name: 'Устройства ввода-вывода прочие',
    ktruFixed: '26.20.16.190-00000003',
    placeholder: 'Например: Logitech C920, Genius WideCam F100...',
  },
  headset: {
    name: 'Гарнитура / наушники',
    okpd2: '26.40.34.110',
    okpd2name: 'Наушники и гарнитуры',
    ktruFixed: '26.40.34.110-00000001',
    placeholder: 'Например: Jabra Evolve2 55, Plantronics Blackwire 3320...',
  },
  // ── Сетевое оборудование ──
  switch: {
    name: 'Коммутатор',
    okpd2: '26.30.11.190',
    okpd2name: 'Аппаратура для передачи данных прочая',
    ktruFixed: '26.30.11.190-00000001',
    placeholder: 'Например: Eltex MES2408P, Cisco SG110-16...',
  },
  router: {
    name: 'Маршрутизатор',
    okpd2: '26.30.11.130',
    okpd2name: 'Маршрутизаторы и шлюзы',
    ktruFixed: '26.30.11.130-00000001',
    placeholder: 'Например: Eltex ESR-10, Cisco ISR4321...',
  },
  firewall: {
    name: 'Межсетевой экран (Firewall / NGFW)',
    okpd2: '26.30.11.190',
    okpd2name: 'Аппаратура для передачи данных прочая',
    ktruFixed: '26.30.11.190-00000003',
    placeholder: 'Например: UserGate C150, Континент 4, S-Terra Gateway...',
  },
  accessPoint: {
    name: 'Точка доступа Wi-Fi',
    okpd2: '26.30.11.150',
    okpd2name: 'Аппаратура беспроводной связи для ЛВС',
    ktruFixed: '26.30.11.150-00000001',
    placeholder: 'Например: Eltex WEP-2ac, Cisco AIR-AP2802I, Ubiquiti UAP-AC-PRO...',
  },
  nas: {
    name: 'Сетевое хранилище (NAS)',
    okpd2: '26.20.14.000',
    okpd2name: 'Серверы вычислительные (хранения данных)',
    ktruFixed: '26.20.14.000-00000189',
    placeholder: 'Например: Synology DS923+, QNAP TS-464, Infortrend EonStor...',
  },
  patchPanel: {
    name: 'Патч-панель',
    okpd2: '27.33.19.190',
    okpd2name: 'Устройства коммутационные прочие',
    ktruFixed: '27.33.19.190-00000001',
    placeholder: 'Например: Hyperline PP-19-24-8P8C-C5E-110D, AMP 24-port...',
  },
  mediaConverter: {
    name: 'Медиаконвертер',
    okpd2: '26.30.11.190',
    okpd2name: 'Аппаратура для передачи данных прочая',
    ktruFixed: '26.30.11.190-00000002',
    placeholder: 'Например: TP-Link MC220L, D-Link DMC-G01LC...',
  },
  // ── Накопители и носители ──
  ssd: {
    name: 'SSD-накопитель',
    okpd2: '26.20.40.120',
    okpd2name: 'Накопители на твёрдотельной памяти',
    ktruFixed: '26.20.40.120-00000003',
    placeholder: 'Например: Samsung 870 EVO, Kingston A400...',
  },
  hdd: {
    name: 'HDD-накопитель',
    okpd2: '26.20.40.110',
    okpd2name: 'Накопители на жёстких магнитных дисках',
    ktruFixed: '26.20.40.110-00000001',
    placeholder: 'Например: Seagate Barracuda ST2000DM008, WD Blue WD20EZAZ...',
  },
  ram: {
    name: 'Оперативная память (RAM)',
    okpd2: '26.20.40.130',
    okpd2name: 'Модули памяти для вычислительных машин',
    ktruFixed: '26.20.40.130-00000001',
    placeholder: 'Например: Kingston DDR4 16GB 3200MHz, Samsung M378A2K43CB1...',
  },
  flashDrive: {
    name: 'Флеш-накопитель (USB)',
    okpd2: '26.20.21.000',
    okpd2name: 'Носители информации на флеш-памяти',
    ktruFixed: '26.20.21.000-00000001',
    placeholder: 'Например: Transcend JetFlash 790 32GB, Kingston DataTraveler...',
    hardTemplate: [
      { group: 'Основные характеристики', name: 'Интерфейс подключения', value: 'USB 3.0 (USB 3.2 Gen 1) или выше (с обратной совместимостью USB 2.0)' },
      { group: 'Основные характеристики', name: 'Ёмкость накопителя', value: 'не менее 32', unit: 'ГБ' },
      { group: 'Основные характеристики', name: 'Скорость чтения', value: 'не менее 60', unit: 'МБ/с' },
      { group: 'Основные характеристики', name: 'Скорость записи', value: 'не менее 15', unit: 'МБ/с' },
      { group: 'Основные характеристики', name: 'Форм-фактор', value: 'Компактный (подходит для использования в ноутбуке без значительного выступа)' },
      { group: 'Состояние', name: 'Состояние', value: 'Новый, в оригинальной упаковке производителя' },
    ],
  },
  dvd: {
    name: 'Оптический диск (CD/DVD/BD)',
    okpd2: '26.80.13.000',
    okpd2name: 'Носители для записи информации оптические',
    ktruFixed: '26.80.13.000-00000001',
    placeholder: 'Например: DVD-R Verbatim 4.7GB, DVD+RW, BD-R 25GB...',
    hardTemplate: [
      { group: 'Тип носителя', name: 'Тип оптического носителя', value: 'DVD-R однократной записи (при необходимости — DVD+R / DVD-RW / CD-R / BD-R — уточнить в наименовании)' },
      { group: 'Тип носителя', name: 'Ёмкость носителя', value: 'не менее 4,7', unit: 'ГБ' },
      { group: 'Тип носителя', name: 'Скорость записи', value: 'не менее 16×' },
      { group: 'Тип носителя', name: 'Диаметр диска', value: 'не менее 120', unit: 'мм' },
      { group: 'Тип носителя', name: 'Стандарт', value: 'Соответствует стандарту DVD Forum (DVD Specifications for Recordable Disc)' },
      { group: 'Состояние и упаковка', name: 'Состояние', value: 'Новый, не использованный, без механических повреждений и дефектов поверхности' },
      { group: 'Состояние и упаковка', name: 'Упаковка', value: 'В оригинальной упаковке производителя (шпиндель Cake Box или индивидуальный конверт/бокс)' },
    ],
  },
  tapeLib: {
    name: 'Ленточная библиотека / стриммер',
    okpd2: '26.20.40.140',
    okpd2name: 'Устройства хранения данных на магнитных лентах',
    ktruFixed: '26.20.40.140-00000001',
    placeholder: 'Например: HPE StoreEver MSL3040, Quantum Scalar i3...',
  },
  // ── Кабели и коммутация ──
  patchCord: {
    name: 'Патч-корд (кабель витая пара)',
    okpd2: '27.32.20.190',
    okpd2name: 'Кабели и провода для передачи данных прочие',
    ktruFixed: '27.32.20.190-00000001',
    placeholder: 'Например: Hyperline PC-LPM-UTP-RJ45-RJ45-C5e-2M, AMP категория 5e...',
    hardTemplate: [
      { group: 'Характеристики', name: 'Тип кабеля', value: 'UTP (неэкранированный) или F/UTP (экранированный) — уточнить по требованию заказчика' },
      { group: 'Характеристики', name: 'Категория', value: 'не ниже Cat.5e (в соответствии с ISO/IEC 11801 и ГОСТ Р 58472)' },
      { group: 'Характеристики', name: 'Длина', value: 'не менее 1', unit: 'м' },
      { group: 'Характеристики', name: 'Разъёмы', value: 'RJ-45 (8P8C) с обоих концов, обжатые в заводских условиях' },
      { group: 'Характеристики', name: 'Оболочка', value: 'ПВХ, устойчивая к механическим воздействиям' },
      { group: 'Состояние', name: 'Состояние', value: 'Новый, в оригинальной упаковке, без повреждений кабеля и разъёмов' },
    ],
  },
  fiberCable: {
    name: 'Кабель оптоволоконный',
    okpd2: '27.31.10.110',
    okpd2name: 'Кабели оптические для передачи данных',
    ktruFixed: '27.31.10.110-00000001',
    placeholder: 'Например: ОКС-1х4А-0,4/125-0,36/0,22-3,5/150, Corning SMF-28...',
  },
  hdmiCable: {
    name: 'Кабель HDMI / DisplayPort / VGA',
    okpd2: '27.32.20.190',
    okpd2name: 'Кабели для передачи видеосигнала',
    ktruFixed: '27.32.20.190-00000002',
    placeholder: 'Например: Кабель HDMI 2.0 Cablexpert 2м, DisplayPort 1.4 1,8м...',
    hardTemplate: [
      { group: 'Характеристики', name: 'Тип интерфейса', value: 'HDMI (или DisplayPort/VGA — уточнить в наименовании)' },
      { group: 'Характеристики', name: 'Версия стандарта', value: 'не ниже HDMI 2.0 (пропускная способность не менее 18 Гбит/с)' },
      { group: 'Характеристики', name: 'Максимальное поддерживаемое разрешение', value: 'не менее 3840 × 2160 (4K UHD) при 60 Гц' },
      { group: 'Характеристики', name: 'Длина кабеля', value: 'не менее 1,8', unit: 'м' },
      { group: 'Характеристики', name: 'Разъёмы', value: 'HDMI тип A — HDMI тип A (или иное — по требованию)' },
      { group: 'Состояние', name: 'Состояние', value: 'Новый, в оригинальной упаковке, без повреждений кабеля и разъёмов' },
    ],
  },
  powerCable: {
    name: 'Кабель питания / сетевой удлинитель',
    okpd2: '27.32.10.190',
    okpd2name: 'Кабели электрические прочие',
    ktruFixed: '27.32.10.190-00000001',
    placeholder: 'Например: Удлинитель сетевой Pilot S 5 розеток 5м, кабель IEC C13...',
    hardTemplate: [
      { group: 'Характеристики', name: 'Тип', value: 'Кабель питания / сетевой удлинитель (уточнить тип)' },
      { group: 'Характеристики', name: 'Разъём подключения к сети', value: 'Вилка евростандарт CEE 7/16 (Schuko) или IEC C13 — по требованию' },
      { group: 'Характеристики', name: 'Номинальное напряжение', value: 'не менее 250', unit: 'В' },
      { group: 'Характеристики', name: 'Номинальный ток', value: 'не менее 10', unit: 'А' },
      { group: 'Характеристики', name: 'Длина кабеля', value: 'не менее 1,5', unit: 'м' },
      { group: 'Состояние', name: 'Состояние', value: 'Новый, в оригинальной упаковке, без повреждений изоляции и разъёмов' },
    ],
  },
  rackCabinet: {
    name: 'Шкаф / стойка телекоммуникационная',
    okpd2: '27.33.19.110',
    okpd2name: 'Шкафы и стойки телекоммуникационные',
    ktruFixed: '27.33.19.110-00000001',
    placeholder: 'Например: ЦМО ШТК-М-42.6.8-44АА, Rittal TS IT 7989.000...',
  },
  // ── Серверное оборудование ──
  serverRack: {
    name: 'Сервер стоечный',
    okpd2: '26.20.14.000',
    okpd2name: 'Серверы вычислительные стоечные',
    ktruFixed: '26.20.14.000-00000189',
    placeholder: 'Например: Aquarius Server T50 D224, Yadro Vegman R2212...',
  },
  serverBlade: {
    name: 'Сервер лезвие (Blade)',
    okpd2: '26.20.14.000',
    okpd2name: 'Серверы вычислительные (лезвие)',
    ktruFixed: '26.20.14.000-00000190',
    placeholder: 'Например: HPE ProLiant BL460c, Dell PowerEdge M640...',
  },
  san: {
    name: 'СХД (система хранения данных)',
    okpd2: '26.20.14.000',
    okpd2name: 'Системы хранения данных',
    ktruFixed: '26.20.14.000-00000189',
    placeholder: 'Например: Yadro Tatlin Uni, Huawei OceanStor 5310...',
  },
  pdu: {
    name: 'Блок распределения питания (PDU)',
    okpd2: '27.33.19.130',
    okpd2name: 'Блоки распределения электропитания',
    ktruFixed: '27.33.19.130-00000001',
    placeholder: 'Например: APC AP7920, Eaton ePDU G3, Legrand PDU...',
  },
  kvm_server: {
    name: 'Консоль KVM серверная',
    okpd2: '26.20.16.190',
    okpd2name: 'Устройства управления серверной инфраструктурой',
    ktruFixed: '26.20.16.190-00000002',
    placeholder: 'Например: ATEN KN4116VA, Raritan Dominion KX III...',
  },
  // ── Расходные материалы ──
  cartridge: {
    name: 'Картридж для принтера / МФУ',
    okpd2: '20.59.12.120',
    okpd2name: 'Картриджи для электрографических печатающих устройств',
    ktruFixed: '20.59.12.120-00000002',
    placeholder: 'Например: HP CF230A, Canon 719, Xerox 106R03623...',
    hardTemplate: [
      { group: 'Тип картриджа', name: 'Совместимость (модель картриджа)', value: 'Указать конкретный артикул картриджа или совместимый (не менее ресурса оригинального)' },
      { group: 'Тип картриджа', name: 'Тип', value: 'Оригинальный или совместимый (аналог с идентичным ресурсом)' },
      { group: 'Тип картриджа', name: 'Совместимость с принтером/МФУ', value: 'Совместим с принтером/МФУ модели (указать модель устройства)' },
      { group: 'Характеристики', name: 'Тип тонера/чернил', value: 'Лазерный тонер-картридж (для лазерных принтеров) / струйный (для струйных)' },
      { group: 'Характеристики', name: 'Ресурс картриджа (страниц)', value: 'не менее ресурса оригинального картриджа при 5%-ном заполнении страницы', unit: 'стр.' },
      { group: 'Состояние', name: 'Состояние', value: 'Новый, в оригинальной (или аналогичной) заводской упаковке, не бывший в использовании' },
    ],
  },
  paper: {
    name: 'Бумага для оргтехники',
    okpd2: '17.12.14.190',
    okpd2name: 'Бумага для офисной техники',
    ktruFixed: '17.12.14.190-00000001',
    placeholder: 'Например: Svetocopy A4 80г/м², SvetoCopy Premium A4, КБС...',
    hardTemplate: [
      { group: 'Основные характеристики', name: 'Формат', value: 'А4 (210 × 297 мм)' },
      { group: 'Основные характеристики', name: 'Плотность бумаги', value: 'не менее 80', unit: 'г/м²' },
      { group: 'Основные характеристики', name: 'Белизна (по ISO 11475)', value: 'не менее 146', unit: '%' },
      { group: 'Основные характеристики', name: 'Класс бумаги', value: 'не ниже класса С (универсальная)' },
      { group: 'Основные характеристики', name: 'Количество листов в пачке', value: 'не менее 500', unit: 'листов' },
      { group: 'Упаковка', name: 'Упаковка пачки', value: 'В индивидуальной влагозащитной обёртке' },
      { group: 'Упаковка', name: 'Упаковка коробки', value: 'не менее 5 пачек в коробке' },
      { group: 'Состояние', name: 'Состояние', value: 'Новая, не использованная, без механических повреждений, без деформации листов' },
    ],
  },
  toner: {
    name: 'Тонер-порошок',
    okpd2: '20.59.12.000',
    okpd2name: 'Тонеры и красители для офисной техники',
    ktruFixed: '20.59.12.000-00000001',
    placeholder: 'Например: Тонер HP CE278A, тонер Samsung MLT-D101S...',
  },
  drum: {
    name: 'Фотобарабан (drum unit)',
    okpd2: '26.20.40.190',
    okpd2name: 'Комплектующие и запасные части для принтеров прочие',
    ktruFixed: '26.20.40.190-00000001',
    placeholder: 'Например: Brother DR-3300, OKI 44574302, Xerox 013R00670...',
  },
  // ── Системное и офисное ПО ──
  os: {
    name: 'Операционная система',
    okpd2: '58.29.11.000',
    okpd2name: 'Системы операционные',
    ktruFixed: '58.29.11.000-00000002',
    isSoftware: true,
    placeholder: 'Например: Astra Linux Special Edition, ALT Linux, РЕД ОС...',
  },
  office: {
    name: 'Офисный пакет',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение прикладное',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: МойОфис Стандартный, Р7-Офис, LibreOffice...',
  },
  virt: {
    name: 'Платформа виртуализации',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение (виртуализация)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: Базис.vCore, zVirt, Р-Виртуализация, VMware vSphere...',
  },
  vdi: {
    name: 'VDI / платформа виртуальных рабочих мест',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение прикладное (VDI)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: Termidesk, Базис.WorkPlace, Горизонт ВМ, RuDesktop...',
  },
  dbms: {
    name: 'СУБД (система управления базами данных)',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение (СУБД)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: PostgreSQL Pro Enterprise, Tantor SE, Jatoba, 1С:PostgreSQL...',
  },
  erp: {
    name: 'ERP / бухгалтерское ПО',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение прикладное (ERP/бухгалтерия)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: 1С:Предприятие 8.3, Галактика ERP, Парус...',
  },
  cad: {
    name: 'САПР (CAD/CAM)',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение (САПР)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: КОМПАС-3D, nanoCAD, Renga Architecture...',
  },
  license: {
    name: 'Лицензия на программное обеспечение',
    okpd2: '58.29.50.000',
    okpd2name: 'Услуги по предоставлению лицензий на право использовать ПО',
    ktruFixed: '58.29.50.000-00000001',
    isSoftware: true,
    placeholder: 'Например: Лицензия Microsoft Office, Adobe Acrobat...',
  },
  // ── Средства защиты информации ──
  antivirus: {
    name: 'Антивирус / средство антивирусной защиты',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение (средство защиты)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: Kaspersky Endpoint Security, Dr.Web Enterprise...',
  },
  edr: {
    name: 'EDR / защита конечных точек',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение (EDR)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: Kaspersky EDR, PT Sandbox, ESET Inspect...',
  },
  firewall_sw: {
    name: 'ПО межсетевого экрана',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение (средство сетевой защиты)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: UserGate Management Center, Континент ПО...',
  },
  vpn: {
    name: 'VPN / криптошлюз',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение (VPN/СКЗИ)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: ViPNet Client, ViPNet Coordinator, Континент-АП...',
  },
  dlp: {
    name: 'Система защиты от утечек (DLP)',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение (защита информации)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: InfoWatch Traffic Monitor, Solar Dozor, Zecurion DLP...',
  },
  siem: {
    name: 'SIEM-система (мониторинг событий ИБ)',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение (мониторинг ИБ)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: MaxPatrol SIEM, RuSIEM, Kaspersky SIEM...',
  },
  crypto: {
    name: 'Средство криптографической защиты (СКЗИ)',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение (СКЗИ)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: КриптоПро CSP, ViPNet Client, Signal-COM CSP...',
  },
  waf: {
    name: 'WAF / защита веб-приложений',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение (WAF)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: Positive Technologies AF, Solar appScreener...',
  },
  pam: {
    name: 'PAM / управление привилегированным доступом',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение (управление привилегированным доступом)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: Indeed PAM, Senhasegura, CyberArk, Wallix Bastion...',
  },
  iam: {
    name: 'IAM / IdM — управление учётными записями и доступом',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение (IdM/IAM)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: Indeed Access Manager, Solar inRights, 1IDM...',
  },
  pki: {
    name: 'PKI / удостоверяющий центр',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение (PKI/УЦ)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: КриптоПро УЦ 2.0, ViPNet PKI, Notary Service...',
  },
  // ── Коммуникации и совместная работа ──
  email: {
    name: 'Почтовый сервер / корпоративная почта',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение прикладное (почта)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: РуПост, Communigate Pro, Mailion, Zimbra...',
  },
  vks: {
    name: 'Система видеоконференцсвязи (ВКС) / мессенджер',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение прикладное (ВКС)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: TrueConf Server, Видеомост, iMind, МТС Линк...',
  },
  ecm: {
    name: 'СЭД / система электронного документооборота',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение прикладное (СЭД)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: ТЕЗИС, Directum RX, DocsVision, ЭЛДО...',
  },
  portal: {
    name: 'Корпоративный портал / интранет',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение прикладное (корпоративный портал)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: Битрикс24, 1С-Битрикс Корпоративный портал...',
  },
  project_sw: {
    name: 'Система управления проектами',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение прикладное (управление проектами)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: Jira, Bitrix24, GanttPro, Kaiten, Яндекс.Трекер...',
  },
  bpm: {
    name: 'BPM / система управления бизнес-процессами',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение прикладное (BPM)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: Comindware Platform, ELMA BPM, 1С:Документооборот...',
  },
  reporting: {
    name: 'Система сдачи отчётности / ЭДО с госорганами',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение прикладное (отчётность)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: КонтурЭкстерн, СБИС Отчётность, Такском-Доклайнер...',
  },
  // ── Управление ИТ и инфраструктурой ──
  backup_sw: {
    name: 'ПО резервного копирования',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение (резервное копирование)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: RuBackup, Кибер Бэкап, Bacula Enterprise...',
  },
  itsm: {
    name: 'ITSM / система управления ИТ-сервисами',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение прикладное (ITSM)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: SimpleOne, OTRS, Naumen Service Desk, Inframanager...',
  },
  monitoring: {
    name: 'Система мониторинга ИТ-инфраструктуры',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение прикладное (мониторинг)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: Zabbix, Prometheus, MaxPatrol VM...',
  },
  mdm: {
    name: 'MDM / управление мобильными устройствами',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение прикладное (MDM)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: SafePhone, МобилДок, РусМДМ, ESCOM.MDM...',
  },
  hr: {
    name: 'HRM / система управления персоналом',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение прикладное (HRM)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: 1С:Зарплата и управление персоналом, Добыто HRM...',
  },
  gis: {
    name: 'ГИС / геоинформационная система',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение прикладное (ГИС)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: NextGIS, ГеоМикс, Панорама ГИС, MapInfo...',
  },
  ldap: {
    name: 'Служба каталогов / LDAP-сервер',
    okpd2: '58.29.11.000',
    okpd2name: 'Программное обеспечение (служба каталогов)',
    ktruFixed: '58.29.11.000-00000005',
    isSoftware: true,
    placeholder: 'Например: АЛД Про, FreeIPA, OpenLDAP, Samba AD, РЕД АДМ...',
  },
  // ── Комплектующие ──
  cpu: {
    name: 'Процессор',
    okpd2: '26.20.40.160',
    okpd2name: 'Процессоры вычислительных машин',
    ktruFixed: '26.20.40.160-00000001',
    placeholder: 'Например: Intel Core i7-12700, AMD Ryzen 7 5800X, Elbrus-8C...',
  },
  gpu: {
    name: 'Видеокарта',
    okpd2: '26.20.40.170',
    okpd2name: 'Карты графические для вычислительных машин',
    ktruFixed: '26.20.40.170-00000001',
    placeholder: 'Например: NVIDIA RTX 4070, AMD Radeon RX 7600...',
  },
  motherboard: {
    name: 'Материнская плата',
    okpd2: '26.20.40.150',
    okpd2name: 'Платы материнские для вычислительных машин',
    ktruFixed: '26.20.40.150-00000001',
    placeholder: 'Например: ASUS PRIME Z790-A, Gigabyte B550 AORUS Elite...',
  },
  psu: {
    name: 'Блок питания (PSU)',
    okpd2: '26.20.40.190',
    okpd2name: 'Блоки питания для вычислительных машин',
    ktruFixed: '26.20.40.190-00000002',
    placeholder: 'Например: Be Quiet Pure Power 11 600W, Seasonic Focus GX-650...',
  },
  cooling: {
    name: 'Система охлаждения',
    okpd2: '26.20.40.190',
    okpd2name: 'Комплектующие для вычислительных машин прочие',
    ktruFixed: '26.20.40.190-00000003',
    placeholder: 'Например: Noctua NH-D15, ID-Cooling SE-214-XT...',
  },
  parts: {
    name: 'Запасные части / комплектующие прочие',
    okpd2: '26.20.40.190',
    okpd2name: 'Комплектующие и запасные части для вычислительных машин прочие',
    ktruFixed: '26.20.40.190-00000001',
    placeholder: 'Описание комплектующей...',
  },
  // ── Расходные материалы ИТ / мелочёвка ──
  battery: {
    name: 'Элемент питания (батарейки)',
    okpd2: '27.20.21.110',
    okpd2name: 'Элементы первичные и батареи первичных элементов щелочные',
    ktruFixed: '27.20.21.110-00000001',
    placeholder: 'Например: Duracell AA LR6, GP Ultra AA, Energizer AA (элемент питания AA / AAA / CR2032)...',
    hardTemplate: [
      { group: 'Тип элемента', name: 'Типоразмер', value: 'AA (LR6) — уточнить при необходимости (AAA / C / D / CR2032 / CR2025)' },
      { group: 'Тип элемента', name: 'Тип химической системы', value: 'Щелочная (Alkaline)' },
      { group: 'Технические характеристики', name: 'Номинальное напряжение', value: 'не менее 1,5', unit: 'В' },
      { group: 'Технические характеристики', name: 'Минимальная ёмкость', value: 'не менее 2850', unit: 'мАч' },
      { group: 'Технические характеристики', name: 'Саморазряд (при хранении)', value: 'не более 2% в год при температуре +20 °С' },
      { group: 'Технические характеристики', name: 'Срок годности', value: 'не менее 5 лет с даты производства' },
      { group: 'Состояние', name: 'Состояние', value: 'Новый, в оригинальной упаковке, не бывший в использовании' },
    ],
  },
  batteryLithium: {
    name: 'Литиевый элемент питания (CR2032 / CR2025 и аналоги)',
    okpd2: '27.20.21.110',
    okpd2name: 'Элементы первичные литиевые',
    ktruFixed: '27.20.21.110-00000002',
    placeholder: 'Например: CR2032, CR2025, CR2016 — для материнских плат и устройств...',
    hardTemplate: [
      { group: 'Тип элемента', name: 'Типоразмер', value: 'CR2032 (уточнить при необходимости: CR2025 / CR2016)' },
      { group: 'Тип элемента', name: 'Тип химической системы', value: 'Литиевая (Lithium)' },
      { group: 'Технические характеристики', name: 'Номинальное напряжение', value: 'не менее 3', unit: 'В' },
      { group: 'Технические характеристики', name: 'Минимальная ёмкость', value: 'не менее 220', unit: 'мАч' },
      { group: 'Технические характеристики', name: 'Срок годности', value: 'не менее 10 лет с даты производства' },
      { group: 'Состояние', name: 'Состояние', value: 'Новый, в оригинальной упаковке, не бывший в использовании' },
    ],
  },
  thermalPaste: {
    name: 'Термопаста (термоинтерфейс)',
    okpd2: '20.59.59.190',
    okpd2name: 'Химические продукты для технических целей прочие',
    placeholder: 'Например: Noctua NT-H1, Arctic MX-4, КПТ-8...',
    hardTemplate: [
      { group: 'Основные характеристики', name: 'Тип термоинтерфейса', value: 'Термопаста (невысыхающий теплопроводящий компаунд)' },
      { group: 'Основные характеристики', name: 'Теплопроводность', value: 'не менее 4', unit: 'Вт/(м·К)' },
      { group: 'Основные характеристики', name: 'Рабочая температура', value: 'от -40 до +150', unit: '°С' },
      { group: 'Основные характеристики', name: 'Объём / масса упаковки', value: 'не менее 3,5', unit: 'г' },
      { group: 'Основные характеристики', name: 'Электрическая проводимость', value: 'Не проводит электрический ток (диэлектрическая)' },
      { group: 'Состояние', name: 'Состояние', value: 'Новый, в оригинальной герметичной упаковке производителя' },
    ],
  },
  cleaningSet: {
    name: 'Чистящий набор для оргтехники',
    okpd2: '20.41.19.000',
    okpd2name: 'Средства для чистки поверхностей прочие',
    placeholder: 'Например: чистящий набор для монитора/ПК, салфетки+спрей, антистатические салфетки...',
    hardTemplate: [
      { group: 'Состав набора', name: 'Чистящий спрей', value: 'Антистатический спрей для очистки экранов и поверхностей, объём не менее 100 мл' },
      { group: 'Состав набора', name: 'Салфетки из микрофибры', value: 'не менее 2 штук, размер не менее 20×20 см, не оставляют ворсинок' },
      { group: 'Состав набора', name: 'Чистящие влажные салфетки', value: 'не менее 10 штук, пропитаны антистатическим составом, в индивидуальных упаковках' },
      { group: 'Состав набора', name: 'Баллон со сжатым воздухом', value: 'Объём не менее 200 мл (при наличии в наборе)' },
      { group: 'Применимость', name: 'Совместимость', value: 'Подходит для чистки мониторов, клавиатур, системных блоков, оргтехники' },
      { group: 'Состояние', name: 'Состояние', value: 'Новый, в оригинальной герметичной упаковке производителя' },
    ],
  },
  usbHub: {
    name: 'Концентратор USB (USB-хаб)',
    okpd2: '26.20.16.190',
    okpd2name: 'Устройства ввода-вывода прочие',
    ktruFixed: '26.20.16.190-00000001',
    placeholder: 'Например: USB 3.0 хаб 4-port, Defender Quadro, Gembird UHB-U3P4-01...',
    hardTemplate: [
      { group: 'Характеристики', name: 'Версия интерфейса USB (вход)', value: 'USB 3.0 (USB 3.2 Gen 1) или выше' },
      { group: 'Характеристики', name: 'Количество USB-портов', value: 'не менее 4', unit: 'порт.' },
      { group: 'Характеристики', name: 'Версия портов USB', value: 'не ниже USB 3.0 (с обратной совместимостью с USB 2.0)' },
      { group: 'Характеристики', name: 'Подключение', value: 'Кабель подключения не менее 0,5 м' },
      { group: 'Характеристики', name: 'Питание', value: 'Без дополнительного источника питания или с адаптером питания (по описанию)' },
      { group: 'Состояние', name: 'Состояние', value: 'Новый, в оригинальной упаковке производителя' },
    ],
  },
  usbCable: {
    name: 'Кабель USB (A-B / A-C / A-microB)',
    okpd2: '27.32.20.190',
    okpd2name: 'Кабели и провода для передачи данных прочие',
    placeholder: 'Например: кабель USB A-B для принтера, USB A-C для зарядки, USB-microB...',
    hardTemplate: [
      { group: 'Характеристики', name: 'Тип разъёма (вход)', value: 'USB Type-A (уточнить тип: USB-A/B / USB-A/microB / USB-A/C)' },
      { group: 'Характеристики', name: 'Версия стандарта USB', value: 'не ниже USB 2.0 (или USB 3.0 при наличии требования)' },
      { group: 'Характеристики', name: 'Длина кабеля', value: 'не менее 1,5', unit: 'м' },
      { group: 'Характеристики', name: 'Экранирование', value: 'Предусмотрено для защиты от электромагнитных помех' },
      { group: 'Состояние', name: 'Состояние', value: 'Новый, в оригинальной упаковке производителя, без повреждений кабеля и разъёмов' },
    ],
  },
  labelPrinter: {
    name: 'Принтер этикеток (термопринтер)',
    okpd2: '26.20.16.120',
    okpd2name: 'Принтеры для вычислительных машин (термопечать)',
    placeholder: 'Например: Brother QL-800, Dymo LabelWriter 450, АТОЛ BP41...',
  },
  labelTape: {
    name: 'Лента / этикетки для принтера этикеток',
    okpd2: '17.23.12.000',
    okpd2name: 'Изделия из бумаги и картона для офисного использования',
    placeholder: 'Например: Brother DK-22205, Dymo 99012, термоэтикетки 58×40 мм...',
    hardTemplate: [
      { group: 'Характеристики ленты', name: 'Совместимость (модель принтера)', value: 'Совместима с принтером этикеток (указать модель)' },
      { group: 'Характеристики ленты', name: 'Ширина ленты/этикетки', value: 'Указать ширину в соответствии с требуемым форматом', unit: 'мм' },
      { group: 'Характеристики ленты', name: 'Тип термоматериала', value: 'Термобумага (для прямой термопечати) или термотрансферный материал' },
      { group: 'Характеристики ленты', name: 'Количество этикеток в рулоне', value: 'не менее 300', unit: 'шт.' },
      { group: 'Состояние', name: 'Состояние', value: 'Новый, в оригинальной упаковке производителя, без повреждений намотки' },
    ],
  },
  tapeCartridge: {
    name: 'Кассета (картридж) с магнитной лентой (LTO)',
    okpd2: '26.20.40.140',
    okpd2name: 'Устройства хранения данных на магнитных лентах',
    placeholder: 'Например: HPE LTO-7 Ultrium RW, Quantum MR-L7MQN-01, IBM LTO-8...',
    hardTemplate: [
      { group: 'Тип носителя', name: 'Поколение LTO', value: 'LTO-7 (или LTO-8 / LTO-9 — уточнить совместимость со стриммером)' },
      { group: 'Тип носителя', name: 'Ёмкость (сжатая)', value: 'не менее 15 ТБ (для LTO-7) / не менее 30 ТБ (для LTO-8)', unit: 'ТБ' },
      { group: 'Тип носителя', name: 'Ёмкость (нативная)', value: 'не менее 6 ТБ (для LTO-7) / не менее 12 ТБ (для LTO-8)', unit: 'ТБ' },
      { group: 'Тип носителя', name: 'Стандарт', value: 'Соответствует спецификации LTO Ultrium (Ultrium Data Cartridge)' },
      { group: 'Состояние', name: 'Состояние', value: 'Новый, в оригинальной упаковке, не использованный, совместим с установленным оборудованием' },
    ],
  },
};

export interface GoodsGroup {
  label: string;
  items: string[];
}

export const GOODS_GROUPS: GoodsGroup[] = [
  { label: '💻 Компьютеры', items: ['pc', 'laptop', 'monoblock', 'server', 'tablet', 'thinClient'] },
  { label: '🖨️ Периферия и оргтехника', items: ['monitor', 'printer', 'mfu', 'scanner', 'keyboard', 'mouse', 'kvm', 'ups', 'projector', 'interactive', 'webcam', 'headset', 'labelPrinter'] },
  { label: '🌐 Сетевое оборудование', items: ['switch', 'router', 'firewall', 'accessPoint', 'nas', 'patchPanel', 'mediaConverter'] },
  { label: '💾 Накопители и носители', items: ['ssd', 'hdd', 'ram', 'flashDrive', 'dvd', 'tapeLib', 'tapeCartridge'] },
  { label: '🔌 Кабели и коммутация', items: ['patchCord', 'fiberCable', 'hdmiCable', 'usbCable', 'powerCable', 'rackCabinet'] },
  { label: '🖥️ Серверное оборудование', items: ['serverRack', 'serverBlade', 'san', 'pdu', 'kvm_server'] },
  { label: '🖨️ Расходные материалы ИТ', items: ['cartridge', 'paper', 'toner', 'drum', 'labelTape', 'battery', 'batteryLithium', 'thermalPaste', 'cleaningSet', 'usbHub'] },
  { label: '💿 Системное и офисное ПО', items: ['os', 'office', 'virt', 'vdi', 'dbms', 'erp', 'cad', 'license'] },
  { label: '🔒 Средства защиты информации', items: ['antivirus', 'edr', 'firewall_sw', 'vpn', 'dlp', 'siem', 'crypto', 'waf', 'pam', 'iam', 'pki'] },
  { label: '📧 Коммуникации и совместная работа', items: ['email', 'vks', 'ecm', 'portal', 'project_sw', 'bpm', 'reporting'] },
  { label: '🛠️ Управление ИТ и инфраструктурой', items: ['backup_sw', 'itsm', 'monitoring', 'mdm', 'hr', 'gis', 'ldap'] },
  { label: '📦 Комплектующие', items: ['cpu', 'gpu', 'motherboard', 'psu', 'cooling', 'parts'] },
];

// Классификаторы для нацрежима
export const HW_878_TYPES = new Set([
  'pc','laptop','monoblock','server','tablet','thinClient','monitor',
  'switch','router','firewall','accessPoint','nas','san','serverRack','serverBlade',
]);
export const SW_1236_TYPES = new Set([
  'os','office','antivirus','firewall_sw','crypto','dlp','siem','backup_sw','virt','dbms','erp','cad','license',
  'email','vks','ecm','vdi','mdm','edr','waf','pam','iam','pki','itsm','monitoring','hr','gis','project_sw',
  'bpm','portal','ldap','vpn','reporting',
]);
export const HW_175_TYPES = new Set([
  'pc','laptop','monoblock','server','tablet','thinClient','switch','router','firewall',
  'accessPoint','nas','san','serverRack','serverBlade','ups','printer','mfu','projector',
]);

export type NacRegime = 'pp1236' | 'pp878' | 'pp616' | 'none';

export function getNacRegime(goodsType: string): NacRegime {
  if (SW_1236_TYPES.has(goodsType)) return 'pp1236';
  if (HW_878_TYPES.has(goodsType)) return 'pp878';
  if (HW_175_TYPES.has(goodsType)) return 'pp616';
  return 'none';
}

// Определение типа по строке модели
const TYPE_HINTS: Array<{ tokens: string[]; type: string }> = [
  // ── Ноутбуки (бренды + линейки) ──
  { tokens: [
    'ноутбук','notebook','laptop',
    'vivobook','zenbook','thinkpad','macbook','matebook','probook','elitebook',
    'inspiron','latitude','pavilion','envy','spectre','ideapad','legion',
    'travelmate','extensa','swift','spin','chromebook','predator','nitro',
    'victus','omen','xps','vostro','precision','lifebook','portege',
    'tecra','dynabook','yoga','thinkbook','gram',
    'graviton n15','graviton n17','гравитон н15','гравитон н17',
    'aquarius cmp ns','aquarius ns',
    // Добавлено: популярные линейки
    'aspire','bravo','acer aspire','acer nitro','acer swift',
    'hp 250','hp 255','hp 15','hp 14','hp 17',
    'lenovo v14','lenovo v15','lenovo v17','lenovo e14','lenovo e15',
    'dell g15','dell g16','dell inspiron','dell vostro',
    'huawei d15','huawei d16','honor magicbook',
    'depo vnb','depo vip','iru patriot','iru novia',
    'msi modern','msi prestige','msi katana','msi bravo','msi gf',
    'asus rog','asus tuf',
  ], type: 'laptop' },

  // ── Системные блоки / десктопы ──
  { tokens: [
    'системный блок','десктоп','desktop','nettop','мини-пк','mini pc','неттоп',
    'гравитон','graviton','iru ','iru офис','iru office',
    'aquarius pro','aquarius cmp','yadro vegman n','irbis','nuc','optiplex',
    'prodesk','elitedesk','thinkcentre','thinkstation',
    // Добавлено: популярные десктопы
    'hp eliteone','hp 290','hp slimline','hp pro tower','hp pro sff',
    'lenovo v530','lenovo v50','lenovo m70','lenovo m90','lenovo neo 50',
    'dell vostro desktop','dell precision tower',
    'acer veriton','veriton',
    'depo ego','depo race','depo neos',
    'iru corp','iru home',
    'kraftway','компьютер в сборе','рабочая станция',
  ], type: 'pc' },

  // ── Моноблоки ──
  { tokens: ['моноблок','моно блок','all-in-one','aio ','imac'], type: 'monoblock' },

  // ── Планшеты ──
  { tokens: ['планшет','tablet','ipad','galaxy tab','aquarius cmp t','irbis tw'], type: 'tablet' },

  // ── Тонкие клиенты ──
  { tokens: ['тонкий клиент','thin client','wyse','hp t6','hp t4','kraftway тонк'], type: 'thinClient' },

  // ── Серверы ──
  { tokens: [
    'сервер','server','poweredge','proliant','primergy',
    'vegman r','aquarius server','yadro vegman r','yadro tatlin',
    'supermicro','supermicro sys-',
  ], type: 'server' },

  // ── Мониторы ──
  { tokens: [
    'монитор','monitor','aqmon','f2200','benq','viewsonic',
    'philips 24','philips 27','dell p24','dell u24','dell s24','dell p27','dell u27',
    'lg 24','lg 27','lg 32','samsung s24','samsung s27',
    'aoc 24','aoc 27','iiyama','hp p24','hp e24','hp z24','hp m24','hp m27',
    'lenovo l24','lenovo l27','lenovo thinkvision',
    'acer v24','acer v27','acer ka24',
  ], type: 'monitor' },

  // ── Принтеры ──
  { tokens: ['принтер','printer','xerox b2','hp laser','laserjet','pantum p','ricoh sp','brother hl','canon lbp','kyocera ecosys p'], type: 'printer' },

  // ── МФУ ──
  { tokens: ['мфу','мфд','multifunction','pantum bm','xerox b2','brother mfc','brother dcp','canon mf','ricoh mp','ricoh m','kyocera ecosys m'], type: 'mfu' },

  // ── Сканеры ──
  { tokens: ['сканер','scanner','fujitsu fi','canon dr','kodak s2','avision','epson ds'], type: 'scanner' },

  // ── Проекторы ──
  { tokens: ['проектор','projector','epson eb','benq m','viewsonic p','acer x1','casio xj'], type: 'projector' },

  // ── Интерактивные доски ──
  { tokens: ['интерактивная доска','интерактивный дисплей','interactive board','smart board','newline','promethean'], type: 'interactive' },

  // ── Веб-камеры ──
  { tokens: ['веб-камера','вебкамера','webcam','logitech c9','logitech brio','hikvision ds-u'], type: 'webcam' },

  // ── Гарнитуры ──
  { tokens: ['гарнитура','headset','наушники с микрофон','jabra evolve','poly blackwire','plantronics'], type: 'headset' },

  // ── Клавиатуры ──
  { tokens: ['клавиатура','keyboard','клав'], type: 'keyboard' },

  // ── Мыши ──
  { tokens: ['мышь','мышка','mouse','манипулятор'], type: 'mouse' },

  // ── KVM ──
  { tokens: ['kvm','кvm'], type: 'kvm' },

  // ── ИБП ──
  { tokens: ['ибп','ups','бесперебойн','apc smart','eaton','powercom','ippon'], type: 'ups' },

  // ── Коммутаторы ──
  { tokens: [
    'коммутатор','switch','свитч',
    'eltex mes','cisco sg','cisco c29','cisco catalyst','catalyst 29','catalyst 39','d-link dgs','d-link des','tp-link tl-sg',
    'mikrotik css','mikrotik crs','juniper ex','aruba','huawei s57','huawei s67',
    'snr-s2','qtech qsw','zyxel gs','netgear gs',
  ], type: 'switch' },

  // ── Маршрутизаторы ──
  { tokens: [
    'маршрутизатор','router','роутер',
    'eltex esr','mikrotik rb','mikrotik hex','mikrotik ccr',
    'cisco isr','cisco rv','d-link dir','tp-link tl-er','tp-link archer',
    'keenetic','zyxel','huawei ar','juniper srx',
  ], type: 'router' },

  // ── Межсетевые экраны (аппаратные) ──
  { tokens: [
    'межсетевой экран','firewall','фаервол','брандмауэр',
    'usergate','континент','ideco','cisco asa','cisco ftd',
    'fortinet','fortigate','palo alto','checkpoint',
    'eltex esr fw','snr fw','s-terra','с-терра',
  ], type: 'firewall' },

  // ── Точки доступа Wi-Fi ──
  { tokens: [
    'точка доступа','access point','wifi','wi-fi точка',
    'ubiquiti','unifi','tp-link eap','d-link dap',
    'eltex wep','eltex wop','aruba ap','ruckus','cisco air',
    'huawei ap','zyxel wax',
  ], type: 'accessPoint' },

  // ── NAS ──
  { tokens: ['nas','сетевое хранилище','synology','qnap','wd my cloud','netgear readynas'], type: 'nas' },

  // ── Патч-панели ──
  { tokens: ['патч-панель','патч панель','patch panel','коммутационная панель'], type: 'patchPanel' },

  // ── Медиаконвертеры ──
  { tokens: ['медиаконвертер','медиа конвертер','media converter'], type: 'mediaConverter' },

  // ── SSD ──
  { tokens: ['ssd','твердотельн','nvme','m.2 накопитель','870 evo','860 evo','980 pro','990 pro','samsung evo','kingston a400','crucial mx','wd blue sn','wd black sn'], type: 'ssd' },

  // ── HDD ──
  { tokens: ['hdd','жёсткий диск','жесткий диск','seagate','western digital','wd purple','wd red','wd gold','toshiba enterprise'], type: 'hdd' },

  // ── RAM ──
  { tokens: ['оперативная память','озу','ram','dimm','so-dimm','ecc dimm','rdimm','lrdimm','ddr4','ddr5','kingston fury','crucial ballistix','samsung m3','hynix hma'], type: 'ram' },

  // ── Флешки ──
  { tokens: ['флеш-накопитель','флешка','flash drive','usb flash','usb накопитель','transcend jetflash','sandisk cruzer'], type: 'flashDrive' },

  // ── Оптические носители / ленточные ──
  { tokens: ['dvd','cd-r','bd-r','blu-ray','оптический диск','lto-','lto7','lto8','lto9','ultrium','стриммер','ленточная библиотека','tape library'], type: 'dvd' },

  // ── Кабели и коммутация ──
  { tokens: ['utp','stp','s/ftp','cat5e','cat6','cat6a','cat7','витая пара','патч-корд','patchcord','patch cord','rj45 кабель','ethernet кабель','lan кабель'], type: 'patchCord' },
  { tokens: ['оптоволокон','optical cable','fiber','om3','om4','om5','оксм','окс','волоконно-оптич','оптический кабель','sfp кабель'], type: 'fiberCable' },
  { tokens: ['hdmi кабель','hdmi-кабель','displayport кабель','dp кабель','кабель hdmi','кабель displayport','кабель dp'], type: 'hdmiCable' },
  { tokens: ['кабель питания','сетевой кабель питания','power cable','power cord','iec c13','iec c14','шнур питания'], type: 'powerCable' },

  // ── Телекоммуникационные шкафы и стойки ──
  { tokens: ['телекоммуникац шкаф','серверный шкаф','шкаф 19','шкаф 42u','шкаф 22u','шкаф настенный','rack cabinet','цмо','ntss'], type: 'rackCabinet' },
  { tokens: ['серверная стойка','серверная рама','server rack','open rack','открытая стойка'], type: 'serverRack' },

  // ── Серверное оборудование ──
  { tokens: ['блейд-сервер','blade server','блейд сервер'], type: 'serverBlade' },
  { tokens: ['схд','san','система хранения данных','storage area','yadro tatlin','dell emc','netapp','huawei oceanstor'], type: 'san' },
  { tokens: ['pdu','распределитель питания','блок распредел','power distribution'], type: 'pdu' },
  { tokens: ['kvm серверный','kvm-сервер','aten kvm','raritan'], type: 'kvm_server' },

  // ── Расходные материалы ──
  { tokens: ['картридж','cartridge','тонер-картридж','drum-картридж'], type: 'cartridge' },
  { tokens: ['бумага','svetocopy','снегурочка','кбс','ballet','бумага офисная','a4 бумага','бумага a4'], type: 'paper' },
  { tokens: ['тонер','toner','тонер для','порошок для принтера'], type: 'toner' },
  { tokens: ['фотобарабан','drum','фотовал','imaging unit','блок формирования'], type: 'drum' },

  // ── Комплектующие ──
  { tokens: ['процессор','cpu','intel core','amd ryzen','intel xeon','amd epyc','эльбрус','байкал-м'], type: 'cpu' },
  { tokens: ['видеокарта','gpu','graphics card','geforce','radeon','nvidia a','nvidia t','quadro'], type: 'gpu' },
  { tokens: ['материнская плата','motherboard','mainboard','системная плата'], type: 'motherboard' },
  { tokens: ['блок питания пк','блок питания для','psu','power supply','бп 500w','бп 650w','бп 750w','бп 850w'], type: 'psu' },
  { tokens: ['система охлаждения','кулер','cooler','радиатор','вентилятор','fan 120','fan 140','thermalright','noctua','deepcool','be quiet'], type: 'cooling' },

  // ── ПО: Операционные системы ──
  { tokens: ['astra linux','астра линукс','alt linux','альт линукс','ред ос','редос','rosa linux','роса линукс','операционная система','windows server','windows 1','ubuntu','debian','centos','rhel'], type: 'os' },

  // ── ПО: Офисные пакеты ──
  { tokens: ['мойофис','мой офис','р7-офис','r7-офис','libreoffice','microsoft office','office 365','microsoft 365','офисный пакет'], type: 'office' },

  // ── ПО: Виртуализация ──
  { tokens: ['виртуализаци','базис.vcore','zvirt','р-виртуализация','vmware','hyper-v','proxmox','гипервизор'], type: 'virt' },

  // ── ПО: VDI ──
  { tokens: ['termidesk','базис.workplace','rudesktop','vdi','виртуальные рабочие места','виртуальные рабочие столы'], type: 'vdi' },

  // ── ПО: СУБД ──
  { tokens: ['postgresql','postgres pro','tantor','jatoba','субд','mysql','mariadb','oracle db','ms sql','microsoft sql'], type: 'dbms' },

  // ── ПО: ERP ──
  { tokens: ['1с:предприятие','1с предприятие','1с:бухгалтерия','1с бухгалтерия','галактика erp','парус erp','erp система'], type: 'erp' },

  // ── ПО: САПР ──
  { tokens: ['компас-3d','компас 3d','nanocad','нанокад','autocad','solidworks','сапр','t-flex'], type: 'cad' },

  // ── ПО: Антивирус / EDR ──
  { tokens: ['касперский','kaspersky','dr.web','drweb','доктор веб','антивирус'], type: 'antivirus' },
  { tokens: ['edr','endpoint detection','pt sandbox','kaspersky edr','защита конечных точек'], type: 'edr' },

  // ── ПО: Межсетевой экран (софт) ──
  { tokens: ['usergate fw','usergate межсетев','континент по','ideco utm','межсетевой экран по','программный межсетевой'], type: 'firewall_sw' },

  // ── ПО: DLP / SIEM ──
  { tokens: ['dlp','infowatch','solar dozor','защита от утечек','staffcop','searchinform'], type: 'dlp' },
  { tokens: ['siem','maxpatrol siem','rusiem','ankey siem','pt siem'], type: 'siem' },

  // ── ПО: Криптография ──
  { tokens: ['криптопро','cryptopro','vipnet','випнет','скзи','vipnet client','vipnet coordinator'], type: 'crypto' },

  // ── ПО: WAF / PAM / IAM / PKI ──
  { tokens: ['waf','pt application firewall','solar appscreener','web application firewall','защита веб'], type: 'waf' },
  { tokens: ['pam','привилегированный доступ','indeed pam','senhasegura','cyberark'], type: 'pam' },
  { tokens: ['iam','idm','управление доступом','indeed access','solar inrights','avanpost'], type: 'iam' },
  { tokens: ['pki','удостоверяющий центр','криптопро уц','vipnet pki','электронная подпись','эцп'], type: 'pki' },

  // ── ПО: Коммуникации ──
  { tokens: ['trueconf','trueконф','видеомост','imind','мтс линк','vk teams','вкс','видеоконференц'], type: 'vks' },
  { tokens: ['рупост','rupost','mailion','communigate','почтовый сервер','communigate pro','mail сервер'], type: 'email' },

  // ── ПО: СЭД / порталы / BPM ──
  { tokens: ['тезис','directum','docsvision','сэд','документооборот','1с:документооборот'], type: 'ecm' },
  { tokens: ['битрикс24','битрикс 24','1с-битрикс','корпоративный портал','битрикс портал'], type: 'portal' },
  { tokens: ['яндекс.трекер','яндекс трекер','kaiten','управление проектами','jira','youtrack'], type: 'project_sw' },
  { tokens: ['elma bpm','elma365','comindware','bpm','бизнес-процесс'], type: 'bpm' },

  // ── ПО: Резервное копирование / ITSM / Мониторинг ──
  { tokens: ['rubackup','рубэкап','кибер бэкап','кибербэкап','bacula','acronis','резервное копирование','backup'], type: 'backup_sw' },
  { tokens: ['simpleone','naumen service desk','naumen sd','itsm','service desk','сервис деск'], type: 'itsm' },
  { tokens: ['zabbix','maxpatrol vm','nagios','мониторинг ит','grafana','prometheus','мониторинг серверов'], type: 'monitoring' },

  // ── ПО: MDM / HRM / ГИС ──
  { tokens: ['safephone','мобилдок','mdm','mobile device management','управление мобильн'], type: 'mdm' },
  { tokens: ['1с:зуп','1с зуп','добыто hrm','hrm','управление персоналом','hr система'], type: 'hr' },
  { tokens: ['nextgis','панорама гис','гис','геоинформац','mapinfo','qgis'], type: 'gis' },

  // ── Прочие расходные/периферия ──
  { tokens: ['батарейк','battery','duracell','energizer','gp ultra','lr6','lr03','aa щелоч','aaa щелоч'], type: 'battery' },
  { tokens: ['cr2032','cr2025','cr2016','литиевый элемент','coin cell'], type: 'batteryLithium' },
  { tokens: ['термопаста','термоинтерфейс','noctua nt-h','arctic mx','кпт-8','thermal compound'], type: 'thermalPaste' },
  { tokens: ['чистящий набор','набор чистящ','антистатическ','compressed air','сжатый воздух'], type: 'cleaningSet' },
  { tokens: ['usb-хаб','usb хаб','usb hub','концентратор usb'], type: 'usbHub' },
  { tokens: ['кабель usb','usb-кабель','usb a-b','usb a-c','microusb','micro-usb','usb type-c кабель'], type: 'usbCable' },
  { tokens: ['этикетк','label tape','dk-2','dymo','ql-'], type: 'labelTape' },
  { tokens: ['лицензия','license','подписка на по','renewal','продление лицензии'], type: 'license' },
];

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\u00AB\u00BB\u201C\u201D\u201E\u2018\u2019]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectGoodsType(model: string, fallback: string): string {
  const text = normalizeText(model);
  if (text.length < 2) return fallback;

  // Точные совпадения коротких токенов (до 4 символов) требуют границ слова
  for (const hint of TYPE_HINTS) {
    for (const t of hint.tokens) {
      const tn = normalizeText(t);
      if (tn.length <= 3) {
        // Для коротких токенов (ups, nas, ssd, hdd, ram и т.д.) - проверяем границу слова
        const re = new RegExp(`(?:^|\\s|[^а-яa-z])${tn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s|[^а-яa-z])`);
        if (re.test(` ${text} `)) return hint.type;
      } else {
        if (text.includes(tn)) return hint.type;
      }
    }
  }
  return fallback;
}
