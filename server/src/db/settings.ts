import { db } from './client.js';

export interface AppSettings {
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  searchProvider: string;
  wikiLang: string;
  /** When true, the composite search provider also queries Wikipedia. */
  enableWiki: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  // DeepSeek is the default OpenAI-compatible endpoint. Users only have to
  // paste an API key; both fields stay editable for other providers.
  llmBaseUrl: 'https://api.deepseek.com',
  llmApiKey: '',
  llmModel: 'deepseek-chat',
  searchProvider: 'auto',
  wikiLang: 'zh',
  enableWiki: false,
};

/** Settings are stored as strings; booleans use 'true'/'false'. */
const STRING_KEYS = {
  llmBaseUrl: 'llm.baseUrl',
  llmApiKey: 'llm.apiKey',
  llmModel: 'llm.model',
  searchProvider: 'search.provider',
  wikiLang: 'search.wikiLang',
} as const satisfies Record<string, string>;

const BOOL_KEYS = {
  enableWiki: 'search.enableWiki',
} as const satisfies Record<string, string>;

/** Lazy-create the settings table so existing databases keep working. */
function ensureTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function getSettings(): AppSettings {
  ensureTable();
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as {
    key: string;
    value: string;
  }[];
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const result: AppSettings = { ...DEFAULT_SETTINGS };
  for (const [field, key] of Object.entries(STRING_KEYS) as [
    keyof typeof STRING_KEYS,
    string,
  ][]) {
    const v = byKey.get(key);
    if (typeof v === 'string') result[field] = v;
  }
  for (const [field, key] of Object.entries(BOOL_KEYS) as [
    keyof typeof BOOL_KEYS,
    string,
  ][]) {
    const v = byKey.get(key);
    if (v === 'true') result[field] = true;
    else if (v === 'false') result[field] = false;
  }
  return result;
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  ensureTable();
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);

  const tx = db.transaction(() => {
    for (const [field, key] of Object.entries(STRING_KEYS) as [
      keyof typeof STRING_KEYS,
      string,
    ][]) {
      const value = patch[field];
      if (typeof value === 'string') upsert.run(key, value.trim());
    }
    for (const [field, key] of Object.entries(BOOL_KEYS) as [
      keyof typeof BOOL_KEYS,
      string,
    ][]) {
      const value = patch[field];
      if (typeof value === 'boolean') upsert.run(key, String(value));
    }
  });
  tx();

  return getSettings();
}

/** Mask the API key so it can be shown in the UI without leaking it. */
export function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return '••••';
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

export function publicSettings(s: AppSettings) {
  return {
    llmBaseUrl: s.llmBaseUrl,
    llmModel: s.llmModel,
    llmApiKeyMasked: maskSecret(s.llmApiKey),
    llmApiKeyConfigured: s.llmApiKey.length > 0,
    searchProvider: s.searchProvider,
    wikiLang: s.wikiLang,
    enableWiki: s.enableWiki,
  };
}
