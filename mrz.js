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

/* ----- field repair -----
   candidates(): every reading of one field (+ its check digit) reachable with <= maxEdits OCR-confusion swaps that
   satisfies the check digit. A field whose check digit itself was misread is also offered (value kept, digit recomputed).
   parseTD3 then picks the combination of fields that also satisfies the composite digit, and only if it is unique. */
export function candidates(field, cd, kind = 'alnum', valid = () => true, maxEdits = 2, hint = '', digitMask = null) {
  if (kind === 'digits') field = dig(field);
  cd = dig(cd); // check digits are always numeric
  if (ok(field, cd) && valid(field)) return [{ value: field, cd, edits: 0 }];
  const want = cd, out = [];
  if (hint && hint === field && valid(field)) out.push({ value: field, cd: String(checkDigit(field)), edits: 1, cdFixed: true }); // printed page confirms the value → only the digit was misread
  const cdOptions = /\d/.test(want) ? [want] : [want, ...(ALT[want] || [])];
  const alts = [...field].map((c, i) => kind === 'digits' || (digitMask && digitMask.has(i)) ? (ALT[c] || [c]).filter(x => /\d/.test(x)) : ALT[c] || [c]);
  const n = field.length, cur = [...field];
  const rec = (edits, start) => {
    const v = cur.join('');
    if (edits && cdOptions.some(d => ok(v, d)) && valid(v)) out.push({ value: v, cd: cdOptions.find(d => ok(v, d)), edits });
    if (edits >= maxEdits) return;
    for (let j = start; j < n; j++) for (const a of alts[j]) { if (a === field[j]) continue; const o = cur[j]; cur[j] = a; rec(edits + 1, j + 1); cur[j] = o; }
  };
  rec(0, 0);
  if (hint && hint.length === field.length && hint !== field && valid(hint) && cdOptions.some(d => ok(hint, d))) { // value read from the printed page that satisfies the check digit
    const diff = [...field].filter((c, i) => c !== hint[i]).length;
    if (diff <= 3 && !out.some(o => o.value === hint)) out.push({ value: hint, cd: cdOptions.find(d => ok(hint, d)), edits: diff, viaViz: true });
  }
  if (!out.length) out.push({ value: field, cd, edits: 0, bad: true });
  return out.sort((x, y) => x.edits - y.edits);
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
  const pre = l1.match(/^[P<]{0,2}B?HR/); // lost/garbled "P<BHR" prefix (Bahraini passports) → restore so the name field stays aligned
  if (pre && pre[0] !== 'P<BHR') l1 = 'P<BHR' + l1.slice(pre[0].length);
  l1 = l1.replace(/<[<KCLI1]{3,}$/, m => '<'.repeat(m.length));
  const issuer = alp(l1.slice(2, 5)), nameField = l1.slice(5);
  const [sur, ...giv] = nameField.replace(/<+$/, '').split('<<');
  // '<<' separates surname from given names; anything after a second '<<' is filler misread by OCR
  const surname = alp((sur || '').replace(/</g, ' ')).trim(), given = alp((giv[0] || '').replace(/</g, ' ')).trim();

  const nat = alp(l2.slice(10, 13));
  let pnRaw = l2.slice(28, 42);
  const pnCore = pnRaw.replace(/</g, ''), pnEmpty = pnCore === '';
  const pnDigits = !pnEmpty && [...pnCore].filter(c => /[0-9OQDILZSBGT]/.test(c)).length >= 0.7 * pnCore.length; // CPR numbers are all digits
  if (pnDigits) { pnRaw = dig(pnRaw); const last = pnRaw.search(/\d(?!.*\d)/); pnRaw = pnRaw.slice(0, last + 1) + '<'.repeat(pnRaw.length - last - 1); } // anything after the last digit is filler
  const sexOk = l2[20] === 'M' || l2[20] === 'F';
  let sexC = sexOk ? l2[20] : viz.sex || ({ H: 'M', N: 'M', P: 'F', E: 'F' }[l2[20]] || '');
  const fin = dig(l2[43]);

  // passport numbers look like <letter><7 digits><filler>: when the tail is clearly digits, read look-alike letters as digits.
  // (the check digit cannot tell e.g. 'G' from '6' or 'K' from '<', so this prior is the only defence)
  let docRaw = l2.slice(0, 9), docMask = null;
  if ([...docRaw.slice(1, 8)].filter(c => /\d/.test(c)).length >= 5) docRaw = docRaw[0] + dig(docRaw.slice(1, 8)) + (/[KCL]/.test(docRaw[8]) ? '<' : docRaw[8]), docMask = new Set([1, 2, 3, 4, 5, 6, 7]);
  const hint = { doc: clean(viz.passportNo || '').padEnd(9, '<'), dob: isoToYYMMDD(viz.dob), exp: isoToYYMMDD(viz.expiry), pn: clean(viz.personalNo || '').padEnd(14, '<') };
  const C = {
    doc: candidates(docRaw, l2[9], 'alnum', docMask ? v => /^\d{7}$/.test(v.slice(1, 8)) : () => true, 2, hint.doc, docMask),
    dob: candidates(l2.slice(13, 19), l2[19], 'digits', validDate, 2, hint.dob),
    exp: candidates(l2.slice(21, 27), l2[27], 'digits', validDate, 2, hint.exp),
    pn: pnEmpty ? [{ value: pnRaw, cd: l2[42], edits: 0 }] : candidates(pnRaw, l2[42], pnDigits ? 'digits' : 'alnum', pnDigits ? v => /^\d+<*$/.test(v) : () => true, 2, hint.pn),
  };
  for (const k in C) { const h = C[k].find(c => c.viaViz); C[k] = C[k].slice(0, 8); if (h && !C[k].includes(h)) C[k].push(h); }
  const compOf = (d, b, e, p) => { const body = d.value + d.cd + nat + b.value + b.cd + (sexC || '<') + e.value + e.cd + p.value + p.cd; return [body, body.slice(0, 10) + body.slice(13, 20) + body.slice(21, 43)]; };
  // joint search: only combinations whose composite digit also matches; cheapest wins, must be unique (ties broken by printed values)
  const sols = [];
  for (const d of C.doc) for (const b of C.dob) for (const e of C.exp) for (const p of C.pn) {
    if (d.bad || b.bad || e.bad || p.bad) continue; const edits = d.edits + b.edits + e.edits + p.edits; if (edits > 3) continue;
    if (ok(compOf(d, b, e, p)[1], fin)) sols.push({ d, b, e, p, edits, hit: (d.value === hint.doc) + (b.value === hint.dob) + (e.value === hint.exp) + (p.value === hint.pn) });
  }
  sols.sort((x, y) => x.edits - y.edits || y.hit - x.hit);
  let pick = sols.length && (sols.length === 1 || sols[0].edits < sols[1].edits || sols[0].hit > sols[1].hit) ? sols[0] : null, compositeOk = !!pick, finFixed = false;
  const zero = { d: C.doc[0], b: C.dob[0], e: C.exp[0], p: C.pn[0] };
  if (!pick) {
    const allClean = Object.values(zero).every(c => c.edits === 0 && !c.bad);
    pick = { ...zero }; if (allClean) { compositeOk = true; finFixed = true; } // only the final digit was misread
  }
  const { d: doc, b: dob, e: exp, p: pn } = pick;
  const [body, comp] = compOf(doc, dob, exp, pn);
  const checks = {
    passportNo: ok(doc.value, doc.cd) || !!doc.cdFixed, dob: ok(dob.value, dob.cd) || !!dob.cdFixed, expiry: ok(exp.value, exp.cd) || !!exp.cdFixed,
    personalNo: pnEmpty || ok(pn.value, pn.cd) || !!pn.cdFixed, composite: compositeOk,
  };
  const repaired = [doc, dob, exp, pn].some(f => f.edits) || finFixed;
  const finDigit = compositeOk ? String(checkDigit(comp)) : l2[43];
  return {
    docType: l1[0] === 'P' ? 'Passport' : l1[0], issuer, surname, given,
    passportNo: doc.value.replace(/</g, ''), nationality: nat, dob: yymmdd(dob.value, 'dob'), sex: sexC, expiry: yymmdd(exp.value, 'exp'),
    personalNo: pn.value.replace(/</g, ''),
    mrz1: l1, mrz2: body + finDigit,
    checks, valid: Object.values(checks).every(Boolean), repaired,
  };
}

export function parseText(text, viz) {
  const p = findMrzLines(text);
  return p ? parseTD3(p[0], p[1], viz) : null;
}
