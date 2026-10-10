// node tests/mrz.test.mjs  — parser/repair/VIZ sanity checks
import assert from 'node:assert';
import { parseTD3, checkDigit as cd, voteLines } from '../mrz.js';
import { parseViz, parseVizDate } from '../viz.js';
const l1 = 'P<BHRALNASER<<SAYED<AHMED'.padEnd(44, '<');
const doc = 'A1234567<', dob = '900315', exp = '310422', pn = '123456789<<<<<';
let l2 = doc + cd(doc) + 'BHR' + dob + cd(dob) + 'M' + exp + cd(exp) + pn + cd(pn); l2 += cd(l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43));
let r = parseTD3(l1, l2); assert(r.valid && r.surname === 'ALNASER' && r.given === 'SAYED AHMED' && r.dob === '1990-03-15' && r.personalNo === '123456789');
r = parseTD3(l1, l2.replace('900315', '9OO315')); assert(r.valid && r.dob === '1990-03-15');
r = parseTD3(l1, l2.replace('A1234567', 'A123456T')); assert(r.valid && r.passportNo === 'A1234567');
r = parseTD3(l1, l2.replace('123456789', '123456389'), { personalNo: '123456789' }); assert(r.valid && r.personalNo === '123456789');
r = parseTD3(l1.replace(/<{3,}$/, '<<<<KLLLL LLL'), l2); assert(r.given === 'SAYED AHMED');
assert.equal(voteLines([l2.replace('A1', 'AI'), l2, l2.replace('M3', 'H3')]), l2);
assert.equal(parseVizDate('22 APR | APR 2021'), '2021-04-22'); assert.equal(parseVizDate('15/03/1990'), '1990-03-15');
const c = (t, x0, y0, x1, y1) => ({ text: t, x0, y0, x1, y1 });
assert.deepEqual(parseViz([c('Sex /', 420, 480, 500, 502), c('Place of Birth /', 920, 480, 1100, 502), c('M', 420, 508, 440, 540), c('MANAMA', 920, 508, 1050, 540)]).fields, { sex: 'M', pob: 'MANAMA' });
console.log('all ok');
