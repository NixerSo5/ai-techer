import { newId } from '../db/client.js';
import { getLlm } from '../providers/llm.js';
import { getSearch, type SearchHit } from '../providers/search.js';
import type { Audience, CourseProfile } from '../services/outline.js';
import type { OutlineNode } from '../types.js';

export interface OutlineGenResult {
  title: string;
  outline: OutlineNode;
  sources: SearchHit[];
  usedLlm: boolean;
}

const TOPIC_SYSTEM_PROMPT = `You design learning curricula. Given a topic and reference search results, produce a hierarchical outline of knowledge points.

Rules:
- Output STRICT JSON only, no prose, no markdown fences.
- Shape: {"title": string, "children": [{"title": string, "summary": string, "children": [...]}]}
- 2 to 4 top-level chapters; each chapter 2 to 6 sub-points.
- Sub-points must be concrete, learnable units (not vague headings).
- Order chapters from foundational to advanced.
- summary: one sentence, <= 60 chars.
- Use the same language as the topic.`;

/**
 * Audience-specific outline instructions.
 *
 * Each band is written independently on purpose: reusing "child" wording for
 * teens made every course come out at primary-school level, because the model
 * keys off the examples (toys, snacks) far more than the "Learner:" label.
 */
const AUDIENCE_GUIDANCE: Record<Audience, (grade: number | null) => string[]> = {
  child: (grade) => {
    const lines = [
      '- 知识点名称必须用孩子能听懂的大白话，不要用教材黑话或英文术语。',
      '- 每个知识点只教一个极小的点，宁可多拆几层，也不要一次塞太多。',
      '- 尽量贴近生活：用玩具、零食、游戏、学校里的事做例子。',
      '- 低年级不要出现公式推导、抽象定义；先具体、后概括。',
    ];
    if (grade !== null && grade <= 2) {
      lines.push('- 单章不要超过 5 个子点，总知识点控制在 12 个以内。');
    }
    return lines;
  },
  teen: (grade) => {
    const lines = [
      '- 使用规范的学科术语，但每个术语第一次出现时用一句话说明白。',
      '- 知识点按教材章节的粒度划分，一章覆盖一个完整的概念群。',
      '- 例子优先取考试题、实验、生活现象，不要用幼儿向的比喻。',
      '- 可以出现公式和推导，但要标明它解决什么问题。',
    ];
    if (grade !== null) {
      lines.push(
        grade >= 10
          ? '- 面向高中阶段：允许抽象建模和多步推理，难度对齐高考或会考水平。'
          : '- 面向初中阶段：以具体情境为主，抽象程度逐步提高。',
      );
    }
    return lines;
  },
  adult: () => [
    '- 使用学科内的标准术语，无需回避抽象概念。',
    '- 知识点按主题模块划分，一个模块覆盖一个可独立应用的能力。',
    '- 例子优先取工作场景、真实案例或经典问题，不要用幼儿向的比喻。',
    '- 允许直接给出定义、公式、推导和边界条件。',
  ],
};

const AUDIENCE_LABEL: Record<Audience, string> = {
  child: '小学生',
  teen: '中学生',
  adult: '成人自学者',
};

function profileGuidance(profile: CourseProfile | undefined): string {
  const audience: Audience = profile?.audience ?? 'adult';
  const grade = profile?.grade ?? null;

  const gradeLabel = grade !== null ? `，${grade} 年级` : '';
  const lines = [
    '',
    `Learner: ${AUDIENCE_LABEL[audience]}${gradeLabel}.`,
    ...AUDIENCE_GUIDANCE[audience](grade),
  ];
  return lines.join('\n');
}

function profileHint(profile: CourseProfile | undefined): string {
  const audience = profile?.audience ?? 'adult';
  const grade = profile?.grade ? `，${profile.grade} 年级` : '';
  return `Learner: ${AUDIENCE_LABEL[audience]}${grade}`;
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

interface RawOutline {
  title?: unknown;
  children?: unknown;
}

function toOutlineNode(raw: unknown, level: number, counter: { n: number }): OutlineNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  if (!title) return null;

  counter.n += 1;
  const id = `out_${newId('t')}_${counter.n}`;
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : undefined;
  const childrenRaw = Array.isArray(obj.children) ? obj.children : [];

  const children = childrenRaw
    .map((c) => toOutlineNode(c, level + 1, counter))
    .filter((c): c is OutlineNode => c !== null);

  return { id, title, level, summary, children };
}

function parseOutline(text: string, topic: string): OutlineNode {
  const cleaned = stripFences(text);
  let parsed: RawOutline;
  try {
    parsed = JSON.parse(cleaned) as RawOutline;
  } catch {
    throw new Error('outline-gen: model did not return valid JSON');
  }

  const counter = { n: 0 };
  const childrenRaw = Array.isArray(parsed.children) ? parsed.children : [];
  const children = childrenRaw
    .map((c) => toOutlineNode(c, 1, counter))
    .filter((c): c is OutlineNode => c !== null);

  if (children.length === 0) {
    throw new Error('outline-gen: model returned an empty outline');
  }

  const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : topic;

  return {
    id: newId('out'),
    title,
    level: 0,
    children,
  };
}

function hitsToContext(hits: SearchHit[]): string {
  return hits
    .map((h, i) => `${i + 1}. [${h.source}] ${h.title}\n   ${h.snippet}`)
    .join('\n');
}

export async function generateOutlineFromTopic(
  topic: string,
  profile?: CourseProfile,
): Promise<OutlineGenResult> {
  const search = getSearch();
  const sources = await search.combined(topic, 10);

  const llm = getLlm();
  const reference = sources.length > 0 ? hitsToContext(sources) : '(no reference results found)';
  const messages = [
    { role: 'system' as const, content: TOPIC_SYSTEM_PROMPT + profileGuidance(profile) },
    {
      role: 'user' as const,
      content: `${profileHint(profile)}\nTopic: ${topic}\n\nReference search results:\n${reference}\n\nReturn the JSON outline now.`,
    },
  ];

  const raw = await llm.complete(messages, { json: true, temperature: 0.3 });

  // Mock provider echoes a diagnostic object; surface a clear error instead of
  // pretending we produced a real outline.
  if (llm.name === 'mock') {
    throw new Error(
      'outline-gen: no LLM configured (set LLM_BASE_URL / LLM_API_KEY / LLM_MODEL). ' +
        `Search returned ${sources.length} reference hits.`,
    );
  }

  return {
    title: topic,
    outline: parseOutline(raw, topic),
    sources,
    usedLlm: true,
  };
}
