CREATE TABLE IF NOT EXISTS courses (
  id BIGSERIAL PRIMARY KEY,
  course_id TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  course_code TEXT DEFAULT '',
  language TEXT NOT NULL DEFAULT 'pl',
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  source_project_json JSONB NOT NULL,
  outline_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  sections_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_exam_json JSONB,
  final_practical_exam_json JSONB,
  certificate_json JSONB,
  export_package_json JSONB,
  files_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_courses_status ON courses(status);
CREATE INDEX IF NOT EXISTS idx_courses_course_id ON courses(course_id);
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);