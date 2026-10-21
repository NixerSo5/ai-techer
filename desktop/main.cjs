/**
 * Electron entry point.
 *
 * Instead of spawning a child process, the Fastify server is started in-process
 * so the app has a single window with one shutdown path and no port races.
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

/**
 * Locate the compiled server and built front-end.
 *
 * Packaged: both sit next to main.cjs (`resources/app.asar/server`, `.../web`).
 * Dev: main.cjs lives in `desktop/`, while the build output is in the repo root.
 */
function resolveLayout() {
  const candidates = [
    { serverDir: path.join(__dirname, 'server'), webDir: path.join(__dirname, 'web') },
    {
      serverDir: path.join(__dirname, '..', 'server', 'dist'),
      webDir: path.join(__dirname, '..', 'web', 'dist'),
    },
  ];

  for (const layout of candidates) {
    if (
      fs.existsSync(path.join(layout.serverDir, 'app.js')) &&
      fs.existsSync(path.join(layout.webDir, 'index.html'))
    ) {
      return layout;
    }
  }
  throw new Error('could not find server/app.js and web/index.html; run npm run build first');
}

/** Pick an OS-assigned free port so two instances never collide. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Wait until /api/health answers, so the window never shows a blank page. */
async function waitForHealth(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      /* server not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not become healthy at ${url}`);
}

let mainWindow = null;
let fastifyApp = null;

async function createWindow() {
  const { serverDir, webDir } = resolveLayout();

  // Point the server at writable per-user state before it is imported, because
  // `db/client.ts` resolves its paths at module load time.
  process.env.AI_TEACHER_DATA_DIR = path.join(app.getPath('userData'), 'data');
  process.env.AI_TEACHER_WEB_DIR = webDir;

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  // The server is an ES module; CJS `require` cannot load it.
  const entry = pathToFileURL(path.join(serverDir, 'app.js')).href;
  const { buildApp } = await import(entry);
  fastifyApp = await buildApp();
  await fastifyApp.listen({ port, host: '127.0.0.1' });
  await waitForHealth(baseUrl);

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: 'AI Teacher',
    backgroundColor: '#f6f7f9',
    webPreferences: {
      // The renderer is our own bundled SPA; it needs no Node integration.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // External links open in the system browser, never inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // First run: no API key yet, so land on settings instead of an empty list.
  try {
    const res = await fetch(`${baseUrl}/api/settings`);
    const settings = await res.json();
    await mainWindow.loadURL(settings.llmApiKeyConfigured ? baseUrl : `${baseUrl}/settings`);
  } catch {
    await mainWindow.loadURL(baseUrl);
  }
}

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (err) {
    console.error('[desktop] failed to start:', err);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', async () => {
  if (fastifyApp) {
    try {
      await fastifyApp.close();
    } catch {
      /* already closed */
    }
    fastifyApp = null;
  }
});
