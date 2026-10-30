'use strict';

/* ส่งข้อมูลไปยัง Apps Script Web App (ทางเลือกที่ไม่ต้องใช้ service account)
 * ตั้งค่าได้ 2 ทาง: env (SHEET_WEBHOOK_URL / SHEET_WEBHOOK_SECRET)
 * หรือไฟล์ data/sheet-webhook.json { "url": "...", "secret": "..." }
 */

const fs = require('node:fs');
const path = require('node:path');

const { DATA_DIR } = require('./db');

function loadConfig() {
  const url = process.env.SHEET_WEBHOOK_URL;
  const secret = process.env.SHEET_WEBHOOK_SECRET;
  if (url) return { url, secret };

  try {
    const file = path.join(DATA_DIR, 'sheet-webhook.json');
    if (fs.existsSync(file)) {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (json && json.url) return { url: json.url, secret: json.secret || '' };
    }
  } catch (error) {
    console.warn('[sheet-webhook] อ่าน config ไม่ได้:', error.message);
  }
  return null;
}

async function pushToWebhook(url, secret, tabs) {
  if (!url) throw new Error('ยังไม่ได้ตั้งค่า SHEET_WEBHOOK_URL');
  if (!secret) throw new Error('ยังไม่ได้ตั้งค่า SHEET_WEBHOOK_SECRET');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, tabs }),
    redirect: 'follow',
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    json = null;
  }

  if (!response.ok) {
    throw new Error('Apps Script ตอบกลับ ' + response.status + ': ' + text.slice(0, 160));
  }
  if (!json) {
    throw new Error('Apps Script ตอบกลับไม่ใช่ JSON (อาจยังไม่ได้ Deploy เป็น Web app)');
  }
  if (!json.ok) {
    throw new Error('Apps Script ปฏิเสธคำขอ: ' + (json.error || 'ไม่ทราบสาเหตุ'));
  }
  return json;
}

module.exports = { loadConfig, pushToWebhook };
