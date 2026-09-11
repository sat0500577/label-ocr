/* 넘버링 양식 편집기. OCR 엔진은 #result를 바꾸고 input 또는
   ocr-result-change를 보내면 된다. 엑셀은 브라우저 안에서 처리한다. */
(() => {
  'use strict';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const $ = id => document.getElementById(id);
  const ui = Object.fromEntries(['Open', 'File', 'Workspace', 'Filename', 'Sheet', 'Grid', 'Target', 'Previous', 'Text', 'Camera', 'Apply', 'Undo', 'Download', 'Changes', 'Status'].map(key => [key, $('excel' + key)]));
  let book = null, sheet = null, selected = null, history = [], revision = 0, downloadedRevision = 0, loading = false;
  let lastOcrText = $('result').value;
  const elements = (node, name) => Array.from(node.getElementsByTagNameNS(NS, name));
  const direct = (node, name) => Array.from(node.children).find(child => child.localName === name);
  const colNumber = name => [...name].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const column = n => { let value = ''; for (; n; n = Math.floor((n - 1) / 26)) value = String.fromCharCode(65 + (n - 1) % 26) + value; return value; };
  const coords = ref => { const m = /^([A-Z]+)([1-9]\d*)$/.exec(ref || ''); if (!m) throw new Error('지원하지 않는 셀 주소입니다.'); return { col: colNumber(m[1]), row: Number(m[2]) }; };
  const status = (message, error = false) => { ui.Status.textContent = message; ui.Status.className = 'status ' + (error ? 'err' : 'ok'); };
  function xml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length || /<!DOCTYPE/i.test(text)) throw new Error('엑셀 내부 형식을 읽을 수 없습니다.');
    return doc;
  }
  async function readXml(zip, path, optional = false) {
    const entry = zip.file(path);
    if (!entry) { if (optional) return null; throw new Error('엑셀 시트 정보를 찾을 수 없습니다.'); }
    const text = await entry.async('string');
    if (text.length > 8 * 1024 * 1024) throw new Error('시트가 너무 큽니다. 넘버링 시트만 별도 파일로 저장해 주세요.');
    return xml(text);
  }
  function resolvePart(base, target) {
    const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
    for (const part of target.split('/')) {
      if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/');
  }
  function textOf(cell, strings) {
    const value = direct(cell, 'v')?.textContent || '';
    if (cell.getAttribute('t') === 's') return strings[Number(value)] || '';
    if (cell.getAttribute('t') === 'inlineStr') return elements(cell, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join('');
    return value;
  }
  async function loadWorkbook(file) {
    if (!/\.xlsx$/i.test(file.name)) throw new Error('.xlsx 형식의 엑셀 파일을 선택해 주세요.');
    if (file.size > 5 * 1024 * 1024) throw new Error('5MB 이하의 넘버링 파일을 선택해 주세요.');
    const source = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(source);
    const workbook = await readXml(zip, 'xl/workbook.xml');
    const relationships = await readXml(zip, 'xl/_rels/workbook.xml.rels');
    const rels = new Map(Array.from(relationships.documentElement.children).filter(r => r.getAttribute('TargetMode') !== 'External').map(r => [r.getAttribute('Id'), resolvePart('xl/workbook.xml', r.getAttribute('Target'))]));
    const shared = await readXml(zip, 'xl/sharedStrings.xml', true);
    const strings = shared ? elements(shared, 'si').map(si => elements(si, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join('')) : [];
    const sheets = [];
    for (const info of elements(workbook, 'sheet')) {
      const path = rels.get(info.getAttributeNS(REL, 'id'));
      if (!path || !path.includes('worksheets/')) continue;
      const doc = await readXml(zip, path);
      // 라벨 양식은 값만 편집한다. 수식이 있는 파일에는 별도 계산 엔진이 필요하다.
      if (elements(doc, 'f').length) throw new Error('현재는 수식이 없는 넘버링 파일을 지원합니다. 수식이 있는 파일은 값만 복사한 별도 파일을 사용해 주세요.');
      if (info.getAttribute('state') && info.getAttribute('state') !== 'visible') continue;
      if (elements(doc, 'sheetProtection').length) continue;
      const cells = new Map(); let maxRow = 0, maxCol = 0;
      for (const cell of elements(doc, 'c')) {
        const ref = cell.getAttribute('r'); const position = coords(ref); const value = textOf(cell, strings);
        cells.set(ref, { value, element: cell });
        if (value) { maxRow = Math.max(maxRow, position.row); maxCol = Math.max(maxCol, position.col); }
      }
      if (maxRow > 200 || maxCol > 100) throw new Error('현재는 200행·100열 이내의 넘버링 표를 지원합니다.');
      let headerRow = 0;
      for (let r = 1; r <= Math.min(maxRow, 10); r++) {
        const values = Array.from({ length: maxCol }, (_, c) => cells.get(column(c + 1) + r)?.value || '').filter(Boolean);
        if (values.length >= 2 && values.every((v, i) => v === String(i + 1))) { headerRow = r; break; }
      }
      if (!headerRow || maxRow <= headerRow) continue;
      const merges = elements(doc, 'mergeCell').map(m => m.getAttribute('ref').split(':').map(coords));
      const hiddenRows = new Set(elements(doc, 'row').filter(r => r.getAttribute('hidden') === '1').map(r => Number(r.getAttribute('r'))));
      const hiddenCols = elements(doc, 'col').filter(c => c.getAttribute('hidden') === '1').map(c => [Number(c.getAttribute('min')), Number(c.getAttribute('max'))]);
      sheets.push({ name: info.getAttribute('name'), path, doc, cells, headerRow, maxRow, maxCol, merges, hiddenRows, hiddenCols, edits: new Map() });
    }
    if (!sheets.length) throw new Error('1, 2, 3… 번호가 나란히 있는 넘버링 시트를 찾지 못했습니다.');
    return { name: file.name, source, sheets };
  }
  const currentValue = (s, ref) => s.edits.has(ref) ? s.edits.get(ref) : s.cells.get(ref)?.value || '';
  function targetName(s, ref) { const p = coords(ref); return `${s.cells.get(column(p.col) + s.headerRow).value}번 · ${p.row - s.headerRow}번째 줄 (${ref})`; }
  function editable(s, c, r) {
    if (!s.cells.get(column(c) + s.headerRow)?.value) return false;
    // 병합 영역은 표시만 하여 여러 버튼이 같은 셀에 쓰지 않도록 한다.
    return !s.merges.some(([a, b = a]) => c >= a.col && c <= b.col && r >= a.row && r <= b.row);
  }
  function controls() {
    const busy = loading || $('result').readOnly;
    ui.Apply.disabled = !selected || !ui.Text.value.trim() || busy;
    ui.Camera.disabled = !selected || loading || $('cameraButton').disabled;
    ui.Text.readOnly = busy;
    ui.Undo.disabled = !history.length || loading;
    ui.Download.disabled = !book || loading;
    ui.Open.disabled = loading;
    ui.Sheet.disabled = loading;
    if (book) ui.Changes.textContent = `변경한 칸 ${book.sheets.reduce((n, s) => n + s.edits.size, 0)}개`;
  }
  function selectCell(ref, focus = false) {
    selected = ref;
    for (const button of ui.Grid.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.cell === ref));
    ui.Target.textContent = targetName(sheet, ref);
    ui.Previous.textContent = `현재 내용: ${currentValue(sheet, ref) || '빈칸'}`;
    ui.Apply.textContent = `${sheet.cells.get(column(coords(ref).col) + sheet.headerRow).value}번 칸에 넣기`;
    if (focus) ui.Grid.querySelector(`[data-cell="${ref}"]`)?.focus({ preventScroll: true });
    controls();
  }
  function renderGrid() {
    ui.Grid.replaceChildren(); selected = null;
    ui.Target.textContent = '입력할 칸을 선택하세요'; ui.Previous.textContent = ''; ui.Apply.textContent = '선택한 칸에 넣기';
    const table = document.createElement('table'); table.setAttribute('aria-label', sheet.name);
    const head = table.createTHead().insertRow(); const corner = document.createElement('th'); corner.className = 'row-number'; corner.textContent = '줄'; head.append(corner);
    const cols = Array.from({ length: sheet.maxCol }, (_, i) => i + 1).filter(c => !sheet.hiddenCols.some(([a, b]) => c >= a && c <= b));
    for (const c of cols) { const th = document.createElement('th'); const value = sheet.cells.get(column(c) + sheet.headerRow)?.value; th.scope = 'col'; th.textContent = value ? value + '번' : ''; if (!value) th.className = 'spacer'; head.append(th); }
    const body = table.createTBody();
    for (let r = sheet.headerRow + 1; r <= sheet.maxRow; r++) {
      if (sheet.hiddenRows.has(r)) continue;
      const row = body.insertRow(); const label = document.createElement('th'); label.scope = 'row'; label.className = 'row-number'; label.textContent = `${r - sheet.headerRow}줄`; row.append(label);
      for (const c of cols) {
        const td = row.insertCell(); const ref = column(c) + r;
        if (!editable(sheet, c, r)) { td.className = 'spacer'; td.textContent = currentValue(sheet, ref); continue; }
        const button = document.createElement('button'); button.type = 'button'; button.className = 'numbering-cell'; button.dataset.cell = ref;
        button.textContent = currentValue(sheet, ref) || '빈칸'; button.setAttribute('aria-label', `${targetName(sheet, ref)}: ${button.textContent}`); button.setAttribute('aria-pressed', 'false');
        button.classList.toggle('changed', sheet.edits.has(ref));
        button.addEventListener('click', () => selectCell(ref)); td.append(button);
      }
    }
    ui.Grid.append(table); ui.Grid.scrollTop = 0; ui.Grid.scrollLeft = 0; controls();
  }
  function refreshCell(ref) {
    const button = ui.Grid.querySelector(`[data-cell="${ref}"]`);
    if (button) { button.textContent = currentValue(sheet, ref) || '빈칸'; button.setAttribute('aria-label', `${targetName(sheet, ref)}: ${button.textContent}`); button.classList.toggle('changed', sheet.edits.has(ref)); }
    selectCell(ref);
  }
  function setValue(s, ref, value) { if (value === (s.cells.get(ref)?.value || '')) s.edits.delete(ref); else s.edits.set(ref, value); }
  function exportSheet(s) {
    const doc = s.doc.cloneNode(true); const data = elements(doc, 'sheetData')[0];
    for (const [ref, value] of s.edits) {
      const p = coords(ref); let row = elements(data, 'row').find(r => Number(r.getAttribute('r')) === p.row);
      if (!row) { row = doc.createElementNS(NS, 'row'); row.setAttribute('r', p.row); data.insertBefore(row, Array.from(data.children).find(r => Number(r.getAttribute('r')) > p.row) || null); }
      let cell = Array.from(row.children).find(c => c.getAttribute('r') === ref);
      if (!cell) { cell = doc.createElementNS(NS, 'c'); cell.setAttribute('r', ref); row.insertBefore(cell, Array.from(row.children).find(c => coords(c.getAttribute('r')).col > p.col) || null); }
      for (const child of Array.from(cell.children)) if (['v', 'is', 'f'].includes(child.localName)) child.remove();
      cell.setAttribute('t', 'inlineStr');
      const inline = doc.createElementNS(NS, 'is'), text = doc.createElementNS(NS, 't');
      text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); text.textContent = value; inline.append(text); cell.insertBefore(inline, cell.firstChild);
    }
    return new XMLSerializer().serializeToString(doc);
  }
  ui.Open.addEventListener('click', () => ui.File.click());
  ui.File.addEventListener('change', async () => {
    const file = ui.File.files[0]; ui.File.value = ''; if (!file || loading) return;
    if (revision !== downloadedRevision && !confirm('아직 다운로드하지 않은 변경 내용이 있습니다. 다른 파일을 여시겠어요?')) return;
    loading = true; controls(); status('엑셀을 불러오는 중입니다.');
    try {
      const next = await loadWorkbook(file); book = next; sheet = book.sheets[0]; history = []; revision = downloadedRevision = 0;
      ui.Filename.textContent = file.name; ui.Sheet.replaceChildren();
      book.sheets.forEach((s, i) => { const option = document.createElement('option'); option.value = i; option.textContent = s.name; ui.Sheet.append(option); });
      ui.Workspace.hidden = false; $('excelIntro').hidden = true; renderGrid(); status('넣을 칸을 선택한 뒤 사진을 찍어 주세요.');
    } catch (error) { status(error.message.startsWith('현재') || /엑셀|시트|파일|넘버링|지원/.test(error.message) ? error.message : '파일을 열 수 없습니다. 암호가 없는 .xlsx 파일인지 확인해 주세요.', true); }
    finally { loading = false; controls(); }
  });
  ui.Sheet.addEventListener('change', () => { sheet = book.sheets[Number(ui.Sheet.value)]; renderGrid(); status('이 시트에서 입력할 칸을 선택하세요.'); });
  ui.Text.addEventListener('input', () => {
    $('result').value = ui.Text.value; $('result').dispatchEvent(new Event('input', { bubbles: true })); controls();
  });
  function syncResult() { const text = $('result').value; if (text !== lastOcrText) { ui.Text.value = text; lastOcrText = text; } controls(); }
  document.addEventListener('ocr-result-change', syncResult); $('result').addEventListener('input', syncResult);
  ui.Camera.addEventListener('click', () => $('cameraButton').click());
  ui.Apply.addEventListener('click', () => {
    if (!selected || ui.Apply.disabled) return;
    const value = ui.Text.value.trim();
    if (value.length > 32767 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) { status('엑셀에 넣을 수 없는 문자 또는 너무 긴 텍스트입니다.', true); return; }
    const before = currentValue(sheet, selected);
    if (before === value) { status('선택한 칸에 같은 내용이 들어 있습니다.'); return; }
    history.push({ sheet, ref: selected, before }); setValue(sheet, selected, value); revision++;
    refreshCell(selected); status(`${targetName(sheet, selected)}에 ${value} 입력 완료. 다음에 넣을 칸을 눌러 주세요.`); controls();
  });
  ui.Undo.addEventListener('click', () => {
    const edit = history.pop(); if (!edit) return;
    setValue(edit.sheet, edit.ref, edit.before); revision++;
    if (sheet !== edit.sheet) { sheet = edit.sheet; ui.Sheet.value = book.sheets.indexOf(sheet); renderGrid(); }
    refreshCell(edit.ref); ui.Grid.querySelector(`[data-cell="${edit.ref}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    status(`${targetName(sheet, edit.ref)} 입력을 되돌렸습니다.`); controls();
  });
  ui.Download.addEventListener('click', async () => {
    if (!book || loading) return;
    loading = true; controls(); status('엑셀 파일을 만드는 중입니다.');
    try {
      // JSZip 복제본은 항목을 공유하므로, 되돌리기를 보장하려면 원본 바이트를 다시 연다.
      const zip = await JSZip.loadAsync(book.source);
      for (const s of book.sheets) if (s.edits.size) zip.file(s.path, exportSheet(s));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = book.name.replace(/\.xlsx$/i, '') + '_넘버링.xlsx'; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000); downloadedRevision = revision; status('다운로드를 요청했습니다. 기기의 다운로드 파일을 확인해 주세요.');
    } catch { status('엑셀을 저장하지 못했습니다. 다시 다운로드해 주세요. 작업 내용은 유지됩니다.', true); }
    finally { loading = false; controls(); }
  });
  window.addEventListener('beforeunload', event => { if (revision !== downloadedRevision) { event.preventDefault(); event.returnValue = ''; } });
})();
