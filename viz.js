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
export function parseLabelled(lines) {
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


/* ================= pattern-based extraction (real Bahraini passports) =================
   Real scans: Arabic text and guilloche backgrounds garble labels, so values are found by *shape* instead
   (dates, 7-digit/letter+7 passport no., 9-digit CPR, ALL-CAPS name line) and cross-checked against the MRZ. */
export const PLACES = ['MANAMA', 'MUHARRAQ', 'RIFFA', 'ISA TOWN', 'HAMAD TOWN', 'SITRA', 'BUDAIYA', 'ZALLAQ', 'JIDHAFS', 'AALI', 'SAAR', 'TUBLI', 'SANABIS', 'DIRAZ', 'DUMISTAN', 'HIDD', 'ARAD', 'BUSAITEEN', 'SALMABAD', 'JANABIYAH', 'MADINAT HAMAD', 'MADINAT ISA', 'ALAREEN', 'BARBAR', 'KARRANAH', 'ADLIYA', 'GUDAIBIYA', 'JUFFAIR', 'SEEF', 'AWALI', 'ZINJ', 'NUWAIDRAT', 'MAQABA', 'DAIH', 'HALAT NAIM', 'SAMAHEEJ', 'DAR KULAIB', 'RAS RUMMAN'];
export const OCCUPATIONS = ['STUDENT', 'EMPLOYEE', 'ENGINEER', 'TEACHER', 'DOCTOR', 'HOUSEWIFE', 'BUSINESSMAN', 'BUSINESSWOMAN', 'MANAGER', 'ACCOUNTANT', 'CHILD', 'INFANT', 'MILITARY', 'POLICE', 'NURSE', 'LAWYER', 'DRIVER', 'RETIRED', 'WORKER', 'UNEMPLOYED', 'TECHNICIAN', 'ADMINISTRATOR', 'DIPLOMAT', 'PILOT', 'SECRETARY', 'CLERK', 'SPECIALIST', 'CONSULTANT', 'ARCHITECT', 'PHARMACIST', 'BANKER', 'PROFESSOR', 'LECTURER', 'MERCHANT', 'FARMER', 'FISHERMAN', 'PRIVATE SECTOR', 'GOVERNMENT EMPLOYEE', 'SELF EMPLOYED', 'OFFICER', 'SUPERVISOR', 'SALESMAN', 'ANALYST'];
const HEADER = /KINGDOM|PASSPORT|DIPLOMATIC|NATIONALITY|PLACE OF|DATE OF|OCCUPATION|SIGNATURE|HOLDER|AUTHORITY|ISSUING|PERSONAL|BEARER/;
const capsTokens = s => latin(s).split(' ').map(t => t.replace(/[.,]+$/, '')).filter(t => /^[A-Z][A-Z'-]*$/.test(t) || /^[A-Z]\.?$/.test(t));
const snap = (v, list, max = 2) => { let best = null; for (const p of list) { const d = lev(v, p); if (d <= Math.min(max, Math.floor(p.length / 3)) && (!best || d < best.d)) best = { p, d }; } return best && best.p; }; // 6+ letter words may differ by 2 (MANAMA→WANAWA)
const fixDigits = t => t.replace(/[OQD]/g, '0').replace(/[IL|]/g, '1').replace(/Z/g, '2').replace(/S/g, '5').replace(/B/g, '8');
const iso = (d, m, y) => { d = +d; m = +m; y = +y; return d >= 1 && d <= 31 && m >= 1 && m <= 12 && y > 1900 && y < 2100 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : ''; };

export function parsePrinted(cells, mrz = null) {
  const cs = cells.filter(c => !/</.test(c.text)).map(c => ({ ...c, t: latin(c.text) })).filter(c => c.t);
  const out = {};
  // dates: dd.mm.yyyy / dd/mm/yyyy anywhere; chronological order = birth < issue < expiry
  const dates = new Set();
  for (const c of cs) {
    for (const m of c.t.matchAll(/(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})/g)) { const v = iso(m[1], m[2], m[3]); if (v) dates.add(v); }
    const v = /\d{4}/.test(c.t) && !/\d\s*[./-]\s*\d/.test(c.t) ? parseVizDate(c.t) : ''; if (v) dates.add(v);
  }
  // OCR flips digits (2031→1931): a printed date within 2 characters of an MRZ date *is* that date
  const anchors = mrz ? [mrz.dob, mrz.expiry].filter(Boolean) : [], snap1 = new Map();
  for (const a of anchors) { // only when the anchor date isn't printed verbatim: the closest printed date (≤2 chars off) is that date misread once
    if (dates.has(a)) continue;
    const pair = d => { const dy = Math.abs(+a.slice(0, 4) - +d.slice(0, 4)); return (dy === 5 || dy === 10) && Math.abs(new Date(a.slice(4)) - new Date(d.slice(4))) <= 2 * 864e5; }; // issue and expiry are 5/10 years apart: not a misread of each other
    const c = [...dates].filter(d => !anchors.includes(d) && !pair(d)).map(d => ({ d, k: lev(a, d) })).filter(x => x.k <= 2).sort((p, q) => p.k - q.k)[0]; if (c) snap1.set(c.d, a);
  }
  const snapd = d => snap1.get(d) || d;
  const ds = [...new Set([...dates].map(snapd))].sort(), ref = mrz && mrz.expiry;
  if (ds.length >= 3) {
    out.dob = ds[0]; out.expiry = ds[ds.length - 1]; const mid = ds.slice(1, -1);
    const target = y => { const t = new Date(out.expiry); t.setFullYear(t.getFullYear() - y); return +t; };
    out.issue = mid.sort((a, b) => Math.min(Math.abs(new Date(a) - target(5)), Math.abs(new Date(a) - target(10))) - Math.min(Math.abs(new Date(b) - target(5)), Math.abs(new Date(b) - target(10))))[0];
  } else if (ds.length === 2 && mrz) { // ambiguous without labels: use the MRZ to say which two these are
    const have = d => ds.includes(d);
    if (mrz.dob && have(mrz.dob)) { out.dob = mrz.dob; const o = ds.find(d => d !== mrz.dob); if (o) (o > mrz.dob && ref && o < ref ? out.issue = o : out.expiry = o); }
    else if (ref && have(ref)) { out.expiry = ref; const o = ds.find(d => d !== ref); if (o) out.issue = o; }
  }
  // issue date must be 5 or 10 years before expiry (OCR often flips one digit: 2017→2047): snap to that, or discard
  if (out.issue && out.expiry) {
    const back = y => { const t = new Date(out.expiry + 'T00:00:00Z'); t.setUTCFullYear(t.getUTCFullYear() - y); return t.toISOString().slice(0, 10); };
    const plus = d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); }; // expiry is often "issue + N years − 1 day"
    const opts = [back(5), plus(back(5)), back(10), plus(back(10))];
    const near = opts.includes(out.issue) ? out.issue : opts.map(c => ({ c, d: lev(c, out.issue) })).filter(x => x.d <= 1).sort((p, q) => p.d - q.d)[0]?.c;
    if (near) out.issue = near; else if (out.issue >= out.expiry || (out.dob && out.issue <= out.dob)) delete out.issue;
  }
  if (out.issue && out.expiry && Math.abs(new Date(out.expiry) - new Date(out.issue)) < 300 * 864e5) delete out.issue; // issue ≈ expiry = misread digit, not a date
  if (out.dob && out.issue && out.dob >= out.issue) delete out.dob;
  // passport number: 7 digits, or letter + 7 digits (OCR look-alikes repaired)
  const cnt = {};
  for (const c of cs) for (const tk of c.t.toUpperCase().split(/[^A-Z0-9]+/)) {
    if (new Set(tk).size < 4) continue; // 0000000 / OOOOOOO = misread Arabic digits, not a number
    let v = ''; if (/^[A-Z][0-9OQDILZSB]{7}$/.test(tk)) v = tk[0] + fixDigits(tk.slice(1)); else if (/^[0-9OQDILZSB]{7}$/.test(tk) && /\d{4}/.test(tk)) v = fixDigits(tk);
    if (v) cnt[v] = (cnt[v] || 0) + 1;
  }
  const pn = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; if (pn) out.passportNo = pn[0];
  // CPR (9 digits, starts with YYMM of the birth date)
  const cprs = new Set(); for (const c of cs) for (const tk of c.t.toUpperCase().split(/[^A-Z0-9]+/)) if (/^[0-9OQDILZSB]{9}$/.test(tk) && /\d{5}/.test(tk)) cprs.add(fixDigits(tk));
  const dobRef = out.dob || (mrz && mrz.dob), yymm = dobRef ? dobRef.slice(2, 4) + dobRef.slice(5, 7) : '';
  const cl = [...cprs]; const cpr = cl.find(v => yymm && v.startsWith(yymm)) || (cl.length === 1 ? cl[0] : ''); if (cpr) out.personalNo = cpr;
  // sex: a lone M/F cell
  const sx = cs.filter(c => /^[MF]\.?$/.test(c.t)); if (sx.length === 1) out.sex = sx[0].t[0];
  // nationality / authority
  if (cs.some(c => c.t.toUpperCase().split(' ').some(w => w.length >= 6 && lev(w, 'BAHRAINI') <= 2 && w !== 'BAHRAIN'))) out.nationality = 'BAHRAINI';
  if (cs.some(c => !HEADER.test(c.t.toUpperCase()) && /\bBAHRAIN\b/.test(c.t.toUpperCase()))) out.authority = 'BAHRAIN';
  // place of birth: lexicon word anywhere outside headers (OCR typos snapped: MANAWA→MANAMA)
  for (const c of cs) { if (HEADER.test(c.t.toUpperCase()) || out.pob) continue; const w = capsTokens(c.t).filter(x => x.length >= 4); for (const x of w) { const p = snap(x, PLACES, 2); if (p) { out.pob = p; break; } } }
  // value of a label cell: same-row cells to its right, else aligned cells below
  const valueOf = L => {
    const cy = c => (c.y0 + c.y1) / 2, h = Math.max(12, L.y1 - L.y0);
    const right = cs.filter(c => c !== L && c.x0 >= L.x1 - 10 && Math.abs(cy(c) - cy(L)) < h * .7).sort((p, q) => p.x0 - q.x0);
    if (right.length) return right.map(c => c.t).join(' ');
    const below = cs.filter(c => c !== L && cy(c) > cy(L) + h * .3 && c.y0 - L.y1 < h * 2.5 && c.x0 < L.x1 + 30 && c.x1 > L.x0 - 30).sort((p, q) => p.y0 - q.y0)[0];
    return below ? below.t : '';
  };
  // full printed name: after a NAME / NAME OF BEARER label (inline or next line), else the ALL-CAPS line closest to the MRZ names
  const nameLabel = cs.find(c => /^NAME( OF BEARER)?\b/i.test(c.t) || lev(c.t.toUpperCase().slice(0, 12), 'NAME OF BEARER') <= 2 && c.t.length < 18);
  const exp = mrz && mrz.given ? `${mrz.given} ${mrz.surname}`.replace(/\s/g, '') : '';
  let nameTk = [];
  if (nameLabel) { const inline = capsTokens(nameLabel.t.replace(/^NAME( OF BEARER)?/i, '')); nameTk = inline.length >= 2 ? inline : capsTokens(valueOf(nameLabel)); }
  if (nameTk.length < 2 && exp) { // no usable label: best caps line by similarity to the MRZ
    const cand = cs.map(c => capsTokens(c.t.toUpperCase().replace(/^.*?\bNAME( OF BEARER)?\b/, ''))).filter(tk => tk.length >= 2 && tk.join('').length >= 6);
    cand.sort((p, q) => lev(p.join(''), exp) - lev(q.join(''), exp)); if (cand[0] && 1 - lev(cand[0].join(''), exp) / Math.max(exp.length, cand[0].join('').length) >= 0.5) nameTk = cand[0];
  }
  if (nameTk.length >= 2) {
    out.fullName = nameTk.join(' ');
    if (mrz) { const n = mrz.given ? Math.max(1, (mrz.surname.match(/\S+/g) || []).length) : 1; out.surname = nameTk.slice(-n).join(' '); out.given = nameTk.slice(0, -n).join(' ').replace(/\./g, ''); }
  }
  // occupation (ordinary passports): lexicon word anywhere, else caps words after an OCCUPATION label
  for (const c of cs) { if (out.occupation || HEADER.test(c.t.toUpperCase())) continue; for (const w of capsTokens(c.t).filter(x => x.length >= 5)) { const o = snap(w, OCCUPATIONS, 1); if (o) { out.occupation = o; break; } } }
  if (!out.occupation) { const L = cs.find(c => lev(c.t.toUpperCase().slice(0, 10), 'OCCUPATION') <= 2 && c.t.length < 16); if (L) { const w = capsTokens(valueOf(L)).filter(x => x.length >= 4); if (w.length) out.occupation = w.join(' '); } }
  // diplomatic passports: AUTHORITY label present but its value unreadable → BAHRAIN is what every sample prints (marked as assumed)
  if (!out.authority && mrz && mrz.docTypeCode === 'PD' && cs.some(c => lev(c.t.toUpperCase(), 'AUTHORITY') <= 2)) { out.authority = 'BAHRAIN'; out.assumed = ['authority']; }
  return out;
}

/** labelled + pattern-based, pattern-based wins; mrz (optional) steers name/date assignment */
export function parseViz(cells, mrz = null) {
  const a = parseLabelled(cells).fields, b = parsePrinted(cells, mrz);
  const fields = { ...a };
  if (b.dob || b.issue || b.expiry) { delete fields.dob; delete fields.issue; delete fields.expiry; } // pattern-based dates are chronologically checked; label-guessed ones are not
  for (const [k, v] of Object.entries(b)) if (v) fields[k] = v;
  return { fields, found: Object.fromEntries(Object.keys(fields).map(k => [k, true])) };
}
