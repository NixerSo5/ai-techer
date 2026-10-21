import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteCourse, listCourses, type CourseSummary } from '../api';

const audienceLabel: Record<CourseSummary['audience'], string> = {
  child: '小朋友',
  teen: '中学生',
  adult: '成人',
};

function profileText(course: CourseSummary): string {
  const who = audienceLabel[course.audience] ?? course.audience;
  return course.grade ? `${who} · ${course.grade} 年级` : who;
}

export default function CoursesPage() {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    listCourses()
      .then((r) => setCourses(r.courses))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function handleDelete(course: CourseSummary) {
    const ok = window.confirm(
      `确定删除「${course.title}」吗？\n大纲、知识图谱、学习路径和教学记录都会一并删除，无法恢复。`,
    );
    if (!ok) return;

    setError('');
    setDeletingId(course.id);
    try {
      await deleteCourse(course.id);
      setCourses((prev) => (prev ? prev.filter((c) => c.id !== course.id) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  if (!courses) {
    return (
      <section className="panel">
        <h1>我的课程</h1>
        {error ? <p className="message error">{error}</p> : <p className="hint">加载中…</p>}
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="tutor-head">
        <h1>我的课程</h1>
        <Link className="button-link" to="/new">
          新建课程
        </Link>
      </div>
      <p className="hint">共 {courses.length} 门课程，按创建时间倒序。</p>

      {error && <p className="message error">{error}</p>}

      {courses.length === 0 ? (
        <p className="muted">还没有课程，先点右上角新建一门吧。</p>
      ) : (
        <ul className="course-list">
          {courses.map((course) => (
            <li key={course.id} className="course-item">
              <div className="course-main">
                <Link className="course-title" to={`/courses/${course.id}/outline`}>
                  {course.title}
                </Link>
                <span className="course-meta">{profileText(course)}</span>
              </div>
              <div className="course-side">
                <span className={`badge ${course.status === 'confirmed' ? 'passed' : ''}`}>
                  {course.status === 'confirmed' ? '已建图' : '草稿'}
                </span>
                <span className="course-date">{course.createdAt}</span>
                <button
                  type="button"
                  className="danger-link"
                  onClick={() => handleDelete(course)}
                  disabled={deletingId === course.id}
                  title="删除课程"
                >
                  {deletingId === course.id ? '删除中…' : '删除'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
