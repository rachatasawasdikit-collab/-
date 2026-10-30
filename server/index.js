'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');

const { db, all, get, run, UPLOAD_DIR, ROOT } = require('./db');
const {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  attachUser,
  requireAuth,
  requireRole,
  publicUser,
} = require('./auth');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(ROOT, 'public');

app.disable('x-powered-by');

/* ----------------------------- CORS (Pages) ----------------------------- */

const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const isCorsOrigin = (origin) => !!origin && CORS_ORIGINS.includes(origin);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') return res.status(204).end();
  }
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && !isCorsOrigin(origin)) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        return res.status(403).json({ error: 'คำขอไม่ได้มาจากเว็บไซต์นี้' });
      }
    } catch {
      return res.status(403).json({ error: 'คำขอไม่ได้มาจากเว็บไซต์นี้' });
    }
  }
  next();
});
app.use(attachUser);

const now = () => new Date().toISOString();

function str(value, max = 300) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function validUsername(username) {
  return /^[\p{L}\p{N}_.-]{3,32}$/u.test(username);
}

function newClassCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let code = '';
    for (let i = 0; i < 6; i += 1) code += alphabet[crypto.randomInt(alphabet.length)];
    if (!get('SELECT id FROM classes WHERE code = ?', code)) return code;
  }
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function teacherClass(classId, teacherId) {
  return get('SELECT * FROM classes WHERE id = ? AND teacher_id = ?', classId, teacherId);
}

function studentClass(classId, studentId) {
  return get(
    `SELECT c.*, u.name AS teacher_name
       FROM classes c
       JOIN members m ON m.class_id = c.id AND m.student_id = ?
       JOIN users u ON u.id = c.teacher_id
      WHERE c.id = ?`,
    studentId,
    classId
  );
}

function isMember(classId, studentId) {
  return !!get('SELECT 1 AS ok FROM members WHERE class_id = ? AND student_id = ?', classId, studentId);
}

function activityAccess(activityId, user) {
  const activity = get(
    `SELECT a.*, c.name AS class_name, c.code AS class_code, c.teacher_id, t.name AS teacher_name
       FROM activities a
       JOIN classes c ON c.id = a.class_id
       JOIN users t ON t.id = c.teacher_id
      WHERE a.id = ?`,
    activityId
  );
  if (!activity) return { error: [404, 'ไม่พบใบกิจกรรมนี้'] };
  if (user.role === 'teacher') {
    if (activity.teacher_id !== user.id) return { error: [403, 'ไม่มีสิทธิ์เข้าถึงใบกิจกรรมนี้'] };
  } else if (!isMember(activity.class_id, user.id)) {
    return { error: [403, 'คุณไม่ได้อยู่ในห้องเรียนนี้'] };
  }
  return { activity };
}

function rubricOf(activityId) {
  return all(
    'SELECT id, label, max_score, position FROM rubric_items WHERE activity_id = ? ORDER BY position, id',
    activityId
  );
}

function submissionWithScores(submissionId) {
  const submission = get('SELECT * FROM submissions WHERE id = ?', submissionId);
  if (!submission) return null;
  const scores = all('SELECT rubric_item_id, score FROM submission_scores WHERE submission_id = ?', submissionId);
  return { ...submission, scores };
}

function activityStats(activityId) {
  return get(
    `SELECT
       (SELECT COUNT(*) FROM submissions WHERE activity_id = ? AND status = 'reviewed') AS reviewed_count,
       (SELECT COUNT(*) FROM submissions WHERE activity_id = ? AND status = 'reviewed' AND passed = 1) AS passed_count,
       (SELECT COUNT(*) FROM submissions WHERE activity_id = ?) AS submitted_count,
       (SELECT COUNT(*) FROM submissions WHERE activity_id = ? AND status = 'submitted') AS pending_count,
       (SELECT AVG(total_score) FROM submissions WHERE activity_id = ? AND status = 'reviewed') AS avg_score`,
    activityId,
    activityId,
    activityId,
    activityId,
    activityId
  );
}

/* ------------------------------ auth ------------------------------ */

app.get('/api/health', (_req, res) => res.json({ ok: true, time: now() }));

app.get('/api/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post('/api/auth/register', (req, res) => {
  const role = req.body.role === 'student' ? 'student' : req.body.role === 'teacher' ? 'teacher' : '';
  const name = str(req.body.name, 80);
  const username = str(req.body.username, 40);
  const password = String(req.body.password || '');
  if (!role) return res.status(400).json({ error: 'กรุณาเลือกประเภทผู้ใช้' });
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อ' });
  if (!validUsername(username)) {
    return res.status(400).json({ error: 'ชื่อผู้ใช้ต้องมี 3–32 ตัวอักษร และใช้ได้เฉพาะตัวอักษร ตัวเลข จุด ขีดกลาง หรือขีดล่าง' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
  if (get('SELECT id FROM users WHERE username = ?', username)) {
    return res.status(409).json({ error: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว' });
  }
  const result = run(
    'INSERT INTO users (role, name, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    role,
    name,
    username,
    hashPassword(password),
    now()
  );
  const userId = Number(result.lastInsertRowid);
  const token = createSession(res, userId);
  res.status(201).json({
    user: publicUser(get('SELECT * FROM users WHERE id = ?', userId)),
    token,
  });
});

const loginAttempts = new Map();
function loginBlocked(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > 10 * 60 * 1000) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.count >= 15;
}
function noteLoginFailure(key) {
  const entry = loginAttempts.get(key);
  if (!entry || Date.now() - entry.first > 10 * 60 * 1000) {
    loginAttempts.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

app.post('/api/auth/login', (req, res) => {
  const username = str(req.body.username, 40);
  const password = String(req.body.password || '');
  const key = `${req.ip}:${username.toLowerCase()}`;
  if (loginBlocked(key)) {
    return res.status(429).json({ error: 'พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่' });
  }
  const user = get('SELECT * FROM users WHERE username = ?', username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    noteLoginFailure(key);
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  loginAttempts.delete(key);
  const token = createSession(res, user.id);
  res.json({
    user: publicUser(user),
    token,
  });
});

app.post('/api/auth/logout', (req, res) => {
  destroySession(req, res);
  res.status(204).end();
});

/* --------------------------- teacher ---------------------------- */

app.get('/api/teacher/classes', requireRole('teacher'), (req, res) => {
  const classes = all(
    `SELECT c.*,
       (SELECT COUNT(*) FROM members m WHERE m.class_id = c.id) AS student_count,
       (SELECT COUNT(*) FROM activities a WHERE a.class_id = c.id) AS activity_count,
       (SELECT COUNT(*) FROM submissions s JOIN activities a ON a.id = s.activity_id
         WHERE a.class_id = c.id AND s.status = 'submitted') AS pending_count
     FROM classes c
     WHERE c.teacher_id = ?
     ORDER BY c.created_at DESC`,
    req.user.id
  );
  res.json({ classes });
});

app.post('/api/teacher/classes', requireRole('teacher'), (req, res) => {
  const name = str(req.body.name, 120);
  const subject = str(req.body.subject, 120);
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อห้องเรียน' });
  const result = run(
    'INSERT INTO classes (teacher_id, name, subject, code, created_at) VALUES (?, ?, ?, ?, ?)',
    req.user.id,
    name,
    subject,
    newClassCode(),
    now()
  );
  const klass = get('SELECT * FROM classes WHERE id = ?', Number(result.lastInsertRowid));
  res.status(201).json({ class: { ...klass, student_count: 0, activity_count: 0, pending_count: 0 } });
});

app.get('/api/teacher/classes/:id', requireRole('teacher'), (req, res) => {
  const klass = teacherClass(req.params.id, req.user.id);
  if (!klass) return res.status(404).json({ error: 'ไม่พบห้องเรียนนี้' });

  const students = all(
    `SELECT u.id, u.name, u.username, m.joined_at,
       (SELECT COUNT(*) FROM submissions s JOIN activities a ON a.id = s.activity_id
         WHERE a.class_id = m.class_id AND s.student_id = u.id) AS record_count,
       (SELECT COUNT(*) FROM submissions s JOIN activities a ON a.id = s.activity_id
         WHERE a.class_id = m.class_id AND s.student_id = u.id AND s.status = 'reviewed') AS reviewed_count
     FROM members m JOIN users u ON u.id = m.student_id
     WHERE m.class_id = ?
     ORDER BY u.name COLLATE NOCASE`,
    klass.id
  );

  const activities = all(
    `SELECT a.*,
       (SELECT COUNT(*) FROM members m WHERE m.class_id = a.class_id) AS student_count,
       (SELECT COUNT(*) FROM submissions s WHERE s.activity_id = a.id) AS submitted_count,
       (SELECT COUNT(*) FROM submissions s WHERE s.activity_id = a.id AND s.status = 'reviewed') AS reviewed_count,
       (SELECT COUNT(*) FROM submissions s WHERE s.activity_id = a.id AND s.status = 'reviewed' AND s.passed = 1) AS passed_count,
       (SELECT AVG(s.total_score) FROM submissions s WHERE s.activity_id = a.id AND s.status = 'reviewed') AS avg_score,
       (SELECT COUNT(*) FROM rubric_items r WHERE r.activity_id = a.id) AS rubric_count
     FROM activities a
     WHERE a.class_id = ?
     ORDER BY a.created_at DESC, a.id DESC`,
    klass.id
  );

  res.json({ class: klass, students, activities });
});

app.post('/api/teacher/classes/:id/students', requireRole('teacher'), (req, res) => {
  const klass = teacherClass(req.params.id, req.user.id);
  if (!klass) return res.status(404).json({ error: 'ไม่พบห้องเรียนนี้' });

  const name = str(req.body.name, 80);
  const username = str(req.body.username, 40);
  const password = String(req.body.password || '');
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อนักเรียน' });
  if (!validUsername(username)) {
    return res.status(400).json({ error: 'ชื่อผู้ใช้ต้องมี 3–32 ตัวอักษร และใช้ได้เฉพาะตัวอักษร ตัวเลข จุด ขีดกลาง หรือขีดล่าง' });
  }

  let student = get('SELECT * FROM users WHERE username = ?', username);
  let created = false;
  if (student) {
    if (student.role !== 'student') return res.status(409).json({ error: 'ชื่อผู้ใช้นี้ถูกใช้งานโดยบัญชีครู' });
    if (!isMember(klass.id, student.id)) {
      run('INSERT INTO members (class_id, student_id, joined_at) VALUES (?, ?, ?)', klass.id, student.id, now());
    }
  } else {
    if (password.length < 6) return res.status(400).json({ error: 'รหัสผ่านของนักเรียนใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
    const result = run(
      'INSERT INTO users (role, name, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      'student',
      name,
      username,
      hashPassword(password),
      now()
    );
    student = get('SELECT * FROM users WHERE id = ?', Number(result.lastInsertRowid));
    run('INSERT INTO members (class_id, student_id, joined_at) VALUES (?, ?, ?)', klass.id, student.id, now());
    created = true;
  }

  res.status(201).json({
    student: { id: student.id, name: student.name, username: student.username },
    created,
  });
});

app.post('/api/teacher/classes/:id/activities', requireRole('teacher'), (req, res) => {
  const klass = teacherClass(req.params.id, req.user.id);
  if (!klass) return res.status(404).json({ error: 'ไม่พบห้องเรียนนี้' });

  const title = str(req.body.title, 160);
  const description = str(req.body.description, 4000);
  const mode = req.body.mode === 'score' ? 'score' : req.body.mode === 'check' ? 'check' : '';
  const dueDate = str(req.body.due_date, 10) || null;
  if (!title) return res.status(400).json({ error: 'กรุณากรอกชื่อใบกิจกรรม' });
  if (!mode) return res.status(400).json({ error: 'กรุณาเลือกวิธีตรวจ' });
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return res.status(400).json({ error: 'รูปแบบกำหนดส่งไม่ถูกต้อง' });
  }

  let items = [];
  if (mode === 'score') {
    items = (Array.isArray(req.body.rubric) ? req.body.rubric : [])
      .map((item, index) => ({ label: str(item.label, 160), max_score: num(item.max_score, 0), position: index }))
      .filter((item) => item.label && item.max_score > 0 && item.max_score <= 100)
      .slice(0, 20);
    if (!items.length) {
      return res.status(400).json({ error: 'โหมดให้คะแนนต้องมีหัวข้อให้คะแนนอย่างน้อย 1 หัวข้อ (คะแนนเต็มระหว่าง 1–100)' });
    }
  }
  const maxTotal = items.reduce((sum, item) => sum + item.max_score, 0);
  const passScore = mode === 'score' ? Math.min(Math.max(num(req.body.pass_score, Math.round(maxTotal * 0.6)), 0), maxTotal) : 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    const result = run(
      'INSERT INTO activities (class_id, title, description, mode, pass_score, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      klass.id,
      title,
      description,
      mode,
      passScore,
      dueDate,
      now()
    );
    const activityId = Number(result.lastInsertRowid);
    for (const item of items) {
      run(
        'INSERT INTO rubric_items (activity_id, label, max_score, position) VALUES (?, ?, ?, ?)',
        activityId,
        item.label,
        item.max_score,
        item.position
      );
    }
    db.exec('COMMIT');
    const activity = get('SELECT * FROM activities WHERE id = ?', activityId);
    res.status(201).json({ activity: { ...activity, rubric: rubricOf(activityId) } });
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
});

app.patch('/api/teacher/activities/:id', requireRole('teacher'), (req, res) => {
  const access = activityAccess(req.params.id, req.user);
  if (access.error) return res.status(access.error[0]).json({ error: access.error[1] });
  const activity = access.activity;
  const title = req.body.title === undefined ? activity.title : str(req.body.title, 160);
  const description = req.body.description === undefined ? activity.description : str(req.body.description, 4000);
  const dueDate = req.body.due_date === undefined ? activity.due_date : str(req.body.due_date, 10) || null;
  if (!title) return res.status(400).json({ error: 'กรุณากรอกชื่อใบกิจกรรม' });
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return res.status(400).json({ error: 'รูปแบบกำหนดส่งไม่ถูกต้อง' });
  }
  run('UPDATE activities SET title = ?, description = ?, due_date = ? WHERE id = ?', title, description, dueDate, activity.id);
  res.json({ activity: get('SELECT * FROM activities WHERE id = ?', activity.id) });
});

app.get('/api/teacher/activities/:id', requireRole('teacher'), (req, res) => {
  const access = activityAccess(req.params.id, req.user);
  if (access.error) return res.status(access.error[0]).json({ error: access.error[1] });
  const activity = access.activity;

  const rows = all(
    `SELECT u.id AS student_id, u.name, u.username,
            s.id AS submission_id, s.status, s.passed, s.total_score, s.submitted_at, s.reviewed_at,
            s.feedback, s.text, s.original_name
       FROM members m
       JOIN users u ON u.id = m.student_id
       LEFT JOIN submissions s ON s.student_id = u.id AND s.activity_id = ?
      WHERE m.class_id = ?
      ORDER BY u.name COLLATE NOCASE`,
    activity.id,
    activity.class_id
  );

  const scoreRows = all(
    `SELECT sc.submission_id, sc.rubric_item_id, sc.score
       FROM submission_scores sc
       JOIN submissions s ON s.id = sc.submission_id
      WHERE s.activity_id = ?`,
    activity.id
  );
  const scoresBySubmission = new Map();
  for (const row of scoreRows) {
    if (!scoresBySubmission.has(row.submission_id)) scoresBySubmission.set(row.submission_id, {});
    scoresBySubmission.get(row.submission_id)[row.rubric_item_id] = row.score;
  }

  const rubric = rubricOf(activity.id);
  const data = rows.map((row) => ({
    student: { id: row.student_id, name: row.name, username: row.username },
    submission: row.submission_id
      ? {
          id: row.submission_id,
          status: row.status,
          passed: row.passed,
          total_score: row.total_score,
          submitted_at: row.submitted_at,
          reviewed_at: row.reviewed_at,
          feedback: row.feedback,
          text: row.text,
          original_name: row.original_name,
          scores: scoresBySubmission.get(row.submission_id) || {},
        }
      : null,
  }));

  const stats = activityStats(activity.id);
  const studentCount = get('SELECT COUNT(*) AS n FROM members WHERE class_id = ?', activity.class_id).n;

  res.json({
    activity,
    class: { id: activity.class_id, name: activity.class_name, code: activity.class_code },
    rubric,
    rows: data,
    stats: { ...stats, student_count: studentCount },
  });
});

app.post('/api/teacher/activities/:id/review', requireRole('teacher'), (req, res) => {
  const access = activityAccess(req.params.id, req.user);
  if (access.error) return res.status(access.error[0]).json({ error: access.error[1] });
  const activity = access.activity;

  const studentId = Number(req.body.student_id);
  if (!isMember(activity.class_id, studentId)) {
    return res.status(400).json({ error: 'นักเรียนคนนี้ไม่ได้อยู่ในห้องเรียน' });
  }
  const student = get("SELECT id, name FROM users WHERE id = ? AND role = 'student'", studentId);
  if (!student) return res.status(400).json({ error: 'ไม่พบนักเรียนคนนี้' });

  const feedback = str(req.body.feedback, 2000);
  const rubric = rubricOf(activity.id);
  let passed;
  let total = null;
  const scores = [];

  if (activity.mode === 'score') {
    const input = req.body.scores && typeof req.body.scores === 'object' ? req.body.scores : {};
    for (const item of rubric) {
      const raw = num(input[item.id], NaN);
      if (!Number.isFinite(raw)) return res.status(400).json({ error: `กรุณากรอกคะแนน: ${item.label}` });
      if (raw < 0 || raw > item.max_score) {
        return res.status(400).json({ error: `คะแนนของ “${item.label}” ต้องอยู่ระหว่าง 0–${item.max_score}` });
      }
      scores.push({ itemId: item.id, score: raw });
    }
    total = scores.reduce((sum, item) => sum + item.score, 0);
    passed = total >= activity.pass_score ? 1 : 0;
  } else {
    if (typeof req.body.passed !== 'boolean') {
      return res.status(400).json({ error: 'กรุณาเลือกผลการตรวจ ผ่าน หรือ ไม่ผ่าน' });
    }
    passed = req.body.passed ? 1 : 0;
  }

  const existing = get(
    'SELECT * FROM submissions WHERE activity_id = ? AND student_id = ?',
    activity.id,
    studentId
  );

  db.exec('BEGIN IMMEDIATE');
  try {
    let submissionId;
    if (existing) {
      submissionId = existing.id;
      run(
        `UPDATE submissions
            SET status = 'reviewed', reviewer_id = ?, reviewed_at = ?, passed = ?, total_score = ?, feedback = ?
          WHERE id = ?`,
        req.user.id,
        now(),
        passed,
        total,
        feedback,
        submissionId
      );
    } else {
      const result = run(
        `INSERT INTO submissions
           (activity_id, student_id, text, submitted_at, status, reviewer_id, reviewed_at, passed, total_score, feedback)
         VALUES (?, ?, '', ?, 'reviewed', ?, ?, ?, ?, ?)`,
        activity.id,
        studentId,
        now(),
        req.user.id,
        now(),
        passed,
        total,
        feedback
      );
      submissionId = Number(result.lastInsertRowid);
    }

    run('DELETE FROM submission_scores WHERE submission_id = ?', submissionId);
    for (const item of scores) {
      run(
        'INSERT INTO submission_scores (submission_id, rubric_item_id, score) VALUES (?, ?, ?)',
        submissionId,
        item.itemId,
        item.score
      );
    }
    db.exec('COMMIT');
    res.json({ submission: submissionWithScores(submissionId) });
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
});

app.get('/api/teacher/activities/:id/export.csv', requireRole('teacher'), (req, res) => {
  const access = activityAccess(req.params.id, req.user);
  if (access.error) return res.status(access.error[0]).json({ error: access.error[1] });
  const activity = access.activity;
  const rubric = rubricOf(activity.id);
  const rows = all(
    `SELECT u.name, u.username,
            s.status, s.passed, s.total_score, s.feedback, s.submitted_at, s.reviewed_at
       FROM members m
       JOIN users u ON u.id = m.student_id
       LEFT JOIN submissions s ON s.student_id = u.id AND s.activity_id = ?
      WHERE m.class_id = ?
      ORDER BY u.name COLLATE NOCASE`,
    activity.id,
    activity.class_id
  );
  const scoreRows = all(
    `SELECT u.username, sc.rubric_item_id, sc.score
       FROM submission_scores sc
       JOIN submissions s ON s.id = sc.submission_id
       JOIN users u ON u.id = s.student_id
      WHERE s.activity_id = ?`,
    activity.id
  );
  const scoreMap = new Map();
  for (const row of scoreRows) scoreMap.set(`${row.username}:${row.rubric_item_id}`, row.score);

  const csvCell = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  const header = ['ชื่อ-นามสกุล', 'ชื่อผู้ใช้', ...rubric.map((item) => `${item.label} (เต็ม ${item.max_score})`), 'คะแนนรวม', 'ผลการตรวจ', 'ความคิดเห็น', 'วันที่ส่ง', 'วันที่ตรวจ'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    const scores = rubric.map((item) => scoreMap.get(`${row.username}:${item.id}`) ?? '');
    const result = row.status !== 'reviewed' ? 'ยังไม่ตรวจ' : row.passed ? 'ผ่าน' : 'ไม่ผ่าน';
    lines.push(
      [
        row.name,
        row.username,
        ...scores,
        row.total_score ?? '',
        result,
        row.feedback || '',
        row.submitted_at || '',
        row.reviewed_at || '',
      ]
        .map(csvCell)
        .join(',')
    );
  }
  const csv = '\uFEFF' + lines.join('\r\n');
  const filename = `ผลตรวจ-${activity.title}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="activity-report.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.send(csv);
});

/* --------------------------- student ---------------------------- */

app.get('/api/student/classes', requireRole('student'), (req, res) => {
  const classes = all(
    `SELECT c.id, c.name, c.subject, c.code, c.created_at, u.name AS teacher_name,
       (SELECT COUNT(*) FROM activities a WHERE a.class_id = c.id) AS activity_count,
       (SELECT COUNT(*) FROM submissions s JOIN activities a ON a.id = s.activity_id
         WHERE a.class_id = c.id AND s.student_id = m.student_id AND s.status = 'reviewed') AS reviewed_count
     FROM members m
     JOIN classes c ON c.id = m.class_id
     JOIN users u ON u.id = c.teacher_id
     WHERE m.student_id = ?
     ORDER BY m.joined_at DESC`,
    req.user.id
  );
  res.json({ classes });
});

app.post('/api/student/join', requireRole('student'), (req, res) => {
  const code = str(req.body.code, 12).toUpperCase();
  if (!code) return res.status(400).json({ error: 'กรุณากรอกรหัสห้องเรียน' });
  const klass = get('SELECT * FROM classes WHERE code = ?', code);
  if (!klass) return res.status(404).json({ error: 'ไม่พบห้องเรียนที่ใช้รหัสนี้' });
  if (isMember(klass.id, req.user.id)) {
    return res.status(409).json({ error: 'คุณอยู่ในห้องเรียนนี้แล้ว' });
  }
  run('INSERT INTO members (class_id, student_id, joined_at) VALUES (?, ?, ?)', klass.id, req.user.id, now());
  res.status(201).json({ class: { id: klass.id, name: klass.name, subject: klass.subject } });
});

app.get('/api/student/classes/:id', requireRole('student'), (req, res) => {
  const klass = studentClass(req.params.id, req.user.id);
  if (!klass) return res.status(404).json({ error: 'ไม่พบห้องเรียนนี้ หรือคุณยังไม่ได้เข้าร่วม' });
  const activities = all(
    `SELECT a.*, s.id AS submission_id, s.status, s.passed, s.total_score, s.submitted_at, s.reviewed_at, s.feedback,
       (SELECT COUNT(*) FROM rubric_items r WHERE r.activity_id = a.id) AS rubric_count
     FROM activities a
     LEFT JOIN submissions s ON s.activity_id = a.id AND s.student_id = ?
     WHERE a.class_id = ?
     ORDER BY a.created_at DESC, a.id DESC`,
    req.user.id,
    klass.id
  );
  res.json({ class: klass, activities });
});

app.get('/api/student/activities/:id', requireRole('student'), (req, res) => {
  const access = activityAccess(req.params.id, req.user);
  if (access.error) return res.status(access.error[0]).json({ error: access.error[1] });
  const activity = access.activity;
  const submission = get(
    'SELECT * FROM submissions WHERE activity_id = ? AND student_id = ?',
    activity.id,
    req.user.id
  );
  const scores = submission
    ? all('SELECT rubric_item_id, score FROM submission_scores WHERE submission_id = ?', submission.id)
    : [];
  res.json({
    activity,
    class: { id: activity.class_id, name: activity.class_name },
    rubric: rubricOf(activity.id),
    submission: submission ? { ...submission, scores } : null,
  });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 8);
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('INVALID_FILE_TYPE'));
    }
    cb(null, true);
  },
});

app.post('/api/student/activities/:id/submit', requireRole('student'), (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      if (error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'ไฟล์ใหญ่เกิน 15 MB' });
      if (error.message === 'INVALID_FILE_TYPE') {
        return res.status(400).json({ error: 'รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP, GIF) หรือ PDF' });
      }
      return res.status(400).json({ error: 'อัปโหลดไฟล์ไม่สำเร็จ' });
    }
    next();
  });
}, (req, res) => {
  const access = activityAccess(req.params.id, req.user);
  if (access.error) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return res.status(access.error[0]).json({ error: access.error[1] });
  }
  const activity = access.activity;
  const text = str(req.body.text, 8000);
  const existing = get(
    'SELECT * FROM submissions WHERE activity_id = ? AND student_id = ?',
    activity.id,
    req.user.id
  );

  if (existing && existing.status === 'reviewed') {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return res.status(409).json({ error: 'ครูตรวจงานนี้แล้ว จึงไม่สามารถแก้ไขได้' });
  }
  if (!text && !req.file && !(existing && (existing.text || existing.file_name))) {
    return res.status(400).json({ error: 'กรุณาพิมพ์คำตอบ หรือแนบไฟล์ใบกิจกรรม' });
  }

  const submittedAt = now();
  let submissionId;
  if (existing) {
    if (req.file && existing.file_name) fs.rmSync(path.join(UPLOAD_DIR, existing.file_name), { force: true });
    run(
      `UPDATE submissions
          SET text = ?, file_name = ?, original_name = ?, submitted_at = ?, status = 'submitted',
              reviewer_id = NULL, reviewed_at = NULL, passed = NULL, total_score = NULL, feedback = ''
        WHERE id = ?`,
      text,
      req.file ? req.file.filename : existing.file_name,
      req.file ? str(req.file.originalname, 200) : existing.original_name,
      submittedAt,
      existing.id
    );
    run('DELETE FROM submission_scores WHERE submission_id = ?', existing.id);
    submissionId = existing.id;
  } else {
    const result = run(
      `INSERT INTO submissions (activity_id, student_id, text, file_name, original_name, submitted_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'submitted')`,
      activity.id,
      req.user.id,
      text,
      req.file ? req.file.filename : null,
      req.file ? str(req.file.originalname, 200) : null,
      submittedAt
    );
    submissionId = Number(result.lastInsertRowid);
  }

  res.status(201).json({ submission: submissionWithScores(submissionId) });
});

/* ---------------------------- files ----------------------------- */

app.get('/api/files/:submissionId', requireAuth, (req, res) => {
  const submission = get(
    `SELECT s.*, a.class_id, c.teacher_id
       FROM submissions s
       JOIN activities a ON a.id = s.activity_id
       JOIN classes c ON c.id = a.class_id
      WHERE s.id = ?`,
    req.params.submissionId
  );
  if (!submission || !submission.file_name) return res.status(404).json({ error: 'ไม่พบไฟล์นี้' });
  const allowed =
    (req.user.role === 'teacher' && submission.teacher_id === req.user.id) ||
    (req.user.role === 'student' && submission.student_id === req.user.id);
  if (!allowed) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงไฟล์นี้' });

  const filePath = path.join(UPLOAD_DIR, path.basename(submission.file_name));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'ไม่พบไฟล์นี้บนเซิร์ฟเวอร์' });
  res.download(filePath, submission.original_name || 'activity-file', { dotfiles: 'allow' });
});

/* -------------------------- frontend ---------------------------- */

app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), { dotfiles: 'allow' });
});

app.use((error, req, res, _next) => {
  if (res.headersSent) return;
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' });
  }
  console.error(error);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดบนเซิร์ฟเวอร์' });
});

/* --------------------------- listen ----------------------------- */

function lanUrls(port) {
  const os = require('node:os');
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) urls.push(`http://${item.address}:${port}`);
    }
  }
  return urls;
}

const server = app.listen(PORT, HOST, () => {
  const actualPort = server.address().port;
  console.log(`\n  ระบบตรวจใบกิจกรรม พร้อมใช้งาน`);
  console.log(`  เครื่องนี้:   http://localhost:${actualPort}`);
  for (const url of lanUrls(actualPort)) console.log(`  เครือข่าย:   ${url}`);
  console.log('');
});

module.exports = app;
