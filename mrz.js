/* ICAO 9303 TD3 (passport) MRZ parser, tuned for Bahraini passports (issuer/nationality BHR).
   Works on raw OCR text: finds the two MRZ lines, repairs typical OCR confusions, verifies check digits. */

const W = [7, 3, 1];
const val = c => c === '<' ? 0 : c >= '0' && c <= '9' ? +c : c >= 'A' && c <= 'Z' ? c.charCodeAt(0) - 55 : NaN;
export const checkDigit = s => { let t = 0; for (let i = 0; i < s.length; i++) t += val(s[i]) * W[i % 3]; return t % 10; };
const ok = (s, d) => d >= '0' && d <= '9' && checkDigit(s) === +d;

const TO_DIGIT = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };
const TO_ALPHA = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 8: 'B', 6: 'G' };
const dig = s => [...s].map(c => TO_DIGIT[c] || c).join('');
const alp = s => [...s].map(c => TO_ALPHA[c] || c).join('');

export function clean(line) {
  return line.toUpperCase().replace(/[«‹]/g, '<').replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, '<');
}

/** Pull candidate MRZ line pairs out of OCR text. */
export function findMrzLines(text) {
  const lines = text.split(/\r?\n/).map(clean).filter(l => l.length >= 30 && (l.match(/</g) || []).length >= 2 || l.length >= 40);
  // best pair = consecutive lines, first starting with P, second containing BHR/digits
  let best = null;
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i], b = lines[i + 1]; let score = 0;
    if (a[0] === 'P') score += 2; if (a.slice(2, 5) === 'BHR') score += 2; if (/^[A-Z0-9<]{9}[0-9]BHR/.test(b)) score += 3;
    score += Math.min(a.length, 44) / 44 + Math.min(b.length, 44) / 44;
    if (!best || score > best.score) best = { score, l1: a, l2: b };
  }
  return best && best.score >= 3 ? [best.l1, best.l2] : null;
}

function fixLen(l, n = 44) { return l.length >= n ? l.slice(0, n) : l + '<'.repeat(n - l.length); }

const yymmdd = (s, kind) => {
  if (!/^\d{6}$/.test(s)) return { raw: s, iso: '' };
  let y = +s.slice(0, 2); const m = s.slice(2, 4), d = s.slice(4, 6), cur = new Date().getFullYear() % 100;
  y = kind === 'dob' ? (y > cur ? 1900 + y : 2000 + y) : (y > cur + 30 ? 1900 + y : 2000 + y);
  const iso = `${y}-${m}-${d}`, dt = new Date(iso + 'T00:00:00Z');
  return { raw: s, iso: isNaN(dt) || dt.getUTCMonth() + 1 !== +m ? '' : iso };
};
export const dmy = iso => iso ? iso.split('-').reverse().join('/') : '';

/** Parse two MRZ lines. Returns record + validity info. */
export function parseTD3(r1, r2) {
  let l1 = fixLen(clean(r1)), l2 = fixLen(clean(r2));
  // line 1: trailing filler often misread as K / C / L
  l1 = l1.replace(/<[<KCLI1]{3,}$/, m => '<'.repeat(m.length));
  const docType = l1[0], issuer = alp(l1.slice(2, 5)), nameField = l1.slice(5);
  const [sur, ...giv] = nameField.replace(/<+$/, '').split('<<');
  const surname = (sur || '').replace(/</g, ' ').trim();
  const given = giv.join(' ').replace(/</g, ' ').trim();

  const docNo = l2.slice(0, 9), docCd = dig(l2[9]);
  const nat = alp(l2.slice(10, 13));
  const dob = dig(l2.slice(13, 19)), dobCd = dig(l2[19]);
  const sex = l2[20] === 'M' || l2[20] === 'F' ? l2[20] : '';
  const exp = dig(l2.slice(21, 27)), expCd = dig(l2[27]);
  const pn = l2.slice(28, 42), pnCd = dig(l2[42]), finCd = dig(l2[43]);
    const compositeFixed = docNo + docCd + nat + dob + dobCd + l2[20] + exp + expCd + pn + pnCd;

  const checks = {
    passportNo: ok(docNo, docCd), dob: ok(dob, dobCd), expiry: ok(exp, expCd),
    personalNo: pn.replace(/</g, '') === '' ? true : ok(pn, pnCd),
    composite: ok(l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43), finCd) || ok(compositeFixed.slice(0, 10) + compositeFixed.slice(13, 20) + compositeFixed.slice(21, 43), finCd),
  };
  const d1 = yymmdd(dob, 'dob'), d2 = yymmdd(exp, 'exp');
  return {
    docType: docType === 'P' ? 'Passport' : docType, issuer, surname, given,
    passportNo: docNo.replace(/</g, ''), nationality: nat, dob: d1.iso, sex, expiry: d2.iso,
    personalNo: pn.replace(/</g, ''), // Bahrain: CPR / national ID number
    mrz1: l1, mrz2: compositeFixed + finCd,
    checks, valid: Object.values(checks).every(Boolean),
  };
}

export function parseText(text) {
  const p = findMrzLines(text);
  return p ? parseTD3(p[0], p[1]) : null;
}
