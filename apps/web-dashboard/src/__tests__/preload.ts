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

// Mock @nocoo/next-ai/server with stub implementations
const mockResolveAiConfig = (input: Record<string, unknown>) => ({
  provider: input.provider,
  baseURL: input.baseURL ?? "https://api.example.com",
  apiKey: input.apiKey,
  model: input.model ?? "test-model",
  sdkType: input.sdkType ?? "anthropic",
});

mock.module("@nocoo/next-ai/server", () => ({
  resolveAiConfig: mockResolveAiConfig,
  createAiModel: () => "mock-model",
}));
