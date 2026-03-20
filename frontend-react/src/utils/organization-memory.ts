import type { PlatformIntegrationSettings } from '../types/schemas';

export type OrganizationPresetKey =
  | 'general'
  | 'it_department'
  | 'education'
  | 'healthcare'
  | 'municipal';

type OrganizationPresetMeta = {
  key: OrganizationPresetKey;
  label: string;
  shortLabel: string;
  description: string;
  priorities: string[];
};

type OrganizationMemorySettings = Pick<
  PlatformIntegrationSettings,
  'industryPreset' | 'organizationInstructions' | 'defaultWarrantyMonths' | 'orgName'
>;

const ORGANIZATION_PRESETS: Record<OrganizationPresetKey, OrganizationPresetMeta> = {
  general: {
    key: 'general',
    label: 'Универсальный заказчик',
    shortLabel: 'Универсальный',
    description: 'Нейтральный профиль без отраслевых перекосов.',
    priorities: [
      'делать ТЗ универсальным и конкурентным, без избыточных ограничений',
      'сохранять проверяемые и измеримые характеристики без брендов и моделей',
    ],
  },
  it_department: {
    key: 'it_department',
    label: 'ИТ-служба / инфраструктура',
    shortLabel: 'ИТ-служба',
    description: 'Акцент на совместимость, сопровождение и эксплуатацию в ИТ-контуре.',
    priorities: [
      'делать акцент на совместимость, интеграцию и управляемость в существующем ИТ-контуре',
      'сохранять в ТЗ эксплуатационные требования только если они подтверждаемы и действительно нужны заказчику',
    ],
  },
  education: {
    key: 'education',
    label: 'Образование',
    shortLabel: 'Образование',
    description: 'Учебные классы, массовое использование, понятная эксплуатация.',
    priorities: [
      'учитывать массовую эксплуатацию, учебные кабинеты и простоту сопровождения',
      'приоритизировать безопасность использования, понятную комплектность и документацию на русском языке',
    ],
  },
  healthcare: {
    key: 'healthcare',
    label: 'Здравоохранение',
    shortLabel: 'Медицина',
    description: 'Повышенные требования к надежности, санитарной и эксплуатационной устойчивости.',
    priorities: [
      'приоритизировать надежность, непрерывность работы и эксплуатационную устойчивость',
      'если применимо, учитывать требования к санитарной обработке, безопасному составу и документации',
    ],
  },
  municipal: {
    key: 'municipal',
    label: 'Администрация / муниципалитет',
    shortLabel: 'Муниципалитет',
    description: 'Типовые закупки с акцентом на прозрачность и простую приемку.',
    priorities: [
      'формулировать характеристики максимально прозрачно и без спорных сужений конкуренции',
      'делать акцент на приемке, комплектности и подтверждающих документах поставки',
    ],
  },
};

export const ORGANIZATION_PRESET_OPTIONS = Object.values(ORGANIZATION_PRESETS).map((preset) => ({
  value: preset.key,
  label: preset.label,
  shortLabel: preset.shortLabel,
  description: preset.description,
}));

function normalizeInstructionLines(raw: string): string[] {
  return String(raw || '')
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function getOrganizationPresetMeta(key?: string): OrganizationPresetMeta {
  if (key && key in ORGANIZATION_PRESETS) {
    return ORGANIZATION_PRESETS[key as OrganizationPresetKey];
  }
  return ORGANIZATION_PRESETS.general;
}

export function buildOrganizationMemoryPromptBlock(
  settings?: Partial<OrganizationMemorySettings>,
  isService = false
): string {
  const preset = getOrganizationPresetMeta(settings?.industryPreset);
  const lines: string[] = [];

  if (settings?.orgName?.trim()) {
    lines.push(`Организация: ${settings.orgName.trim()}.`);
  }

  lines.push(`Профиль заказчика: ${preset.label}.`);

  if (preset.priorities.length > 0) {
    lines.push('Приоритеты организации:');
    for (const item of preset.priorities) {
      lines.push(`- ${item}`);
    }
  }

  const warrantyMonths = Number(settings?.defaultWarrantyMonths || 0);
  if (!isService && Number.isFinite(warrantyMonths) && warrantyMonths > 0) {
    lines.push(`- если для товара обычно устанавливается гарантия, ориентируйся на срок не менее ${warrantyMonths} мес, но не выдумывай гарантию там, где она неуместна`);
  }

  const customRules = normalizeInstructionLines(settings?.organizationInstructions || '');
  if (customRules.length > 0) {
    lines.push('Внутренние правила заказчика:');
    for (const rule of customRules) {
      lines.push(`- ${rule}`);
    }
  }

  lines.push('Эти вводные помогают уточнить формулировки, но не отменяют требования 44-ФЗ/223-ФЗ, ст. 33, ПП РФ № 1875 и запрет на бренды/модели.');
  return `КОНТЕКСТ ОРГАНИЗАЦИИ:\n${lines.join('\n')}`;
}
