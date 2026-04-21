/**
 * Test preload script.
 *
 * Mocks modules that cannot run in the test environment:
 * - server-only: throws at import time in Next.js, needs to be a no-op in tests
 * - @nocoo/next-ai/server: depends on server-only
 */

import { mock } from "bun:test";

// Mock server-only to be a no-op
mock.module("server-only", () => ({}));

// Mock @nocoo/next-ai/server with stub implementations.
// resolveAiConfig can be overridden per-test via __testOverrides.resolveAiConfig.
export const __testOverrides: {
  resolveAiConfig?: ((input: Record<string, unknown>) => unknown) | null;
  generateText?: ((opts: Record<string, unknown>) => Promise<unknown>) | null;
  generateObject?: ((opts: Record<string, unknown>) => Promise<unknown>) | null;
} = {};

const defaultResolveAiConfig = (input: Record<string, unknown>) => ({
  provider: input.provider,
  baseURL: input.baseURL ?? "https://api.example.com",
  apiKey: input.apiKey,
  model: input.model ?? "test-model",
  sdkType: input.sdkType ?? "anthropic",
});

mock.module("@nocoo/next-ai/server", () => ({
  resolveAiConfig: (input: Record<string, unknown>) => {
    const fn = __testOverrides.resolveAiConfig ?? defaultResolveAiConfig;
    return fn(input);
  },
  createAiModel: () => "mock-model",
}));

// Mock the "ai" module's generateText / generateObject so tests can control
// AI responses. NoObjectGeneratedError is mocked with a minimal stand-in that
// supports the isInstance static used by analyze-core's error handling.
class MockNoObjectGeneratedError extends Error {
  readonly text: string | undefined;
  readonly finishReason: string | undefined;
  readonly usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
  constructor(opts: { message?: string; text?: string; finishReason?: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } } = {}) {
    super(opts.message ?? "No object generated");
    this.name = "AI_NoObjectGeneratedError";
    this.text = opts.text;
    this.finishReason = opts.finishReason;
    this.usage = opts.usage;
  }
  static isInstance(err: unknown): err is MockNoObjectGeneratedError {
    return err instanceof MockNoObjectGeneratedError;
  }
}

mock.module("ai", () => ({
  generateText: (opts: Record<string, unknown>) => {
    if (__testOverrides.generateText) {
      return __testOverrides.generateText(opts);
    }
    return Promise.reject(new Error("generateText not mocked"));
  },
  generateObject: (opts: Record<string, unknown>) => {
    if (__testOverrides.generateObject) {
      return __testOverrides.generateObject(opts);
    }
    return Promise.reject(new Error("generateObject not mocked"));
  },
  NoObjectGeneratedError: MockNoObjectGeneratedError,
}));

// Re-export so tests can throw the same error type analyze-core checks for.
export const TestNoObjectGeneratedError = MockNoObjectGeneratedError;
