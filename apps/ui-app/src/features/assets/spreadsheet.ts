import * as XLSX from 'xlsx';
import { csvCell, download, type Translate } from './contracts';
import { IMPORT_COLUMNS, targetLabel, type Asset } from './model';
import type { AssetsService } from './service';

export async function readImportFile(file: File): Promise<unknown[][]> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const name = workbook.SheetNames.find(name => /^(assets?|\u8d44\u4ea7)$/i.test(name.trim())) || workbook.SheetNames[0];
  const sheet = name ? workbook.Sheets[name] : undefined;
  return sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false, blankrows: false }) : [];
}
export function downloadTemplate(doc: Document, format: string, t: Translate): void {
  const headers = [...IMPORT_COLUMNS];
  if (format === 'csv') { download(doc, '\uFEFF' + headers.join(',') + '\r\n', 'asset-import-template.csv', 'text/csv;charset=utf-8'); return; }
  const workbook = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet([headers]);
  sheet['!cols'] = headers.map(name => ({ wch: ['target', 'host'].includes(name) ? 28 : 16 })); sheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}1` };
  const guide = XLSX.utils.aoa_to_sheet(['templateGuideTitle', 'templateGuideRequired', 'templateGuideTarget', 'templateGuideProject', 'templateGuideTags', 'templateGuideStatus', 'templateGuideLimit'].map(key => [t('assets.' + key)])); guide['!cols'] = [{ wch: 86 }];
  XLSX.utils.book_append_sheet(workbook, sheet, 'Assets'); XLSX.utils.book_append_sheet(workbook, guide, t('assets.instructionsSheet').slice(0, 31)); XLSX.writeFile(workbook, 'asset-import-template.xlsx');
}
export function exportAssets(doc: Document, assets: Asset[], format: string, service: AssetsService, t: Translate): void {
  const rows: Record<string, string | number>[] = assets.map(a => ({ target: targetLabel(a), host: a.host || '', ip: a.ip || '', domain: a.domain || '', port: a.port || '', protocol: a.protocol || '', title: a.title || '', server: a.server || '', project: a.project_name || '', responsible_person: a.responsible_person || '', department: a.department || '', business_system: a.business_system || '', environment: a.environment || '', criticality: a.criticality || '', country: a.country || '', province: a.province || '', city: a.city || '', source: a.source || '', status: a.status || '', tags: (a.tags || []).join(','), risk_level: a.risk_level || '', vulnerability_count: Number(a.vulnerability_count || 0), first_seen_at: a.first_seen_at || '', last_seen_at: a.last_seen_at || '', last_scan_at: a.last_scan_at || '' }));
  const headers = Object.keys(rows[0] || {}), stamp = new Date().toISOString().slice(0, 10);
  const value = (key: string, value: string | number | undefined) => {
    if (typeof value === 'string' && value && ['environment', 'criticality', 'status'].includes(key)) { const id = 'assets.' + key + value.charAt(0).toUpperCase() + value.slice(1), text = t(id); return text === id ? value : text; }
    if (key === 'risk_level' && typeof value === 'string' && ['critical', 'high', 'medium', 'low', 'info', 'normal', 'unassessed'].includes(value)) return t('assets.risk' + value.charAt(0).toUpperCase() + value.slice(1));
    return value ?? '';
  };
  const matrix = [headers.map(service.exportHeader), ...rows.map(row => headers.map(key => value(key, row[key])))];
  if (format === 'csv') { download(doc, '\uFEFF' + matrix.map(row => row.map(csvCell).join(',')).join('\r\n'), `assets-${stamp}.csv`, 'text/csv;charset=utf-8'); return; }
  const workbook = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet(matrix); sheet['!autofilter'] = { ref: sheet['!ref'] || 'A1' }; sheet['!cols'] = headers.map(key => ({ wch: ['target', 'host', 'title'].includes(key) ? 30 : 16 }));
  XLSX.utils.book_append_sheet(workbook, sheet, 'Assets'); XLSX.writeFile(workbook, `assets-${stamp}.xlsx`);
}
