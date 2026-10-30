'use strict';

const { db, all, get, run } = require('../server/db');
const { hashPassword } = require('../server/auth');

const existing = get('SELECT COUNT(*) AS n FROM users');
if (existing.n > 0) {
  console.log('ฐานข้อมูลมีข้อมูลอยู่แล้ว — ข้ามการสร้างข้อมูลตัวอย่าง');
  console.log('หากต้องการเริ่มใหม่ ให้รัน: npm run reset แล้วตามด้วย npm run seed');
  process.exit(0);
}

const now = new Date();
const iso = (date) => date.toISOString();
const daysAgo = (days) => iso(new Date(now.getTime() - days * 86400000));
const daysAhead = (days) => iso(new Date(now.getTime() + days * 86400000)).slice(0, 10);

function addUser(role, name, username, password) {
  const result = run(
    'INSERT INTO users (role, name, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    role,
    name,
    username,
    hashPassword(password),
    daysAgo(30)
  );
  return Number(result.lastInsertRowid);
}

function addActivity(classId, title, description, mode, passScore, dueDate, rubrics) {
  const result = run(
    'INSERT INTO activities (class_id, title, description, mode, pass_score, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    classId,
    title,
    description,
    mode,
    passScore,
    dueDate,
    daysAgo(14)
  );
  const activityId = Number(result.lastInsertRowid);
  rubrics.forEach((item, index) => {
    run(
      'INSERT INTO rubric_items (activity_id, label, max_score, position) VALUES (?, ?, ?, ?)',
      activityId,
      item[0],
      item[1],
      index
    );
  });
  return activityId;
}

function addSubmission(activityId, studentId, text, status, options = {}) {
  const submittedAt = options.submittedAt || daysAgo(3);
  const reviewedAt = status === 'reviewed' ? options.reviewedAt || daysAgo(1) : null;
  const result = run(
    `INSERT INTO submissions
       (activity_id, student_id, text, submitted_at, status, reviewer_id, reviewed_at, passed, total_score, feedback)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    activityId,
    studentId,
    text,
    submittedAt,
    status,
    status === 'reviewed' ? options.reviewerId : null,
    reviewedAt,
    status === 'reviewed' ? (options.passed ? 1 : 0) : null,
    status === 'reviewed' ? options.totalScore ?? null : null,
    status === 'reviewed' ? options.feedback || '' : ''
  );
  const submissionId = Number(result.lastInsertRowid);
  for (const [itemId, score] of options.scores || []) {
    run(
      'INSERT INTO submission_scores (submission_id, rubric_item_id, score) VALUES (?, ?, ?)',
      submissionId,
      itemId,
      score
    );
  }
  return submissionId;
}

const teacherId = addUser('teacher', 'ครูสมชาย ใจดี', 'teacher', '123456');

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
const studentIds = studentNames.map(([name, username]) => addUser('student', name, username, '123456'));

const classResult = run(
  'INSERT INTO classes (teacher_id, name, subject, code, created_at) VALUES (?, ?, ?, ?, ?)',
  teacherId,
  'ป.5/1 วิทยาศาสตร์',
  'วิทยาศาสตร์และเทคโนโลยี',
  'SCI501',
  daysAgo(28)
);
const classId = Number(classResult.lastInsertRowid);

studentIds.forEach((studentId, index) => {
  run(
    'INSERT INTO members (class_id, student_id, joined_at) VALUES (?, ?, ?)',
    classId,
    studentId,
    daysAgo(27 - index)
  );
});

run(
  'INSERT INTO classes (teacher_id, name, subject, code, created_at) VALUES (?, ?, ?, ?, ?)',
  teacherId,
  'ป.5/2 วิทยาศาสตร์',
  'วิทยาศาสตร์และเทคโนโลยี',
  'SCI502',
  daysAgo(10)
);

const waterActivity = addActivity(
  classId,
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

const gravityActivity = addActivity(
  classId,
  'ใบกิจกรรมที่ 2 · ทดลองแรงโน้มถ่วง',
  'ทำการทดลองปล่อยวัตถุที่มีน้ำหนักต่างกันจากความสูงเท่ากัน บันทึกผล และสรุปว่าแรงโน้มถ่วงมีผลต่อการตกของวัตถุอย่างไร',
  'check',
  0,
  daysAhead(14),
  []
);

addActivity(
  classId,
  'ใบกิจกรรมที่ 3 · สรุปองค์ความรู้',
  'สรุปสิ่งที่ได้เรียนรู้ในหน่วยแรงและการเคลื่อนที่ เป็นแผนภาพความคิด 1 หน้า',
  'check',
  0,
  null,
  []
);

const waterRubric = all(
  'SELECT id FROM rubric_items WHERE activity_id = ? ORDER BY position',
  waterActivity
).map((row) => row.id);

addSubmission(
  waterActivity,
  studentIds[0],
  'วัฏจักรน้ำเริ่มจากน้ำในทะเลและแม่น้ำได้รับความร้อนจากดวงอาทิตย์แล้วระเหยเป็นไอน้ำ จากนั้นไอน้ำลอยขึ้นไปเจออากาศเย็นจึงควบแน่นเป็นเมฆ เมื่อเมฆมีน้ำหนักมากขึ้นก็ตกลงมาเป็นฝน และไหลกลับลงสู่แหล่งน้ำอีกครั้ง ตัวอย่างในท้องถิ่นคือฝนที่ตกเหนือเขื่อนลำปาว',
  'reviewed',
  {
    reviewerId: teacherId,
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
  waterActivity,
  studentIds[1],
  'น้ำระเหยขึ้นไปเป็นไอน้ำ แล้วรวมตัวเป็นเมฆ จากนั้นฝนตกลงมา',
  'reviewed',
  {
    reviewerId: teacherId,
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
  waterActivity,
  studentIds[2],
  'อธิบายการระเหย การควบแน่น และการตกของฝนครบ แต่ตัวอย่างในท้องถิ่นยังสั้นเกินไป',
  'reviewed',
  {
    reviewerId: teacherId,
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
  waterActivity,
  studentIds[3],
  'วัฏจักรน้ำคือการหมุนเวียนของน้ำจากแหล่งน้ำขึ้นไปบนท้องฟ้าแล้วกลับลงมา ประกอบด้วยการระเหย การควบแน่น และการตกของน้ำฝน',
  'submitted'
);

addSubmission(
  waterActivity,
  studentIds[4],
  'น้ำจากทะเลระเหยเพราะความร้อนจากดวงอาทิตย์ ไอน้ำลอยขึ้นไปเป็นเมฆ และตกลงมาเป็นฝนลงสู่แม่น้ำ ลำคลอง',
  'submitted'
);

addSubmission(
  gravityActivity,
  studentIds[0],
  'ปล่อยลูกบอลเหล็กและลูกบอลพลาสติกจากความสูง 2 เมตรพร้อมกัน ทั้งสองลูกตกถึงพื้นเวลาไล่เลี่ยกัน แม้จะมีน้ำหนักต่างกัน',
  'submitted'
);

addSubmission(
  gravityActivity,
  studentIds[2],
  'ทดลองปล่อยกระดาษ A4 ขยำและไม่ขยำจากความสูงเท่ากัน พบว่ากระดาษที่ขยำตกถึงพื้นก่อน',
  'submitted'
);

addSubmission(
  gravityActivity,
  studentIds[3],
  'แรงโน้มถ่วงของโลกดึงวัตถุลงสู่พื้น วัตถุที่มีมวลมากจะถูกดึงด้วยแรงมากกว่า แต่ความเร่งจากการตกอยู่ที่ประมาณ 9.8 เมตรต่อวินาที²',
  'reviewed',
  {
    reviewerId: teacherId,
    passed: true,
    feedback: 'สรุปผลได้ถูกต้อง และเชื่อมโยงกับความเร่งได้ดี',
  }
);

console.log('สร้างข้อมูลตัวอย่างเรียบร้อย');
console.log('  ครู:      teacher / 123456');
console.log('  นักเรียน: student01 – student08 / 123456');
console.log('  รหัสห้อง: SCI501 (มีข้อมูล) และ SCI502 (ห้องว่าง)');
db.close();
