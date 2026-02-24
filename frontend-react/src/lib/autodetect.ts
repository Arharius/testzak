export type GoodsType =
  | 'pc'
  | 'laptop'
  | 'monitor'
  | 'printer'
  | 'mfu'
  | 'server'
  | 'switch'
  | 'router'
  | 'cable'
  | 'dvd'
  | 'software';

export type TypeCandidate = {
  type: GoodsType;
  score: number;
  reason: string;
};

const MODEL_TO_TYPE: Array<{ token: string; type: GoodsType }> = [
  { token: 'vivobook', type: 'laptop' },
  { token: 'zenbook', type: 'laptop' },
  { token: 'expertbook', type: 'laptop' },
  { token: 'matebook', type: 'laptop' },
  { token: 'thinkpad', type: 'laptop' },
  { token: 'notebook', type: 'laptop' },
  { token: 'ноутбук', type: 'laptop' },
  { token: 'laptop', type: 'laptop' },

  { token: 'гравитон н', type: 'laptop' },
  { token: 'graviton n', type: 'laptop' },
  { token: 'гравитон', type: 'pc' },
  { token: 'graviton', type: 'pc' },

  { token: 'системный блок', type: 'pc' },
  { token: 'системник', type: 'pc' },
  { token: 'desktop', type: 'pc' },
  { token: 'workstation', type: 'pc' },
  { token: 'microtower', type: 'pc' },
  { token: 'mini tower', type: 'pc' },
  { token: 'sff', type: 'pc' },

  { token: 'monitor', type: 'monitor' },
  { token: 'монитор', type: 'monitor' },
  { token: 'display', type: 'monitor' },
  { token: 'дисплей', type: 'monitor' },
  { token: 'lcd', type: 'monitor' },
  { token: 'oled', type: 'monitor' },
  { token: 'ips', type: 'monitor' },
  { token: 'qhd', type: 'monitor' },
  { token: 'uhd', type: 'monitor' },
  { token: '4k', type: 'monitor' },

  { token: 'printer', type: 'printer' },
  { token: 'принтер', type: 'printer' },
  { token: 'мфу', type: 'mfu' },
  { token: 'mfp', type: 'mfu' },

  { token: 'server', type: 'server' },
  { token: 'сервер', type: 'server' },
  { token: 'poweredge', type: 'server' },
  { token: 'proliant', type: 'server' },
  { token: 'xeon', type: 'server' },
  { token: 'epyc', type: 'server' },
  { token: 'depo server', type: 'server' },
  { token: 'depo storm', type: 'server' },

  { token: 'depo', type: 'pc' },
  { token: 'депо', type: 'pc' },
  { token: 'depo race', type: 'pc' },
  { token: 'depo neos', type: 'pc' },

  { token: 'switch', type: 'switch' },
  { token: 'коммут', type: 'switch' },
  { token: 'router', type: 'router' },
  { token: 'маршрутиз', type: 'router' },

  { token: 'utp', type: 'cable' },
  { token: 'ftp', type: 'cable' },
  { token: 'витая пара', type: 'cable' },
  { token: 'patch cord', type: 'cable' },
  { token: 'патчкорд', type: 'cable' },
  { token: 'cat5', type: 'cable' },
  { token: 'cat5e', type: 'cable' },
  { token: 'cat6', type: 'cable' },
  { token: 'cat6a', type: 'cable' },
  { token: 'rj45', type: 'cable' },
  { token: '305м', type: 'cable' },
  { token: '305 m', type: 'cable' },

  { token: 'dvd', type: 'dvd' },
  { token: 'dvd-r', type: 'dvd' },
  { token: 'dvd+rw', type: 'dvd' },
  { token: 'cd-r', type: 'dvd' },
  { token: 'bd-r', type: 'dvd' },
  { token: 'blu-ray', type: 'dvd' },

  { token: 'astra linux', type: 'software' },
  { token: 'postgres', type: 'software' },
  { token: 'dbms', type: 'software' },
  { token: 'субд', type: 'software' }
];

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[-_/.,+()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isShortAmbiguous(q: string): boolean {
  return q.length <= 5 || /^[a-zа-я]{2,6}\d{0,2}$/i.test(q);
}

function scoreTokenMatch(query: string, token: string): number {
  if (!query || !token) return 0;
  if (query === token) return 8;
  if (query.includes(token)) return token.length >= 6 ? 6 : 3;
  if (token.includes(query) && query.length >= 3) return 2;
  return 0;
}

export function detectTypeDetailed(model: string, fallback: GoodsType): { type: GoodsType; reason: string } {
  const q = normalize(model);
  if (!q) return { type: fallback, reason: 'empty' };

  if (/^[a-zа-я]{2,4}\d{0,2}$/i.test(q)) {
    return { type: fallback, reason: 'short_ambiguous' };
  }

  if (/(sql server|postgres(?:ql)?|mysql|oracle|mongodb|clickhouse|greenplum|субд)/i.test(q)) {
    return { type: 'software', reason: 'dbms_keyword' };
  }
  if (/(монитор|monitor|дисплей|display|lcd|oled|ips|qhd|uhd|4k|\b\d{2,3}\s?(hz|гц)\b)/i.test(q)) {
    return { type: 'monitor', reason: 'monitor_keyword' };
  }
  if (/(системн(?:ый)? блок|системник|desktop|workstation|microtower|mini tower|\bsff\b)/i.test(q)) {
    return { type: 'pc', reason: 'pc_keyword' };
  }
  if (/(^|\s)(depo|депо)(\s|$)/i.test(q)) {
    if (/(server|сервер|storm|rack|rs\b)/i.test(q)) return { type: 'server', reason: 'depo_server' };
    if (/(laptop|notebook|ноутбук|book)/i.test(q)) return { type: 'laptop', reason: 'depo_laptop' };
    return { type: 'pc', reason: 'depo_default' };
  }

  for (const item of MODEL_TO_TYPE) {
    const score = scoreTokenMatch(q, item.token);
    if (score >= 6) return { type: item.type, reason: `token:${item.token}` };
  }
  for (const item of MODEL_TO_TYPE) {
    const score = scoreTokenMatch(q, item.token);
    if (score > 0) return { type: item.type, reason: `partial:${item.token}` };
  }

  return { type: fallback, reason: 'fallback' };
}

export function buildTypeCandidates(model: string, currentType: GoodsType): TypeCandidate[] {
  const q = normalize(model);
  if (!q) return [{ type: currentType, score: 1, reason: 'current' }];

  const byType = new Map<GoodsType, TypeCandidate>();
  const push = (type: GoodsType, score: number, reason: string) => {
    const prev = byType.get(type);
    if (!prev || score > prev.score) byType.set(type, { type, score, reason });
  };

  push(currentType, 2, 'Текущий выбранный тип');
  for (const item of MODEL_TO_TYPE) {
    const score = scoreTokenMatch(q, item.token);
    if (score > 0) push(item.type, score, `Совпадение: ${item.token}`);
  }

  const best = detectTypeDetailed(q, currentType);
  if (best.type !== currentType || best.reason !== 'fallback') {
    push(best.type, 7, `Автоопределение: ${best.reason}`);
  }

  if (isShortAmbiguous(q)) {
    push('pc', 6, 'Аппаратный вариант для краткого запроса');
    push('monitor', 5, 'Аппаратный вариант для краткого запроса');
    push('printer', 4, 'Аппаратный вариант для краткого запроса');
    push('laptop', 4, 'Аппаратный вариант для краткого запроса');
    push('server', 4, 'Аппаратный вариант для краткого запроса');
  }

  return Array.from(byType.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

