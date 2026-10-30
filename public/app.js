'use strict';

const appEl = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');

const state = {
  user: null,
  authMode: 'login',
  classTab: 'activities',
  teacherClassData: null,
  teacherActivityData: null,
};

/* ---------------------------- utilities ---------------------------- */

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function icon(name, cls = '') {
  return `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function initials(name) {
  const trimmed = String(name || '').trim();
  return trimmed ? Array.from(trimmed)[0] : '?';
}

function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return esc(value);
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return esc(value);
  return date.toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function scoreText(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function statusChip(submission) {
  if (!submission) return '<span class="chip chip-outline">ยังไม่ส่ง</span>';
  if (submission.status === 'reviewed') {
    return submission.passed
      ? `<span class="chip chip-green">${icon('check')}ผ่าน</span>`
      : `<span class="chip chip-red">${icon('x')}ไม่ผ่าน</span>`;
  }
  return `<span class="chip chip-amber">${icon('clock')}รอตรวจ</span>`;
}

function isOverdue(dueDate) {
  if (!dueDate) return false;
  return String(dueDate).slice(0, 10) < todayISO();
}

async function api(path, options = {}) {
  const fetchOptions = {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: options.headers || {},
  };
  if (options.body instanceof FormData) {
    fetchOptions.body = options.body;
  } else if (options.body !== undefined) {
    fetchOptions.headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, fetchOptions);
  if (response.status === 204) return null;
  let data = null;
  try {
    data = await response.json();
  } catch {
    /* non-JSON response */
  }
  if (!response.ok) {
    const error = new Error((data && data.error) || 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    error.status = response.status;
    throw error;
  }
  return data;
}

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.innerHTML = `${icon(type === 'error' ? 'x' : 'check')}<span>${esc(message)}</span>`;
  toastRoot.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s ease';
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

function loadingBlock() {
  return `<div class="loading-block"><div class="spinner"></div></div>`;
}

function emptyState(title, text, action = '', iconName = 'clipboard') {
  return `<div class="empty">
    <div class="empty-icon">${icon(iconName, 'icon-lg')}</div>
    <h3>${esc(title)}</h3>
    <p>${esc(text)}</p>
    ${action}
  </div>`;
}

function setFormError(form, message) {
  let box = form.querySelector('.form-error');
  if (!box) {
    box = document.createElement('div');
    box.className = 'form-error';
    form.prepend(box);
  }
  box.textContent = message;
  box.style.display = message ? '' : 'none';
}

/* ------------------------------ shell ------------------------------ */

function shell(content, active = '') {
  const user = state.user;
  if (!user) return content;
  const home = user.role === 'teacher' ? '#/teacher' : '#/student';
  return `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="${home}">
          <span class="brand-mark">${icon('book', 'icon-lg')}</span>
          <span class="brand-name">ตรวจใบกิจกรรม<small>Activity Check</small></span>
        </a>
        <nav class="topnav">
          <a href="${home}" class="${active === 'home' ? 'active' : ''}">${user.role === 'teacher' ? 'ห้องเรียน' : 'ห้องเรียนของฉัน'}</a>
        </nav>
        <div class="topbar-user">
          <div class="user-chip">
            <span class="avatar">${esc(initials(user.name))}</span>
            <div class="user-meta">
              <strong>${esc(user.name)}</strong>
              <span>${user.role === 'teacher' ? 'ครูผู้สอน' : 'นักเรียน'}</span>
            </div>
          </div>
          <button class="icon-btn" data-action="logout" title="ออกจากระบบ" aria-label="ออกจากระบบ">
            ${icon('logout')}
          </button>
        </div>
      </div>
    </header>
    <main class="page">${content}</main>
  `;
}

function renderErrorPage(error) {
  if (error && error.status === 401) {
    state.user = null;
    return renderAuth();
  }
  appEl.innerHTML = shell(`
    <div class="empty" style="margin-top:5vh">
      <div class="empty-icon">${icon('x', 'icon-lg')}</div>
      <h3>เปิดหน้านี้ไม่สำเร็จ</h3>
      <p>${esc((error && error.message) || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง')}</p>
      <a class="btn btn-primary" href="${state.user && state.user.role === 'teacher' ? '#/teacher' : '#/student'}">กลับหน้าหลัก</a>
    </div>
  `);
}

/* ------------------------------- auth ------------------------------ */

/* ---------------------------- auth panel --------------------------- */

function authPanelHtml(mode) {
  const tabs = `
    <div class="segmented" role="tablist">
      <button type="button" data-auth-tab="login" class="${mode === 'login' ? 'active' : ''}">ครูเข้าสู่ระบบ</button>
      <button type="button" data-auth-tab="student" class="${mode === 'student' ? 'active' : ''}">นักเรียน</button>
      <button type="button" data-auth-tab="register" class="${mode === 'register' ? 'active' : ''}">สมัคร (ครู)</button>
    </div>`;

  if (mode === 'student') {
    return (
      tabs +
      `
      <h2>เข้าเรียน</h2>
      <p class="sub">กรอกรหัสห้องเรียน แล้วเลือกชื่อของตัวเอง — ไม่ต้องสมัคร ไม่ต้องใช้รหัสผ่าน</p>
      <form id="student-auth-form" class="auth-form">
        <div class="field">
          <label for="student-class-code">รหัสห้องเรียน</label>
          <div class="inline-field">
            <input id="student-class-code" name="code" placeholder="เช่น SCI501" maxlength="12" autocomplete="off" required />
            <button type="button" class="btn btn-ghost" id="load-roster">ดูรายชื่อ</button>
          </div>
        </div>
        <div class="field" id="roster-field" hidden>
          <label for="student-pick">ชื่อของฉัน</label>
          <select id="student-pick" name="student_id" required></select>
        </div>
        <button class="btn btn-primary btn-lg btn-block" type="submit" disabled>เข้าเรียน</button>
      </form>`
    );
  }

  if (mode === 'register') {
    return (
      tabs +
      `
      <h2>สมัครบัญชีครู</h2>
      <p class="sub">สำหรับครูผู้สอนเท่านั้น — นักเรียนเข้าเรียนด้วยชื่อได้เลย</p>
      <form id="register-form" class="auth-form">
        <div class="field">
          <label for="register-name">ชื่อ-นามสกุล</label>
          <input id="register-name" name="name" autocomplete="name" placeholder="เช่น ครูสมชาย ใจดี" required />
        </div>
        <div class="field">
          <label for="register-username">ชื่อผู้ใช้</label>
          <input id="register-username" name="username" autocomplete="username" placeholder="3–32 ตัวอักษร" required />
        </div>
        <div class="field">
          <label for="register-password">รหัสผ่าน</label>
          <input id="register-password" name="password" type="password" autocomplete="new-password" placeholder="อย่างน้อย 6 ตัวอักษร" required />
        </div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">สมัครใช้งาน</button>
      </form>`
    );
  }

  return (
    tabs +
    `
    <h2>ยินดีต้อนรับกลับ</h2>
    <p class="sub">เข้าสู่ระบบสำหรับครูผู้สอน</p>
    <form id="login-form" class="auth-form">
      <div class="field">
        <label for="login-username">ชื่อผู้ใช้</label>
        <input id="login-username" name="username" autocomplete="username" placeholder="เช่น teacher" required />
      </div>
      <div class="field">
        <label for="login-password">รหัสผ่าน</label>
        <input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="รหัสผ่านของคุณ" required />
      </div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">เข้าสู่ระบบ</button>
    </form>`
  );
}

function wireStudentLogin() {
  const form = document.getElementById('student-auth-form');
  if (!form) return;

  const codeInput = form.querySelector('#student-class-code');
  const rosterField = form.querySelector('#roster-field');
  const pick = form.querySelector('#student-pick');
  const submit = form.querySelector('button[type="submit"]');
  const loadButton = form.querySelector('#load-roster');
  let loadedCode = '';

  const loadRoster = async () => {
    const code = String(codeInput.value || '').trim().toUpperCase();
    if (!code) return;
    loadButton.disabled = true;
    try {
      const data = await api('/api/classes/' + encodeURIComponent(code) + '/roster');
      loadedCode = code;
      if (!data.students.length) {
        rosterField.hidden = true;
        submit.disabled = true;
        setFormError(form, 'ห้องนี้ยังไม่มีรายชื่อนักเรียน ให้ครูเพิ่มรายชื่อก่อน');
        return;
      }
      pick.innerHTML =
        '<option value="">— เลือกชื่อของฉัน —</option>' +
        data.students
          .map((student) => '<option value="' + student.id + '">' + esc(student.name) + '</option>')
          .join('');
      rosterField.hidden = false;
      submit.disabled = false;
      setFormError(form, '');
    } catch (error) {
      rosterField.hidden = true;
      submit.disabled = true;
      setFormError(form, error.message);
    } finally {
      loadButton.disabled = false;
    }
  };

  loadButton.addEventListener('click', loadRoster);
  codeInput.addEventListener('change', () => {
    if (codeInput.value.trim()) loadRoster();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!pick.value) {
      setFormError(form, 'กรุณาเลือกชื่อของตัวเอง');
      return;
    }
    submit.disabled = true;
    submit.classList.add('btn-loading');
    try {
      const data = await api('/api/student/login-name', {
        method: 'POST',
        body: { code: loadedCode, student_id: Number(pick.value) },
      });
      state.user = data.user;
      toast('ยินดีต้อนรับ ' + data.user.name);
      go('#/student');
    } catch (error) {
      setFormError(form, error.message);
    } finally {
      submit.disabled = false;
      submit.classList.remove('btn-loading');
    }
  });
}

function renderAuth() {
  const mode = state.authMode;
  appEl.innerHTML = `
    <div class="auth">
      <section class="auth-hero">
        <div class="auth-brand">
          <span class="brand-mark">${icon('book', 'icon-lg')}</span>
          <div class="brand-name">ตรวจใบกิจกรรม<small>Activity Check</small></div>
        </div>
        <div class="auth-hero-body">
          <span class="auth-kicker">${icon('spark')} ห้องเรียน · ใบกิจกรรม · ผลตรวจ</span>
          <h1>ตรวจงานทั้งห้อง<br /><em>จบในที่เดียว</em></h1>
          <p class="auth-hero-lead">
            ให้นักเรียนส่งใบกิจกรรมออนไลน์ ครูตรวจผ่าน–ไม่ผ่าน หรือให้คะแนนรายหัวข้อ
            พร้อมสรุปผลและส่งออกไฟล์ได้ทันที
          </p>
          <ul class="auth-points">
            <li><span class="dot">${icon('check')}</span>สร้างห้องเรียนและแจกรหัสให้นักเรียน</li>
            <li><span class="dot">${icon('check')}</span>ตรวจงานพร้อมไฟล์แนบและความคิดเห็น</li>
            <li><span class="dot">${icon('check')}</span>ดูภาพรวมทั้งห้องและส่งออกผลเป็น CSV</li>
          </ul>
        </div>
        <div class="auth-preview" aria-hidden="true">
          <div class="preview-card">
            <div class="preview-top">
              <div class="preview-avatar">น</div>
              <div>
                <div class="preview-name">นภัสสร ใจดี</div>
                <div class="preview-sub">ใบกิจกรรมที่ 1 · วัฏจักรน้ำ</div>
              </div>
            </div>
            <span class="chip chip-green">${icon('check')}ผ่าน · 8.5/10</span>
            <div class="preview-bars">
              <span style="--w:88%"></span>
              <span style="--w:70%"></span>
              <span style="--w:94%"></span>
            </div>
          </div>
          <div class="preview-card second">
            <span class="chip chip-amber">${icon('clock')}รอตรวจ 3 งาน</span>
            <div class="preview-bars">
              <span style="--w:62%"></span>
              <span style="--w:80%"></span>
            </div>
          </div>
        </div>
      </section>
            <section class="auth-panel">
        <div class="auth-box">
          ${authPanelHtml(mode)}
          <p class="auth-note">
            ครูสมัครบัญชีเองได้ตามปกติ ส่วนนักเรียนไม่ต้องสมัคร — เข้าห้องด้วยรหัสแล้วเลือกชื่อของตัวเอง
          </p>
        </div>
      </section>
    </div>
  `;

  document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.authMode = btn.dataset.authTab;
      renderAuth();
    });
  });

  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = loginForm.querySelector('button[type="submit"]');
      const formData = new FormData(loginForm);
      button.disabled = true;
      button.classList.add('btn-loading');
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: { username: formData.get('username'), password: formData.get('password') },
        });
        state.user = data.user;
        toast(`ยินดีต้อนรับ ${data.user.name}`);
        go(data.user.role === 'teacher' ? '#/teacher' : '#/student');
      } catch (error) {
        setFormError(loginForm, error.message);
      } finally {
        button.disabled = false;
        button.classList.remove('btn-loading');
      }
    });
  }

  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.querySelectorAll('input[name="role"]').forEach((input) => {
      input.addEventListener('change', () => {
        state.registerRole = input.value;
      });
    });
    registerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = registerForm.querySelector('button[type="submit"]');
      const formData = new FormData(registerForm);
      button.disabled = true;
      button.classList.add('btn-loading');
      try {
        const data = await api('/api/auth/register', {
          method: 'POST',
          body: {
            role: 'teacher',
            name: formData.get('name'),
            username: formData.get('username'),
            password: formData.get('password'),
          },
        });
        state.user = data.user;
        toast('สมัครใช้งานสำเร็จ');
        go(data.user.role === 'teacher' ? '#/teacher' : '#/student');
      } catch (error) {
        setFormError(registerForm, error.message);
      } finally {
        button.disabled = false;
        button.classList.remove('btn-loading');
      }
    });
  }

  wireStudentLogin();
}

/* --------------------------- teacher home -------------------------- */

async function renderTeacherHome() {
  appEl.innerHTML = shell(loadingBlock(), 'home');
  let data;
  try {
    data = await api('/api/teacher/classes');
  } catch (error) {
    return renderErrorPage(error);
  }
  const classes = data.classes || [];
  const totals = classes.reduce(
    (acc, item) => ({
      students: acc.students + item.student_count,
      activities: acc.activities + item.activity_count,
      pending: acc.pending + item.pending_count,
    }),
    { students: 0, activities: 0, pending: 0 }
  );

  const cards = classes.length
    ? `<div class="class-grid">${classes
        .map(
          (item) => `
          <a class="class-card" href="#/teacher/classes/${item.id}">
            <div class="class-card-top">
              <div>
                <h3>${esc(item.name)}</h3>
                <div class="subject">${esc(item.subject || 'ไม่ระบุรายวิชา')}</div>
              </div>
              <span class="code-chip">${esc(item.code)}</span>
            </div>
            <div class="class-meta">
              <span>${icon('users')}${item.student_count} คน</span>
              <span>${icon('clipboard')}${item.activity_count} ใบกิจกรรม</span>
              ${item.pending_count ? `<span class="chip chip-amber">รอตรวจ ${item.pending_count}</span>` : ''}
            </div>
            <span class="open-hint">เปิดห้องเรียน ${icon('arrow-right')}</span>
          </a>`
        )
        .join('')}</div>`
    : emptyState(
        'ยังไม่มีห้องเรียน',
        'สร้างห้องเรียนแรกของคุณ แล้วแจกรหัสให้นักเรียนเข้าร่วม เพื่อเริ่มมอบหมายใบกิจกรรม',
        `<button class="btn btn-primary" data-action="open-create-class">${icon('plus')}สร้างห้องเรียน</button>`,
        'folder'
      );

  appEl.innerHTML = shell(
    `
      <div class="page-head">
        <div>
          <div class="eyebrow">${icon('spark')}ภาพรวมการสอน</div>
          <h1>สวัสดี ${esc(state.user.name)}</h1>
          <p class="lead">จัดการห้องเรียน มอบหมายใบกิจกรรม และติดตามผลการตรวจของนักเรียนได้จากที่นี่</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" data-action="open-create-class">${icon('plus')}สร้างห้องเรียน</button>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat"><div class="stat-icon">${icon('folder')}</div><div><div class="stat-value">${classes.length}</div><div class="stat-label">ห้องเรียนทั้งหมด</div></div></div>
        <div class="stat"><div class="stat-icon blue">${icon('users')}</div><div><div class="stat-value">${totals.students}</div><div class="stat-label">นักเรียนในความดูแล</div></div></div>
        <div class="stat"><div class="stat-icon amber">${icon('clipboard')}</div><div><div class="stat-value">${totals.activities}</div><div class="stat-label">ใบกิจกรรมทั้งหมด</div></div></div>
        <div class="stat"><div class="stat-icon red">${icon('clock')}</div><div><div class="stat-value">${totals.pending}</div><div class="stat-label">งานรอตรวจ</div></div></div>
      </div>
      <div class="section-title">
        <h2>ห้องเรียนของฉัน</h2>
        <span class="hint">${classes.length} ห้องเรียน</span>
      </div>
      ${cards}
      <p class="foot-note">ตรวจใบกิจกรรม · ระบบสำหรับครูและนักเรียน</p>
    `,
    'home'
  );

  if (!classes.length) {
    appEl.querySelectorAll('[data-action="open-create-class"]').forEach((btn) => {
      btn.addEventListener('click', openCreateClassModal);
    });
  }
}

/* -------------------------- teacher class ------------------------- */

async function renderTeacherClass(classId) {
  appEl.innerHTML = shell(loadingBlock(), 'home');
  let data;
  try {
    data = await api(`/api/teacher/classes/${classId}`);
  } catch (error) {
    return renderErrorPage(error);
  }
  state.teacherClassData = data;
  paintTeacherClass();
}

function paintTeacherClass() {
  const data = state.teacherClassData;
  if (!data) return;
  const { class: klass, students, activities } = data;
  const tab = state.classTab === 'students' ? 'students' : 'activities';

  const activitiesHtml = activities.length
    ? `<div class="activity-list">${activities
        .map((activity) => {
          const reviewed = activity.reviewed_count || 0;
          const total = activity.student_count || 0;
          const percent = total ? Math.round((reviewed / total) * 100) : 0;
          return `
          <a class="activity-card" href="#/teacher/activities/${activity.id}">
            <div>
              <div class="activity-title-row">
                <h3>${esc(activity.title)}</h3>
                <span class="chip chip-mode">${
                  activity.mode === 'score' ? `${icon('chart')}ให้คะแนน` : `${icon('check-circle')}ผ่าน / ไม่ผ่าน`
                }</span>
                ${activity.due_date && isOverdue(activity.due_date) && reviewed < total ? '<span class="chip chip-red">เลยกำหนด</span>' : ''}
              </div>
              <p class="desc">${esc(activity.description || 'ไม่มีรายละเอียดเพิ่มเติม')}</p>
              <div class="activity-meta">
                <span>${icon('calendar')}${activity.due_date ? `กำหนดส่ง ${fmtDate(activity.due_date)}` : 'ไม่กำหนดวันส่ง'}</span>
                <span>${icon('users')}${total} คน</span>
                <span>${icon('check-circle')}ตรวจแล้ว ${reviewed}/${total}</span>
                ${activity.mode === 'score' && activity.avg_score != null ? `<span>${icon('chart')}เฉลี่ย ${scoreText(activity.avg_score)} คะแนน</span>` : ''}
              </div>
            </div>
            <div class="activity-right">
              <div class="progress-wrap">
                <div class="progress-label"><span>ความคืบหน้า</span><span>${percent}%</span></div>
                <div class="progress ${percent < 100 ? 'amber' : ''}"><span style="width:${percent}%"></span></div>
              </div>
              <span class="btn btn-soft btn-sm">ตรวจงาน ${icon('arrow-right')}</span>
            </div>
          </a>`;
        })
        .join('')}</div>`
    : emptyState(
        'ยังไม่มีใบกิจกรรม',
        'สร้างใบกิจกรรมแรกเพื่อให้นักเรียนส่งงาน และเริ่มตรวจได้ทันที',
        `<button class="btn btn-primary" data-action="open-create-activity">${icon('plus')}สร้างใบกิจกรรม</button>`
      );

  const studentsHtml = students.length
    ? `<div class="table-wrap">
        <table>
          <thead>
            <tr><th>นักเรียน</th><th>ชื่อผู้ใช้</th><th>เข้าร่วมเมื่อ</th><th>งานที่ตรวจแล้ว</th><th>รายการที่มีข้อมูล</th></tr>
          </thead>
          <tbody>
            ${students
              .map(
                (student) => `
              <tr>
                <td>
                  <div class="student-cell">
                    <span class="avatar">${esc(initials(student.name))}</span>
                    <span class="name">${esc(student.name)}</span>
                  </div>
                </td>
                <td class="muted">${esc(student.username)}</td>
                <td class="muted nowrap">${fmtDate(student.joined_at)}</td>
                <td><span class="chip chip-green">${student.reviewed_count} งาน</span></td>
                <td class="muted">${student.record_count} รายการ</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <div class="inline-hint" style="margin-top:14px">
        ${icon('key')}
        <span>แจกรหัสห้องเรียน <strong>${esc(klass.code)}</strong> ให้นักเรียนสมัครเองและเข้าร่วม หรือเพิ่มบัญชีนักเรียนได้จากปุ่ม “เพิ่มนักเรียน”</span>
      </div>`
    : emptyState(
        'ยังไม่มีนักเรียนในห้อง',
        'แจกรหัสห้องเรียนให้นักเรียนเข้าร่วมเอง หรือเพิ่มบัญชีนักเรียนให้ทั้งห้องจากปุ่มด้านบน',
        `<button class="btn btn-primary" data-action="open-add-student">${icon('plus')}เพิ่มนักเรียน</button>`,
        'users'
      );

  appEl.innerHTML = shell(`
    <a class="back-link" href="#/teacher">${icon('arrow-left')}ห้องเรียนทั้งหมด</a>
    <section class="class-hero">
      <div class="class-hero-main">
        <div>
          <div class="eyebrow">${icon('folder')}ห้องเรียน</div>
          <h1>${esc(klass.name)}</h1>
          <p class="subject">${esc(klass.subject || 'ไม่ระบุรายวิชา')} · ${students.length} นักเรียน · ${activities.length} ใบกิจกรรม</p>
          <div class="code-box">
            <span class="label">รหัสเข้าร่วม</span>
            <span class="value">${esc(klass.code)}</span>
            <button class="copy-btn" data-copy="${esc(klass.code)}" title="คัดลอกรหัส">${icon('copy')}</button>
          </div>
        </div>
        <div class="page-actions">
          <button class="btn btn-ghost" data-action="open-add-student">${icon('users')}เพิ่มนักเรียน</button>
          <button class="btn btn-primary" data-action="open-create-activity">${icon('plus')}สร้างใบกิจกรรม</button>
        </div>
      </div>
    </section>

    <div class="tabs">
      <button type="button" data-tab="activities" class="${tab === 'activities' ? 'active' : ''}">
        ${icon('clipboard')}ใบกิจกรรม <span class="count">${activities.length}</span>
      </button>
      <button type="button" data-tab="students" class="${tab === 'students' ? 'active' : ''}">
        ${icon('users')}นักเรียน <span class="count">${students.length}</span>
      </button>
    </div>

    ${tab === 'activities' ? activitiesHtml : studentsHtml}
    <p class="foot-note">ตรวจใบกิจกรรม · ${esc(klass.name)}</p>
  `);

  appEl.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.classTab = btn.dataset.tab;
      paintTeacherClass();
    });
  });
  appEl.querySelectorAll('[data-action="open-add-student"]').forEach((btn) => {
    btn.addEventListener('click', () => openAddStudentModal(klass));
  });
  appEl.querySelectorAll('[data-action="open-create-activity"]').forEach((btn) => {
    btn.addEventListener('click', () => openCreateActivityModal(klass));
  });
  appEl.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => copyText(btn.dataset.copy));
  });
}

/* -------------------------- teacher activity ---------------------- */

async function renderTeacherActivity(activityId) {
  appEl.innerHTML = shell(loadingBlock(), 'home');
  let data;
  try {
    data = await api(`/api/teacher/activities/${activityId}`);
  } catch (error) {
    return renderErrorPage(error);
  }
  state.teacherActivityData = data;
  paintTeacherActivity();
}

function paintTeacherActivity() {
  const data = state.teacherActivityData;
  if (!data) return;
  const { activity, class: klass, rubric, rows, stats } = data;
  const scoreMode = activity.mode === 'score';
  const reviewed = stats.reviewed_count || 0;
  const total = stats.student_count || 0;

  const tableRows = rows.length
    ? rows
        .map((row) => {
          const submission = row.submission;
          const reviewedRow = submission && submission.status === 'reviewed';
          return `
          <tr>
            <td>
              <div class="student-cell">
                <span class="avatar">${esc(initials(row.student.name))}</span>
                <div>
                  <div class="name">${esc(row.student.name)}</div>
                  <div class="username">${esc(row.student.username)}</div>
                </div>
              </div>
            </td>
            <td>${statusChip(submission)}</td>
            <td class="muted nowrap">${submission ? fmtDateTime(submission.submitted_at) : '—'}</td>
            <td>
              ${
                reviewedRow && scoreMode
                  ? `<span class="score-strong">${scoreText(submission.total_score)}</span> <span class="muted small">/ ${scoreText(rubric.reduce((sum, item) => sum + item.max_score, 0))}</span>`
                  : reviewedRow
                    ? '<span class="muted">—</span>'
                    : submission
                      ? '<span class="chip chip-amber">รอตรวจ</span>'
                      : '<span class="muted">—</span>'
              }
            </td>
            <td>${reviewedRow ? statusChip(submission) : submission ? '<span class="muted small">ยังไม่ได้ตรวจ</span>' : '<span class="muted small">ยังไม่ส่ง</span>'}</td>
            <td>
              <div class="row-actions">
                <button class="btn ${reviewedRow ? 'btn-ghost' : 'btn-soft'} btn-sm" data-review-student="${row.student.id}">
                  ${reviewedRow ? 'ดู / แก้ไขผล' : 'ตรวจงาน'}
                </button>
              </div>
            </td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="6"><div class="empty" style="border:0;background:transparent">${icon('users')} ยังไม่มีนักเรียนในห้องเรียนนี้</div></td></tr>`;

  appEl.innerHTML = shell(`
    <a class="back-link" href="#/teacher/classes/${klass.id}">${icon('arrow-left')}${esc(klass.name)}</a>
    <div class="page-head">
      <div>
        <div class="eyebrow">${icon('clipboard')}ใบกิจกรรม${activity.due_date ? ` · กำหนดส่ง ${fmtDate(activity.due_date)}` : ''}</div>
        <h1>${esc(activity.title)}</h1>
        <p class="lead">
          <span class="chip chip-mode">${scoreMode ? `${icon('chart')}ให้คะแนนรายหัวข้อ` : `${icon('check-circle')}ผ่าน / ไม่ผ่าน`}</span>
          ${scoreMode ? `<span class="muted small">เกณฑ์ผ่าน ${scoreText(activity.pass_score)} คะแนน</span>` : ''}
        </p>
      </div>
      <div class="page-actions">
        <a class="btn btn-ghost" href="/api/teacher/activities/${activity.id}/export.csv" download>${icon('download')}ส่งออก CSV</a>
        <button type="button" class="btn btn-ghost" data-export-sheet="${activity.id}">${icon('chart')}ส่งไป Google Sheets</button>
      </div>
    </div>    <div class="stats-grid">
      <div class="stat"><div class="stat-icon">${icon('users')}</div><div><div class="stat-value">${total}</div><div class="stat-label">นักเรียนในห้อง</div></div></div>
      <div class="stat"><div class="stat-icon blue">${icon('file')}</div><div><div class="stat-value">${stats.submitted_count || 0}</div><div class="stat-label">มีข้อมูลงาน</div></div></div>
      <div class="stat"><div class="stat-icon amber">${icon('clock')}</div><div><div class="stat-value">${stats.pending_count || 0}</div><div class="stat-label">รอตรวจ</div></div></div>
      <div class="stat"><div class="stat-icon red">${icon('check-circle')}</div><div><div class="stat-value">${reviewed} / ${total}</div><div class="stat-label">ตรวจแล้ว</div></div></div>
    </div>

    <div class="section-title">
      <h2>รายชื่อนักเรียน</h2>
      <span class="hint">${scoreMode ? `คะแนนเต็ม ${scoreText(rubric.reduce((sum, item) => sum + item.max_score, 0))} · เกณฑ์ผ่าน ${scoreText(activity.pass_score)}` : 'บันทึกผลผ่าน / ไม่ผ่าน'}</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>นักเรียน</th><th>สถานะ</th><th>ส่งเมื่อ</th><th>คะแนน</th><th>ผลการตรวจ</th><th></th></tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    ${activity.description ? `<div class="surface panel" style="margin-top:16px"><div class="panel-head"><h3>รายละเอียดใบกิจกรรม</h3></div><p class="instruction">${esc(activity.description)}</p></div>` : ''}
    <p class="foot-note">ตรวจใบกิจกรรม · ${esc(activity.title)}</p>
  `);

  appEl.querySelectorAll('[data-review-student]').forEach((btn) => {
    btn.addEventListener('click', () => openReviewModal(Number(btn.dataset.reviewStudent)));
  });
}

/* --------------------------- student home ------------------------- */

async function renderStudentHome() {
  appEl.innerHTML = shell(loadingBlock(), 'home');
  let data;
  try {
    data = await api('/api/student/classes');
  } catch (error) {
    return renderErrorPage(error);
  }
  const classes = data.classes || [];
  const activityTotal = classes.reduce((sum, item) => sum + item.activity_count, 0);
  const reviewedTotal = classes.reduce((sum, item) => sum + item.reviewed_count, 0);

  const cards = classes.length
    ? `<div class="class-grid">${classes
        .map((item) => {
          const percent = item.activity_count ? Math.round((item.reviewed_count / item.activity_count) * 100) : 0;
          return `
          <a class="class-card" href="#/student/classes/${item.id}">
            <div class="class-card-top">
              <div>
                <h3>${esc(item.name)}</h3>
                <div class="subject">${esc(item.subject || 'ไม่ระบุรายวิชา')}</div>
              </div>
              <span class="class-subject-badge">${icon('user')}${esc(item.teacher_name)}</span>
            </div>
            <div class="progress-wrap" style="width:100%">
              <div class="progress-label"><span>ตรวจแล้ว ${item.reviewed_count}/${item.activity_count} ใบกิจกรรม</span><span>${percent}%</span></div>
              <div class="progress ${percent < 100 ? 'amber' : ''}"><span style="width:${percent}%"></span></div>
            </div>
            <span class="open-hint">ดูใบกิจกรรม ${icon('arrow-right')}</span>
          </a>`;
        })
        .join('')}</div>`
    : emptyState(
        'ยังไม่ได้เข้าห้องเรียน',
        'ใช้รหัสห้องเรียนที่ครูแจก เพื่อเข้าร่วมและเริ่มส่งใบกิจกรรม',
        '',
        'folder'
      );

  appEl.innerHTML = shell(`
    <div class="page-head">
      <div>
        <div class="eyebrow">${icon('spark')}พื้นที่ของนักเรียน</div>
        <h1>สวัสดี ${esc(state.user.name)}</h1>
        <p class="lead">ติดตามใบกิจกรรมที่ได้รับมอบหมาย ส่งงาน และดูผลการตรวจจากครู</p>
      </div>
    </div>
    <section class="join-panel">
      <div>
        <h2>${icon('key')} เข้าร่วมห้องเรียน</h2>
        <p>กรอกรหัสห้องเรียน 6 ตัวอักษรที่ได้รับจากครู</p>
      </div>
      <form class="join-form" id="join-form">
        <input name="code" maxlength="6" placeholder="ABC123" autocomplete="off" aria-label="รหัสห้องเรียน" required />
        <button class="btn btn-primary" type="submit">เข้าร่วม</button>
      </form>
    </section>
    <div class="stats-grid">
      <div class="stat"><div class="stat-icon">${icon('folder')}</div><div><div class="stat-value">${classes.length}</div><div class="stat-label">ห้องเรียนที่เข้าร่วม</div></div></div>
      <div class="stat"><div class="stat-icon blue">${icon('clipboard')}</div><div><div class="stat-value">${activityTotal}</div><div class="stat-label">ใบกิจกรรมทั้งหมด</div></div></div>
      <div class="stat"><div class="stat-icon amber">${icon('check-circle')}</div><div><div class="stat-value">${reviewedTotal}</div><div class="stat-label">ตรวจแล้ว</div></div></div>
      <div class="stat"><div class="stat-icon red">${icon('clock')}</div><div><div class="stat-value">${Math.max(0, activityTotal - reviewedTotal)}</div><div class="stat-label">ยังไม่เสร็จ</div></div></div>
    </div>
    <div class="section-title"><h2>ห้องเรียนของฉัน</h2><span class="hint">${classes.length} ห้องเรียน</span></div>
    ${cards}
    <p class="foot-note">ตรวจใบกิจกรรม · พื้นที่นักเรียน</p>
  `, 'home');

  const joinForm = document.getElementById('join-form');
  if (joinForm) {
    joinForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = joinForm.querySelector('button');
      const code = new FormData(joinForm).get('code');
      button.disabled = true;
      try {
        await api('/api/student/join', { method: 'POST', body: { code } });
        toast('เข้าร่วมห้องเรียนสำเร็จ');
        renderStudentHome();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
  }
}

/* --------------------------- student class ------------------------ */

async function renderStudentClass(classId) {
  appEl.innerHTML = shell(loadingBlock(), 'home');
  let data;
  try {
    data = await api(`/api/student/classes/${classId}`);
  } catch (error) {
    return renderErrorPage(error);
  }
  const { class: klass, activities } = data;
  const reviewed = activities.filter((item) => item.status === 'reviewed').length;
  const percent = activities.length ? Math.round((reviewed / activities.length) * 100) : 0;

  const list = activities.length
    ? `<div class="activity-list">${activities
        .map(
          (activity) => `
          <a class="activity-card" href="#/student/activities/${activity.id}">
            <div>
              <div class="activity-title-row">
                <h3>${esc(activity.title)}</h3>
                <span class="chip chip-mode">${
                  activity.mode === 'score' ? `${icon('chart')}ให้คะแนน` : `${icon('check-circle')}ผ่าน / ไม่ผ่าน`
                }</span>
                ${activity.due_date && isOverdue(activity.due_date) && activity.status !== 'reviewed' ? '<span class="chip chip-red">เลยกำหนด</span>' : ''}
              </div>
              <p class="desc">${esc(activity.description || 'ไม่มีรายละเอียดเพิ่มเติม')}</p>
              <div class="activity-meta">
                <span>${icon('calendar')}${activity.due_date ? `กำหนดส่ง ${fmtDate(activity.due_date)}` : 'ไม่กำหนดวันส่ง'}</span>
                ${
                  activity.mode === 'score' && activity.status === 'reviewed'
                    ? `<span>${icon('chart')}ได้ ${scoreText(activity.total_score)} คะแนน</span>`
                    : ''
                }
                ${activity.status === 'reviewed' ? `<span>${icon('check-circle')}ตรวจเมื่อ ${fmtDate(activity.reviewed_at)}</span>` : ''}
              </div>
            </div>
            <div class="activity-right">
              <div style="text-align:right">
                ${statusChip(
                  activity.submission_id
                    ? { status: activity.status, passed: activity.passed }
                    : null
                )}
                <div class="muted small" style="margin-top:5px">${
                  !activity.submission_id ? 'กดเพื่อดูรายละเอียด' : activity.status === 'reviewed' ? 'ดูผลการตรวจ' : 'รอครูตรวจ'
                }</div>
              </div>
              <span class="btn btn-soft btn-sm">เปิด ${icon('arrow-right')}</span>
            </div>
          </a>`
        )
        .join('')}</div>`
    : emptyState('ยังไม่มีใบกิจกรรม', 'เมื่อครูมอบหมายใบกิจกรรม จะแสดงอยู่ที่นี่', '', 'clipboard');

  appEl.innerHTML = shell(`
    <a class="back-link" href="#/student">${icon('arrow-left')}ห้องเรียนของฉัน</a>
    <section class="class-hero">
      <div class="class-hero-main">
        <div>
          <div class="eyebrow">${icon('folder')}ห้องเรียน</div>
          <h1>${esc(klass.name)}</h1>
          <p class="subject">${esc(klass.subject || 'ไม่ระบุรายวิชา')} · ครูผู้สอน ${esc(klass.teacher_name)}</p>
        </div>
        <div class="progress-wrap" style="width:210px">
          <div class="progress-label"><span>ใบกิจกรรมที่ตรวจแล้ว</span><span>${reviewed}/${activities.length}</span></div>
          <div class="progress ${percent < 100 ? 'amber' : ''}"><span style="width:${percent}%"></span></div>
        </div>
      </div>
    </section>
    <div class="section-title"><h2>ใบกิจกรรม</h2><span class="hint">${activities.length} รายการ</span></div>
    ${list}
    <p class="foot-note">ตรวจใบกิจกรรม · ${esc(klass.name)}</p>
  `, 'home');
}

/* -------------------------- student activity ---------------------- */

async function renderStudentActivity(activityId) {
  appEl.innerHTML = shell(loadingBlock(), 'home');
  let data;
  try {
    data = await api(`/api/student/activities/${activityId}`);
  } catch (error) {
    return renderErrorPage(error);
  }
  const { activity, class: klass, rubric, submission } = data;
  const scoreMode = activity.mode === 'score';
  const reviewed = submission && submission.status === 'reviewed';
  const maxTotal = rubric.reduce((sum, item) => sum + item.max_score, 0);
  const scoreMap = {};
  if (submission && Array.isArray(submission.scores)) {
    for (const row of submission.scores) scoreMap[row.rubric_item_id] = row.score;
  }

  const rubricHtml = rubric.length
    ? `<div class="surface panel">
        <div class="panel-head"><h3>เกณฑ์การให้คะแนน</h3><span class="chip chip-mode">${scoreMode ? `เต็ม ${scoreText(maxTotal)} คะแนน` : 'ตรวจแบบผ่าน / ไม่ผ่าน'}</span></div>
        <table class="rubric-table">
          <thead><tr><th>หัวข้อ</th><th>คะแนนเต็ม</th>${reviewed && scoreMode ? '<th>คะแนนที่ได้</th>' : ''}</tr></thead>
          <tbody>
            ${rubric
              .map(
                (item) => `<tr>
                  <td>${esc(item.label)}</td>
                  <td class="muted">${scoreText(item.max_score)}</td>
                  ${reviewed && scoreMode ? `<td><span class="score-strong">${scoreText(scoreMap[item.id])}</span></td>` : ''}
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
        ${scoreMode ? `<p class="muted small" style="margin-top:10px">เกณฑ์ผ่าน: ${scoreText(activity.pass_score)} คะแนน</p>` : ''}
      </div>`
    : '';

  let sideCard = '';
  if (reviewed) {
    sideCard = `
      <div class="review-box ${submission.passed ? 'pass' : 'fail'}">
        <div class="verdict">
          <span class="verdict-icon">${icon(submission.passed ? 'check' : 'x', 'icon-lg')}</span>
          <div>
            <h3>${submission.passed ? 'ผ่านการตรวจ' : 'ยังไม่ผ่าน'}</h3>
            <p class="muted small">${fmtDateTime(submission.reviewed_at)}</p>
          </div>
        </div>
        ${
          scoreMode
            ? `<div style="margin-top:14px"><span class="big-score">${scoreText(submission.total_score)}</span> <small class="muted">/ ${scoreText(maxTotal)} คะแนน</small></div>`
            : ''
        }
        ${
          submission.feedback
            ? `<div class="feedback-text">${esc(submission.feedback)}</div>`
            : '<p class="muted small" style="margin-top:14px">ครูไม่ได้ระบุความคิดเห็นเพิ่มเติม</p>'
        }
        ${
          submission.file_name
            ? `<a class="file-attach" href="/api/files/${submission.id}" target="_blank" rel="noopener">${icon('file')}<span>${esc(submission.original_name || 'ไฟล์ที่ส่ง')}</span></a>`
            : ''
        }
      </div>`;
  } else if (submission) {
    sideCard = `
      <div class="review-box">
        <span class="chip chip-amber">${icon('clock')}ส่งแล้ว · รอครูตรวจ</span>
        <p class="muted small" style="margin-top:10px">ส่งเมื่อ ${fmtDateTime(submission.submitted_at)}</p>
        ${
          submission.feedback
            ? `<div class="feedback-text">${esc(submission.feedback)}</div>`
            : '<p class="muted small" style="margin-top:10px">ครูจะแจ้งผลและความคิดเห็นที่นี่</p>'
        }
        ${
          submission.file_name
            ? `<a class="file-attach" href="/api/files/${submission.id}" target="_blank" rel="noopener">${icon('file')}<span>${esc(submission.original_name || 'ไฟล์ที่ส่ง')}</span></a>`
            : ''
        }
      </div>`;
  } else {
    sideCard = `
      <div class="review-box">
        <span class="chip chip-outline">ยังไม่ส่งใบกิจกรรม</span>
        <p class="muted small" style="margin-top:10px">${activity.due_date ? `กำหนดส่ง ${fmtDate(activity.due_date)}` : 'คุณยังไม่ได้ส่งงานนี้'}</p>
        <p class="small" style="margin-top:12px;color:var(--ink-soft)">พิมพ์คำตอบหรือแนบไฟล์ด้านล่าง แล้วกด “ส่งใบกิจกรรม”</p>
      </div>`;
  }

  const formHtml = reviewed
    ? `<div class="surface panel">
        <div class="panel-head"><h3>งานที่ส่ง</h3><span class="chip chip-green">${icon('check')}ตรวจแล้ว</span></div>
        ${
          submission.text
            ? `<p class="instruction">${esc(submission.text)}</p>`
            : '<p class="muted small">ไม่ได้พิมพ์คำตอบ</p>'
        }
        ${
          submission.file_name
            ? `<a class="file-attach" href="/api/files/${submission.id}" target="_blank" rel="noopener">${icon('file')}<span>${esc(submission.original_name || 'ไฟล์ที่ส่ง')}</span></a>`
            : ''
        }
      </div>`
    : `<div class="surface panel">
        <div class="panel-head">
          <div><h3>${submission ? 'แก้ไขการส่งงาน' : 'ส่งใบกิจกรรม'}</h3><p class="sub">${submission ? 'ครูยังไม่ตรวจ คุณยังแก้ไขได้' : 'พิมพ์คำตอบ และ/หรือแนบรูปใบกิจกรรม'}</p></div>
          ${submission ? '<span class="chip chip-amber">รอตรวจ</span>' : ''}
        </div>
        <form class="submit-form" id="submit-form" enctype="multipart/form-data">
          <div class="field">
            <label for="answer-text">คำตอบ / สิ่งที่ต้องการส่ง</label>
            <textarea id="answer-text" name="text" rows="5" placeholder="พิมพ์คำตอบหรือสรุปสิ่งที่ทำ">${submission ? esc(submission.text || '') : ''}</textarea>
          </div>
          <label class="file-drop" for="answer-file">
            ${icon('file')}
            <strong>แนบรูปใบกิจกรรมหรือ PDF</strong>
            <span>JPG, PNG, WEBP, GIF หรือ PDF · ไม่เกิน 15 MB</span>
            <input id="answer-file" type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" />
          </label>
          <div id="selected-file" class="selected-file" style="display:none"></div>
          ${
            submission && submission.file_name
              ? `<p class="muted small">ไฟล์เดิม: <a href="/api/files/${submission.id}" target="_blank" rel="noopener">${esc(submission.original_name || 'ไฟล์ที่ส่ง')}</a> — แนบไฟล์ใหม่เพื่อแทนที่</p>`
              : ''
          }
          <div>
            <button class="btn btn-primary btn-lg" type="submit">${icon('check')}${submission ? 'ส่งอีกครั้ง' : 'ส่งใบกิจกรรม'}</button>
          </div>
        </form>
      </div>`;

  appEl.innerHTML = shell(`
    <a class="back-link" href="#/student/classes/${klass.id}">${icon('arrow-left')}${esc(klass.name)}</a>
    <div class="page-head">
      <div>
        <div class="eyebrow">${icon('clipboard')}ใบกิจกรรม${activity.due_date ? ` · กำหนดส่ง ${fmtDate(activity.due_date)}` : ''}</div>
        <h1>${esc(activity.title)}</h1>
        <p class="lead">
          <span class="chip chip-mode">${scoreMode ? `${icon('chart')}ให้คะแนนรายหัวข้อ` : `${icon('check-circle')}ผ่าน / ไม่ผ่าน`}</span>
          <span class="muted small">โดย ${esc(activity.teacher_name)} · ${esc(klass.name)}</span>
        </p>
      </div>
    </div>
    <div class="work-layout">
      <div class="work-main">
        <div class="surface panel">
          <div class="panel-head"><h3>รายละเอียดงาน</h3></div>
          ${
            activity.description
              ? `<p class="instruction">${esc(activity.description)}</p>`
              : '<p class="muted small">ครูไม่ได้ระบุรายละเอียดเพิ่มเติม</p>'
          }
        </div>
        ${formHtml}
        ${rubricHtml}
      </div>
      <aside class="work-side">${sideCard}</aside>
    </div>
    <p class="foot-note">ตรวจใบกิจกรรม · ${esc(activity.title)}</p>
  `, 'home');

  const fileInput = document.getElementById('answer-file');
  const selectedBox = document.getElementById('selected-file');
  if (fileInput && selectedBox) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) {
        selectedBox.style.display = 'none';
        selectedBox.innerHTML = '';
        return;
      }
      selectedBox.style.display = 'flex';
      selectedBox.innerHTML = `<span>${icon('file')} ${esc(file.name)} · ${(file.size / 1024 / 1024).toFixed(2)} MB</span>
        <button type="button" aria-label="เอาไฟล์ออก">${icon('x')}</button>`;
      selectedBox.querySelector('button').addEventListener('click', () => {
        fileInput.value = '';
        selectedBox.style.display = 'none';
        selectedBox.innerHTML = '';
      });
    });
  }

  const submitForm = document.getElementById('submit-form');
  if (submitForm) {
    submitForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = submitForm.querySelector('button[type="submit"]');
      const formData = new FormData(submitForm);
      const text = String(formData.get('text') || '').trim();
      const file = formData.get('file');
      const hasFile = file && file.size > 0;
      if (!text && !hasFile && !(submission && (submission.text || submission.file_name))) {
        toast('กรุณาพิมพ์คำตอบหรือแนบไฟล์ก่อนส่ง', 'error');
        return;
      }
      button.disabled = true;
      button.classList.add('btn-loading');
      try {
        await api(`/api/student/activities/${activity.id}/submit`, { method: 'POST', body: formData });
        toast('ส่งใบกิจกรรมเรียบร้อย');
        renderStudentActivity(activity.id);
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        button.disabled = false;
        button.classList.remove('btn-loading');
      }
    });
  }
}

/* ----------------------------- modals ----------------------------- */

function openModal(html, wide = false) {
  modalRoot.innerHTML = `
    <div class="modal-overlay">
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        ${html}
      </div>
    </div>`;
  document.body.style.overflow = 'hidden';
  const overlay = modalRoot.querySelector('.modal-overlay');
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeModal();
  });
  modalRoot.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', closeModal);
  });
  const focusable = modalRoot.querySelector('input, textarea, select, button');
  if (focusable) setTimeout(() => focusable.focus(), 60);
}

function closeModal() {
  modalRoot.innerHTML = '';
  document.body.style.overflow = '';
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modalRoot.innerHTML) closeModal();
});

function modalHeader(title, subtitle = '') {
  return `<div class="modal-head">
    <div><h2>${esc(title)}</h2>${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ''}</div>
    <button class="modal-close" type="button" data-close aria-label="ปิด">${icon('x')}</button>
  </div>`;
}

function openCreateClassModal() {
  openModal(`
    <form id="create-class-form">
      ${modalHeader('สร้างห้องเรียนใหม่', 'ตั้งชื่อห้องเรียนและรายวิชา เพื่อแจกรหัสให้นักเรียน')}
      <div class="modal-body form-grid">
        <div class="field">
          <label for="class-name">ชื่อห้องเรียน</label>
          <input id="class-name" name="name" placeholder="เช่น ป.5/1 วิทยาศาสตร์" required maxlength="120" />
        </div>
        <div class="field">
          <label for="class-subject">รายวิชา <span class="hint">(ไม่บังคับ)</span></label>
          <input id="class-subject" name="subject" placeholder="เช่น วิทยาศาสตร์" maxlength="120" />
        </div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-ghost" data-close>ยกเลิก</button>
        <button type="submit" class="btn btn-primary">${icon('plus')}สร้างห้องเรียน</button>
      </div>
    </form>
  `);
  const form = document.getElementById('create-class-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const fd = new FormData(form);
      const data = await api('/api/teacher/classes', {
        method: 'POST',
        body: { name: fd.get('name'), subject: fd.get('subject') },
      });
      closeModal();
      toast('สร้างห้องเรียนสำเร็จ');
      go(`#/teacher/classes/${data.class.id}`);
    } catch (error) {
      setFormError(form, error.message);
      button.disabled = false;
    }
  });
}

function openAddStudentModal(klass) {
  openModal(`
    <form id="add-student-form">
      ${modalHeader('เพิ่มนักเรียน', 'ห้อง ' + klass.name + ' · รหัส ' + klass.code)}
      <div class="modal-body form-grid">
        <div class="field">
          <label for="student-name">ชื่อ-นามสกุล (ทีละคน)</label>
          <input id="student-name" name="name" placeholder="เช่น นภัสสร ใจดี" maxlength="80" />
          <span class="hint">นักเรียนไม่ต้องสมัคร — เข้าห้องด้วยรหัส ${esc(klass.code)} แล้วเลือกชื่อตัวเอง</span>
        </div>
        <div class="field">
          <label for="bulk-names">หรือวางรายชื่อหลายคน (บรรทัดละ 1 ชื่อ)</label>
          <textarea id="bulk-names" name="bulk" rows="4" placeholder="นภัสสร ใจดี&#10;กันต์ธีร์ แสงทอง"></textarea>
        </div>
        <div class="file-drop" id="roster-drop" role="button" tabindex="0">
          ${icon('download')}
          <strong>ลากไฟล์รายชื่อมาวาง หรือคลิกเพื่อเลือกไฟล์</strong>
          <span>รองรับ CSV / TXT / Excel (.xlsx) — ระบบใช้คอลัมน์แรกเป็นชื่อ</span>
          <input id="roster-file" type="file" accept=".csv,.txt,.xlsx,.xls" hidden />
        </div>
        <p class="muted small" id="roster-status"></p>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-ghost" data-close>ยกเลิก</button>
        <button type="submit" class="btn btn-primary">${icon('plus')}เพิ่มเข้าห้อง</button>
      </div>
    </form>
  `);

  const form = document.getElementById('add-student-form');
  const bulk = form.querySelector('#bulk-names');
  const drop = form.querySelector('#roster-drop');
  const fileInput = form.querySelector('#roster-file');
  const status = form.querySelector('#roster-status');

  const setStatus = (message) => {
    status.textContent = message || '';
  };

  const applyNames = (names) => {
    if (!names.length) {
      setStatus('ไม่พบชื่อในไฟล์ — ลองตรวจว่าคอลัมน์แรกเป็นชื่อนักเรียน');
      return;
    }
    bulk.value = names.join('\n');
    setStatus('พบ ' + names.length + ' ชื่อ — ตรวจแก้ได้ในช่องด้านบนก่อนกดเพิ่ม');
  };

  const loadFile = async (file) => {
    if (!file) return;
    setStatus('กำลังอ่านไฟล์...');
    try {
      applyNames(await readRosterFile(file));
    } catch (error) {
      setStatus(error.message);
    }
  };

  fileInput.addEventListener('change', () => loadFile(fileInput.files && fileInput.files[0]));

  const openPicker = () => fileInput.click();
  drop.addEventListener('click', (event) => {
    if (event.target !== fileInput) openPicker();
  });
  drop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  });
  drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    drop.classList.add('is-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('is-over');
    loadFile(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const fd = new FormData(form);
      const single = String(fd.get('name') || '').trim();
      const names = parseRosterText(String(fd.get('bulk') || ''));
      if (single) names.unshift(single);

      if (!names.length) {
        setFormError(form, 'กรุณากรอกชื่อ หรือแนบไฟล์รายชื่อ');
        button.disabled = false;
        return;
      }

      if (names.length === 1) {
        const data = await api('/api/teacher/classes/' + klass.id + '/students', {
          method: 'POST',
          body: { name: names[0] },
        });
        closeModal();
        toast(data.created ? 'เพิ่มนักเรียนสำเร็จ' : 'นักเรียนคนนี้อยู่ในห้องแล้ว');
      } else {
        const data = await api('/api/teacher/classes/' + klass.id + '/students/import', {
          method: 'POST',
          body: { names },
        });
        closeModal();
        toast(
          'เพิ่ม ' +
            data.added_count +
            ' คน' +
            (data.skipped_count ? ' · ข้าม ' + data.skipped_count + ' คนที่มีอยู่แล้ว' : '')
        );
      }
      renderTeacherClass(klass.id);
    } catch (error) {
      setFormError(form, error.message);
      button.disabled = false;
    }
  });
}

function parseRosterText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.split(/[,;\t]/)[0].trim())
    .filter(Boolean);
}

async function readRosterFile(file) {
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await loadSheetJs();
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
    return rows.map((row) => (row && row[0] != null ? String(row[0]).trim() : '')).filter(Boolean);
  }
  return parseRosterText(await file.text());
}

function loadSheetJs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload = () => resolve(window.XLSX);
    script.onerror = () =>
      reject(new Error('โหลดตัวอ่าน Excel ไม่ได้ (ต้องต่ออินเทอร์เน็ต) — บันทึกเป็น CSV แล้วลองใหม่'));
    document.head.appendChild(script);
  });
}

function rubricRowHtml(label = '', max = '') {
  return `<div class="rubric-build-row">
    <input type="text" name="rubric_label" placeholder="หัวข้อ เช่น ความถูกต้อง" value="${esc(label)}" />
    <input type="number" name="rubric_max" min="1" max="100" step="0.5" placeholder="เต็ม" value="${esc(max)}" />
    <button type="button" class="remove-row" title="ลบหัวข้อ">${icon('x')}</button>
  </div>`;
}

function openCreateActivityModal(klass) {
  openModal(`
    <form id="create-activity-form">
      ${modalHeader('สร้างใบกิจกรรม', `มอบหมายงานให้นักเรียนใน ${klass.name}`)}
      <div class="modal-body form-grid">
        <div class="field">
          <label for="activity-title">ชื่อใบกิจกรรม</label>
          <input id="activity-title" name="title" placeholder="เช่น ใบกิจกรรมที่ 1 – วัฏจักรน้ำ" required maxlength="160" />
        </div>
        <div class="field">
          <label for="activity-description">รายละเอียด / คำสั่ง</label>
          <textarea id="activity-description" name="description" rows="3" placeholder="อธิบายสิ่งที่นักเรียนต้องทำ หรือสิ่งที่ต้องส่ง"></textarea>
        </div>
        <div class="form-row">
          <div class="field">
            <span class="field-label">วิธีตรวจ</span>
            <div class="radio-cards">
              <label class="radio-card">
                <input type="radio" name="mode" value="check" checked />
                <span class="mark">${icon('check')}</span>
                <span>ผ่าน / ไม่ผ่าน</span>
              </label>
              <label class="radio-card">
                <input type="radio" name="mode" value="score" />
                <span class="mark">${icon('check')}</span>
                <span>ให้คะแนน</span>
              </label>
            </div>
          </div>
          <div class="field">
            <label for="activity-due">กำหนดส่ง <span class="hint">(ไม่บังคับ)</span></label>
            <input id="activity-due" name="due_date" type="date" />
          </div>
        </div>
        <div class="field" id="score-settings" style="display:none">
          <div class="divider" style="margin:4px 0"></div>
          <span class="field-label">หัวข้อให้คะแนน</span>
          <div class="rubric-builder" id="rubric-builder">
            ${rubricRowHtml('ความถูกต้องของเนื้อหา', 10)}
            ${rubricRowHtml('ความเรียบร้อยและการนำเสนอ', 5)}
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="add-rubric" style="width:fit-content;margin-top:4px">${icon('plus')}เพิ่มหัวข้อ</button>
          <div class="score-summary" style="margin-top:6px">
            <div>
              <div class="muted small">คะแนนเต็มทั้งหมด</div>
              <div class="total" id="rubric-total">15 <small>คะแนน</small></div>
            </div>
            <div class="field" style="width:150px">
              <label for="pass-score">เกณฑ์ผ่าน</label>
              <input id="pass-score" name="pass_score" type="number" min="0" step="0.5" value="9" />
            </div>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-ghost" data-close>ยกเลิก</button>
        <button type="submit" class="btn btn-primary">${icon('plus')}สร้างใบกิจกรรม</button>
      </div>
    </form>
  `, true);

  const form = document.getElementById('create-activity-form');
  const builder = document.getElementById('rubric-builder');
  const totalEl = document.getElementById('rubric-total');
  const passInput = document.getElementById('pass-score');
  let passTouched = false;

  const recalc = () => {
    const total = Array.from(builder.querySelectorAll('input[name="rubric_max"]')).reduce(
      (sum, input) => sum + (Number(input.value) || 0),
      0
    );
    totalEl.innerHTML = `${scoreText(total)} <small>คะแนน</small>`;
    passInput.max = total;
    if (!passTouched) passInput.value = scoreText(Math.round(total * 0.6 * 2) / 2);
  };

  form.querySelectorAll('input[name="mode"]').forEach((input) => {
    input.addEventListener('change', () => {
      document.getElementById('score-settings').style.display = form.elements.mode.value === 'score' ? '' : 'none';
    });
  });
  builder.addEventListener('input', (event) => {
    if (event.target.name === 'rubric_max') recalc();
  });
  passInput.addEventListener('input', () => {
    passTouched = true;
  });
  builder.addEventListener('click', (event) => {
    const remove = event.target.closest('.remove-row');
    if (!remove) return;
    if (builder.querySelectorAll('.rubric-build-row').length <= 1) {
      toast('ต้องมีหัวข้อให้คะแนนอย่างน้อย 1 หัวข้อ', 'error');
      return;
    }
    remove.closest('.rubric-build-row').remove();
    recalc();
  });
  document.getElementById('add-rubric').addEventListener('click', () => {
    builder.insertAdjacentHTML('beforeend', rubricRowHtml());
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const fd = new FormData(form);
    const mode = fd.get('mode');
    const rubric = Array.from(builder.querySelectorAll('.rubric-build-row')).map((row) => ({
      label: row.querySelector('input[name="rubric_label"]').value.trim(),
      max_score: Number(row.querySelector('input[name="rubric_max"]').value),
    }));
    button.disabled = true;
    try {
      const data = await api(`/api/teacher/classes/${klass.id}/activities`, {
        method: 'POST',
        body: {
          title: fd.get('title'),
          description: fd.get('description'),
          mode,
          due_date: fd.get('due_date') || null,
          rubric: mode === 'score' ? rubric : [],
          pass_score: Number(fd.get('pass_score') || 0),
        },
      });
      closeModal();
      toast('สร้างใบกิจกรรมสำเร็จ');
      go(`#/teacher/activities/${data.activity.id}`);
    } catch (error) {
      setFormError(form, error.message);
      button.disabled = false;
    }
  });
}

/* --------------------------- review modal ------------------------- */

function openReviewModal(studentId) {
  const data = state.teacherActivityData;
  if (!data) return;
  const row = data.rows.find((item) => item.student.id === studentId);
  if (!row) return;
  const { activity, rubric } = data;
  const submission = row.submission;
  const scoreMode = activity.mode === 'score';
  const maxTotal = rubric.reduce((sum, item) => sum + item.max_score, 0);
  const existingScores = (submission && submission.scores) || {};

  const submissionHtml = submission
    ? `<div class="submission-box">
        <div class="head">
          <strong>งานที่นักเรียนส่ง</strong>
          ${statusChip(submission)}
        </div>
        ${
          submission.text
            ? `<p class="submission-text">${esc(submission.text)}</p>`
            : '<p class="muted small">นักเรียนไม่ได้พิมพ์คำตอบ</p>'
        }
        ${
          submission.original_name
            ? `<a class="file-attach" href="/api/files/${submission.id}" target="_blank" rel="noopener">${icon('file')}<span>${esc(submission.original_name)}</span>${icon('download')}</a>`
            : ''
        }
        <p class="muted small" style="margin-top:9px">ส่งเมื่อ ${fmtDateTime(submission.submitted_at)}</p>
      </div>`
    : `<div class="submission-box">
        <div class="head"><strong>ยังไม่มีการส่งงาน</strong></div>
        <p class="muted small">นักเรียนยังไม่ได้ส่งใบกิจกรรมนี้ แต่ครูสามารถบันทึกผลการตรวจจากใบงานกระดาษได้ทันที</p>
      </div>`;

  const scoringHtml = scoreMode
    ? `<div class="rubric-list">
        ${rubric
          .map(
            (item) => `<div class="rubric-row">
              <div class="label">${esc(item.label)}<small>เต็ม ${scoreText(item.max_score)} คะแนน</small></div>
              <input type="number" name="score-${item.id}" min="0" max="${item.max_score}" step="0.5"
                value="${existingScores[item.id] != null ? esc(existingScores[item.id]) : ''}"
                placeholder="0" aria-label="คะแนน ${esc(item.label)}" data-max="${item.max_score}" />
            </div>`
          )
          .join('')}
      </div>
      <div class="score-summary">
        <div>
          <div class="muted small">คะแนนรวม</div>
          <div class="total" id="review-total">0 <small>/ ${scoreText(maxTotal)} คะแนน</small></div>
        </div>
        <div id="review-verdict"><span class="chip chip-outline">ยังไม่ครบเกณฑ์</span></div>
      </div>
      <p class="muted small" style="margin-top:8px">เกณฑ์ผ่าน ${scoreText(activity.pass_score)} คะแนน</p>`
    : `<div class="radio-cards">
        <label class="radio-card">
          <input type="radio" name="passed" value="true" ${submission && submission.passed === 1 ? 'checked' : ''} />
          <span class="mark">${icon('check')}</span>
          <span>ผ่าน</span>
        </label>
        <label class="radio-card fail">
          <input type="radio" name="passed" value="false" ${submission && submission.passed === 0 ? 'checked' : ''} />
          <span class="mark">${icon('x')}</span>
          <span>ไม่ผ่าน</span>
        </label>
      </div>
      <p class="muted small" style="margin-top:10px">เลือกผลการตรวจ แล้วเขียนความคิดเห็นให้นักเรียนได้ด้านซ้าย</p>`;

  openModal(
    `
    <form id="review-form">
      ${modalHeader(
        submission && submission.status === 'reviewed' ? 'ดู / แก้ไขผลการตรวจ' : 'ตรวจใบกิจกรรม',
        `${row.student.name} · ${activity.title}`
      )}
      <div class="modal-body">
        <div class="review-grid">
          <div>
            ${submissionHtml}
            <div class="field">
              <label for="review-feedback">ความคิดเห็นถึงนักเรียน</label>
              <textarea id="review-feedback" name="feedback" rows="4" placeholder="เช่น ทำได้ดี อธิบายครบทุกขั้นตอน">${submission ? esc(submission.feedback || '') : ''}</textarea>
            </div>
          </div>
          <div>
            <div class="field-label" style="margin-bottom:9px">${scoreMode ? 'ให้คะแนนรายหัวข้อ' : 'ผลการตรวจ'}</div>
            ${scoringHtml}
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-ghost" data-close>ยกเลิก</button>
        <button type="submit" class="btn btn-primary">${icon('check')}บันทึกผลการตรวจ</button>
      </div>
    </form>
  `,
    true
  );

  const form = document.getElementById('review-form');

  if (scoreMode) {
    const totalEl = document.getElementById('review-total');
    const verdictEl = document.getElementById('review-verdict');
    const inputs = Array.from(form.querySelectorAll('input[data-max]'));
    const updateTotal = () => {
      const total = inputs.reduce((sum, input) => {
        const value = Math.min(Math.max(Number(input.value) || 0, 0), Number(input.dataset.max));
        return sum + value;
      }, 0);
      totalEl.innerHTML = `${scoreText(total)} <small>/ ${scoreText(maxTotal)} คะแนน</small>`;
      verdictEl.innerHTML =
        total >= activity.pass_score
          ? '<span class="chip chip-green">ผ่านเกณฑ์</span>'
          : '<span class="chip chip-outline">ยังไม่ครบเกณฑ์</span>';
    };
    inputs.forEach((input) => input.addEventListener('input', updateTotal));
    updateTotal();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const body = { student_id: studentId, feedback: form.elements.feedback.value };
    if (scoreMode) {
      body.scores = {};
      form.querySelectorAll('input[data-max]').forEach((input) => {
        body.scores[input.name.replace('score-', '')] =
          input.value === '' ? 0 : Number(input.value);
      });
    } else {
      const checked = form.querySelector('input[name="passed"]:checked');
      if (!checked) {
        setFormError(form, 'กรุณาเลือกผลการตรวจ ผ่าน หรือ ไม่ผ่าน');
        button.disabled = false;
        return;
      }
      body.passed = checked.value === 'true';
    }
    try {
      await api(`/api/teacher/activities/${activity.id}/review`, { method: 'POST', body });
      closeModal();
      toast('บันทึกผลการตรวจแล้ว');
      renderTeacherActivity(activity.id);
    } catch (error) {
      setFormError(form, error.message);
      button.disabled = false;
    }
  });
}

/* ---------------------------- copying ----------------------------- */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('คัดลอกรหัสห้องเรียนแล้ว');
  } catch {
    toast('คัดลอกไม่สำเร็จ กรุณาคัดลอกด้วยตัวเอง', 'error');
  }
}

/* ---------------------------- routing ----------------------------- */

function go(hash) {
  if (location.hash === hash) renderRoute();
  else location.hash = hash;
}

async function renderRoute() {
  if (!state.user) {
    renderAuth();
    return;
  }
  const roleHome = state.user.role === 'teacher' ? '/teacher' : '/student';
  const parts = (location.hash.replace(/^#/, '') || roleHome).split('/').filter(Boolean);
  window.scrollTo(0, 0);

  if (parts[0] !== state.user.role) {
    location.hash = `#${roleHome}`;
    if (parts[0] === 'teacher' && state.user.role === 'student') {
      toast('หน้านี้สำหรับครูผู้สอนเท่านั้น', 'error');
    }
    return;
  }

  if (state.user.role === 'teacher') {
    if (parts.length === 1) return renderTeacherHome();
    if (parts[1] === 'classes' && parts[2]) return renderTeacherClass(Number(parts[2]));
    if (parts[1] === 'activities' && parts[2]) return renderTeacherActivity(Number(parts[2]));
  } else {
    if (parts.length === 1) return renderStudentHome();
    if (parts[1] === 'classes' && parts[2]) return renderStudentClass(Number(parts[2]));
    if (parts[1] === 'activities' && parts[2]) return renderStudentActivity(Number(parts[2]));
  }
  location.hash = `#${roleHome}`;
}

document.addEventListener('click', async (event) => {
  const logout = event.target.closest('[data-action="logout"]');
  if (logout) {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    state.user = null;
    state.authMode = 'login';
    toast('ออกจากระบบแล้ว');
    renderAuth();
  }
});

window.addEventListener('hashchange', renderRoute);

(async function boot() {
  try {
    const data = await api('/api/me');
    state.user = data.user;
  } catch {
    state.user = null;
  }
  if (state.user) {
    const roleHome = state.user.role === 'teacher' ? '/teacher' : '/student';
    if (!location.hash) {
      history.replaceState(null, '', `#${roleHome}`);
    }
  }
  renderRoute();
})();

/* ------------------------- Google Sheets export ------------------------- */
/* data-export-sheet-handler */
document.addEventListener('click', async (event) => {
  const button =
    event.target && event.target.closest ? event.target.closest('[data-export-sheet]') : null;
  if (!button) return;
  event.preventDefault();

  const activityId = button.getAttribute('data-export-sheet');
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = 'กำลังสร้างชีต...';
  try {
    const data = await api('/api/teacher/activities/' + activityId + '/export-sheet', { method: 'POST' });
    toast(data.updated ? 'อัปเดต Google Sheet แล้ว' : 'สร้าง Google Sheet แล้ว');
    window.open(data.url, '_blank', 'noopener');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
});
