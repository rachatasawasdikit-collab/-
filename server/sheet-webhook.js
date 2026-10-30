'use strict';

/* ส่งข้อมูลไปยัง Apps Script Web App (ทางเลือกที่ไม่ต้องใช้ service account) */

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

module.exports = { pushToWebhook };
