import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getTutorSession,
  startTutorSession,
  turnTutorSession,
  type Quiz,
  type TutorSession,
} from '../api';

const STORAGE_KEY = 'ai-teacher:tutor-session';

/** The latest quiz in history that has not been answered yet. */
function pendingQuiz(session: TutorSession): Quiz | null {
  for (let i = session.history.length - 1; i >= 0; i--) {
    const entry = session.history[i];
    if (entry.kind === 'eval') return null;
    if (entry.kind === 'quiz') return entry.quiz ?? null;
  }
  return null;
}

export default function TutorPage() {
  const { pathId, nodeId } = useParams<{ pathId: string; nodeId: string }>();
  const [session, setSession] = useState<TutorSession | null>(null);
  const [picked, setPicked] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Resume the same session after a page reload, when it belongs to this node.
  useEffect(() => {
    if (!pathId || !nodeId) return;
    const cached = localStorage.getItem(STORAGE_KEY);
    const start = () =>
      startTutorSession(pathId, nodeId)
        .then((fresh) => {
          localStorage.setItem(STORAGE_KEY, fresh.id);
          setSession(fresh);
        })
        .catch((err: Error) => setError(err.message));

    if (!cached) {
      start();
      return;
    }
    getTutorSession(cached)
      .then((s) => {
        if (s.pathId === pathId && s.nodeId === nodeId && s.status === 'active') {
          setSession(s);
          return;
        }
        localStorage.removeItem(STORAGE_KEY);
        return start();
      })
      .catch(() => {
        localStorage.removeItem(STORAGE_KEY);
        start();
      });
  }, [pathId, nodeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.history.length]);

  const quiz = useMemo(() => (session ? pendingQuiz(session) : null), [session]);

  async function send(body: { action: 'ask' | 'answer' | 'retry'; answer?: string }) {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const next = await turnTutorSession(session.id, body);
      setSession(next);
      setPicked('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <section className="panel">
        <h1>教学</h1>
        {error ? <p className="message error">{error}</p> : <p className="hint">准备讲解中…</p>}
      </section>
    );
  }

  const finished = session.status !== 'active';

  return (
    <section className="panel tutor">
      <div className="tutor-head">
        <h1>教学对话</h1>
        <Link to={`/paths/${session.pathId}`}>返回路径</Link>
      </div>
      <p className="hint">
        阶段：{session.phase}
        {session.score != null && ` · 得分 ${session.score}`}
        {finished && ` · ${session.status === 'passed' ? '已通过' : '未通过'}`}
      </p>

      <div className="chat">
        {session.history.map((entry, i) => (
          <div key={i} className={`bubble ${entry.role} ${entry.kind ?? ''}`}>
            <div className="bubble-content">{entry.content}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {!finished && (
        <div className="composer">
          {session.phase === 'explain' && (
            <button onClick={() => send({ action: 'ask' })} disabled={busy}>
              我准备好了，出题考我
            </button>
          )}

          {session.phase === 'quiz' && quiz && (
            <div className="quiz-box">
              <p className="quiz-hint">选一个答案：</p>
              <div className="quiz-choices">
                {quiz.choices.map((choice) => (
                  <button
                    key={choice.key}
                    type="button"
                    className={picked === choice.key ? 'quiz-choice picked' : 'quiz-choice'}
                    onClick={() => setPicked(choice.key)}
                    disabled={busy}
                  >
                    <span className="quiz-key">{choice.key}</span>
                    <span className="quiz-text">{choice.text}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => send({ action: 'answer', answer: picked })}
                disabled={busy || !picked}
              >
                提交答案
              </button>
            </div>
          )}

          {session.phase === 'quiz' && !quiz && (
            <button onClick={() => send({ action: 'ask' })} disabled={busy}>
              出题考我
            </button>
          )}

          {session.phase === 'review' && (
            <div className="actions">
              <button onClick={() => send({ action: 'ask' })} disabled={busy}>
                再问一题
              </button>
              <button className="secondary" onClick={() => send({ action: 'retry' })} disabled={busy}>
                重新讲解
              </button>
            </div>
          )}
        </div>
      )}

      {finished && (
        <div className="actions">
          <Link className="button-link" to={`/paths/${session.pathId}`}>
            返回路径
          </Link>
        </div>
      )}

      {error && <p className="message error">{error}</p>}
    </section>
  );
}
