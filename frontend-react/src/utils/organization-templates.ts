import type { OrganizationPresetKey } from './organization-memory';

export type WorkspaceTemplateRowDraft = {
  type: string;
  model: string;
  licenseType?: string;
  term?: string;
  qty: number;
};

export type OrganizationTemplatePack = {
  id: string;
  name: string;
  description: string;
  industryPreset: OrganizationPresetKey | 'common';
  rows: WorkspaceTemplateRowDraft[];
  tags: string[];
};

const COMMON_PACKS: OrganizationTemplatePack[] = [
  {
    id: 'office-workplace',
    name: 'Офисное рабочее место',
    description: 'Базовый набор для специалиста: компьютер, монитор, периферия и офисное ПО.',
    industryPreset: 'common',
    tags: ['рабочее место', 'офис', 'типовой'],
    rows: [
      { type: 'pc', model: 'Системный блок для офисной работы', qty: 1 },
      { type: 'monitor', model: 'Монитор для офисного рабочего места', qty: 1 },
      { type: 'keyboard', model: 'Клавиатура проводная полноразмерная', qty: 1 },
      { type: 'mouse', model: 'Мышь проводная оптическая', qty: 1 },
      { type: 'office', model: 'Офисный пакет для рабочего места', licenseType: 'на рабочее место', term: '12', qty: 1 },
      { type: 'antivirus', model: 'Антивирус для рабочей станции', licenseType: 'на устройство', term: '12', qty: 1 },
    ],
  },
  {
    id: 'document-flow-desk',
    name: 'Документооборот и печать',
    description: 'Типовой набор для подразделения с печатью, бумагой и расходниками.',
    industryPreset: 'common',
    tags: ['печать', 'документы', 'мфу'],
    rows: [
      { type: 'mfu', model: 'МФУ для офисного документооборота', qty: 1 },
      { type: 'paper', model: 'Бумага офисная А4', qty: 20 },
      { type: 'cartridge', model: 'Картридж для лазерной печати', qty: 2 },
    ],
  },
];

const PRESET_PACKS: Record<OrganizationPresetKey, OrganizationTemplatePack[]> = {
  general: [],
  it_department: [
    {
      id: 'it-admin-workstation',
      name: 'АРМ администратора',
      description: 'Рабочее место ИТ-специалиста с акцентом на управляемость и бесперебойность.',
      industryPreset: 'it_department',
      tags: ['ит', 'арм', 'администратор'],
      rows: [
        { type: 'pc', model: 'Системный блок для администратора ИТ-инфраструктуры', qty: 1 },
        { type: 'monitor', model: 'Монитор для длительной работы администратора', qty: 2 },
        { type: 'ups', model: 'ИБП для рабочего места администратора', qty: 1 },
        { type: 'switch', model: 'Коммутатор доступа уровня отдела', qty: 1 },
        { type: 'itsm', model: 'ITSM / service desk для обработки заявок', licenseType: 'серверная / подписка', term: '12', qty: 1 },
      ],
    },
    {
      id: 'small-server-room',
      name: 'Минимальный комплект серверной',
      description: 'Быстрый старт для небольшой серверной или ИТ-стойки.',
      industryPreset: 'it_department',
      tags: ['серверная', 'стойка', 'инфраструктура'],
      rows: [
        { type: 'server', model: 'Сервер для инфраструктурных сервисов', qty: 1 },
        { type: 'nas', model: 'Сетевое хранилище для резервного копирования', qty: 1 },
        { type: 'ups', model: 'ИБП для серверной стойки', qty: 1 },
        { type: 'backup_sw', model: 'ПО резервного копирования', licenseType: 'серверная', term: '12', qty: 1 },
      ],
    },
  ],
  education: [
    {
      id: 'education-classroom',
      name: 'Компьютерный класс',
      description: 'Типовой набор для кабинета информатики или учебного класса.',
      industryPreset: 'education',
      tags: ['класс', 'обучение', 'школа'],
      rows: [
        { type: 'pc', model: 'Рабочее место обучающегося', qty: 15 },
        { type: 'monitor', model: 'Монитор для учебного класса', qty: 15 },
        { type: 'keyboard', model: 'Клавиатура для учебного класса', qty: 15 },
        { type: 'mouse', model: 'Мышь для учебного класса', qty: 15 },
        { type: 'office', model: 'Офисный пакет для учебного класса', licenseType: 'на рабочее место', term: '12', qty: 15 },
      ],
    },
    {
      id: 'teacher-room',
      name: 'Рабочее место преподавателя',
      description: 'Ноутбук, проектор и печать для преподавателя или учебного кабинета.',
      industryPreset: 'education',
      tags: ['преподаватель', 'кабинет', 'проектор'],
      rows: [
        { type: 'laptop', model: 'Ноутбук преподавателя', qty: 1 },
        { type: 'projector', model: 'Проектор для учебной аудитории', qty: 1 },
        { type: 'mfu', model: 'МФУ для учебного кабинета', qty: 1 },
      ],
    },
  ],
  healthcare: [
    {
      id: 'medical-office-arm',
      name: 'АРМ медицинского персонала',
      description: 'Базовый набор для врача, регистратуры или административного медицинского сотрудника.',
      industryPreset: 'healthcare',
      tags: ['медицина', 'арм', 'регистратура'],
      rows: [
        { type: 'pc', model: 'Системный блок для медицинского работника', qty: 1 },
        { type: 'monitor', model: 'Монитор для медицинского рабочего места', qty: 1 },
        { type: 'mfu', model: 'МФУ для регистратуры или кабинета', qty: 1 },
        { type: 'antivirus', model: 'Антивирус для рабочего места медперсонала', licenseType: 'на устройство', term: '12', qty: 1 },
      ],
    },
    {
      id: 'medical-mobile-workplace',
      name: 'Мобильное рабочее место',
      description: 'Набор для мобильного медицинского сотрудника или административного обхода.',
      industryPreset: 'healthcare',
      tags: ['мобильный', 'ноутбук', 'медицина'],
      rows: [
        { type: 'laptop', model: 'Ноутбук для мобильного медицинского рабочего места', qty: 1 },
        { type: 'ups', model: 'ИБП / резерв питания для периферии рабочего места', qty: 1 },
        { type: 'office', model: 'Офисный пакет для мобильного рабочего места', licenseType: 'на рабочее место', term: '12', qty: 1 },
      ],
    },
  ],
  municipal: [
    {
      id: 'municipal-office',
      name: 'Рабочее место муниципального служащего',
      description: 'Типовой комплект для администрации, приемной или профильного отдела.',
      industryPreset: 'municipal',
      tags: ['администрация', 'муниципалитет', 'офис'],
      rows: [
        { type: 'pc', model: 'Системный блок для муниципального служащего', qty: 1 },
        { type: 'monitor', model: 'Монитор для муниципального рабочего места', qty: 1 },
        { type: 'keyboard', model: 'Клавиатура для рабочего места', qty: 1 },
        { type: 'mouse', model: 'Мышь для рабочего места', qty: 1 },
        { type: 'office', model: 'Офисный пакет для муниципального рабочего места', licenseType: 'на рабочее место', term: '12', qty: 1 },
      ],
    },
    {
      id: 'municipal-frontdesk',
      name: 'Приём граждан / документооборот',
      description: 'Пакет для подразделения с активной печатью и обработкой документов.',
      industryPreset: 'municipal',
      tags: ['приемная', 'документы', 'печать'],
      rows: [
        { type: 'mfu', model: 'МФУ для приёма граждан и документооборота', qty: 1 },
        { type: 'paper', model: 'Бумага офисная А4 для ежедневной печати', qty: 30 },
        { type: 'cartridge', model: 'Картридж для печатной техники', qty: 3 },
      ],
    },
  ],
};

export function getSuggestedOrganizationTemplatePacks(
  industryPreset: OrganizationPresetKey = 'general'
): OrganizationTemplatePack[] {
  return [...(PRESET_PACKS[industryPreset] || []), ...COMMON_PACKS];
}

export function suggestTemplateNameForPreset(
  industryPreset: OrganizationPresetKey = 'general',
  orgName = ''
): string {
  const trimmedOrg = String(orgName || '').trim();
  if (trimmedOrg) {
    return `${trimmedOrg} — типовой набор`;
  }
  switch (industryPreset) {
    case 'education':
      return 'Шаблон учебной закупки';
    case 'healthcare':
      return 'Шаблон медучреждения';
    case 'municipal':
      return 'Шаблон администрации';
    case 'it_department':
      return 'Шаблон ИТ-службы';
    default:
      return 'Типовой шаблон закупки';
  }
}
