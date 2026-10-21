import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  confirmCourse,
  createPath,
  getOutline,
  type CourseSummary,
  type OutlineNode,
} from '../api';

function OutlineTree({ nodes, depth = 0 }: { nodes: OutlineNode[]; depth?: number }) {
  return (
    <ul className={`outline depth-${depth}`}>
      {nodes.map((node) => (
        <li key={node.id}>
          <div className="outline-row">
            <span className="outline-title">{node.title}</span>
            {node.summary && <span className="outline-summary">{node.summary}</span>}
          </div>
          {node.children.length > 0 && <OutlineTree nodes={node.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function countNodes(nodes: OutlineNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

export default function OutlineConfirmPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [outline, setOutline] = useState<OutlineNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!courseId) return;
    getOutline(courseId)
      .then((r) => {
        setCourse(r.course);
        setOutline(r.outline);
      })
      .catch((err: Error) => setError(err.message));
  }, [courseId]);

  async function handleConfirm() {
    if (!courseId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await confirmCourse(courseId);
      setNotice(`建图完成：${result.nodeCount} 个节点，${result.edgeCount} 条边`);
      setCourse((c) => (c ? { ...c, status: 'confirmed' } : c));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreatePath() {
    if (!courseId) return;
    setBusy(true);
    setError('');
    try {
      const result = await createPath(courseId);
      navigate(`/paths/${result.pathId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!outline) {
    return (
      <section className="panel">
        <h1>大纲</h1>
        {error ? <p className="message error">{error}</p> : <p className="hint">加载中…</p>}
      </section>
    );
  }

  const confirmed = course?.status === 'confirmed';

  return (
    <section className="panel">
      <h1>{outline.title}</h1>
      <p className="hint">
        共 {countNodes(outline.children)} 个知识点。确认后才会生成图谱与学习路径，之后不能再次确认。
      </p>

      <div className="outline-box">
        <OutlineTree nodes={outline.children} />
      </div>

      <div className="actions">
        {!confirmed && (
          <button onClick={handleConfirm} disabled={busy}>
            {busy ? '处理中…' : '确认大纲并建图'}
          </button>
        )}
        {confirmed && (
          <button onClick={handleCreatePath} disabled={busy}>
            {busy ? '生成中…' : '生成学习路径'}
          </button>
        )}
      </div>

      {notice && <p className="message">{notice}</p>}
      {error && <p className="message error">{error}</p>}
    </section>
  );
}
