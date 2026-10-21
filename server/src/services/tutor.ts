import { db, newId } from '../db/client.js';
import type { Quiz, TutorContext, TutorPhase } from '../skills/tutor.js';
import { ask, evaluate, explain } from '../skills/tutor.js';
import { listEdges, listNodes } from '../core/graph-query.js';
import { getPath, updateProgress } from './path.js';
import { getCourse, type Audience } from './outline.js';
import type { PathStep } from '../types.js';

export type SessionStatus = 'active' | 'passed' | 'failed' | 'abandoned';

export interface HistoryEntry {
  role: 'assistant' | 'user';
  content: string;
  at: string;
  phase: TutorPhase;
  /** For assistant quiz turns: the question text is the content. */
  kind?: 'explain' | 'quiz' | 'eval';
  /** Structured question for kind === 'quiz', so the UI can render choices. */
  quiz?: Quiz;
}

export interface TutorSession {
  id: string;
  pathId: string;
  nodeId: string;
  phase: TutorPhase;
  status: SessionStatus;
  score: number | null;
  history: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

interface SessionRow {
  id: string;
  path_id: string;
  node_id: string;
  phase: TutorPhase;
  status: SessionStatus;
  score: number | null;
  history_json: string;
  created_at: string;
  updated_at: string;
}

function rowToSession(row: SessionRow): TutorSession {
  return {
    id: row.id,
    pathId: row.path_id,
    nodeId: row.node_id,
    phase: row.phase,
    status: row.status,
    score: row.score,
    history: JSON.parse(row.history_json) as HistoryEntry[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSession(sessionId: string): TutorSession | null {
  const row = db
    .prepare(
      `SELECT id, path_id, node_id, phase, status, score, history_json, created_at, updated_at
         FROM tutor_sessions WHERE id = ?`,
    )
    .get(sessionId) as SessionRow | undefined;
  return row ? rowToSession(row) : null;
}

/** Persist the session and re-read it so the in-memory copy matches the DB. */
function persist(session: TutorSession): TutorSession {
  db.prepare(
    `UPDATE tutor_sessions
        SET phase = ?, status = ?, score = ?, history_json = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).run(
    session.phase,
    session.status,
    session.score,
    JSON.stringify(session.history),
    session.id,
  );
  return getSession(session.id) ?? session;
}

/** Build the teaching context for a path step from the graph. */
export function buildContext(pathId: string, nodeId: string): TutorContext | null {
  const path = getPath(pathId);
  if (!path) return null;

  const step = path.steps.find((s: PathStep) => s.nodeId === nodeId);
  if (!step) return null;

  const nodes = listNodes(path.courseId);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  // Direct prerequisites, resolved to titles for prompt context.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const prereqTitles = listEdges(path.courseId)
    .filter((e) => e.type === 'prerequisite' && e.to === nodeId)
    .map((e) => byId.get(e.from)?.title)
    .filter((t): t is string => Boolean(t));

  // Learner profile lives on the course; it drives wording and question style.
  const course = getCourse(path.courseId);
  const audience = (course?.audience ?? 'adult') as Audience;

  return {
    nodeTitle: node.title,
    objective: step.objective,
    acceptance: step.acceptance,
    prerequisiteTitles: prereqTitles,
    content: node.content,
    audience,
    grade: course?.grade ?? null,
  };
}

/**
 * Start (or resume) a tutoring session for a path step.
 * If an active session already exists for (pathId, nodeId), it is resumed.
 */
export async function startSession(pathId: string, nodeId: string): Promise<TutorSession> {
  const existingRow = db
    .prepare(
      `SELECT id, path_id, node_id, phase, status, score, history_json, created_at, updated_at
         FROM tutor_sessions
        WHERE path_id = ? AND node_id = ? AND status = 'active'
        ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(pathId, nodeId) as SessionRow | undefined;

  if (existingRow) return rowToSession(existingRow);

  const ctx = buildContext(pathId, nodeId);
  if (!ctx) throw new Error('tutor: path step or node not found');

  const turn = await explain(ctx);
  const history: HistoryEntry[] = [
    {
      role: 'assistant',
      content: turn.reply,
      at: new Date().toISOString(),
      phase: 'explain',
      kind: 'explain',
    },
  ];

  const id = newId('tutor');
  db.prepare(
    `INSERT INTO tutor_sessions (id, path_id, node_id, phase, status, history_json)
     VALUES (?, ?, ?, 'explain', 'active', ?)`,
  ).run(id, pathId, nodeId, JSON.stringify(history));

  // Mark the step as in progress on the learning path.
  updateProgress(pathId, nodeId, 'learning');

  return {
    id,
    pathId,
    nodeId,
    phase: 'explain',
    status: 'active',
    score: null,
    history,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** The most recent quiz still awaiting an answer. */
function lastQuiz(session: TutorSession): Quiz | null {
  for (let i = session.history.length - 1; i >= 0; i--) {
    const entry = session.history[i];
    if (entry.kind === 'quiz') return entry.quiz ?? null;
  }
  return null;
}

/**
 * Advance the session one turn.
 *  - action 'ask'    : move explain -> quiz, generate a question
 *  - action 'answer' : grade the answer, then either finish or return to review
 *  - action 'retry'  : from review, re-explain and ask again
 *  - action 'next'   : from done, no-op (caller starts the next step)
 */
export async function advance(
  sessionId: string,
  input: { action: 'ask' | 'answer' | 'retry'; answer?: string },
): Promise<TutorSession> {
  const session = getSession(sessionId);
  if (!session) throw new Error('tutor: session not found');
  if (session.status !== 'active') return session;

  const ctx = buildContext(session.pathId, session.nodeId);
  if (!ctx) throw new Error('tutor: path step or node not found');

  const now = () => new Date().toISOString();

  if (input.action === 'ask') {
    if (session.phase === 'quiz') return session;
    const turn = await ask(ctx);
    session.history.push({
      role: 'assistant',
      content: turn.reply,
      at: now(),
      phase: 'quiz',
      kind: 'quiz',
      quiz: turn.quiz,
    });
    session.phase = 'quiz';
    return persist(session);
  }

  if (input.action === 'answer') {
    const raw = (input.answer ?? '').trim();
    if (!raw) throw new Error('tutor: answer is required');
    const quiz = lastQuiz(session);
    if (!quiz) throw new Error('tutor: no question to answer; ask first');

    // Accept a bare key ("b") as well as the full choice text.
    const upper = raw.toUpperCase();
    const answer = quiz.choices.some((c) => c.key === upper) ? upper : raw;

    session.history.push({ role: 'user', content: answer, at: now(), phase: 'quiz' });

    const turn = await evaluate(ctx, quiz.question, answer, quiz.answer);
    session.history.push({
      role: 'assistant',
      content: turn.reply,
      at: now(),
      // The evaluation happened against a quiz, so tag it as such regardless
      // of whether the session is now done.
      phase: 'quiz',
      kind: 'eval',
    });

    session.phase = turn.phase;
    if (turn.phase === 'done') {
      session.status = turn.passed ? 'passed' : 'failed';
      session.score = turn.score ?? null;
      // Only a passing evaluation advances the learning path.
      updateProgress(
        session.pathId,
        session.nodeId,
        turn.passed ? 'passed' : 'failed',
        turn.score,
      );
    }
    return persist(session);
  }

  // retry: re-explain the point, then ask a fresh question next turn.
  const turn = await explain(ctx);
  session.history.push({
    role: 'assistant',
    content: turn.reply,
    at: now(),
    phase: 'explain',
    kind: 'explain',
  });
  session.phase = 'explain';
  return persist(session);
}
