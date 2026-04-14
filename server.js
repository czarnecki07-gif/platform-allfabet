import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import { query, testDbConnection } from './db.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(x => x.trim()) : true,
  credentials: true
}));

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecret123',
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderHtmlPage(title, body) {
  return `
  <!doctype html>
  <html lang="pl">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>${escapeHtml(title)}</title>
      <style>
        :root{
          --bg:#0b1020;
          --panel:#121a2b;
          --panel-2:#182338;
          --text:#eef4ff;
          --muted:#9fb0d0;
          --line:rgba(255,255,255,.10);
          --accent:#78a8ff;
          --accent-2:#9a7cff;
          --ok:#7ad7a6;
          --warn:#ffd36e;
          --danger:#ff7f7f;
        }
        *{box-sizing:border-box}
        body{
          margin:0;
          font-family:Inter,Arial,sans-serif;
          background:
            radial-gradient(circle at top left, rgba(120,168,255,.16), transparent 30%),
            radial-gradient(circle at top right, rgba(154,124,255,.14), transparent 26%),
            linear-gradient(180deg,#0a0f1d,#10182b);
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
        h2{
          margin:0 0 12px;
          font-size:22px;
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
          align-items:center;
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
        .btn.small{
          padding:8px 12px;
          font-size:13px;
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
          align-items:center;
          gap:16px;
          border-top:1px solid var(--line);
          padding-top:10px;
          flex-wrap:wrap;
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
        .status.needs_fix{color:#ff9d7a}
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
        .feedback-box{
          margin-top:12px;
          padding:12px;
          border:1px solid rgba(255,107,107,.35);
          border-radius:12px;
          background:rgba(255,107,107,.08);
          color:#ffb3b3;
          font-size:14px;
        }
        .feedback-title{
          font-weight:700;
          margin-bottom:8px;
          color:#ff8d8d;
        }
        .feedback-item{
          margin-bottom:6px;
        }
        .actions{
          display:flex;
          gap:8px;
          flex-wrap:wrap;
        }
        .inline-form{
          margin:0;
        }
        .login-wrap{
          max-width:420px;
          margin:60px auto;
          background:rgba(18,26,43,.92);
          border:1px solid var(--line);
          border-radius:18px;
          padding:24px;
          box-shadow:0 10px 30px rgba(0,0,0,.22);
        }
        .field{
          width:100%;
          margin-bottom:12px;
          padding:12px 14px;
          border-radius:12px;
          border:1px solid var(--line);
          background:#0f1728;
          color:var(--text);
        }
        .hero{
          display:grid;
          grid-template-columns:1.25fr .75fr;
          gap:18px;
          margin-bottom:24px;
        }
        .hero-card{
          background:linear-gradient(135deg, rgba(120,168,255,.18), rgba(154,124,255,.14));
          border:1px solid var(--line);
          border-radius:24px;
          padding:24px;
          box-shadow:0 18px 40px rgba(0,0,0,.18);
        }
        .hero-kicker{
          display:inline-block;
          margin-bottom:12px;
          padding:6px 10px;
          border-radius:999px;
          font-size:12px;
          border:1px solid rgba(255,255,255,.14);
          color:#d6e5ff;
          background:rgba(255,255,255,.05);
        }
        .hero-title{
          margin:0 0 10px;
          font-size:34px;
          line-height:1.12;
        }
        .hero-desc{
          margin:0;
          color:#d2def7;
          line-height:1.6;
        }
        .stats{
          display:grid;
          grid-template-columns:repeat(3, 1fr);
          gap:12px;
          margin-top:18px;
        }
        .stat{
          background:rgba(255,255,255,.04);
          border:1px solid var(--line);
          border-radius:18px;
          padding:14px;
        }
        .stat-value{
          font-size:28px;
          font-weight:800;
          margin-bottom:4px;
        }
        .stat-label{
          color:var(--muted);
          font-size:13px;
        }
        .course-card{
          position:relative;
          overflow:hidden;
          border-radius:22px;
          border:1px solid var(--line);
          background:
            linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.01)),
            rgba(18,26,43,.94);
          padding:20px;
          box-shadow:0 18px 40px rgba(0,0,0,.18);
        }
        .course-card::before{
          content:'';
          position:absolute;
          inset:0;
          background:linear-gradient(135deg, rgba(120,168,255,.08), transparent 35%, rgba(154,124,255,.07));
          pointer-events:none;
        }
        .course-top{
          position:relative;
          display:flex;
          justify-content:space-between;
          gap:14px;
          align-items:flex-start;
          margin-bottom:18px;
        }
        .course-code{
          display:inline-flex;
          padding:6px 10px;
          border-radius:999px;
          background:rgba(255,255,255,.05);
          border:1px solid var(--line);
          color:#d9e6ff;
          font-size:12px;
        }
        .course-status{
          display:inline-flex;
          padding:6px 10px;
          border-radius:999px;
          background:rgba(122,215,166,.10);
          border:1px solid rgba(122,215,166,.22);
          color:#9ff0bd;
          font-size:12px;
          font-weight:700;
          text-transform:uppercase;
        }
        .course-name{
          position:relative;
          margin:0 0 10px;
          font-size:22px;
          line-height:1.22;
        }
        .course-desc{
          position:relative;
          margin:0 0 16px;
          color:var(--muted);
          line-height:1.6;
          min-height:48px;
        }
        .progress-wrap{
          position:relative;
          margin-bottom:16px;
        }
        .progress-label{
          display:flex;
          justify-content:space-between;
          margin-bottom:8px;
          color:#dbe7ff;
          font-size:13px;
        }
        .progress-bar{
          width:100%;
          height:12px;
          border-radius:999px;
          background:rgba(255,255,255,.08);
          overflow:hidden;
          border:1px solid rgba(255,255,255,.05);
        }
        .progress-bar > span{
          display:block;
          height:100%;
          border-radius:999px;
          background:linear-gradient(90deg, var(--accent), var(--accent-2));
        }
        .course-meta{
          position:relative;
          display:grid;
          grid-template-columns:repeat(2, minmax(0, 1fr));
          gap:10px;
          margin-bottom:16px;
          color:var(--muted);
          font-size:13px;
        }
        .course-actions{
          position:relative;
          display:flex;
          gap:10px;
          flex-wrap:wrap;
        }
        .ghost{
          background:transparent;
          border:1px solid var(--line);
        }
        @media (max-width: 900px){
          .hero{
            grid-template-columns:1fr;
          }
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

    return res.json({
      courses: result.rows
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Błąd pobierania kursów użytkownika' });
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

    return res.json({
      feedback: result.rows
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Błąd pobierania uwag' });
  }
});

app.get('/api/courses/:id', requireAdmin, async (req, res) => {
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

app.post('/api/courses/import', requireAdmin, async (req, res) => {
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

app.get('/api/import', requireAdmin, async (req, res) => {
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

app.patch('/api/courses/:id/status', requireAdmin, async (req, res) => {
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

app.post('/admin/courses/:id/status', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const nextStatus = sanitizeStatus(String(req.body?.status || ''));

    if (!Number.isInteger(id)) {
      return res.status(400).send('Nieprawidłowe ID kursu.');
    }

    const result = await query(`
      UPDATE courses
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `, [id, nextStatus]);

    if (!result.rows.length) {
      return res.status(404).send('Nie znaleziono kursu.');
    }

    return res.redirect('/');
  } catch (error) {
    console.error('admin status change error:', error);
    return res.status(500).send('Błąd zmiany statusu.');
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

    return res.json({
      message: 'Uwaga została dodana',
      feedback: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Błąd dodawania uwagi' });
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

    return res.json({
      message: 'Użytkownik przypisany do kursu',
      enrollment: result.rows[0] || null
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Błąd przypisania' });
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

    return res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Błąd rejestracji' });
  }
});

app.get('/login', (req, res) => {
  res.send(renderHtmlPage('Logowanie', `
    <div class="login-wrap">
      <h2>Logowanie</h2>
      <p class="sub">Zaloguj się do platformy kursów.</p>
      <form method="POST" action="/login">
        <input class="field" name="email" placeholder="email" />
        <input class="field" name="password" type="password" placeholder="hasło" />
        <button class="btn" type="submit">Zaloguj</button>
      </form>
    </div>
  `));
});

app.post('/login', async (req, res) => {
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

    if (user.role === 'admin') {
      return res.redirect('/');
    }

    return res.redirect('/moje-kursy');
  } catch (err) {
    console.error(err);
    return res.send('Błąd logowania');
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

    return res.json({ message: 'Zalogowano', user: req.session.user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Błąd logowania' });
  }
});

app.get('/api/me', requireAuth, (req, res) => {
  return res.json({
    user: req.session.user
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/moje-kursy', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const result = await query(`
      SELECT
        c.id,
        c.title,
        c.slug,
        c.course_code,
        c.language,
        c.status,
        c.version,
        c.updated_at,
        e.access_type,
        e.source,
        e.status AS enrollment_status,
        e.valid_from,
        e.valid_to
      FROM courses c
      JOIN enrollments e ON e.course_id = c.id
      WHERE e.user_id = $1 AND e.status = 'active'
      ORDER BY c.updated_at DESC, c.id DESC
    `, [userId]);

    const totalCourses = result.rows.length;
    const activeCourses = result.rows.filter(row => row.enrollment_status === 'active').length;
    const publishedCourses = result.rows.filter(row => row.status === 'published').length;

    const cards = result.rows.length
      ? `
        <div class="grid">
          ${result.rows.map((course, index) => {
            const fakeProgress = Math.min(95, 18 + (index * 17));
            return `
              <div class="course-card">
                <div class="course-top">
                  <span class="course-code">${escapeHtml(course.course_code || 'Kurs online')}</span>
                  <span class="course-status">${escapeHtml(course.status)}</span>
                </div>

                <h2 class="course-name">${escapeHtml(course.title)}</h2>
                <p class="course-desc">
                  Twoje miejsce nauki. Tutaj zobaczysz postęp, wejdziesz do lekcji i wrócisz do ostatnio przerwanego materiału.
                </p>

                <div class="progress-wrap">
                  <div class="progress-label">
                    <span>Postęp kursu</span>
                    <strong>${fakeProgress}%</strong>
                  </div>
                  <div class="progress-bar">
                    <span style="width:${fakeProgress}%"></span>
                  </div>
                </div>

                <div class="course-meta">
                  <div><strong>Język:</strong> ${escapeHtml(course.language)}</div>
                  <div><strong>Wersja:</strong> ${escapeHtml(course.version)}</div>
                  <div><strong>Dostęp:</strong> ${escapeHtml(course.access_type)}</div>
                  <div><strong>Źródło:</strong> ${escapeHtml(course.source)}</div>
                </div>

                <div class="course-actions">
                  <a href="/api/my-courses" class="btn">Kontynuuj kurs</a>
                  <a href="/logout" class="btn secondary ghost">Wyloguj</a>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `
      : `<div class="empty">Nie masz jeszcze przypisanych kursów.</div>`;

    const html = renderHtmlPage('Moje kursy', `
      <div class="wrap">
        <div class="hero">
          <div class="hero-card">
            <span class="hero-kicker">Panel kursanta</span>
            <h1 class="hero-title">Witaj, ${escapeHtml(req.session.user.email)}</h1>
            <p class="hero-desc">
              Tutaj znajdziesz wszystkie swoje kursy, szybko wrócisz do nauki i zobaczysz postęp bez chaosu.
            </p>

            <div class="stats">
              <div class="stat">
                <div class="stat-value">${totalCourses}</div>
                <div class="stat-label">Wszystkie kursy</div>
              </div>
              <div class="stat">
                <div class="stat-value">${activeCourses}</div>
                <div class="stat-label">Aktywne dostępy</div>
              </div>
              <div class="stat">
                <div class="stat-value">${publishedCourses}</div>
                <div class="stat-label">Opublikowane</div>
              </div>
            </div>
          </div>

          <div class="hero-card">
            <span class="hero-kicker">Szybkie akcje</span>
            <h2 style="margin:0 0 10px;">Twoja nauka</h2>
            <p class="hero-desc" style="margin-bottom:18px;">
              Z tego miejsca przejdziesz do kursów, sprawdzisz aktywne dostępy i wrócisz do ostatniej lekcji.
            </p>
            <div class="toolbar" style="margin-bottom:0;">
              <button class="btn" onclick="window.location.reload()">Odśwież panel</button>
              <a href="/api/my-courses" class="btn secondary">API moich kursów</a>
              <a href="/logout" class="btn secondary">Wyloguj</a>
            </div>
          </div>
        </div>

        ${cards}
      </div>
    `);

    return res.send(html);
  } catch (error) {
    console.error('student page error:', error);
    return res.status(500).send('Błąd renderowania panelu kursanta.');
  }
});

app.get('/', requireAdmin, async (req, res) => {
  try {
    const coursesResult = await query(`
      SELECT id, course_id, slug, title, course_code, language, status, version, created_at, updated_at
      FROM courses
      ORDER BY updated_at DESC, id DESC
    `);

    const feedbackResult = await query(`
      SELECT cf.course_id, cf.comment, cf.created_at, u.email
      FROM course_feedback cf
      JOIN users u ON u.id = cf.user_id
      ORDER BY cf.created_at DESC
    `);

    const feedbackByCourseId = new Map();
    for (const row of feedbackResult.rows) {
      const key = String(row.course_id);
      if (!feedbackByCourseId.has(key)) {
        feedbackByCourseId.set(key, []);
      }
      feedbackByCourseId.get(key).push(row);
    }

    const notice = `
      <div class="notice">
        Import kursów z folderu <strong>imports</strong>:
        <a class="link" href="/api/import">uruchom import</a>
      </div>
    `;

    const cards = coursesResult.rows.length
      ? `
        <div class="grid">
          ${coursesResult.rows.map(course => {
            const feedbackItems = feedbackByCourseId.get(String(course.id)) || [];

            const feedbackHtml = feedbackItems.length
              ? `
                <div class="feedback-box">
                  <div class="feedback-title">Uwagi testera:</div>
                  ${feedbackItems.map(item => `
                    <div class="feedback-item">
                      • ${escapeHtml(item.comment)} <br/>
                      <small>od: ${escapeHtml(item.email)} | ${new Date(item.created_at).toLocaleString('pl-PL')}</small>
                    </div>
                  `).join('')}
                </div>
              `
              : `
                <div class="feedback-box">
                  <div class="feedback-title">Uwagi testera:</div>
                  <div class="feedback-item">brak uwag</div>
                </div>
              `;

            return `
              <div class="card">
                <div class="topbar">
                  <span class="label">ID: ${course.id}</span>
                  <span class="status ${course.status}">${escapeHtml(course.status)}</span>
                </div>

                <div class="title">${escapeHtml(course.title)}</div>

                <div class="meta">
                  <div><strong>Code:</strong> ${escapeHtml(course.course_code || 'brak')}</div>
                  <div><strong>Slug:</strong> ${escapeHtml(course.slug)}</div>
                  <div><strong>Język:</strong> ${escapeHtml(course.language)}</div>
                  <div><strong>Wersja:</strong> ${escapeHtml(course.version)}</div>
                  <div><strong>Utworzono:</strong> ${new Date(course.created_at).toLocaleString('pl-PL')}</div>
                  <div><strong>Aktualizacja:</strong> ${new Date(course.updated_at).toLocaleString('pl-PL')}</div>
                </div>

                ${feedbackHtml}

                <div class="meta" style="margin-top:16px;">
                  <div class="row">
                    <span>API</span>
                    <a class="link" href="/api/courses/${course.id}" target="_blank" rel="noopener">Zobacz JSON kursu</a>
                  </div>

                  <div class="row">
                    <span>Akcje admina</span>
                    <div class="actions">
                      <form class="inline-form" method="POST" action="/admin/courses/${course.id}/status">
                        <input type="hidden" name="status" value="review" />
                        <button class="btn secondary small" type="submit">Do testera</button>
                      </form>

                      <form class="inline-form" method="POST" action="/admin/courses/${course.id}/status">
                        <input type="hidden" name="status" value="approved" />
                        <button class="btn secondary small" type="submit">Zatwierdź</button>
                      </form>

                      <form class="inline-form" method="POST" action="/admin/courses/${course.id}/status">
                        <input type="hidden" name="status" value="published" />
                        <button class="btn secondary small" type="submit">Opublikuj</button>
                      </form>

                      <form class="inline-form" method="POST" action="/admin/courses/${course.id}/status">
                        <input type="hidden" name="status" value="archived" />
                        <button class="btn secondary small" type="submit">Wycofaj</button>
                      </form>
                    </div>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `
      : `<div class="empty">Brak kursów w bibliotece.</div>`;

    const html = renderHtmlPage('Platforma kursów', `
      <div class="wrap">
        <h1>Platforma kursów</h1>
        <p>Zalogowany jako: ${escapeHtml(req.session.user.email)} (${escapeHtml(req.session.user.role)})</p>
        <p class="sub">Centralna biblioteka kursów. Tu będą później: panel admina treści, panel testera i panel użytkownika.</p>

        <div class="toolbar">
          <button class="btn" onclick="window.location.reload()">Odśwież listę</button>
          <a href="/api/courses" class="btn secondary">API kursów</a>
          <a href="/api/health" class="btn secondary">Health</a>
          <a href="/logout" class="btn secondary">Wyloguj</a>
        </div>

        ${notice}
        ${cards}
      </div>
    `);

    return res.send(html);
  } catch (error) {
    console.error('home page error:', error);
    return res.status(500).send('Błąd renderowania strony głównej.');
  }
});

app.listen(port, () => {
  console.log(`PLATFORM START: http://localhost:${port}`);
});