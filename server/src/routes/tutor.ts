import type { FastifyInstance } from 'fastify';
import { advance, getSession, startSession } from '../services/tutor.js';

export async function tutorRoutes(app: FastifyInstance): Promise<void> {
  /** Start a session for a path step (or resume an active one). */
  app.post<{ Body: { pathId: string; nodeId: string } }>(
    '/api/tutor/session',
    async (req, reply) => {
      const { pathId, nodeId } = req.body ?? ({} as { pathId: string; nodeId: string });
      if (!pathId || !nodeId) {
        return reply.code(400).send({ error: 'pathId and nodeId are required' });
      }
      try {
        const session = await startSession(pathId, nodeId);
        return session;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/api/tutor/session/:sessionId',
    async (req, reply) => {
      const session = getSession(req.params.sessionId);
      if (!session) return reply.code(404).send({ error: 'session not found' });
      return session;
    },
  );

  /** Advance the session one turn: ask a question, answer it, or retry. */
  app.post<{
    Params: { sessionId: string };
    Body: { action: 'ask' | 'answer' | 'retry'; answer?: string };
  }>('/api/tutor/session/:sessionId/turn', async (req, reply) => {
    const { action, answer } = req.body ?? ({} as { action: 'ask' | 'answer' | 'retry' });
    if (!action || !['ask', 'answer', 'retry'].includes(action)) {
      return reply.code(400).send({ error: 'action must be ask | answer | retry' });
    }
    const existing = getSession(req.params.sessionId);
    if (!existing) return reply.code(404).send({ error: 'session not found' });

    try {
      const session = await advance(req.params.sessionId, { action, answer });
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });
}
