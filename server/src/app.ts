import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { createReadStream, existsSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSchema } from './db/client.js';
import { courseRoutes } from './routes/courses.js';
import { pathRoutes } from './routes/path.js';
import { settingsRoutes } from './routes/settings.js';
import { tutorRoutes } from './routes/tutor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Minimal MIME map; the SPA only emits html/css/js/svg/woff2. */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Where the built front-end lives.
 *
 * In the repo it is `web/dist`. Inside the packaged app the Electron main
 * process points us at the copied `web/` directory via `AI_TEACHER_WEB_DIR`.
 */
function resolveWebDir(): string | null {
  const candidates = [
    process.env.AI_TEACHER_WEB_DIR,
    resolve(__dirname, '..', '..', 'web', 'dist'),
  ].filter((p): p is string => Boolean(p));

  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir;
  }
  return null;
}

/**
 * Serve a file from `root`, refusing anything that escapes it.
 * Returns false when the path does not resolve to a real file.
 */
function sendFileFrom(root: string, urlPath: string, reply: FastifyReply): boolean {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const target = normalize(join(root, decoded));
  if (target !== root && !target.startsWith(root + sep)) return false;
  if (!existsSync(target)) return false;

  const type = MIME[extname(target).toLowerCase()];
  reply.header('content-type', type ?? 'application/octet-stream');
  // Hashed asset names are immutable; index.html must always be revalidated.
  reply.header(
    'cache-control',
    decoded.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
  reply.send(createReadStream(target));
  return true;
}

/**
 * Build the Fastify instance without listening.
 * Keeping this side-effect free lets the Electron main process start the
 * server in-process instead of spawning a child process.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  initSchema();

  app.get('/api/health', async () => ({
    ok: true,
    service: 'ai-teacher',
    time: new Date().toISOString(),
  }));

  await app.register(courseRoutes);
  await app.register(pathRoutes);
  await app.register(settingsRoutes);
  await app.register(tutorRoutes);

  const webDir = resolveWebDir();
  if (webDir) {
    app.log.info(`serving front-end from ${webDir}`);

    // Client-side routes (`/courses/:id/outline`, `/tutor/...`) are not files,
    // so anything that is not an API call falls back to index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not found' });
      }
      if (sendFileFrom(webDir, req.url, reply)) return reply;
      return reply.type('text/html; charset=utf-8').send(createReadStream(join(webDir, 'index.html')));
    });

    // Static assets and index.html are matched before the fallback.
    app.get('/', (_req, reply) => {
      reply.type('text/html; charset=utf-8').send(createReadStream(join(webDir, 'index.html')));
    });
    app.get('/assets/*', (req, reply) => {
      if (sendFileFrom(webDir, req.url, reply)) return reply;
      return reply.code(404).send({ error: 'not found' });
    });
  } else {
    app.log.warn('web/dist not found; serving API only (dev mode expects Vite on :5173)');
  }

  return app;
}

/**
 * Stand-alone entry point, used by `npm run dev` and `npm start`.
 * The packaged app calls `buildApp()` directly instead.
 */
async function main(): Promise<void> {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';

  try {
    const addr = await app.listen({ port, host });
    app.log.info(`server listening on ${addr}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// `main()` must only run when this file is the process entry point, not when
// Electron imports `buildApp` from it.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).replace(/\.(js|ts)$/, '') === fileURLToPath(import.meta.url).replace(/\.(js|ts)$/, '');

if (invokedDirectly) {
  await main();
}
