PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS courses (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('txt', 'topic', 'text')),
  source_ref  TEXT,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
  -- Learner profile: drives vocabulary, pace and question style.
  audience    TEXT NOT NULL DEFAULT 'adult' CHECK (audience IN ('child', 'teen', 'adult')),
  grade       INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outlines (
  id           TEXT PRIMARY KEY,
  course_id    TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  raw_json     TEXT NOT NULL,
  confirmed_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (course_id, version)
);

CREATE TABLE IF NOT EXISTS nodes (
  id         TEXT PRIMARY KEY,
  course_id  TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  level      INTEGER NOT NULL DEFAULT 1,
  summary    TEXT,
  content    TEXT,
  source_ref TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nodes_course ON nodes(course_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);

CREATE TABLE IF NOT EXISTS edges (
  id        TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  from_id   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  to_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  type      TEXT NOT NULL CHECK (type IN ('contains', 'prerequisite', 'related')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (course_id, from_id, to_id, type)
);
CREATE INDEX IF NOT EXISTS idx_edges_course ON edges(course_id);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);

CREATE TABLE IF NOT EXISTS paths (
  id         TEXT PRIMARY KEY,
  course_id  TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  steps_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_paths_course ON paths(course_id);

CREATE TABLE IF NOT EXISTS progress (
  id         TEXT PRIMARY KEY,
  path_id    TEXT NOT NULL REFERENCES paths(id) ON DELETE CASCADE,
  node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'learning', 'passed', 'failed')),
  score      REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (path_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_progress_path ON progress(path_id);

CREATE TABLE IF NOT EXISTS tutor_sessions (
  id           TEXT PRIMARY KEY,
  path_id      TEXT NOT NULL REFERENCES paths(id) ON DELETE CASCADE,
  node_id      TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  phase        TEXT NOT NULL DEFAULT 'explain' CHECK (phase IN ('explain', 'quiz', 'review', 'done')),
  history_json TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'passed', 'failed', 'abandoned')),
  score        REAL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tutor_sessions_path ON tutor_sessions(path_id);
CREATE INDEX IF NOT EXISTS idx_tutor_sessions_node ON tutor_sessions(node_id);

CREATE INDEX IF NOT EXISTS idx_courses_created ON courses(created_at DESC);

