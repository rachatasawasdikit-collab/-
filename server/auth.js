'use strict';

const crypto = require('node:crypto');
const { get, run } = require('./db');

const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(String(password), salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', token, userId, new Date().toISOString());
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
  );
  return token;
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  return (
    get(
      `SELECT u.id, u.role, u.name, u.username
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`,
      token
    ) || null
  );
}

function attachUser(req, _res, next) {
  req.user = currentUser(req);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
    if (req.user.role !== role) return res.status(403).json({ error: 'ไม่มีสิทธิ์ใช้งานส่วนนี้' });
    next();
  };
}

function publicUser(user) {
  return user ? { id: user.id, role: user.role, name: user.name, username: user.username } : null;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  attachUser,
  requireAuth,
  requireRole,
  publicUser,
};
