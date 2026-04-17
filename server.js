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

function getLessonThumbnailUrl(lesson) {
  const customUrl = lesson?.customImages?.[0]?.url;
  if (customUrl) return customUrl;

  const generatedUrl = lesson?.generatedImage?.url;
  if (generatedUrl) return generatedUrl;

  return '';
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
          --bg:#07111f;
          --panel:#101b2d;
          --panel-2:#16243a;
          --panel-3:#1c3152;
          --text:#eef4ff;
          --muted:#9db0d1;
          --line:rgba(255,255,255,.10);
          --accent:#6ea8ff;
          --accent-2:#9b7cff;
          --ok:#7ad7a6;
          --warn:#ffd36e;
          --danger:#ff7f7f;
          --shadow:0 18px 44px rgba(0,0,0,.24);
        }
        *{box-sizing:border-box}
        html, body{min-height:100%}
        body{
          margin:0;
          font-family:Inter,Arial,sans-serif;
          color:var(--text);
          background:
            radial-gradient(circle at 10% 0%, rgba(110,168,255,.18), transparent 28%),
            radial-gradient(circle at 90% 0%, rgba(155,124,255,.16), transparent 24%),
            linear-gradient(180deg, #08111e, #0d1728 48%, #111c2e 100%);
        }
        .wrap{
          max-width:1280px;
          margin:0 auto;
          padding:32px 20px 80px;
        }
        h1{
          margin:0 0 8px;
          font-size:34px;
          line-height:1.12;
        }
        h2{
          margin:0 0 12px;
          font-size:22px;
        }
        .sub{
          margin:0 0 24px;
          color:var(--muted);
          font-size:15px;
          line-height:1.55;
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
          border-radius:14px;
          padding:12px 16px;
          background:linear-gradient(135deg, var(--accent), var(--accent-2));
          color:white;
          font-weight:700;
          cursor:pointer;
          text-decoration:none;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          box-shadow:0 10px 24px rgba(110,168,255,.18);
        }
        .btn.secondary{
          background:var(--panel-2);
          border:1px solid var(--line);
          box-shadow:none;
        }
        .btn.ghost{
          background:transparent;
          border:1px solid var(--line);
          box-shadow:none;
        }
        .btn.small{
          padding:8px 12px;
          font-size:13px;
          border-radius:12px;
        }
        .grid{
          display:grid;
          grid-template-columns:repeat(auto-fit,minmax(320px,1fr));
          gap:18px;
        }
        .card{
          background:rgba(16,27,45,.96);
          border:1px solid var(--line);
          border-radius:22px;
          padding:20px;
          box-shadow:var(--shadow);
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
          line-height:1.3;
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
          border-radius:18px;
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
          margin-bottom:20px;
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
          margin-top:14px;
          padding:14px;
          border:1px solid rgba(255,107,107,.35);
          border-radius:14px;
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
          margin-bottom:8px;
          line-height:1.5;
        }
        .actions{
          display:flex;
          gap:8px;
          flex-wrap:wrap;
        }
        .inline-form{margin:0}
        .login-wrap{
          max-width:430px;
          margin:64px auto;
          background:rgba(16,27,45,.96);
          border:1px solid var(--line);
          border-radius:22px;
          padding:26px;
          box-shadow:var(--shadow);
        }
        .field{
          width:100%;
          margin-bottom:12px;
          padding:13px 14px;
          border-radius:14px;
          border:1px solid var(--line);
          background:#0d1727;
          color:var(--text);
        }

        .hero{
          display:grid;
          grid-template-columns:1.3fr .7fr;
          gap:18px;
          margin-bottom:26px;
        }
        .hero-card{
          background:
            radial-gradient(circle at top left, rgba(110,168,255,.18), transparent 34%),
            radial-gradient(circle at top right, rgba(155,124,255,.14), transparent 28%),
            linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.01)),
            rgba(16,27,45,.96);
          border:1px solid var(--line);
          border-radius:28px;
          padding:26px;
          box-shadow:var(--shadow);
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
          font-size:36px;
          line-height:1.08;
        }
        .hero-desc{
          margin:0;
          color:#d2def7;
          line-height:1.65;
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
          border-radius:24px;
          border:1px solid var(--line);
          background:
            radial-gradient(circle at top left, rgba(110,168,255,.12), transparent 30%),
            linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.01)),
            rgba(16,27,45,.96);
          padding:22px;
          box-shadow:var(--shadow);
        }
        .course-top{
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
          margin:0 0 10px;
          font-size:24px;
          line-height:1.22;
        }
        .course-desc{
          margin:0 0 16px;
          color:var(--muted);
          line-height:1.6;
          min-height:48px;
        }
        .progress-wrap{
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
          display:grid;
          grid-template-columns:repeat(2, minmax(0, 1fr));
          gap:10px;
          margin-bottom:16px;
          color:var(--muted);
          font-size:13px;
        }
        .course-actions{
          display:flex;
          gap:10px;
          flex-wrap:wrap;
        }

        .module-stack{
          display:flex;
          flex-direction:column;
          gap:22px;
        }
        .module-card{
          background:
            radial-gradient(circle at top left, rgba(110,168,255,.10), transparent 28%),
            linear-gradient(180deg, rgba(255,255,255,.025), rgba(255,255,255,.01)),
            rgba(16,27,45,.96);
          border:1px solid var(--line);
          border-radius:28px;
          overflow:hidden;
          box-shadow:var(--shadow);
        }
        .module-head{
          display:flex;
          justify-content:space-between;
          align-items:flex-start;
          gap:18px;
          padding:24px 24px 18px;
          border-bottom:1px solid rgba(255,255,255,.06);
        }
        .module-badge{
          display:inline-flex;
          padding:7px 12px;
          border-radius:999px;
          background:rgba(110,168,255,.12);
          border:1px solid rgba(110,168,255,.20);
          color:#dbe8ff;
          font-size:12px;
          margin-bottom:12px;
        }
        .module-title{
          font-size:26px;
          font-weight:800;
          line-height:1.25;
          margin:0 0 8px;
        }
        .module-sub{
          color:var(--muted);
          font-size:14px;
          line-height:1.5;
        }
        .module-progress{
          min-width:190px;
        }
        .module-progress-bar{
          height:12px;
          border-radius:999px;
          background:rgba(255,255,255,.08);
          overflow:hidden;
          border:1px solid rgba(255,255,255,.06);
          margin-top:8px;
        }
        .module-progress-bar > span{
          display:block;
          height:100%;
          background:linear-gradient(90deg, #78a8ff, #9a7cff);
          border-radius:999px;
        }

        .lesson-list{
          display:flex;
          flex-direction:column;
          gap:16px;
          padding:20px 24px 24px;
        }
        .lesson-card{
          display:grid;
          grid-template-columns:220px 1fr auto;
          gap:18px;
          align-items:stretch;
          border:1px solid rgba(255,255,255,.08);
          border-radius:22px;
          background:rgba(255,255,255,.035);
          overflow:hidden;
          transition:transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease;
        }
        .lesson-card:hover{
          transform:translateY(-2px);
          box-shadow:0 16px 30px rgba(0,0,0,.14);
          border-color:rgba(110,168,255,.24);
          background:rgba(255,255,255,.045);
        }
       .lesson-thumb{
  min-height:160px;
  background:#1f2f4a;
  display:flex;
  align-items:center;
  justify-content:center;
  overflow:hidden;
  border-right:1px solid rgba(255,255,255,.08);
  border-radius:12px;
}
        .lesson-thumb img{
          width:100%;
          height:100%;
          object-fit:cover;
          display:block;
        }
        .lesson-thumb-fallback{
  color:white;
  font-size:14px;
  text-align:center;
  padding:18px;
  line-height:1.6;
}
        .lesson-body{
          padding:18px 0;
          display:flex;
          flex-direction:column;
          justify-content:center;
        }
        .lesson-id{
          font-size:12px;
          text-transform:uppercase;
          letter-spacing:.05em;
          color:#9fb0d0;
          margin-bottom:8px;
        }
        .lesson-title{
          font-size:19px;
          font-weight:800;
          line-height:1.36;
          margin-bottom:8px;
        }
        .lesson-type{
          color:var(--muted);
          font-size:14px;
          margin-bottom:12px;
        }
        .lesson-hint{
          color:#d7e4ff;
          font-size:13px;
          opacity:.92;
          line-height:1.5;
        }
        .lesson-action{
          padding:18px;
          display:flex;
          align-items:center;
          justify-content:center;
        }
        .start-pill{
          display:inline-flex;
          align-items:center;
          gap:8px;
          padding:11px 15px;
          border-radius:999px;
          background:rgba(110,168,255,.12);
          border:1px solid rgba(110,168,255,.22);
          color:#eef4ff;
          font-weight:700;
          text-decoration:none;
          white-space:nowrap;
        }

        @media (max-width: 980px){
          .hero{
            grid-template-columns:1fr;
          }
          .lesson-card{
            grid-template-columns:1fr;
          }
          .lesson-thumb{
            min-height:190px;
            border-right:none;
            border-bottom:1px solid rgba(255,255,255,.06);
          }
          .lesson-body{
            padding:0 16px 4px;
          }
          .lesson-action{
            justify-content:flex-start;
            padding:0 16px 16px;
          }
        }

        @media (max-width: 720px){
          .stats{
            grid-template-columns:1fr;
          }
          .course-meta{
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

    if (req.session.user.role === 'tester') {
      return res.redirect('/panel-testera');
    }

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

    if (user.role === 'tester') {
      return res.redirect('/panel-testera');
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
                  <a href="/kurs/${course.id}" class="btn">Kontynuuj kurs</a>
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

app.get('/kurs/:id', requireAuth, async (req, res) => {
  try {
    const courseId = Number(req.params.id);

    if (!Number.isInteger(courseId)) {
      return res.status(400).send('Nieprawidłowe ID kursu.');
    }

    const userId = req.session.user.id;

    const accessResult = await query(`
      SELECT c.*
      FROM courses c
      JOIN enrollments e ON e.course_id = c.id
      WHERE c.id = $1
        AND e.user_id = $2
        AND e.status = 'active'
      LIMIT 1
    `, [courseId, userId]);

    if (!accessResult.rows.length) {
      return res.status(403).send('Nie masz dostępu do tego kursu.');
    }

    const course = accessResult.rows[0];
    const sections = Array.isArray(course.sections_json) ? course.sections_json : [];
const outline = Array.isArray(course.outline_json) ? course.outline_json : [];

    const totalLessons = sections.reduce((sum, section) => {
      const lessons = Array.isArray(section?.media) ? section.media.length : 0;
      return sum + lessons;
    }, 0);

    const fakeCourseProgress = Math.min(92, Math.max(14, totalLessons * 3));

const sectionsHtml = sections.length
  ? `
    <div class="module-stack">
      ${sections.map((section, index) => {
        const lessons = Array.isArray(section?.media) ? section.media : [];
        const outlineItem = outline[index] || {};
        const sectionTitle =
          outlineItem?.title
          || section?.title
          || section?.name
          || section?.sectionTitle
          || `Moduł ${index + 1}`;

        const moduleProgress = Math.min(96, 24 + (index * 11));

        return `
          <div class="module-card">
  <div class="module-head">
    <div>
      <div class="module-badge">Moduł ${index + 1}</div>
      <div class="module-title">${escapeHtml(sectionTitle)}</div>
      <div class="module-sub">
        ${lessons.length} ${
          lessons.length === 1 ? 'lekcja' :
          lessons.length >= 2 && lessons.length <= 4 ? 'lekcje' :
          'lekcji'
        }
      </div>
    </div>

              <div class="module-progress">
                <div class="module-sub" style="text-align:right;">Postęp modułu: demo</div>
                <div class="module-progress-bar">
                  <span style="width:${moduleProgress}%"></span>
                </div>
              </div>
            </div>

           <div class="lesson-list">

  <div style="font-weight:800; font-size:18px; margin-bottom:10px;">
Lekcje
  </div>

  ${lessons.map((lesson, i) => {
    const thumbHtml = `
      <div class="lesson-thumb">
        <div class="lesson-thumb-fallback">
          <div>${escapeHtml(lesson.lessonTitle || 'Lekcja')}</div>
        </div>
      </div>
    `;

    return `
      <div class="lesson-card">
        ${thumbHtml}

        <div class="lesson-body">
          <div class="lesson-id">${escapeHtml(lesson.lessonId || `L-${i + 1}`)}</div>
          <div class="lesson-title">${escapeHtml(lesson.lessonTitle || 'Brak tytułu')}</div>
          <div class="lesson-type">Typ: ${escapeHtml(lesson.mediaType || 'lesson')}</div>
          <div class="lesson-hint">Wejdź do lekcji</div>
        </div>

      <div class="lesson-action">
  <a href="#" class="start-pill">Otwórz</a>

  <div style="margin-top:8px;">
    <a href="#" class="start-pill" style="background:transparent; border:1px solid rgba(255,255,255,.2);">
      Karta pracy
    </a>
  </div>
</div>
      </div>
    `;
  }).join('')}

  <div style="font-weight:800; font-size:18px; margin:20px 0 10px;">
    Sprawdzenie
  </div>

  <div class="lesson-card">
    <div class="lesson-thumb">
      <div class="lesson-thumb-fallback">
        <div>Quiz działowy</div>
      </div>
    </div>

    <div class="lesson-body">
      <div class="lesson-title">Quiz działowy</div>
      <div class="lesson-hint">Sprawdź wiedzę po lekcjach</div>
    </div>

    <div class="lesson-action">
      <a href="#" class="start-pill">Rozpocznij</a>
    </div>
  </div>

  <div class="lesson-card">
    <div class="lesson-thumb">
      <div class="lesson-thumb-fallback">
        <div>Test działowy</div>
      </div>
    </div>

    <div class="lesson-body">
      <div class="lesson-title">Test działowy</div>
      <div class="lesson-hint">Zaliczenie modułu</div>
    </div>

    <div class="lesson-action">
      <a href="#" class="start-pill">Rozpocznij</a>
    </div>
  </div>

</div>
          </div>
        `;
      }).join('')}
    </div>
  `
  : `<div class="empty">Ten kurs nie ma jeszcze widocznych sekcji.</div>`;

    const html = renderHtmlPage(course.title || 'Widok kursu', `
      <div class="wrap">
        <div class="hero">
          <div class="hero-card">
            <span class="hero-kicker">Widok kursu</span>
            <h1 class="hero-title">${escapeHtml(course.title || 'Kurs')}</h1>
            <p class="hero-desc">
              Tu zaczyna się nauka. Wybierz moduł i przejdź do lekcji w swoim tempie.ucha lista danych.
            </p>

            <div class="stats">
              <div class="stat">
                <div class="stat-value">${sections.length}</div>
                <div class="stat-label">Sekcje</div>
              </div>
              <div class="stat">
                <div class="stat-value">${totalLessons}</div>
                <div class="stat-label">Lekcje</div>
              </div>
              <div class="stat">
                <div class="stat-value">${fakeCourseProgress}%</div>
                <div class="stat-label">Postęp kursu</div>
              </div>
            </div>

            <div class="progress-wrap" style="margin-top:18px;">
              <div class="progress-label">
                <span>Twój postęp</span>
                <strong>${fakeCourseProgress}%</strong>
              </div>
              <div class="progress-bar">
                <span style="width:${fakeCourseProgress}%"></span>
              </div>
            </div>
          </div>

          <div class="hero-card">
            <span class="hero-kicker">Szybkie akcje</span>
            <h2 style="margin:0 0 10px;">Nawigacja kursu</h2>
            <p class="hero-desc" style="margin-bottom:18px;">
Wróć do swoich kursów albo przejdź dalej do wybranego materiału.
            </p>
            <div class="toolbar" style="margin-bottom:0;">
              <a href="/moje-kursy" class="btn">Wróć do moich kursów</a>
              <a href="/logout" class="btn secondary">Wyloguj</a>
            </div>
          </div>
        </div>

        ${sectionsHtml}
      </div>
    `);

    return res.send(html);
  } catch (error) {
    console.error('course view error:', error);
    return res.status(500).send('Błąd widoku kursu.');
  }
});

app.get('/panel-testera', requireAuth, async (req, res) => {
  try {
    if (req.session.user.role !== 'tester') {
      return res.redirect('/');
    }

    const coursesResult = await query(`
      SELECT id, title, course_code, status, updated_at
      FROM courses
      WHERE status = 'review'
      ORDER BY updated_at DESC
    `);

    const feedbackResult = await query(`
      SELECT course_id, comment, created_at
      FROM course_feedback
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [req.session.user.id]);

    const feedbackByCourseId = new Map();
    for (const row of feedbackResult.rows) {
      const key = String(row.course_id);
      if (!feedbackByCourseId.has(key)) {
        feedbackByCourseId.set(key, []);
      }
      feedbackByCourseId.get(key).push(row);
    }

    const cards = coursesResult.rows.length
      ? `
        <div class="grid">
          ${coursesResult.rows.map(course => {
            const items = feedbackByCourseId.get(String(course.id)) || [];

            const myFeedbackHtml = items.length
              ? `
                <div class="feedback-box" style="margin-top:12px;">
                  <div class="feedback-title">Twoje zapisane uwagi:</div>
                  ${items.map(item => `
                    <div class="feedback-item">
                      • ${escapeHtml(item.comment)}<br/>
                      <small>${new Date(item.created_at).toLocaleString('pl-PL')}</small>
                    </div>
                  `).join('')}
                </div>
              `
              : `
                <div class="feedback-box" style="margin-top:12px;">
                  <div class="feedback-title">Twoje zapisane uwagi:</div>
                  <div class="feedback-item">Brak zapisanych uwag do tego kursu.</div>
                </div>
              `;

            return `
              <div class="card">
                <div class="topbar">
                  <span class="label">ID: ${course.id}</span>
                  <span class="status ${course.status}">${course.status}</span>
                </div>

                <div class="title">${escapeHtml(course.title)}</div>

                <div class="meta">
                  <div><strong>Code:</strong> ${escapeHtml(course.course_code || 'brak')}</div>
                  <div><strong>Ostatnia zmiana:</strong> ${new Date(course.updated_at).toLocaleString('pl-PL')}</div>
                </div>

                <div style="margin-top:16px;">
                  <div style="margin-bottom:10px; font-size:13px; color:#9fb0d0;">
                    Po dodaniu uwagi zobaczysz ją poniżej.
                  </div>

                  <form method="POST" action="/api/feedback">
                    <input type="hidden" name="course_id" value="${course.id}" />
                    <textarea name="comment" placeholder="Dodaj uwagę..." style="width:100%; padding:10px; border-radius:8px; margin-bottom:8px;"></textarea>
                    <button class="btn secondary" type="submit">Dodaj uwagę</button>
                  </form>

                  ${myFeedbackHtml}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `
      : `<div class="empty">Brak kursów do sprawdzenia.</div>`;

    const html = renderHtmlPage('Panel testera', `
      <div class="wrap">
        <h1>Panel testera</h1>
        <p class="sub">Kursy do sprawdzenia i zgłoszenia uwag.</p>

        <div class="notice">
          Po dodaniu uwagi formularz zapisuje komentarz i odświeża panel testera.
        </div>

        <div class="toolbar">
          <button class="btn" onclick="window.location.reload()">Odśwież</button>
          <a href="/logout" class="btn secondary">Wyloguj</a>
        </div>

        ${cards}
      </div>
    `);

    return res.send(html);
  } catch (error) {
    console.error('tester panel error:', error);
    return res.status(500).send('Błąd panelu testera');
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