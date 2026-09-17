'use strict';

const JSZip = require('jszip');
const { createWorkbook, colName, dateToSerial, sanitizeSheetName } = require('../../src/utils/xlsx');

/** Unzip a workbook buffer into a { partPath: xml } map. */
async function parts(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const out = {};
  for (const name of names) {
    out[name] = await zip.file(name).async('string');
  }
  return { out, order: names };
}

function demoSheet(overrides) {
  return {
    name: 'Data',
    columns: [
      { key: 'when', label: 'Date', type: 'date', width: 12 },
      { key: 'name', label: 'Member', type: 'text', width: 24 },
      { key: 'count', label: 'Present', type: 'int', width: 10 },
    ],
    rows: [
      { when: '2024-01-07', name: 'Ada & Sons <th>', count: 12 },
      { when: '2024-01-14', name: 'Grace', count: '7' },
    ],
    ...overrides,
  };
}

describe('xlsx writer', () => {
  test('formats column letters, serial dates and safe sheet names', () => {
    expect(colName(1)).toBe('A');
    expect(colName(26)).toBe('Z');
    expect(colName(27)).toBe('AA');
    expect(colName(702)).toBe('ZZ');
    expect(colName(703)).toBe('AAA');
    expect(dateToSerial('2024-01-07')).toBe(45298);
    expect(dateToSerial('1900-03-01')).toBe(61); // Excel's phantom 1900-02-29
    expect(dateToSerial('nonsense')).toBeNull();

    const used = new Set();
    expect(sanitizeSheetName('By service', used)).toBe('By service');
    expect(sanitizeSheetName('A/B:C*D?E[F]G\\H', used)).toBe('A B C D E F G H');
    expect(sanitizeSheetName('x'.repeat(40), used)).toBe('x'.repeat(31));
    expect(sanitizeSheetName('x'.repeat(40), used)).toBe(`${'x'.repeat(27)} (2)`);
    expect(sanitizeSheetName('By service', used)).toBe('By service (2)');
  });

  test('writes the minimal package parts, with [Content_Types].xml first', async () => {
    const buffer = await createWorkbook({ properties: { title: 'Report' }, sheets: [demoSheet()] });
    expect(buffer.subarray(0, 2).toString('utf8')).toBe('PK');

    const { out, order } = await parts(buffer);
    expect(order[0]).toBe('[Content_Types].xml');
    expect(order).toEqual(expect.arrayContaining([
      '_rels/.rels',
      'docProps/app.xml',
      'docProps/core.xml',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
    ]));
    expect(out['xl/workbook.xml']).toContain('<sheet name="Data" sheetId="1" r:id="rId1"/>');
    expect(out['xl/_rels/workbook.xml.rels']).toContain('relationships/styles" Target="styles.xml"');
    expect(out['[Content_Types].xml']).toContain('/xl/worksheets/sheet1.xml');
    // No theme part, and every colour must therefore be explicit.
    expect(order.some((n) => n.includes('theme'))).toBe(false);
    expect(out['xl/worksheets/sheet1.xml']).not.toContain('theme=');
  });

  test('stores text inline with escaping and numbers as numbers', async () => {
    const { out } = await parts(await createWorkbook({ sheets: [demoSheet()] }));
    const xml = out['xl/worksheets/sheet1.xml'];

    expect(xml).toContain('<is><t xml:space="preserve">Ada &amp; Sons &lt;th&gt;</t></is>');
    expect(xml).toContain('<v>45298</v>'); // 2024-01-07 as an Excel serial date
    expect(xml).toContain('<v>12</v>');
    expect(xml).toContain('<v>7</v>'); // numeric strings are coerced
    expect(xml).not.toContain('sharedStrings');
    expect(out['xl/styles.xml']).toContain('formatCode="yyyy-mm-dd"');
  });

  test('keeps the worksheet children in the order the schema requires', async () => {
    const { out } = await parts(await createWorkbook({
      sheets: [demoSheet({
        title: 'Attendance',
        autoFilter: true,
        landscape: true,
        charts: [{ kind: 'bar', title: 'Present', series: [{ name: 'Present', categoriesKey: 'name', valuesKey: 'count' }] }],
      })],
    }));
    const xml = out['xl/worksheets/sheet1.xml'];
    const order = ['<sheetPr', '<dimension', '<sheetViews', '<sheetFormatPr', '<cols', '<sheetData', '<autoFilter', '<mergeCells', '<pageMargins', '<pageSetup', '<drawing'];
    const found = order.map((tag) => xml.indexOf(tag));
    expect(found.every((i) => i >= 0)).toBe(true);
    expect(found).toEqual([...found].sort((a, b) => a - b));
    expect(xml).toContain('<mergeCell ref="A1:C1"/>');
    expect(xml).toContain('<drawing r:id="rId1"/>');
    expect(xml).toContain('<pane ySplit="2" topLeftCell="A3"');
  });

  test('emits native charts with cached series, a drawing and matching rels', async () => {
    const { out } = await parts(await createWorkbook({
      sheets: [
        demoSheet({
          charts: [
            { kind: 'line', title: 'Present over time', series: [{ name: 'Present', color: '16A34A', categoriesKey: 'when', valuesKey: 'count' }] },
            { kind: 'pie', title: 'Split', series: [{ name: 'Split', categoriesKey: 'name', valuesKey: 'count' }] },
          ],
        }),
        {
          name: 'Summary',
          columns: [{ key: 'label', label: 'Group', type: 'text' }, { key: 'total', label: 'Total', type: 'int' }],
          rows: [],
        },
      ],
    }));

    const chart = out['xl/charts/chart1.xml'];
    expect(chart).toContain('<c:lineChart>');
    expect(out['xl/charts/chart2.xml']).toContain('<c:pieChart>');
    expect(chart).toContain("<c:f>'Data'!$A$2:$A$3</c:f>");
    expect(chart).toContain("<c:f>'Data'!$C$2:$C$3</c:f>");
    expect(chart).toContain('<c:pt idx="0"><c:v>2024-01-07</c:v></c:pt>');
    expect(chart).toContain('<c:pt idx="1"><c:v>7</c:v></c:pt>');
    expect(chart).toContain('<a:srgbClr val="16A34A"/>');

    const drawing = out['xl/drawings/drawing1.xml'];
    expect(drawing).toContain('r:id="rId1"');
    expect(drawing).toContain('r:id="rId2"');
    expect(out['xl/drawings/_rels/drawing1.xml.rels']).toContain('Target="../charts/chart2.xml"');
    expect(out['xl/worksheets/_rels/sheet1.xml.rels']).toContain('Target="../drawings/drawing1.xml"');
    expect(out['[Content_Types].xml']).toContain('/xl/charts/chart2.xml');
    // A chart-free sheet must not gain a drawing or a stray relationship.
    expect(out['xl/worksheets/_rels/sheet2.xml.rels']).toBeUndefined();
  });

  test('skips a chart with no data yet but keeps its drawing part valid', async () => {
    const { out } = await parts(await createWorkbook({
      sheets: [demoSheet({
        rows: [],
        charts: [{ kind: 'bar', title: 'Empty', series: [{ name: 'Present', categoriesKey: 'name', valuesKey: 'count' }] }],
      })],
    }));
    expect(out['xl/charts/chart1.xml']).toBeUndefined();
    expect(out['xl/drawings/drawing1.xml']).toContain('<xdr:wsDr');
    expect(out['xl/drawings/_rels/drawing1.xml.rels']).toBeDefined();
    expect(out['xl/worksheets/sheet1.xml']).toContain('<drawing r:id="rId1"/>');
  });

  test('anchors a chart on another sheet for a dashboard layout', async () => {
    const { out } = await parts(await createWorkbook({
      sheets: [
        demoSheet({
          charts: [{
            kind: 'bar',
            title: 'Present per service',
            anchorSheet: 'Summary',
            anchor: { col: 3, row: 20, cols: 10, rows: 15 },
            series: [{ name: 'Present', categoriesKey: 'when', valuesKey: 'count' }],
          }],
        }),
        { name: 'Summary', columns: [{ key: 'k', label: 'Metric', type: 'text' }], rows: [{ k: 'Present' }] },
      ],
    }));
    expect(out['xl/drawings/_rels/drawing1.xml.rels']).toContain('Target="../charts/chart1.xml"');
    expect(out['xl/worksheets/_rels/sheet2.xml.rels']).toContain('Target="../drawings/drawing1.xml"');
    expect(out['xl/worksheets/_rels/sheet1.xml.rels']).toBeUndefined();
    const drawing = out['xl/drawings/drawing1.xml'];
    expect(drawing).toContain('<xdr:col>3</xdr:col>');
    expect(drawing).toContain('<xdr:row>20</xdr:row>');
    expect(drawing).toContain('<xdr:row>35</xdr:row>');
  });
});