/**
 * `tsc` only emits JavaScript. `schema.sql` is read at runtime by
 * `initSchema()`, so it has to travel next to the compiled output.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, '..');

const pairs = [
  ['src/db/schema.sql', 'dist/db/schema.sql'],
];

for (const [from, to] of pairs) {
  const dest = join(serverRoot, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(serverRoot, from), dest);
  console.log(`[build] copied ${from} -> ${to}`);
}
