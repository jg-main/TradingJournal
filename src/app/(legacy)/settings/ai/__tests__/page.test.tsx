/**
 * Characterization tests for the AI Settings page (M004 Task 16).
 *
 * AI Settings is migrated onto SettingsChildPage with all configuration and
 * Prompt Preview behavior preserved. These tests pin the structural adoption
 * plus the frozen contracts: initial load, provider defaults/change,
 * endpoint visibility, API-key safety, the exact save payload, the delayed
 * redirect, and the Prompt Preview request mapping.
 *
 * Run: npx vitest run "src/app/(legacy)/settings/ai/__tests__/page.test.tsx"
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ComponentType } from 'react';

let AiPage: ComponentType;

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));

// HelpTooltip wraps Radix tooltip internals — render nothing at this boundary.
vi.mock('@/components/help-tooltip', () => ({
  HelpTooltip: () => null,
}));

beforeAll(async () => {
  const mod = await import('@/app/(legacy)/settings/ai/page');
  AiPage = mod.default;
});

// ── Fixtures ────────────────────────────────────────────────────────────

const PERSISTED = {
  id: 'ai-1',
  provider: 'openai',
  model: 'gpt-4',
  baseUrl: null,
  timeoutMs: 30000,
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: 'You are a trading assistant.',
  isActive: 1,
  // An apiKey-like field MUST NOT populate the form (never expose persisted secrets).
  apiKey: 'sk-should-never-render',
};

type FetchCall = { url: string; method: string; body?: string };

function installRouter(
  routes: Record<string, unknown>,
  calls: FetchCall[] = [],
): { calls: FetchCall[]; fn: ReturnType<typeof vi.fn> } {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    if (!(key in routes)) throw new Error(`unmocked: ${key}`);
    return { ok: true, json: () => Promise.resolve(routes[key]) } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mockPush.mockClear();
  cleanup();
});

/** The API-key input, disambiguated from the show/hide button's aria-label. */
function apiKeyInput(): HTMLInputElement {
  return document.getElementById('apiKey') as HTMLInputElement;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('AI Settings page (SettingsChildPage adoption)', () => {
  it('keeps Back, title, description, and loading text during initial loading, hiding the form', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = render(<AiPage />);

    expect(screen.getByText('Back to Settings')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'AI Settings' })).toBeTruthy();
    expect(screen.getByText('Configure AI model providers for trade analysis and grading.')).toBeTruthy();
    expect(container.textContent).toContain('Loading AI settings...');

    expect(screen.queryByLabelText('Provider')).toBeNull();
    expect(screen.queryByText('Prompt Preview')).toBeNull();
    expect(screen.queryByText('Save AI Settings')).toBeNull();
  });

  it('acquires GET /api/ai-settings and populates the loaded persisted settings', async () => {
    const { calls } = installRouter({ 'GET /api/ai-settings': PERSISTED });
    render(<AiPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Model')).toBeTruthy();
    });

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/ai-settings']);

    expect((screen.getByLabelText('Provider') as HTMLSelectElement).value).toBe('openai');
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('gpt-4');
    expect((screen.getByLabelText('Timeout (ms)') as HTMLInputElement).value).toBe('30000');
    expect((screen.getByLabelText('Max Tokens') as HTMLInputElement).value).toBe('4096');
    expect((screen.getByLabelText(/System Prompt/i) as HTMLTextAreaElement).value).toBe(
      'You are a trading assistant.',
    );
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('never populates the API key field even when the response contains an apiKey-like field', async () => {
    installRouter({ 'GET /api/ai-settings': PERSISTED });
    render(<AiPage />);

    await waitFor(() => {
      expect(apiKeyInput()).toBeTruthy();
    });
    expect(apiKeyInput().value).toBe('');
  });

  it('applies OpenAI defaults when no settings row exists', async () => {
    installRouter({ 'GET /api/ai-settings': { message: 'No AI settings configured yet.' } });
    render(<AiPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Provider')).toBeTruthy();
    });
    expect((screen.getByLabelText('Provider') as HTMLSelectElement).value).toBe('openai');
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('gpt-4');
  });

  it('shows Endpoint URL only for ollama/custom and keeps the model on provider change', async () => {
    installRouter({ 'GET /api/ai-settings': PERSISTED });
    const user = userEvent.setup();
    render(<AiPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Provider')).toBeTruthy();
    });
    // openai → no endpoint field.
    expect(screen.queryByLabelText('Endpoint URL')).toBeNull();

    // Switch to ollama → endpoint appears; the user's model is preserved.
    await user.selectOptions(screen.getByLabelText('Provider'), 'ollama');
    expect(screen.getByLabelText('Endpoint URL')).toBeTruthy();
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('gpt-4');
    expect((screen.getByLabelText('Endpoint URL') as HTMLInputElement).value).toBe(
      'http://localhost:11434/v1',
    );

    // Switch back to openai → endpoint hides again.
    await user.selectOptions(screen.getByLabelText('Provider'), 'openai');
    expect(screen.queryByLabelText('Endpoint URL')).toBeNull();
  });

  it('points Back to Settings and sets the document title', async () => {
    installRouter({ 'GET /api/ai-settings': PERSISTED });
    render(<AiPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Provider')).toBeTruthy();
    });
    expect(screen.getByRole('link', { name: /back to settings/i }).getAttribute('href')).toBe('/settings');
    expect(document.title).toBe('AI Settings — Trading Journal');
  });

  it('renders Save AI Settings through the shared Button primitive (M004 micro-fix)', async () => {
    installRouter({ 'GET /api/ai-settings': PERSISTED }, []);
    render(<AiPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Model')).toBeTruthy();
    });
    const save = screen.getByRole('button', { name: /save ai settings/i });
    expect(save.getAttribute('data-slot')).toBe('button');
    expect(save.getAttribute('data-variant')).toBe('default');
  });

  it('builds the frozen OpenAI save payload (no baseUrl/apiKey/systemPrompt when empty)', async () => {
    const calls: FetchCall[] = [];
    installRouter(
      { 'GET /api/ai-settings': PERSISTED, 'PUT /api/ai-settings': { ...PERSISTED, systemPrompt: null } },
      calls,
    );
    const user = userEvent.setup();
    render(<AiPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Model')).toBeTruthy();
    });

    // Clear systemPrompt and apiKey so they must be omitted.
    await user.clear(screen.getByLabelText(/System Prompt/i));
    await user.click(screen.getByText('Save AI Settings'));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PUT')).toBe(true);
    });

    const put = calls.find((c) => c.method === 'PUT');
    const body = JSON.parse(put!.body!);
    expect(body).toMatchObject({
      provider: 'openai',
      model: 'gpt-4',
      timeoutMs: 30000,
      temperature: 0.7,
      maxTokens: 4096,
      isActive: true,
    });
    expect(body).not.toHaveProperty('baseUrl');
    expect(body).not.toHaveProperty('apiKey');
    expect(body).not.toHaveProperty('systemPrompt');
  });

  it('includes apiKey when entered and baseUrl for endpoint providers', async () => {
    const calls: FetchCall[] = [];
    installRouter(
      { 'GET /api/ai-settings': PERSISTED, 'PUT /api/ai-settings': { ...PERSISTED } },
      calls,
    );
    const user = userEvent.setup();
    render(<AiPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Provider')).toBeTruthy();
    });

    await user.selectOptions(screen.getByLabelText('Provider'), 'ollama');
    await user.type(apiKeyInput(), 'sk-test-key');
    await user.click(screen.getByText('Save AI Settings'));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PUT')).toBe(true);
    });

    const body = JSON.parse(calls.find((c) => c.method === 'PUT')!.body!);
    expect(body.apiKey).toBe('sk-test-key');
    expect(body.baseUrl).toBe('http://localhost:11434/v1');
    expect(body.provider).toBe('ollama');
  });

  it('clears the API key, shows success, and redirects to /settings after 1200ms', async () => {
    vi.useFakeTimers();
    const calls: FetchCall[] = [];
    installRouter(
      { 'GET /api/ai-settings': PERSISTED, 'PUT /api/ai-settings': { ...PERSISTED } },
      calls,
    );
    render(<AiPage />);

    // Flush the initial GET via microtasks (fetch is not timer-based).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.change(apiKeyInput(), { target: { value: 'sk-test' } });
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(/AI settings saved/i)).toBeTruthy();
    expect(apiKeyInput().value).toBe('');

    expect(mockPush).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });

  it('Pre-Trade Assessment posts ai_quality with the current systemPrompt and renders the result', async () => {
    const calls: FetchCall[] = [];
    installRouter(
      {
        'GET /api/ai-settings': PERSISTED,
        'POST /api/ai-settings/prompt-preview': {
          sectionCount: 3,
          totalChars: 120,
          systemMessage: 'SYS MSG',
          userMessage: 'USR MSG',
        },
      },
      calls,
    );
    const user = userEvent.setup();
    render(<AiPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Model')).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /pre-trade assessment/i }));

    await waitFor(() => {
      expect(screen.getByText('3 sections')).toBeTruthy();
    });

    const previewCall = calls.find(
      (c) => c.method === 'POST' && c.url === '/api/ai-settings/prompt-preview',
    );
    expect(JSON.parse(previewCall!.body!)).toEqual({
      assessmentType: 'ai_quality',
      systemPrompt: PERSISTED.systemPrompt,
    });
    expect(screen.getByText('SYS MSG')).toBeTruthy();
    expect(screen.getByText('USR MSG')).toBeTruthy();
    expect(screen.getByText('120 characters')).toBeTruthy();
  });

  it('After-Exit Assessment posts ai_review', async () => {
    const calls: FetchCall[] = [];
    installRouter(
      {
        'GET /api/ai-settings': PERSISTED,
        'POST /api/ai-settings/prompt-preview': { sectionCount: 2, totalChars: 80, systemMessage: 'S', userMessage: 'U' },
      },
      calls,
    );
    const user = userEvent.setup();
    render(<AiPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Model')).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /after-exit assessment/i }));

    await waitFor(() => {
      expect(screen.getByText('2 sections')).toBeTruthy();
    });

    const previewCall = calls.find(
      (c) => c.method === 'POST' && c.url === '/api/ai-settings/prompt-preview',
    );
    expect(JSON.parse(previewCall!.body!).assessmentType).toBe('ai_review');
  });
});
