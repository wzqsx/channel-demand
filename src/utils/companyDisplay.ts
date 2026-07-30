/** 主体展示名统一：下拉与表格必须用同一套文案 */

/** 易混称呼 → 标准名（按去空格、小写匹配） */
const NAME_ALIAS: Record<string, string> = {
  下级c: '下属C',
  下级ｃ: '下属C',
  子公司c: '下属C',
  下属c: '下属C',
  下级a: '下属A',
  子公司a: '下属A',
  下属a: '下属A',
  下级b: '下属B',
  子公司b: '下属B',
  下属b: '下属B',
};

/** 主体代码默认标准名（种子/空名纠偏） */
const CODE_DEFAULT_NAME: Record<string, string> = {
  ZC: '总公司',
  ZA: '下属A',
  ZB: '下属B',
  ZC2: '下属C',
};

function normKey(s: string) {
  return String(s || '')
    .normalize('NFC')
    .replace(/[\s\u200b\u200c\u200d\ufeff]/g, '')
    .toLowerCase();
}

/** 将主体名称规范为统一文案（下级C / 子公司C → 下属C） */
export function canonicalCompanyName(name: string, code?: string): string {
  const raw = String(name || '').trim();
  const codeKey = String(code || '').trim().toUpperCase();
  const alias = NAME_ALIAS[normKey(raw)];
  if (alias) return alias;
  if (codeKey === 'ZC2' && /下级|下属|子公司/.test(raw)) return '下属C';
  if (codeKey === 'ZA' && /下级|下属|子公司/.test(raw)) return '下属A';
  if (codeKey === 'ZB' && /下级|下属|子公司/.test(raw)) return '下属B';
  if (!raw && codeKey && CODE_DEFAULT_NAME[codeKey]) return CODE_DEFAULT_NAME[codeKey];
  return raw;
}

/** 下拉统一标签：名称（代码） */
export function formatCompanyLabel(company: { name?: string; code?: string }): string {
  const code = String(company.code || '').trim();
  const name = canonicalCompanyName(String(company.name || ''), code);
  return code ? `${name}（${code}）` : name;
}

/** 表格等场景：仅标准名称 */
export function formatCompanyNameOnly(company: { name?: string; code?: string }): string {
  return canonicalCompanyName(String(company.name || ''), String(company.code || ''));
}
