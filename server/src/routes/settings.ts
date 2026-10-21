import type { FastifyInstance } from 'fastify';
import { getSettings, publicSettings, saveSettings, type AppSettings } from '../db/settings.js';
import { getLlm, setLlm } from '../providers/llm.js';
import { setSearch } from '../providers/search.js';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => publicSettings(getSettings()));

  app.put<{ Body: Partial<AppSettings> }>('/api/settings', async (req, reply) => {
    const body = req.body ?? {};

    const stringKeys = [
      'llmBaseUrl',
      'llmApiKey',
      'llmModel',
      'searchProvider',
      'wikiLang',
    ] as const;

    const patch: Partial<AppSettings> = {};
    for (const key of stringKeys) {
      const v = body[key];
      if (typeof v === 'string') patch[key] = v;
    }
    if (typeof body.enableWiki === 'boolean') patch.enableWiki = body.enableWiki;

    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ error: 'no supported settings fields provided' });
    }

    const saved = saveSettings(patch);

    // Providers cache their config; reset so the new values take effect at once.
    setLlm(null);
    setSearch(null);

    return publicSettings(saved);
  });

  /** Verify the current LLM config with a tiny round-trip. */
  app.post('/api/settings/llm/test', async (_req, reply) => {
    const llm = getLlm();
    if (llm.name === 'mock') {
      return reply.code(409).send({ ok: false, error: 'LLM not configured yet' });
    }
    try {
      const answer = await llm.complete(
        [
          { role: 'system', content: 'Reply with exactly one word.' },
          { role: 'user', content: 'Say: pong' },
        ],
        { maxTokens: 512, temperature: 0 },
      );
      return { ok: true, sample: answer.trim().slice(0, 120) };
    } catch (err) {
      return reply
        .code(502)
        .send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}
