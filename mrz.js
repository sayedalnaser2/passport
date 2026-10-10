/* ICAO 9303 TD3 (passport) MRZ parser, tuned for Bahraini passports (BHR).
   Repairs OCR confusions by searching for the smallest edit that satisfies each check digit,
   and can be steered by values read from the visual zone (hint). */

const W = [7, 3, 1];
const val = c => c === '<' ? 0 : c >= '0' && c <= '9' ? +c : c >= 'A' && c <= 'Z' ? c.charCodeAt(0) - 55 : NaN;
export const checkDigit = s => { let t = 0; for (let i = 0; i < s.length; i++) t += val(s[i]) * W[i % 3]; return t % 10; };
const ok = (s, d) => d >= '0' && d <= '9' && checkDigit(s) === +d;

const GROUPS = ['0OQD', '1IL', '2Z', '5S', '6G', '8B', '7T', '4A', '<K'];
const ALT = {}; for (const g of GROUPS) for (const c of g) ALT[c] = [...g];
const TO_DIGIT = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };
const TO_ALPHA = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 8: 'B', 6: 'G' };
const dig = s => [...s].map(c => TO_DIGIT[c] || c).join('');
const alp = s => [...s].map(c => TO_ALPHA[c] || c).join('');

export function clean(line) {
  return line.toUpperCase().replace(/[«‹]/g, '<').replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, '<');
}

/* ----- date helpers ----- */
export const dmy = iso => iso ? iso.split('-').reverse().join('/') : '';
const validDate = s => { if (!/^\d{6}$/.test(s)) return false; const m = +s.slice(2, 4), d = +s.slice(4, 6); return m >= 1 && m <= 12 && d >= 1 && d <= 31; };
const yymmdd = (s, kind) => {
  if (!validDate(s)) return '';
  let y = +s.slice(0, 2); const cur = new Date().getFullYear() % 100;
  y = kind === 'dob' ? (y > cur ? 1900 + y : 2000 + y) : (y > cur + 30 ? 1900 + y : 2000 + y);
  const iso = `${y}-${s.slice(2, 4)}-${s.slice(4, 6)}`, dt = new Date(iso + 'T00:00:00Z');
  return isNaN(dt) || dt.getUTCMonth() + 1 !== +s.slice(2, 4) ? '' : iso;
};
const isoToYYMMDD = iso => iso && /^\d{4}-\d\d-\d\d$/.test(iso) ? iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10) : '';

/* ----- single-field repair -----
   field/cd as read; kind 'digits' | 'alnum'; hint = value from the visual zone (optional);
   valid = extra validity test for candidates. Returns {value, cd, ok, edits}. */
export function fixField(field, cd, kind = 'alnum', hint = '', valid = () => true, maxEdits = 2) {
  if (kind === 'digits') field = dig(field);
  if (ok(field, cd) && valid(field)) return { value: field, cd, ok: true, edits: 0 };
  const want = kind === 'digits' ? dig(cd) : cd;
  if (hint && hint.length === field.length && valid(hint)) {
    const diff = [...field].filter((c, i) => c !== hint[i]).length;
    if (diff === 0) return { value: field, cd: String(checkDigit(field)), ok: true, edits: 0, viaViz: true }; // printed check digit was misread
    if (diff <= 3 && ok(hint, want)) return { value: hint, cd: want, ok: true, edits: diff, viaViz: true };
  }
  const cdOptions = /\d/.test(want) ? [want] : [want, ...(ALT[want] || [])];
  const cands = [];
  const alts = [...field].map(c => (kind === 'digits' ? (ALT[c] || [c]).filter(x => /\d/.test(x)) : ALT[c] || [c]));
  const n = field.length;
  const rec = (i, cur, edits, start) => {
    if (cdOptions.some(d => ok(cur.join(''), d)) && valid(cur.join(''))) cands.push({ value: cur.join(''), edits });
    if (edits >= maxEdits) return;
    for (let j = start; j < n; j++) for (const a of alts[j]) {
      if (a === field[j] || (cur[j] !== field[j])) continue;
      cur[j] = a; rec(j + 1, cur, edits + 1, j + 1); cur[j] = field[j];
    }
  };
  rec(0, [...field], 0, 0);
  if (!cands.length) return { value: field, cd, ok: false, edits: 0 };
  if (hint) { const h = cands.find(c => c.value === hint); if (h) return { value: h.value, cd: want, ok: true, edits: h.edits }; }
  cands.sort((a, b) => a.edits - b.edits);
  const best = cands.filter(c => c.edits === cands[0].edits);
  if (best.length === 1) return { value: best[0].value, cd: cdOptions.find(d => ok(best[0].value, d)), ok: true, edits: best[0].edits };
  return { value: field, cd, ok: false, edits: 0, ambiguous: best.map(b => b.value) };
}

/** Find the two MRZ lines in OCR text. */
export function findMrzLines(text) {
  const lines = text.split(/\r?\n/).map(clean).filter(l => l.length >= 28);
  let best = null;
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i], b = lines[i + 1]; let score = 0;
    if (a[0] === 'P') score += 2; if (a.slice(2, 5) === 'BHR') score += 2;
    if (/^[A-Z0-9<]{9}[0-9]BHR/.test(b)) score += 3; else if (b.slice(10, 13) === 'BHR') score += 2;
    if ((a.match(/</g) || []).length >= 4) score += 1;
    score += Math.min(a.length, 44) / 44 + Math.min(b.length, 44) / 44;
    if (!best || score > best.score) best = { score, l1: a, l2: b };
  }
  return best && best.score >= 3 ? [best.l1, best.l2] : null;
}

const fixLen = (l, n = 44) => l.length >= n ? l.slice(0, n) : l + '<'.repeat(n - l.length);

/** Per-position vote over several readings of the same line (all normalised to 44 chars). */
export function voteLines(lines) {
  lines = lines.map(l => fixLen(clean(l)));
  let out = '';
  for (let i = 0; i < 44; i++) { const c = {}; for (const l of lines) c[l[i]] = (c[l[i]] || 0) + 1; out += Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; }
  return out;
}

/** Parse two MRZ lines. viz (optional): {passportNo,dob,expiry,personalNo,sex} for steering repairs. */
export function parseTD3(r1, r2, viz = {}) {
  let l1 = fixLen(clean(r1)), l2 = fixLen(clean(r2));
  l1 = l1.replace(/<[<KCLI1]{3,}$/, m => '<'.repeat(m.length));
  const issuer = alp(l1.slice(2, 5)), nameField = l1.slice(5);
  const [sur, ...giv] = nameField.replace(/<+$/, '').split('<<');
  // '<<' separates surname from given names; anything after a second '<<' is filler misread by OCR
  const surname = alp((sur || '').replace(/</g, ' ')).trim(), given = alp((giv[0] || '').replace(/</g, ' ')).trim();

  const nat = alp(l2.slice(10, 13));
  const pnRaw = l2.slice(28, 42);
  const doc = fixField(l2.slice(0, 9), l2[9], 'alnum', clean(viz.passportNo || '').padEnd(9, '<'));
  const dob = fixField(l2.slice(13, 19), l2[19], 'digits', isoToYYMMDD(viz.dob), validDate);
  const exp = fixField(l2.slice(21, 27), l2[27], 'digits', isoToYYMMDD(viz.expiry), validDate);
  const pnEmpty = pnRaw.replace(/</g, '') === '';
  const pnDigits = pnRaw.replace(/</g, '').split('').filter(c => /[0-9OQDILZSBGT]/.test(c)).length >= 0.7 * pnRaw.replace(/</g, '').length;
  const pn = pnEmpty ? { value: pnRaw, cd: l2[42], ok: true } : fixField(pnRaw, l2[42], pnDigits ? 'digits' : 'alnum', clean(viz.personalNo || '').padEnd(14, '<'));
  let sexC = l2[20]; if (sexC !== 'M' && sexC !== 'F') sexC = viz.sex || ({ H: 'M', N: 'M', P: 'F', E: 'F' }[sexC] || '');
  const fin = l2[43];
  const body = doc.value + doc.cd + nat + dob.value + dob.cd + (l2[20] === 'M' || l2[20] === 'F' ? l2[20] : sexC || '<') + exp.value + exp.cd + pn.value + pn.cd;
  const comp = body.slice(0, 10) + body.slice(13, 20) + body.slice(21, 43);
  const checks = { passportNo: doc.ok, dob: dob.ok, expiry: exp.ok, personalNo: pn.ok, composite: ok(comp, dig(fin)) };
  const repaired = [doc, dob, exp, pn].some(f => f.edits);
  return {
    docType: l1[0] === 'P' ? 'Passport' : l1[0], issuer, surname, given,
    passportNo: doc.value.replace(/</g, ''), nationality: nat, dob: yymmdd(dob.value, 'dob'), sex: sexC, expiry: yymmdd(exp.value, 'exp'),
    personalNo: pn.value.replace(/</g, ''),
    mrz1: l1, mrz2: body + (checks.composite ? fin : l2[43]),
    checks, valid: Object.values(checks).every(Boolean), repaired,
  };
}

export function parseText(text, viz) {
  const p = findMrzLines(text);
  return p ? parseTD3(p[0], p[1], viz) : null;
}
