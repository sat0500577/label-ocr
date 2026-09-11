const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const JSZip = require('../vendor/jszip.min.js');
const realWorkbook = process.env.NUMBERING_WORKBOOK;
test.use({ serviceWorkers: 'block' });
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

async function fixture({ formula = false } = {}) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="팔찌" sheetId="1" r:id="rId1"/><sheet name="목걸이" sheetId="2" r:id="rId2"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>');
  for (let i = 1; i <= 2; i++) zip.file(`xl/worksheets/sheet${i}.xml`, `<worksheet xmlns="${ns}"><dimension ref="A1:D4"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>넘버링</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>2</v></c><c r="D2"><v>3</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>기존/민트</t></is></c><c r="B3" s="1"/></row><row r="4"><c r="D4" t="inlineStr"><is><t>끝/노랑</t></is>${formula ? '<f>1+1</f>' : ''}</c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:D1"/></mergeCells></worksheet>`);
  return { name: '테스트.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await zip.generateAsync({ type: 'nodebuffer' }) };
}
test.beforeEach(async ({ page }) => {
  await page.route('**/vendor/tesseract.min.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.Tesseract={createWorker:async()=>({setParameters:async()=>{},reinitialize:async()=>{},terminate:async()=>{}})};' }));
  await page.goto('/');
});
async function download(page) {
  const pending = page.waitForEvent('download'); await page.locator('#excelDownload').click();
  const file = await pending; return { file, zip: await JSZip.loadAsync(await fs.readFile(await file.path())) };
}

test('select exact cell, write plain text, undo across sheets, export original again', async ({ page }) => {
  const source = await fixture();
  await page.locator('#excelFile').setInputFiles(source);
  await expect(page.locator('#excelApply')).toBeDisabled();
  await expect(page.locator('#excelGrid button')).toHaveCount(6);
  await page.locator('[data-cell="B3"]').click();
  await expect(page.locator('#excelTarget')).toHaveText('2번 · 1번째 줄 (B3)');
  await expect(page.locator('[data-cell="B3"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#excelText').fill('=제품<&>/민트');
  await expect(page.locator('#result')).toHaveValue('=제품<&>/민트');
  await page.locator('#excelApply').click();
  await expect(page.locator('[data-cell="B3"]')).toHaveText('=제품<&>/민트');
  const saved = await download(page);
  const sheetXml = await saved.zip.file('xl/worksheets/sheet1.xml').async('string');
  expect(sheetXml).toContain('s="1"'); expect(sheetXml).toContain('t="inlineStr"');
  expect(sheetXml).toContain('=제품&lt;&amp;&gt;/민트'); expect(sheetXml).not.toContain('<f>');
  await page.locator('#excelSheet').selectOption('1');
  await expect(page.locator('#excelApply')).toBeDisabled();
  await page.locator('[data-cell="A4"]').click();
  await page.locator('#result').fill('목걸이/핑크');
  await expect(page.locator('#excelText')).toHaveValue('목걸이/핑크');
  await page.locator('#excelApply').click();
  await page.locator('#excelSheet').selectOption('0');
  await page.locator('#excelUndo').click();
  await expect(page.locator('#excelSheet')).toHaveValue('1');
  await expect(page.locator('[data-cell="A4"]')).toHaveText('빈칸');
  await page.locator('#excelUndo').click();
  await expect(page.locator('#excelSheet')).toHaveValue('0');
  await expect(page.locator('[data-cell="B3"]')).toHaveText('빈칸');
  const restored = await download(page), original = await JSZip.loadAsync(source.buffer);
  for (const [name, entry] of Object.entries(original.files)) if (!entry.dir) expect(await restored.zip.file(name).async('string')).toBe(await entry.async('string'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reject invalid/formula files without losing edits, lock write while OCR runs', async ({ page }) => {
  await page.locator('#excelFile').setInputFiles(await fixture());
  await page.locator('[data-cell="A3"]').click();
  await page.evaluate(() => { const r = document.querySelector('#result'); r.value = 'B멜리비/민트'; r.readOnly = true; document.dispatchEvent(new Event('ocr-result-change')); });
  await expect(page.locator('#excelText')).toHaveValue('B멜리비/민트');
  await expect(page.locator('#excelApply')).toBeDisabled();
  await page.evaluate(() => { document.querySelector('#result').readOnly = false; document.dispatchEvent(new Event('ocr-result-change')); });
  await page.locator('#excelApply').click();
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#excelFile').setInputFiles({ name: 'broken.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('broken') });
  await expect(page.locator('#excelStatus')).toContainText('파일을 열 수 없습니다');
  await expect(page.locator('[data-cell="A3"]')).toHaveText('B멜리비/민트');
  await page.locator('#excelFile').setInputFiles(await fixture({ formula: true }));
  await expect(page.locator('#excelStatus')).toContainText('수식이 없는');
  await expect(page.locator('[data-cell="A3"]')).toHaveText('B멜리비/민트');
});

test('real numbering workbook preserves every untouched ZIP part and cell style', async ({ page }, testInfo) => {
  test.skip(!realWorkbook, 'Set NUMBERING_WORKBOOK to test the private user template locally.');
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.locator('#excelFile').setInputFiles(realWorkbook);
  await expect(page.locator('#excelSheet option')).toHaveText(['비즈팔찌+비즈반지', '비즈목걸이']);
  await expect(page.locator('[data-cell="G4"]')).toHaveText('B멜리비/민트');
  await page.locator('[data-cell="A3"]').click();
  await page.locator('#excelText').fill('B멜리비/민트');
  await page.locator('#excelApply').click();
  await page.screenshot({ path: testInfo.outputPath('numbering-mobile.png'), fullPage: true });
  const { file, zip } = await download(page);
  expect(file.suggestedFilename()).toContain('_넘버링.xlsx');
  const original = await JSZip.loadAsync(await fs.readFile(realWorkbook));
  const changed = [];
  for (const [name, entry] of Object.entries(original.files)) if (!entry.dir) {
    if (!(await entry.async('nodebuffer')).equals(await zip.file(name).async('nodebuffer'))) changed.push(name);
  }
  expect(changed).toHaveLength(1); expect(changed[0]).toMatch(/^xl\/worksheets\//);
  const before = await original.file(changed[0]).async('string'), after = await zip.file(changed[0]).async('string');
  const verified = await page.evaluate(({ before, after }) => {
    const parse = s => new DOMParser().parseFromString(s, 'application/xml');
    const a = parse(before), b = parse(after); const ac = a.querySelector('c[r="A3"]'), bc = b.querySelector('c[r="A3"]');
    const result = { styleBefore: ac.getAttribute('s'), styleAfter: bc.getAttribute('s'), text: bc.textContent, errors: b.querySelectorAll('parsererror').length };
    // 직렬화 차이는 제외하고 수정한 셀 외 모든 양식 노드가 같은지 확인한다.
    bc.replaceWith(b.importNode(ac, true)); result.unchanged = a.documentElement.isEqualNode(b.documentElement); return result;
  }, { before, after });
  expect(verified).toEqual({ styleBefore: verified.styleAfter, styleAfter: verified.styleAfter, text: 'B멜리비/민트', errors: 0, unchanged: true });
  await file.saveAs(testInfo.outputPath('numbering-edited.xlsx'));
  // 임시 다운로드 경로에는 확장자가 없으므로 원래 파일명으로 다시 불러온다.
  await page.locator('#excelFile').setInputFiles({ name: file.suggestedFilename(), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await fs.readFile(await file.path()) });
  await expect(page.locator('[data-cell="A3"]')).toHaveText('B멜리비/민트');
  await expect(page.locator('[data-cell="G4"]')).toHaveText('B멜리비/민트');
  expect(errors).toEqual([]);
});
