import { db, newId } from '../db/client.js';
import { topologicalSort } from '../core/dag.js';
import { listEdges, listNodes } from '../core/graph-query.js';
import { getCourse, type Audience } from './outline.js';
import type { PathStep } from '../types.js';

/**
 * Younger learners need observable, concrete acceptance criteria: "can count
 * to 20 without skipping" beats "can independently explain and give examples".
 */
function acceptanceFor(title: string, prereqTitles: string[], audience: Audience): string {
  const prereq = prereqTitles.join('、');
  if (audience === 'child') {
    return prereq
      ? `能说出「${title}」怎么做，并用到 ${prereq} 的方法`
      : `能自己做一遍「${title}」，做对了就算过`;
  }
  if (audience === 'teen') {
    return prereq
      ? `能讲清「${title}」，并说明它和 ${prereq} 的联系`
      : `能用自己的话讲清「${title}」，并举一个例子`;
  }
  return prereq
    ? `能解释「${title}」并说明它与 ${prereq} 的关系`
    : `能独立解释并举例说明「${title}」`;
}

export interface PlanOptions {
  /** Prefer leaf nodes (no children) as path steps. Defaults to true. */
  leafOnly?: boolean;
  /** Skip nodes whose progress is already 'passed'. */
  skipPassedForPathId?: string;
}

/**
 * Build a learning path constrained to a course (framework).
 * Uses only nodes belonging to `courseId`; prerequisite edges are
 * topologically sorted so no step appears before its prerequisites.
 */
export function planPath(courseId: string, options: PlanOptions = {}) {
  const leafOnly = options.leafOnly ?? true;
  const nodes = listNodes(courseId);
  const edges = listEdges(courseId);

  if (nodes.length === 0) {
    return { pathId: null, steps: [] as PathStep[], error: 'graph is empty' };
  }

  const hasChildren = new Set(nodes.filter((n) => n.parentId).map((n) => n.parentId!));
  let candidates = leafOnly ? nodes.filter((n) => !hasChildren.has(n.id)) : nodes;

  // Honor prior progress: skip passed nodes if a pathId is supplied.
  if (options.skipPassedForPathId) {
    const passed = new Set(
      (
        db
          .prepare(`SELECT node_id FROM progress WHERE path_id = ? AND status = 'passed'`)
          .all(options.skipPassedForPathId) as { node_id: string }[]
      ).map((r) => r.node_id),
    );
    candidates = candidates.filter((n) => !passed.has(n.id));
  }

  const nodeIds = candidates.map((n) => n.id);
  const { order, cycle } = topologicalSort(nodeIds, edges);

  if (cycle.length > 0) {
    return {
      pathId: null,
      steps: [] as PathStep[],
      error: `prerequisite cycle detected among ${cycle.length} nodes`,
      cycle,
    };
  }

  const audience = (getCourse(courseId)?.audience ?? 'adult') as Audience;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const steps: PathStep[] = order.map((id) => {
    const n = byId.get(id)!;
    const prereqTitles = edges
      .filter((e) => e.type === 'prerequisite' && e.to === id)
      .map((e) => byId.get(e.from)?.title)
      .filter(Boolean) as string[];

    return {
      nodeId: id,
      title: n.title,
      objective: n.summary ?? `掌握「${n.title}」的核心概念并能独立应用`,
      estimatedMinutes: audience === 'child' ? 10 : 30,
      acceptance: acceptanceFor(n.title, prereqTitles, audience),
    };
  });

  const pathId = newId('path');
  db.prepare(`INSERT INTO paths (id, course_id, steps_json) VALUES (?, ?, ?)`).run(
    pathId,
    courseId,
    JSON.stringify(steps),
  );

  const insertProgress = db.prepare(
    `INSERT OR IGNORE INTO progress (id, path_id, node_id, status) VALUES (?, ?, ?, 'pending')`,
  );
  const tx = db.transaction(() => {
    for (const s of steps) insertProgress.run(newId('prog'), pathId, s.nodeId);
  });
  tx();

  return { pathId, steps, error: null };
}

export function getPath(pathId: string) {
  const row = db
    .prepare(`SELECT id, course_id, steps_json, created_at FROM paths WHERE id = ?`)
    .get(pathId) as
    | { id: string; course_id: string; steps_json: string; created_at: string }
    | undefined;
  if (!row) return null;

  const progressRows = db
    .prepare(`SELECT node_id, status, score, updated_at FROM progress WHERE path_id = ?`)
    .all(pathId) as { node_id: string; status: string; score: number | null; updated_at: string }[];

  return {
    id: row.id,
    courseId: row.course_id,
    steps: JSON.parse(row.steps_json) as PathStep[],
    progress: progressRows.map((p) => ({
      nodeId: p.node_id,
      status: p.status,
      score: p.score,
      updatedAt: p.updated_at,
    })),
    createdAt: row.created_at,
  };
}

export function updateProgress(
  pathId: string,
  nodeId: string,
  status: 'pending' | 'learning' | 'passed' | 'failed',
  score?: number,
) {
  const existing = db
    .prepare(`SELECT id FROM progress WHERE path_id = ? AND node_id = ?`)
    .get(pathId, nodeId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE progress SET status = ?, score = COALESCE(?, score), updated_at = datetime('now') WHERE id = ?`,
    ).run(status, score ?? null, existing.id);
  } else {
    db.prepare(
      `INSERT INTO progress (id, path_id, node_id, status, score) VALUES (?, ?, ?, ?, ?)`,
    ).run(newId('prog'), pathId, nodeId, status, score ?? null);
  }
  return { ok: true };
}
