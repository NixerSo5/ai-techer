import { db, initSchema, DB_PATH } from './client.js';

initSchema();

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all() as { name: string }[];

console.log(`[db] schema applied -> ${DB_PATH}`);
console.log(`[db] tables: ${tables.map((t) => t.name).join(', ')}`);
