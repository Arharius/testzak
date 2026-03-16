export type LdapLicenseProfile =
  | 'server'
  | 'client_device'
  | 'client_user'
  | 'client'
  | 'combined'
  | 'unknown';

export type CommercialContextInput = {
  type: string;
  model?: string;
  licenseType?: string;
  term?: string;
};

export type CommercialContext = {
  suggestedLicenseType: string;
  suggestedTerm: string;
  ldapProfile: LdapLicenseProfile;
};

function normalizeCommercialText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectSuggestedTerm(text: string): string {
  const normalized = normalizeCommercialText(text);
  if (!normalized) return '';

  if (/(^|\s)бессроч/.test(normalized)) {
    return 'бессрочно';
  }

  const matches = [...normalized.matchAll(/\b(12|24|36)\s*(?:мес|месяц|месяца|месяцев|months?|mo)?\b/g)]
    .map((match) => match[1]);
  const unique = [...new Set(matches)];

  if (unique.length === 0) return '';
  if (unique.length === 1) return `${unique[0]} мес.`;
  return `${unique.join(' / ')} мес.`;
}

function detectSupportLevel(text: string): string {
  const normalized = normalizeCommercialText(text);
  if (!normalized) return '';
  if (/(привилег|privileg|premium|platinum|24x7)/.test(normalized)) return 'Привилегированная';
  if (/(стандарт|standard|base|basic)/.test(normalized)) return 'Стандарт';
  return '';
}

function detectLdapProfile(input: CommercialContextInput): CommercialContext {
  const model = normalizeCommercialText(input.model || '');
  const licenseType = normalizeCommercialText(input.licenseType || '');
  const combined = `${model} ${licenseType}`.trim();

  const hasServer = /(серверн|server|контроллер домена|domain controller|controller)/.test(combined);
  const hasClient = /(клиентск|client|cal\b|client access|доступ к устройству|доступ к пользовател)/.test(combined);
  const hasDevice = /(на устройство|на каждое устройство|device cal|device\b|хост|рабоч(ая|ее) станц|managed device)/.test(combined);
  const hasUser = /(на пользователя|по пользовател|user cal|user\b|именованн(ый|ого) пользовател)/.test(combined);

  let ldapProfile: LdapLicenseProfile = 'unknown';
  let suggestedLicenseType = '';

  if (hasServer && hasClient) {
    ldapProfile = 'combined';
    suggestedLicenseType = 'Серверная часть + CAL';
  } else if (hasUser) {
    ldapProfile = 'client_user';
    suggestedLicenseType = 'CAL на пользователя';
  } else if (hasDevice) {
    ldapProfile = 'client_device';
    suggestedLicenseType = 'CAL на устройство';
  } else if (hasClient) {
    ldapProfile = 'client';
    suggestedLicenseType = 'Клиентская часть (CAL)';
  } else if (hasServer) {
    ldapProfile = 'server';
    suggestedLicenseType = 'Серверная часть';
  }

  return {
    suggestedLicenseType,
    suggestedTerm: detectSuggestedTerm(`${model} ${input.term || ''}`),
    ldapProfile,
  };
}

export function deriveCommercialContext(input: CommercialContextInput): CommercialContext {
  if (input.type === 'ldap') {
    return detectLdapProfile(input);
  }

  const combined = `${input.model || ''} ${input.licenseType || ''}`.trim();
  const suggestedTerm = detectSuggestedTerm(`${combined} ${input.term || ''}`);

  if (input.type === 'supportCert' || input.type === 'osSupport') {
    return {
      suggestedLicenseType: detectSupportLevel(combined),
      suggestedTerm,
      ldapProfile: 'unknown',
    };
  }

  if (input.type === 'vdi') {
    const normalized = normalizeCommercialText(combined);
    let suggestedLicenseType = '';
    if (/(ccu|конкурентн|одновременн)/.test(normalized)) suggestedLicenseType = 'Конкурентные пользователи (CCU)';
    else if (/(именованн|named user|пользовател)/.test(normalized)) suggestedLicenseType = 'Именованные пользователи';
    return { suggestedLicenseType, suggestedTerm, ldapProfile: 'unknown' };
  }

  if (input.type === 'virt') {
    const normalized = normalizeCommercialText(combined);
    const suggestedLicenseType = /(сокет|socket|процессор)/.test(normalized)
      ? 'На физический процессор (socket)'
      : '';
    return { suggestedLicenseType, suggestedTerm, ldapProfile: 'unknown' };
  }

  if (input.type === 'email') {
    const normalized = normalizeCommercialText(combined);
    const suggestedLicenseType = /(ящик|mailbox|пользовател)/.test(normalized)
      ? 'На почтовый ящик / пользователя'
      : '';
    return { suggestedLicenseType, suggestedTerm, ldapProfile: 'unknown' };
  }

  if (input.type === 'backup_sw') {
    const normalized = normalizeCommercialText(combined);
    let suggestedLicenseType = '';
    if (/(тб|tb|терабайт|объем данных|объему данных)/.test(normalized)) {
      suggestedLicenseType = 'По объему данных (ТБ)';
    } else if (/(клиент|сервер|агент)/.test(normalized)) {
      suggestedLicenseType = 'Серверная часть + агенты';
    }
    return { suggestedLicenseType, suggestedTerm, ldapProfile: 'unknown' };
  }

  return {
    suggestedLicenseType: '',
    suggestedTerm,
    ldapProfile: 'unknown',
  };
}

export function resolveCommercialTerms(input: CommercialContextInput): CommercialContext {
  const derived = deriveCommercialContext(input);
  return {
    suggestedLicenseType: String(input.licenseType || '').trim() || derived.suggestedLicenseType,
    suggestedTerm: String(input.term || '').trim() || derived.suggestedTerm,
    ldapProfile: derived.ldapProfile,
  };
}
