/*
 * bridge.js — เชื่อมหน้าเว็บที่โฮสต์บน GitHub Pages เข้ากับเซิร์ฟเวอร์จริง
 *
 * - ค่าเริ่มต้น: ใช้ข้อมูลจำลองในเบราว์เซอร์ (demo-api.js)
 * - เมื่อตั้ง API base แล้ว: ยิงไปเซิร์ฟเวอร์จริงแทน ด้วย Bearer token
 *   (ไม่ใช้ cookie เพราะเบราว์เซอร์บล็อก third-party cookie เมื่อข้ามโดเมน)
 *
 * ตั้งค่าได้ 3 ทาง: ปุ่มมุมล่างซ้าย, query string ?api=..., หรือ localStorage
 */
(function () {
  'use strict';

  const BASE_KEY = 'activity-api-base';
  const TOKEN_KEY = 'activity-api-token';
  const nativeFetch = (window.__demoRealFetch || window.fetch).bind(window);
  const previousFetch = window.fetch.bind(window);
  const nf = nativeFetch;

  const params = new URLSearchParams(window.location.search);
  if (params.get('api')) {
    localStorage.setItem(BASE_KEY, params.get('api').replace(/\/+$/, ''));
    params.delete('api');
    const left = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (left ? '?' + left : '') + window.location.hash);
  }

  const readBase = () => (localStorage.getItem(BASE_KEY) || '').replace(/\/+$/, '');
  let base = readBase();
  let configPromise = null;

  const loadFromConfig = async () => {
    try {
      const response = await nativeFetch('config.json', { cache: 'no-store' });
      if (!response.ok) return;
      const json = await response.json();
      if (json && json.api) {
        base = String(json.api).replace(/\/+$/, '');
        localStorage.setItem(BASE_KEY, base);
      }
    } catch (error) {
      /* ไม่มี config.json ก็ใช้โหมดสาธิตต่อ */
    }
  };

  if (!base) {
    configPromise = loadFromConfig();
  } else {
    // มีค่าเก่าอยู่ — ตรวจก่อนว่ายังใช้ได้ ถ้าไม่ ให้กลับไปใช้ config.json ล่าสุด
    configPromise = (async () => {
      try {
        const response = await nativeFetch(base + '/api/health', {
          cache: 'no-store',
          mode: 'cors',
          signal: AbortSignal.timeout(4000),
        });
        if (response.ok) return;
      } catch (error) {
        /* ใช้ไม่ได้ */
      }
      base = '';
      localStorage.removeItem(BASE_KEY);
      await loadFromConfig();
    })();
  }

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

  window.fetch = async function (input, init) {
    if (configPromise) {
      await configPromise;
      configPromise = null;
      paintBadge();
    }
    const path = pathOf(input);
    if (!path || !base) return previousFetch(input, init);

    const headers = new Headers((init && init.headers) || {});
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token) headers.set('Authorization', 'Bearer ' + token);

    const options = Object.assign({}, init, { headers, mode: 'cors', credentials: 'omit' });
    const response = await nf(base + path, options);

    if (/\/api\/auth\/(login|register)$/.test(path) && response.ok) {
      response
        .clone()
        .json()
        .then((data) => {
          if (data && data.token) sessionStorage.setItem(TOKEN_KEY, data.token);
        })
        .catch(() => {});
    }
    if (/\/api\/auth\/logout$/.test(path)) {
      sessionStorage.removeItem(TOKEN_KEY);
    }
    return response;
  };

  /* ลิงก์ดาวน์โหลด (/api/files/... และ CSV) ต้องแนบ token เอง */
  document.addEventListener(
    'click',
    async (event) => {
      if (configPromise) {
        await configPromise;
        configPromise = null;
        paintBadge();
      }
      if (!base) return;
      const anchor =
        event.target && event.target.closest ? event.target.closest('a[href^="/api/"]') : null;
      if (!anchor) return;
      event.preventDefault();
      event.stopPropagation();

      const href = anchor.getAttribute('href');
      try {
        const headers = {};
        const token = sessionStorage.getItem(TOKEN_KEY);
        if (token) headers.Authorization = 'Bearer ' + token;
        const response = await nf(base + href, { headers, mode: 'cors', credentials: 'omit' });
        if (!response.ok) {
          alert('ดาวน์โหลดไม่สำเร็จ (' + response.status + ')');
          return;
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        if (anchor.target === '_blank') {
          window.open(url, '_blank', 'noopener');
        } else {
          const link = document.createElement('a');
          link.href = url;
          link.download = anchor.getAttribute('download') || 'download';
          document.body.appendChild(link);
          link.click();
          link.remove();
        }
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (error) {
        alert('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: ' + error.message);
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
      label.textContent = base
        ? 'เชื่อมกับเซิร์ฟเวอร์จริง · ' + base.replace(/^https?:\/\//, '')
        : 'โหมดสาธิต · ข้อมูลเก็บในเบราว์เซอร์นี้';
    }
    if (badge.querySelector('[data-bridge-btn]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-bridge-btn', '');
    button.textContent = base ? 'ยกเลิกการเชื่อมต่อ' : 'เชื่อมเซิร์ฟเวอร์';
    button.style.cssText =
      'background:rgba(255,255,255,.16);border:0;color:inherit;font:inherit;padding:4px 10px;border-radius:999px;cursor:pointer';
    button.addEventListener('click', () => {
      if (base) {
        localStorage.removeItem(BASE_KEY);
        sessionStorage.removeItem(TOKEN_KEY);
        window.location.reload();
        return;
      }
      const input = window.prompt(
        'ใส่ URL ของเซิร์ฟเวอร์ (เช่น https://xxxx.trycloudflare.com)',
        'https://'
      );
      if (!input) return;
      const cleaned = input.trim().replace(/\/+$/, '');
      if (!/^https?:\/\/[^/]+/i.test(cleaned)) {
        alert('URL ไม่ถูกต้อง ต้องขึ้นต้นด้วย https://');
        return;
      }
      localStorage.setItem(BASE_KEY, cleaned);
      window.location.reload();
    });
    badge.appendChild(button);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintBadge);
  else paintBadge();

  window.__bridge = { base: readBase, setBase: (url) => localStorage.setItem(BASE_KEY, url) };
})();
