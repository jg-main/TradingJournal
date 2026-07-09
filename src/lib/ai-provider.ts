/**
 * ai-provider.ts
 *
 * Typed AI provider abstraction wrapping the openai SDK (v6).
 * Supports Ollama, OpenAI-compatible, and custom endpoints via configurable baseURL.
 *
 * Exports a clean factory interface so consumers never import openai directly.
 */

import OpenAI from 'openai';
import {
  AuthenticationError as OpenAIAuthError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from 'openai';

// ── Types ──────────────────────────────────────────────────────────────

export interface AiProviderConfig {
  /** Provider type: 'openai', 'ollama', or a custom label (requires explicit baseUrl) */
  provider: string;
  /** Model identifier (e.g. 'gpt-4o', 'llama3.1:8b') */
  model: string;
  /** API key (omit for Ollama — defaults to 'ollama') */
  apiKey?: string;
  /** Base URL override (auto-derived for openai and ollama if omitted) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Sampling temperature (default: provider/model-specific) */
  temperature?: number;
  /** Maximum tokens to generate (default: model-specific) */
  maxTokens?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompletionResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

// ── Typed Error ─────────────────────────────────────────────────────────

export type AiProviderErrorCode =
  | 'AUTH_ERROR'
  | 'CONNECTION_ERROR'
  | 'TIMEOUT'
  | 'PARSE_ERROR'
  | 'MISSING_CONFIG';

export class AiProviderError extends Error {
  public readonly code: AiProviderErrorCode;
  public readonly statusCode?: number;

  constructor(code: AiProviderErrorCode, message: string, statusCode?: number) {
    super(message);
    this.name = 'AiProviderError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ── Interface ──────────────────────────────────────────────────────────

export interface AiProvider {
  getCompletion(
    messages: ChatMessage[],
    options?: { responseFormat?: 'json_object' },
  ): Promise<AiCompletionResult>;
}

// ── Defaults ───────────────────────────────────────────────────────────

function deriveBaseUrl(provider: string): string {
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'ollama':
      return 'http://localhost:11434/v1';
    default:
      throw new AiProviderError(
        'MISSING_CONFIG',
        `Unknown provider "${provider}". Provide explicit baseUrl or use 'openai' or 'ollama'.`,
      );
  }
}

function deriveApiKey(provider: string, apiKey?: string): string {
  if (apiKey) return apiKey;
  if (provider === 'ollama') return 'ollama';
  throw new AiProviderError(
    'MISSING_CONFIG',
    `apiKey is required for provider "${provider}".`,
  );
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createAiProvider(config: AiProviderConfig): AiProvider {
  if (!config.provider) {
    throw new AiProviderError('MISSING_CONFIG', 'provider is required.');
  }
  const model = (config.model ?? '').trim();
  if (!model) {
    throw new AiProviderError('MISSING_CONFIG', 'model is required.');
  }

  const baseURL = config.baseUrl ?? deriveBaseUrl(config.provider);
  const apiKey = deriveApiKey(config.provider, config.apiKey);
  const timeout = config.timeoutMs ?? 30_000;

  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout,
    maxRetries: 0, // we handle retries at a higher level if desired
  });

  // Log init — includes provider, model, and timeout (never logs apiKey)
  console.log(
    JSON.stringify({
      event: 'ai_provider_init',
      provider: config.provider,
      model: config.model,
      baseURL,
      timeout,
    }),
  );

  return {
    async getCompletion(messages, options?): Promise<AiCompletionResult> {
      const startTime = Date.now();

      try {
        const response = await client.chat.completions.create({
          model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          response_format:
            options?.responseFormat === 'json_object'
              ? { type: 'json_object' }
              : undefined,
          stream: false,
        });

        const durationMs = Date.now() - startTime;
        const choice = response.choices?.[0];
        const content = choice?.message?.content ?? '';

        // Log completion — token usage and latency (never logs content or apiKey)
        console.log(
          JSON.stringify({
            event: 'ai_completion',
            model: config.model,
            promptTokens: response.usage?.prompt_tokens,
            completionTokens: response.usage?.completion_tokens,
            durationMs,
          }),
        );

        return {
          content,
          usage: response.usage
            ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
              }
            : undefined,
        };
      } catch (err) {
        const durationMs = Date.now() - startTime;

        if (err instanceof OpenAIAuthError) {
          console.log(
            JSON.stringify({
              event: 'ai_error',
              errorType: 'AUTH_ERROR',
              model: config.model,
              durationMs,
            }),
          );
          throw new AiProviderError(
            'AUTH_ERROR',
            `Authentication failed: ${err.message}`,
            err.status,
          );
        }

        if (err instanceof APIConnectionTimeoutError) {
          console.log(
            JSON.stringify({
              event: 'ai_error',
              errorType: 'TIMEOUT',
              model: config.model,
              durationMs,
            }),
          );
          throw new AiProviderError(
            'TIMEOUT',
            `Request timed out after ${timeout}ms.`,
          );
        }

        if (err instanceof APIConnectionError) {
          console.log(
            JSON.stringify({
              event: 'ai_error',
              errorType: 'CONNECTION_ERROR',
              model: config.model,
              durationMs,
            }),
          );
          throw new AiProviderError(
            'CONNECTION_ERROR',
            `Connection failed: ${err.message}`,
          );
        }

        if (err instanceof APIError) {
          console.log(
            JSON.stringify({
              event: 'ai_error',
              errorType: 'API_ERROR',
              statusCode: err.status,
              model: config.model,
              durationMs,
            }),
          );
          throw new AiProviderError(
            'CONNECTION_ERROR',
            `API error (${err.status}): ${err.message}`,
            err.status,
          );
        }

        // Re-throw unknown errors as-is
        console.log(
          JSON.stringify({
            event: 'ai_error',
            errorType: 'UNKNOWN',
            model: config.model,
            durationMs,
          }),
        );
        throw err;
      }
    },
  };
}
