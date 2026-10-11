/* Name repair for MRZ line 1. The "<" filler is often misread as K / C / S / L, which glues names together
   ("YASER<ALI" → "YASERCALI"). A lexicon of common Arabic / Bahraini names lets us split such tokens back apart,
   and flag names that still look garbled. Segmentation is only accepted when it needs junk separators (so legitimate
   compounds like ALKHALIFA are never split) and covers ≥ 80 % of the letters. */
const MALE = `ABDULLA ABDULLAH ABDULRAHMAN ABDULAZIZ ABDULKARIM ABDULLATIF ABDULHUSAIN ABDULHUSSAIN ABDULREDHA ABDULRIDHA ABDULJALIL ABDULNABI ABDULGHANI ABDULMAJEED ABDULWAHAB ABDULSALAM ABDULHAMEED ABDULMOHSEN ABDULHADI ABDULRASOOL ABDULAMIR ABDULMALIK ABDULKHALEQ ABDULRAZAQ ABDULQADER
AHMED AHMAD ALI HASAN HASSAN HUSSAIN HUSAIN HUSSEIN HUSEIN MOHAMMED MOHAMED MUHAMMAD MOHAMMAD MAHMOOD MAHMOUD EBRAHIM IBRAHIM ISMAIL YOUSIF YOUSUF YUSUF YUSIF YOUSEF JASIM JASSIM KHALID KHALED KHALIL KHALIFA SALMAN SALEH SALEM SALIM SAEED SAID SAYED SAYYED SAYID NASSER NASER NASIR NABEEL NADER HAMAD HAMZA HAMID HAMEED HAMDAN FAISAL FAHAD FAWAZ FARHAN FARES TALAL TARIQ TAREQ TAMER JAFFAR JAAFAR JAFAR JAWAD JAMAL JAMEEL HISHAM HASHIM HADI HAIDER HAYDER HUMOOD ISA ESA ISSA IYAD IMAD IMRAN OMAR UMAR OSAMA OTHMAN MAJID MAJED MANSOOR MANSOUR MARWAN MAZEN MAHDI MUSTAFA MUSA MOOSA MURTADHA MUBARAK MUNEER MUNIR MUHSIN MOHSEN MOHSIN RASHID RASHEED RAMADHAN RAMADAN RAYAN RIYADH RIDHA REDHA RADHI SAAD SAMI SAMIR SULTAN SULAIMAN SULAYMAN SUHAIL SAUD SHAKER SHAKIR SHEIKH SHAIKH TAHA THAMER YASER YASSER YAQOOB YAQOUB YAHYA ZAYED ZAID ZAKARIYA ZAKI ZIYAD ZUHAIR ADEL ADIL ALAWI AMER AMIR AMEER ANWAR ANAS AYMAN AZIZ BADER BADR BASSAM BASEL BILAL DAWOOD EMAD ESSA FADHEL FADHIL FAYEZ FOUAD GHAZI HABIB HAFEDH HAMOOD HANI HARITH HATEM HAZEM HUMAID IHSAN JABER JABR KAMAL KARIM KAZEM KAZIM LUAY LUTFI MAAN MADI MAHER MALIK MALEK MISHAL MOATH MOHANNA MOSTAFA MUAATH MUAYAD MUHANNAD NAWAF NAYEF NIZAR NOOR NOUR QASIM QASSIM QAIS RAED RAMI RASHAD REDA RIAD SAFWAN SALAH SAMER SHADI SIRAJ TAWFEEQ TURKI WALEED WALID WASEEM WASIM YAZEED YAZID ZAHER ZAKARIA ZEYAD AQEEL HUSSAIN MAHMOOD EYAD ASEEL`;
const FEMALE = `AQEELA FATIMA FATEMA FATIMAH FATHIYA ZAINAB ZAHRA ZAHRAA MARYAM MARIAM KHADIJA KHADEEJA KHADIJAH AISHA AYSHA AESHA SARA SARAH SAMIRA SUMAYA SHAIMA SHAIMAA SHAYMA HAJAR HAJER HANAN HANAA HESSA HISSA HUDA HAWRA HAWRAA LAILA LAYLA LAMEES LAMIS LATIFA LATEEFA LUBNA MAHA MONA MUNA NADIA NADA NAJLA NAWAL NORA NOURA NOURAH RAWAN REEM RANA RANIA RAGHAD RUQAYA RUQAYYA SAFIYA SALWA SANA SAWSAN SHEMA SHAMS SHAHD SUHA SUAD SUSAN TAHANI THURAYA WAFA WAFAA WIDAD YASMIN YASMEEN ZAKIA AMAL AMNA AMINA AMEENA ASMA ASMAA ALAA ABEER AFAF AHLAM ALIA ALIYA AMANI AREEJ ARWA ASRAR BASMA BATOOL BUTHAINA DALAL DANA DEEMA DINA DOAA DUAA ENAS EMAN ESRAA FARAH FARIDA GHADA GHALIA HALA HAIFA HAYAT HEBA HIBA HIND HOUDA IMAN INAS ISRAA JAMILA JANA JOUD JUMANA KAWTHAR KHAWLA LINA LUJAIN LAMA LEENA MADIHA MAJDA MALAK MANAL MANAR MARAM MAYSA MAISA MUNIRA NABILA NAGHAM NAHLA NAILA NAJAT NASRIN NASREEN NAZIHA NESREEN NUHA RABAB RAJAA RAMLA RASHA RAZAN RIHAM RIMA RUBA SABAH SAFA SAHAR SAKINA SALMA SAMAR SEHAM SHAHAD SHAIKHA SHOROOQ SHURUQ SOMAYA TASNEEM TUQA UMAIMA WADHA WAJIHA WARDA YARA YUSRA ZAHIRA ZAINA ZEINAB ZEINA`;
const FAMILY = `AL EL BIN BINT ABU UMM ALKHALIFA ALKHALIFAH ALMUSALLAM ALHAYKY ALHAJERI ALSAYED ALSAYID ALMANNAI ALZAYANI ALJALAHMA ALDOSERI ALMAHROOS ALAALI ALSHAIKH ALSAEED ALMUBARAK ALNAJJAR ALHADDAD ALSHEHABI ALBINALI ALSHAMMARI ALKOOHEJI ALAWADHI SELAIL ALASFOOR ALKAABI ALNOAIMI ALTAJIR ALMOAYYED ALMAHMOOD ALSALMAN ALHUSAIN ALMOOSA ALAMER ALBASTAKI`;
export const NAMES = new Set(`${MALE} ${FEMALE} ${FAMILY}`.split(/\s+/).filter(Boolean));
const JUNK = /[KCSL]/;

/** split a fused token into lexicon names separated by single junk letters; null when it doesn't work */
export function segment(tok) {
  const n = tok.length, B = [Array(n + 1).fill(null), Array(n + 1).fill(null)]; // B[s][i]: best parse of tok[0..i) with (s=1) / without (s=0) a junk separator used
  B[0][0] = { cov: 0, words: [], seps: 0 };
  const words = [...NAMES].filter(w => w.length >= 3), put = (s, i, c) => { if (!B[s][i] || c.cov > B[s][i].cov) B[s][i] = c; };
  for (let i = 0; i < n; i++) for (const s of [0, 1]) {
    const b = B[s][i]; if (!b) continue;
    for (const w of words) { // lexicon word at i (one substitution allowed in words of 6+ letters)
      if (i + w.length > n) continue; let d = 0; for (let k = 0; k < w.length && d < 2; k++) if (tok[i + k] !== w[k]) d++;
      if (d > (w.length >= 6 ? 1 : 0)) continue;
      put(s, i + w.length, { cov: b.cov + w.length - d * 0.5, words: [...b.words, w], seps: b.seps });
    }
    if (b.words.length && JUNK.test(tok[i]) && !JUNK.test(tok[i - 1] || '')) put(1, i + 1, { ...b, seps: b.seps + 1 }); // a single junk letter between two names
  }
  const fin = [];
  for (let i = 0; i <= n; i++) { const x = B[1][i]; if (x && x.words.length >= 2 && n - i <= 4 && x.cov >= 0.8 * n && [...tok.slice(i)].every(ch => JUNK.test(ch))) fin.push(x); }
  fin.sort((a, b) => b.cov - a.cov); return fin[0] ? fin[0].words : null;
}

/** tokens → repaired tokens + garbled flag */
export function repairTokens(tokens) {
  let changed = false, garbled = false; const out = [];
  for (const t of tokens) {
    if (/^[KCSL]$/.test(t)) garbled = true; // a lone K/C/S/L is a misread filler far more often than a real initial
    if (NAMES.has(t) || t.length <= 2) { out.push(t); continue; }
    const seg = segment(t);
    if (seg) { out.push(...seg); changed = true; continue; }
    const c = t.replace(/^[KC](?=[A-Z]{4,})/, '').replace(/[KCL]{3,}$/, '');
    const u = c !== t && c.length >= 3 ? c : t; if (u !== t) changed = true;
    if (u.length >= 13 || /^[KCSL]$/.test(u)) garbled = true; // an unsplittable 13+ letter run is almost certainly glued names
    out.push(u);
  }
  return { tokens: out, changed, garbled };
}
