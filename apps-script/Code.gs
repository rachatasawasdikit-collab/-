/**
 * ตรวจใบกิจกรรม — Backend บน Google Apps Script
 *
 * ทำหน้าที่แทน server/index.js โดยเก็บข้อมูลใน Google Sheets
 * และเก็บไฟล์แนบใน Google Drive ทำให้เว็บใช้งานได้แม้ปิดคอมพิวเตอร์
 *
 * วิธีติดตั้งฉบับย่อ (รายละเอียดอยู่ใน apps-script/README.md)
 *   1. เปิด https://script.google.com → New project → วางไฟล์นี้ใน Code.gs
 *   2. วาง appsscript.json (Project Settings → Show "appsscript.json")
 *   3. Run ฟังก์ชัน setup() หนึ่งครั้ง เพื่อสร้างสเปรดชีต + ข้อมูลตัวอย่าง
 *   4. Deploy → New deployment → Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *   5. คัดลอก URL ที่ลงท้าย /exec ไปใส่ docs/config.json → { "api": "...", "mode": "apps-script" }
 */

'use strict';

/* ------------------------------ constants ------------------------------ */

var SPREADSHEET_TITLE = 'ตรวจใบกิจกรรม · ฐานข้อมูล';
var FILES_FOLDER_NAME = 'ตรวจใบกิจกรรม · ไฟล์แนบ';
var SESSION_DAYS = 30;
var MAX_FILE_BYTES = 15 * 1024 * 1024;

var TABLES = {
  users: ['id', 'role', 'name', 'username', 'salt', 'password_hash', 'created_at'],
  sessions: ['token', 'user_id', 'created_at'],
  classes: ['id', 'teacher_id', 'name', 'subject', 'code', 'created_at'],
  members: ['class_id', 'student_id', 'joined_at'],
  activities: [
    'id',
    'class_id',
    'title',
    'description',
    'mode',
    'pass_score',
    'due_date',
    'created_at',
  ],
  rubric_items: ['id', 'activity_id', 'label', 'max_score', 'position'],
  submissions: [
    'id',
    'activity_id',
    'student_id',
    'text',
    'file_id',
    'original_name',
    'submitted_at',
    'status',
    'reviewer_id',
    'reviewed_at',
    'passed',
    'total_score',
    'feedback',
  ],
  submission_scores: ['submission_id', 'rubric_item_id', 'score'],
  sheet_exports: ['activity_id', 'spreadsheet_id', 'url', 'created_at'],
};

/* ------------------------------ entrypoints ---------------------------- */

function doGet(e) {
  return handleRequest_(e, 'GET');
}

function doPost(e) {
  return handleRequest_(e, 'POST');
}

/**
 * รันครั้งเดียวหลังวางโค้ด: สร้างสเปรดชีต ตาราง และข้อมูลตัวอย่าง (ถ้ายังว่าง)
 */
function setup() {
  var ss = ensureSpreadsheet_();
  resetCache_();
  if (table_('users').length === 0) {
    seedSampleData_();
    resetCache_();
  }
  var url = ss.getUrl();
  Logger.log('สร้างฐานข้อมูลเรียบร้อย: ' + url);
  return url;
}

/**
 * ล้างข้อมูลทั้งหมดในสเปรดชีต (ยังเก็บไฟล์แนบเดิมไว้ใน Drive)
 */
function clearAllData() {
  var ss = ensureSpreadsheet_();
  Object.keys(TABLES).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    sh.clearContents();
    sh.getRange(1, 1, 1, TABLES[name].length).setValues([TABLES[name]]);
  });
  resetCache_();
  Logger.log('ล้างข้อมูลทั้งหมดแล้ว');
}

/* ------------------------------- router -------------------------------- */

function handleRequest_(e, httpMethod) {
  resetCache_();

  var lock = null;
  var result;
  try {
    var req = parseRequest_(e, httpMethod);
    if (req.method !== 'GET') {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
    }
    result = route_(req);
  } catch (error) {
    result = {
      status: Number(error && error.status) || 500,
      data: { error: (error && error.message) || 'เกิดข้อผิดพลาดบนเซิร์ฟเวอร์' },
    };
    if (!error || !error.status) console.error(error);
  } finally {
    if (lock) {
      try {
        lock.releaseLock();
      } catch (ignored) {
        /* ignore */
      }
    }
  }
  return output_(result);
}

function parseRequest_(e, httpMethod) {
  if (httpMethod === 'GET') {
    var params = (e && e.parameter) || {};
    return {
      method: String(params.method || 'GET').toUpperCase(),
      path: params.path || '/api/health',
      token: params.token || '',
      body: {},
      file: null,
    };
  }

  var raw = (e && e.postData && e.postData.contents) || '{}';
  var payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch (error) {
    throw fail_(400, 'ข้อมูลที่ส่งมาไม่ถูกต้อง');
  }
  return {
    method: String(payload.method || 'POST').toUpperCase(),
    path: payload.path || '',
    token: payload.token || '',
    body: payload.body || {},
    file: payload.file || null,
  };
}

function output_(result) {
  var payload = {
    status: Number(result.status) || 200,
    data: result.data === undefined ? null : result.data,
  };
  if (result.download) payload.download = result.download;
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function respond_(status, data) {
  return { status: status, data: data === undefined ? null : data };
}

function fail_(status, message) {
  var error = new Error(message);
  error.status = status;
  throw error;
}

/* ------------------------------- helpers ------------------------------- */

function now_() {
  return new Date().toISOString();
}

function str_(value, max) {
  return String(value == null ? '' : value)
    .trim()
    .slice(0, max || 300);
}

function num_(value, fallback) {
  var number = Number(value);
  return isFinite(number) ? number : fallback;
}

function publicUser_(user) {
  if (!user) return null;
  return {
    id: Number(user.id),
    role: user.role,
    name: user.name,
    username: user.username,
  };
}

function validUsername_(username) {
  return /^[\p{L}\p{N}_.-]{3,32}$/u.test(username);
}

function nextId_(rows) {
  var max = 0;
  for (var i = 0; i < rows.length; i += 1) {
    var id = Number(rows[i].id);
    if (isFinite(id) && id > max) max = id;
  }
  return max + 1;
}

function makeClassCode_(classes) {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (var attempt = 0; attempt < 40; attempt += 1) {
    var code = '';
    for (var i = 0; i < 6; i += 1) {
      code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    var taken = classes.some(function (item) {
      return String(item.code).toUpperCase() === code;
    });
    if (!taken) return code;
  }
  return Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function uniqueUsername_(users, code) {
  var base = String(code || 'stu')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!base) base = 'stu';
  for (var i = 1; i < 900; i += 1) {
    var candidate = base + String(i).padStart(2, '0');
    var taken = users.some(function (user) {
      return String(user.username).toLowerCase() === candidate;
    });
    if (!taken) return candidate;
  }
  return base + Utilities.getUuid().slice(0, 6);
}

function randomPassword_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function randomSalt_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function hashPassword_(password, salt) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + ':' + String(password),
    Utilities.Charset.UTF_8
  );
  // ย้ำหลายรอบให้เดายากขึ้น (ไม่หนักเท่า scrypt แต่เหมาะกับ Apps Script)
  for (var i = 0; i < 200; i += 1) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  }
  return bytesToHex_(bytes);
}

function verifyPassword_(password, salt, expectedHash) {
  if (!expectedHash) return false;
  var actual = hashPassword_(password, salt);
  return String(actual) === String(expectedHash);
}

function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i += 1) {
    var value = (bytes[i] + 256) % 256;
    out += (value < 16 ? '0' : '') + value.toString(16);
  }
  return out;
}

function jsonClone_(value) {
  return JSON.parse(JSON.stringify(value));
}

function count_(expr) {
  return expr ? 1 : 0;
}

/* --------------------------- sheet storage ----------------------------- */

var __spreadsheet = null;
var __cache = {};

function resetCache_() {
  __cache = {};
  __spreadsheet = null;
}

function ensureSpreadsheet_() {
  if (__spreadsheet) return __spreadsheet;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  var ss = null;
  if (id) {
    try {
      ss = SpreadsheetApp.openById(id);
    } catch (error) {
      ss = null;
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(SPREADSHEET_TITLE);
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  ensureTables_(ss);
  __spreadsheet = ss;
  return ss;
}

function ensureTables_(ss) {
  Object.keys(TABLES).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getLastRow() < 1) {
      sheet.getRange(1, 1, 1, TABLES[name].length).setValues([TABLES[name]]);
    }
  });
}

function table_(name) {
  if (__cache[name]) return __cache[name];
  var ss = ensureSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    ensureTables_(ss);
    sheet = ss.getSheetByName(name);
  }
  var values = sheet.getDataRange().getValues();
  var headers = TABLES[name];
  var rows = [];
  for (var r = 1; r < values.length; r += 1) {
    var line = values[r];
    var blank = true;
    for (var c = 0; c < headers.length; c += 1) {
      if (line[c] !== '' && line[c] !== null && line[c] !== undefined) {
        blank = false;
        break;
      }
    }
    if (blank) continue;
    var row = {};
    for (var h = 0; h < headers.length; h += 1) {
      var value = line[h];
      row[headers[h]] = value === null || value === undefined ? '' : value;
    }
    rows.push(row);
  }
  __cache[name] = rows;
  return rows;
}

function saveTable_(name, rows) {
  var ss = ensureSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    ensureTables_(ss);
    sheet = ss.getSheetByName(name);
  }
  var headers = TABLES[name];
  var data = [headers.slice()];
  for (var i = 0; i < rows.length; i += 1) {
    var line = [];
    for (var h = 0; h < headers.length; h += 1) {
      var value = rows[i][headers[h]];
      line.push(value === undefined || value === null ? '' : value);
    }
    data.push(line);
  }
  sheet.clearContents();
  sheet.getRange(1, 1, data.length, headers.length).setValues(data);
  __cache[name] = rows;
}

/* ------------------------------- auth ---------------------------------- */

function currentUser_(req) {
  var token = String(req.token || '');
  if (!token) return null;

  var sessions = table_('sessions');
  var session = null;
  for (var i = 0; i < sessions.length; i += 1) {
    if (String(sessions[i].token) === token) {
      session = sessions[i];
      break;
    }
  }
  if (!session) return null;

  var created = new Date(session.created_at);
  if (!isNaN(created.getTime())) {
    var age = Date.now() - created.getTime();
    if (age > SESSION_DAYS * 24 * 60 * 60 * 1000) {
      var left = sessions.filter(function (item) {
        return String(item.token) !== token;
      });
      saveTable_('sessions', left);
      return null;
    }
  }

  var users = table_('users');
  for (var u = 0; u < users.length; u += 1) {
    if (Number(users[u].id) === Number(session.user_id)) return users[u];
  }
  return null;
}

function requireUser_(req) {
  var user = currentUser_(req);
  if (!user) fail_(401, 'กรุณาเข้าสู่ระบบก่อน');
  return user;
}

function requireRole_(req, role) {
  var user = requireUser_(req);
  if (user.role !== role) fail_(403, 'ไม่มีสิทธิ์ใช้งานส่วนนี้');
  return user;
}

function createSession_(userId) {
  var token =
    Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var sessions = table_('sessions');
  sessions.push({ token: token, user_id: userId, created_at: now_() });
  saveTable_('sessions', sessions);
  return token;
}

function destroySession_(token) {
  if (!token) return;
  var sessions = table_('sessions');
  var left = sessions.filter(function (item) {
    return String(item.token) !== String(token);
  });
  if (left.length !== sessions.length) saveTable_('sessions', left);
}

function userById_(id) {
  var users = table_('users');
  for (var i = 0; i < users.length; i += 1) {
    if (Number(users[i].id) === Number(id)) return users[i];
  }
  return null;
}

function userByUsername_(username) {
  var users = table_('users');
  var needle = String(username || '').toLowerCase();
  for (var i = 0; i < users.length; i += 1) {
    if (String(users[i].username).toLowerCase() === needle) return users[i];
  }
  return null;
}

/* --------------------------- domain helpers ---------------------------- */

function classOfTeacher_(classId, teacherId) {
  var classes = table_('classes');
  for (var i = 0; i < classes.length; i += 1) {
    if (
      Number(classes[i].id) === Number(classId) &&
      Number(classes[i].teacher_id) === Number(teacherId)
    ) {
      return classes[i];
    }
  }
  return null;
}

function classByCode_(code) {
  var needle = String(code || '').toUpperCase();
  var classes = table_('classes');
  for (var i = 0; i < classes.length; i += 1) {
    if (String(classes[i].code).toUpperCase() === needle) return classes[i];
  }
  return null;
}

function isMember_(classId, studentId) {
  var members = table_('members');
  return members.some(function (item) {
    return (
      Number(item.class_id) === Number(classId) &&
      Number(item.student_id) === Number(studentId)
    );
  });
}

function addMember_(classId, studentId) {
  if (isMember_(classId, studentId)) return;
  var members = table_('members');
  members.push({ class_id: classId, student_id: studentId, joined_at: now_() });
  saveTable_('members', members);
}

function removeMember_(classId, studentId) {
  var members = table_('members');
  var left = members.filter(function (item) {
    return !(
      Number(item.class_id) === Number(classId) &&
      Number(item.student_id) === Number(studentId)
    );
  });
  saveTable_('members', left);
}

function activityAccess_(activityId, user) {
  var activities = table_('activities');
  var activity = null;
  for (var i = 0; i < activities.length; i += 1) {
    if (Number(activities[i].id) === Number(activityId)) {
      activity = activities[i];
      break;
    }
  }
  if (!activity) fail_(404, 'ไม่พบใบกิจกรรมนี้');

  var classes = table_('classes');
  var klass = null;
  for (var c = 0; c < classes.length; c += 1) {
    if (Number(classes[c].id) === Number(activity.class_id)) {
      klass = classes[c];
      break;
    }
  }
  if (!klass) fail_(404, 'ไม่พบใบกิจกรรมนี้');

  if (user.role === 'teacher') {
    if (Number(klass.teacher_id) !== Number(user.id)) {
      fail_(403, 'ไม่มีสิทธิ์เข้าถึงใบกิจกรรมนี้');
    }
  } else if (!isMember_(klass.id, user.id)) {
    fail_(403, 'คุณไม่ได้อยู่ในห้องเรียนนี้');
  }

  return { activity: activity, klass: klass };
}

function rubricOf_(activityId) {
  return table_('rubric_items')
    .filter(function (item) {
      return Number(item.activity_id) === Number(activityId);
    })
    .sort(function (a, b) {
      return Number(a.position) - Number(b.position) || Number(a.id) - Number(b.id);
    })
    .map(function (item) {
      return {
        id: Number(item.id),
        label: item.label,
        max_score: Number(item.max_score),
        position: Number(item.position),
      };
    });
}

function submissionOf_(activityId, studentId) {
  var submissions = table_('submissions');
  for (var i = 0; i < submissions.length; i += 1) {
    if (
      Number(submissions[i].activity_id) === Number(activityId) &&
      Number(submissions[i].student_id) === Number(studentId)
    ) {
      return submissions[i];
    }
  }
  return null;
}

function submissionWithScores_(submissionId) {
  var submissions = table_('submissions');
  var submission = null;
  for (var i = 0; i < submissions.length; i += 1) {
    if (Number(submissions[i].id) === Number(submissionId)) {
      submission = submissions[i];
      break;
    }
  }
  if (!submission) return null;

  var scores = table_('submission_scores')
    .filter(function (item) {
      return Number(item.submission_id) === Number(submissionId);
    })
    .map(function (item) {
      return {
        rubric_item_id: Number(item.rubric_item_id),
        score: Number(item.score),
      };
    });

  var copy = jsonClone_(submission);
  copy.id = Number(copy.id);
  copy.activity_id = Number(copy.activity_id);
  copy.student_id = Number(copy.student_id);
  // หน้าเว็บเดิมตรวจสอบฟิลด์ file_name ว่า "มีไฟล์แนบหรือไม่"
  copy.file_name = submission.file_id || '';
  copy.scores = scores;
  return copy;
}

function activityStats_(activityId) {
  var submissions = table_('submissions').filter(function (item) {
    return Number(item.activity_id) === Number(activityId);
  });
  var reviewed = submissions.filter(function (item) {
    return item.status === 'reviewed';
  });
  var passed = reviewed.filter(function (item) {
    return Number(item.passed) === 1;
  });
  var pending = submissions.filter(function (item) {
    return item.status === 'submitted';
  });
  var total = 0;
  var scored = 0;
  for (var i = 0; i < reviewed.length; i += 1) {
    if (reviewed[i].total_score !== '' && reviewed[i].total_score !== null && reviewed[i].total_score !== undefined) {
      total += num_(reviewed[i].total_score, 0);
      scored += 1;
    }
  }
  return {
    reviewed_count: reviewed.length,
    passed_count: passed.length,
    submitted_count: submissions.length,
    pending_count: pending.length,
    avg_score: scored ? total / scored : null,
  };
}

function classActivityCount_(classId) {
  return table_('activities').filter(function (item) {
    return Number(item.class_id) === Number(classId);
  }).length;
}

function classMemberCount_(classId) {
  return table_('members').filter(function (item) {
    return Number(item.class_id) === Number(classId);
  }).length;
}

function classPendingCount_(classId) {
  var activityIds = table_('activities')
    .filter(function (item) {
      return Number(item.class_id) === Number(classId);
    })
    .map(function (item) {
      return Number(item.id);
    });
  return table_('submissions').filter(function (item) {
    return activityIds.indexOf(Number(item.activity_id)) !== -1 && item.status === 'submitted';
  }).length;
}

/* ------------------------------ files ---------------------------------- */

function filesFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FILES_FOLDER_ID');
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (error) {
      /* folder ถูกลบ — สร้างใหม่ */
    }
  }
  var iterator = DriveApp.getFoldersByName(FILES_FOLDER_NAME);
  var folder = iterator.hasNext() ? iterator.next() : DriveApp.createFolder(FILES_FOLDER_NAME);
  props.setProperty('FILES_FOLDER_ID', folder.getId());
  return folder;
}

function saveUploadedFile_(file) {
  if (!file || !file.data) return null;
  var mimeType = String(file.mimeType || '');
  var allowed = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
  ];
  if (allowed.indexOf(mimeType) === -1) {
    fail_(400, 'รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP, GIF) หรือ PDF');
  }
  var bytes;
  try {
    bytes = Utilities.base64Decode(file.data);
  } catch (error) {
    fail_(400, 'อัปโหลดไฟล์ไม่สำเร็จ');
  }
  if (bytes.length > MAX_FILE_BYTES) fail_(400, 'ไฟล์ใหญ่เกิน 15 MB');
  var name = str_(file.name, 200) || 'activity-file';
  var blob = Utilities.newBlob(bytes, mimeType, name);
  var driveFile = filesFolder_().createFile(blob);
  return {
    id: driveFile.getId(),
    name: name,
    mimeType: mimeType,
  };
}

function trashFile_(fileId) {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (error) {
    /* ไฟล์อาจถูกลบไปแล้ว */
  }
}

function trashFilesOfSubmissions_(submissions) {
  submissions.forEach(function (item) {
    if (item.file_id) trashFile_(item.file_id);
  });
}

/* -------------------------------- route -------------------------------- */

function route_(req) {
  var path = String(req.path || '');
  var method = String(req.method || 'GET').toUpperCase();
  var body = req.body || {};
  var match;

  if (method === 'GET' && path === '/api/health') {
    return respond_(200, { ok: true, time: now_() });
  }

  if (method === 'GET' && path === '/api/me') {
    var me = currentUser_(req);
    return respond_(200, { user: me ? publicUser_(me) : null });
  }

  if (method === 'POST' && path === '/api/auth/register') {
    return register_(req);
  }

  if (method === 'POST' && path === '/api/auth/login') {
    return login_(req);
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    destroySession_(req.token);
    return respond_(204, null);
  }

  if (method === 'DELETE' && path === '/api/account') {
    return deleteAccount_(req);
  }

  if (method === 'GET' && path === '/api/teacher/classes') {
    return teacherClasses_(req);
  }

  if (method === 'POST' && path === '/api/teacher/classes') {
    return createClass_(req);
  }

  match = path.match(/^\/api\/teacher\/classes\/(\d+)$/);
  if (match && method === 'GET') return teacherClassDetail_(req, Number(match[1]));
  if (match && method === 'DELETE') return deleteClass_(req, Number(match[1]));

  match = path.match(/^\/api\/teacher\/classes\/(\d+)\/students$/);
  if (match && method === 'POST') return addStudent_(req, Number(match[1]));

  match = path.match(/^\/api\/teacher\/classes\/(\d+)\/students\/import$/);
  if (match && method === 'POST') return importStudents_(req, Number(match[1]));

  match = path.match(/^\/api\/teacher\/classes\/(\d+)\/students\/(\d+)$/);
  if (match && method === 'DELETE') return removeStudent_(req, Number(match[1]), Number(match[2]));

  match = path.match(/^\/api\/classes\/([^/]+)\/roster$/);
  if (match && method === 'GET') return roster_(req, decodeURIComponent(match[1]));

  if (method === 'POST' && path === '/api/student/login-name') {
    return studentLoginName_(req);
  }

  match = path.match(/^\/api\/teacher\/classes\/(\d+)\/activities$/);
  if (match && method === 'POST') return createActivity_(req, Number(match[1]));

  match = path.match(/^\/api\/teacher\/activities\/(\d+)$/);
  if (match && method === 'GET') return teacherActivity_(req, Number(match[1]));
  if (match && method === 'PATCH') return updateActivity_(req, Number(match[1]));

  match = path.match(/^\/api\/teacher\/activities\/(\d+)\/review$/);
  if (match && method === 'POST') return reviewActivity_(req, Number(match[1]));

  match = path.match(/^\/api\/teacher\/activities\/(\d+)\/export-sheet$/);
  if (match && method === 'POST') return exportToSheet_(req, Number(match[1]));

  match = path.match(/^\/api\/teacher\/activities\/(\d+)\/export\.csv$/);
  if (match && method === 'GET') return exportCsv_(req, Number(match[1]));

  if (method === 'GET' && path === '/api/student/classes') {
    return studentClasses_(req);
  }

  if (method === 'POST' && path === '/api/student/join') {
    return studentJoin_(req);
  }

  match = path.match(/^\/api\/student\/classes\/(\d+)$/);
  if (match && method === 'GET') return studentClassDetail_(req, Number(match[1]));

  match = path.match(/^\/api\/student\/activities\/(\d+)$/);
  if (match && method === 'GET') return studentActivity_(req, Number(match[1]));

  match = path.match(/^\/api\/student\/activities\/(\d+)\/submit$/);
  if (match && method === 'POST') return submitActivity_(req, Number(match[1]));

  match = path.match(/^\/api\/files\/(\d+)$/);
  if (match && method === 'GET') return downloadFile_(req, Number(match[1]));

  fail_(404, 'ไม่พบ API นี้');
}

/* ------------------------------- auth ---------------------------------- */

function register_(req) {
  var body = req.body || {};
  var role = body.role === 'student' ? 'student' : body.role === 'teacher' ? 'teacher' : '';
  var name = str_(body.name, 80);
  var username = str_(body.username, 40);
  var password = String(body.password || '');

  if (!role) fail_(400, 'กรุณาเลือกประเภทผู้ใช้');
  if (!name) fail_(400, 'กรุณากรอกชื่อ');
  if (!validUsername_(username)) {
    fail_(400, 'ชื่อผู้ใช้ต้องมี 3–32 ตัวอักษร และใช้ได้เฉพาะตัวอักษร ตัวเลข จุด ขีดกลาง หรือขีดล่าง');
  }
  if (password.length < 6) fail_(400, 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
  if (userByUsername_(username)) fail_(409, 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว');

  var users = table_('users');
  var salt = randomSalt_();
  var user = {
    id: nextId_(users),
    role: role,
    name: name,
    username: username,
    salt: salt,
    password_hash: hashPassword_(password, salt),
    created_at: now_(),
  };
  users.push(user);
  saveTable_('users', users);

  var token = createSession_(user.id);
  return respond_(201, { user: publicUser_(user), token: token });
}

function login_(req) {
  var body = req.body || {};
  var username = str_(body.username, 40);
  var password = String(body.password || '');
  var user = userByUsername_(username);
  if (!user || !verifyPassword_(password, user.salt, user.password_hash)) {
    fail_(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  var token = createSession_(user.id);
  return respond_(200, { user: publicUser_(user), token: token });
}

function deleteAccount_(req) {
  var user = requireRole_(req, 'teacher');
  var body = req.body || {};
  var password = String(body.password || '');
  if (!verifyPassword_(password, user.salt, user.password_hash)) {
    fail_(400, 'รหัสผ่านไม่ถูกต้อง');
  }

  var myClasses = table_('classes').filter(function (item) {
    return Number(item.teacher_id) === Number(user.id);
  });
  myClasses.forEach(function (klass) {
    deleteClassData_(Number(klass.id));
  });

  var classes = table_('classes').filter(function (item) {
    return Number(item.teacher_id) !== Number(user.id);
  });
  saveTable_('classes', classes);

  var users = table_('users').filter(function (item) {
    return Number(item.id) !== Number(user.id);
  });
  saveTable_('users', users);

  var sessions = table_('sessions').filter(function (item) {
    return Number(item.user_id) !== Number(user.id);
  });
  saveTable_('sessions', sessions);

  return respond_(204, null);
}

/* ------------------------------ teacher -------------------------------- */

function teacherClasses_(req) {
  var user = requireRole_(req, 'teacher');
  var classes = table_('classes')
    .filter(function (item) {
      return Number(item.teacher_id) === Number(user.id);
    })
    .sort(function (a, b) {
      return String(b.created_at).localeCompare(String(a.created_at)) || Number(b.id) - Number(a.id);
    })
    .map(function (item) {
      var copy = jsonClone_(item);
      copy.id = Number(copy.id);
      copy.teacher_id = Number(copy.teacher_id);
      copy.student_count = classMemberCount_(copy.id);
      copy.activity_count = classActivityCount_(copy.id);
      copy.pending_count = classPendingCount_(copy.id);
      return copy;
    });
  return respond_(200, { classes: classes });
}

function createClass_(req) {
  var user = requireRole_(req, 'teacher');
  var body = req.body || {};
  var name = str_(body.name, 120);
  var subject = str_(body.subject, 120);
  if (!name) fail_(400, 'กรุณากรอกชื่อห้องเรียน');

  var classes = table_('classes');
  var klass = {
    id: nextId_(classes),
    teacher_id: Number(user.id),
    name: name,
    subject: subject,
    code: makeClassCode_(classes),
    created_at: now_(),
  };
  classes.push(klass);
  saveTable_('classes', classes);

  var copy = jsonClone_(klass);
  copy.student_count = 0;
  copy.activity_count = 0;
  copy.pending_count = 0;
  return respond_(201, { class: copy });
}

function teacherClassDetail_(req, classId) {
  var user = requireRole_(req, 'teacher');
  var klass = classOfTeacher_(classId, user.id);
  if (!klass) fail_(404, 'ไม่พบห้องเรียนนี้');

  var members = table_('members').filter(function (item) {
    return Number(item.class_id) === Number(classId);
  });
  var users = table_('users');
  var activities = table_('activities').filter(function (item) {
    return Number(item.class_id) === Number(classId);
  });
  var activityIds = activities.map(function (item) {
    return Number(item.id);
  });
  var submissions = table_('submissions').filter(function (item) {
    return activityIds.indexOf(Number(item.activity_id)) !== -1;
  });

  var students = members
    .map(function (member) {
      var student = null;
      for (var i = 0; i < users.length; i += 1) {
        if (Number(users[i].id) === Number(member.student_id)) {
          student = users[i];
          break;
        }
      }
      if (!student) return null;
      var mine = submissions.filter(function (item) {
        return Number(item.student_id) === Number(student.id);
      });
      return {
        id: Number(student.id),
        name: student.name,
        username: student.username,
        joined_at: member.joined_at,
        record_count: mine.length,
        reviewed_count: mine.filter(function (item) {
          return item.status === 'reviewed';
        }).length,
      };
    })
    .filter(function (item) {
      return !!item;
    })
    .sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name), 'th');
    });

  var classActivities = activities
    .map(function (item) {
      var mine = submissions.filter(function (sub) {
        return Number(sub.activity_id) === Number(item.id);
      });
      var reviewed = mine.filter(function (sub) {
        return sub.status === 'reviewed';
      });
      var total = 0;
      var scored = 0;
      reviewed.forEach(function (sub) {
        if (sub.total_score !== '' && sub.total_score !== null && sub.total_score !== undefined) {
          total += num_(sub.total_score, 0);
          scored += 1;
        }
      });
      var copy = jsonClone_(item);
      copy.id = Number(copy.id);
      copy.class_id = Number(copy.class_id);
      copy.pass_score = Number(copy.pass_score);
      copy.student_count = members.length;
      copy.submitted_count = mine.length;
      copy.reviewed_count = reviewed.length;
      copy.passed_count = reviewed.filter(function (sub) {
        return Number(sub.passed) === 1;
      }).length;
      copy.avg_score = scored ? total / scored : null;
      copy.rubric_count = table_('rubric_items').filter(function (rubric) {
        return Number(rubric.activity_id) === Number(item.id);
      }).length;
      return copy;
    })
    .sort(function (a, b) {
      return String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id;
    });

  var classCopy = jsonClone_(klass);
  classCopy.id = Number(classCopy.id);
  classCopy.teacher_id = Number(classCopy.teacher_id);
  return respond_(200, {
    class: classCopy,
    students: students,
    activities: classActivities,
  });
}

function deleteClassData_(classId) {
  var activities = table_('activities').filter(function (item) {
    return Number(item.class_id) === Number(classId);
  });
  var activityIds = activities.map(function (item) {
    return Number(item.id);
  });

  var submissions = table_('submissions').filter(function (item) {
    return activityIds.indexOf(Number(item.activity_id)) !== -1;
  });
  trashFilesOfSubmissions_(submissions);
  var submissionIds = submissions.map(function (item) {
    return Number(item.id);
  });

  var scores = table_('submission_scores').filter(function (item) {
    return submissionIds.indexOf(Number(item.submission_id)) === -1;
  });
  saveTable_('submission_scores', scores);

  var leftSubmissions = table_('submissions').filter(function (item) {
    return activityIds.indexOf(Number(item.activity_id)) === -1;
  });
  saveTable_('submissions', leftSubmissions);

  var rubric = table_('rubric_items').filter(function (item) {
    return activityIds.indexOf(Number(item.activity_id)) === -1;
  });
  saveTable_('rubric_items', rubric);

  var leftActivities = table_('activities').filter(function (item) {
    return Number(item.class_id) !== Number(classId);
  });
  saveTable_('activities', leftActivities);

  var members = table_('members').filter(function (item) {
    return Number(item.class_id) !== Number(classId);
  });
  saveTable_('members', members);

  var exports = table_('sheet_exports').filter(function (item) {
    return activityIds.indexOf(Number(item.activity_id)) === -1;
  });
  saveTable_('sheet_exports', exports);
}

function deleteClass_(req, classId) {
  var user = requireRole_(req, 'teacher');
  var klass = classOfTeacher_(classId, user.id);
  if (!klass) fail_(404, 'ไม่พบห้องเรียนนี้');

  deleteClassData_(classId);

  var classes = table_('classes').filter(function (item) {
    return Number(item.id) !== Number(classId);
  });
  saveTable_('classes', classes);
  return respond_(204, null);
}

function removeStudent_(req, classId, studentId) {
  var user = requireRole_(req, 'teacher');
  var klass = classOfTeacher_(classId, user.id);
  if (!klass) fail_(404, 'ไม่พบห้องเรียนนี้');
  if (!isMember_(classId, studentId)) fail_(404, 'ไม่พบนักเรียนคนนี้ในห้องเรียน');

  var activityIds = table_('activities')
    .filter(function (item) {
      return Number(item.class_id) === Number(classId);
    })
    .map(function (item) {
      return Number(item.id);
    });

  var submissions = table_('submissions').filter(function (item) {
    return (
      activityIds.indexOf(Number(item.activity_id)) !== -1 &&
      Number(item.student_id) === Number(studentId)
    );
  });
  trashFilesOfSubmissions_(submissions);
  var submissionIds = submissions.map(function (item) {
    return Number(item.id);
  });

  var scores = table_('submission_scores').filter(function (item) {
    return submissionIds.indexOf(Number(item.submission_id)) === -1;
  });
  saveTable_('submission_scores', scores);

  var left = table_('submissions').filter(function (item) {
    return !(
      activityIds.indexOf(Number(item.activity_id)) !== -1 &&
      Number(item.student_id) === Number(studentId)
    );
  });
  saveTable_('submissions', left);
  removeMember_(classId, studentId);
  return respond_(204, null);
}

function addStudent_(req, classId) {
  var user = requireRole_(req, 'teacher');
  var klass = classOfTeacher_(classId, user.id);
  if (!klass) fail_(404, 'ไม่พบห้องเรียนนี้');

  var body = req.body || {};
  var name = str_(body.name, 80);
  var username = str_(body.username, 40);
  var password = String(body.password || '');
  if (!name) fail_(400, 'กรุณากรอกชื่อนักเรียน');
  if (username && !validUsername_(username)) {
    fail_(400, 'ชื่อผู้ใช้ต้องมี 3–32 ตัวอักษร และใช้ได้เฉพาะตัวอักษร ตัวเลข จุด ขีดกลาง หรือขีดล่าง');
  }

  var users = table_('users');
  if (!username) username = uniqueUsername_(users, klass.code);
  if (!password) password = randomPassword_();

  var student = null;
  for (var i = 0; i < users.length; i += 1) {
    if (String(users[i].username).toLowerCase() === String(username).toLowerCase()) {
      student = users[i];
      break;
    }
  }

  var created = false;
  if (student) {
    if (student.role !== 'student') fail_(409, 'ชื่อผู้ใช้นี้ถูกใช้งานโดยบัญชีครู');
    addMember_(classId, student.id);
  } else {
    if (password.length < 6) fail_(400, 'รหัสผ่านของนักเรียนใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
    var salt = randomSalt_();
    student = {
      id: nextId_(users),
      role: 'student',
      name: name,
      username: username,
      salt: salt,
      password_hash: hashPassword_(password, salt),
      created_at: now_(),
    };
    users.push(student);
    saveTable_('users', users);
    addMember_(classId, student.id);
    created = true;
  }

  return respond_(201, {
    student: { id: Number(student.id), name: student.name, username: student.username },
    created: created,
  });
}

function importStudents_(req, classId) {
  var user = requireRole_(req, 'teacher');
  var klass = classOfTeacher_(classId, user.id);
  if (!klass) fail_(404, 'ไม่พบห้องเรียนนี้');

  var body = req.body || {};
  var raw = Array.isArray(body.names) ? body.names.slice(0, 400) : [];
  var names = [];
  var seen = {};
  raw.forEach(function (item) {
    var name = str_(item, 80);
    if (!name) return;
    var key = name.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    names.push(name);
  });
  if (!names.length) fail_(400, 'ไม่พบชื่อนักเรียนในรายการ');

  var users = table_('users');
  var members = table_('members');
  var existing = members
    .filter(function (item) {
      return Number(item.class_id) === Number(classId);
    })
    .map(function (item) {
      var found = null;
      for (var i = 0; i < users.length; i += 1) {
        if (Number(users[i].id) === Number(item.student_id)) {
          found = users[i];
          break;
        }
      }
      return found ? String(found.name).toLowerCase() : '';
    });

  var added = [];
  var skipped = [];

  names.forEach(function (name) {
    if (existing.indexOf(name.toLowerCase()) !== -1) {
      skipped.push(name);
      return;
    }

    var student = null;
    for (var i = 0; i < users.length; i += 1) {
      if (users[i].role === 'student' && String(users[i].name).toLowerCase() === name.toLowerCase()) {
        student = users[i];
        break;
      }
    }

    if (!student) {
      var username = uniqueUsername_(users, klass.code);
      var salt = randomSalt_();
      student = {
        id: nextId_(users),
        role: 'student',
        name: name,
        username: username,
        salt: salt,
        password_hash: hashPassword_(randomPassword_(), salt),
        created_at: now_(),
      };
      users.push(student);
    }

    members.push({ class_id: classId, student_id: student.id, joined_at: now_() });
    existing.push(name.toLowerCase());
    added.push({ id: Number(student.id), name: student.name, username: student.username });
  });

  saveTable_('users', users);
  saveTable_('members', members);

  return respond_(201, {
    added: added,
    skipped: skipped,
    added_count: added.length,
    skipped_count: skipped.length,
  });
}

/* ------------------------------ roster --------------------------------- */

function roster_(req, code) {
  var klass = classByCode_(str_(code, 12));
  if (!klass) fail_(404, 'ไม่พบห้องเรียนที่ใช้รหัสนี้');

  var users = table_('users');
  var students = table_('members')
    .filter(function (item) {
      return Number(item.class_id) === Number(klass.id);
    })
    .map(function (item) {
      for (var i = 0; i < users.length; i += 1) {
        if (Number(users[i].id) === Number(item.student_id)) {
          return { id: Number(users[i].id), name: users[i].name };
        }
      }
      return null;
    })
    .filter(function (item) {
      return !!item;
    })
    .sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name), 'th');
    });

  return respond_(200, {
    class: {
      id: Number(klass.id),
      name: klass.name,
      subject: klass.subject,
      code: klass.code,
    },
    students: students,
  });
}

function studentLoginName_(req) {
  var body = req.body || {};
  var code = str_(body.code, 12).toUpperCase();
  var studentId = Number(body.student_id);
  var klass = classByCode_(code);
  if (!klass) fail_(404, 'ไม่พบห้องเรียนที่ใช้รหัสนี้');
  if (!isMember_(klass.id, studentId)) {
    fail_(400, 'ชื่อนี้ไม่ได้อยู่ในรายชื่อของห้องเรียนนี้');
  }
  var student = userById_(studentId);
  if (!student || student.role !== 'student') fail_(404, 'ไม่พบนักเรียนคนนี้');

  var token = createSession_(student.id);
  return respond_(200, {
    user: publicUser_(student),
    token: token,
    class: { id: Number(klass.id), name: klass.name },
  });
}

/* ----------------------------- activities ------------------------------ */

function createActivity_(req, classId) {
  var user = requireRole_(req, 'teacher');
  var klass = classOfTeacher_(classId, user.id);
  if (!klass) fail_(404, 'ไม่พบห้องเรียนนี้');

  var body = req.body || {};
  var title = str_(body.title, 160);
  var description = str_(body.description, 4000);
  var mode = body.mode === 'score' ? 'score' : body.mode === 'check' ? 'check' : '';
  var dueDate = str_(body.due_date, 10) || null;
  if (!title) fail_(400, 'กรุณากรอกชื่อใบกิจกรรม');
  if (!mode) fail_(400, 'กรุณาเลือกวิธีตรวจ');
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    fail_(400, 'รูปแบบกำหนดส่งไม่ถูกต้อง');
  }

  var items = [];
  if (mode === 'score') {
    var input = Array.isArray(body.rubric) ? body.rubric : [];
    input.slice(0, 20).forEach(function (item, index) {
      var label = str_(item.label, 160);
      var maxScore = num_(item.max_score, 0);
      if (label && maxScore > 0 && maxScore <= 100) {
        items.push({ label: label, max_score: maxScore, position: index });
      }
    });
    if (!items.length) {
      fail_(400, 'โหมดให้คะแนนต้องมีหัวข้อให้คะแนนอย่างน้อย 1 หัวข้อ (คะแนนเต็มระหว่าง 1–100)');
    }
  }

  var maxTotal = 0;
  items.forEach(function (item) {
    maxTotal += item.max_score;
  });
  var passScore =
    mode === 'score'
      ? Math.min(Math.max(num_(body.pass_score, Math.round(maxTotal * 0.6)), 0), maxTotal)
      : 0;

  var activities = table_('activities');
  var activity = {
    id: nextId_(activities),
    class_id: Number(classId),
    title: title,
    description: description,
    mode: mode,
    pass_score: passScore,
    due_date: dueDate || '',
    created_at: now_(),
  };
  activities.push(activity);
  saveTable_('activities', activities);

  var rubric = table_('rubric_items');
  items.forEach(function (item) {
    rubric.push({
      id: nextId_(rubric),
      activity_id: activity.id,
      label: item.label,
      max_score: item.max_score,
      position: item.position,
    });
  });
  saveTable_('rubric_items', rubric);

  var copy = jsonClone_(activity);
  copy.id = Number(copy.id);
  copy.class_id = Number(copy.class_id);
  copy.pass_score = Number(copy.pass_score);
  copy.rubric = rubricOf_(activity.id);
  return respond_(201, { activity: copy });
}

function updateActivity_(req, activityId) {
  var user = requireRole_(req, 'teacher');
  var access = activityAccess_(activityId, user);
  var activity = access.activity;
  var body = req.body || {};

  var title = body.title === undefined ? activity.title : str_(body.title, 160);
  var description =
    body.description === undefined ? activity.description : str_(body.description, 4000);
  var dueDate =
    body.due_date === undefined ? activity.due_date : str_(body.due_date, 10) || '';
  if (!title) fail_(400, 'กรุณากรอกชื่อใบกิจกรรม');
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    fail_(400, 'รูปแบบกำหนดส่งไม่ถูกต้อง');
  }

  var activities = table_('activities');
  for (var i = 0; i < activities.length; i += 1) {
    if (Number(activities[i].id) === Number(activityId)) {
      activities[i].title = title;
      activities[i].description = description;
      activities[i].due_date = dueDate;
      break;
    }
  }
  saveTable_('activities', activities);

  var updated = null;
  for (var j = 0; j < activities.length; j += 1) {
    if (Number(activities[j].id) === Number(activityId)) {
      updated = jsonClone_(activities[j]);
      break;
    }
  }
  updated.id = Number(updated.id);
  updated.class_id = Number(updated.class_id);
  updated.pass_score = Number(updated.pass_score);
  return respond_(200, { activity: updated });
}

function teacherActivity_(req, activityId) {
  var user = requireRole_(req, 'teacher');
  var access = activityAccess_(activityId, user);
  var activity = access.activity;

  var users = table_('users');
  var members = table_('members').filter(function (item) {
    return Number(item.class_id) === Number(activity.class_id);
  });
  var submissions = table_('submissions').filter(function (item) {
    return Number(item.activity_id) === Number(activityId);
  });
  var scoreRows = table_('submission_scores');
  var rubric = rubricOf_(activityId);

  var rows = members
    .map(function (member) {
      var student = null;
      for (var i = 0; i < users.length; i += 1) {
        if (Number(users[i].id) === Number(member.student_id)) {
          student = users[i];
          break;
        }
      }
      if (!student) return null;

      var submission = null;
      for (var s = 0; s < submissions.length; s += 1) {
        if (Number(submissions[s].student_id) === Number(student.id)) {
          submission = submissions[s];
          break;
        }
      }

      var mapped = null;
      if (submission) {
        var scores = {};
        scoreRows.forEach(function (item) {
          if (Number(item.submission_id) === Number(submission.id)) {
            scores[Number(item.rubric_item_id)] = Number(item.score);
          }
        });
        mapped = {
          id: Number(submission.id),
          file_name: submission.file_id || '',
          status: submission.status,
          passed: submission.passed === '' ? null : Number(submission.passed),
          total_score: submission.total_score === '' ? null : Number(submission.total_score),
          submitted_at: submission.submitted_at,
          reviewed_at: submission.reviewed_at || null,
          feedback: submission.feedback || '',
          text: submission.text || '',
          original_name: submission.original_name || null,
          scores: scores,
        };
      }

      return {
        student: {
          id: Number(student.id),
          name: student.name,
          username: student.username,
        },
        submission: mapped,
      };
    })
    .filter(function (item) {
      return !!item;
    })
    .sort(function (a, b) {
      return String(a.student.name).localeCompare(String(b.student.name), 'th');
    });

  var stats = activityStats_(activityId);
  stats.student_count = members.length;

  var teacher = userById_(access.klass.teacher_id);
  var activityCopy = jsonClone_(activity);
  activityCopy.id = Number(activityCopy.id);
  activityCopy.class_id = Number(activityCopy.class_id);
  activityCopy.pass_score = Number(activityCopy.pass_score);
  activityCopy.class_name = access.klass.name;
  activityCopy.class_code = access.klass.code;
  activityCopy.teacher_id = Number(access.klass.teacher_id);
  activityCopy.teacher_name = teacher ? teacher.name : '';

  return respond_(200, {
    activity: activityCopy,
    class: {
      id: Number(access.klass.id),
      name: access.klass.name,
      code: access.klass.code,
    },
    rubric: rubric,
    rows: rows,
    stats: stats,
  });
}

function reviewActivity_(req, activityId) {
  var user = requireRole_(req, 'teacher');
  var access = activityAccess_(activityId, user);
  var activity = access.activity;
  var body = req.body || {};

  var studentId = Number(body.student_id);
  if (!isMember_(activity.class_id, studentId)) {
    fail_(400, 'นักเรียนคนนี้ไม่ได้อยู่ในห้องเรียน');
  }
  var student = userById_(studentId);
  if (!student || student.role !== 'student') fail_(400, 'ไม่พบนักเรียนคนนี้');

  var feedback = str_(body.feedback, 2000);
  var rubric = rubricOf_(activityId);
  var passed = null;
  var total = null;
  var scores = [];

  if (activity.mode === 'score') {
    var input = body.scores && typeof body.scores === 'object' ? body.scores : {};
    for (var i = 0; i < rubric.length; i += 1) {
      var item = rubric[i];
      var raw = num_(input[item.id], NaN);
      if (!isFinite(raw)) fail_(400, 'กรุณากรอกคะแนน: ' + item.label);
      if (raw < 0 || raw > item.max_score) {
        fail_(400, 'คะแนนของ “' + item.label + '” ต้องอยู่ระหว่าง 0–' + item.max_score);
      }
      scores.push({ itemId: item.id, score: raw });
    }
    total = 0;
    scores.forEach(function (item) {
      total += item.score;
    });
    passed = total >= Number(activity.pass_score) ? 1 : 0;
  } else {
    if (typeof body.passed !== 'boolean') {
      fail_(400, 'กรุณาเลือกผลการตรวจ ผ่าน หรือ ไม่ผ่าน');
    }
    passed = body.passed ? 1 : 0;
  }

  var submissions = table_('submissions');
  var existing = null;
  for (var s = 0; s < submissions.length; s += 1) {
    if (
      Number(submissions[s].activity_id) === Number(activityId) &&
      Number(submissions[s].student_id) === Number(studentId)
    ) {
      existing = submissions[s];
      break;
    }
  }

  var submissionId;
  if (existing) {
    submissionId = Number(existing.id);
    existing.status = 'reviewed';
    existing.reviewer_id = Number(user.id);
    existing.reviewed_at = now_();
    existing.passed = passed;
    existing.total_score = total;
    existing.feedback = feedback;
  } else {
    submissionId = nextId_(submissions);
    submissions.push({
      id: submissionId,
      activity_id: Number(activityId),
      student_id: Number(studentId),
      text: '',
      file_id: '',
      original_name: '',
      submitted_at: now_(),
      status: 'reviewed',
      reviewer_id: Number(user.id),
      reviewed_at: now_(),
      passed: passed,
      total_score: total,
      feedback: feedback,
    });
  }
  saveTable_('submissions', submissions);

  var allScores = table_('submission_scores').filter(function (item) {
    return Number(item.submission_id) !== Number(submissionId);
  });
  scores.forEach(function (item) {
    allScores.push({
      submission_id: submissionId,
      rubric_item_id: item.itemId,
      score: item.score,
    });
  });
  saveTable_('submission_scores', allScores);

  return respond_(200, { submission: submissionWithScores_(submissionId) });
}

/* ----------------------------- export ---------------------------------- */

function activityTabValues_(activityId) {
  var activities = table_('activities');
  var activity = null;
  for (var i = 0; i < activities.length; i += 1) {
    if (Number(activities[i].id) === Number(activityId)) {
      activity = activities[i];
      break;
    }
  }
  if (!activity) fail_(404, 'ไม่พบใบกิจกรรมนี้');

  var classes = table_('classes');
  var klass = null;
  for (var c = 0; c < classes.length; c += 1) {
    if (Number(classes[c].id) === Number(activity.class_id)) {
      klass = classes[c];
      break;
    }
  }
  if (!klass) fail_(404, 'ไม่พบใบกิจกรรมนี้');

  var rubric = rubricOf_(activityId);
  var users = table_('users');
  var members = table_('members').filter(function (item) {
    return Number(item.class_id) === Number(klass.id);
  });
  var submissions = table_('submissions').filter(function (item) {
    return Number(item.activity_id) === Number(activityId);
  });
  var scoreRows = table_('submission_scores');

  var rows = members
    .map(function (member) {
      var student = null;
      for (var u = 0; u < users.length; u += 1) {
        if (Number(users[u].id) === Number(member.student_id)) {
          student = users[u];
          break;
        }
      }
      if (!student) return null;

      var submission = null;
      for (var s = 0; s < submissions.length; s += 1) {
        if (Number(submissions[s].student_id) === Number(student.id)) {
          submission = submissions[s];
          break;
        }
      }

      var scoreMap = {};
      if (submission) {
        scoreRows.forEach(function (item) {
          if (Number(item.submission_id) === Number(submission.id)) {
            scoreMap[Number(item.rubric_item_id)] = Number(item.score);
          }
        });
      }

      return { student: student, submission: submission, scoreMap: scoreMap };
    })
    .filter(function (item) {
      return !!item;
    })
    .sort(function (a, b) {
      return String(a.student.name).localeCompare(String(b.student.name), 'th');
    });

  var reviewed = rows.filter(function (row) {
    return row.submission && row.submission.status === 'reviewed';
  });
  var passed = reviewed.filter(function (row) {
    return Number(row.submission.passed) === 1;
  });
  var average = 0;
  reviewed.forEach(function (row) {
    average += num_(row.submission.total_score, 0);
  });
  if (reviewed.length) average = average / reviewed.length;

  var summary = [
    ['รายการ', 'ค่า'],
    ['ใบกิจกรรม', activity.title],
    ['ห้องเรียน', klass.name + ' (' + klass.code + ')'],
    ['วิธีตรวจ', activity.mode === 'score' ? 'ให้คะแนนรายหัวข้อ' : 'ผ่าน / ไม่ผ่าน'],
    ['เกณฑ์ผ่าน', activity.mode === 'score' ? activity.pass_score : '-'],
    ['กำหนดส่ง', activity.due_date || '-'],
    ['นักเรียนในห้อง', rows.length],
    [
      'ส่งแล้ว',
      rows.filter(function (row) {
        return !!row.submission;
      }).length,
    ],
    ['ตรวจแล้ว', reviewed.length],
    ['ผ่าน', passed.length],
    ['คะแนนเฉลี่ย', Math.round(average * 100) / 100],
    ['สร้างเมื่อ', now_()],
    ['สร้างจาก', 'ระบบตรวจใบกิจกรรม'],
  ];

  var header = ['ชื่อ-นามสกุล', 'ชื่อผู้ใช้'];
  rubric.forEach(function (item) {
    header.push(item.label + ' (เต็ม ' + item.max_score + ')');
  });
  header.push('คะแนนรวม', 'ผลการตรวจ', 'ความคิดเห็น', 'วันที่ส่ง', 'วันที่ตรวจ');

  var detail = rows.map(function (row) {
    var line = [row.student.name, row.student.username];
    rubric.forEach(function (item) {
      var value = row.scoreMap[item.id];
      line.push(value === undefined ? '' : value);
    });
    var submission = row.submission;
    line.push(
      submission && submission.total_score !== '' && submission.total_score !== undefined
        ? Number(submission.total_score)
        : '',
      !submission
        ? 'ยังไม่ส่ง'
        : submission.status === 'reviewed'
        ? Number(submission.passed) === 1
          ? 'ผ่าน'
          : 'ไม่ผ่าน'
        : 'รอตรวจ',
      submission ? submission.feedback || '' : '',
      submission ? submission.submitted_at || '' : '',
      submission && submission.reviewed_at ? submission.reviewed_at : ''
    );
    return line;
  });

  var shortTitle = String(activity.title).replace(/^ใบกิจกรรมที่\s*\d+\s*·\s*/, '').slice(0, 28);
  return {
    activity: activity,
    tabs: [
      { title: 'สรุป · ' + shortTitle, values: summary },
      { title: 'ผลตรวจ · ' + shortTitle, values: [header].concat(detail) },
    ],
  };
}

function exportToSheet_(req, activityId) {
  var user = requireRole_(req, 'teacher');
  activityAccess_(activityId, user);
  var built = activityTabValues_(activityId);
  var tabs = built.tabs;

  var exports = table_('sheet_exports');
  var record = null;
  for (var i = 0; i < exports.length; i += 1) {
    if (Number(exports[i].activity_id) === Number(activityId)) {
      record = exports[i];
      break;
    }
  }

  var spreadsheet = null;
  var updated = false;
  if (record) {
    try {
      spreadsheet = SpreadsheetApp.openById(record.spreadsheet_id);
      updated = true;
    } catch (error) {
      spreadsheet = null;
    }
  }
  if (!spreadsheet) {
    spreadsheet = SpreadsheetApp.create('ผลตรวจ ' + built.activity.title);
  }

  tabs.forEach(function (tab, index) {
    var sheet = spreadsheet.getSheetByName(tab.title);
    if (!sheet) {
      if (index === 0 && spreadsheet.getSheets().length === 1) {
        sheet = spreadsheet.getSheets()[0];
        sheet.setName(tab.title);
      } else {
        sheet = spreadsheet.insertSheet(tab.title);
      }
    }
    sheet.clearContents();
    if (tab.values.length && tab.values[0].length) {
      sheet.getRange(1, 1, tab.values.length, tab.values[0].length).setValues(tab.values);
    }
  });

  var url = spreadsheet.getUrl();
  var spreadsheetId = spreadsheet.getId();

  if (record) {
    record.spreadsheet_id = spreadsheetId;
    record.url = url;
    record.created_at = now_();
  } else {
    exports.push({
      activity_id: Number(activityId),
      spreadsheet_id: spreadsheetId,
      url: url,
      created_at: now_(),
    });
  }
  saveTable_('sheet_exports', exports);

  return respond_(200, {
    url: url,
    spreadsheet_id: spreadsheetId,
    updated: updated,
    mode: 'apps-script',
    tabs: tabs.map(function (tab) {
      return tab.title;
    }),
  });
}

function exportCsv_(req, activityId) {
  var user = requireRole_(req, 'teacher');
  var access = activityAccess_(activityId, user);
  var built = activityTabValues_(activityId);
  var activity = built.activity;
  var detail = built.tabs[1].values;

  var csvCell = function (value) {
    return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
  };
  var lines = detail.map(function (row) {
    return row.map(csvCell).join(',');
  });
  var csv = '\uFEFF' + lines.join('\r\n');
  var name = 'ผลตรวจ-' + activity.title + '.csv';
  return {
    status: 200,
    data: null,
    download: {
      name: name,
      mimeType: 'text/csv',
      base64: Utilities.base64Encode(csv, Utilities.Charset.UTF_8),
    },
  };
}

/* ------------------------------ student -------------------------------- */

function studentClasses_(req) {
  var user = requireRole_(req, 'student');
  var users = table_('users');
  var classes = table_('classes');
  var activities = table_('activities');
  var submissions = table_('submissions');

  var list = table_('members')
    .filter(function (item) {
      return Number(item.student_id) === Number(user.id);
    })
    .map(function (member) {
      var klass = null;
      for (var c = 0; c < classes.length; c += 1) {
        if (Number(classes[c].id) === Number(member.class_id)) {
          klass = classes[c];
          break;
        }
      }
      if (!klass) return null;

      var teacher = null;
      for (var u = 0; u < users.length; u += 1) {
        if (Number(users[u].id) === Number(klass.teacher_id)) {
          teacher = users[u];
          break;
        }
      }

      var classActivities = activities.filter(function (item) {
        return Number(item.class_id) === Number(klass.id);
      });
      var activityIds = classActivities.map(function (item) {
        return Number(item.id);
      });
      var reviewed = submissions.filter(function (item) {
        return (
          activityIds.indexOf(Number(item.activity_id)) !== -1 &&
          Number(item.student_id) === Number(user.id) &&
          item.status === 'reviewed'
        );
      });

      return {
        id: Number(klass.id),
        name: klass.name,
        subject: klass.subject,
        code: klass.code,
        created_at: klass.created_at,
        teacher_name: teacher ? teacher.name : '',
        activity_count: classActivities.length,
        reviewed_count: reviewed.length,
        joined_at: member.joined_at,
      };
    })
    .filter(function (item) {
      return !!item;
    })
    .sort(function (a, b) {
      return String(b.joined_at).localeCompare(String(a.joined_at));
    });

  return respond_(200, { classes: list });
}

function studentClass_(classId, studentId) {
  var klass = null;
  var classes = table_('classes');
  for (var i = 0; i < classes.length; i += 1) {
    if (Number(classes[i].id) === Number(classId)) {
      klass = classes[i];
      break;
    }
  }
  if (!klass || !isMember_(classId, studentId)) return null;
  return klass;
}

function studentJoin_(req) {
  var user = requireRole_(req, 'student');
  var body = req.body || {};
  var code = str_(body.code, 12).toUpperCase();
  if (!code) fail_(400, 'กรุณากรอกรหัสห้องเรียน');
  var klass = classByCode_(code);
  if (!klass) fail_(404, 'ไม่พบห้องเรียนที่ใช้รหัสนี้');
  if (isMember_(klass.id, user.id)) fail_(409, 'คุณอยู่ในห้องเรียนนี้แล้ว');
  addMember_(klass.id, user.id);
  return respond_(201, {
    class: { id: Number(klass.id), name: klass.name, subject: klass.subject },
  });
}

function studentClassDetail_(req, classId) {
  var user = requireRole_(req, 'student');
  var klass = studentClass_(classId, user.id);
  if (!klass) fail_(404, 'ไม่พบห้องเรียนนี้ หรือคุณยังไม่ได้เข้าร่วม');

  var submissions = table_('submissions');
  var activities = table_('activities')
    .filter(function (item) {
      return Number(item.class_id) === Number(classId);
    })
    .map(function (item) {
      var submission = null;
      for (var s = 0; s < submissions.length; s += 1) {
        if (
          Number(submissions[s].activity_id) === Number(item.id) &&
          Number(submissions[s].student_id) === Number(user.id)
        ) {
          submission = submissions[s];
          break;
        }
      }
      var copy = jsonClone_(item);
      copy.id = Number(copy.id);
      copy.class_id = Number(copy.class_id);
      copy.pass_score = Number(copy.pass_score);
      copy.submission_id = submission ? Number(submission.id) : null;
      copy.status = submission ? submission.status : null;
      copy.passed = submission ? (submission.passed === '' ? null : Number(submission.passed)) : null;
      copy.total_score =
        submission && submission.total_score !== ''
          ? Number(submission.total_score)
          : null;
      copy.submitted_at = submission ? submission.submitted_at : null;
      copy.reviewed_at = submission ? submission.reviewed_at || null : null;
      copy.feedback = submission ? submission.feedback || '' : '';
      copy.rubric_count = table_('rubric_items').filter(function (rubric) {
        return Number(rubric.activity_id) === Number(item.id);
      }).length;
      return copy;
    })
    .sort(function (a, b) {
      return String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id;
    });

  var teacher = userById_(klass.teacher_id);
  return respond_(200, {
    class: {
      id: Number(klass.id),
      name: klass.name,
      subject: klass.subject,
      code: klass.code,
      teacher_name: teacher ? teacher.name : '',
    },
    activities: activities,
  });
}

function studentActivity_(req, activityId) {
  var user = requireRole_(req, 'student');
  var access = activityAccess_(activityId, user);
  var activity = access.activity;
  var submission = submissionOf_(activityId, user.id);

  var activityCopy = jsonClone_(activity);
  activityCopy.id = Number(activityCopy.id);
  activityCopy.class_id = Number(activityCopy.class_id);
  activityCopy.pass_score = Number(activityCopy.pass_score);
  activityCopy.class_name = access.klass.name;
  activityCopy.class_code = access.klass.code;

  return respond_(200, {
    activity: activityCopy,
    class: { id: Number(access.klass.id), name: access.klass.name },
    rubric: rubricOf_(activityId),
    submission: submission ? submissionWithScores_(submission.id) : null,
  });
}

function submitActivity_(req, activityId) {
  var user = requireRole_(req, 'student');
  var access = activityAccess_(activityId, user);
  var activity = access.activity;
  var body = req.body || {};
  var text = str_(body.text, 8000);
  var existing = submissionOf_(activityId, user.id);

  if (existing && existing.status === 'reviewed') {
    fail_(409, 'ครูตรวจงานนี้แล้ว จึงไม่สามารถแก้ไขได้');
  }
  if (!text && !req.file && !(existing && (existing.text || existing.file_id))) {
    fail_(400, 'กรุณาพิมพ์คำตอบ หรือแนบไฟล์ใบกิจกรรม');
  }

  var uploaded = req.file ? saveUploadedFile_(req.file) : null;
  var submissions = table_('submissions');

  var submissionId;
  if (existing) {
    submissionId = Number(existing.id);
    if (uploaded && existing.file_id) trashFile_(existing.file_id);
    existing.text = text;
    if (uploaded) {
      existing.file_id = uploaded.id;
      existing.original_name = uploaded.name;
    }
    existing.submitted_at = now_();
    existing.status = 'submitted';
    existing.reviewer_id = '';
    existing.reviewed_at = '';
    existing.passed = '';
    existing.total_score = '';
    existing.feedback = '';
  } else {
    submissionId = nextId_(submissions);
    submissions.push({
      id: submissionId,
      activity_id: Number(activityId),
      student_id: Number(user.id),
      text: text,
      file_id: uploaded ? uploaded.id : '',
      original_name: uploaded ? uploaded.name : '',
      submitted_at: now_(),
      status: 'submitted',
      reviewer_id: '',
      reviewed_at: '',
      passed: '',
      total_score: '',
      feedback: '',
    });
  }
  saveTable_('submissions', submissions);

  var leftScores = table_('submission_scores').filter(function (item) {
    return Number(item.submission_id) !== Number(submissionId);
  });
  saveTable_('submission_scores', leftScores);

  return respond_(201, { submission: submissionWithScores_(submissionId) });
}

/* ------------------------------- files --------------------------------- */

function downloadFile_(req, submissionId) {
  var user = requireUser_(req);
  var submissions = table_('submissions');
  var submission = null;
  for (var i = 0; i < submissions.length; i += 1) {
    if (Number(submissions[i].id) === Number(submissionId)) {
      submission = submissions[i];
      break;
    }
  }
  if (!submission || !submission.file_id) fail_(404, 'ไม่พบไฟล์นี้');

  var activities = table_('activities');
  var activity = null;
  for (var a = 0; a < activities.length; a += 1) {
    if (Number(activities[a].id) === Number(submission.activity_id)) {
      activity = activities[a];
      break;
    }
  }
  if (!activity) fail_(404, 'ไม่พบไฟล์นี้');

  var classes = table_('classes');
  var klass = null;
  for (var c = 0; c < classes.length; c += 1) {
    if (Number(classes[c].id) === Number(activity.class_id)) {
      klass = classes[c];
      break;
    }
  }
  if (!klass) fail_(404, 'ไม่พบไฟล์นี้');

  var allowed =
    (user.role === 'teacher' && Number(klass.teacher_id) === Number(user.id)) ||
    (user.role === 'student' && Number(submission.student_id) === Number(user.id));
  if (!allowed) fail_(403, 'ไม่มีสิทธิ์เข้าถึงไฟล์นี้');

  var file;
  try {
    file = DriveApp.getFileById(submission.file_id);
  } catch (error) {
    fail_(404, 'ไม่พบไฟล์นี้บนเซิร์ฟเวอร์');
  }

  var blob = file.getBlob();
  return {
    status: 200,
    data: null,
    download: {
      name: submission.original_name || file.getName() || 'activity-file',
      mimeType: blob.getContentType() || 'application/octet-stream',
      base64: Utilities.base64Encode(blob.getBytes()),
    },
  };
}

/* ------------------------------- seed ---------------------------------- */

function seedSampleData_() {
  var now = new Date();
  var daysAgo = function (days) {
    return new Date(now.getTime() - days * 86400000).toISOString();
  };
  var daysAhead = function (days) {
    return new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
  };

  var users = [];
  var addUser = function (role, name, username, password) {
    var salt = randomSalt_();
    var user = {
      id: users.length + 1,
      role: role,
      name: name,
      username: username,
      salt: salt,
      password_hash: hashPassword_(password, salt),
      created_at: daysAgo(30),
    };
    users.push(user);
    return user;
  };

  var teacher = addUser('teacher', 'ครูสมชาย ใจดี', 'teacher', '123456');
  var studentNames = [
    ['นภัสสร ใจดี', 'student01'],
    ['กันต์ธีร์ แสงทอง', 'student02'],
    ['ปุณยวีร์ วงศ์ษา', 'student03'],
    ['ธนกฤต พูลสุข', 'student04'],
    ['อรวรรณ ศรีสม', 'student05'],
    ['พีระพัชร กลิ่นหอม', 'student06'],
    ['สิริกัญญา บุญมา', 'student07'],
    ['ภูมิพัฒน์ ใจกล้า', 'student08'],
  ];
  var students = studentNames.map(function (pair) {
    return addUser('student', pair[0], pair[1], '123456');
  });

  var classes = [
    {
      id: 1,
      teacher_id: teacher.id,
      name: 'ป.5/1 วิทยาศาสตร์',
      subject: 'วิทยาศาสตร์และเทคโนโลยี',
      code: 'SCI501',
      created_at: daysAgo(28),
    },
    {
      id: 2,
      teacher_id: teacher.id,
      name: 'ป.5/2 วิทยาศาสตร์',
      subject: 'วิทยาศาสตร์และเทคโนโลยี',
      code: 'SCI502',
      created_at: daysAgo(10),
    },
  ];

  var members = students.map(function (student, index) {
    return {
      class_id: 1,
      student_id: student.id,
      joined_at: daysAgo(27 - index),
    };
  });

  var activities = [];
  var rubric = [];
  var addActivity = function (title, description, mode, passScore, dueDate, rubrics) {
    var activity = {
      id: activities.length + 1,
      class_id: 1,
      title: title,
      description: description,
      mode: mode,
      pass_score: passScore,
      due_date: dueDate,
      created_at: daysAgo(14),
    };
    activities.push(activity);
    rubrics.forEach(function (item, index) {
      rubric.push({
        id: rubric.length + 1,
        activity_id: activity.id,
        label: item[0],
        max_score: item[1],
        position: index,
      });
    });
    return activity;
  };

  var water = addActivity(
    'ใบกิจกรรมที่ 1 · วัฏจักรน้ำ',
    'ให้นักเรียนอธิบายวัฏจักรน้ำเป็นขั้นตอน ตั้งแต่การระเหยจนถึงการไหลกลับสู่แหล่งน้ำ พร้อมยกตัวอย่างจากท้องถิ่นของตนเอง',
    'score',
    8,
    daysAhead(7),
    [
      ['ความถูกต้องของเนื้อหา', 6],
      ['การอธิบายและลำดับขั้นตอน', 4],
      ['ความเรียบร้อยและการนำเสนอ', 2],
    ]
  );

  var gravity = addActivity(
    'ใบกิจกรรมที่ 2 · ทดลองแรงโน้มถ่วง',
    'ทำการทดลองปล่อยวัตถุที่มีน้ำหนักต่างกันจากความสูงเท่ากัน บันทึกผล และสรุปว่าแรงโน้มถ่วงมีผลต่อการตกของวัตถุอย่างไร',
    'check',
    0,
    daysAhead(14),
    []
  );

  addActivity(
    'ใบกิจกรรมที่ 3 · สรุปองค์ความรู้',
    'สรุปสิ่งที่ได้เรียนรู้ในหน่วยแรงและการเคลื่อนที่ เป็นแผนภาพความคิด 1 หน้า',
    'check',
    0,
    '',
    []
  );

  var waterRubric = rubric
    .filter(function (item) {
      return item.activity_id === water.id;
    })
    .map(function (item) {
      return item.id;
    });

  var submissions = [];
  var scores = [];

  var addSubmission = function (activityId, studentId, text, status, options) {
    options = options || {};
    var submission = {
      id: submissions.length + 1,
      activity_id: activityId,
      student_id: studentId,
      text: text,
      file_id: '',
      original_name: '',
      submitted_at: options.submittedAt || daysAgo(3),
      status: status,
      reviewer_id: status === 'reviewed' ? teacher.id : '',
      reviewed_at: status === 'reviewed' ? options.reviewedAt || daysAgo(1) : '',
      passed: status === 'reviewed' ? (options.passed ? 1 : 0) : '',
      total_score: status === 'reviewed' ? options.totalScore : '',
      feedback: status === 'reviewed' ? options.feedback || '' : '',
    };
    submissions.push(submission);
    (options.scores || []).forEach(function (pair) {
      scores.push({
        submission_id: submission.id,
        rubric_item_id: pair[0],
        score: pair[1],
      });
    });
    return submission;
  };

  addSubmission(
    water.id,
    students[0].id,
    'วัฏจักรน้ำเริ่มจากน้ำในทะเลและแม่น้ำได้รับความร้อนจากดวงอาทิตย์แล้วระเหยเป็นไอน้ำ จากนั้นไอน้ำลอยขึ้นไปเจออากาศเย็นจึงควบแน่นเป็นเมฆ เมื่อเมฆมีน้ำหนักมากขึ้นก็ตกลงมาเป็นฝน และไหลกลับลงสู่แหล่งน้ำอีกครั้ง ตัวอย่างในท้องถิ่นคือฝนที่ตกเหนือเขื่อนลำปาว',
    'reviewed',
    {
      passed: true,
      totalScore: 11,
      feedback: 'อธิบายครบทุกขั้นตอนและยกตัวอย่างได้เหมาะสมมาก',
      scores: [
        [waterRubric[0], 6],
        [waterRubric[1], 3],
        [waterRubric[2], 2],
      ],
    }
  );

  addSubmission(
    water.id,
    students[1].id,
    'น้ำระเหยขึ้นไปเป็นไอน้ำ แล้วรวมตัวเป็นเมฆ จากนั้นฝนตกลงมา',
    'reviewed',
    {
      passed: false,
      totalScore: 6,
      feedback: 'ขาดขั้นตอนการควบแน่นและยังไม่ได้ยกตัวอย่างในท้องถิ่น ควรทบทวนแล้วส่งใหม่',
      scores: [
        [waterRubric[0], 3],
        [waterRubric[1], 2],
        [waterRubric[2], 1],
      ],
    }
  );

  addSubmission(
    water.id,
    students[2].id,
    'อธิบายการระเหย การควบแน่น และการตกของฝนครบ แต่ตัวอย่างในท้องถิ่นยังสั้นเกินไป',
    'reviewed',
    {
      passed: true,
      totalScore: 9,
      feedback: 'เนื้อถูกต้อง เพิ่มรายละเอียดตัวอย่างให้ชัดเจนขึ้นอีกเล็กน้อย',
      scores: [
        [waterRubric[0], 5],
        [waterRubric[1], 3],
        [waterRubric[2], 1],
      ],
    }
  );

  addSubmission(
    water.id,
    students[3].id,
    'วัฏจักรน้ำคือการหมุนเวียนของน้ำจากแหล่งน้ำขึ้นไปบนท้องฟ้าแล้วกลับลงมา ประกอบด้วยการระเหย การควบแน่น และการตกของน้ำฝน',
    'submitted'
  );

  addSubmission(
    water.id,
    students[4].id,
    'น้ำจากทะเลระเหยเพราะความร้อนจากดวงอาทิตย์ ไอน้ำลอยขึ้นไปเป็นเมฆ และตกลงมาเป็นฝนลงสู่แม่น้ำ ลำคลอง',
    'submitted'
  );

  addSubmission(
    gravity.id,
    students[0].id,
    'ปล่อยลูกบอลเหล็กและลูกบอลพลาสติกจากความสูง 2 เมตรพร้อมกัน ทั้งสองลูกตกถึงพื้นเวลาไล่เลี่ยกัน แม้จะมีน้ำหนักต่างกัน',
    'submitted'
  );

  addSubmission(
    gravity.id,
    students[2].id,
    'ทดลองปล่อยกระดาษ A4 ขยำและไม่ขยำจากความสูงเท่ากัน พบว่ากระดาษที่ขยำตกถึงพื้นก่อน',
    'submitted'
  );

  addSubmission(
    gravity.id,
    students[3].id,
    'แรงโน้มถ่วงของโลกดึงวัตถุลงสู่พื้น วัตถุที่มีมวลมากจะถูกดึงด้วยแรงมากกว่า แต่ความเร่งจากการตกอยู่ที่ประมาณ 9.8 เมตรต่อวินาที²',
    'reviewed',
    {
      passed: true,
      feedback: 'สรุปผลได้ถูกต้อง และเชื่อมโยงกับความเร่งได้ดี',
    }
  );

  var spreadsheet = ensureSpreadsheet_();
  saveTable_('users', users);
  saveTable_('classes', classes);
  saveTable_('members', members);
  saveTable_('activities', activities);
  saveTable_('rubric_items', rubric);
  saveTable_('submissions', submissions);
  saveTable_('submission_scores', scores);
  saveTable_('sessions', []);
  saveTable_('sheet_exports', []);
  Logger.log('สร้างข้อมูลตัวอย่างเรียบร้อย: ' + spreadsheet.getUrl());
}

/**
 * เรียกจาก editor เพื่อสร้างข้อมูลตัวอย่างซ้ำ (เฉพาะเมื่อยังไม่มีผู้ใช้)
 */
function seedSampleData() {
  resetCache_();
  var users = table_('users');
  if (users.length) {
    Logger.log('มีข้อมูลอยู่แล้ว — ถ้าต้องการเริ่มใหม่ให้รัน clearAllData() ก่อน');
    return;
  }
  seedSampleData_();
  Logger.log('สร้างข้อมูลตัวอย่างเรียบร้อย');
}
