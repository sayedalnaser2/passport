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
// real Bahraini MRZ formats: ordinary (7-digit number, "<<" filler) and diplomatic (PD, letter + 7 digits)
r = parseTD3('P<BHRALI<<AQEELA<ABDULLA<EBRAHIM<AHMED<<<<<<', '2676812<<0BHR9504028F2707026950400556<<<<<26'); assert(r.valid && r.docTypeCode === 'P' && r.passportNo === '2676812' && r.sex === 'F' && r.personalNo === '950400556');
r = parseTD3('PDBHRALHAYKY<<YUSUF<AHMED<A<<<<<<<<<<<<<<<<<<', 'D0001863<3BHR2501154M3002027250112108<<<<<66'); assert(r.valid && r.docTypeCode === 'PD' && r.passportNo === 'D0001863' && r.surname === 'ALHAYKY' && r.given === 'YUSUF AHMED A');
r = parseTD3('DBHRSELAIL<<ASEEL<YASER<ALI<<<<<<<<<<<<<<<<<', 'D0001640<8BHR1206050F2906254120602415<<<<<32'); assert(r.docTypeCode === 'PD' && r.surname === 'SELAIL'); // lost "P"
import { repairTokens } from '../names.js';
assert.deepEqual(repairTokens(['SHAIMAKYASER', 'ALI']).tokens, ['SHAIMA', 'YASER', 'ALI']);
assert.deepEqual(repairTokens(['ALKHALIFA']).tokens, ['ALKHALIFA']); // legitimate compounds are never split
assert(repairTokens(['ALICCAQEELACABDULLACEBRAMIRSANMED']).garbled);
import { parsePrinted } from '../viz.js';
const cell = (t, x0, y0, x1, y1) => ({ text: t, x0, y0, x1, y1 });
const pp = parsePrinted([cell('24.02.2014', 0, 0, 1, 1), cell('26.06.2024', 0, 1, 1, 2), cell('25.06.2029', 0, 2, 1, 3), cell('D0001642', 0, 3, 1, 4), cell('140211403', 0, 4, 1, 5), cell('NAME SHAIMA YASER ALI SELAIL', 0, 5, 1, 6), cell('Aiba MANAWA', 0, 6, 1, 7)]);
assert.equal(pp.dob, '2014-02-24'); assert.equal(pp.issue, '2024-06-26'); assert.equal(pp.expiry, '2029-06-25'); assert.equal(pp.passportNo, 'D0001642'); assert.equal(pp.personalNo, '140211403'); assert.equal(pp.pob, 'MANAMA'); assert.equal(pp.fullName, 'SHAIMA YASER ALI SELAIL');
console.log('all ok');
