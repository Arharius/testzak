/**
 * Test script for React frontend goods-catalog.ts detection functions.
 * Strips TypeScript syntax to evaluate as plain JS in Node.
 */

const fs = require('fs');
const path = require('path');

// Read the TypeScript source
const tsSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend-react', 'src', 'data', 'goods-catalog.ts'),
  'utf-8'
);

// Strip TypeScript to get valid JS
let js = tsSource;

// Remove export keywords
js = js.replace(/^export /gm, '');

// Remove type aliases: type Foo = string;
js = js.replace(/^type \w+\s*=\s*[^;]+;\s*$/gm, '');

// Remove interfaces (multi-line)
js = js.replace(/^interface \w+\s*\{[\s\S]*?\n\}\s*$/gm, '');

// Remove type annotations on const/let/var declarations (e.g., `: Record<string, string[]>`)
// This handles `: Type = ` patterns on const lines
js = js.replace(/(const|let|var)\s+(\w+)\s*:\s*[^=]+=\s*/g, '$1 $2 = ');

// Remove function return type annotations line by line
// Handle: function foo(x: string, y: string): ReturnType {
// Handle: function foo(x: string): Array<{...}> {
const lines = js.split('\n');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Match function declarations with type annotations
  const fnMatch = line.match(/^(\s*function\s+\w+\s*)\(([^)]*)\)\s*:.+\{\s*$/);
  if (fnMatch) {
    const cleanParams = fnMatch[2].replace(/:\s*\w+(\[\])?/g, '');
    lines[i] = `${fnMatch[1]}(${cleanParams}) {`;
  }
  // Remove type annotations from arrow function params: (t: string) => ...
  lines[i] = lines[i].replace(/\((\w+)\s*:\s*\w+\)\s*=>/g, '($1) =>');
}
js = lines.join('\n');

// Remove remaining type annotations from const with complex types
// e.g., const results: Array<{ ... }> = [];
js = js.replace(/(const|let|var)\s+(\w+)\s*:\s*Array<\{[^}]+\}>\s*=/g, '$1 $2 =');

// Remove generic type params: new Set<string>() -> new Set()
js = js.replace(/new\s+(Set|Map|Array|WeakMap|WeakSet|Promise)<[^>]+>/g, 'new $1');

// Remove `as const`
js = js.replace(/\s+as\s+const/g, '');

// Evaluate
const wrappedCode = `
(function() {
  ${js}
  return { detectGoodsType, detectAllGoodsTypes, GOODS_CATALOG };
})()
`;

let mod;
try {
  mod = eval(wrappedCode);
} catch (e) {
  console.error('Failed to evaluate goods-catalog.ts as JS:');
  console.error(e.message);
  // Find the problematic line
  const lines = wrappedCode.split('\n');
  const match = e.stack?.match(/<anonymous>:(\d+)/);
  if (match) {
    const lineNum = parseInt(match[1]);
    console.error(`\nNear line ${lineNum}:`);
    for (let i = Math.max(0, lineNum - 4); i < Math.min(lines.length, lineNum + 3); i++) {
      console.error(`  ${i + 1}: ${lines[i]}`);
    }
  }
  process.exit(1);
}

const { detectGoodsType, detectAllGoodsTypes, GOODS_CATALOG } = mod;

console.log(`Loaded GOODS_CATALOG with ${Object.keys(GOODS_CATALOG).length} types\n`);

// ── Test cases ──
const testCases = [
  { input: 'ALD PRO', expected: 'ldap', mode: 'exact' },
  { input: 'Алд Про', expected: 'ldap', mode: 'exact' },
  { input: 'ALD Pro (Серверная часть)', expected: 'ldap', mode: 'exact' },
  { input: 'ALD Pro (Клиентская часть)', expected: 'ldap', mode: 'exact' },
  { input: 'RuBackup', expected: 'backup_sw', mode: 'exact' },
  { input: 'Termidesk', expected: 'vdi', mode: 'exact' },
  { input: 'Брест', expected: 'virt', mode: 'includes' },
  { input: 'Brest', expected: 'virt', mode: 'includes' },
  { input: 'RuPost', expected: 'email', mode: 'exact' },
  { input: 'рупост', expected: 'email', mode: 'exact' },
  { input: 'Astra Linux', expected: 'os', mode: 'exact' },
  { input: 'astra linus', expected: 'os', mode: 'exact' },
  { input: 'Техническая поддержка', expected: 'supportCert', mode: 'exact' },
  { input: 'Техническая поддержка ALD Pro', expected: 'supportCert', mode: 'exact' },
  { input: 'Техническая поддержка RuBackup', expected: 'supportCert', mode: 'exact' },
  { input: 'Техническая поддержка Termidesk', expected: 'supportCert', mode: 'exact' },
  { input: 'Техническая поддержка Astra Linux', expected: 'osSupport', mode: 'exact' },
  { input: 'Kaspersky', expected: 'antivirus', mode: 'includes' },
  { input: 'HP ProLiant', expected: 'server', mode: 'includes' },
  { input: 'Cisco Catalyst', expected: 'switch', mode: 'includes' },
  { input: '1С:Предприятие', expected: 'erp', mode: 'includes' },
  { input: 'КриптоПро CSP', expected: 'crypto', mode: 'includes' },
  { input: 'TrueConf', expected: 'vks', mode: 'includes' },
  { input: 'Zabbix', expected: 'monitoring', mode: 'includes' },
  { input: 'PostgreSQL', expected: 'dbms', mode: 'includes' },
  { input: 'UserGate', expected: 'firewall_sw', mode: 'includes' },
  { input: 'Термопринтер', expected: null, mode: 'check' },
  { input: 'Патч-корд UTP cat6', expected: 'patchCord', mode: 'includes' },
  { input: 'Xerox VersaLink C7030', expected: null, mode: 'check' },
  { input: 'Гравитон Н15', expected: 'laptop', mode: 'exact' },
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const singleResult = detectGoodsType(tc.input, '__none__');
  const allResults = detectAllGoodsTypes(tc.input);
  const allTypes = allResults.map(r => r.type);

  let status, detail;

  if (tc.mode === 'exact') {
    if (singleResult === tc.expected) {
      status = 'PASS';
      passed++;
    } else {
      status = 'FAIL';
      failed++;
    }
    detail = `detectGoodsType = "${singleResult}", expected = "${tc.expected}"`;
  } else if (tc.mode === 'includes') {
    if (allTypes.includes(tc.expected)) {
      status = 'PASS';
      passed++;
    } else {
      status = 'FAIL';
      failed++;
    }
    detail = `detectAll = [${allTypes.join(', ')}], expected includes "${tc.expected}", single = "${singleResult}"`;
  } else {
    status = 'INFO';
    passed++;
    detail = `detectGoodsType = "${singleResult}", detectAll = [${allTypes.join(', ')}]`;
  }

  const marker = status === 'PASS' ? '\x1b[32mPASS\x1b[0m'
               : status === 'FAIL' ? '\x1b[31mFAIL\x1b[0m'
               : '\x1b[36mINFO\x1b[0m';
  console.log(`  ${marker}  "${tc.input}"\n         ${detail}`);
}

console.log(`\n── Summary: ${passed} passed, ${failed} failed out of ${testCases.length} tests ──`);

if (failed > 0) {
  process.exit(1);
}
