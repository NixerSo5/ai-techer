/** Thin typed wrapper around the backend REST API. */

export interface OutlineNode {
  id: string;
  title: string;
  level: number;
  summary?: string;
  children: OutlineNode[];
}

export interface PublicSettings {
  llmBaseUrl: string;
  llmModel: string;
  llmApiKeyMasked: string;
  llmApiKeyConfigured: boolean;
  searchProvider: string;
  wikiLang: string;
  enableWiki: boolean;
}

export interface PathStep {
  nodeId: string;
  title: string;
  objective: string;
  estimatedMinutes: number;
  acceptance: string;
}

export interface ProgressItem {
  nodeId: string;
  status: 'pending' | 'learning' | 'passed' | 'failed';
  score: number | null;
  updatedAt: string;
}

export interface LearningPath {
  id: string;
  courseId: string;
  steps: PathStep[];
  progress: ProgressItem[];
  createdAt: string;
}

export interface QuizChoice {
  key: string;
  text: string;
}

export interface Quiz {
  question: string;
  choices: QuizChoice[];
  /** Correct key. Present in the payload; do not reveal it to the learner. */
  answer: string;
  explanation?: string;
}

export interface HistoryEntry {
  role: 'assistant' | 'user';
  content: string;
  at: string;
  phase: 'explain' | 'quiz' | 'review' | 'done';
  kind?: 'explain' | 'quiz' | 'eval';
  quiz?: Quiz;
}

export interface TutorSession {
  id: string;
  pathId: string;
  nodeId: string;
  phase: 'explain' | 'quiz' | 'review' | 'done';
  status: 'active' | 'passed' | 'failed' | 'abandoned';
  score: number | null;
  history: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export type Audience = 'child' | 'teen' | 'adult';

export interface CourseProfile {
  audience: Audience;
  grade?: number | null;
}

export interface CourseSummary {
  id: string;
  title: string;
  sourceType: 'txt' | 'topic' | 'text';
  status: 'draft' | 'confirmed';
  audience: Audience;
  grade: number | null;
  createdAt: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `request failed: ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

// ---- settings ----
export const getSettings = () => request<PublicSettings>('/api/settings');

export const saveSettings = (patch: Record<string, unknown>) =>
  request<PublicSettings>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

export const testLlm = () =>
  request<{ ok: boolean; sample?: string; error?: string }>('/api/settings/llm/test', {
    method: 'POST',
  });

// ---- courses ----
export const listCourses = () =>
  request<{ courses: CourseSummary[] }>('/api/courses');

export const createFromTopic = (topic: string, profile: CourseProfile) =>
  request<{
    courseId: string;
    title: string;
    outlineVersion: number;
    outline: OutlineNode;
    sources: unknown[];
  }>('/api/courses/topic', {
    method: 'POST',
    body: JSON.stringify({ topic, ...profile }),
  });

export const createFromText = (text: string, profile: CourseProfile, title?: string) =>
  request<{
    courseId: string;
    title: string;
    outlineVersion: number;
    outline: OutlineNode;
  }>('/api/courses/text', {
    method: 'POST',
    body: JSON.stringify({ text, title, ...profile }),
  });

export const getCourse = (id: string) => request<CourseSummary>(`/api/courses/${id}`);

export const getOutline = (id: string) =>
  request<{ course: CourseSummary; version: number; outline: OutlineNode }>(
    `/api/courses/${id}/outline`,
  );

export const saveOutline = (id: string, outline: OutlineNode) =>
  request<{ courseId: string; outlineVersion: number }>(`/api/courses/${id}/outline`, {
    method: 'PUT',
    body: JSON.stringify({ outline }),
  });

export const deleteCourse = (id: string) =>
  request<{ courseId: string; deleted: boolean }>(`/api/courses/${id}`, { method: 'DELETE' });

export const confirmCourse = (id: string) =>
  request<{
    courseId: string;
    status: string;
    nodeCount: number;
    edgeCount: number;
    prereqCandidates: number;
    rejected: unknown[];
    prereqWarning?: string;
  }>(`/api/courses/${id}/confirm`, { method: 'POST' });

// ---- path ----
export const createPath = (courseId: string) =>
  request<{ pathId: string; steps: PathStep[] }>(`/api/courses/${courseId}/path`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const getPath = (pathId: string) => request<LearningPath>(`/api/paths/${pathId}`);

// ---- tutor ----
export const startTutorSession = (pathId: string, nodeId: string) =>
  request<TutorSession>('/api/tutor/session', {
    method: 'POST',
    body: JSON.stringify({ pathId, nodeId }),
  });

export const getTutorSession = (sessionId: string) =>
  request<TutorSession>(`/api/tutor/session/${sessionId}`);

export const turnTutorSession = (
  sessionId: string,
  body: { action: 'ask' | 'answer' | 'retry'; answer?: string },
) =>
  request<TutorSession>(`/api/tutor/session/${sessionId}/turn`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
