import type { FastifyInstance } from 'fastify';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UPLOAD_DIR } from '../db/client.js';
import { getParser } from '../parsers/index.js';
import {
  createCourse,
  deleteCourse,
  getCourse,
  getLatestOutline,
  listCourses,
  saveOutline,
  type Audience,
} from '../services/outline.js';
import { buildGraphFromOutline, getGraph } from '../services/graph.js';
import { generateOutlineFromTopic } from '../skills/outline-gen.js';
import { inferPrerequisites } from '../skills/graph-build.js';
import type { OutlineNode } from '../types.js';

interface ProfileBody {
  audience?: Audience;
  grade?: number | null;
}

function readProfile(body: ProfileBody | undefined) {
  const audience =
    body?.audience === 'child' || body?.audience === 'teen' || body?.audience === 'adult'
      ? body.audience
      : undefined;
  const grade =
    typeof body?.grade === 'number' && body.grade >= 1 && body.grade <= 12 ? body.grade : null;
  return { audience, grade };
}

export async function courseRoutes(app: FastifyInstance): Promise<void> {
  /** All courses, newest first, so previously built work is never lost. */
  app.get('/api/courses', async () => ({ courses: listCourses() }));

  /** Upload a TXT/MD file, parse it, create a draft course + v1 outline. */
  app.post('/api/courses/upload', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'missing file' });

    const parser = getParser(file.filename);
    if (!parser) return reply.code(415).send({ error: `unsupported file type: ${file.filename}` });

    const buffer = await file.toBuffer();
    const text = buffer.toString('utf8');
    const saved = join(UPLOAD_DIR, `${Date.now()}_${file.filename}`);
    writeFileSync(saved, buffer);

    const parsed = parser.parse(text, file.filename);
    const courseId = createCourse(parsed.title, 'txt', saved);
    const version = saveOutline(courseId, parsed.outline);

    return {
      courseId,
      title: parsed.title,
      outlineVersion: version,
      outline: parsed.outline,
    };
  });

  /** Create a course from pasted plain text. */
  app.post<{ Body: { text: string; title?: string } & ProfileBody }>(
    '/api/courses/text',
    async (req, reply) => {
      const body = req.body ?? ({} as { text: string; title?: string } & ProfileBody);
      const { text, title } = body;
      if (!text || !text.trim()) return reply.code(400).send({ error: 'text is required' });

      const parsed = getParser('inline.txt')!.parse(text, title ? `${title}.txt` : 'inline.txt');
      const courseId = createCourse(title ?? parsed.title, 'text', null, readProfile(body));
      const version = saveOutline(courseId, parsed.outline);
      return {
        courseId,
        title: title ?? parsed.title,
        outlineVersion: version,
        outline: parsed.outline,
      };
    },
  );

  /** Topic mode: search + LLM -> outline -> draft course. */
  app.post<{ Body: { topic: string } & ProfileBody }>(
    '/api/courses/topic',
    async (req, reply) => {
      const body = req.body ?? ({} as { topic: string } & ProfileBody);
      const { topic } = body;
      if (!topic || !topic.trim()) return reply.code(400).send({ error: 'topic is required' });

      const profile = readProfile(body);
      let generated: Awaited<ReturnType<typeof generateOutlineFromTopic>>;
      try {
        generated = await generateOutlineFromTopic(topic.trim(), profile);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(503).send({ error: message });
      }

      const courseId = createCourse(generated.title, 'topic', null, profile);
    const version = saveOutline(courseId, generated.outline);

      return {
        courseId,
        title: generated.title,
        outlineVersion: version,
        outline: generated.outline,
        sources: generated.sources,
      };
    },
  );

  app.get<{ Params: { id: string } }>('/api/courses/:id', async (req, reply) => {
    const course = getCourse(req.params.id);
    if (!course) return reply.code(404).send({ error: 'course not found' });
    return course;
  });

  app.get<{ Params: { id: string } }>('/api/courses/:id/outline', async (req, reply) => {
    const course = getCourse(req.params.id);
    if (!course) return reply.code(404).send({ error: 'course not found' });
    const latest = getLatestOutline(req.params.id);
    if (!latest) return reply.code(404).send({ error: 'outline not found' });
    return { course, version: latest.version, outline: latest.outline };
  });

  app.put<{ Params: { id: string }; Body: { outline: OutlineNode } }>(
    '/api/courses/:id/outline',
    async (req, reply) => {
      const course = getCourse(req.params.id);
      if (!course) return reply.code(404).send({ error: 'course not found' });
      const { outline } = req.body ?? ({} as { outline: OutlineNode });
      if (!outline) return reply.code(400).send({ error: 'outline is required' });
      const version = saveOutline(req.params.id, outline);
      return { courseId: req.params.id, outlineVersion: version };
    },
  );

  /** Confirm the current outline, build the graph. */
  app.post<{ Params: { id: string } }>('/api/courses/:id/confirm', async (req, reply) => {
    const course = getCourse(req.params.id);
    if (!course) return reply.code(404).send({ error: 'course not found' });
    if (course.status === 'confirmed') return reply.code(409).send({ error: 'already confirmed' });

    const latest = getLatestOutline(req.params.id);
    if (!latest) return reply.code(404).send({ error: 'outline not found' });

    // Infer prerequisites first (best-effort); failure must not block confirmation.
    let inferredPrereqs: { fromTitle: string; toTitle: string }[] = [];
    let prereqWarning: string | undefined;
    try {
      const inference = await inferPrerequisites(latest.outline);
      inferredPrereqs = inference.pairs;
      if (inference.reason) prereqWarning = inference.reason;
    } catch (err) {
      prereqWarning = `prerequisite inference failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    const result = buildGraphFromOutline(req.params.id, latest.outline, inferredPrereqs);

    // Persist the confirmed snapshot timestamp + flip course status.
    const { db } = await import('../db/client.js');
    db.prepare(
      `UPDATE outlines SET confirmed_at = datetime('now') WHERE course_id = ? AND version = ?`,
    ).run(req.params.id, latest.version);
    db.prepare(`UPDATE courses SET status = 'confirmed' WHERE id = ?`).run(req.params.id);

    return {
      courseId: req.params.id,
      status: 'confirmed',
      ...result,
      prereqCandidates: inferredPrereqs.length,
      prereqWarning,
    };
  });

  app.get<{ Params: { id: string } }>('/api/courses/:id/graph', async (req, reply) => {
    const course = getCourse(req.params.id);
    if (!course) return reply.code(404).send({ error: 'course not found' });
    return getGraph(req.params.id);
  });

  /** Delete a course with its outline, graph, paths, progress and tutor sessions. */
  app.delete<{ Params: { id: string } }>('/api/courses/:id', async (req, reply) => {
    const deleted = deleteCourse(req.params.id);
    if (!deleted) return reply.code(404).send({ error: 'course not found' });
    return { courseId: req.params.id, deleted: true };
  });
}
