'use strict';

/* สร้างข้อมูลสำหรับแท็บ Google Sheets ของใบกิจกรรมหนึ่งใบ */

const { all, get } = require('./db');

function rubricOf(activityId) {
  return all(
    'SELECT id, label, max_score, position FROM rubric_items WHERE activity_id = ? ORDER BY position, id',
    activityId
  );
}

function buildActivityTabs(activityId) {
  const activity = get(
    `SELECT a.*, c.name AS class_name, c.code AS class_code, c.id AS class_id
       FROM activities a JOIN classes c ON c.id = a.class_id
      WHERE a.id = ?`,
    activityId
  );
  if (!activity) throw new Error('ไม่พบใบกิจกรรมนี้');

  const rubric = rubricOf(activity.id);
  const rows = all(
    `SELECT u.name, u.username, s.status, s.passed, s.total_score, s.feedback,
            s.submitted_at, s.reviewed_at
       FROM members m
       JOIN users u ON u.id = m.student_id
       LEFT JOIN submissions s ON s.student_id = u.id AND s.activity_id = ?
      WHERE m.class_id = ?
      ORDER BY u.name COLLATE NOCASE`,
    activity.id,
    activity.class_id
  );

  const scoreRows = all(
    `SELECT s.student_id, sc.rubric_item_id, sc.score
       FROM submission_scores sc
       JOIN submissions s ON s.id = sc.submission_id
      WHERE s.activity_id = ?`,
    activity.id
  );
  const scoreMap = new Map();
  for (const row of scoreRows) {
    scoreMap.set(`${row.student_id}:${row.rubric_item_id}`, row.score);
  }

  const studentIds = new Map();
  for (const row of all(
    'SELECT u.id, u.username FROM members m JOIN users u ON u.id = m.student_id WHERE m.class_id = ?',
    activity.class_id
  )) {
    studentIds.set(row.username, row.id);
  }

  const reviewed = rows.filter((row) => row.status === 'reviewed');
  const passed = reviewed.filter((row) => row.passed === 1);
  const average = reviewed.length
    ? reviewed.reduce((sum, row) => sum + (Number(row.total_score) || 0), 0) / reviewed.length
    : 0;

  const summary = [
    ['รายการ', 'ค่า'],
    ['ใบกิจกรรม', activity.title],
    ['ห้องเรียน', activity.class_name + ' (' + activity.class_code + ')'],
    ['วิธีตรวจ', activity.mode === 'score' ? 'ให้คะแนนรายหัวข้อ' : 'ผ่าน / ไม่ผ่าน'],
    ['เกณฑ์ผ่าน', activity.mode === 'score' ? activity.pass_score : '-'],
    ['กำหนดส่ง', activity.due_date || '-'],
    ['นักเรียนในห้อง', rows.length],
    ['ส่งแล้ว', rows.filter((row) => row.status).length],
    ['ตรวจแล้ว', reviewed.length],
    ['ผ่าน', passed.length],
    ['คะแนนเฉลี่ย', Math.round(average * 100) / 100],
    ['สร้างเมื่อ', new Date().toISOString()],
    ['สร้างจาก', 'ระบบตรวจใบกิจกรรม'],
  ];

  const header = [
    'ชื่อ-นามสกุล',
    'ชื่อผู้ใช้',
    ...rubric.map((item) => `${item.label} (เต็ม ${item.max_score})`),
    'คะแนนรวม',
    'ผลการตรวจ',
    'ความคิดเห็น',
    'วันที่ส่ง',
    'วันที่ตรวจ',
  ];

  const detail = rows.map((row) => {
    const studentId = studentIds.get(row.username);
    return [
      row.name,
      row.username,
      ...rubric.map((item) => {
        const value = scoreMap.get(`${studentId}:${item.id}`);
        return value === undefined ? '' : value;
      }),
      row.total_score === null || row.total_score === undefined ? '' : row.total_score,
      !row.status ? 'ยังไม่ส่ง' : row.status === 'reviewed' ? (row.passed ? 'ผ่าน' : 'ไม่ผ่าน') : 'รอตรวจ',
      row.feedback || '',
      row.submitted_at || '',
      row.reviewed_at || '',
    ];
  });

  return [
    { title: 'สรุป', values: summary },
    { title: 'ผลตรวจ', values: [header, ...detail] },
  ];
}

module.exports = { buildActivityTabs, rubricOf };
