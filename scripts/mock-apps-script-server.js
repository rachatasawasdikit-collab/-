'use strict';

/*
 * Local test server: เสิร์ฟ docs/ และจำลอง Apps Script Web App
 *   - http://127.0.0.1:8787  หน้าเว็บ (docs/)
 *   - http://127.0.0.1:8788/exec  API จำลอง (ใช้ Code.gs + mock)
 *
 * รัน: node scripts/mock-apps-script-server.js
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createMockContext } = require('./apps-script-mock');

const STATIC_PORT = Number(process.env.STATIC_PORT) || 8787;
const API_PORT = Number(process.env.API_PORT) || 8788;
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const API_ORIGIN = 'http://127.0.0.1:' + API_PORT;
const { context } = createMockContext();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const apiServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'GET') {
    const url = new URL(req.url, API_ORIGIN);
    const output = context.doGet({
      parameter: {
        path: url.searchParams.get('path') || '/api/health',
        token: url.searchParams.get('token') || '',
      },
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(output.content);
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const output = context.doPost({ postData: { contents: body } });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(output.content);
    });
    return;
  }

  res.statusCode = 405;
  res.end('Method not allowed');
});

const staticServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:' + STATIC_PORT);

  if (url.pathname === '/config.json') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ api: API_ORIGIN + '/exec', mode: 'apps-script' }));
    return;
  }

  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const target = path.resolve(DOCS_DIR, relative);
  if (!target.startsWith(path.resolve(DOCS_DIR) + path.sep) && target !== path.resolve(DOCS_DIR)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.readFile(target, (error, data) => {
    if (error) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream');
    res.end(data);
  });
});

apiServer.listen(API_PORT, '127.0.0.1', () => {
  console.log('Apps Script mock API: ' + API_ORIGIN + '/exec');
});

staticServer.listen(STATIC_PORT, '127.0.0.1', () => {
  console.log('Static site: http://127.0.0.1:' + STATIC_PORT);
});

module.exports = { apiServer, staticServer };
