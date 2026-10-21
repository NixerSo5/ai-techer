import type { FastifyInstance } from 'fastify';
import { getCourse } from '../services/outline.js';
import { getPath, planPath, updateProgress } from '../services/path.js';

export async function pathRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string }; Body: { leafOnly?: boolean } }>(
    '/api/courses/:id/path',
    async (req, reply) => {
      const course = getCourse(req.params.id);
      if (!course) return reply.code(404).send({ error: 'course not found' });
      if (course.status !== 'confirmed') {
        return reply.code(409).send({ error: 'course must be confirmed before generating a path' });
      }

      const result = planPath(req.params.id, { leafOnly: req.body?.leafOnly ?? true });
      if (result.error) return reply.code(422).send(result);
      return { pathId: result.pathId, steps: result.steps };
    },
  );

  app.get<{ Params: { pathId: string } }>('/api/paths/:pathId', async (req, reply) => {
    const path = getPath(req.params.pathId);
    if (!path) return reply.code(404).send({ error: 'path not found' });
    return path;
  });

  app.put<{
    Params: { pathId: string };
    Body: { nodeId: string; status: 'pending' | 'learning' | 'passed' | 'failed'; score?: number };
  }>('/api/paths/:pathId/progress', async (req, reply) => {
    const { nodeId, status, score } = req.body ?? ({} as { nodeId: string; status: 'pending' });
    if (!nodeId || !status) return reply.code(400).send({ error: 'nodeId and status are required' });
    const path = getPath(req.params.pathId);
    if (!path) return reply.code(404).send({ error: 'path not found' });
    return updateProgress(req.params.pathId, nodeId, status, score);
  });
}
