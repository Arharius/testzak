const fs = require('fs');
const path = require('path');

const tsSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend-react', 'src', 'utils', 'commercial-terms.ts'),
  'utf-8'
);

let js = tsSource;
const lines = js.split('\n');
const cleaned = [];
let skippingType = false;
let skippingObjectType = false;

for (const line of lines) {
  if (!skippingType && line.startsWith('export type ')) {
    skippingType = true;
    skippingObjectType = line.includes('{');
    if (!skippingObjectType && line.trim().endsWith(';')) skippingType = false;
    continue;
  }
  if (skippingType) {
    if (skippingObjectType) {
      if (line.trim() === '};') {
        skippingType = false;
        skippingObjectType = false;
      }
    } else if (line.trim().endsWith(';')) {
      skippingType = false;
    }
    continue;
  }
  cleaned.push(line);
}

js = cleaned.join('\n');
js = js.replace(/^export /gm, '');
js = js.replace(/(const|let|var)\s+(\w+)\s*:\s*[^=]+=\s*/g, '$1 $2 = ');
js = js.replace(/function\s+(\w+)\(([^)]*)\)\s*:\s*[^{]+\{/g, (_m, name, params) => {
  const cleanParams = params.replace(/:\s*[^,)=]+/g, '');
  return `function ${name}(${cleanParams}) {`;
});
js = js.replace(/(\w+)\s*:\s*CommercialContextInput/g, '$1');
js = js.replace(/(\w+)\s*:\s*CommercialContext/g, '$1');
js = js.replace(/(\w+)\s*:\s*LdapLicenseProfile/g, '$1');

const wrappedCode = `
(function() {
  ${js}
  return { deriveCommercialContext, resolveCommercialTerms };
})()
`;

const { deriveCommercialContext, resolveCommercialTerms } = eval(wrappedCode);

const cases = [
  {
    name: 'ALD Pro server',
    input: { type: 'ldap', model: 'ALD Pro (Серверная часть)' },
    expected: { suggestedLicenseType: 'Серверная часть', ldapProfile: 'server' },
  },
  {
    name: 'ALD Pro client generic',
    input: { type: 'ldap', model: 'ALD Pro (Клиентская часть)' },
    expected: { suggestedLicenseType: 'Клиентская часть (CAL)', ldapProfile: 'client' },
  },
  {
    name: 'ALD Pro device CAL',
    input: { type: 'ldap', model: 'ALD Pro CAL на устройство' },
    expected: { suggestedLicenseType: 'CAL на устройство', ldapProfile: 'client_device' },
  },
  {
    name: 'ALD Pro user CAL',
    input: { type: 'ldap', model: 'ALD Pro CAL на пользователя' },
    expected: { suggestedLicenseType: 'CAL на пользователя', ldapProfile: 'client_user' },
  },
  {
    name: 'Support level and term',
    input: { type: 'supportCert', model: 'Техническая поддержка привилегированная 36 мес.' },
    expected: { suggestedLicenseType: 'Привилегированная', suggestedTerm: '36 мес.' },
  },
  {
    name: 'VDI CCU',
    input: { type: 'vdi', model: 'Termidesk конкурентные пользователи CCU 12 мес.' },
    expected: { suggestedLicenseType: 'Конкурентные пользователи (CCU)', suggestedTerm: '12 мес.' },
  },
];

let failed = 0;

for (const testCase of cases) {
  const actual = deriveCommercialContext(testCase.input);
  let ok = true;

  for (const [key, value] of Object.entries(testCase.expected)) {
    if (actual[key] !== value) {
      ok = false;
      break;
    }
  }

  const marker = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${marker} ${testCase.name}`);
  if (!ok) {
    failed += 1;
    console.log(' expected:', testCase.expected);
    console.log(' actual  :', actual);
  }
}

const resolved = resolveCommercialTerms({ type: 'ldap', model: 'ALD Pro (Клиентская часть)' });
if (resolved.suggestedLicenseType !== 'Клиентская часть (CAL)') {
  failed += 1;
  console.log('\x1b[31mFAIL\x1b[0m resolveCommercialTerms fallback');
}

console.log(`\n${cases.length + 1 - failed}/${cases.length + 1} checks passed`);

if (failed > 0) {
  process.exit(1);
}
