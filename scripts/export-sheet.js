'use strict';

/* ส่งออกผลตรวจของใบกิจกรรมไปยัง Google Sheets (สร้างชีตใหม่หรืออัปเดตชีตเดิม)
 * ใช้: npm run export:sheet -- <activityId>
 */

const path = require('node:path');
const fs = require('node:fs');

const { buildActivityTabs } = require('../server/sheet-data');
const sheets = require('../server/sheets');
const sheetWebhook = require('../server/sheet-webhook');
const { db, get, run } = require('../server/db');

const now = () => new Date().toISOString();

async function main() {
  const activityId = Number(process.argv[2] || 0);
  if (!activityId) {
    console.error('ระบุรหัสใบกิจกรรม: npm run export:sheet -- 1');
    process.exit(1);
  }

  const tabs = buildActivityTabs(activityId);

  if (process.env.SHEET_WEBHOOK_URL) {
    const result = await sheetWebhook.pushToWebhook(
      process.env.SHEET_WEBHOOK_URL,
      process.env.SHEET_WEBHOOK_SECRET,
      tabs
    );
    console.log('ส่งข้อมูลไป Apps Script แล้ว:', (result.tabs || []).join(', '));
    console.log('ลิงก์:', result.url || process.env.SHEET_WEBHOOK_URL);
    db.close();
    return;
  }

  const creds = sheets.loadCredentials();
  if (!creds) {
    console.error('ไม่พบไฟล์คีย์: ' + sheets.credentialsPath());
    console.error('สร้าง Service Account แล้วดาวน์โหลด JSON มาวางที่ path นี้ก่อน');
    process.exit(1);
  }
  console.log('ใช้บัญชี:', creds.client_email);

  const token = await sheets.getAccessToken(creds);
  console.log('ได้ access token แล้ว');

  console.log('เตรียมแท็บ:', tabs.map((tab) => tab.title + '(' + (tab.values.length - 1) + ' แถว)').join(', '));

  const existing = get('SELECT * FROM sheet_exports WHERE activity_id = ?', activityId);
  let spreadsheetId;
  let url;
  let updated = false;

  if (existing) {
    spreadsheetId = existing.spreadsheet_id;
    url = existing.url;
    updated = true;
    await sheets.clearTabs(token, spreadsheetId, tabs.map((tab) => tab.title));
    console.log('อัปเดตชีตเดิม:', url);
  } else {
    const created = await sheets.createSpreadsheet(
      token,
      'ผลตรวจใบกิจกรรม ' + activityId,
      tabs.map((tab) => tab.title)
    );
    spreadsheetId = created.spreadsheetId;
    url = created.spreadsheetUrl;
    console.log('สร้างชีตใหม่:', url);
  }

  await sheets.writeTabs(token, spreadsheetId, tabs);
  await sheets.formatHeader(token, spreadsheetId, tabs);

  const shareWith = process.env.GOOGLE_SHARE_WITH;
  if (shareWith) {
    await sheets.shareWith(token, spreadsheetId, shareWith);
    console.log('แชร์ให้:', shareWith);
  }

  run(
    `INSERT INTO sheet_exports (activity_id, spreadsheet_id, url, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(activity_id) DO UPDATE SET
       spreadsheet_id = excluded.spreadsheet_id,
       url = excluded.url,
       created_at = excluded.created_at`,
    activityId,
    spreadsheetId,
    url,
    now()
  );
  db.close();

  console.log(updated ? 'อัปเดตเรียบร้อย' : 'สร้างเรียบร้อย');
  console.log('ลิงก์:', url);
}

main().catch((error) => {
  console.error('ผิดพลาด:', error.message);
  process.exit(1);
});
