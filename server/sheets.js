'use strict';

/*
 * Google Sheets แบบไม่พึ่งไลบรารีภายนอก
 * ใช้ Service Account (JWT RS256) → OAuth2 token → Sheets API v4 / Drive API v3
 *
 * ไฟล์คีย์: data/google-service-account.json
 * หรือกำหนดผ่าน env GOOGLE_APPLICATION_CREDENTIALS
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { DATA_DIR } = require('./db');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
].join(' ');

function credentialsPath() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }
  return path.join(DATA_DIR, 'google-service-account.json');
}

function loadCredentials() {
  const file = credentialsPath();
  if (!fs.existsSync(file)) return null;
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error('อ่านไฟล์ service account ไม่ได้: ' + file);
  }
  if (!json.client_email || !json.private_key) {
    throw new Error('ไฟล์ service account ไม่ครบ ต้องมี client_email และ private_key');
  }
  return json;
}

const b64url = (input) =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function signJwt(creds, nowSeconds) {
  const now = nowSeconds || Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: creds.client_email,
    scope: SCOPES,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const payload = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claim));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(payload), creds.private_key);
  return payload + '.' + b64url(signature);
}

async function getAccessToken(creds) {
  const assertion = signJwt(creds);
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  const text = await response.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error('ขอ token จาก Google ไม่สำเร็จ (ตอบกลับไม่ใช่ JSON)');
  }
  if (!response.ok) {
    const detail = json.error_description || json.error || text.slice(0, 200);
    throw new Error('ขอ token จาก Google ไม่สำเร็จ: ' + detail);
  }
  return json.access_token;
}

async function googleApi(token, url, options) {
  const init = Object.assign({}, options);
  init.headers = Object.assign(
    { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    (options && options.headers) || {}
  );
  const response = await fetch(url, init);
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (error) {
    json = {};
  }
  if (!response.ok) {
    const detail = (json.error && (json.error.message || json.error.status)) || text.slice(0, 200);
    throw new Error('Google API ตอบกลับ ' + response.status + ': ' + detail);
  }
  return json;
}

async function createSpreadsheet(token, title, tabTitles) {
  const body = {
    properties: { title, locale: 'th_TH' },
    sheets: tabTitles.map((name) => ({
      properties: { title: name, gridProperties: { frozenRowCount: 1 } },
    })),
  };
  return googleApi(token, 'https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function getSheetIds(token, spreadsheetId) {
  const data = await googleApi(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    {}
  );
  const map = new Map();
  for (const sheet of data.sheets || []) {
    map.set(sheet.properties.title, sheet.properties.sheetId);
  }
  return map;
}

async function clearTabs(token, spreadsheetId, tabTitles) {
  const requests = tabTitles.map((name) => ({
    updateCells: {
      range: { sheetId: undefined, startRowIndex: 0, endRowIndex: 1000 },
      fields: 'userEnteredValue',
    },
  }));
  // ใช้ values.clear แยกต่อแท็บแทน (แม่นกว่าและไม่ต้องรู้ sheetId)
  for (const name of tabTitles) {
    await googleApi(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
        name
      )}!A:Z:clear`,
      { method: 'POST', body: '{}' }
    );
  }
  return requests.length ? undefined : undefined;
}

async function writeTabs(token, spreadsheetId, tabs) {
  const data = tabs.map((tab) => ({
    range: `${tab.title}!A1`,
    majorDimension: 'ROWS',
    values: tab.values,
  }));
  return googleApi(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
    }
  );
}

async function formatHeader(token, spreadsheetId, tabs) {
  try {
    const ids = await getSheetIds(token, spreadsheetId);
    const requests = [];
    for (const tab of tabs) {
      const sheetId = ids.get(tab.title);
      if (sheetId === undefined) continue;
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              backgroundColor: { red: 0.055, green: 0.42, blue: 0.357 },
            },
          },
          fields: 'userEnteredFormat(textFormat,backgroundColor)',
        },
      });
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount',
        },
      });
    }
    if (!requests.length) return null;
    return await googleApi(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      { method: 'POST', body: JSON.stringify({ requests }) }
    );
  } catch (error) {
    // การจัดรูปแบบเป็นของแถม — ถ้าพลาดก็ยังได้ข้อมูล
    console.warn('[sheets] format skipped:', error.message);
    return null;
  }
}

async function shareWith(token, spreadsheetId, email) {
  return googleApi(
    token,
    `https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions?sendNotificationEmail=false`,
    {
      method: 'POST',
      body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
    }
  );
}

module.exports = {
  credentialsPath,
  loadCredentials,
  signJwt,
  getAccessToken,
  createSpreadsheet,
  getSheetIds,
  clearTabs,
  writeTabs,
  formatHeader,
  shareWith,
};
