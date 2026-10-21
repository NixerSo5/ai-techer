import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createFromText, createFromTopic, type Audience } from '../api';

type Mode = 'topic' | 'text';

const audienceOptions: { value: Audience; label: string }[] = [
  { value: 'child', label: '小朋友' },
  { value: 'teen', label: '中学生' },
  { value: 'adult', label: '成人' },
];

export default function CreateCoursePage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('topic');
  const [topic, setTopic] = useState('');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState<Audience>('child');
  const [grade, setGrade] = useState<number | ''>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    setError('');
    setBusy(true);
    try {
      const profile = { audience, grade: grade === '' ? null : grade };
      const result =
        mode === 'topic'
          ? await createFromTopic(topic.trim(), profile)
          : await createFromText(text, profile, title.trim() || undefined);
      navigate(`/courses/${result.courseId}/outline`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = mode === 'topic' ? topic.trim().length > 0 : text.trim().length > 0;

  return (
    <section className="panel">
      <h1>新建课程</h1>
      <p className="hint">选一种方式生成大纲，确认后才会建图并生成学习路径。</p>

      <div className="profile-grid">
        <label className="field">
          <span>学习者</span>
          <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
            {audienceOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>年级</span>
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">不限</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
              <option key={g} value={g}>
                {g} 年级
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="tabs">
        <button
          className={mode === 'topic' ? 'tab active' : 'tab'}
          onClick={() => setMode('topic')}
          type="button"
        >
          按主题生成
        </button>
        <button
          className={mode === 'text' ? 'tab active' : 'tab'}
          onClick={() => setMode('text')}
          type="button"
        >
          粘贴文本
        </button>
      </div>

      {mode === 'topic' ? (
        <label className="field">
          <span>想学什么</span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="例如：一年级数学 20 以内加减法"
          />
        </label>
      ) : (
        <>
          <label className="field">
            <span>课程标题（可选）</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="留空则自动取名" />
          </label>
          <label className="field">
            <span>教材内容</span>
            <textarea
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="粘贴带标题层级的纯文本，例如：# 第一章 ..."
            />
          </label>
        </>
      )}

      <div className="actions">
        <button onClick={handleCreate} disabled={busy || !canSubmit}>
          {busy ? '生成中…' : '生成大纲'}
        </button>
      </div>

      {busy && <p className="hint">首次生成可能需要几十秒，请稍候。</p>}
      {error && <p className="message error">{error}</p>}
    </section>
  );
}
