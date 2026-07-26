import * as XLSX from 'xlsx';

/** 读取 Excel 第一张表为对象数组 */
export function readExcelFile(file: File): Promise<Record<string, any>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(sheet) as Record<string, any>[]);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** 从 input change 事件取文件并解析 */
export async function readExcelFromEvent(event: Event): Promise<Record<string, any>[]> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return [];
  try {
    return await readExcelFile(file);
  } finally {
    input.value = '';
  }
}

/** 导出行数据为 xlsx 并下载 */
export function exportRows(
  rows: Record<string, any>[],
  filename: string,
  sheetName = 'Sheet1',
) {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const name = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(wb, name);
}

/** 下载仅含表头的模板 */
export function downloadTemplate(headers: string[], filename: string, sheetName = '模板') {
  const row: Record<string, string> = {};
  headers.forEach(h => {
    row[h] = '';
  });
  exportRows([row], filename, sheetName);
}

/** 取单元格：兼容中英列名 */
export function cell(row: Record<string, any>, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
      return String(row[k]).trim();
    }
  }
  return '';
}

export function cellNum(row: Record<string, any>, ...keys: string[]): number {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
      const n = Number(row[k]);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}
