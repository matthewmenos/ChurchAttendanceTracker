'use strict';

/**
 * Minimal .xlsx (SpreadsheetML) writer used by the reports export.
 *
 * Why hand-rolled? Native, editable Excel charts are not offered by the
 * maintained JavaScript spreadsheet libraries (ExcelJS cannot create charts at
 * all, SheetJS keeps charts in its paid edition), so the handful of required
 * XML parts are emitted directly and zipped with jszip.
 *
 * Two deliberate choices keep Excel from flagging the file as "repaired":
 *   - no theme part is written and every colour is an explicit ARGB/srgbClr
 *     value (never theme="1"), and
 *   - sheet child elements are emitted in the order the schema requires.
 *
 * Public API:
 *   createWorkbook({ properties, sheets }) -> Promise<Buffer>
 *
 * A sheet is:
 *   {
 *     name: 'By service',                      // <= 31 chars, no []:*?/\
 *     tabColor: '2563EB',
 *     banner: [[{ text, span, style }]],       // rows above the header
 *     columns: [{ key, label, width, type, numFmt, align }],
 *     rows: [{ <key>: value } | { values, style }],
 *     charts: [{ kind, title, anchorSheet, anchor, series }],
 *     freeze: true, autoFilter: true, landscape: true, band: true,
 *     header: true, totalRow: { label, values }
 *   }
 */

const JSZip = require('jszip');

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SHEET_MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const CHART_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const CORE_NS = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const DC_NS = 'http://purl.org/dc/elements/1.1/';
const DCTERMS_NS = 'http://purl.org/dc/terms/';
const DCMITYPE_NS = 'http://purl.org/dc/dcmitype/';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const APP_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';
const VT_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes';

/** Explicit palette (ARGB for styles, RGB for chart series). */
const COLORS = {
  ink: 'FF1F2937',
  headerInk: 'FFFFFFFF',
  headerFill: 'FF1D4ED8',
  bandFill: 'FFF8FAFC',
  totalFill: 'FFEFF6FF',
  line: 'FFE2E8F0',
};

const CHART_COLORS = ['2563EB', '16A34A', 'DC2626', 'F59E0B', '7C3AED', '0891B2', 'DB2777', '65A30D'];

// ---------------------------------------------------------------- primitives

function xmlEscape(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 1 -> A, 26 -> Z, 27 -> AA. */
function colName(index) {
  let n = Math.max(1, Math.floor(Number(index) || 1));
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cellRef(col, row) {
  return `${colName(col)}${row}`;
}

/** Sheet names inside formulas must be quoted; embedded quotes are doubled. */
function sheetRef(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

/** pg returns DATE columns as local-midnight Dates, so read the local parts. */
function dateParts(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value === null || value === undefined ? '' : value));
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Excel serial date in the 1900 system (including its phantom 1900-02-29). */
function dateToSerial(value) {
  const p = dateParts(value);
  if (!p) return null;
  const days = (Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(1899, 11, 30)) / 86400000;
  return Math.round(days);
}

/** Serial date + time-of-day fraction, for timestamp columns. */
function dateTimeToSerial(value) {
  const asDate = value instanceof Date ? value : new Date(String(value));
  if (!Number.isNaN(asDate.getTime())) {
    const days = dateToSerial(asDate);
    if (days !== null) {
      const fraction = (asDate.getHours() * 3600 + asDate.getMinutes() * 60 + asDate.getSeconds()) / 86400;
      return Math.round((days + fraction) * 86400) / 86400;
    }
  }
  return dateToSerial(value);
}

/** 'YYYY-MM-DD' for file names, banners and chart caches. */
function toIsoDate(value) {
  const p = dateParts(value);
  if (!p) return String(value === null || value === undefined ? '' : value);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// -------------------------------------------------------------------- styles

const BUILTIN_NUM_FMT = { General: 0, '0': 1, '#,##0': 3, '0.00': 2, '0%': 9 };
const FIRST_CUSTOM_NUM_FMT = 164;

/**
 * Deduplicating style registry: every distinct font/fill/border/numFmt/xf
 * combination is stored once and referenced by index, which keeps styles.xml
 * compact even with banded rows and highlighted totals.
 */
function createStyleRegistry() {
  const numFmts = [];
  const customIds = new Map();
  const fonts = [{ key: '{}', spec: { size: 11, color: COLORS.ink, name: 'Calibri' } }];
  const fills = [{ key: 'none' }, { key: 'gray125' }];
  const borders = [{ key: 'none' }];
  const xfs = [];

  function indexOf(list, key, make) {
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].key === key) return i;
    }
    list.push(make());
    return list.length - 1;
  }

  function fontId(spec) {
    const font = {
      bold: !!spec.bold,
      italic: !!spec.italic,
      size: spec.size || 11,
      color: spec.color || COLORS.ink,
      name: 'Calibri',
    };
    return indexOf(fonts, JSON.stringify(font), () => ({ key: JSON.stringify(font), spec: font }));
  }

  function fillId(color) {
    if (!color) return 0;
    return indexOf(fills, color, () => ({ key: color, argb: color }));
  }

  function borderId(kind) {
    if (!kind) return 0;
    return indexOf(borders, kind, () => ({ key: kind }));
  }

  function numFmtId(code) {
    if (!code || BUILTIN_NUM_FMT[code] !== undefined) return BUILTIN_NUM_FMT[code] || 0;
    if (customIds.has(code)) return customIds.get(code);
    const id = FIRST_CUSTOM_NUM_FMT + numFmts.length;
    customIds.set(code, id);
    numFmts.push({ id, code });
    return id;
  }

  /** Resolve a style spec into a cellXfs index (0 is the untouched default). */
  function style(spec) {
    const s = spec || {};
    const resolved = {
      f: fontId(s),
      fill: fillId(s.fill),
      border: borderId(s.border),
      numFmt: numFmtId(s.numFmt),
      align: s.align || null,
      valign: s.valign || null,
      wrap: !!s.wrap,
    };
    return indexOf(xfs, JSON.stringify(resolved), () => ({ key: JSON.stringify(resolved), spec: resolved }));
  }

  function fontsXml() {
    return fonts.map(({ spec: f }) => {
      const parts = [`<sz val="${f.size}"/>`, `<color rgb="${f.color}"/>`, `<name val="${xmlEscape(f.name)}"/>`];
      if (f.bold || f.italic) {
        return `<font>${f.bold ? '<b/>' : ''}${f.italic ? '<i/>' : ''}<sz val="${f.size}"/><color rgb="${f.color}"/><name val="${xmlEscape(f.name)}"/><family val="2"/></font>`;
      }
      return `<font>${parts.join('')}<scheme val="minor"/></font>`;
    }).join('');
  }

  function fillsXml() {
    return fills.map((f, i) => {
      if (i === 0) return '<fill><patternFill patternType="none"/></fill>';
      if (i === 1) return '<fill><patternFill patternType="gray125"/></fill>';
      return `<fill><patternFill patternType="solid"><fgColor rgb="${f.argb}"/><bgColor indexed="64"/></patternFill></fill>`;
    }).join('');
  }

  function bordersXml() {
    return borders.map((b) => {
      return `<border><left${b.key === 'box' ? ` style="thin"` : ''}>${b.key === 'box' ? `<color rgb="${COLORS.line}"/>` : ''}</left><right${b.key === 'box' ? ' style="thin"' : ''}>${b.key === 'box' ? `<color rgb="${COLORS.line}"/>` : ''}</right><top${b.key === 'top' || b.key === 'box' ? ' style="thin"' : ''}>${b.key === 'top' || b.key === 'box' ? `<color rgb="${COLORS.line}"/>` : ''}</top><bottom${b.key === 'bottom' || b.key === 'box' ? ' style="thin"' : ''}>${b.key === 'bottom' || b.key === 'box' ? `<color rgb="${COLORS.line}"/>` : ''}</bottom><diagonal/></border>`;
    }).join('');
  }

  function xfsXml() {
    return xfs.map(({ spec: x }) => {
      const attrs = [
        `numFmtId="${x.numFmt}"`,
        `fontId="${x.f}"`,
        `fillId="${x.fill}"`,
        `borderId="${x.border}"`,
        'xfId="0"',
      ];
      if (x.numFmt) attrs.push('applyNumberFormat="1"');
      if (x.fill) attrs.push('applyFill="1"');
      if (x.border) attrs.push('applyBorder="1"');
      if (x.align || x.wrap) attrs.push('applyAlignment="1"');
      const align = x.align || x.wrap
        ? `<alignment${x.align ? ` horizontal="${x.align}"` : ''}${x.valign ? ` vertical="${x.valign}"` : ''}${x.wrap ? ' wrapText="1"' : ''}/>`
        : '';
      return `<xf ${attrs.join(' ')}>${align}</xf>`;
    }).join('');
  }

  function xml() {
    const numFmtsXml = numFmts.length
      ? `<numFmts count="${numFmts.length}">${numFmts.map((n) => `<numFmt numFmtId="${n.id}" formatCode="${xmlEscape(n.code)}"/>`).join('')}</numFmts>`
      : '';
    return `${XML_DECL}
<styleSheet xmlns="${SHEET_MAIN_NS}">${numFmtsXml}<fonts count="${fonts.length}">${fontsXml()}</fonts><fills count="${fills.length}">${fillsXml()}</fills><borders count="${borders.length}">${bordersXml()}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfsXml()}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
  }

  return { style, xml };
}

// -------------------------------------------------------------------- sheets

/** 'RGB' or 'AARRGGBB' -> 'AARRGGBB'. */
function argb(color) {
  const hex = String(color === null || color === undefined ? '' : color).replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (hex.length === 8) return hex;
  if (hex.length === 6) return `FF${hex}`;
  return COLORS.ink;
}

function isNumericType(type) {
  return type === 'int' || type === 'number' || type === 'percent' || type === 'date' || type === 'datetime';
}

/** Sensible display format per column type when the sheet does not set one. */
function defaultNumFmt(type) {
  if (type === 'date') return 'yyyy-mm-dd';
  if (type === 'datetime') return 'yyyy-mm-dd hh:mm';
  if (type === 'int') return '#,##0';
  return null;
}

/** Coerce a raw cell value according to the column's declared type. */
function cellValue(value, type) {
  if (value === null || value === undefined || value === '') return { type: 'blank' };
  if (type === 'date' || type === 'datetime') {
    const serial = type === 'datetime' ? dateTimeToSerial(value) : dateToSerial(value);
    if (serial === null) return { type: 'inlineStr', value: toIsoDate(value) };
    return { type: 'number', value: serial };
  }
  if (isNumericType(type)) {
    const n = toNumber(value);
    if (n === null) return { type: 'inlineStr', value: String(value) };
    return { type: 'number', value: type === 'int' ? Math.round(n) : n };
  }
  return { type: 'inlineStr', value: String(value) };
}

function cellXml(cell, rowNumber) {
  const ref = cellRef(cell.col, rowNumber);
  const s = ` s="${cell.style || 0}"`;
  if (cell.type === 'number') return `<c r="${ref}"${s}><v>${cell.value}</v></c>`;
  if (cell.type === 'inlineStr') return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cell.value)}</t></is></c>`;
  return `<c r="${ref}"${s}/>`;
}

function rowXml(rowNumber, row) {
  const attrs = row.height ? ` ht="${row.height}" customHeight="1"` : '';
  return `<row r="${rowNumber}"${attrs}>${row.cells.map((c) => cellXml(c, rowNumber)).join('')}</row>`;
}

/**
 * Render one sheet, returning its XML plus the metadata charts need to point
 * their series at the right cells (column letters, data row span, raw values).
 */
function renderSheet(sheet, styles) {
  const columns = sheet.columns || [];
  const grid = [];
  const merges = [];
  let maxCol = Math.max(1, columns.length);

  const bannerRows = [];
  if (sheet.title) {
    bannerRows.push([{ text: sheet.title, span: Math.max(1, columns.length), style: { bold: true, size: 14 } }]);
  }
  if (sheet.banner) bannerRows.push(...sheet.banner);

  for (const bannerRow of bannerRows) {
    const rowNo = grid.length + 1;
    const cells = [];
    let col = 1;
    for (const cell of bannerRow) {
      const span = Math.max(1, cell.span || 1);
      const style = styles.style(cell.style || {});
      for (let i = 0; i < span; i += 1) {
        cells.push({
          col: col + i,
          style,
          type: i === 0 ? 'inlineStr' : 'blank',
          value: i === 0 ? cell.text : undefined,
        });
      }
      if (span > 1) merges.push({ from: cellRef(col, rowNo), to: cellRef(col + span - 1, rowNo) });
      col += span;
    }
    maxCol = Math.max(maxCol, col - 1);
    grid.push({ cells, height: bannerRow.length === 1 ? 22 : null });
  }

  const headerStyle = styles.style({
    bold: true,
    color: COLORS.headerInk,
    fill: COLORS.headerFill,
    align: 'left',
    valign: 'center',
    border: 'box',
  });
  let headerRow = 0;
  if (sheet.header !== false && columns.length) {
    headerRow = grid.length + 1;
    grid.push({
      cells: columns.map((c, i) => ({
        col: i + 1,
        style: headerStyle,
        type: 'inlineStr',
        value: c.label === undefined ? c.key : c.label,
      })),
      height: 20,
    });
  }

  const firstDataRow = grid.length + 1;
  const columnValues = new Map();
  for (const raw of sheet.rows || []) {
    const row = raw && raw.values ? raw : { values: raw || {}, style: null };
    const rowNo = grid.length + 1;
    const banded = sheet.band !== false && !row.style && (rowNo - firstDataRow) % 2 === 1;
    const cells = columns.map((c, i) => {
      const value = cellValue(row.values[c.key], c.type);
      const style = styles.style({
        bold: row.style && row.style.bold,
        border: (row.style && row.style.border) || null,
        fill: (row.style && row.style.fill) || (banded ? COLORS.bandFill : null),
        align: c.align || (isNumericType(c.type) ? 'right' : null),
        numFmt: c.numFmt || defaultNumFmt(c.type),
      });
      // Every data row is cached, including totals, so chart.rowStart indexes
      // line up with the sheet's data rows.
      if (!columnValues.has(c.key)) columnValues.set(c.key, []);
      columnValues.get(c.key).push(row.values[c.key]);
      return { col: i + 1, style, type: value.type, value: value.value };
    });
    grid.push({ cells, height: null });
  }

  const lastDataRow = grid.length;
  const maxRow = Math.max(1, lastDataRow);
  const colsXml = columns.length
    ? `<cols>${columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const autoFilterXml = sheet.autoFilter && headerRow
    ? `<autoFilter ref="A${headerRow}:${colName(maxCol)}${Math.max(headerRow, lastDataRow)}"/>`
    : '';
  const mergesXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m.from}:${m.to}"/>`).join('')}</mergeCells>`
    : '';
  const freezeRows = sheet.freeze === false ? 0 : (sheet.freezeRows != null ? sheet.freezeRows : headerRow);
  const pane = freezeRows > 0
    ? `<pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${freezeRows + 1}" sqref="A${freezeRows + 1}"/>`
    : '';
  const sheetPr = `<sheetPr>${sheet.tabColor ? `<tabColor rgb="${argb(sheet.tabColor)}"/>` : ''}${sheet.landscape ? '<pageSetUpPr fitToPage="1"/>' : ''}</sheetPr>`;
  const pageSetup = sheet.landscape
    ? '<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>'
    : '';
  const drawingXml = sheet.drawingRelId ? `<drawing r:id="${sheet.drawingRelId}"/>` : '';

  const xml = `${XML_DECL}
<worksheet xmlns="${SHEET_MAIN_NS}" xmlns:r="${R_NS}">${sheetPr}<dimension ref="A1:${colName(maxCol)}${maxRow}"/><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${colsXml}<sheetData>${grid.map((row, i) => rowXml(i + 1, row)).join('')}</sheetData>${autoFilterXml}${mergesXml}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>${pageSetup}${drawingXml}</worksheet>`;

  const colIndex = new Map();
  columns.forEach((c, i) => colIndex.set(c.key, i + 1));
  return {
    xml,
    meta: { name: sheet.name, columns, colIndex, headerRow, firstDataRow, lastDataRow, columnValues, maxCol },
  };
}

// -------------------------------------------------------------------- charts

/** Anchor size (in columns/rows) per chart kind. */
const DEFAULT_CHART_SIZE = {
  line: { cols: 9, rows: 15 },
  bar: { cols: 9, rows: 15 },
  pie: { cols: 7, rows: 15 },
};

const AXIS_TEXT_STYLE = '<a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="64748B"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p>';

/**
 * Point a series at one column of the source sheet, with cached values.
 * `dataOffset` is the index of the first plotted data row (chart.rowStart), so a
 * chart can target one table even when the sheet carries several.
 */
function seriesRef(meta, key, startRow, count, dataOffset) {
  const col = meta.colIndex.get(key);
  if (!col) return null;
  const values = (meta.columnValues.get(key) || []).slice(dataOffset, dataOffset + count);
  const letter = colName(col);
  const endRow = startRow + count - 1;
  return { formula: `${sheetRef(meta.name)}!$${letter}$${startRow}:$${letter}$${endRow}`, values };
}

function strCacheXml(values) {
  const points = values
    .map((v, i) => (v === null || v === undefined || v === '' ? '' : `<c:pt idx="${i}"><c:v>${xmlEscape(toIsoDate(v))}</c:v></c:pt>`))
    .join('');
  return `<c:strCache><c:ptCount val="${values.length}"/>${points}</c:strCache>`;
}

function numCacheXml(values) {
  const points = values
    .map((v, i) => {
      const n = toNumber(v);
      return n === null ? '' : `<c:pt idx="${i}"><c:v>${n}</c:v></c:pt>`;
    })
    .join('');
  return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${points}</c:numCache>`;
}

/** One <c:ser>. Element order follows the chart schema, which Excel enforces. */
function serXml(chart, ser, idx) {
  const color = ser.color || CHART_COLORS[idx % CHART_COLORS.length];
  const line = chart.kind === 'line';
  const fill = `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  const ln = line
    ? `<a:ln w="28575" cap="rnd">${fill}<a:round/></a:ln>`
    : `<a:ln w="19050">${fill}</a:ln>`;
  const marker = line
    ? `<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr>${fill}<a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker>`
    : '';
  const pointColors = chart.kind === 'pie' && chart.pointColors ? chart.pointColors : null;
  const dPt = pointColors
    ? pointColors.map((c, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></c:spPr></c:dPt>`).join('')
    : '';
  return `<c:ser><c:idx val="${idx}"/><c:order val="${idx}"/><c:tx><c:v>${xmlEscape(ser.name || `Series ${idx + 1}`)}</c:v></c:tx><c:spPr>${fill}${ln}</c:spPr>${marker}${dPt}<c:cat><c:strRef><c:f>${ser.categories.formula}</c:f>${strCacheXml(ser.categories.values)}</c:strRef></c:cat><c:val><c:numRef><c:f>${ser.values.formula}</c:f>${numCacheXml(ser.values.values)}</c:numRef></c:val></c:ser>`;
}

// ------------------------------------------------------------------ workbook

function sanitizeSheetName(name, used) {
  let base = String(name === null || name === undefined ? 'Sheet' : name)
    .replace(/[\[\]:*?/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31) || 'Sheet';
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    n += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function contentTypesXml(names) {
  const overrides = [
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
  ];
  names.sheets.forEach((s, i) => {
    overrides.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
  });
  names.drawings.forEach((d) => {
    overrides.push(`<Override PartName="/xl/drawings/drawing${d}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
  });
  names.charts.forEach((c) => {
    overrides.push(`<Override PartName="/xl/charts/chart${c}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
  });
  return `${XML_DECL}
<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join('')}</Types>`;
}

function packageRelsXml() {
  const coreRel = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
  return `${XML_DECL}
<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="${coreRel}" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${R_NS}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function workbookXml(sheetNames) {
  const sheets = sheetNames.map((name, i) => `<sheet name="${xmlEscape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  return `${XML_DECL}
<workbook xmlns="${SHEET_MAIN_NS}" xmlns:r="${R_NS}"><fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="26430"/><workbookPr/><bookViews><workbookView xWindow="0" yWindow="120" windowWidth="28800" windowHeight="18000" activeTab="0"/></bookViews><sheets>${sheets}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
}

function workbookRelsXml(sheetCount) {
  const rels = [];
  for (let i = 1; i <= sheetCount; i += 1) {
    rels.push(`<Relationship Id="rId${i}" Type="${R_NS}/worksheet" Target="worksheets/sheet${i}.xml"/>`);
  }
  rels.push(`<Relationship Id="rId${sheetCount + 1}" Type="${R_NS}/styles" Target="styles.xml"/>`);
  return `${XML_DECL}
<Relationships xmlns="${PKG_REL_NS}">${rels.join('')}</Relationships>`;
}

function sheetRelsXml(drawingNumber) {
  return `${XML_DECL}
<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${R_NS}/drawing" Target="../drawings/drawing${drawingNumber}.xml"/></Relationships>`;
}

function drawingRelsXml(chartNumbers) {
  const rels = chartNumbers.map((n, i) => `<Relationship Id="rId${i + 1}" Type="${R_NS}/chart" Target="../charts/chart${n}.xml"/>`).join('');
  return `${XML_DECL}
<Relationships xmlns="${PKG_REL_NS}">${rels}</Relationships>`;
}

function coreXml(properties) {
  const stamp = (properties.created instanceof Date ? properties.created : new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `${XML_DECL}
<cp:coreProperties xmlns:cp="${CORE_NS}" xmlns:dc="${DC_NS}" xmlns:dcterms="${DCTERMS_NS}" xmlns:dcmitype="${DCMITYPE_NS}" xmlns:xsi="${XSI_NS}"><dc:title>${xmlEscape(properties.title || 'Report')}</dc:title><dc:subject>${xmlEscape(properties.subject || '')}</dc:subject><dc:creator>${xmlEscape(properties.creator || 'Church Attendance Tracker')}</dc:creator><cp:lastModifiedBy>${xmlEscape(properties.creator || 'Church Attendance Tracker')}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified></cp:coreProperties>`;
}

function appXml(sheetNames) {
  const titles = sheetNames.map((n) => `<vt:lpstr>${xmlEscape(n)}</vt:lpstr>`).join('');
  return `${XML_DECL}
<Properties xmlns="${APP_NS}" xmlns:vt="${VT_NS}"><Application>Church Attendance Tracker</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${sheetNames.length}" baseType="lpstr">${titles}</vt:vector></TitlesOfParts><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion></Properties>`;
}

// -------------------------------------------------------------------- charts

function axisTextXml() {
  return `<c:txPr>${AXIS_TEXT_STYLE}</c:txPr>`;
}

function plotAreaXml(chart, seriesList) {
  const catId = 100000001;
  const valId = 100000002;
  const serList = seriesList.join('');

  if (chart.kind === 'pie') {
    return `<c:plotArea><c:layout/><c:pieChart><c:varyColors val="1"/>${serList}<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="${chart.showPercent === false ? 0 : 1}"/><c:showBubbleSize val="0"/></c:dLbls><c:firstSliceAng val="0"/></c:pieChart></c:plotArea>`;
  }

  const plot = chart.kind === 'bar'
    ? `<c:barChart><c:barDir val="${chart.barDir || 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${serList}<c:gapWidth val="80"/><c:overlap val="-20"/><c:axId val="${catId}"/><c:axId val="${valId}"/></c:barChart>`
    : `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${serList}<c:marker val="1"/><c:smooth val="0"/><c:axId val="${catId}"/><c:axId val="${valId}"/></c:lineChart>`;

  const catAx = `<c:catAx><c:axId val="${catId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:ln></c:spPr>${axisTextXml()}<c:crossAx val="${valId}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const gridline = '<c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>';
  const valAx = `<c:valAx><c:axId val="${valId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>${gridline}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${axisTextXml()}<c:crossAx val="${catId}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;

  return `<c:plotArea><c:layout/>${plot}${catAx}${valAx}</c:plotArea>`;
}

/** A complete chart part (chartN.xml) for one chart descriptor. */
function chartPartXml(chart, seriesList) {
  const title = chart.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1200" b="1"/><a:t>${xmlEscape(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>`
    : '';
  const legendPos = chart.kind === 'pie' ? 'r' : 'b';
  const legend = chart.legend === false
    ? ''
    : `<c:legend><c:legendPos val="${chart.legend || legendPos}"/><c:overlay val="0"/></c:legend>`;
  return `${XML_DECL}
<c:chartSpace xmlns:c="${CHART_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}"><c:lang val="en-US"/><c:roundedCorners val="0"/><c:chart>${title}<c:autoTitleDeleted val="0"/>${plotAreaXml(chart, seriesList)}${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr></c:chartSpace>`;
}

function anchorMarker(col, row) {
  return `<xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff>`;
}

/** drawingN.xml: one graphic frame per chart anchored on that sheet. */
function drawingPartXml(anchors) {
  const frames = anchors.map((a, i) => `<xdr:twoCellAnchor><xdr:from>${anchorMarker(a.from.col, a.from.row)}</xdr:from><xdr:to>${anchorMarker(a.to.col, a.to.row)}</xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${CHART_NS}"><c:chart xmlns:c="${CHART_NS}" xmlns:r="${R_NS}" r:id="${a.rId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`).join('');
  return `${XML_DECL}
<xdr:wsDr xmlns:xdr="${DRAWING_NS}" xmlns:a="${A_NS}">${frames}</xdr:wsDr>`;
}

/**
 * Assemble the workbook. Sheets are rendered first, so chart series can be
 * resolved against real cells (and dropped when their range is still empty).
 */
async function createWorkbook({ properties = {}, sheets = [] } = {}) {
  if (!sheets.length) throw new Error('createWorkbook requires at least one sheet');
  const styles = createStyleRegistry();
  const usedNames = new Set();
  const names = sheets.map((s) => sanitizeSheetName(s.name, usedNames));
  const withNames = sheets.map((s, i) => ({ ...s, name: names[i] }));

  // Which sheets need a drawing part? A chart may be anchored on a sheet other
  // than the one holding its data (the Summary dashboard does exactly that).
  const chartPlan = [];
  const drawingSheets = new Set();
  withNames.forEach((sheet, si) => {
    (sheet.charts || []).forEach((chart) => {
      const found = chart.anchorSheet ? withNames.findIndex((s) => s.name === chart.anchorSheet) : si;
      const plan = { chart, sourceIndex: si, anchorIndex: found === -1 ? si : found };
      chartPlan.push(plan);
      drawingSheets.add(plan.anchorIndex);
    });
  });
  const drawingNumber = new Map();
  Array.from(drawingSheets).sort((a, b) => a - b).forEach((si, i) => drawingNumber.set(si, i + 1));

  const rendered = withNames.map((sheet, si) => {
    const prepared = drawingSheets.has(si) ? { ...sheet, drawingRelId: 'rId1' } : sheet;
    const out = renderSheet(prepared, styles);
    return { xml: out.xml, meta: out.meta };
  });

  const chartParts = [];
  const drawingAnchors = new Map(Array.from(drawingSheets).map((si) => [si, []]));
  chartPlan.forEach((plan) => {
    const meta = rendered[plan.sourceIndex].meta;
    const dataOffset = plan.chart.rowStart || 0;
    const first = meta.firstDataRow + dataOffset;
    const available = meta.lastDataRow - first + 1;
    const wanted = plan.chart.rowCount != null ? plan.chart.rowCount : available;
    const count = Math.max(0, Math.min(wanted, available));
    if (count < 1) return; // nothing to plot yet

    const seriesList = [];
    for (const s of plan.chart.series || []) {
      const categories = seriesRef(meta, s.categoriesKey, first, count, dataOffset);
      const values = seriesRef(meta, s.valuesKey, first, count, dataOffset);
      if (!categories || !values) return; // column missing -> skip the whole chart
      if (!values.values.some((v) => toNumber(v) !== null)) return; // nothing numeric yet
      seriesList.push({ ...s, categories, values });
    }
    if (!seriesList.length) return;

    const number = chartParts.length + 1;
    chartParts.push({ number, xml: chartPartXml(plan.chart, seriesList.map((s, i) => serXml(plan.chart, s, i))) });

    const anchorMeta = rendered[plan.anchorIndex].meta;
    const size = DEFAULT_CHART_SIZE[plan.chart.kind] || DEFAULT_CHART_SIZE.bar;
    const anchor = plan.chart.anchor || {};
    const col = anchor.col || 0;
    const row = anchor.row != null ? anchor.row : anchorMeta.lastDataRow + 1;
    const anchors = drawingAnchors.get(plan.anchorIndex);
    anchors.push({
      rId: `rId${anchors.length + 1}`,
      from: { col, row },
      to: { col: col + (anchor.cols || size.cols), row: row + (anchor.rows || size.rows) },
      chartNumber: number,
    });
  });

  const parts = {};
  parts['[Content_Types].xml'] = contentTypesXml({ sheets: names, drawings: Array.from(drawingNumber.values()), charts: chartParts.map((c) => c.number) });
  parts['_rels/.rels'] = packageRelsXml();
  parts['docProps/core.xml'] = coreXml(properties);
  parts['docProps/app.xml'] = appXml(names);
  parts['xl/workbook.xml'] = workbookXml(names);
  parts['xl/_rels/workbook.xml.rels'] = workbookRelsXml(names.length);
  parts['xl/styles.xml'] = styles.xml();
  rendered.forEach((r, i) => {
    parts[`xl/worksheets/sheet${i + 1}.xml`] = r.xml;
  });
  drawingAnchors.forEach((anchors, si) => {
    const dn = drawingNumber.get(si);
    parts[`xl/drawings/drawing${dn}.xml`] = drawingPartXml(anchors);
    parts[`xl/drawings/_rels/drawing${dn}.xml.rels`] = drawingRelsXml(anchors.map((a) => a.chartNumber));
    parts[`xl/worksheets/_rels/sheet${si + 1}.xml.rels`] = sheetRelsXml(dn);
  });
  chartParts.forEach((c) => {
    parts[`xl/charts/chart${c.number}.xml`] = c.xml;
  });

  const zip = new JSZip();
  Object.keys(parts).forEach((path) => zip.file(path, parts[path]));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

module.exports = { createWorkbook, colName, dateToSerial, toIsoDate, sanitizeSheetName };

