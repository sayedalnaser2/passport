import * as pdfjsLib from './vendor/pdf.min.mjs';
import { findMrzLines, parseTD3, voteLines, dmy } from './mrz.js';
import { parseViz, lev } from './viz.js';
pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = (m, err) => { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = m; $('#toasts').append(t); setTimeout(() => t.remove(), err ? 6000 : 3000); };
const busy = (t, p) => { $('#busy').hidden = t === null; if (t !== null) { $('#busytext').textContent = t; $('#busybar').style.width = (p ?? 0) * 100 + '%'; } };

const COLS = [
  ['file', 'File'], ['surname', 'Surname'], ['given', 'Given names'], ['passportNo', 'Passport No.'],
  ['nationality', 'Nationality'], ['dob', 'Date of birth'], ['sex', 'Sex'], ['expiry', 'Date of expiry'],
  ['issuer', 'Issuing country'], ['personalNo', 'CPR / Personal No.'],
  ['placeOfBirth', 'Place of birth'], ['issueDate', 'Date of issue'], ['authority', 'Authority'],
];
const DATE = new Set(['dob', 'expiry', 'issueDate']);
const rows = []; // {file, thumb, rec, error}

/* ---------- OCR ---------- */
let mrzW, vizW;
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load OCR engine (offline?)')); document.head.append(s); });
async function getWorkers() {
  if (mrzW) return;
  await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
  const logger = m => { if (m.status !== 'recognizing text') busy('Loading OCR engine…', m.progress || 0); };
  mrzW = await Tesseract.createWorker('eng', 1, { logger });
  await mrzW.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<', tessedit_pageseg_mode: '6', preserve_interword_spaces: '0' });
  vizW = await Tesseract.createWorker('eng', 1, { logger });
  await vizW.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });
}
/* image helpers */
function toCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
function rotate(src, deg) {
  if (!deg) return src; const r = deg * Math.PI / 180, q = Math.abs(deg) % 180 === 90;
  const w = q ? src.height : Math.abs(src.width * Math.cos(r)) + Math.abs(src.height * Math.sin(r)), h = q ? src.width : Math.abs(src.width * Math.sin(r)) + Math.abs(src.height * Math.cos(r));
  const c = toCanvas(w, h), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.translate(c.width / 2, c.height / 2); x.rotate(r); x.drawImage(src, -src.width / 2, -src.height / 2); return c;
}
function crop(src, y0, targetW, mode) {
  const sy = Math.floor(src.height * y0), sh = src.height - sy, k = targetW / src.width;
  const c = toCanvas(targetW, sh * k), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, sy, src.width, sh, 0, 0, c.width, c.height);
  return mode === 'bin' ? adaptive(c) : mode === 'gray' ? stretch(c) : c;
}
function stretch(c) { // grayscale + auto-contrast (1%..99% percentile)
  const x = c.getContext('2d'), im = x.getImageData(0, 0, c.width, c.height), d = im.data, h = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const g = (d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114) | 0; d[i] = g; h[g]++; }
  const n = d.length / 4; let lo = 0, hi = 255, a = 0; while (lo < 255 && (a += h[lo]) < n * .01) lo++; a = 0; while (hi > 0 && (a += h[hi]) < n * .01) hi--;
  const k = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, (d[i] - lo) * k)); d[i] = d[i + 1] = d[i + 2] = v; }
  x.putImageData(im, 0, 0); return c;
}
function adaptive(c) { // local-mean threshold via integral image: copes with glare / uneven light
  stretch(c); const x = c.getContext('2d'), im = x.getImageData(0, 0, c.width, c.height), d = im.data, W = c.width, H = c.height;
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let xx = 0; xx < W; xx++) { row += d[(y * W + xx) * 4]; I[(y + 1) * (W + 1) + xx + 1] = I[y * (W + 1) + xx + 1] + row; } }
  const r = Math.max(12, W / 60 | 0);
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const x0 = Math.max(0, xx - r), x1 = Math.min(W, xx + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    const m = (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    const i = (y * W + xx) * 4, v = d[i] < m * 0.82 ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v;
  }
  x.putImageData(im, 0, 0); return c;
}
const ATTEMPTS = [[0, 0], [180, 0], [0, -3], [0, 3], [90, 0], [270, 0], [180, -3], [180, 3], [0, -6], [0, 6]];
const vizHints = v => v ? { passportNo: v.passportNo, dob: v.dob, expiry: v.expiry, personalNo: v.personalNo, sex: v.sex } : {};
const score = rec => rec ? Object.values(rec.checks).filter(Boolean).length + (rec.issuer === 'BHR' ? 1 : 0) + (rec.nationality === 'BHR' ? 1 : 0) : -1;

/** Full read of one page image → {rec, log, rot}. */
async function readPassport(canvas, log) {
  await getWorkers();
  let best = null, bestCanvas = canvas, texts = [];
  for (const [rot, tilt] of ATTEMPTS) {
    const src = rotate(rotate(canvas, rot), tilt), pairs = []; let local = null;
    busy(`Reading MRZ (rotation ${rot}°${tilt ? ' tilt ' + tilt + '°' : ''})…`, .1);
    for (const y0 of [0.72, 0.5, 0]) for (const mode of ['gray', 'bin']) {
      const { data } = await mrzW.recognize(crop(src, y0, 1800, mode));
      const p = findMrzLines(data.text); log.push(`[rot ${rot} tilt ${tilt} crop ${y0} ${mode}] ` + (p ? p.join(' / ') : '(no MRZ lines) ' + data.text.trim().split('\n').slice(-2).join(' / ')));
      if (!p) continue; pairs.push(p);
      const rec = parseTD3(p[0], p[1]); if (score(rec) > score(local)) local = rec;
      if (local.valid) break;
    }
    if (pairs.length > 1 && !(local && local.valid)) { // character-wise vote across all readings
      const voted = parseTD3(voteLines(pairs.map(p => p[0])), voteLines(pairs.map(p => p[1])));
      log.push(`[vote of ${pairs.length}] ` + voted.mrz1 + ' / ' + voted.mrz2); if (score(voted) > score(local)) local = voted;
    }
    if (score(local) > score(best)) { best = local; bestCanvas = src; texts = pairs; log.push(`→ best so far score ${score(local)} (rot ${rot}, tilt ${tilt})`); }
    if (best && best.valid) break;
    if (best && score(best) >= 5 && rot === 0 && tilt === 0) { /* plausible orientation; skip the 90/180 searches but still try tilts */ }
  }
  /* visual zone */
  busy('Reading printed data…', .5);
  const big = crop(bestCanvas, 0, 2200, 'gray');
  const { data } = await vizW.recognize(big, {}, { blocks: true });
  const lines = toCells(data);
  const viz = parseViz(lines); log.push('[VIZ cells] ' + lines.map(l => `${l.text.trim()}@${l.x0},${l.y0}-${l.x1},${l.y1}`).join(' ⏎ ')); log.push('[VIZ fields] ' + JSON.stringify(viz.fields));
  /* re-parse the MRZ with VIZ hints (repairs fields using what is printed on the page) */
  let rec = best;
  if (best && texts.length) {
    const hint = parseTD3(best.mrz1, best.mrz2, vizHints(viz.fields));
    if (score(hint) >= score(best)) { if (hint.repaired || hint.valid !== best.valid) log.push('→ repaired using printed values'); rec = hint; }
  }
  return { rec: reconcile(rec, viz.fields), viz: viz.fields, log };
}

/** OCR result → cells (words split into columns at wide gaps), each with a bounding box. */
function toCells(data) {
  const L = data.lines || (data.blocks || []).flatMap(b => b.paragraphs.flatMap(q => q.lines)), cells = [];
  for (const l of L) {
    const ws = (l.words || []).filter(w => w.text.trim()); if (!ws.length) continue;
    const h = Math.max(10, l.bbox.y1 - l.bbox.y0); let cur = null;
    for (const w of ws) {
      if (cur && w.bbox.x0 - cur.x1 < h * 1.6) { cur.text += ' ' + w.text; cur.x1 = w.bbox.x1; cur.y0 = Math.min(cur.y0, w.bbox.y0); cur.y1 = Math.max(cur.y1, w.bbox.y1); }
      else { cur = { text: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 }; cells.push(cur); }
    }
  }
  // OCR sometimes splits one printed value into several pieces (even on different "lines"): re-join pieces on the same row
  for (let again = true; again;) {
    again = false;
    cells.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1) || a.x0 - b.x0);
    for (let i = 0; i < cells.length && !again; i++) for (let j = 0; j < cells.length && !again; j++) {
      const a = cells[i], b = cells[j]; if (i === j || b.x0 < a.x0) continue;
      const h = Math.max(a.y1 - a.y0, b.y1 - b.y0), ov = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0), gap = b.x0 - a.x1;
      if (ov >= .4 * Math.min(a.y1 - a.y0, b.y1 - b.y0) && Math.abs(a.y1 - b.y1) <= Math.max(8, .35 * Math.min(a.y1 - a.y0, b.y1 - b.y0)) && gap > -8 && gap < Math.max(14, h * .9)) {
        a.text += (gap > h * .15 || /\s$/.test(a.text) ? ' ' : '') + b.text; a.x1 = Math.max(a.x1, b.x1); a.y0 = Math.min(a.y0, b.y0); a.y1 = Math.max(a.y1, b.y1); cells.splice(j, 1); again = true;
      }
    }
  }
  return cells;
}

/** Merge MRZ (check-digit verified) with printed values; list disagreements. */
function reconcile(mrz, v) {
  const rec = mrz ? { ...mrz } : { docType: 'Passport', issuer: '', surname: '', given: '', passportNo: '', nationality: '', dob: '', sex: '', expiry: '', personalNo: '', mrz1: '', mrz2: '', checks: { mrz: false }, valid: false };
  rec.mismatch = []; rec.sources = {};
  if (rec.mrz1 && rec.issuer !== 'BHR') { // line 1 is the noisy one: names unverifiable, issuer = nationality for Bahraini passports
    if (rec.nationality === 'BHR') rec.issuer = 'BHR';
    if (!(v.surname && v.given)) rec.mismatch.push('names: MRZ line 1 unclear and printed names not read – verify');
  }
  for (const k of ['surname', 'given']) { // names have no check digit: prefer whichever reading agrees best
    const m = rec[k], q = v[k]; if (!m || !q) continue;
    const a = m.replace(/\s/g, ''), b = q.replace(/\s/g, '');
    if (a !== b && lev(a, b) <= Math.max(2, Math.round(b.length * .35))) { rec[k] = q; rec.sources[k] = 'printed (MRZ OCR was noisy: ' + m + ')'; }
  }
  const pairs = [['surname', 'surname'], ['given', 'given'], ['passportNo', 'passportNo'], ['dob', 'dob'], ['sex', 'sex'], ['expiry', 'expiry'], ['personalNo', 'personalNo']];
  for (const [k, vk] of pairs) {
    const m = rec[k], p = v[vk];
    const strip = x => x.replace(/\s/g, '');
    if (m && p && ['surname', 'given'].includes(k) && lev(strip(m), strip(p)) > .6 * Math.max(strip(m).length, strip(p).length)) { rec.sources[k + '_note'] = `printed OCR unreadable ("${p}")`; continue; }
    if (m && p && strip(m) !== strip(p)) {
      const protectedOk = mrz && mrz.checks && ({ passportNo: 'passportNo', dob: 'dob', expiry: 'expiry', personalNo: 'personalNo' }[k] ? mrz.checks[k] : false);
      if (protectedOk && lev(strip(m), strip(p)) <= (DATE.has(k) ? 2 : 1)) rec.sources[k + '_note'] = `printed OCR read "${p}" (ignored: MRZ check digit verified)`;
      else if (!protectedOk && ['surname', 'given'].includes(k) && lev(strip(m), strip(p)) <= 1) rec.sources[k + '_note'] = `printed OCR read "${p}"`;
      else rec.mismatch.push(`${k}: MRZ=${m} printed=${p}`);
    }
    if (!m && p) { rec[k] = p; rec.sources[k] = 'printed'; }
    else if (m && !p && !mrz.valid) rec.sources[k] = 'MRZ (unverified)';
  }
  rec.placeOfBirth = v.pob || ''; rec.issueDate = v.issue || ''; rec.authority = v.authority || ''; rec.nationalityText = v.nationality || '';
  rec.vizRead = Object.keys(v).length;
  if (!rec.nationality && /BAHRAIN/.test(rec.nationalityText)) rec.nationality = 'BHR';
  return rec;
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
          const log = [], t0 = performance.now(); let out;
          try { out = await readPassport(canvas, log); } catch (e) { console.error(e); log.push('ERROR ' + (e.stack || e)); out = { rec: null, viz: {} }; }
          log.push(`done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
          const rec = out.rec && (out.rec.mrz1 || out.rec.surname || out.rec.passportNo) ? out.rec : null;
          rows.push({ file: name, thumb: th.toDataURL('image/jpeg', .6), rec, viz: out.viz, log, error: rec ? '' : 'Nothing readable found' });
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
  if (!r.rec.valid) return ['⚠', 'bad', (r.rec.mrz1 ? 'Check digit failed: ' + fails.join(', ') : 'MRZ not found – values come from the printed page only') + '. Please verify manually.' + (r.rec.mismatch?.length ? '\nMRZ vs printed: ' + r.rec.mismatch.join('; ') : '')];
  if (r.rec.mismatch?.length) return ['≈', 'warn', 'MRZ check digits OK, but printed page differs: ' + r.rec.mismatch.join('; ')];
  const note = r.rec.repaired ? ' (some characters auto-corrected by check digits)' : '';
  return r.rec.vizRead ? ['✔', 'good', 'MRZ check digits OK and matches printed page' + note] : ['✔', 'good', 'MRZ check digits OK; printed page not read' + note];
}
function render() {
  const tbl = $('#sheet'); tbl.hidden = !rows.length; $('#bar').hidden = !rows.length;
  tbl.tHead.innerHTML = '<tr><th>#</th><th>Scan</th>' + COLS.map(c => `<th>${c[1]}</th>`).join('') + '<th>Status</th><th>MRZ line 1</th><th>MRZ line 2</th><th></th></tr>';
  tbl.tBodies[0].innerHTML = rows.map((r, i) => {
    const [ic, cls, tip] = statusOf(r);
    return `<tr class="${cls}" data-i="${i}"><td class="num" data-dbg title="Click for debug log">${i + 1}</td><td class="thumb-c">${r.thumb ? `<img src="${r.thumb}" alt="">` : ''}</td>` +
      COLS.map(([k]) => `<td><input title="${esc(r.rec?.sources?.[k] ? 'source: ' + r.rec.sources[k] : '')}" data-k="${k}" value="${esc(val(r, k))}"${k === 'file' ? ' readonly' : ''}></td>`).join('') +
      `<td class="st" title="${esc(tip)}">${ic}</td>` +
      `<td class="mrz"><input data-m="1" value="${esc(r.rec?.mrz1)}" spellcheck="false"></td><td class="mrz"><input data-m="2" value="${esc(r.rec?.mrz2)}" spellcheck="false"></td>` +
      `<td class="x"><button data-del title="Remove">✕</button></td></tr>`;
  }).join('');
  showDebug();
  const ok = rows.filter(r => r.rec?.valid).length;
  $('#summary').textContent = `${rows.length} passport${rows.length === 1 ? '' : 's'} · ${ok} verified · ${rows.length - ok} to check`;
}
$('#sheet').addEventListener('change', e => {
  const tr = e.target.closest('tr'); if (!tr) return; const r = rows[tr.dataset.i];
  if (e.target.dataset.m) { // MRZ edited → re-parse the whole row
    const inp = tr.querySelectorAll('[data-m]'), old = r.rec || {};
    const n = parseTD3(inp[0].value || '', inp[1].value || '', r.viz && { passportNo: r.viz.passportNo, dob: r.viz.dob, expiry: r.viz.expiry, personalNo: r.viz.personalNo, sex: r.viz.sex });
    r.rec = { ...n, placeOfBirth: old.placeOfBirth, issueDate: old.issueDate, authority: old.authority, nationalityText: old.nationalityText, vizRead: old.vizRead, mismatch: [] }; render();
  } else if (r.rec && e.target.dataset.k) {
    const k = e.target.dataset.k; let v = e.target.value.trim();
    if (DATE.has(k)) { const m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); v = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v; }
    r.rec[k] = v;
  }
});
let dbgRow = -1;
function showDebug() { const on = $('#dbgOn').checked, pre = $('#dbg'); pre.hidden = !on || !rows[dbgRow]; if (!pre.hidden) pre.textContent = `# ${dbgRow + 1} ${rows[dbgRow].file}\n` + (rows[dbgRow].log || []).join('\n'); }
$('#dbgOn').onchange = showDebug;
window.__passportRows = rows; // handy from the console: __passportRows[0].log
$('#sheet').addEventListener('click', e => {
  if (e.target.dataset.dbg !== undefined) { dbgRow = +e.target.closest('tr').dataset.i; $('#dbgOn').checked = true; showDebug(); return; } if (e.target.dataset.del !== undefined) { rows.splice(e.target.closest('tr').dataset.i, 1); render(); } });

/* ---------- export ---------- */
const HEAD = [...COLS.map(c => c[1]), 'Full name', 'Verified', 'Notes', 'MRZ line 1', 'MRZ line 2'];
const table = () => [HEAD, ...rows.map(r => [...COLS.map(([k]) => val(r, k)), r.rec ? `${r.rec.given} ${r.rec.surname}`.trim() : '', r.rec?.valid ? (r.rec.mismatch?.length ? 'MRZ ok, printed differs' : 'Yes') : 'CHECK', (r.rec?.mismatch || []).join('; '), r.rec?.mrz1 ?? '', r.rec?.mrz2 ?? ''])];
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
