import { db } from '../db/client.js';
import type { GraphEdge, GraphNode, EdgeType } from '../types.js';

interface NodeRow {
  id: string;
  parent_id: string | null;
  title: string;
  level: number;
  summary: string | null;
  content: string | null;
  source_ref: string | null;
  sort_order: number;
}

interface EdgeRow {
  id: string;
  from_id: string;
  to_id: string;
  type: EdgeType;
}

export function listNodes(courseId: string): GraphNode[] {
  const rows = db
    .prepare(
      `WITH RECURSIVE tree AS (
         SELECT id, parent_id, title, level, summary, content, source_ref, sort_order,
                printf('%08d', sort_order) AS path
           FROM nodes
          WHERE course_id = @courseId AND parent_id IS NULL
         UNION ALL
         SELECT n.id, n.parent_id, n.title, n.level, n.summary, n.content, n.source_ref, n.sort_order,
                tree.path || '/' || printf('%08d', n.sort_order) AS path
           FROM nodes n JOIN tree ON n.parent_id = tree.id
          WHERE n.course_id = @courseId
       )
       SELECT id, parent_id, title, level, summary, content, source_ref, sort_order
         FROM tree
        ORDER BY path`,
    )
    .all({ courseId }) as NodeRow[];

  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    title: r.title,
    level: r.level,
    summary: r.summary,
    content: r.content,
    sourceRef: r.source_ref,
    sortOrder: r.sort_order,
  }));
}

export function listEdges(courseId: string): GraphEdge[] {
  const rows = db
    .prepare(`SELECT id, from_id, to_id, type FROM edges WHERE course_id = ?`)
    .all(courseId) as EdgeRow[];
  return rows.map((r) => ({ id: r.id, from: r.from_id, to: r.to_id, type: r.type }));
}

/** All prerequisites (transitive) of a node via recursive CTE. */
export function prerequisitesOf(courseId: string, nodeId: string): string[] {
  const rows = db
    .prepare(
      `WITH RECURSIVE pre(id) AS (
         SELECT from_id FROM edges
          WHERE course_id = @courseId AND to_id = @nodeId AND type = 'prerequisite'
         UNION
         SELECT e.from_id FROM edges e JOIN pre ON e.to_id = pre.id
          WHERE e.course_id = @courseId AND e.type = 'prerequisite'
       )
       SELECT id FROM pre`,
    )
    .all({ courseId, nodeId }) as { id: string }[];
  return rows.map((r) => r.id);
}
