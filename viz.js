/* Visual-zone (printed data page) reader: takes OCR lines [{text,x0,y0,x1,y1}] and extracts labelled fields.
   Labels are matched fuzzily so OCR typos ("Dale of Birlh") still work; Arabic text is ignored. */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const LABELS = {
  passportNo: ['passport no', 'passport number', 'passport n'],
  surname: ['surname', 'sumame', 'family name'],
  given: ['given names', 'given name', 'first name'],
  nationality: ['nationality'],
  dob: ['date of birth', 'birth date'],
  sex: ['sex', 'gender'],
  pob: ['place of birth', 'birth place'],
  issue: ['date of issue', 'issue date'],
  expiry: ['date of expiry', 'expiry date', 'date of expiration'],
  authority: ['authority', 'issuing authority'],
  personalNo: ['personal no', 'personal number', 'national no', 'cpr', 'id no', 'identity no'],
};

export function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const latin = s => s.replace(/[^\x20-\x7E]/g, ' ').replace(/[|_\\]/g, ' ').replace(/\s+/g, ' ').trim();

/** Find label in a line (fuzzy). Returns {end, len} (index in the lowercase latin text) or null. */
function findLabel(text, label) {
  const t = latin(text).toLowerCase(), n = label.length, tol = n <= 4 ? 0 : Math.max(1, Math.floor(n * 0.2));
  let best = null;
  for (let i = 0; i + n - 2 <= t.length; i++) for (const w of [n - 1, n, n + 1]) {
    if (i + w > t.length) continue; const sub = t.slice(i, i + w), dist = lev(sub, label);
    if (dist <= tol && (!best || dist < best.dist)) best = { dist, end: i + w, start: i };
  }
  // short labels must start a word to avoid matching inside other words (e.g. "sex" in "Sexton")
  if (best && n <= 4 && best.start > 0 && /[a-z]/.test(t[best.start - 1])) return null;
  return best;
}

export function parseVizDate(s) {
  if (!s) return '';
  s = latin(s).toUpperCase().replace(/O(?=\d)|(?<=\d)O/g, '0').replace(/(?<![A-Z])[IL](?=\d)/g, '1');
  let m = s.match(/(\d{1,2})\s*[\/.\- ]?\s*([A-Z]{3})[A-Z]*(?:\s*\/?\s*[A-Z]{3,})?\s*[\/.\- ]?\s*(\d{4})/);
  let d, mo, y;
  if (m) { d = +m[1]; mo = MONTHS.findIndex(x => lev(x, m[2]) <= 1) + 1; y = +m[3]; }
  else if ((m = s.match(/(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4})/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = s.match(/(\d{4})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/\b(\d{1,2})\s+([A-Z]{3})[A-Z]*\s+(\d{4})/))) { d = +m[1]; mo = MONTHS.findIndex(x => lev(x, m[2]) <= 1) + 1; y = +m[3]; }
  else return '';
  if (!(d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y > 1900 && y < 2100)) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const asDigits = s => s.replace(/[OQD]/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
const textField = v => { const t = latin(v).toUpperCase().replace(/[^A-Z ,.-]/g, '').trim(); return (t.match(/[A-Z]/g) || []).length >= 3 ? t : ''; }; // too short = OCR noise
const CLEAN = {
  passportNo: v => { const t = latin(v).toUpperCase().split(' ').map(x => x.replace(/[^A-Z0-9]/g, '')).find(x => x.length >= 7 && x.length <= 9 && /\d{5}/.test(asDigits(x.slice(1)))); return t || ''; },
  personalNo: v => { const t = latin(v).toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(' ').map(asDigits).find(x => /^\d{8,9}$/.test(x)); return t || ''; },
  surname: v => latin(v).toUpperCase().replace(/[^A-Z' -]/g, '').trim(),
  given: v => latin(v).toUpperCase().replace(/[^A-Z' -]/g, '').replace(/\s+/g, ' ').trim(),
  nationality: v => latin(v).toUpperCase().replace(/[^A-Z ]/g, '').trim(),
  sex: v => { const t = latin(v).toUpperCase(); const m = t.match(/\b([MF])\b|(MALE|FEMALE)/); return m ? (m[1] || m[2][0]) : ''; },
  pob: v => textField(v),
  authority: v => textField(v),
  dob: parseVizDate, issue: parseVizDate, expiry: parseVizDate,
};

/** lines: [{text,x0,y0,x1,y1}] in reading order. Returns {fields, found}. */
export function parseViz(lines) {
  lines = lines.filter(l => /[A-Za-z0-9]/.test(latin(l.text)));
  const hits = []; // {key, li, rest}
  lines.forEach((l, li) => {
    for (const [key, names] of Object.entries(LABELS)) {
      for (const nm of names) {
        const f = findLabel(l.text, nm); if (!f) continue;
        // approximate remainder after label: map back by dropping latin prefix of same length
        const lat = latin(l.text); let rest = lat.slice(Math.min(f.end, lat.length)).replace(/^[\s\/:.\-]+/, '');
        if (/^[O0|\]\[\s.,:;\/]*$/.test(rest) || rest.length < 2) rest = ''; // leftover of the Arabic label
        hits.push({ key, li, rest, dist: f.dist, nameLen: nm.length }); break;
      }
    }
  });
  // prefer longest-name/lowest-distance label per line (e.g. "Date of Birth" beats "Birth")
  const byLine = new Map();
  for (const h of hits) { const c = byLine.get(h.li + ':' + h.key); if (!c || h.dist < c.dist) byLine.set(h.li + ':' + h.key, h); }
  const perLine = {}; for (const h of byLine.values()) (perLine[h.li] ||= []).push(h);
  const chosen = [];
  for (const arr of Object.values(perLine)) {
    // one label per line unless it's clearly two (e.g. "Date of Birth ... Sex"); keep best by longest label
    arr.sort((a, b) => b.nameLen - a.nameLen || a.dist - b.dist); chosen.push(arr[0]);
    // "place of birth" also contains "birth": drop shorter overlapping
  }
  const isLabelLine = new Set(chosen.map(h => h.li));
  const fields = {}, found = {};
  for (const h of chosen) {
    if (fields[h.key]) continue;
    const clean = CLEAN[h.key] || (v => latin(v));
    let v = clean(h.rest);
    const L = lines[h.li];
    if (!v) {
      if (L.x1 !== undefined && L.y0 !== undefined) { // geometric: nearest non-label cell below, aligned with the label
        const hgt = Math.max(8, L.y1 - L.y0), cand = lines.map((M, k) => ({ M, k })).filter(({ M, k }) => !isLabelLine.has(k) && (M.y0 + M.y1) / 2 - (L.y0 + L.y1) / 2 > hgt * .6 && M.y0 - L.y1 < hgt * 5 && M.x0 < L.x1 + 30 && M.x1 > L.x0 - 30);
        cand.sort((a, b) => (a.M.y0 - b.M.y0 > hgt * .8 ? a.M.y0 - b.M.y0 : Math.abs(a.M.x0 - L.x0) - Math.abs(b.M.x0 - L.x0)));
        for (const { M } of cand) { v = clean(M.text); if (v) break; }
      } else for (let k = h.li + 1; k < Math.min(lines.length, h.li + 3) && !v; k++) { if (isLabelLine.has(k)) break; v = clean(lines[k].text); }
    }
    if (v) { fields[h.key] = v; found[h.key] = true; }
  }
  return { fields, found };
}
