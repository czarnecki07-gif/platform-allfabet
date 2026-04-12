import express from 'express';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { query, testDbConnection } from './db.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(x => x.trim()) : true
}));
app.use(express.json({ limit: '25mb' }));

app.use(session({
  secret: 'supersecret123',
  resave: false,
  saveUninitialized: false
}));

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Brak autoryzacji' });
  }
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Brak dostępu (admin only)' });
  }
  next();
}
/*
// 🔐 PROSTE ZABEZPIECZENIE (Basic Auth)
app.use((req, res, next) => {
  const auth = req.headers.authorization;

  if (!auth) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Test Platform"');
    return res.status(401).send('Auth required');
  }

  const base64 = auth.split(' ')[1];
  const [user, pass] = Buffer.from(base64, 'base64').toString().split(':');

  const USER = 'tester';
  const PASS = 'test123';

  if (user === USER && pass === PASS) {
    return next();
  }

  return res.status(403).send('Forbidden');
});
*/

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'course';
}

function sanitizeStatus(status) {
  const allowed = ['draft', 'review', 'needs_fix', 'approved', 'published', 'archived'];
  return allowed.includes(status) ? status : 'draft';
}

function buildNextVersionRows(rows, incomingCourseId) {
  const sameCourse = rows.filter(row => row.course_id === incomingCourseId);
  if (!sameCourse.length) return 1;
  return Math.max(...sameCourse.map(r => Number(r.version || 1))) + 1;
}

function renderHtmlPage(title, body) {
  return `
  <!doctype html>
  <html lang="pl">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>${title}</title>
      <style>
        :root{
          --bg:#0b1020;
          --panel:#121a2b;
          --panel-2:#182338;
          --text:#eef4ff;
          --muted:#9fb0d0;
          --line:rgba(255,255,255,.10);
          --accent:#78a8ff;
          --ok:#7ad7a6;
          --warn:#ffd36e;
          --danger:#ff9d7a;
        }
        *{box-sizing:border-box}
        body{
          margin:0;
          font-family:Inter,Arial,sans-serif;
          background:linear-gradient(180deg,#0a0f1d,#10182b);
          color:var(--text);
        }
        .wrap{
          max-width:1200px;
          margin:0 auto;
          padding:32px 20px 80px;
        }
        h1{
          margin:0 0 8px;
          font-size:32px;
          line-height:1.15;
        }
        .sub{
          margin:0 0 24px;
          color:var(--muted);
          font-size:15px;
        }
        .toolbar{
          display:flex;
          gap:12px;
          flex-wrap:wrap;
          margin-bottom:24px;
        }
        .btn{
          appearance:none;
          border:none;
          border-radius:12px;
          padding:12px 16px;
          background:var(--accent);
          color:white;
          font-weight:700;
          cursor:pointer;
          text-decoration:none;
          display:inline-flex;
          align-items:center;
          justify-content:center;
        }
        .btn.secondary{
          background:var(--panel-2);
          border:1px solid var(--line);
        }
        .grid{
          display:grid;
          grid-template-columns:repeat(auto-fit,minmax(320px,1fr));
          gap:16px;
        }
        .card{
          background:rgba(18,26,43,.92);
          border:1px solid var(--line);
          border-radius:18px;
          padding:18px;
          box-shadow:0 10px 30px rgba(0,0,0,.22);
        }
        .label{
          display:inline-flex;
          align-items:center;
          gap:8px;
          border:1px solid var(--line);
          border-radius:999px;
          padding:6px 10px;
          font-size:12px;
          color:var(--muted);
          background:rgba(255,255,255,.03);
        }
        .title{
          margin:14px 0 8px;
          font-size:20px;
          line-height:1.25;
        }
        .meta{
          display:grid;
          gap:8px;
          color:var(--muted);
          font-size:14px;
          margin-top:12px;
        }
        .row{
          display:flex;
          justify-content:space-between;
          gap:16px;
          border-top:1px solid var(--line);
          padding-top:10px;
        }
        .empty{
          padding:28px;
          border:1px dashed var(--line);
          border-radius:16px;
          color:var(--muted);
          text-align:center;
          background:rgba(255,255,255,.02);
        }
        .topbar{
          display:flex;
          justify-content:space-between;
          align-items:flex-start;
          gap:16px;
          flex-wrap:wrap;
          margin-bottom:22px;
        }
        .status{
          font-weight:700;
          text-transform:uppercase;
          letter-spacing:.04em;
          font-size:12px;
        }
        .status.draft{color:var(--warn)}
        .status.review{color:#8ec5ff}
        .status.needs_fix{color:var(--danger)}
        .status.approved{color:#95f0b8}
        .status.published{color:#7ad7a6}
        .status.archived{color:#a5a5a5}
        a.link{
          color:#c9ddff;
          text-decoration:none;
        }
        a.link:hover{
          text-decoration:underline;
        }
        .notice{
          margin-bottom:18px;
          padding:14px 16px;
          border:1px solid var(--line);
          border-radius:14px;
          background:rgba(255,255,255,.03);
          color:var(--muted);
        }
      </style>
    </head>
    <body>
      ${body}
    </body>
  </html>
  `;
}

async function importProjectObject(project, { status = 'draft', skipIfExists = false } = {}) {
  if (!project || typeof project !== 'object') {
    throw new Error('Brakuje obiektu project.');
  }

  const title = String(project?.course?.title || '').trim();
  if (!title) {
    throw new Error('Projekt nie zawiera nazwy kursu.');
  }

  const courseId = String(project?.meta?.projectId || `course_${Date.now()}`);
  const slugBase = String(project?.course?.courseCode || title).trim();
  const slug = slugify(slugBase);
  const language = String(project?.course?.language || 'pl').trim() || 'pl';
  const courseCode = String(project?.course?.courseCode || '').trim();

  const existing = await query(
    'SELECT id, course_id, slug, title, course_code, language, status, version, created_at, updated_at FROM courses WHERE slug = $1 OR course_id = $2 ORDER BY version ASC',
    [slug, courseId]
  );

  if (skipIfExists && existing.rows.length) {
    return {
      skipped: true,
      reason: 'Kurs już istnieje w bazie.',
      course: existing.rows[existing.rows.length - 1]
    };
  }

  const version = buildNextVersionRows(existing.rows, courseId);

  const insert = await query(`
    INSERT INTO courses (
      course_id,
      slug,
      title,
      course_code,
      language,
      status,
      version,
      source_project_json,
      outline_json,
      sections_json,
      final_exam_json,
      final_practical_exam_json,
      certificate_json,
      export_package_json,
      files_json
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb
    )
    RETURNING id, course_id, slug, title, course_code, language, status, version, created_at, updated_at
  `, [
    courseId,
    slug,
    title,
    courseCode,
    language,
    sanitizeStatus(String(status)),
    version,
    JSON.stringify(project),
    JSON.stringify(project?.outline || []),
    JSON.stringify(project?.sections || []),
    JSON.stringify(project?.finalExam || null),
    JSON.stringify(project?.finalPracticalExam || null),
    JSON.stringify(project?.certificate || null),
    JSON.stringify(project?.exportPackage || null),
    JSON.stringify(project?.files || [])
  ]);

  return {
    skipped: false,
    reason: null,
    course: insert.rows[0]
  };
}

async function importProjectsFromImportsDir() {
  const importsDir = path.join(process.cwd(), 'imports');
  const imported = [];
  const skipped = [];

  let entries;
  try {
    entries = await fs.readdir(importsDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        imported,
        skipped,
        message: 'Folder imports nie istnieje.'
      };
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const projectJsonPath = path.join(importsDir, entry.name, 'project.json');

    try {
      const raw = await fs.readFile(projectJsonPath, 'utf8');
      const project = JSON.parse(raw);

      const result = await importProjectObject(project, {
        status: 'draft',
        skipIfExists: true
      });

      if (result.skipped) {
        skipped.push({
          folder: entry.name,
          reason: result.reason,
          course: result.course
        });
      } else {
        imported.push({
          folder: entry.name,
          course: result.course
        });
      }
    } catch (error) {
      skipped.push({
        folder: entry.name,
        reason: `Nie udało się odczytać lub zaimportować project.json: ${error.message}`
      });
    }
  }

  return {
    imported,
    skipped,
    message: 'Import z folderu imports zakończony.'
  };
}

app.get('/api/health', async (req, res) => {
  try {
    const db = await testDbConnection();
    return res.json({
      ok: true,
      app: 'platform',
      dbTime: db.now
    });
  } catch (error) {
    console.error('health error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Błąd połączenia z bazą danych.'
    });
  }
});

app.get('/api/courses', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status ? sanitizeStatus(String(req.query.status)) : null;

    let sql = `
      SELECT id, course_id, slug, title, course_code, language, status, version, created_at, updated_at
      FROM courses
    `;
    const params = [];

    if (status) {
      sql += ' WHERE status = $1';
      params.push(status);
    }

    sql += ' ORDER BY updated_at DESC, id DESC';

    const result = await query(sql, params);

    return res.json({
      courses: result.rows
    });
  } catch (error) {
    console.error('list courses error:', error);
    return res.status(500).json({
      error: 'Nie udało się pobrać listy kursów.'
    });
  }
});

app.get('/api/my-courses', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const result = await query(`
      SELECT c.id, c.title, c.slug, c.course_code, c.language, c.status, c.version, c.updated_at
      FROM courses c
      JOIN enrollments e ON e.course_id = c.id
      WHERE e.user_id = $1 AND e.status = 'active'
      ORDER BY c.updated_at DESC
    `, [userId]);

    res.json({
      courses: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Błąd pobierania kursów użytkownika' });
  }
});
app.get('/api/course-feedback/:courseId', requireAdmin, async (req, res) => {
  try {
    const courseId = Number(req.params.courseId);

    const result = await query(`
      SELECT cf.*, u.email
      FROM course_feedback cf
      JOIN users u ON u.id = cf.user_id
      WHERE cf.course_id = $1
      ORDER BY cf.created_at DESC
    `, [courseId]);

    res.json({
      feedback: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Błąd pobierania uwag' });
  }
});
app.get('/api/courses/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Nieprawidłowe ID kursu.' });
    }

    const result = await query('SELECT * FROM courses WHERE id = $1 LIMIT 1', [id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Nie znaleziono kursu.' });
    }

    return res.json({
      course: result.rows[0]
    });
  } catch (error) {
    console.error('get course error:', error);
    return res.status(500).json({
      error: 'Nie udało się pobrać kursu.'
    });
  }
});

app.post('/api/courses/import', async (req, res) => {
  try {
    const { project, status = 'draft' } = req.body || {};
    const result = await importProjectObject(project, {
      status,
      skipIfExists: false
    });

    return res.status(201).json({
      message: 'Kurs został zaimportowany.',
      course: result.course
    });
  } catch (error) {
    console.error('import course error:', error);
    return res.status(500).json({
      error: error.message || 'Nie udało się zaimportować kursu.'
    });
  }
});

app.post('/api/import', async (req, res) => {
  try {
    const result = await importProjectsFromImportsDir();
    return res.json(result);
  } catch (error) {
    console.error('imports dir import error:', error);
    return res.status(500).json({
      error: 'Nie udało się zaimportować kursów z folderu imports.'
    });
  }
});

app.get('/api/import', async (req, res) => {
  try {
    const result = await importProjectsFromImportsDir();
    return res.json(result);
  } catch (error) {
    console.error('imports dir import error:', error);
    return res.status(500).json({
      error: 'Nie udało się zaimportować kursów z folderu imports.'
    });
  }
});

app.patch('/api/courses/:id/status', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const nextStatus = sanitizeStatus(String(req.body?.status || ''));

    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Nieprawidłowe ID kursu.' });
    }

    const result = await query(`
      UPDATE courses
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, course_id, slug, title, course_code, language, status, version, created_at, updated_at
    `, [id, nextStatus]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Nie znaleziono kursu.' });
    }

    return res.json({
      message: 'Status kursu został zaktualizowany.',
      course: result.rows[0]
    });
  } catch (error) {
    console.error('update status error:', error);
    return res.status(500).json({
      error: 'Nie udało się zmienić statusu kursu.'
    });
  }
});

app.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT id, course_id, slug, title, course_code, language, status, version, created_at, updated_at
      FROM courses
      ORDER BY updated_at DESC, id DESC
    `);

    const notice = `
      <div class="notice">
        Import kursów z folderu <strong>imports</strong>: 
        <a class="link" href="/api/import">uruchom import</a>
      </div>
    `;

    const cards = result.rows.length
      ? `
        <div class="grid">
          ${result.rows.map(course => `
            <div class="card">
              <div class="topbar">
                <span class="label">ID: ${course.id}</span>
                <span class="status ${course.status}">${course.status}</span>
              </div>
              <div class="title">${course.title}</div>
             <div class="meta">
  <div><strong>Code:</strong> ${course.course_code || 'brak'}</div>
  <div><strong>Slug:</strong> ${course.slug}</div>
  <div><strong>Język:</strong> ${course.language}</div>
  <div><strong>Wersja:</strong> ${course.version}</div>
  <div><strong>Utworzono:</strong> ${new Date(course.created_at).toLocaleString('pl-PL')}</div>
  <div><strong>Aktualizacja:</strong> ${new Date(course.updated_at).toLocaleString('pl-PL')}</div>
</div>

<div style="margin-top:10px; color:#ff6b6b; font-size:14px;">
  <strong>Uwagi testera:</strong><br/>
  <span id="feedback-${course.id}">ładowanie...</span>
</div>

<script>
fetch('/api/course-feedback/${course.id}')
  .then(res => res.json())
  .then(data => {
    const el = document.getElementById('feedback-${course.id}');
    if (!data.feedback.length) {
      el.innerText = 'brak uwag';
    } else {
      el.innerText = data.feedback.map(f => f.comment).join(' | ');
    }
  })
  .catch(() => {
    document.getElementById('feedback-${course.id}').innerText = 'błąd ładowania';
  });
</script>

<div class="meta" style="margin-top:16px;">
  <div class="row">
    <span>API</span>
    <a class="link" href="/api/courses/${course.id}" target="_blank" rel="noopener">Zobacz JSON kursu</a>
  </div>

<div class="row">
  <span>Akcje admina</span>
  <div style="display:flex; gap:8px; flex-wrap:wrap;">
    
 <button class="btn secondary"
onclick="fetch('/api/courses/${course.id}/status',{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({status:'review'})}).then(r=>r.json()).then(()=>location.reload()).catch(()=>alert('err'))">
Do testera
</button>

    <button class="btn secondary"
      onclick="fetch('/api/courses/${course.id}/status',{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({status:'approved'})})
      .then(r=>r.json())
      .then(()=>window.location.reload())
      .catch(()=>alert('błąd'))">
      Zatwierdź
    </button>

    <button class="btn secondary"
      onclick="fetch('/api/courses/${course.id}/status',{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({status:'published'})})
      .then(r=>r.json())
      .then(()=>window.location.reload())
      .catch(()=>alert('błąd'))">
      Opublikuj
    </button>

    <button class="btn secondary"
      onclick="fetch('/api/courses/${course.id}/status',{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({status:'archived'})})
      .then(r=>r.json())
      .then(()=>window.location.reload())
      .catch(()=>alert('błąd'))">
      Wycofaj
    </button>

  </div>
</div>

  </div>
</div>
</div>
          `).join('')}
        </div>
      `
      : `<div class="empty">Brak kursów w bibliotece.</div>`;

    const html = renderHtmlPage('Platforma kursów', `
      <div class="wrap">

        <h1>Platforma kursów</h1>
        <p>Zalogowany jako: ${req.session.user.email} (${req.session.user.role})</p>
        <p class="sub">Centralna biblioteka kursów. Tu będą później: panel admina treści, panel testera i panel użytkownika.</p>

        <div class="toolbar">
          <button class="btn" onclick="window.location.reload()">Odśwież listę</button>
          <a href="/api/courses" class="btn secondary">API kursów</a>
          <a href="/api/health" class="btn secondary">Health</a>
          <a href="/logout" class="btn secondary">Wyloguj</a>
        </div>

        ${notice}
      ${cards}

      <script>
        function updateCourseStatus(courseId, status) {
          fetch('/api/courses/' + courseId + '/status', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ status })
          })
          .then(async (res) => {
            const data = await res.json();
            if (!res.ok) {
              throw new Error(data.error || 'Błąd zmiany statusu');
            }
            location.reload();
          })
          .catch((err) => {
            alert(err.message || 'Błąd zmiany statusu');
          });
        }
      </script>

    </div>
    `);

    return res.send(html);
  } catch (error) {
    console.error('home page error:', error);
    return res.status(500).send('Błąd renderowania strony głównej.');
  }
});
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, role = 'student' } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email i hasło wymagane.' });
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role',
      [email, hash, role]
    );

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Błąd rejestracji' });
  }
});
app.post('/api/feedback', requireAuth, async (req, res) => {
  try {
    const { course_id, comment } = req.body;

    if (!course_id || !comment) {
      return res.status(400).json({ error: 'course_id i comment są wymagane' });
    }

    const result = await query(
      `INSERT INTO course_feedback (course_id, user_id, comment)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [course_id, req.session.user.id, comment]
    );

    res.json({
      message: 'Uwaga została dodana',
      feedback: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Błąd dodawania uwagi' });
  }
});
app.post('/api/enroll', requireAdmin, async (req, res) => {
  try {
    const { user_id, course_id } = req.body;

    if (!user_id || !course_id) {
      return res.status(400).json({ error: 'user_id i course_id wymagane' });
    }

    const result = await query(
      `INSERT INTO enrollments (user_id, course_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, course_id) DO NOTHING
       RETURNING *`,
      [user_id, course_id]
    );

    res.json({
      message: 'Użytkownik przypisany do kursu',
      enrollment: result.rows[0] || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Błąd przypisania' });
  }
});
app.get('/login', (req, res) => {
  res.send(`
    <html>
      <body style="font-family: Arial; padding: 40px;">
        <h2>Logowanie admina</h2>
        <form method="POST" action="/login">
          <div>
            <input name="email" placeholder="email" />
          </div>
          <div>
            <input name="password" type="password" placeholder="hasło" />
          </div>
          <button type="submit">Zaloguj</button>
        </form>

<script>
function updateCourseStatus(courseId, status) {
  fetch('/api/courses/' + courseId + '/status', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify({ status })
  })
  .then(res => res.json())
  .then(() => {
    location.reload();
  })
  .catch(() => {
    alert('Błąd zmiany statusu');
  });
}
</script>
      </body>
    </html>
  `);
});

app.post('/login', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await query('SELECT * FROM users WHERE email = $1', [email]);

    if (!result.rows.length) {
      return res.send('Brak użytkownika');
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);

    if (!ok) {
      return res.send('Złe hasło');
    }

    req.session.user = {
      id: user.id,
      email: user.email,
      role: user.role
    };

    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.send('Błąd logowania');
  }
});
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await query('SELECT * FROM users WHERE email = $1', [email]);

    if (!result.rows.length) {
      return res.status(400).json({ error: 'Nie ma takiego użytkownika' });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);

    if (!ok) {
      return res.status(400).json({ error: 'Złe hasło' });
    }

    req.session.user = {
      id: user.id,
      email: user.email,
      role: user.role
    };

    res.json({ message: 'Zalogowano', user: req.session.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Błąd logowania' });
  }
});
app.get('/api/me', requireAuth, (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Brak autoryzacji' });
  }

  return res.json({
    user: req.session.user
  });
});
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});
app.listen(port, () => {
  console.log(`PLATFORM START: http://localhost:${port}`);
});