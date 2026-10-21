import { db, newId } from '../db/client.js';
import type { OutlineNode } from '../types.js';

export interface OutlineRow {
  id: string;
  course_id: string;
  version: number;
  raw_json: string;
  confirmed_at: string | null;
}

export type Audience = 'child' | 'teen' | 'adult';

export interface CourseProfile {
  /** Who is learning: drives wording, pace and question style. */
  audience?: Audience;
  /** School grade 1-12, only meaningful for children/teens. */
  grade?: number | null;
}

export function createCourse(
  title: string,
  sourceType: 'txt' | 'topic' | 'text',
  sourceRef: string | null,
  profile: CourseProfile = {},
): string {
  const id = newId('course');
  db.prepare(
    `INSERT INTO courses (id, title, source_type, source_ref, audience, grade)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    title,
    sourceType,
    sourceRef,
    profile.audience ?? 'adult',
    profile.grade ?? null,
  );
  return id;
}

export function saveOutline(courseId: string, outline: OutlineNode): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM outlines WHERE course_id = ?`)
    .get(courseId) as { v: number };
  const version = row.v + 1;
  db.prepare(
    `INSERT INTO outlines (id, course_id, version, raw_json) VALUES (?, ?, ?, ?)`,
  ).run(newId('outline'), courseId, version, JSON.stringify(outline));
  return version;
}

export function getLatestOutline(courseId: string): { outline: OutlineNode; version: number } | null {
  const row = db
    .prepare(
      `SELECT raw_json, version FROM outlines WHERE course_id = ? ORDER BY version DESC LIMIT 1`,
    )
    .get(courseId) as { raw_json: string; version: number } | undefined;
  if (!row) return null;
  return { outline: JSON.parse(row.raw_json) as OutlineNode, version: row.version };
}

interface CourseRow {
  id: string;
  title: string;
  source_type: string;
  source_ref: string | null;
  status: string;
  audience: Audience;
  grade: number | null;
  created_at: string;
}

function rowToCourse(row: CourseRow) {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    status: row.status,
    audience: row.audience,
    grade: row.grade,
    createdAt: row.created_at,
  };
}

export function getCourse(courseId: string) {
  const row = db
    .prepare(
      `SELECT id, title, source_type, source_ref, status, audience, grade, created_at
         FROM courses WHERE id = ?`,
    )
    .get(courseId) as CourseRow | undefined;
  return row ? rowToCourse(row) : null;
}

/**
 * Delete a course and everything hanging off it.
 *
 * Child tables declare `ON DELETE CASCADE`, but we delete explicitly so the
 * behaviour does not depend on the connection's `foreign_keys` pragma and so
 * a future schema change cannot silently leave orphan rows behind.
 */
export function deleteCourse(courseId: string): boolean {
  const exists = db.prepare(`SELECT 1 FROM courses WHERE id = ?`).get(courseId);
  if (!exists) return false;

  const tx = db.transaction((id: string) => {
    // Order matters only for readability; nothing here is RESTRICT.
    db.prepare(
      `DELETE FROM tutor_sessions WHERE path_id IN (SELECT id FROM paths WHERE course_id = ?)`,
    ).run(id);
    db.prepare(
      `DELETE FROM progress WHERE path_id IN (SELECT id FROM paths WHERE course_id = ?)`,
    ).run(id);
    db.prepare(`DELETE FROM paths WHERE course_id = ?`).run(id);
    db.prepare(`DELETE FROM edges WHERE course_id = ?`).run(id);
    db.prepare(`DELETE FROM nodes WHERE course_id = ?`).run(id);
    db.prepare(`DELETE FROM outlines WHERE course_id = ?`).run(id);
    db.prepare(`DELETE FROM courses WHERE id = ?`).run(id);
  });
  tx(courseId);
  return true;
}

/** Newest first; used by the "my courses" list so work is never lost. */
export function listCourses() {
  const rows = db
    .prepare(
      `SELECT id, title, source_type, source_ref, status, audience, grade, created_at
         FROM courses ORDER BY created_at DESC, id DESC`,
    )
    .all() as CourseRow[];
  return rows.map(rowToCourse);
}
