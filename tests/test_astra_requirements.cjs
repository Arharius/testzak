const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const workspacePath = path.join(root, 'frontend-react', 'src', 'components', 'Workspace.tsx');
const npaPath = path.join(root, 'frontend-react', 'src', 'utils', 'npa-blocks.ts');
const compliancePath = path.join(root, 'frontend-react', 'src', 'utils', 'compliance.ts');

const workspace = fs.readFileSync(workspacePath, 'utf-8');
const npa = fs.readFileSync(npaPath, 'utf-8');
const compliance = fs.readFileSync(compliancePath, 'utf-8');

const checks = [
  {
    name: 'ALD Pro: SaltStack policies',
    haystack: workspace + npa,
    needle: 'SaltStack',
  },
  {
    name: 'ALD Pro: sites and replication topology',
    haystack: workspace + npa,
    needle: 'сайтами и топологией репликации',
  },
  {
    name: 'ALD Pro: DHCP/DNS integration',
    haystack: workspace + npa,
    needle: 'интеграцию с DHCP/DNS',
  },
  {
    name: 'ALD Pro: CAL per device or user',
    haystack: workspace + npa,
    needle: 'CAL на каждое устройство или пользователя',
  },
  {
    name: 'ALD Pro client: host configuration management',
    haystack: workspace,
    needle: 'поддержка централизованного применения настроек и конфигураций к рабочим станциям и серверам в домене',
  },
  {
    name: 'ALD Pro client: compatibility with server part',
    haystack: workspace,
    needle: 'ALD Pro Server / контроллер домена или эквивалентная серверная часть службы каталогов',
  },
  {
    name: 'ALD Pro server: OU hierarchy management',
    haystack: workspace,
    needle: 'Управление организационными единицами (OU)',
  },
  {
    name: 'ALD Pro server: PXE netboot',
    haystack: workspace,
    needle: 'поддержка PXE / netboot для сетевого развёртывания рабочих станций и серверов',
  },
  {
    name: 'ALD Pro server: license composition',
    haystack: workspace,
    needle: 'серверная лицензия на контроллер домена и клиентские лицензии CAL на управляемые объекты',
  },
  {
    name: 'Astra Linux: kernel version 6.1+',
    haystack: workspace,
    needle: 'Версия ядра Linux',
  },
  {
    name: 'Astra Linux: mandatory access control',
    haystack: workspace,
    needle: 'Мандатное управление доступом (MAC)',
  },
  {
    name: 'Astra Linux: memory clearing',
    haystack: workspace,
    needle: 'Очистка оперативной памяти и временных данных',
  },
  {
    name: 'Astra Linux: ecosystem compatibility',
    haystack: workspace,
    needle: 'Совместимость с экосистемой Astra',
  },
  {
    name: 'Astra Linux: minimum 45 specs rule',
    haystack: workspace,
    needle: 'return 45;',
  },
  {
    name: 'Catalog depth: software admin console',
    haystack: workspace,
    needle: 'Веб-интерфейс администрирования',
  },
  {
    name: 'Catalog depth: network VLAN support',
    haystack: workspace,
    needle: 'Поддержка VLAN и сегментации трафика',
  },
  {
    name: 'Catalog depth: compute OS compatibility',
    haystack: workspace,
    needle: 'Совместимость с отечественными ОС',
  },
  {
    name: 'Catalog depth: weak specs rewrite flow',
    haystack: workspace,
    needle: 'Слабые / размытые характеристики, которые нужно конкретизировать',
  },
  {
    name: 'RuBackup: global dedup client and server',
    haystack: workspace + npa,
    needle: 'Глобальная дедупликация на стороне клиента и сервера',
  },
  {
    name: 'RuBackup: RBAC',
    haystack: workspace + npa,
    needle: 'Ролевая модель доступа (RBAC)',
  },
  {
    name: 'RuBackup: GOST encryption',
    haystack: workspace + npa,
    needle: 'Шифрование резервных копий по ГОСТ',
  },
  {
    name: 'Brest: mandated access control to VMs',
    haystack: workspace + npa,
    needle: 'мандатное управление доступом к виртуальным машинам',
  },
  {
    name: 'RuPost: high availability',
    haystack: workspace + npa,
    needle: 'кластеризацию и иные механизмы высокой доступности',
  },
  {
    name: 'RuPost: Exchange migration',
    haystack: workspace + npa,
    needle: 'Microsoft Exchange с сохранением почтовых сообщений, календарей и адресных книг',
  },
  {
    name: 'Termidesk: multitenancy',
    haystack: workspace + npa,
    needle: 'Мультиарендность',
  },
  {
    name: 'Termidesk: CCU licensing',
    haystack: workspace + npa,
    needle: 'конкурентных пользователей (CCU)',
  },
  {
    name: 'Termidesk: gateway without VPN',
    haystack: workspace + npa,
    needle: 'без обязательного использования VPN',
  },
  {
    name: 'Support: privileged 24x7 and 1 hour SLA',
    haystack: workspace + npa,
    needle: 'режим 24x7 и время реакции на критический инцидент не более 1 часа',
  },
  {
    name: 'Support: major upgrades',
    haystack: workspace + npa,
    needle: 'Право на получение новых мажорных релизов',
  },
  {
    name: 'Cleanup: explicit anti-noise expansion hook',
    haystack: compliance,
    needle: 'function expandGenericValue(',
  },
  {
    name: 'Cleanup: electronic supply phrase',
    haystack: compliance,
    needle: 'электронная поставка лицензий, ключей активации, дистрибутива и эксплуатационной документации',
  },
  {
    name: 'Cleanup: registry inclusion phrase',
    haystack: compliance,
    needle: 'включено в Единый реестр российского ПО Минцифры России',
  },
  {
    name: 'Cleanup: RBAC expanded value',
    haystack: compliance,
    needle: 'разделение ролей и полномочий пользователей, операторов, администраторов и аудиторов',
  },
  {
    name: 'Cleanup: audit expanded value',
    haystack: compliance,
    needle: 'аудит входов, изменений конфигурации и административных операций',
  },
  {
    name: 'Cleanup: isolated perimeter phrase',
    haystack: compliance,
    needle: 'работа в изолированном контуре без обязательного обращения к внешним сервисам',
  },
];

let failed = 0;

for (const check of checks) {
  const ok = check.haystack.includes(check.needle);
  if (!ok) {
    failed += 1;
  }
  const marker = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${marker} ${check.name}`);
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed`);

if (failed > 0) {
  process.exit(1);
}
