#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..');
const htmlPath = path.join(projectRoot, 'legacy', 'index.html');
const reportMdPath = path.join(__dirname, 'autodetect_report.md');
const reportJsonPath = path.join(__dirname, 'autodetect_report.json');

const html = fs.readFileSync(htmlPath, 'utf8');

function extractBetween(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error(`Start marker not found: ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  if (end === -1) throw new Error(`End marker not found: ${endMarker}`);
  return src.slice(start, end);
}

function initAutoDetect() {
  const catalogBlock = extractBetween(
    html,
    'const GOODS_CATALOG = {',
    '// (onGoodsTypeChange удалена — интерфейс перешёл на мульти-строчный список)'
  );

  const detectBlock = extractBetween(
    html,
    '// Автоопределение типа товара по введённому названию продукта',
    '// HTML дропдауна для строки'
  );

  const nodes = Object.create(null);
  const context = {
    document: {
      getElementById(id) {
        return nodes[id] || null;
      },
    },
    setTimeout: () => {},
  };

  vm.createContext(context);
  vm.runInContext(catalogBlock, context);
  vm.runInContext(
    `${detectBlock}
this.autoDetectGoodsType = autoDetectGoodsType;
this.MODEL_TO_TYPE = MODEL_TO_TYPE;
this.normalizeDetectText = normalizeDetectText;
this.GOODS_CATALOG = GOODS_CATALOG;`,
    context
  );

  function detect(input, initialType = 'pc') {
    nodes['goods-type-1'] = { value: initialType };
    nodes['goods-search-1'] = { value: '', style: {}, title: '' };
    context.autoDetectGoodsType(1, input);
    return nodes['goods-type-1'].value;
  }

  return { context, detect };
}

const CASES_BY_TYPE = {
  patchCord: [
    'UTP 305 метров',
    'Витая пара UTP cat5e 305м',
    'DEXP TP5C51UUTP305G',
    'Витая пара DEXP TP5C51UUTP305G 305 м',
    'кабель U/UTP кат.5e бухта 305м',
  ],
  laptop: [
    'Asus Vivobook 15 X1504',
    'ASUS ZenBook 14',
    'ASUS ExpertBook B1',
    'Huawei MateBook D16',
    'Lenovo ThinkPad E14',
    'Lenovo IdeaPad 5',
    'HP ProBook 450',
    'HP EliteBook 840',
    'Dell Latitude 5540',
    'Dell XPS 13',
    'Acer TravelMate P2',
    'Acer Swift 3',
    'Apple MacBook Air',
    'Microsoft Surface Laptop 5',
    'Acer Nitro 5',
    'Graviton N15',
    'Гравитон Н15И',
    'ноутбук офисный 15.6',
  ],
  pc: [
    'Гравитон C2',
    'graviton c',
    'Aquarius Pro P30',
    'Аквариус CMP',
    'iRU Office 315',
    'IRU Home 310',
    'Yadro Vegman N110',
    'YADRO V',
    'Системный блок офисный',
    'Системник Core i5',
    'Desktop workstation',
    'Рабочая станция в корпусе tower',
  ],
  monitor: [
    'Монитор 24 дюйма IPS',
    'Monitor 27 QHD 165Hz',
    'LCD display 24 inch',
    '4K OLED monitor',
  ],
  dvd: [
    'DVD-R Verbatim 4.7GB',
    'DVD+RW 4.7GB',
    'CD-R Mirex 700MB',
    'CD-RW 700MB',
    'BD-R 25GB',
    'BD-RE 50GB',
    'Blu-ray 50GB',
    'оптический диск для архива',
    'dvd',
  ],
  backup_sw: [
    'RuBackup 2.4',
    'Rubacup enterprise',
    'Кибер Бэкап 17',
    'Veeam Backup & Replication',
    'Acronis Cyber Protect',
    'Commvault Complete',
    'Bacula Enterprise',
    'Bareos backup',
    'NAKIVO Backup',
    'Veritas NetBackup',
  ],
  vdi: [
    'Termidesk 5.0',
    'Термидеск 5',
    'Базис.WorkPlace',
    'RuDesktop',
    'VMware Horizon',
    'Citrix Virtual Apps',
  ],
  email: [
    'РуПост',
    'RuPost',
    'Communigate Pro',
    'Mailion',
    'Zimbra OSE',
    'Microsoft Exchange 2019',
    'Postfix + Dovecot',
  ],
  os: [
    'Astra Linux SE',
    'ALT Linux Server',
    'РЕД ОС 8',
    'Windows Server 2022',
    'Windows 11 Pro',
    'Ubuntu 22.04',
    'Debian 12',
  ],
  office: [
    'МойОфис Стандартный',
    'MyOffice',
    'Р7-Офис',
    'P7-Office',
    'LibreOffice 24',
    'OpenOffice',
    'Microsoft Office LTSC',
    'p7',
  ],
  antivirus: [
    'Kaspersky Endpoint Security',
    'KES',
    'Dr.Web Enterprise',
    'ESET Endpoint',
    'Symantec Endpoint Protection',
    'nano av',
  ],
  edr: [
    'Kaspersky EDR',
    'PT Sandbox',
    'CrowdStrike Falcon',
    'SentinelOne Singularity',
    'CarbonBlack',
    'XEDR',
  ],
  firewall_sw: [
    'UserGate NGFW',
    'Юзергейт межсетевой экран',
    'Континент 4',
    'Fortinet FortiGate',
    'CheckPoint NGFW',
    'Palo Alto PA-440',
    'Cisco ASA',
  ],
  vpn: [
    'ViPNet Client',
    'ViPNet Coordinator',
    'Континент-АП',
    'S-Terra Client',
    'vipnet',
  ],
  crypto: [
    'КриптоПро CSP 5.0',
    'CryptoPro CSP',
    'Лисси CSP',
    'Signal-COM CSP',
  ],
  dbms: [
    'PostgreSQL 16',
    'Postgres Pro Enterprise',
    'Tantor SE',
    'Jatoba',
    'MySQL 8',
    'Oracle Database',
    'MongoDB',
    'ClickHouse',
    '1С:PostgreSQL',
  ],
  erp: [
    '1С:Предприятие 8.3',
    '1C Enterprise',
    'Галактика ERP',
    'Парус 8',
    'SAP ERP',
    'Microsoft Dynamics AX',
    '1c',
  ],
  siem: [
    'MaxPatrol SIEM',
    'KUMA SIEM',
    'RuSIEM',
    'PT SIEM',
    'Positive Technologies SIEM',
  ],
  monitoring: [
    'Zabbix 7',
    'Grafana Enterprise',
    'Prometheus',
    'Nagios XI',
    'Icinga2',
    'OpenNMS',
  ],
  itsm: [
    'SimpleOne ITSM',
    'Naumen Service Desk',
    'Jira Service Management',
    'ITILium',
    'Ivanti Neurons',
    'ServiceNow',
    'Redmine ITSM',
  ],
  ecm: [
    'Directum RX',
    'DocsVision',
    'ТЕЗИС',
    'ELMA365',
    'Дело-Web',
    'EOS for SharePoint',
  ],
  reporting: [
    'Контур Экстерн',
    'СБИС Отчетность',
    'Такском Онлайн',
    'Астрал Отчет',
    'taxcom',
  ],
  pam: [
    'Indeed PAM',
    'Wallix PAM',
    'CyberArk Privileged Access',
    'Senhasegura',
  ],
  iam: [
    'Solar inRights',
    'Indeed Access Manager',
    'SailPoint IdentityIQ',
    '1IDM',
  ],
  waf: [
    'PT Application Firewall',
    'PT AF',
    'Solar appScreener',
    'Imperva WAF',
  ],
  dlp: [
    'InfoWatch Traffic Monitor',
    'Solar Dozor',
    'Zecurion DLP',
    'Falcongaze SecureTower',
    'Инфовотч',
  ],
  ldap: [
    'ALD Pro',
    'FreeIPA',
    'OpenLDAP',
    'Active Directory',
    'служба каталогов',
    'LDAP сервер',
  ],
  vks: [
    'TrueConf Server',
    'Видеомост',
    'iMind',
    'MTS Link',
    'Cisco Webex',
    'Jitsi Meet',
    'SberJazz',
  ],
};

const FALSE_POSITIVE_CASES = [
  { input: 'г', initial: 'pc', expected: 'pc' },
  { input: 'гр', initial: 'pc', expected: 'pc' },
  { input: 'gra', initial: 'pc', expected: 'pc' },
  { input: 'rdw', initial: 'pc', expected: 'pc' },
  { input: 'RDW', initial: 'pc', expected: 'pc' },
  { input: 'zzzz', initial: 'pc', expected: 'pc' },
];

function flattenCases() {
  const list = [];
  for (const [expected, inputs] of Object.entries(CASES_BY_TYPE)) {
    for (const input of inputs) {
      list.push({ input, expected, initial: 'pc' });
    }
  }
  for (const c of FALSE_POSITIVE_CASES) {
    list.push({ ...c, expected: c.expected });
  }
  return list;
}

function buildSuggestions(input, dict, normalize) {
  const norm = normalize(input);
  if (!norm) return [];
  const candidates = Object.entries(dict)
    .map(([key, type]) => ({ key, type, normKey: normalize(key) }))
    .filter(({ normKey }) => normKey.includes(norm) || norm.includes(normKey))
    .slice(0, 5);
  return candidates.map(c => `${c.key} -> ${c.type}`);
}

function run() {
  const { context, detect } = initAutoDetect();
  const allCases = flattenCases();
  const results = allCases.map(test => {
    const actual = detect(test.input, test.initial);
    const ok = actual === test.expected;
    return { ...test, actual, ok };
  });

  const failures = results.filter(r => !r.ok).map(r => ({
    ...r,
    suggestions: buildSuggestions(r.input, context.MODEL_TO_TYPE, context.normalizeDetectText),
  }));

  const coverage = Object.keys(CASES_BY_TYPE)
    .sort()
    .map(type => {
      const byType = results.filter(r => r.expected === type);
      const passed = byType.filter(r => r.ok).length;
      return { type, cases: byType.length, passed, failed: byType.length - passed };
    });

  const total = results.length;
  const passed = results.filter(r => r.ok).length;
  const failed = failures.length;

  const report = {
    generated_at: new Date().toISOString(),
    total_cases: total,
    passed_cases: passed,
    failed_cases: failed,
    coverage,
    failures,
  };

  const md = [];
  md.push('# Autodetect Matrix Report');
  md.push('');
  md.push(`- Generated: ${report.generated_at}`);
  md.push(`- Total: ${total}`);
  md.push(`- Passed: ${passed}`);
  md.push(`- Failed: ${failed}`);
  md.push('');
  md.push('## Coverage by Expected Type');
  md.push('');
  md.push('| Type | Cases | Passed | Failed |');
  md.push('|---|---:|---:|---:|');
  for (const row of coverage) {
    md.push(`| ${row.type} | ${row.cases} | ${row.passed} | ${row.failed} |`);
  }
  md.push('');
  md.push('## Failures');
  md.push('');
  if (failures.length === 0) {
    md.push('No failures.');
  } else {
    md.push('| Input | Expected | Actual | Suggested Keys |');
    md.push('|---|---|---|---|');
    for (const f of failures) {
      md.push(`| ${f.input} | ${f.expected} | ${f.actual} | ${f.suggestions.join('<br>')} |`);
    }
  }
  md.push('');
  md.push('## Notes');
  md.push('');
  md.push('- Script validates only client-side auto-detection mapping (`MODEL_TO_TYPE` + `autoDetectGoodsType`).');
  md.push('- It does not call external APIs and does not validate AI model output quality.');
  md.push('');

  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(reportMdPath, md.join('\n'), 'utf8');

  console.log(`Autodetect matrix complete. Passed ${passed}/${total}, failed ${failed}.`);
  console.log(`Report: ${reportMdPath}`);
  console.log(`JSON:   ${reportJsonPath}`);

  if (failed > 0) process.exitCode = 1;
}

run();
