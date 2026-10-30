'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, '..', 'data');
const uploads = path.join(dataDir, 'uploads');

for (const name of ['app.db', 'app.db-wal', 'app.db-shm']) {
  fs.rmSync(path.join(dataDir, name), { force: true });
}
fs.rmSync(uploads, { recursive: true, force: true });
fs.mkdirSync(uploads, { recursive: true });

console.log('ล้างข้อมูลทั้งหมดเรียบร้อย');
console.log('รัน npm run seed เพื่อสร้างข้อมูลตัวอย่าง หรือ npm start เพื่อเริ่มใช้งานใหม่');
