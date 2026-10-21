import type { GraphEdge } from '../types.js';

/**
 * Kahn's algorithm. Returns a topological order of node ids.
 * If a cycle exists, returns the remaining node ids that could not be sorted.
 */
export function topologicalSort(
  nodeIds: string[],
  edges: Pick<GraphEdge, 'from' | 'to' | 'type'>[],
): { order: string[]; cycle: string[] } {
  const prereq = edges.filter((e) => e.type === 'prerequisite');
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const e of prereq) {
    if (!inDegree.has(e.from) || !inDegree.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  // Preserve the input order (which encodes framework/outline order) among
  // nodes that are simultaneously ready, instead of plain FIFO.
  const rank = new Map(nodeIds.map((id, i) => [id, i]));
  const ready: string[] = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
  const order: string[] = [];

  const pickNext = (): string | undefined => {
    if (ready.length === 0) return undefined;
    let best = 0;
    for (let i = 1; i < ready.length; i++) {
      if ((rank.get(ready[i]) ?? 0) < (rank.get(ready[best]) ?? 0)) best = i;
    }
    return ready.splice(best, 1)[0];
  };

  let cur: string | undefined;
  while ((cur = pickNext()) !== undefined) {
    order.push(cur);
    for (const next of adj.get(cur) ?? []) {
      const d = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, d);
      if (d === 0) ready.push(next);
    }
  }

  if (order.length !== nodeIds.length) {
    const cycle = nodeIds.filter((id) => !order.includes(id));
    return { order, cycle };
  }

  return { order, cycle: [] };
}

/**
 * Check whether adding `from -> to` as a prerequisite edge would create a cycle.
 * A cycle exists if `to` can already reach `from`.
 */
export function wouldCreateCycle(
  from: string,
  to: string,
  edges: Pick<GraphEdge, 'from' | 'to' | 'type'>[],
): boolean {
  if (from === to) return true;

  const prereq = edges.filter((e) => e.type === 'prerequisite');
  const adj = new Map<string, string[]>();
  for (const e of prereq) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }

  // DFS from `to`; if we reach `from`, adding from->to closes a cycle.
  const visited = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === from) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const next of adj.get(cur) ?? []) stack.push(next);
  }

  return false;
}
