import { db, newId } from '../db/client.js';
import { wouldCreateCycle } from '../core/dag.js';
import { listEdges, listNodes } from '../core/graph-query.js';
import type { EdgeType, OutlineNode } from '../types.js';

export interface BuildResult {
  nodeCount: number;
  edgeCount: number;
  rejected: { from: string; to: string; reason: string }[];
}

/**
 * Flatten the confirmed outline into nodes, preserving parent/child hierarchy,
 * then build `contains` edges from the hierarchy. Prerequisite edges can be
 * supplied separately (e.g. inferred by an LLM) and are validated against
 * cycles before insertion.
 */
export function buildGraphFromOutline(
  courseId: string,
  root: OutlineNode,
  inferredPrereqs: { fromTitle: string; toTitle: string }[] = [],
): BuildResult {
  const insertNode = db.prepare(
    `INSERT INTO nodes (id, course_id, parent_id, title, level, summary, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertEdge = db.prepare(
    `INSERT OR IGNORE INTO edges (id, course_id, from_id, to_id, type) VALUES (?, ?, ?, ?, ?)`,
  );

  const titleToId = new Map<string, string>();
  let nodeCount = 0;
  let edgeCount = 0;

  const insertTree = (node: OutlineNode, parentId: string | null, order: number) => {
    // The synthetic root (level 0) is not persisted; its children become roots.
    if (node.level > 0) {
      const id = newId('node');
      insertNode.run(id, courseId, parentId, node.title, node.level, node.summary ?? null, order);
      nodeCount++;
      if (!titleToId.has(node.title)) titleToId.set(node.title, id);
      parentId = id;
      if (node.level >= 1 && node.children.length > 0) {
        // parent -> child `contains` edges are created below per child
      }
    }

    node.children.forEach((child, i) => {
      const before = nodeCount;
      insertTree(child, parentId, i);
      if (parentId && nodeCount > before) {
        // find the inserted child id by title match is unreliable; record during insertion instead
      }
    });
  };

  // Simpler two-pass: first insert all nodes recording parent->child pairs, then edges.
  const pairs: { from: string; to: string }[] = [];
  const walk = (node: OutlineNode, parentId: string | null, order: number): string | null => {
    let selfId: string | null = null;
    if (node.level > 0) {
      selfId = newId('node');
      insertNode.run(selfId, courseId, parentId, node.title, node.level, node.summary ?? null, order);
      nodeCount++;
      if (!titleToId.has(node.title)) titleToId.set(node.title, selfId);
      if (parentId) pairs.push({ from: parentId, to: selfId });
    }
    node.children.forEach((child, i) => walk(child, selfId ?? parentId, i));
    return selfId;
  };

  void insertTree;
  walk(root, null, 0);

  const tx = db.transaction(() => {
    for (const p of pairs) {
      insertEdge.run(newId('edge'), courseId, p.from, p.to, 'contains');
      edgeCount++;
    }
  });
  tx();

  // Prerequisite inference (title-based), validated for cycles.
  const rejected: BuildResult['rejected'] = [];
  for (const pr of inferredPrereqs) {
    const from = titleToId.get(pr.fromTitle);
    const to = titleToId.get(pr.toTitle);
    if (!from || !to) {
      rejected.push({ from: pr.fromTitle, to: pr.toTitle, reason: 'title not found' });
      continue;
    }
    const current = listEdges(courseId);
    if (wouldCreateCycle(from, to, current)) {
      rejected.push({ from: pr.fromTitle, to: pr.toTitle, reason: 'would create cycle' });
      continue;
    }
    insertEdge.run(newId('edge'), courseId, from, to, 'prerequisite');
    edgeCount++;
  }

  return { nodeCount, edgeCount, rejected };
}

export function addPrerequisite(courseId: string, fromId: string, toId: string): { ok: boolean; reason?: string } {
  const edges = listEdges(courseId);
  if (wouldCreateCycle(fromId, toId, edges)) return { ok: false, reason: 'would create cycle' };
  db.prepare(
    `INSERT OR IGNORE INTO edges (id, course_id, from_id, to_id, type) VALUES (?, ?, ?, ?, 'prerequisite')`,
  ).run(newId('edge'), courseId, fromId, toId);
  return { ok: true };
}

export function getGraph(courseId: string) {
  return { nodes: listNodes(courseId), edges: listEdges(courseId) };
}

export function addEdge(courseId: string, fromId: string, toId: string, type: EdgeType) {
  if (type === 'prerequisite') return addPrerequisite(courseId, fromId, toId);
  db.prepare(
    `INSERT OR IGNORE INTO edges (id, course_id, from_id, to_id, type) VALUES (?, ?, ?, ?, ?)`,
  ).run(newId('edge'), courseId, fromId, toId, type);
  return { ok: true };
}
