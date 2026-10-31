/*
 * bridge.js — เชื่อมหน้าเว็บ (GitHub Pages) เข้ากับ backend
 *
 * รองรับ 2 แบบ:
 *  1. Google Apps Script Web App (โหมด apps-script) — ใช้ Google Sheets เป็นฐานข้อมูล
 *     เรียกด้วย simple request (GET/POST text/plain) เพื่อไม่ให้ติด CORS preflight
 *  2. เซิร์ฟเวอร์ Node ในโปรเจกต์ (โหมด server) — ใช้ Bearer token
 *
 * ถ้าไม่ได้ตั้งค่า API จะใช้ข้อมูลจำลองในเบราว์เซอร์ (demo-api.js) ตามเดิม
 * ตั้งค่าได้ 3 ทาง: config.json, ปุ่มมุมล่างซ้าย, หรือ query string ?api=...
 */
(function () {
  'use strict';

  const BASE_KEY = 'activity-api-base';
  const MODE_KEY = 'activity-api-mode';
  const TOKEN_KEY = 'activity-api-token';

  /* เก็บ token ไว้ใน localStorage เพื่อให้ล็อกอินค้างไว้ได้ 30 วัน
     (อ่าน sessionStorage เดิมด้วย เผื่อผู้ใช้เคยล็อกอินไว้ก่อนอัปเดต) */
  function readToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '';
    } catch (error) {
      return sessionStorage.getItem(TOKEN_KEY) || '';
    }
  }

  function saveToken(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch (error) {
      sessionStorage.setItem(TOKEN_KEY, token);
    }
    sessionStorage.removeItem(TOKEN_KEY);
  }

  function clearToken() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch (error) {
      /* ignore */
    }
    sessionStorage.removeItem(TOKEN_KEY);
  }

  const nativeFetch = (window.__demoRealFetch || window.fetch).bind(window);
  const previousFetch = window.fetch.bind(window);

  const params = new URLSearchParams(window.location.search);
  if (params.get('api')) {
    const api = params.get('api').replace(/\/+$/, '');
    localStorage.setItem(BASE_KEY, api);
    localStorage.setItem(MODE_KEY, isScriptUrl(api) ? 'apps-script' : 'server');
    params.delete('api');
    const left = params.toString();
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (left ? '?' + left : '') + window.location.hash
    );
  }

  function isScriptUrl(url) {
    return /^https:\/\/script\.google\.com\//.test(String(url || ''));
  }

  function readBase() {
    return (localStorage.getItem(BASE_KEY) || '').replace(/\/+$/, '');
  }

  function readMode() {
    const stored = localStorage.getItem(MODE_KEY) || '';
    if (stored) return stored;
    return isScriptUrl(readBase()) ? 'apps-script' : 'server';
  }

  let base = readBase();
  let mode = readMode();
  let configPromise = null;

  const isScript = () => mode === 'apps-script';

  const loadFromConfig = async () => {
    try {
      const response = await nativeFetch('config.json', { cache: 'no-store' });
      if (!response.ok) return;
      const json = await response.json();
      if (json && json.api) {
        base = String(json.api).replace(/\/+$/, '');
        mode = json.mode || (isScriptUrl(base) ? 'apps-script' : 'server');
        localStorage.setItem(BASE_KEY, base);
        localStorage.setItem(MODE_KEY, mode);
      }
    } catch (error) {
      /* ไม่มี config.json ก็ใช้โหมดสาธิตต่อ */
    }
  };

  async function checkStoredBase() {
    try {
      if (isScript()) {
        const response = await nativeFetch(
          base + '?path=' + encodeURIComponent('/api/health'),
          { cache: 'no-store', redirect: 'follow' }
        );
        if (!response.ok) throw new Error('bad status');
        const json = await response.json();
        if (json && json.status === 200) return;
        throw new Error('bad payload');
      }
      const response = await nativeFetch(base + '/api/health', {
        cache: 'no-store',
        mode: 'cors',
        signal: AbortSignal.timeout(4000),
      });
      if (response.ok) return;
      throw new Error('bad status');
    } catch (error) {
      base = '';
      localStorage.removeItem(BASE_KEY);
      localStorage.removeItem(MODE_KEY);
      await loadFromConfig();
    }
  }

  if (!base) {
    configPromise = loadFromConfig();
  } else {
    configPromise = checkStoredBase();
  }

  async function ready() {
    if (configPromise) {
      await configPromise;
      configPromise = null;
      paintBadge();
    }
  }

  /* ----------------------------- helpers ----------------------------- */

  function pathOf(input) {
    const raw = typeof input === 'string' ? input : input && input.url ? input.url : '';
    try {
      const url = new URL(raw, window.location.href);
      const match = url.pathname.match(/\/api\/.*$/);
      return match ? match[0] : null;
    } catch (error) {
      return null;
    }
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function base64ToBlob(value, mimeType) {
    return new Blob([base64ToBytes(value)], {
      type: mimeType || 'application/octet-stream',
    });
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
      reader.readAsDataURL(file);
    });
  }

  async function formDataPayload(formData) {
    const fields = {};
    let file = null;
    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') {
        fields[key] = value;
        continue;
      }
      if (!value || !value.size) continue;
      file = {
        name: value.name || 'activity-file',
        mimeType: value.type || 'application/octet-stream',
        data: await fileToBase64(value),
      };
    }
    return { fields: fields, file: file };
  }

  function parseJsonResponse(text) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(
        'Apps Script ตอบกลับไม่ใช่ JSON — ตรวจสอบว่า Deploy เป็น Web app และตั้ง Who has access = Anyone'
      );
    }
  }

  /* ------------------------ Apps Script protocol --------------------- */

  async function scriptRequest(path, method, body, file) {
    const token = readToken();

    if (method === 'GET') {
      const url =
        base +
        '?path=' +
        encodeURIComponent(path) +
        (token ? '&token=' + encodeURIComponent(token) : '');
      const response = await nativeFetch(url, {
        cache: 'no-store',
        redirect: 'follow',
      });
      return parseJsonResponse(await response.text());
    }

    const payload = {
      path: path,
      method: method,
      token: token,
      body: body || {},
    };
    if (file) payload.file = file;

    const response = await nativeFetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
    return parseJsonResponse(await response.text());
  }

  function scriptResponse(json) {
    if (json && json.download) {
      const mimeType = json.download.mimeType || 'application/octet-stream';
      return new Response(base64ToBlob(json.download.base64, mimeType), {
        status: json.status || 200,
        headers: { 'Content-Type': mimeType },
      });
    }
    const status = Number(json && json.status) || 200;
    if (status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(json && json.data !== undefined ? json.data : null), {
      status: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  async function scriptDownload(path) {
    const json = await scriptRequest(path, 'GET');
    if (json && json.download) {
      return {
        blob: base64ToBlob(json.download.base64, json.download.mimeType),
        name: json.download.name || '',
      };
    }
    throw new Error((json && json.data && json.data.error) || 'ดาวน์โหลดไม่สำเร็จ');
  }

  function captureToken(path, response) {
    if (/\/api\/(auth\/(login|register)|student\/login-name)$/.test(path) && response.ok) {
      response
        .clone()
        .json()
        .then((data) => {
          if (data && data.token) saveToken(data.token);
        })
        .catch(() => {});
    }
    if (/\/api\/auth\/logout$/.test(path)) {
      clearToken();
    }
    if (/\/api\/me$/.test(path) && response.ok) {
      response
        .clone()
        .json()
        .then((data) => {
          /* token หมดอายุ/ถูกยกเลิกแล้ว — ลบทิ้งเพื่อไม่ให้ค้างในเครื่อง */
          if (!data || !data.user) clearToken();
        })
        .catch(() => {});
    }
  }

  /* --------------------------- fetch wrapper ------------------------- */

  window.fetch = async function (input, init) {
    await ready();
    const path = pathOf(input);
    if (!path || !base) return previousFetch(input, init);

    const options = init || {};
    const method = String(options.method || 'GET').toUpperCase();

    if (isScript()) {
      let body = options.body;
      let fields = {};
      let file = null;

      if (body instanceof FormData) {
        const parsed = await formDataPayload(body);
        fields = parsed.fields;
        file = parsed.file;
      } else if (typeof body === 'string' && body) {
        try {
          fields = JSON.parse(body);
        } catch (error) {
          fields = {};
        }
      }

      const json = await scriptRequest(path, method, fields, file);
      const response = scriptResponse(json);
      captureToken(path, response);
      return response;
    }

    const fetchOptions = {
      method: method,
      credentials: 'same-origin',
      headers: options.headers || {},
    };
    const token = readToken();
    if (token) fetchOptions.headers.Authorization = 'Bearer ' + token;

    if (options.body instanceof FormData) {
      fetchOptions.body = options.body;
    } else if (options.body !== undefined) {
      fetchOptions.headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await nativeFetch(base + path, fetchOptions);
    captureToken(path, response);
    return response;
  };

  /* --------------------- ลิงก์ดาวน์โหลด (/api/...) -------------------- */

  async function serverDownload(path) {
    const headers = {};
    const token = readToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await nativeFetch(base + path, {
      headers: headers,
      mode: 'cors',
      credentials: 'omit',
    });
    if (!response.ok) throw new Error('ดาวน์โหลดไม่สำเร็จ (' + response.status + ')');
    return { blob: await response.blob(), name: '' };
  }

  document.addEventListener(
    'click',
    async (event) => {
      await ready();
      if (!base) return;
      const anchor =
        event.target && event.target.closest ? event.target.closest('a[href^="/api/"]') : null;
      if (!anchor) return;
      event.preventDefault();
      event.stopPropagation();

      const href = anchor.getAttribute('href');
      try {
        const result = isScript() ? await scriptDownload(href) : await serverDownload(href);
        const url = URL.createObjectURL(result.blob);
        if (anchor.target === '_blank') {
          window.open(url, '_blank', 'noopener');
        } else {
          const link = document.createElement('a');
          link.href = url;
          link.download = result.name || anchor.getAttribute('download') || 'download';
          document.body.appendChild(link);
          link.click();
          link.remove();
        }
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (error) {
        alert('ดาวน์โหลดไม่สำเร็จ: ' + error.message);
      }
    },
    true
  );

  /* --------------------------- ปุ่มตั้งค่ามุมล่างซ้าย -------------------------- */

  function paintBadge() {
    const badge = document.querySelector('[data-demo-badge]');
    if (!badge) return;
    const label = badge.querySelector('span');
    if (label) {
      if (!base) {
        label.textContent = 'โหมดสาธิต · ข้อมูลเก็บในเบราว์เซอร์นี้';
      } else if (isScript()) {
        label.textContent = 'เชื่อมกับ Google Sheets · Google Apps Script';
      } else {
        label.textContent = 'เชื่อมกับเซิร์ฟเวอร์จริง · ' + base.replace(/^https?:\/\//, '');
      }
    }

    const resetButton = badge.querySelector('button:not([data-bridge-btn])');
    if (resetButton) resetButton.style.display = base ? 'none' : '';

    const existingButton = badge.querySelector('[data-bridge-btn]');
    if (existingButton) {
      existingButton.textContent = base ? 'ยกเลิกการเชื่อมต่อ' : 'เชื่อมเซิร์ฟเวอร์';
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-bridge-btn', '');
    button.textContent = base ? 'ยกเลิกการเชื่อมต่อ' : 'เชื่อมเซิร์ฟเวอร์';
    button.style.cssText =
      'background:rgba(255,255,255,.16);border:0;color:inherit;font:inherit;padding:4px 10px;border-radius:999px;cursor:pointer';
    button.addEventListener('click', () => {
      if (base) {
        localStorage.removeItem(BASE_KEY);
        localStorage.removeItem(MODE_KEY);
        clearToken();
        window.location.reload();
        return;
      }
      const input = window.prompt(
        'ใส่ URL ของ Apps Script Web App (ลงท้าย /exec) หรือ URL ของเซิร์ฟเวอร์',
        'https://'
      );
      if (!input) return;
      const cleaned = input.trim().replace(/\/+$/, '');
      if (!/^https?:\/\/[^/]+/i.test(cleaned)) {
        alert('URL ไม่ถูกต้อง ต้องขึ้นต้นด้วย https://');
        return;
      }
      localStorage.setItem(BASE_KEY, cleaned);
      localStorage.setItem(MODE_KEY, isScriptUrl(cleaned) ? 'apps-script' : 'server');
      window.location.reload();
    });
    badge.appendChild(button);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintBadge);
  else paintBadge();

  window.__bridge = {
    base: readBase,
    mode: () => readMode(),
    setBase: (url) => localStorage.setItem(BASE_KEY, url),
  };
})();
