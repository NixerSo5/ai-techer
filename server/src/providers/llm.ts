/**
 * LLM provider abstraction.
 *
 * Default implementation targets any OpenAI-compatible /chat/completions
 * endpoint (OpenAI, DeepSeek, Qwen, Ollama, LM Studio, vLLM ...).
 *
 * Configure via env:
 *   LLM_BASE_URL  e.g. https://api.deepseek.com/v1
 *   LLM_API_KEY   bearer token
 *   LLM_MODEL     e.g. deepseek-chat
 *
 * When LLM_BASE_URL/LLM_API_KEY are absent, the provider falls back to
 * `mockLlm` so the rest of the pipeline stays runnable offline.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteOptions {
  temperature?: number;
  maxTokens?: number;
  /** Ask the model to return strict JSON when the provider supports it. */
  json?: boolean;
}

export interface LlmProvider {
  readonly name: string;
  complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string>;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

function readConfig(): LlmConfig | null {
  // Database settings (editable in the UI) take precedence over env vars.
  let dbSettings: { llmBaseUrl: string; llmApiKey: string; llmModel: string } | null = null;
  try {
    // Imported lazily: settings module touches the DB, which may not be ready
    // during very early module evaluation.
    const { getSettings } = requireSettings();
    const s = getSettings();
    if (s.llmBaseUrl && s.llmApiKey && s.llmModel) dbSettings = s;
  } catch {
    // ignore, fall through to env
  }

  const baseUrl = dbSettings?.llmBaseUrl ?? process.env.LLM_BASE_URL?.trim();
  const apiKey = dbSettings?.llmApiKey ?? process.env.LLM_API_KEY?.trim();
  const model = dbSettings?.llmModel ?? process.env.LLM_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl, apiKey, model, timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 60_000) };
}

/** Isolated so the dynamic import stays in one place and stays testable. */
function requireSettings(): { getSettings: () => { llmBaseUrl: string; llmApiKey: string; llmModel: string } } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return settingsModule as {
    getSettings: () => { llmBaseUrl: string; llmApiKey: string; llmModel: string };
  };
}

import * as settingsModule from '../db/settings.js';

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, '');
  // Most OpenAI-compatible gateways expose chat under /v1/chat/completions.
  // If the user already included /v1, don't double it up.
  const withVersion = /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
  return `${withVersion}/${path.replace(/^\/+/, '')}`;
}

export class OpenAiCompatibleLlm implements LlmProvider {
  readonly name = 'openai-compatible';
  private readonly config: LlmConfig;

  constructor(config: LlmConfig) {
    this.config = config;
  }

  async complete(messages: ChatMessage[], options: CompleteOptions = {}): Promise<string> {
    // Empty responses are a known flake for reasoning models; one retry is
    // cheap compared to failing an outline generation the user waited on.
    try {
      return await this.completeOnce(messages, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('empty response')) throw err;
      return this.completeOnce(messages, options);
    }
  }

  private async completeOnce(
    messages: ChatMessage[],
    options: CompleteOptions,
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 60_000);

    try {
      const res = await fetch(joinUrl(this.config.baseUrl, '/chat/completions'), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxTokens ?? 4096,
          ...(options.json ? { response_format: { type: 'json_object' } } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 500)}`);
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string; reasoning_content?: string } }[];
      };
      const message = data.choices?.[0]?.message;
      const content = message?.content?.trim();
      if (content) return content;

      // Some reasoning models occasionally emit only `reasoning_content`.
      // It is better than nothing for outline/quiz JSON, so fall back to it.
      const reasoning = message?.reasoning_content?.trim();
      if (reasoning) return reasoning;

      throw new Error('LLM returned an empty response');
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Deterministic offline provider. Useful for tests and for running the whole
 * pipeline before credentials are configured.
 */
export class MockLlm implements LlmProvider {
  readonly name = 'mock';

  async complete(messages: ChatMessage[]): Promise<string> {
    const last = messages[messages.length - 1]?.content ?? '';
    return JSON.stringify({
      mock: true,
      note: 'No LLM_BASE_URL/LLM_API_KEY/LLM_MODEL configured.',
      received: last.slice(0, 200),
    });
  }
}

let cached: LlmProvider | null = null;

export function getLlm(): LlmProvider {
  if (cached) return cached;
  const config = readConfig();
  cached = config ? new OpenAiCompatibleLlm(config) : new MockLlm();
  return cached;
}

/** Test seam: swap the provider (e.g. in tests) or reset with null. */
export function setLlm(provider: LlmProvider | null): void {
  cached = provider;
}
