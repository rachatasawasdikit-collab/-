'use strict';

/*
 * สร้างโฟลเดอร์ docs/ สำหรับ GitHub Pages
 * - คัดลอก public/app.js และ public/styles.css
 * - แปลง index.html ให้ใช้ path แบบ relative (Pages เสิร์ฟใต้ /<repo>/)
 * - แทรก demo-api.js ก่อน app.js เพื่อดัก /api/* ทั้งหมด
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const DEMO = path.join(ROOT, 'demo');
const OUT = path.join(ROOT, 'docs');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const file of ['app.js', 'styles.css']) {
  fs.copyFileSync(path.join(SRC, file), path.join(OUT, file));
}
fs.copyFileSync(path.join(DEMO, 'demo-api.js'), path.join(OUT, 'demo-api.js'));
fs.copyFileSync(path.join(DEMO, 'bridge.js'), path.join(OUT, 'bridge.js'));

const buildVersion = String(Date.now());
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

html = html
  .replace('href="/styles.css"', 'href="styles.css?v=' + buildVersion + '"')
  .replace(
    '<script src="/app.js" defer></script>',
    '<script src="demo-api.js?v=' + buildVersion + '" defer></script>\n    <script src="bridge.js?v=' + buildVersion + '" defer></script>\n    <script src="app.js?v=' + buildVersion + '" defer></script>'
  )
  .replace('<title>', '<title>สาธิต · ');

if (html.includes('/styles.css') || html.includes('/app.js')) {
  throw new Error('index.html ยังมี absolute path ที่แปลงไม่ได้');
}

fs.writeFileSync(path.join(OUT, 'index.html'), html);
const apiBase = String(process.env.API_BASE || '').replace(/\/+$/, '');
if (apiBase) {
  fs.writeFileSync(path.join(OUT, 'config.json'), JSON.stringify({ api: apiBase }, null, 2) + '\n');
}

fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const files = fs.readdirSync(OUT);
console.log('docs/ พร้อมใช้งาน:');
for (const file of files) {
  console.log('  -', file, fs.statSync(path.join(OUT, file)).size, 'bytes');
}
