/**
 * ai-provider.test.ts
 *
 * Vitest tests for src/lib/ai-provider.ts.
 *
 * Uses vi.mock to mock the openai SDK — no real network calls.
 * Covers:
 *   - createAiProvider config validation (missing provider, missing model)
 *   - baseURL derivation for openai, ollama, and custom providers
 *   - getCompletion success path
 *   - Error wrapping: AuthenticationError → AUTH_ERROR
 *   - Error wrapping: connection errors → CONNECTION_ERROR
 *   - AiProviderError type properties
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAiProvider, AiProviderError } from '../ai-provider';

// These are imported from the mocked module and used to construct error
// instances that pass instanceof checks in the provider.
import {
  AuthenticationError as MockAuthError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from 'openai';

// ── Shared mock function ────────────────────────────────────────────────

const mockCreate = vi.fn();

// ── Mock OpenAI SDK ─────────────────────────────────────────────────────
// vi.mock is hoisted to the top of the file. The factory defines classes
// that match the openai error class names so instanceof checks work.

vi.mock('openai', () => {
  class AuthError extends Error {
    status: number;
    constructor(status: number, _error: unknown, message: string, _headers?: Headers) {
      super(message);
      this.name = 'AuthenticationError';
      this.status = status;
    }
  }

  class ConnError extends Error {
    constructor(opts?: { message?: string; cause?: Error }) {
      super(opts?.message ?? 'Connection error.');
      this.name = 'APIConnectionError';
    }
  }

  class ConnTimeoutError extends Error {
    constructor(opts?: { message?: string }) {
      super(opts?.message ?? 'Request timed out.');
      this.name = 'APIConnectionTimeoutError';
    }
  }

  class GenAPIError extends Error {
    status: number;
    constructor(status: number, _error: unknown, message: string, _headers?: Headers) {
      super(message);
      this.name = 'APIError';
      this.status = status;
    }
  }

  const MockOpenAI = vi.fn(function () {
    return {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    };
  });

  return {
    default: MockOpenAI,
    AuthenticationError: AuthError,
    APIConnectionError: ConnError,
    APIConnectionTimeoutError: ConnTimeoutError,
    APIError: GenAPIError,
  };
});

// ── Helpers ─────────────────────────────────────────────────────────────

function makeSuccessResponse(overrides?: Record<string, unknown>) {
  return {
    id: 'chatcmpl-abc123',
    object: 'chat.completion',
    created: 1234567890,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello, world!' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createAiProvider', () => {
  describe('config validation', () => {
    it('throws AiProviderError with MISSING_CONFIG when provider is empty', () => {
      expect(() =>
        createAiProvider({ provider: '', model: 'gpt-4o' }),
      ).toThrow(AiProviderError);
      expect(() =>
        createAiProvider({ provider: '', model: 'gpt-4o' }),
      ).toThrow('provider is required');
    });

    it('throws AiProviderError with MISSING_CONFIG when model is missing', () => {
      expect(() =>
        createAiProvider({ provider: 'openai', model: '' }),
      ).toThrow(AiProviderError);
      expect(() =>
        createAiProvider({ provider: 'openai', model: '' }),
      ).toThrow('model is required');
    });

    it('throws AiProviderError with MISSING_CONFIG when both provider and model are missing', () => {
      expect(() =>
        createAiProvider({ provider: '', model: '' }),
      ).toThrow(AiProviderError);
    });

    it('throws AiProviderError for unknown provider without explicit baseUrl', () => {
      expect(() =>
        createAiProvider({ provider: 'custom', model: 'my-model' }),
      ).toThrow(AiProviderError);
      expect(() =>
        createAiProvider({ provider: 'custom', model: 'my-model' }),
      ).toThrow(/Unknown provider/);
    });

    it('throws AiProviderError with MISSING_CONFIG when apiKey missing for openai', () => {
      expect(() =>
        createAiProvider({ provider: 'openai', model: 'gpt-4o' }),
      ).toThrow(AiProviderError);
      expect(() =>
        createAiProvider({ provider: 'openai', model: 'gpt-4o' }),
      ).toThrow(/apiKey is required/);
    });
  });

  describe('baseURL derivation', () => {
    it('accepts openai with explicit apiKey', () => {
      const provider = createAiProvider({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' });
      expect(provider).toBeDefined();
      expect(provider.getCompletion).toBeInstanceOf(Function);
    });

    it('accepts ollama (no apiKey needed)', () => {
      const provider = createAiProvider({ provider: 'ollama', model: 'llama3.1:8b' });
      expect(provider).toBeDefined();
      expect(provider.getCompletion).toBeInstanceOf(Function);
    });

    it('accepts custom provider with explicit baseUrl and apiKey', () => {
      const provider = createAiProvider({
        provider: 'custom',
        model: 'my-model',
        baseUrl: 'https://my-proxy.example.com/v1',
        apiKey: 'sk-custom',
      });
      expect(provider).toBeDefined();
      expect(provider.getCompletion).toBeInstanceOf(Function);
    });
  });

  describe('getCompletion success', () => {
    it('returns content and usage from a successful completion', async () => {
      mockCreate.mockResolvedValueOnce(makeSuccessResponse());

      const provider = createAiProvider({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test',
      });
      const result = await provider.getCompletion([
        { role: 'user', content: 'Say hello' },
      ]);

      expect(result.content).toBe('Hello, world!');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 20,
      });
    });

    it('passes response_format json_object when requested', async () => {
      mockCreate.mockResolvedValueOnce(
        makeSuccessResponse({
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: '{"key": "value"}',
              },
              finish_reason: 'stop',
            },
          ],
        }),
      );

      const provider = createAiProvider({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test',
      });
      const result = await provider.getCompletion(
        [{ role: 'user', content: 'Return JSON' }],
        { responseFormat: 'json_object' },
      );

      expect(result.content).toBe('{"key": "value"}');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: { type: 'json_object' },
        }),
      );
    });

    it('handles null content response gracefully', async () => {
      mockCreate.mockResolvedValueOnce(
        makeSuccessResponse({
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: null },
              finish_reason: 'stop',
            },
          ],
          usage: undefined,
        }),
      );

      const provider = createAiProvider({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test',
      });
      const result = await provider.getCompletion([
        { role: 'user', content: 'Say nothing' },
      ]);

      expect(result.content).toBe('');
      expect(result.usage).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('wraps AuthenticationError as AUTH_ERROR', async () => {
      mockCreate.mockRejectedValueOnce(
        new MockAuthError(401, { code: 'invalid_api_key' }, 'Incorrect API key provided', new Headers()),
      );

      const provider = createAiProvider({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test',
      });

      const err = await provider
        .getCompletion([{ role: 'user', content: 'Hi' }])
        .catch((e) => e);

      expect(err).toBeInstanceOf(AiProviderError);
      expect((err as AiProviderError).code).toBe('AUTH_ERROR');
      expect(err.message).toMatch(/Authentication failed/);
    });

    it('wraps connection errors as CONNECTION_ERROR', async () => {
      mockCreate.mockRejectedValueOnce(
        new APIConnectionError({ message: 'Connection refused' }),
      );

      const provider = createAiProvider({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test',
      });

      const err = await provider
        .getCompletion([{ role: 'user', content: 'Hi' }])
        .catch((e) => e);

      expect(err).toBeInstanceOf(AiProviderError);
      expect((err as AiProviderError).code).toBe('CONNECTION_ERROR');
      expect(err.message).toMatch(/Connection failed/);
    });

    it('wraps timeout errors as TIMEOUT', async () => {
      mockCreate.mockRejectedValueOnce(
        new APIConnectionTimeoutError({}),
      );

      const provider = createAiProvider({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test',
      });

      const err = await provider
        .getCompletion([{ role: 'user', content: 'Hi' }])
        .catch((e) => e);

      expect(err).toBeInstanceOf(AiProviderError);
      expect((err as AiProviderError).code).toBe('TIMEOUT');
      expect(err.message).toMatch(/timed out/);
    });

    it('wraps APIError as CONNECTION_ERROR with statusCode', async () => {
      mockCreate.mockRejectedValueOnce(
        new APIError(429, { code: 'rate_limit' }, 'Too many requests', undefined),
      );

      const provider = createAiProvider({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test',
      });

      const err = await provider
        .getCompletion([{ role: 'user', content: 'Hi' }])
        .catch((e) => e);

      expect(err).toBeInstanceOf(AiProviderError);
      expect((err as AiProviderError).code).toBe('CONNECTION_ERROR');
      expect((err as AiProviderError).statusCode).toBe(429);
      expect(err.message).toMatch(/429/);
    });

    it('re-throws unknown errors as-is', async () => {
      const nativeError = new Error('Unexpected failure');
      mockCreate.mockRejectedValueOnce(nativeError);

      const provider = createAiProvider({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test',
      });

      const err = await provider
        .getCompletion([{ role: 'user', content: 'Hi' }])
        .catch((e) => e);

      expect(err).not.toBeInstanceOf(AiProviderError);
      expect(err.message).toBe('Unexpected failure');
    });
  });

  describe('observability', () => {
    it('never logs the apiKey in console output', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

      try {
        createAiProvider({
          provider: 'openai',
          model: 'gpt-4o',
          apiKey: 'sk-secret-abc123',
        });

        const logCalls = spy.mock.calls
          .map((args) => args.map(String).join(' '))
          .join('\n');

        expect(logCalls).not.toContain('sk-secret-abc123');
        expect(logCalls).toContain('ai_provider_init');
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('AiProviderError', () => {
    it('has .code, .message, and optional .statusCode', () => {
      const err = new AiProviderError('AUTH_ERROR', 'Bad key', 401);
      expect(err.code).toBe('AUTH_ERROR');
      expect(err.message).toBe('Bad key');
      expect(err.statusCode).toBe(401);
      expect(err.name).toBe('AiProviderError');
      expect(err).toBeInstanceOf(Error);
    });

    it('works without statusCode', () => {
      const err = new AiProviderError('MISSING_CONFIG', 'Config required');
      expect(err.code).toBe('MISSING_CONFIG');
      expect(err.statusCode).toBeUndefined();
      expect(err.message).toBe('Config required');
    });
  });
});
