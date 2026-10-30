/*
 * demo-api.js — "backend จำลอง" สำหรับโหมดสาธิตบน GitHub Pages
 *
 * หน้าเว็บจริง (public/app.js) คุยกับ Express ผ่าน fetch('/api/...')
 * ไฟล์นี้ดัก fetch ทุกครั้งที่เรียก /api/* แล้วตอบจากข้อมูลใน localStorage
 * จึงใช้งานได้ครบทุกหน้าจอโดยไม่ต้องมีเซิร์ฟเวอร์
 *
 * ข้อจำกัด: ข้อมูลอยู่เฉพาะในเบราว์เซอร์ของผู้ใช้แต่ละคน ไม่แชร์ระหว่างกัน
 * รหัสผ่านถูกเก็บเป็น plain text (เฉพาะโหมดสาธิต) — ห้ามใช้กับข้อมูลจริง
 */
(function () {
  'use strict';

  const KEY = 'activity-check-demo-v1';
  const VERSION = 1;

  const nowISO = () => new Date().toISOString();
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const daysAhead = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  /* ----------------------------- data store ----------------------------- */

  function seed() {
    const db = {
      users: [],
      classes: [],
      members: [],
      activities: [],
      rubric_items: [],
      submissions: [],
      submission_scores: [],
      session: null,
      seq: {},
    };
    const nextId = (table) => (db.seq[table] = (db.seq[table] || 0) + 1);

    const addUser = (role, name, username, password) => {
      const user = { id: nextId('users'), role, name, username, password, created_at: daysAgo(30) };
      db.users.push(user);
      return user;
    };

    const teacher = addUser('teacher', 'ครูสมชาย ใจดี', 'teacher', '123456');
    const studentNames = [
      ['นภัสสร ใจดี', 'student01'],
      ['กันต์ธีร์ แสงทอง', 'student02'],
      ['ปุณยวีร์ วงศ์ษา', 'student03'],
      ['ธนกฤต พูลสุข', 'student04'],
      ['อรวรรณ ศรีสม', 'student05'],
      ['พีระพัชร กลิ่นหอม', 'student06'],
      ['สิริกัญญา บุญมา', 'student07'],
      ['ภูมิพัฒน์ ใจกล้า', 'student08'],
    ];
    const students = studentNames.map(([name, username]) => addUser('student', name, username, '123456'));

    const klass = {
      id: nextId('classes'),
      teacher_id: teacher.id,
      name: 'ป.5/1 วิทยาศาสตร์',
      subject: 'วิทยาศาสตร์และเทคโนโลยี',
      code: 'SCI501',
      created_at: daysAgo(28),
    };
    db.classes.push(klass);
    db.classes.push({
      id: nextId('classes'),
      teacher_id: teacher.id,
      name: 'ป.5/2 วิทยาศาสตร์',
      subject: 'วิทยาศาสตร์และเทคโนโลยี',
      code: 'SCI502',
      created_at: daysAgo(10),
    });

    students.forEach((student, index) => {
      db.members.push({ class_id: klass.id, student_id: student.id, joined_at: daysAgo(27 - index) });
    });

    const addActivity = (title, description, mode, passScore, dueDate, rubric) => {
      const activity = {
        id: nextId('activities'),
        class_id: klass.id,
        title,
        description,
        mode,
        pass_score: passScore,
        due_date: dueDate,
        created_at: daysAgo(14),
      };
      db.activities.push(activity);
      rubric.forEach(([label, maxScore], index) => {
        db.rubric_items.push({
          id: nextId('rubric_items'),
          activity_id: activity.id,
          label,
          max_score: maxScore,
          position: index,
        });
      });
      return activity;
    };

    const water = addActivity(
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

    const gravity = addActivity(
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
      null,
      []
    );

    const waterRubric = db.rubric_items.filter((item) => item.activity_id === water.id).map((item) => item.id);

    const addSubmission = (activity, student, text, status, options) => {
      const opts = options || {};
      const submission = {
        id: nextId('submissions'),
        activity_id: activity.id,
        student_id: student.id,
        text,
        file_name: null,
        original_name: null,
        submitted_at: opts.submittedAt || daysAgo(3),
        status,
        reviewer_id: status === 'reviewed' ? teacher.id : null,
        reviewed_at: status === 'reviewed' ? daysAgo(1) : null,
        passed: status === 'reviewed' ? (opts.passed ? 1 : 0) : null,
        total_score: status === 'reviewed' ? opts.totalScore ?? null : null,
        feedback: status === 'reviewed' ? opts.feedback || '' : '',
      };
      db.submissions.push(submission);
      (opts.scores || []).forEach(([itemId, score]) => {
        db.submission_scores.push({ submission_id: submission.id, rubric_item_id: itemId, score });
      });
      return submission;
    };

    addSubmission(
      water,
      students[0],
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

    addSubmission(water, students[1], 'น้ำระเหยขึ้นไปเป็นไอน้ำ แล้วรวมตัวเป็นเมฆ จากนั้นฝนตกลงมา', 'reviewed', {
      passed: false,
      totalScore: 6,
      feedback: 'ขาดขั้นตอนการควบแน่นและยังไม่ได้ยกตัวอย่างในท้องถิ่น ควรทบทวนแล้วส่งใหม่',
      scores: [
        [waterRubric[0], 3],
        [waterRubric[1], 2],
        [waterRubric[2], 1],
      ],
    });

    addSubmission(
      water,
      students[2],
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
      water,
      students[3],
      'วัฏจักรน้ำคือการหมุนเวียนของน้ำจากแหล่งน้ำขึ้นไปบนท้องฟ้าแล้วกลับลงมา ประกอบด้วยการระเหย การควบแน่น และการตกของน้ำฝน',
      'submitted'
    );

    addSubmission(
      water,
      students[4],
      'น้ำจากทะเลระเหยเพราะความร้อนจากดวงอาทิตย์ ไอน้ำลอยขึ้นไปเป็นเมฆ และตกลงมาเป็นฝนลงสู่แม่น้ำ ลำคลอง',
      'submitted'
    );

    addSubmission(
      gravity,
      students[0],
      'ปล่อยลูกบอลเหล็กและลูกบอลพลาสติกจากความสูง 2 เมตรพร้อมกัน ทั้งสองลูกตกถึงพื้นเวลาไล่เลี่ยกัน แม้จะมีน้ำหนักต่างกัน',
      'submitted'
    );

    addSubmission(
      gravity,
      students[2],
      'ทดลองปล่อยกระดาษ A4 ขยำและไม่ขยำจากความสูงเท่ากัน พบว่ากระดาษที่ขยำตกถึงพื้นก่อน',
      'submitted'
    );

    addSubmission(
      gravity,
      students[3],
      'แรงโน้มถ่วงของโลกดึงวัตถุลงสู่พื้น วัตถุที่มีมวลมากจะถูกดึงด้วยแรงมากกว่า แต่ความเร่งจากการตกอยู่ที่ประมาณ 9.8 เมตรต่อวินาที²',
      'reviewed',
      { passed: true, feedback: 'สรุปผลได้ถูกต้อง และเชื่อมโยงกับความเร่งได้ดี' }
    );

    return db;
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === VERSION && parsed.db && parsed.db.users) return parsed.db;
      }
    } catch (error) {
      /* ignore corrupted state */
    }
    const fresh = seed();
    save(fresh);
    return fresh;
  }

  function save(db) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ version: VERSION, db }));
    } catch (error) {
      /* storage full or blocked → keep working in memory */
    }
  }

  let db = load();

  const reset = () => {
    db = seed();
    save(db);
  };

  /* ------------------------------- helpers ------------------------------ */

  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const fail = (status, message) => json(status, { error: message });

  const publicUser = (user) =>
    user ? { id: user.id, role: user.role, name: user.name, username: user.username } : null;

  const SESSION_KEY = 'activity-check-demo-session';
  const sessionId = () => Number(window.sessionStorage.getItem(SESSION_KEY) || 0) || null;
  const setSession = (id) => {
    if (id) window.sessionStorage.setItem(SESSION_KEY, String(id));
    else window.sessionStorage.removeItem(SESSION_KEY);
  };
  const currentUser = () => {
    const id = sessionId();
    return id ? db.users.find((u) => u.id === id) || null : null;
  };
  const uniqueName = (code) => {
    const base = String(code || 'stu').toLowerCase().replace(/[^a-z0-9]/g, '') || 'stu';
    for (let i = 1; i < 900; i += 1) {
      const candidate = base + String(i).padStart(2, '0');
      if (!db.users.some((u) => u.username === candidate)) return candidate;
    }
    return base + Math.floor(Math.random() * 1000000);
  };

  const str = (value, max) => String(value == null ? '' : value).trim().slice(0, max || 300);

  const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const validUsername = (username) => /^[\p{L}\p{N}_.-]{3,32}$/u.test(username);

  const remember = () => {
    db.session = currentUser() ? db.session : null;
    save(db);
  };

  const owner = (klassId, teacher) =>
    db.classes.find((c) => c.id === Number(klassId) && c.teacher_id === teacher.id) || null;

  const isMember = (classId, studentId) =>
    db.members.some((m) => m.class_id === Number(classId) && m.student_id === Number(studentId));

  const rubricOf = (activityId) =>
    db.rubric_items
      .filter((item) => item.activity_id === Number(activityId))
      .sort((a, b) => a.position - b.position || a.id - b.id);

  const scoresOf = (submissionId) =>
    db.submission_scores
      .filter((row) => row.submission_id === Number(submissionId))
      .reduce((acc, row) => {
        acc[row.rubric_item_id] = row.score;
        return acc;
      }, {});

  const submissionOf = (activityId, studentId) =>
    db.submissions.find(
      (s) => s.activity_id === Number(activityId) && s.student_id === Number(studentId)
    ) || null;

  const submissionPayload = (submission) => {
    if (!submission) return null;
    return Object.assign({}, submission, { scores: scoresOf(submission.id) });
  };

  function activityAccess(activityId, user) {
    const activity = db.activities.find((a) => a.id === Number(activityId));
    if (!activity) return { error: [404, 'ไม่พบใบกิจกรรมนี้'] };
    const klass = db.classes.find((c) => c.id === activity.class_id);
    const teacher = db.users.find((u) => u.id === klass.teacher_id);
    if (user.role === 'teacher') {
      if (klass.teacher_id !== user.id) return { error: [403, 'ไม่มีสิทธิ์เข้าถึงใบกิจกรรมนี้'] };
    } else if (!isMember(activity.class_id, user.id)) {
      return { error: [403, 'คุณไม่ได้อยู่ในห้องเรียนนี้'] };
    }
    return {
      activity,
      klass,
      teacherName: teacher ? teacher.name : '',
    };
  }

  function activityStats(activityId) {
    const rows = db.submissions.filter((s) => s.activity_id === Number(activityId));
    const reviewed = rows.filter((s) => s.status === 'reviewed');
    const passed = reviewed.filter((s) => s.passed === 1);
    const avg = reviewed.length
      ? reviewed.reduce((sum, s) => sum + (Number(s.total_score) || 0), 0) / reviewed.length
      : null;
    return {
      reviewed_count: reviewed.length,
      passed_count: passed.length,
      submitted_count: rows.length,
      pending_count: rows.filter((s) => s.status === 'submitted').length,
      avg_score: avg,
    };
  }

  const classCount = (classId) => db.members.filter((m) => m.class_id === Number(classId)).length;

  const csvCell = (value) => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';

  function buildCsv(activity) {
    const rubric = rubricOf(activity.id);
    const members = db.members
      .filter((m) => m.class_id === activity.class_id)
      .map((m) => db.users.find((u) => u.id === m.student_id))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));
    const header = [
      'ชื่อ-นามสกุล',
      'ชื่อผู้ใช้',
      ...rubric.map((item) => item.label + ' (เต็ม ' + item.max_score + ')'),
      'คะแนนรวม',
      'ผลการตรวจ',
      'ความคิดเห็น',
      'วันที่ส่ง',
      'วันที่ตรวจ',
    ];
    const lines = [header.map(csvCell).join(',')];
    members.forEach((student) => {
      const submission = submissionOf(activity.id, student.id);
      const scores = rubric.map((item) => {
        const map = submission ? scoresOf(submission.id) : {};
        return map[item.id] === undefined ? '' : map[item.id];
      });
      const result =
        !submission || submission.status !== 'reviewed'
          ? 'ยังไม่ตรวจ'
          : submission.passed
          ? 'ผ่าน'
          : 'ไม่ผ่าน';
      lines.push(
        [
          student.name,
          student.username,
          ...scores,
          submission ? submission.total_score ?? '' : '',
          result,
          submission ? submission.feedback || '' : '',
          submission ? submission.submitted_at || '' : '',
          submission && submission.reviewed_at ? submission.reviewed_at : '',
        ]
          .map(csvCell)
          .join(',')
      );
    });
    return '\uFEFF' + lines.join('\r\n');
  }

  /* ------------------------------- routes ------------------------------- */

  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

  const notLoggedIn = () => fail(401, 'กรุณาเข้าสู่ระบบก่อน');
  const wrongRole = () => fail(403, 'ไม่มีสิทธิ์ใช้งานส่วนนี้');

  route('GET', /^\/api\/health$/, () => json(200, { ok: true, time: nowISO() }));

  route('GET', /^\/api\/me$/, () => json(200, { user: publicUser(currentUser()) }));

  route('POST', /^\/api\/auth\/register$/, (_m, body) => {
    const role = body.role === 'student' ? 'student' : body.role === 'teacher' ? 'teacher' : '';
    const name = str(body.name, 80);
    const username = str(body.username, 40);
    const password = String(body.password || '');
    if (!role) return fail(400, 'กรุณาเลือกประเภทผู้ใช้');
    if (!name) return fail(400, 'กรุณากรอกชื่อ');
    if (!validUsername(username)) {
      return fail(
        400,
        'ชื่อผู้ใช้ต้องมี 3–32 ตัวอักษร และใช้ได้เฉพาะตัวอักษร ตัวเลข จุด ขีดกลาง หรือขีดล่าง'
      );
    }
    if (password.length < 6) return fail(400, 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
    if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
      return fail(409, 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว');
    }
    const user = {
      id: (db.seq.users = (db.seq.users || 0) + 1),
      role,
      name,
      username,
      password,
      created_at: nowISO(),
    };
    db.users.push(user);
    setSession(user.id);
    save(db);
    return json(201, { user: publicUser(user) });
  });

  route('POST', /^\/api\/auth\/login$/, (_m, body) => {
    const username = str(body.username, 40).toLowerCase();
    const password = String(body.password || '');
    const user = db.users.find((u) => u.username.toLowerCase() === username);
    if (!user || user.password !== password) return fail(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    setSession(user.id);
    save(db);
    return json(200, { user: publicUser(user) });
  });

  route('POST', /^\/api\/auth\/logout$/, () => {
    setSession(null);
    save(db);
    return new Response(null, { status: 204 });
  });

  route('DELETE', /^\/api\/account$/, (user, body) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'teacher') return wrongRole();
    if (user.password !== String(body.password || '')) return fail(400, 'รหัสผ่านไม่ถูกต้อง');

    const classIds = db.classes.filter((c) => c.teacher_id === user.id).map((c) => c.id);
    const activityIds = db.activities.filter((a) => classIds.includes(a.class_id)).map((a) => a.id);
    db.submissions = db.submissions.filter((s) => !activityIds.includes(s.activity_id));
    db.submission_scores = db.submission_scores.filter((row) =>
      db.submissions.some((s) => s.id === row.submission_id)
    );
    db.activities = db.activities.filter((a) => !classIds.includes(a.class_id));
    db.rubric_items = db.rubric_items.filter((item) => db.activities.some((a) => a.id === item.activity_id));
    db.members = db.members.filter((m) => !classIds.includes(m.class_id));
    db.classes = db.classes.filter((c) => !classIds.includes(c.id));
    db.users = db.users.filter((u) => u.id !== user.id);
    setSession(null);
    save(db);
    return new Response(null, { status: 204 });
  });

  route('GET', /^\/api\/teacher\/classes$/, (user) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'teacher') return wrongRole();
    const classes = db.classes
      .filter((c) => c.teacher_id === user.id)
      .map((c) => {
        const activities = db.activities.filter((a) => a.class_id === c.id);
        const pending = db.submissions.filter(
          (s) => s.status === 'submitted' && activities.some((a) => a.id === s.activity_id)
        ).length;
        return Object.assign({}, c, {
          student_count: classCount(c.id),
          activity_count: activities.length,
          pending_count: pending,
        });
      })
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return json(200, { classes });
  });

  route('POST', /^\/api\/teacher\/classes$/, (user, body) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'teacher') return wrongRole();
    const name = str(body.name, 120);
    const subject = str(body.subject, 120);
    if (!name) return fail(400, 'กรุณากรอกชื่อห้องเรียน');
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    } while (db.classes.some((c) => c.code === code));
    const klass = {
      id: (db.seq.classes = (db.seq.classes || 0) + 1),
      teacher_id: user.id,
      name,
      subject,
      code,
      created_at: nowISO(),
    };
    db.classes.push(klass);
    save(db);
    return json(201, {
      class: Object.assign({}, klass, { student_count: 0, activity_count: 0, pending_count: 0 }),
    });
  });

  route('GET', /^\/api\/teacher\/classes\/(\d+)$/, (user, _body, params) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'teacher') return wrongRole();
    const klass = owner(params[0], user);
    if (!klass) return fail(404, 'ไม่พบห้องเรียนนี้');

    const students = db.members
      .filter((m) => m.class_id === klass.id)
      .map((m) => {
        const student = db.users.find((u) => u.id === m.student_id);
        if (!student) return null;
        const activityIds = db.activities.filter((a) => a.class_id === klass.id).map((a) => a.id);
        const records = db.submissions.filter(
          (s) => s.student_id === student.id && activityIds.includes(s.activity_id)
        );
        return {
          id: student.id,
          name: student.name,
          username: student.username,
          joined_at: m.joined_at,
          record_count: records.length,
          reviewed_count: records.filter((s) => s.status === 'reviewed').length,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));

    const activities = db.activities
      .filter((a) => a.class_id === klass.id)
      .map((a) => {
        const rows = db.submissions.filter((s) => s.activity_id === a.id);
        const reviewed = rows.filter((s) => s.status === 'reviewed');
        const avg = reviewed.length
          ? reviewed.reduce((sum, s) => sum + (Number(s.total_score) || 0), 0) / reviewed.length
          : null;
        return Object.assign({}, a, {
          student_count: classCount(klass.id),
          submitted_count: rows.length,
          reviewed_count: reviewed.length,
          passed_count: reviewed.filter((s) => s.passed === 1).length,
          avg_score: avg,
          rubric_count: rubricOf(a.id).length,
        });
      })
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id);

    return json(200, { class: klass, students, activities });
  });

  route('DELETE', /^\/api\/teacher\/classes\/(\d+)$/, (user, _body, params) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'teacher') return wrongRole();
    const klass = owner(params[0], user);
    if (!klass) return fail(404, 'ไม่พบห้องเรียนนี้');
    const activities = db.activities.filter((a) => a.class_id === klass.id).map((a) => a.id);
    db.submissions = db.submissions.filter((s) => !activities.includes(s.activity_id));
    db.submission_scores = db.submission_scores.filter((row) =>
      db.submissions.some((s) => s.id === row.submission_id)
    );
    db.activities = db.activities.filter((a) => a.class_id !== klass.id);
    db.rubric_items = db.rubric_items.filter((item) => db.activities.some((a) => a.id === item.activity_id));
    db.members = db.members.filter((m) => m.class_id !== klass.id);
    db.classes = db.classes.filter((c) => c.id !== klass.id);
    save(db);
    return new Response(null, { status: 204 });
  });

  route('DELETE', /^\/api\/teacher\/classes\/(\d+)\/students\/(\d+)$/, (user, _body, params) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'teacher') return wrongRole();
    const klass = owner(params[0], user);
    if (!klass) return fail(404, 'ไม่พบห้องเรียนนี้');
    const studentId = Number(params[1]);
    if (!isMember(klass.id, studentId)) return fail(404, 'ไม่พบนักเรียนคนนี้ในห้องเรียน');
    const activities = db.activities.filter((a) => a.class_id === klass.id).map((a) => a.id);
    const removed = db.submissions
      .filter((s) => s.student_id === studentId && activities.includes(s.activity_id))
      .map((s) => s.id);
    db.submissions = db.submissions.filter((s) => !removed.includes(s.id));
    db.submission_scores = db.submission_scores.filter((row) => !removed.includes(row.submission_id));
    db.members = db.members.filter((m) => !(m.class_id === klass.id && m.student_id === studentId));
    save(db);
    return new Response(null, { status: 204 });
  });

  route('POST', /^\/api\/teacher\/classes\/(\d+)\/students$/, (user, body, params) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'teacher') return wrongRole();
    const klass = owner(params[0], user);
    if (!klass) return fail(404, 'ไม่พบห้องเรียนนี้');

    const name = str(body.name, 80);
    let username = str(body.username, 40);
    const password = String(body.password || '');
    if (!name) return fail(400, 'กรุณากรอกชื่อนักเรียน');
    if (username && !validUsername(username)) {
      return fail(
        400,
        'ชื่อผู้ใช้ต้องมี 3–32 ตัวอักษร และใช้ได้เฉพาะตัวอักษร ตัวเลข จุด ขีดกลาง หรือขีดล่าง'
      );
    }
    if (!username) username = uniqueName(klass.code);

    let student = db.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
    let created = false;
    if (student) {
      if (student.role !== 'student') return fail(409, 'ชื่อผู้ใช้นี้ถูกใช้งานโดยบัญชีครู');
      if (!isMember(klass.id, student.id)) {
        db.members.push({ class_id: klass.id, student_id: student.id, joined_at: nowISO() });
      }
    } else {
      if (password && password.length < 6) return fail(400, 'รหัสผ่านของนักเรียนใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
      student = {
        id: (db.seq.users = (db.seq.users || 0) + 1),
        role: 'student',
        name,
        username,
        password: password || 'demo-' + Math.random().toString(36).slice(2, 10),
        created_at: nowISO(),
      };
      db.users.push(student);
      db.members.push({ class_id: klass.id, student_id: student.id, joined_at: nowISO() });
      created = true;
    }
    save(db);
    return json(201, {
      student: { id: student.id, name: student.name, username: student.username },
      created,
    });
  });

  route('POST', /^\/api\/teacher\/classes\/(\d+)\/activities$/, (user, body, params) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'teacher') return wrongRole();
    const klass = owner(params[0], user);
    if (!klass) return fail(404, 'ไม่พบห้องเรียนนี้');

    const title = str(body.title, 160);
    const description = str(body.description, 4000);
    const mode = body.mode === 'score' ? 'score' : body.mode === 'check' ? 'check' : '';
    const dueDate = str(body.due_date, 10) || null;
    if (!title) return fail(400, 'กรุณากรอกชื่อใบกิจกรรม');
    if (!mode) return fail(400, 'กรุณาเลือกวิธีตรวจ');
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return fail(400, 'รูปแบบกำหนดส่งไม่ถูกต้อง');

    let items = [];
    if (mode === 'score') {
      items = (Array.isArray(body.rubric) ? body.rubric : [])
        .map((item, index) => ({
          label: str(item.label, 160),
          max_score: num(item.max_score, 0),
          position: index,
        }))
        .filter((item) => item.label && item.max_score > 0 && item.max_score <= 100)
        .slice(0, 20);
      if (!items.length) {
        return fail(400, 'โหมดให้คะแนนต้องมีหัวข้อให้คะแนนอย่างน้อย 1 หัวข้อ (คะแนนเต็มระหว่าง 1–100)');
      }
    }
    const maxTotal = items.reduce((sum, item) => sum + item.max_score, 0);
    const passScore =
      mode === 'score'
        ? Math.min(Math.max(num(body.pass_score, Math.round(maxTotal * 0.6)), 0), maxTotal)
        : 0;

    const activity = {
      id: (db.seq.activities = (db.seq.activities || 0) + 1),
      class_id: klass.id,
      title,
      description,
      mode,
      pass_score: passScore,
      due_date: dueDate,
      created_at: nowISO(),
    };
    db.activities.push(activity);
    items.forEach((item) => {
      db.rubric_items.push({
        id: (db.seq.rubric_items = (db.seq.rubric_items || 0) + 1),
        activity_id: activity.id,
        label: item.label,
        max_score: item.max_score,
        position: item.position,
      });
    });
    save(db);
    return json(201, { activity: Object.assign({}, activity, { rubric: rubricOf(activity.id) }) });
  });

  route('PATCH', /^\/api\/teacher\/activities\/(\d+)$/, (user, body, params) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'teacher') return wrongRole();
    const access = activityAccess(params[0], user);
    if (access.error) return fail(access.error[0], access.error[1]);
    const activity = access.activity;

    const title = body.title === undefined ? activity.title : str(body.title, 160);
    const description =
      body.description === undefined ? activity.description : str(body.description, 4000);
    const dueDate = body.due_date === undefined ? activity.due_date : str(body.due_date, 10) || null;
    if (!title) return fail(400, 'กรุณากรอกชื่อใบกิจกรรม');
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return fail(400, 'รูปแบบกำหนดส่งไม่ถูกต้อง');

    activity.title = title;
    activity.description = description;
    activity.due_date = dueDate;
    save(db);
    return json(200, { activity });
  });

  route('GET', /^\/api\/teacher\/activities\/(\d+)$/, (user, _body, params) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'teacher') return wrongRole();
    const access = activityAccess(params[0], user);
    if (access.error) return fail(access.error[0], access.error[1]);
    const activity = access.activity;

    const rows = db.members
      .filter((m) => m.class_id === activity.class_id)
      .map((m) => db.users.find((u) => u.id === m.student_id))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'th'))
      .map((student) => ({
        student: { id: student.id, name: student.name, username: student.username },
        submission: submissionPayload(submissionOf(activity.id, student.id)),
      }));

    return json(200, {
      activity,
      class: { id: access.klass.id, name: access.klass.name, code: access.klass.code },
      rubric: rubricOf(activity.id),
      rows,
      stats: Object.assign(activityStats(activity.id), { student_count: classCount(activity.class_id) }),
    });
  });

  route('POST', /^\/api\/teacher\/activities\/(\d+)\/review$/, (user, body, params) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'teacher') return wrongRole();
    const access = activityAccess(params[0], user);
    if (access.error) return fail(access.error[0], access.error[1]);
    const activity = access.activity;

    const studentId = Number(body.student_id);
    if (!isMember(activity.class_id, studentId)) return fail(400, 'นักเรียนคนนี้ไม่ได้อยู่ในห้องเรียน');
    const student = db.users.find((u) => u.id === studentId && u.role === 'student');
    if (!student) return fail(400, 'ไม่พบนักเรียนคนนี้');

    const feedback = str(body.feedback, 2000);
    const rubric = rubricOf(activity.id);
    let passed;
    let total = null;
    const scores = [];

    if (activity.mode === 'score') {
      const input = body.scores && typeof body.scores === 'object' ? body.scores : {};
      for (const item of rubric) {
        const raw = num(input[item.id], NaN);
        if (!Number.isFinite(raw)) return fail(400, 'กรุณากรอกคะแนน: ' + item.label);
        if (raw < 0 || raw > item.max_score) {
          return fail(400, 'คะแนนของ “' + item.label + '” ต้องอยู่ระหว่าง 0–' + item.max_score);
        }
        scores.push({ itemId: item.id, score: raw });
      }
      total = scores.reduce((sum, item) => sum + item.score, 0);
      passed = total >= activity.pass_score ? 1 : 0;
    } else {
      if (typeof body.passed !== 'boolean') return fail(400, 'กรุณาเลือกผลการตรวจ ผ่าน หรือ ไม่ผ่าน');
      passed = body.passed ? 1 : 0;
    }

    let submission = submissionOf(activity.id, studentId);
    if (submission) {
      submission.status = 'reviewed';
      submission.reviewer_id = user.id;
      submission.reviewed_at = nowISO();
      submission.passed = passed;
      submission.total_score = total;
      submission.feedback = feedback;
    } else {
      submission = {
        id: (db.seq.submissions = (db.seq.submissions || 0) + 1),
        activity_id: activity.id,
        student_id: studentId,
        text: '',
        file_name: null,
        original_name: null,
        submitted_at: nowISO(),
        status: 'reviewed',
        reviewer_id: user.id,
        reviewed_at: nowISO(),
        passed,
        total_score: total,
        feedback,
      };
      db.submissions.push(submission);
    }

    db.submission_scores = db.submission_scores.filter((row) => row.submission_id !== submission.id);
    scores.forEach((item) => {
      db.submission_scores.push({
        submission_id: submission.id,
        rubric_item_id: item.itemId,
        score: item.score,
      });
    });

    save(db);
    return json(200, { submission: submissionPayload(submission) });
  });

  route('GET', /^\/api\/teacher\/activities\/(\d+)\/export\.csv$/, (user, _body, params) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'teacher') return wrongRole();
    const access = activityAccess(params[0], user);
    if (access.error) return fail(access.error[0], access.error[1]);
    return new Response(buildCsv(access.activity), {
      status: 200,
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
    });
  });

  route('GET', /^\/api\/student\/classes$/, (user) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'student') return wrongRole();
    const classes = db.members
      .filter((m) => m.student_id === user.id)
      .map((m) => {
        const klass = db.classes.find((c) => c.id === m.class_id);
        if (!klass) return null;
        const teacher = db.users.find((u) => u.id === klass.teacher_id);
        const activities = db.activities.filter((a) => a.class_id === klass.id);
        const reviewed = db.submissions.filter(
          (s) => s.student_id === user.id && s.status === 'reviewed' && activities.some((a) => a.id === s.activity_id)
        ).length;
        return {
          id: klass.id,
          name: klass.name,
          subject: klass.subject,
          code: klass.code,
          created_at: klass.created_at,
          teacher_name: teacher ? teacher.name : '',
          activity_count: activities.length,
          reviewed_count: reviewed,
        };
      })
      .filter(Boolean);
    return json(200, { classes });
  });

  route('POST', /^\/api\/student\/join$/, (user, body) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'student') return wrongRole();
    const code = str(body.code, 12).toUpperCase();
    if (!code) return fail(400, 'กรุณากรอกรหัสห้องเรียน');
    const klass = db.classes.find((c) => c.code === code);
    if (!klass) return fail(404, 'ไม่พบห้องเรียนที่ใช้รหัสนี้');
    if (isMember(klass.id, user.id)) return fail(409, 'คุณอยู่ในห้องเรียนนี้แล้ว');
    db.members.push({ class_id: klass.id, student_id: user.id, joined_at: nowISO() });
    save(db);
    return json(201, {
      class: { id: klass.id, name: klass.name, subject: klass.subject },
    });
  });

  route('GET', /^\/api\/student\/classes\/(\d+)$/, (user, _body, params) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'student') return wrongRole();
    const klass = db.classes.find((c) => c.id === Number(params[0]));
    if (!klass || !isMember(klass.id, user.id)) {
      return fail(404, 'ไม่พบห้องเรียนนี้ หรือคุณยังไม่ได้เข้าร่วม');
    }
    const teacher = db.users.find((u) => u.id === klass.teacher_id);
    const activities = db.activities
      .filter((a) => a.class_id === klass.id)
      .map((a) => {
        const submission = submissionOf(a.id, user.id);
        return Object.assign({}, a, {
          submission_id: submission ? submission.id : null,
          status: submission ? submission.status : null,
          passed: submission ? submission.passed : null,
          total_score: submission ? submission.total_score : null,
          submitted_at: submission ? submission.submitted_at : null,
          reviewed_at: submission ? submission.reviewed_at : null,
          feedback: submission ? submission.feedback : null,
          rubric_count: rubricOf(a.id).length,
        });
      })
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id);

    return json(200, {
      class: Object.assign({}, klass, { teacher_name: teacher ? teacher.name : '' }),
      activities,
    });
  });

  route('GET', /^\/api\/student\/activities\/(\d+)$/, (user, _body, params) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'student') return wrongRole();
    const access = activityAccess(params[0], user);
    if (access.error) return fail(access.error[0], access.error[1]);
    const activity = access.activity;
    return json(200, {
      activity,
      class: { id: access.klass.id, name: access.klass.name },
      rubric: rubricOf(activity.id),
      submission: submissionPayload(submissionOf(activity.id, user.id)),
    });
  });

  route('POST', /^\/api\/student\/activities\/(\d+)\/submit$/, (user, body, params) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'student') return wrongRole();
    const access = activityAccess(params[0], user);
    if (access.error) return fail(access.error[0], access.error[1]);
    const activity = access.activity;

    const text = str(body.text, 8000);
    const fileName = body.file ? String(body.file) : '';
    let submission = submissionOf(activity.id, user.id);

    if (submission && submission.status === 'reviewed') {
      return fail(409, 'ครูตรวจงานนี้แล้ว จึงไม่สามารถแก้ไขได้');
    }
    if (!text && !fileName && !(submission && (submission.text || submission.file_name))) {
      return fail(400, 'กรุณาพิมพ์คำตอบ หรือแนบไฟล์ใบกิจกรรม');
    }

    if (submission) {
      submission.text = text;
      submission.file_name = fileName || submission.file_name;
      submission.original_name = fileName || submission.original_name;
      submission.submitted_at = nowISO();
      submission.status = 'submitted';
      submission.reviewer_id = null;
      submission.reviewed_at = null;
      submission.passed = null;
      submission.total_score = null;
      submission.feedback = '';
      db.submission_scores = db.submission_scores.filter((row) => row.submission_id !== submission.id);
    } else {
      submission = {
        id: (db.seq.submissions = (db.seq.submissions || 0) + 1),
        activity_id: activity.id,
        student_id: user.id,
        text,
        file_name: fileName || null,
        original_name: fileName || null,
        submitted_at: nowISO(),
        status: 'submitted',
        reviewer_id: null,
        reviewed_at: null,
        passed: null,
        total_score: null,
        feedback: '',
      };
      db.submissions.push(submission);
    }
    save(db);
    return json(201, { submission: submissionPayload(submission) });
  });

  route('GET', /^\/api\/classes\/([^/]+)\/roster$/, (_user, _body, params) => {
    const code = decodeURIComponent(params[0]).toUpperCase();
    const klass = db.classes.find((c) => c.code === code);
    if (!klass) return fail(404, 'ไม่พบห้องเรียนที่ใช้รหัสนี้');
    const students = db.members
      .filter((m) => m.class_id === klass.id)
      .map((m) => db.users.find((u) => u.id === m.student_id))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'th'))
      .map((u) => ({ id: u.id, name: u.name }));
    return json(200, {
      class: { id: klass.id, name: klass.name, subject: klass.subject, code: klass.code },
      students,
    });
  });

  route('POST', /^\/api\/student\/login-name$/, (_user, body) => {
    const code = String(body.code || '').toUpperCase();
    const studentId = Number(body.student_id);
    const klass = db.classes.find((c) => c.code === code);
    if (!klass) return fail(404, 'ไม่พบห้องเรียนที่ใช้รหัสนี้');
    if (!isMember(klass.id, studentId)) {
      return fail(400, 'ชื่อนี้ไม่ได้อยู่ในรายชื่อของห้องเรียนนี้');
    }
    const student = db.users.find((u) => u.id === studentId && u.role === 'student');
    if (!student) return fail(404, 'ไม่พบนักเรียนคนนี้');
    setSession(student.id);
    save(db);
    return json(200, { user: publicUser(student), class: { id: klass.id, name: klass.name } });
  });

  route('POST', /^\/api\/teacher\/classes\/(\d+)\/students\/import$/, (user, body, params) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'teacher') return wrongRole();
    const klass = owner(params[0], user);
    if (!klass) return fail(404, 'ไม่พบห้องเรียนนี้');

    const raw = Array.isArray(body.names) ? body.names : [];
    const seen = new Set();
    const names = [];
    raw.slice(0, 400).forEach((item) => {
      const name = str(item, 80);
      if (!name) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      names.push(name);
    });
    if (!names.length) return fail(400, 'ไม่พบชื่อนักเรียนในรายการ');

    const existing = db.members
      .filter((m) => m.class_id === klass.id)
      .map((m) => ((db.users.find((u) => u.id === m.student_id) || {}).name || '').toLowerCase());

    const added = [];
    const skipped = [];
    names.forEach((name) => {
      if (existing.includes(name.toLowerCase())) {
        skipped.push(name);
        return;
      }
      let student = db.users.find(
        (u) => u.role === 'student' && u.name.toLowerCase() === name.toLowerCase()
      );
      if (!student) {
        student = {
          id: (db.seq.users = (db.seq.users || 0) + 1),
          role: 'student',
          name,
          username: uniqueName(klass.code),
          password: 'demo',
          created_at: nowISO(),
        };
        db.users.push(student);
      }
      db.members.push({ class_id: klass.id, student_id: student.id, joined_at: nowISO() });
      existing.push(name.toLowerCase());
      added.push({ id: student.id, name: student.name, username: student.username });
    });
    save(db);
    return json(201, {
      added,
      skipped,
      added_count: added.length,
      skipped_count: skipped.length,
    });
  });

  route('POST', /^\/api\/teacher\/activities\/(\d+)\/export-sheet$/, (user) => {
    if (!user) return notLoggedIn();
    if (user.role !== 'teacher') return wrongRole();
    return fail(400, 'โหมดสาธิตไม่รองรับ Google Sheets — กดปุ่ม "เชื่อมเซิร์ฟเวอร์" เพื่อต่อกับเซิร์ฟเวอร์จริงก่อน');
  });

  route('GET', /^\/api\/files\/\d+$/, (user) => {
    if (!user) return notLoggedIn();
    return fail(404, 'โหมดสาธิตไม่รองรับการเปิดไฟล์แนบ');
  });

  /* ------------------------------- runtime ------------------------------ */

  const realFetch = window.fetch.bind(window);
  window.__demoRealFetch = realFetch;

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

  async function bodyOf(init) {
    const raw = init && init.body;
    if (!raw) return {};
    if (typeof FormData !== 'undefined' && raw instanceof FormData) {
      const result = {};
      raw.forEach((value, key) => {
        if (typeof value === 'string') result[key] = value;
        else if (value && value.name) result[key] = value.name;
      });
      return result;
    }
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch (error) {
        return {};
      }
    }
    return {};
  }

  window.fetch = async function (input, init) {
    const path = pathOf(input);
    if (!path) return realFetch(input, init);

    const method = ((init && init.method) || 'GET').toUpperCase();
    const cleanPath = path.split('?')[0];
    const entry = routes.find((item) => item.method === method && item.pattern.test(cleanPath));
    if (!entry) return fail(404, 'ไม่พบคำขอนี้ในโหมดสาธิต');

    const params = cleanPath.match(entry.pattern).slice(1);
    const body = method === 'GET' ? {} : await bodyOf(init);
    try {
      return await entry.handler(currentUser(), body, params);
    } catch (error) {
      console.error('[demo-api]', error);
      return fail(500, 'เกิดข้อผิดพลาดในโหมดสาธิต');
    }
  };

  /* -------------------- CSV download + demo badge ----------------------- */

  document.addEventListener(
    'click',
    (event) => {
      const anchor = event.target && event.target.closest ? event.target.closest('a[href*="/export.csv"]') : null;
      if (!anchor) return;
      if (window.localStorage.getItem('activity-api-base')) return;
      event.preventDefault();
      const match = (anchor.getAttribute('href') || '').match(/activities\/(\d+)\/export\.csv/);
      if (!match) return;
      const activity = db.activities.find((a) => a.id === Number(match[1]));
      if (!activity) return;
      const blob = new Blob([buildCsv(activity)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ผลตรวจ-' + activity.title + '.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },
    true
  );

  function mountBadge() {
    const badge = document.createElement('div');
    badge.setAttribute('data-demo-badge', '');
    badge.style.cssText = [
      'position:fixed',
      'left:16px',
      'bottom:16px',
      'z-index:900',
      'display:flex',
      'align-items:center',
      'gap:10px',
      'background:rgba(14,107,91,.94)',
      'color:#fffdf8',
      'padding:8px 12px',
      'border-radius:999px',
      'font:500 12px/1.4 "IBM Plex Sans Thai",system-ui,sans-serif',
      'box-shadow:0 8px 24px rgba(6,70,59,.28)',
    ].join(';');
    badge.innerHTML =
      '<span>โหมดสาธิต · ข้อมูลเก็บในเบราว์เซอร์นี้</span>' +
      '<button type="button" style="background:rgba(255,255,255,.16);border:0;color:inherit;font:inherit;padding:4px 10px;border-radius:999px;cursor:pointer">รีเซ็ต</button>';
    badge.querySelector('button').addEventListener('click', () => {
      reset();
      window.location.hash = '#/';
      window.location.reload();
    });
    document.body.appendChild(badge);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBadge);
  else mountBadge();

  window.__demoDb = { get: () => db, reset };
})();
