'use strict';

/*
 * ทดสอบ apps-script/Code.gs แบบออฟไลน์
 * ใช้ mock ของ SpreadsheetApp / DriveApp / Utilities / ContentService
 * แล้วเรียก doGet/doPost เหมือนเว็บจริง
 *
 * รัน: node scripts/test-apps-script.js
 */

const assert = require('node:assert/strict');
const { createMockContext } = require('./apps-script-mock');

/* ----------------------------- harness -------------------------------- */

function call(context, method, apiPath, options) {
  const opts = options || {};
  let output;
  if (method === 'GET') {
    output = context.doGet({
      parameter: {
        path: apiPath,
        token: opts.token || '',
      },
    });
  } else {
    output = context.doPost({
      postData: {
        contents: JSON.stringify({
          method,
          path: apiPath,
          token: opts.token || '',
          body: opts.body || {},
          file: opts.file || null,
        }),
      },
    });
  }
  return JSON.parse(output.content);
}

function expect(result, status) {
  assert.equal(result.status, status, JSON.stringify(result.data));
  return result.data;
}

function run() {
  const mock = createMockContext();
  const context = mock.context;
  const state = mock.state;

  /* -------------------------- setup + seed -------------------------- */
  const setupUrl = context.setup();
  assert.match(setupUrl, /^https:\/\/docs\.google\.com\/spreadsheets\/d\/.+\/edit$/);
  assert.equal(state.spreadsheets.size, 1);
  assert.equal(state.properties.get('SPREADSHEET_ID') !== undefined, true);

  const health = expect(call(context, 'GET', '/api/health'), 200);
  assert.equal(health.ok, true);

  const meAnon = expect(call(context, 'GET', '/api/me'), 200);
  assert.equal(meAnon.user, null);

  const teacherLogin = expect(
    call(context, 'POST', '/api/auth/login', { body: { username: 'teacher', password: '123456' } }),
    200
  );
  assert.equal(teacherLogin.user.role, 'teacher');
  assert.ok(teacherLogin.token);
  const teacherToken = teacherLogin.token;

  const badLogin = call(context, 'POST', '/api/auth/login', {
    body: { username: 'teacher', password: 'wrong' },
  });
  assert.equal(badLogin.status, 401);

  const classes = expect(call(context, 'GET', '/api/teacher/classes', { token: teacherToken }), 200);
  assert.equal(classes.classes.length, 2);
  assert.equal(classes.classes.find((item) => item.code === 'SCI501').student_count, 8);

  const classDetail = expect(
    call(context, 'GET', '/api/teacher/classes/1', { token: teacherToken }),
    200
  );
  assert.equal(classDetail.students.length, 8);
  assert.equal(classDetail.activities.length, 3);

  const roster = expect(call(context, 'GET', '/api/classes/SCI501/roster'), 200);
  assert.equal(roster.students.length, 8);
  assert.equal(roster.students[0].name.length > 0, true);

  /* --------------------------- registration -------------------------- */
  const registered = expect(
    call(context, 'POST', '/api/auth/register', {
      body: {
        role: 'teacher',
        name: 'ครูทดสอบ ระบบใหม่',
        username: 'teacher_new',
        password: '123456',
      },
    }),
    201
  );
  assert.ok(registered.token);
  assert.equal(registered.user.name, 'ครูทดสอบ ระบบใหม่');

  const duplicate = call(context, 'POST', '/api/auth/register', {
    body: { role: 'teacher', name: 'ซ้ำ', username: 'teacher_new', password: '123456' },
  });
  assert.equal(duplicate.status, 409);

  const invalidUser = call(context, 'POST', '/api/auth/register', {
    body: { role: 'teacher', name: 'ผิด', username: 'a b', password: '123456' },
  });
  assert.equal(invalidUser.status, 400);

  const newTeacherToken = registered.token;
  const newClasses = expect(
    call(context, 'GET', '/api/teacher/classes', { token: newTeacherToken }),
    200
  );
  assert.equal(newClasses.classes.length, 0);

  /* ----------------------------- classroom --------------------------- */
  const created = expect(
    call(context, 'POST', '/api/teacher/classes', {
      token: teacherToken,
      body: { name: 'ห้องทดสอบ API', subject: 'วิทยาศาสตร์' },
    }),
    201
  );
  const classId = created.class.id;
  assert.match(created.class.code, /^[A-Z2-9]{6}$/);

  const added = expect(
    call(context, 'POST', '/api/teacher/classes/' + classId + '/students', {
      token: teacherToken,
      body: { name: 'เด็กใหม่ ใจดี', username: 'newkid01', password: '123456' },
    }),
    201
  );
  assert.equal(added.created, true);
  assert.equal(added.student.username, 'newkid01');

  const imported = expect(
    call(context, 'POST', '/api/teacher/classes/' + classId + '/students/import', {
      token: teacherToken,
      body: { names: ['เด็กใหม่ ใจดี', 'เด็กนำเข้า หนึ่ง', 'เด็กนำเข้า สอง', 'เด็กนำเข้า หนึ่ง'] },
    }),
    201
  );
  assert.equal(imported.added_count, 2);
  assert.equal(imported.skipped_count, 1);

  const roster2 = expect(
    call(context, 'GET', '/api/classes/' + created.class.code + '/roster'),
    200
  );
  assert.equal(roster2.students.length, 3);

  const studentLogin = expect(
    call(context, 'POST', '/api/student/login-name', {
      body: { code: created.class.code, student_id: added.student.id },
    }),
    200
  );
  assert.ok(studentLogin.token);
  assert.equal(studentLogin.user.role, 'student');
  const studentToken = studentLogin.token;

  const studentClasses = expect(
    call(context, 'GET', '/api/student/classes', { token: studentToken }),
    200
  );
  assert.equal(studentClasses.classes.length, 1);
  assert.equal(studentClasses.classes[0].id, classId);

  /* ---------------------------- activities --------------------------- */
  const activity = expect(
    call(context, 'POST', '/api/teacher/classes/' + classId + '/activities', {
      token: teacherToken,
      body: {
        title: 'ใบกิจกรรมทดสอบ',
        description: 'คำอธิบายทดสอบ',
        mode: 'score',
        due_date: '2026-12-31',
        pass_score: 6,
        rubric: [
          { label: 'หัวข้อ A', max_score: 5 },
          { label: 'หัวข้อ B', max_score: 5 },
        ],
      },
    }),
    201
  );
  assert.equal(activity.activity.rubric.length, 2);
  const activityId = activity.activity.id;
  const rubricA = activity.activity.rubric[0].id;
  const rubricB = activity.activity.rubric[1].id;

  const patched = expect(
    call(context, 'PATCH', '/api/teacher/activities/' + activityId, {
      token: teacherToken,
      body: { title: 'ใบกิจกรรมทดสอบ (แก้ไข)' },
    }),
    200
  );
  assert.equal(patched.activity.title, 'ใบกิจกรรมทดสอบ (แก้ไข)');

  const studentView = expect(
    call(context, 'GET', '/api/student/activities/' + activityId, { token: studentToken }),
    200
  );
  assert.equal(studentView.rubric.length, 2);
  assert.equal(studentView.submission, null);

  /* ------------------------------ submit ----------------------------- */
  const emptySubmit = call(context, 'POST', '/api/student/activities/' + activityId + '/submit', {
    token: studentToken,
    body: {},
  });
  assert.equal(emptySubmit.status, 400);

  const submitted = expect(
    call(context, 'POST', '/api/student/activities/' + activityId + '/submit', {
      token: studentToken,
      body: { text: 'คำตอบของนักเรียน' },
    }),
    201
  );
  assert.equal(submitted.submission.status, 'submitted');

  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const withFile = expect(
    call(context, 'POST', '/api/student/activities/' + activityId + '/submit', {
      token: studentToken,
      body: { text: 'คำตอบพร้อมไฟล์' },
      file: { name: 'งาน.png', mimeType: 'image/png', data: pngBase64 },
    }),
    201
  );
  assert.ok(withFile.submission.file_id);
  assert.ok(withFile.submission.file_name);

  const fileDownload = call(context, 'GET', '/api/files/' + withFile.submission.id, {
    token: studentToken,
  });
  assert.equal(fileDownload.status, 200);
  assert.equal(fileDownload.download.name, 'งาน.png');
  assert.equal(Buffer.from(fileDownload.download.base64, 'base64').length > 0, true);

  const badFileType = call(context, 'POST', '/api/student/activities/' + activityId + '/submit', {
    token: studentToken,
    body: { text: 'ไฟล์ผิด tipo' },
    file: { name: 'x.exe', mimeType: 'application/x-msdownload', data: 'AA==' },
  });
  assert.equal(badFileType.status, 400);

  /* ------------------------------ review ----------------------------- */
  const teacherActivity = expect(
    call(context, 'GET', '/api/teacher/activities/' + activityId, { token: teacherToken }),
    200
  );
  assert.equal(teacherActivity.rows.length, 3);
  assert.equal(teacherActivity.stats.submitted_count, 1);

  const badScore = call(context, 'POST', '/api/teacher/activities/' + activityId + '/review', {
    token: teacherToken,
    body: { student_id: added.student.id, scores: { [rubricA]: 99, [rubricB]: 5 } },
  });
  assert.equal(badScore.status, 400);

  const reviewed = expect(
    call(context, 'POST', '/api/teacher/activities/' + activityId + '/review', {
      token: teacherToken,
      body: {
        student_id: added.student.id,
        scores: { [rubricA]: 4, [rubricB]: 3 },
        feedback: 'ทำได้ดี',
      },
    }),
    200
  );
  assert.equal(reviewed.submission.passed, 1);
  assert.equal(reviewed.submission.total_score, 7);
  assert.equal(reviewed.submission.status, 'reviewed');

  const resubmit = call(context, 'POST', '/api/student/activities/' + activityId + '/submit', {
    token: studentToken,
    body: { text: 'แก้ไข' },
  });
  assert.equal(resubmit.status, 409);

  const studentActivity = expect(
    call(context, 'GET', '/api/student/activities/' + activityId, { token: studentToken }),
    200
  );
  assert.equal(studentActivity.submission.passed, 1);
  assert.equal(studentActivity.submission.scores.length, 2);

  const stats = expect(
    call(context, 'GET', '/api/teacher/activities/' + activityId, { token: teacherToken }),
    200
  );
  assert.equal(stats.stats.reviewed_count, 1);
  assert.equal(stats.stats.passed_count, 1);

  const checkActivity = expect(
    call(context, 'GET', '/api/teacher/activities/2', { token: teacherToken }),
    200
  );
  assert.equal(checkActivity.stats.avg_score, null);

  /* ------------------------------ exports ---------------------------- */
  const csv = call(context, 'GET', '/api/teacher/activities/' + activityId + '/export.csv', {
    token: teacherToken,
  });
  assert.equal(csv.status, 200);
  const csvText = Buffer.from(csv.download.base64, 'base64').toString('utf8');
  assert.equal(csvText.charCodeAt(0), 0xfeff);
  assert.match(csvText, /เด็กใหม่ ใจดี/);
  assert.match(csvText, /หัวข้อ A/);

  const sheetExport = expect(
    call(context, 'POST', '/api/teacher/activities/' + activityId + '/export-sheet', {
      token: teacherToken,
    }),
    200
  );
  assert.match(sheetExport.url, /docs\.google\.com\/spreadsheets/);
  assert.equal(sheetExport.updated, false);
  assert.equal(sheetExport.tabs.length, 2);

  const sheetExportAgain = expect(
    call(context, 'POST', '/api/teacher/activities/' + activityId + '/export-sheet', {
      token: teacherToken,
    }),
    200
  );
  assert.equal(sheetExportAgain.updated, true);
  assert.equal(sheetExportAgain.spreadsheet_id, sheetExport.spreadsheet_id);

  /* --------------------------- permissions --------------------------- */
  const noAuth = call(context, 'GET', '/api/teacher/classes');
  assert.equal(noAuth.status, 401);

  const wrongRole = call(context, 'GET', '/api/teacher/classes', { token: studentToken });
  assert.equal(wrongRole.status, 403);

  const foreignClass = call(context, 'GET', '/api/teacher/classes/' + classId, {
    token: newTeacherToken,
  });
  assert.equal(foreignClass.status, 404);

  const foreignActivity = call(context, 'GET', '/api/teacher/activities/' + activityId, {
    token: newTeacherToken,
  });
  assert.equal(foreignActivity.status, 403);

  /* ----------------------------- deletion ---------------------------- */
  const removeStudent = call(
    context,
    'DELETE',
    '/api/teacher/classes/' + classId + '/students/' + added.student.id,
    { token: teacherToken }
  );
  assert.equal(removeStudent.status, 204);

  const removedRoster = expect(
    call(context, 'GET', '/api/classes/' + created.class.code + '/roster'),
    200
  );
  assert.equal(removedRoster.students.length, 2);

  const deleteClass = call(context, 'DELETE', '/api/teacher/classes/' + classId, {
    token: teacherToken,
  });
  assert.equal(deleteClass.status, 204);

  const goneClass = call(context, 'GET', '/api/teacher/classes/' + classId, {
    token: teacherToken,
  });
  assert.equal(goneClass.status, 404);

  const deleteAccount = call(context, 'DELETE', '/api/account', {
    token: newTeacherToken,
    body: { password: '123456' },
  });
  assert.equal(deleteAccount.status, 204);

  const goneLogin = call(context, 'POST', '/api/auth/login', {
    body: { username: 'teacher_new', password: '123456' },
  });
  assert.equal(goneLogin.status, 401);

  /* ------------------------------- done ------------------------------ */
  console.log('ผ่านทุกการทดสอบ Apps Script backend');
}

run();
