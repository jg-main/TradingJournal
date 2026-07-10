/**
 * ai-provider.ts
 *
 * Typed AI provider abstraction wrapping the openai SDK (v6) and the anthropic SDK.
 * Supports OpenAI, Ollama, Anthropic, and custom OpenAI-compatible endpoints.
 *
 * Exports a clean factory interface so consumers never import providers directly.
 */

import OpenAI from 'openai';
import {
  AuthenticationError as OpenAIAuthError,
  APIConnectionError as OpenAIConnectionError,
  APIConnectionTimeoutError as OpenAITimeoutError,
  APIError as OpenAIApiError,
} from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import {
  AuthenticationError as AnthropicAuthError,
  NotFoundError as AnthropicNotFoundError,
  RateLimitError as AnthropicRateLimitError,
  APIConnectionError as AnthropicConnectionError,
  APIConnectionTimeoutError as AnthropicTimeoutError,
  BadRequestError as AnthropicBadRequest,
  APIError as AnthropicApiError,
} from '@anthropic-ai/sdk';

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
    case 'anthropic':
      return 'https://api.anthropic.com/v1';
    default:
      throw new AiProviderError(
        'MISSING_CONFIG',
        `Unknown provider "${provider}". Provide explicit baseUrl or use 'openai', 'ollama', or 'anthropic'.`,
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

// ── Anthropic Provider ─────────────────────────────────────────────────

/**
 * Create an AI provider backed by Anthropic's Messages API.
 *
 * Uses the @anthropic-ai/sdk directly. System messages are extracted and
 * passed as the top-level `system` parameter (Anthropic does not accept
 * role: 'system' in the messages array).
 */
function createAnthropicProvider(config: AiProviderConfig): AiProvider {
  const baseURL = config.baseUrl || undefined;
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new AiProviderError(
      'MISSING_CONFIG',
      'apiKey is required for provider "anthropic".',
    );
  }

  const client = new Anthropic({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    timeout: config.timeoutMs ?? 30_000,
    maxRetries: 0,
  });

  console.log(
    JSON.stringify({
      event: 'ai_provider_init',
      provider: 'anthropic',
      model: config.model,
      baseURL: baseURL ?? 'https://api.anthropic.com/v1',
      timeout: config.timeoutMs ?? 30_000,
    }),
  );

  return {
    async getCompletion(messages, options?): Promise<AiCompletionResult> {
      const startTime = Date.now();

      // Extract system message — Anthropic uses a top-level system param
      const systemMsg = messages.find((m) => m.role === 'system')?.content;
      const chatMessages = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      try {
        // claude-sonnet-5 caps output tokens at 128,000. Cap to prevent
        // 400 errors from overly large values stored in config.
        const maxOutputTokens = Math.min(config.maxTokens ?? 4096, 128000);

        const anthropicParams: Record<string, unknown> = {
          model: config.model,
          max_tokens: maxOutputTokens,
          messages: chatMessages,
        };
        if (systemMsg) anthropicParams.system = systemMsg;
        // Temperature parameter is model-specific and deprecated for newer
        // Claude models (claude-sonnet-5+). Omit entirely — Anthropic's API
        // manages temperature internally when not specified.
        // Temperature is NOT sent for Anthropic.

        const response = await client.messages.create(
          anthropicParams as any,
        );

        const durationMs = Date.now() - startTime;
        const contentBlock = response.content.find((b) => b.type === 'text');
        const content = contentBlock?.text ?? '';

        console.log(
          JSON.stringify({
            event: 'ai_completion',
            model: config.model,
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
            durationMs,
          }),
        );

        return {
          content,
          usage: {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
          },
        };
      } catch (err) {
        const durationMs = Date.now() - startTime;

        if (err instanceof AnthropicAuthError) {
          console.log(
            JSON.stringify({ event: 'ai_error', errorType: 'AUTH_ERROR', model: config.model, durationMs }),
          );
          throw new AiProviderError('AUTH_ERROR', `Authentication failed: ${err.message}`, err.status);
        }

        if (err instanceof AnthropicNotFoundError) {
          console.log(
            JSON.stringify({ event: 'ai_error', errorType: 'NOT_FOUND', model: config.model, durationMs }),
          );
          throw new AiProviderError('CONNECTION_ERROR', `API error (${err.status}): ${err.message}`, err.status);
        }

        if (err instanceof AnthropicRateLimitError) {
          console.log(
            JSON.stringify({ event: 'ai_error', errorType: 'RATE_LIMIT', model: config.model, durationMs }),
          );
          throw new AiProviderError('CONNECTION_ERROR', `Rate limited: ${err.message}`, err.status);
        }

        if (err instanceof AnthropicTimeoutError) {
          console.log(
            JSON.stringify({ event: 'ai_error', errorType: 'TIMEOUT', model: config.model, durationMs }),
          );
          throw new AiProviderError('TIMEOUT', `Request timed out after ${config.timeoutMs ?? 30_000}ms.`);
        }

        if (err instanceof AnthropicConnectionError) {
          console.log(
            JSON.stringify({ event: 'ai_error', errorType: 'CONNECTION_ERROR', model: config.model, durationMs }),
          );
          throw new AiProviderError('CONNECTION_ERROR', `Connection failed: ${err.message}`);
        }

        if (err instanceof AnthropicBadRequest || err instanceof AnthropicApiError) {
          console.log(
            JSON.stringify({ event: 'ai_error', errorType: 'API_ERROR', statusCode: (err as any).status, model: config.model, durationMs }),
          );
          throw new AiProviderError('CONNECTION_ERROR', `API error (${(err as any).status}): ${err.message}`, (err as any).status);
        }

        console.log(
          JSON.stringify({ event: 'ai_error', errorType: 'UNKNOWN', model: config.model, durationMs }),
        );
        throw err;
      }
    },
  };
}

// ── OpenAI-Compat Provider ──────────────────────────────────────────────

/**
 * Create an AI provider backed by the OpenAI SDK (covers OpenAI, Ollama, custom).
 */
function createOpenaiProvider(config: AiProviderConfig): AiProvider {
  const baseURL = config.baseUrl ?? deriveBaseUrl(config.provider);
  const apiKey = deriveApiKey(config.provider, config.apiKey);
  const timeout = config.timeoutMs ?? 30_000;

  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout,
    maxRetries: 0,
  });

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
          model: config.model,
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
            JSON.stringify({ event: 'ai_error', errorType: 'AUTH_ERROR', model: config.model, durationMs }),
          );
          throw new AiProviderError('AUTH_ERROR', `Authentication failed: ${err.message}`, err.status);
        }

        if (err instanceof OpenAITimeoutError) {
          console.log(
            JSON.stringify({ event: 'ai_error', errorType: 'TIMEOUT', model: config.model, durationMs }),
          );
          throw new AiProviderError('TIMEOUT', `Request timed out after ${timeout}ms.`);
        }

        if (err instanceof OpenAIConnectionError) {
          console.log(
            JSON.stringify({ event: 'ai_error', errorType: 'CONNECTION_ERROR', model: config.model, durationMs }),
          );
          throw new AiProviderError('CONNECTION_ERROR', `Connection failed: ${err.message}`);
        }

        if (err instanceof OpenAIApiError) {
          console.log(
            JSON.stringify({ event: 'ai_error', errorType: 'API_ERROR', statusCode: err.status, model: config.model, durationMs }),
          );
          throw new AiProviderError('CONNECTION_ERROR', `API error (${err.status}): ${err.message}`, err.status);
        }

        console.log(
          JSON.stringify({ event: 'ai_error', errorType: 'UNKNOWN', model: config.model, durationMs }),
        );
        throw err;
      }
    },
  };
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

  // Route to Anthropic SDK when provider is 'anthropic'
  if (config.provider === 'anthropic') {
    return createAnthropicProvider(config);
  }

  // All others use the OpenAI SDK (OpenAI, Ollama, custom, google)
  return createOpenaiProvider(config);
}
