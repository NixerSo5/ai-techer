/**
 * Assemble the directory electron-builder will package.
 *
 * Layout inside `desktop/dist-app` (and therefore inside the installed app):
 *   server/          compiled Fastify server (ESM) + node_modules
 *   web/             built front-end (index.html + assets)
 *   main.cjs         Electron entry point
 *   package.json
 *
 * Keeping server and web as siblings lets `app.js` resolve `../web` and keeps
 * `import('./server/app.js')` working from the packaged asar.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, '..');
const repoRoot = resolve(desktopRoot, '..');
const out = join(desktopRoot, 'dist-app');

const serverRoot = join(repoRoot, 'server');
const serverDist = join(serverRoot, 'dist');
const webDist = join(repoRoot, 'web', 'dist');

if (!existsSync(join(serverDist, 'app.js'))) {
  throw new Error(`missing ${join(serverDist, 'app.js')}; run npm run build first`);
}
if (!existsSync(join(serverDist, 'db', 'schema.sql'))) {
  throw new Error('schema.sql was not copied into server/dist; run npm run build --workspace=server');
}
if (!existsSync(join(webDist, 'index.html'))) {
  throw new Error(`missing ${join(webDist, 'index.html')}; run npm run build first`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync(serverDist, join(out, 'server'), { recursive: true });
cpSync(webDist, join(out, 'web'), { recursive: true });
cpSync(join(desktopRoot, 'main.cjs'), join(out, 'main.cjs'));

/**
 * Copy the server's runtime dependencies next to the compiled output.
 *
 * npm workspaces hoist packages to the repo root, so resolution has to start
 * from `server/` and then copy the whole resolved package directory (including
 * its own nested deps).
 */
const serverRequire = createRequire(join(serverRoot, 'package.json'));
const serverPkg = JSON.parse(readFileSync(join(serverRoot, 'package.json'), 'utf8'));
const dependencies = Object.keys(serverPkg.dependencies ?? {});

const modulesDir = join(out, 'server', 'node_modules');
mkdirSync(modulesDir, { recursive: true });

const seen = new Set();

function copyPackage(name, fromDir) {
  if (seen.has(fromDir)) return;
  seen.add(fromDir);

  const dest = join(modulesDir, ...name.split('/'));
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(fromDir, dest, { recursive: true, dereference: true });

  const pkgPath = join(fromDir, 'package.json');
  if (!existsSync(pkgPath)) return;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    let depDir;
    try {
      depDir = dirname(createRequire(join(fromDir, 'package.json')).resolve(`${dep}/package.json`));
    } catch {
      // Some packages do not export package.json; fall back to the standard walk.
      depDir = resolvePackageDir(dep, fromDir);
    }
    if (depDir && !depDir.split(sep).includes('node_modules')) continue; // builtin or odd
    if (depDir) copyPackage(dep, depDir);
  }
}

function resolvePackageDir(name, fromDir) {
  let dir = fromDir;
  while (true) {
    const candidate = join(dir, 'node_modules', ...name.split('/'));
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

for (const dep of dependencies) {
  const depDir = resolvePackageDir(dep, serverRoot);
  if (!depDir) throw new Error(`cannot resolve server dependency: ${dep}`);
  copyPackage(dep, depDir);
}

// `server/dist/*.js` are ES modules. Without this marker Node treats them as
// CommonJS and every `import` statement throws.
writeFileSync(
  join(out, 'server', 'package.json'),
  JSON.stringify({ name: '@ai-teacher/server', version: '0.1.0', private: true, type: 'module' }, null, 2),
  'utf8',
);

writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'ai-teacher',
      version: '0.1.0',
      private: true,
      main: 'main.cjs',
      description: 'AI teaching agent with knowledge graph, learning path and step-by-step tutoring',
      dependencies: Object.fromEntries(dependencies.map((d) => [d, serverPkg.dependencies[d]])),
    },
    null,
    2,
  ),
  'utf8',
);

console.log(`[desktop] assembled ${out}`);
console.log(`[desktop] runtime deps: ${dependencies.join(', ')}`);
