import { downloadBlob } from './download.js';

/** Builds a CSV string and triggers a browser download. */
export function downloadCsv(filename, headers, rows) {
  const escapeCell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  downloadBlob(filename, new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
}