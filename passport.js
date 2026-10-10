import * as pdfjsLib from './vendor/pdf.min.mjs';
import { parseText, parseTD3, dmy } from './mrz.js';
pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = (m, err) => { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = m; $('#toasts').append(t); setTimeout(() => t.remove(), err ? 6000 : 3000); };
const busy = (t, p) => { $('#busy').hidden = t === null; if (t !== null) { $('#busytext').textContent = t; $('#busybar').style.width = (p ?? 0) * 100 + '%'; } };

const COLS = [
  ['file', 'File'], ['surname', 'Surname'], ['given', 'Given names'], ['passportNo', 'Passport No.'],
  ['nationality', 'Nationality'], ['dob', 'Date of birth'], ['sex', 'Sex'], ['expiry', 'Date of expiry'],
  ['issuer', 'Issuing country'], ['personalNo', 'CPR / Personal No.'],
];
const DATE = new Set(['dob', 'expiry']);
const rows = []; // {file, thumb, rec, error}

/* ---------- OCR ---------- */
let worker;
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load OCR engine (offline?)')); document.head.append(s); });
async function getWorker() {
  if (worker) return worker;
  await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
  worker = await Tesseract.createWorker('eng', 1, { logger: m => { if (m.status !== 'recognizing text') busy('Loading OCR engine…', m.progress || 0); } });
  await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<', tessedit_pageseg_mode: '6', preserve_interword_spaces: '0' });
  return worker;
}
function crop(src, y0, targetW) {
  const sy = Math.floor(src.height * y0), sh = src.height - sy, k = targetW / src.width;
  const c = document.createElement('canvas'); c.width = targetW; c.height = Math.round(sh * k);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.filter = 'grayscale(1) contrast(1.4)'; x.drawImage(src, 0, sy, src.width, sh, 0, 0, c.width, c.height);
  return c;
}
async function readMrz(canvas) {
  const w = await getWorker();
  // MRZ is at the bottom of the photo page; try tight crops first, then the whole image.
  for (const y0 of [0.72, 0.55, 0.3, 0]) {
    const { data } = await w.recognize(crop(canvas, y0, 1800));
    const rec = parseText(data.text);
    if (rec && (rec.valid || rec.issuer === 'BHR' || rec.nationality === 'BHR')) return rec;
  }
  return null;
}

/* ---------- input ---------- */
async function imageToCanvas(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  const c = document.createElement('canvas'); const k = Math.min(1, 3000 / bmp.width);
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}
async function* pagesOf(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 2400 / pg.getViewport({ scale: 1 }).width });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      yield [doc.numPages > 1 ? `${file.name} (p${i})` : file.name, c];
    }
  } else yield [file.name, await imageToCanvas(file)];
}
async function addFiles(files) {
  files = [...files];
  try {
    let n = 0;
    for (const f of files) {
      n++;
      try {
        for await (const [name, canvas] of pagesOf(f)) {
          busy(`Reading ${name} (${n}/${files.length})…`, (n - 1) / files.length);
          const th = document.createElement('canvas'); th.width = 120; th.height = Math.round(120 * canvas.height / canvas.width);
          th.getContext('2d').drawImage(canvas, 0, 0, th.width, th.height);
          const rec = await readMrz(canvas);
          rows.push({ file: name, thumb: th.toDataURL('image/jpeg', .6), rec, error: rec ? '' : 'No MRZ found' });
          render();
        }
      } catch (e) { console.error(e); rows.push({ file: f.name, rec: null, error: String(e.message || e) }); render(); }
    }
  } catch (e) { console.error(e); toast(String(e.message || e), true); }
  finally { busy(null); }
  const bad = rows.filter(r => !r.rec || !r.rec.valid).length;
  if (bad) toast(`${bad} row(s) need checking (⚠).`, true);
}

/* ---------- sheet ---------- */
const val = (r, k) => k === 'file' ? r.file : !r.rec ? '' : DATE.has(k) ? dmy(r.rec[k]) : r.rec[k] ?? '';
function statusOf(r) {
  if (!r.rec) return ['⚠', 'bad', r.error || 'Not read'];
  const fails = Object.entries(r.rec.checks).filter(([, v]) => !v).map(([k]) => k);
  return r.rec.valid ? ['✔', 'good', 'All check digits OK'] : ['⚠', 'bad', 'Check digit failed: ' + fails.join(', ') + ' – fix the MRZ text or fields'];
}
function render() {
  const tbl = $('#sheet'); tbl.hidden = !rows.length; $('#bar').hidden = !rows.length;
  tbl.tHead.innerHTML = '<tr><th>#</th><th>Scan</th>' + COLS.map(c => `<th>${c[1]}</th>`).join('') + '<th>Status</th><th>MRZ line 1</th><th>MRZ line 2</th><th></th></tr>';
  tbl.tBodies[0].innerHTML = rows.map((r, i) => {
    const [ic, cls, tip] = statusOf(r);
    return `<tr class="${cls}" data-i="${i}"><td>${i + 1}</td><td class="thumb-c">${r.thumb ? `<img src="${r.thumb}" alt="">` : ''}</td>` +
      COLS.map(([k]) => `<td><input data-k="${k}" value="${esc(val(r, k))}"${k === 'file' ? ' readonly' : ''}></td>`).join('') +
      `<td class="st" title="${esc(tip)}">${ic}</td>` +
      `<td class="mrz"><input data-m="1" value="${esc(r.rec?.mrz1)}" spellcheck="false"></td><td class="mrz"><input data-m="2" value="${esc(r.rec?.mrz2)}" spellcheck="false"></td>` +
      `<td class="x"><button data-del title="Remove">✕</button></td></tr>`;
  }).join('');
  const ok = rows.filter(r => r.rec?.valid).length;
  $('#summary').textContent = `${rows.length} passport${rows.length === 1 ? '' : 's'} · ${ok} verified · ${rows.length - ok} to check`;
}
$('#sheet').addEventListener('change', e => {
  const tr = e.target.closest('tr'); if (!tr) return; const r = rows[tr.dataset.i];
  if (e.target.dataset.m) { // MRZ edited → re-parse the whole row
    const inp = tr.querySelectorAll('[data-m]'); r.rec = parseTD3(inp[0].value || '', inp[1].value || ''); render();
  } else if (r.rec && e.target.dataset.k) {
    const k = e.target.dataset.k; let v = e.target.value.trim();
    if (DATE.has(k)) { const m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); v = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v; }
    r.rec[k] = v;
  }
});
$('#sheet').addEventListener('click', e => { if (e.target.dataset.del !== undefined) { rows.splice(e.target.closest('tr').dataset.i, 1); render(); } });

/* ---------- export ---------- */
const HEAD = [...COLS.map(c => c[1]), 'Full name', 'Verified', 'MRZ line 1', 'MRZ line 2'];
const table = () => [HEAD, ...rows.map(r => [...COLS.map(([k]) => val(r, k)), r.rec ? `${r.rec.given} ${r.rec.surname}`.trim() : '', r.rec?.valid ? 'Yes' : 'CHECK', r.rec?.mrz1 ?? '', r.rec?.mrz2 ?? ''])];
const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); };
const colName = i => (i >= 26 ? String.fromCharCode(64 + i / 26) : '') + String.fromCharCode(65 + i % 26);
async function xlsx() {
  const z = new JSZip(), data = table();
  const sheet = data.map((row, ri) => `<row r="${ri + 1}">` + row.map((v, ci) => `<c r="${colName(ci)}${ri + 1}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join('') + '</row>').join('');
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  z.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Passports" sheetId="1" r:id="rId1"/></sheets></workbook>');
  z.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  z.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>');
  z.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${HEAD.length}" width="20" customWidth="1"/></cols><sheetData>${sheet}</sheetData></worksheet>`);
  dl(await z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'passports.xlsx');
}
const csvText = sep => table().map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(sep)).join('\r\n');
$('#xlsx').onclick = xlsx;
$('#csv').onclick = () => dl(new Blob(['﻿' + csvText(',')], { type: 'text/csv' }), 'passports.csv');
$('#copy').onclick = () => navigator.clipboard.writeText(csvText('\t')).then(() => toast('Copied – paste into Excel / Google Sheets'), () => toast('Copy blocked by browser', true));
$('#clear').onclick = () => { if (confirm('Remove all rows?')) { rows.length = 0; render(); } };

const drop = $('#drop'), input = $('#file');
input.onchange = () => { addFiles(input.files); input.value = ''; };
['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
