import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (server/src/db -> ../../..) */
export const ROOT_DIR = resolve(__dirname, '..', '..', '..');

/**
 * Where the SQLite file, uploads and other mutable state live.
 *
 * In development this stays inside the repo so tooling and tests are simple.
 * When packaged, the app is installed under Program Files (read-only), so the
 * Electron main process passes a per-user writable directory instead.
 */
export const DATA_DIR = process.env.AI_TEACHER_DATA_DIR
  ? resolve(process.env.AI_TEACHER_DATA_DIR)
  : join(ROOT_DIR, 'data');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
export const DB_PATH = join(DATA_DIR, 'ai_teacher.db');

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new Database(DB_PATH);
// better-sqlite3 defaults foreign_keys to OFF per connection; enable it so
// `ON DELETE CASCADE` actually cascades (schema.sql alone is not enough).
db.pragma('foreign_keys = ON');

export function initSchema(): void {
  // `schema.sql` sits next to this module in dev; after `tsc` it is still
  // beside the emitted .js because we copy it during build.
  const schemaPath = join(__dirname, 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf8');
  db.exec(sql);
  ensureColumns();
}

/**
 * `CREATE TABLE IF NOT EXISTS` does not add columns to an existing table, so
 * additive migrations are handled here. Each entry is idempotent.
 */
function ensureColumns(): void {
  addColumnIfMissing('courses', 'audience', "TEXT NOT NULL DEFAULT 'adult'");
  addColumnIfMissing('courses', 'grade', 'INTEGER');
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
