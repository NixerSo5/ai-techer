import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getPath, type LearningPath } from '../api';

export default function PathPage() {
  const { pathId } = useParams<{ pathId: string }>();
  const [path, setPath] = useState<LearningPath | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!pathId) return;
    getPath(pathId)
      .then(setPath)
      .catch((err: Error) => setError(err.message));
  }, [pathId]);

  const progressByNode = useMemo(() => {
    const map = new Map<string, LearningPath['progress'][number]>();
    for (const p of path?.progress ?? []) map.set(p.nodeId, p);
    return map;
  }, [path]);

  if (!path) {
    return (
      <section className="panel">
        <h1>学习路径</h1>
        {error ? <p className="message error">{error}</p> : <p className="hint">加载中…</p>}
      </section>
    );
  }

  const passed = path.progress.filter((p) => p.status === 'passed').length;

  return (
    <section className="panel">
      <h1>学习路径</h1>
      <p className="hint">
        共 {path.steps.length} 步，已完成 {passed} 步。按顺序学习，未通过前置知识点不会解锁后续内容。
      </p>

      <ol className="steps">
        {path.steps.map((step, index) => {
          const state = progressByNode.get(step.nodeId);
          const status = state?.status ?? 'pending';
          const blocked = index > 0 && progressByNode.get(path.steps[index - 1].nodeId)?.status !== 'passed';
          return (
            <li key={step.nodeId} className={`step ${status}`}>
              <div className="step-head">
                <span className="step-index">{index + 1}</span>
                <span className="step-title">{step.title}</span>
                <span className={`badge ${status}`}>{status}</span>
              </div>
              <p className="step-objective">{step.objective}</p>
              <p className="step-acceptance">验收：{step.acceptance}</p>
              <div className="step-actions">
                {status === 'passed' ? (
                  <span className="ok">已通过{state?.score != null ? `（${state.score} 分）` : ''}</span>
                ) : blocked ? (
                  <span className="muted">先完成上一节</span>
                ) : (
                  <Link className="button-link" to={`/tutor/${path.id}/${step.nodeId}`}>
                    {status === 'learning' ? '继续学习' : '开始学习'}
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
