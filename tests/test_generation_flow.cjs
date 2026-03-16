const fs = require('fs');
const path = require('path');

const workspacePath = path.join(__dirname, '..', 'frontend-react', 'src', 'components', 'Workspace.tsx');
const workspace = fs.readFileSync(workspacePath, 'utf-8');

const checks = [
  {
    name: 'Normal generation does not inherit autopilot setting',
    ok: workspace.includes('const autopilotEnabled = !!options?.forceAutopilot;'),
  },
  {
    name: 'Search-first still runs for explicit autopilot or universal goods',
    ok: workspace.includes('const shouldSearchBeforeGenerate = autopilotEnabled || isUniversalGoodsType(currentRow.type);'),
  },
];

let failed = 0;

for (const check of checks) {
  const marker = check.ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${marker} ${check.name}`);
  if (!check.ok) failed += 1;
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed`);

if (failed > 0) process.exit(1);
