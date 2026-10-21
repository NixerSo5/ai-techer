import { getLlm, type ChatMessage } from '../providers/llm.js';
import type { Audience } from '../services/outline.js';

export type TutorPhase = 'explain' | 'quiz' | 'review' | 'done';

export interface TutorContext {
  nodeTitle: string;
  objective: string;
  acceptance: string;
  prerequisiteTitles: string[];
  /** Already-known content for this node, if the graph provided any. */
  content?: string | null;
  /** Learner profile; shapes vocabulary, pace and question format. */
  audience?: Audience;
  grade?: number | null;
}

export interface QuizChoice {
  /** A, B, C ... */
  key: string;
  text: string;
}

export interface Quiz {
  question: string;
  choices: QuizChoice[];
  /** Key of the correct choice. Only used server-side for grading. */
  answer: string;
  /** One-line explanation shown after grading. */
  explanation?: string;
}

export interface TutorTurn {
  /** Assistant reply text shown to the learner. */
  reply: string;
  /** Phase after this turn. */
  phase: TutorPhase;
  /** Only meaningful when phase === 'done'. */
  passed?: boolean;
  score?: number;
  /** Present on quiz turns so the UI can render choice buttons. */
  quiz?: Quiz;
  /** Internal evaluation note, not shown in chat. */
  note?: string;
}

const ADULT_EXPLAIN_PROMPT = `You are a patient, precise tutor teaching ONE knowledge point at a time.

Rules:
- Teach in the learner's language (match the node title language).
- Structure: 1) one-sentence intuition, 2) core mechanics, 3) a concrete example, 4) common pitfalls.
- Be concrete. Avoid vague filler and avoid listing everything at once.
- Keep it under 400 words.
- Do NOT quiz yet; end by inviting questions.`;

const CHILD_EXPLAIN_PROMPT = `You are a warm, playful tutor for a young child (primary school age).

Rules:
- 用中文，句子要短，一句话只说一件事。
- 语气亲切，可以适当用 emoji（每段最多 1 个），但不要堆砌。
- 结构固定为三小段，每段用一个小标题：
  【打个比方】用一个孩子熟悉的东西解释（玩具、零食、动画片、学校里的事）。
  【看个例子】给一个具体的小例子，最好带一点数字或画面感。
  【记住一句话】用一句话总结，孩子能背下来。
- 全文不超过 150 字，不要出现公式推导、抽象定义、英文术语。
- 不要出题，最后问一句「准备好了吗？我们做一道小题」。`;

const ADULT_QUIZ_PROMPT = `You create ONE multiple-choice question that checks understanding of ONE knowledge point.

Output STRICT JSON only, no prose, no fences:
{"question": string, "choices": [{"key": "A", "text": string}], "answer": "A", "explanation": string}

Rules:
- Use the same language as the knowledge point title.
- Exactly 4 choices with keys A, B, C, D.
- Exactly one choice is correct; 'answer' must be that key.
- Distractors must be plausible but clearly wrong to someone who understood the point.
- Test the acceptance criterion, prefer applying over reciting.
- 'explanation': one sentence, why the answer is right.`;

const CHILD_QUIZ_PROMPT = `You create ONE very easy multiple-choice question for a young child.

Output STRICT JSON only, no prose, no fences:
{"question": string, "choices": [{"key": "A", "text": string}], "answer": "A", "explanation": string}

Rules:
- 用中文，题干不超过 30 个字，最好配一点画面感。
- 正好 3 个选项，key 为 A、B、C，选项文字要短（不超过 12 个字）。
- 只有一个正确答案，'answer' 必须是它的 key。
- 另外两个选项要是「明显但不离谱」的错，不要故意挖坑。
- 题目只考刚刚讲过的那一个小点，不要考记忆性的定义。
- 'explanation' 用一句孩子能听懂的话说明为什么。`;

const EVAL_PROMPT = `You grade a learner's answer to ONE multiple-choice question.

Output STRICT JSON only, no prose, no fences:
{"passed": boolean, "score": number, "feedback": string, "followUp": string}

Rules:
- score is 0-100. passed = score >= 60.
- The learner's answer is a choice key (A/B/C/D). If it matches the correct key, score 100 and passed true.
- If wrong, score 20 and explain the right answer simply.
- Write feedback and followUp in the same language as the knowledge point title.
- feedback: <= 80 words, encouraging, points at the misconception.
- followUp: if passed, one sentence inviting the next step; if not, one concrete hint.`;

/** Child-facing wording is much simpler and much shorter. */
function isChild(ctx: TutorContext): boolean {
  return ctx.audience === 'child';
}

export function buildExplainMessages(ctx: TutorContext): ChatMessage[] {
  const child = isChild(ctx);
  const parts = [
    `Knowledge point: ${ctx.nodeTitle}`,
    `Learning objective: ${ctx.objective}`,
    `Acceptance criterion: ${ctx.acceptance}`,
  ];
  if (ctx.grade) parts.push(`Learner grade: ${ctx.grade}`);
  if (ctx.prerequisiteTitles.length > 0) {
    parts.push(`Already covered prerequisites: ${ctx.prerequisiteTitles.join('、')}`);
  }
  if (ctx.content) {
    parts.push(`Reference material for this point:\n${ctx.content.slice(0, 2000)}`);
  }
  return [
    { role: 'system', content: child ? CHILD_EXPLAIN_PROMPT : ADULT_EXPLAIN_PROMPT },
    { role: 'user', content: parts.join('\n') },
  ];
}

export function buildQuizMessages(ctx: TutorContext): ChatMessage[] {
  const child = isChild(ctx);
  const parts = [
    `Knowledge point: ${ctx.nodeTitle}`,
    `Acceptance criterion: ${ctx.acceptance}`,
  ];
  if (ctx.grade) parts.push(`Learner grade: ${ctx.grade}`);
  parts.push('', 'Return the JSON question now.');
  return [
    { role: 'system', content: child ? CHILD_QUIZ_PROMPT : ADULT_QUIZ_PROMPT },
    { role: 'user', content: parts.join('\n') },
  ];
}

export function buildEvalMessages(
  ctx: TutorContext,
  question: string,
  answer: string,
  correctKey?: string,
): ChatMessage[] {
  return [
    { role: 'system', content: EVAL_PROMPT },
    {
      role: 'user',
      content: [
        `Knowledge point: ${ctx.nodeTitle}`,
        `Acceptance criterion: ${ctx.acceptance}`,
        `Question asked: ${question}`,
        correctKey ? `Correct choice: ${correctKey}` : '',
        `Learner answer: ${answer}`,
        '',
        'Return the JSON evaluation now.',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

export interface Evaluation {
  passed: boolean;
  score: number;
  feedback: string;
  followUp: string;
}

export function parseEvaluation(text: string): Evaluation {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripFences(text)) as Record<string, unknown>;
  } catch {
    throw new Error('tutor: evaluator did not return valid JSON');
  }

  const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 0;
  const passed = typeof parsed.passed === 'boolean' ? parsed.passed : score >= 60;
  const feedback = typeof parsed.feedback === 'string' ? parsed.feedback.trim() : '';
  const followUp = typeof parsed.followUp === 'string' ? parsed.followUp.trim() : '';

  return { passed, score, feedback, followUp };
}

/** Parse and validate a model-produced multiple-choice question. */
export function parseQuiz(text: string): Quiz {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripFences(text)) as Record<string, unknown>;
  } catch {
    throw new Error('tutor: quiz generator did not return valid JSON');
  }

  const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';
  const rawChoices = Array.isArray(parsed.choices) ? parsed.choices : [];
  const choices: QuizChoice[] = [];
  for (const raw of rawChoices) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    const key = typeof obj.key === 'string' ? obj.key.trim().toUpperCase() : '';
    const value = typeof obj.text === 'string' ? obj.text.trim() : '';
    if (key && value) choices.push({ key, text: value });
  }
  const answer = typeof parsed.answer === 'string' ? parsed.answer.trim().toUpperCase() : '';
  const explanation =
    typeof parsed.explanation === 'string' ? parsed.explanation.trim() : undefined;

  if (!question || choices.length < 2) {
    throw new Error('tutor: quiz generator returned an unusable question');
  }
  if (!choices.some((c) => c.key === answer)) {
    throw new Error('tutor: quiz answer does not match any choice');
  }

  return { question, choices, answer, explanation };
}

/** Explain the current knowledge point. */
export async function explain(ctx: TutorContext): Promise<TutorTurn> {
  const llm = getLlm();
  if (llm.name === 'mock') {
    return {
      reply: `（LLM 未配置）本应讲解「${ctx.nodeTitle}」。请先在设置中配置模型。`,
      phase: 'explain',
      note: 'mock-llm',
    };
  }
  const reply = await llm.complete(buildExplainMessages(ctx), {
    temperature: 0.4,
    maxTokens: 2048,
  });
  return { reply: reply.trim(), phase: 'explain' };
}

/** Ask one multiple-choice question for the current knowledge point. */
export async function ask(ctx: TutorContext): Promise<TutorTurn> {
  const llm = getLlm();
  if (llm.name === 'mock') {
    return {
      reply: `（LLM 未配置）请口述「${ctx.nodeTitle}」的要点。`,
      phase: 'quiz',
      note: 'mock-llm',
    };
  }
  const raw = await llm.complete(buildQuizMessages(ctx), {
    json: true,
    temperature: 0.4,
    maxTokens: 1024,
  });
  const quiz = parseQuiz(raw);
  return {
    reply: quiz.question,
    phase: 'quiz',
    quiz,
  };
}

/** Grade a choice and decide the next phase. */
export async function evaluate(
  ctx: TutorContext,
  question: string,
  answer: string,
  correctKey?: string,
): Promise<TutorTurn> {
  const llm = getLlm();
  if (llm.name === 'mock') {
    return {
      reply: '（LLM 未配置）无法评估回答。',
      phase: 'review',
      note: 'mock-llm',
    };
  }

  const raw = await llm.complete(buildEvalMessages(ctx, question, answer, correctKey), {
    json: true,
    temperature: 0,
    maxTokens: 1024,
  });
  const evaluation = parseEvaluation(raw);

  return {
    reply: [evaluation.feedback, evaluation.followUp].filter(Boolean).join('\n\n'),
    phase: evaluation.passed ? 'done' : 'review',
    passed: evaluation.passed,
    score: evaluation.score,
    note: `score=${evaluation.score}`,
  };
}
