import { getLlm } from '../providers/llm.js';
import type { OutlineNode } from '../types.js';

export interface PrereqPair {
  fromTitle: string;
  toTitle: string;
}

export interface PrereqInferenceResult {
  pairs: PrereqPair[];
  usedLlm: boolean;
  reason?: string;
}

const PREREQ_SYSTEM_PROMPT = `You infer prerequisite relationships between knowledge points in a curriculum.

Rules:
- Output STRICT JSON only, no prose, no markdown fences.
- Shape: {"prerequisites": [{"from": string, "to": string}]}
- "from" must be learned BEFORE "to". Direction is strict.
- Only reference titles that appear verbatim in the provided list.
- Only emit relationships that are genuinely necessary, not merely related.
- Prefer 5 to 15 high-signal pairs. Return an empty array if uncertain.
- Never create cycles.`;

function collectTitles(root: OutlineNode): { title: string; level: number; summary?: string }[] {
  const out: { title: string; level: number; summary?: string }[] = [];
  const walk = (node: OutlineNode) => {
    if (node.level > 0) out.push({ title: node.title, level: node.level, summary: node.summary });
    node.children.forEach(walk);
  };
  walk(root);
  return out;
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

interface RawPrereqResponse {
  prerequisites?: unknown;
}

function parsePairs(text: string, allowed: Set<string>): PrereqPair[] {
  const cleaned = stripFences(text);
  let parsed: RawPrereqResponse;
  try {
    parsed = JSON.parse(cleaned) as RawPrereqResponse;
  } catch {
    throw new Error('graph-build: model did not return valid JSON');
  }

  const raw = Array.isArray(parsed.prerequisites) ? parsed.prerequisites : [];
  const pairs: PrereqPair[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const from = typeof obj.from === 'string' ? obj.from.trim() : '';
    const to = typeof obj.to === 'string' ? obj.to.trim() : '';
    if (!from || !to || from === to) continue;
    if (!allowed.has(from) || !allowed.has(to)) continue;
    pairs.push({ fromTitle: from, toTitle: to });
  }
  return pairs;
}

export async function inferPrerequisites(root: OutlineNode): Promise<PrereqInferenceResult> {
  const llm = getLlm();
  if (llm.name === 'mock') {
    return {
      pairs: [],
      usedLlm: false,
      reason: 'no LLM configured; skipped prerequisite inference',
    };
  }

  const items = collectTitles(root);
  if (items.length < 2) {
    return { pairs: [], usedLlm: false, reason: 'not enough nodes to infer prerequisites' };
  }

  const catalog = items
    .map((n) => `- ${n.title}${n.summary ? ` — ${n.summary}` : ''}`)
    .join('\n');

  const messages = [
    { role: 'system' as const, content: PREREQ_SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: `Knowledge points:\n${catalog}\n\nReturn the JSON prerequisites now.`,
    },
  ];

  const raw = await llm.complete(messages, { json: true, temperature: 0.1 });
  const allowed = new Set(items.map((n) => n.title));
  return { pairs: parsePairs(raw, allowed), usedLlm: true };
}
