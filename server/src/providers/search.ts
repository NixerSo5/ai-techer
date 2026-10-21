/**
 * Search provider abstraction.
 *
 * Two sources are combined for the topic route:
 *   - web:  general web search
 *   - wiki: encyclopedic reference
 *
 * No third-party key is required by the abstraction itself. Implementations
 * are selected at runtime; a mock is used when nothing is configured so the
 * topic pipeline can be exercised offline.
 */

import { getSettings } from '../db/settings.js';

export interface SearchHit {
  title: string;
  url?: string;
  snippet: string;
  source: 'web' | 'wiki';
}

export interface SearchProvider {
  readonly name: string;
  web(query: string, limit?: number): Promise<SearchHit[]>;
  wiki(query: string, limit?: number): Promise<SearchHit[]>;
  /** Search both sources and merge, de-duplicated by normalized title. */
  combined(query: string, limit?: number): Promise<SearchHit[]>;
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    const key = normalizeTitle(hit.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

/** Offline provider: returns stable placeholder hits so pipelines can run. */
export class MockSearchProvider implements SearchProvider {
  readonly name = 'mock';

  async web(query: string, limit = 5): Promise<SearchHit[]> {
    return Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
      title: `${query} — web result ${i + 1}`,
      snippet: `Placeholder web snippet for "${query}". Configure a real search provider to replace this.`,
      source: 'web' as const,
    }));
  }

  async wiki(query: string, limit = 5): Promise<SearchHit[]> {
    return Array.from({ length: Math.min(limit, 2) }, (_, i) => ({
      title: `${query} — wiki entry ${i + 1}`,
      snippet: `Placeholder encyclopedic summary for "${query}".`,
      source: 'wiki' as const,
    }));
  }

  async combined(query: string, limit = 8): Promise<SearchHit[]> {
    const [web, wiki] = await Promise.all([this.web(query, limit), this.wiki(query, limit)]);
    return dedupeHits([...web, ...wiki]).slice(0, limit);
  }
}

/**
 * Wikipedia REST provider — free, no API key.
 * Uses the summary endpoint per search result from the opensearch API.
 */
export class WikipediaSearchProvider implements SearchProvider {
  readonly name = 'wikipedia';
  private readonly lang: string;

  constructor(lang = process.env.WIKI_LANG ?? 'zh') {
    this.lang = lang;
  }

  private get base(): string {
    return `https://${this.lang}.wikipedia.org/w/api.php`;
  }

  async web(_query: string, _limit?: number): Promise<SearchHit[]> {
    // Wikipedia has no general web search; the web slot is filled by another
    // provider in a composite setup. Standalone, it contributes nothing here.
    return [];
  }

  async wiki(query: string, limit = 5): Promise<SearchHit[]> {
    const params = new URLSearchParams({
      action: 'opensearch',
      search: query,
      limit: String(limit),
      namespace: '0',
      format: 'json',
      origin: '*',
    });
    const res = await fetch(`${this.base}?${params.toString()}`);
    if (!res.ok) throw new Error(`Wikipedia search failed (${res.status})`);

    // opensearch returns [query, titles[], descriptions[], urls[]]
    const data = (await res.json()) as [string, string[], string[], string[]];
    const [, titles, descriptions, urls] = data;

    return titles.map((title, i) => ({
      title,
      url: urls[i],
      snippet: descriptions[i] || title,
      source: 'wiki' as const,
    }));
  }

  async combined(query: string, limit = 8): Promise<SearchHit[]> {
    return dedupeHits(await this.wiki(query, limit)).slice(0, limit);
  }
}

/**
 * Composite provider: fans out to multiple sources and merges the results.
 */
export class CompositeSearchProvider implements SearchProvider {
  readonly name = 'composite';

  constructor(private readonly parts: SearchProvider[]) {}

  async web(query: string, limit = 5): Promise<SearchHit[]> {
    const results = await Promise.allSettled(this.parts.map((p) => p.web(query, limit)));
    return dedupeHits(
      results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
    ).slice(0, limit);
  }

  async wiki(query: string, limit = 5): Promise<SearchHit[]> {
    const results = await Promise.allSettled(this.parts.map((p) => p.wiki(query, limit)));
    return dedupeHits(
      results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
    ).slice(0, limit);
  }

  async combined(query: string, limit = 8): Promise<SearchHit[]> {
    const [web, wiki] = await Promise.all([this.web(query, limit), this.wiki(query, limit)]);
    return dedupeHits([...web, ...wiki]).slice(0, limit);
  }
}

/**
 * No sources enabled. Returns nothing, so callers can report "no references
 * found" honestly instead of passing fabricated snippets to the model.
 */
export class EmptySearchProvider implements SearchProvider {
  readonly name = 'empty';

  async web(): Promise<SearchHit[]> {
    return [];
  }

  async wiki(): Promise<SearchHit[]> {
    return [];
  }

  async combined(): Promise<SearchHit[]> {
    return [];
  }
}

let cached: SearchProvider | null = null;

export function getSearch(): SearchProvider {
  if (cached) return cached;

  const mode = (process.env.SEARCH_PROVIDER ?? 'auto').toLowerCase();
  if (mode === 'mock') {
    cached = new MockSearchProvider();
    return cached;
  }

  // Sources are gated by settings: when nothing is enabled we return an empty
  // provider instead of fabricating placeholder hits.
  const parts: SearchProvider[] = [];
  try {
    const s = getSettings();
    if (mode === 'wikipedia' || s.enableWiki) {
      parts.push(new WikipediaSearchProvider(s.wikiLang));
    }
  } catch {
    // settings unavailable (early boot) -> no sources
  }

  cached = parts.length > 0 ? new CompositeSearchProvider(parts) : new EmptySearchProvider();
  return cached;
}

export function setSearch(provider: SearchProvider | null): void {
  cached = provider;
}
