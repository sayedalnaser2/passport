// node tests/run_samples.js [samples-dir]   — runs the real page in headless Chromium over samples/*.png|jpg|pdf and
// compares with samples/answers.json (same file names). Samples are git-ignored (personal data).
const fs = require('fs'), path = require('path'), http = require('http'), { execSync } = require('child_process');
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
const root = path.resolve(__dirname, '..'), dir = path.resolve(process.argv[2] || path.join(root, 'samples'));
const answers = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'));
const files = Object.keys(answers).filter(f => fs.existsSync(path.join(dir, f)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); fs.readFile(f, (e, d) => e ? (r.writeHead(404), r.end()) : (r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }), r.end(d))); }).listen(0);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const p = await b.newPage(); await p.goto(`http://localhost:${srv.address().port}/index.html`);
  await p.setInputFiles('#file', files.map(f => path.join(dir, f)));
  await p.waitForFunction(n => document.querySelectorAll('#sheet tbody tr').length == n && !document.querySelector('#sheet tr.pending'), files.length, { timeout: 900000 });
  const res = await p.evaluate(() => __passportRows.map(r => ({ file: r.file, rec: r.rec, log: r.log })));
  let ok = 0, tot = 0;
  for (const r of res) {
    const exp = answers[r.file], bad = []; const rec = r.rec || {};
    for (const [k, v] of Object.entries(exp)) { tot++; if ((rec[k] || '') === v) ok++; else bad.push(`${k}: got "${rec[k] || ''}" want "${v}"`); }
    console.log(`${bad.length ? 'FAIL' : 'PASS'} ${r.file} [${rec.valid ? 'MRZ✔' : 'MRZ✗'}${rec.mismatch && rec.mismatch.length ? ' ≈' : ''}]`, bad.length ? '\n   ' + bad.join('\n   ') : '');
    if (process.env.LOG && bad.length) console.log(r.log.join('\n'));
  }
  console.log(`${ok}/${tot} fields correct`); await b.close(); srv.close(); process.exit(ok === tot ? 0 : 1);
})();
