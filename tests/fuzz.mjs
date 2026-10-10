// node tests/fuzz.mjs — OCR-confusion fuzz: repairs must never silently produce a wrong value
import {parseTD3,checkDigit as cd} from '../mrz.js';
const mk=(sur,giv,no,dob,sex,exp,cpr)=>{const l1=('P<BHR'+sur+'<<'+giv.replace(/ /g,'<')).padEnd(44,'<');const d=no.padEnd(9,'<'),pn=cpr.padEnd(14,'<');let l2=d+cd(d)+'BHR'+dob+cd(dob)+sex+exp+cd(exp)+pn+cd(pn);l2+=cd(l2.slice(0,10)+l2.slice(13,20)+l2.slice(21,43));return [l1,l2]};
const [l1,l2]=mk('ALNASER','SAYED AHMED','A1234567','900315','M','310422','123456789');
const conf={'0':'OQD','1':'IL','2':'Z','5':'S','6':'G','8':'B','7':'T','<':'K','A':'4','4':'A'};
let seed=7;const R=()=>(seed=seed*16807%2147483647)/2147483647;
for(const K of [1,2,3]){let valid=0,wrong=0,N=2000;
 for(let t=0;t<N;t++){let a=[...l2];const idx=[...a.keys()].filter(i=>conf[a[i]]);const used=new Set();
  for(let i=0;i<K;i++){let p;do{p=idx[Math.floor(R()*idx.length)]}while(used.has(p));used.add(p);const c=conf[a[p]];a[p]=c[Math.floor(R()*c.length)];}
  const r=parseTD3(l1,a.join(''));
  if(r.valid){valid++;if(r.passportNo!=='A1234567'||r.dob!=='1990-03-15'||r.expiry!=='2031-04-22'||r.personalNo!=='123456789')wrong++;}}
 console.log('confusion errors',K,{N,valid,wrong}); if(wrong>0&&K<3) throw new Error('silent mis-repair'); if(valid<N*.95) throw new Error('repair rate too low');}

