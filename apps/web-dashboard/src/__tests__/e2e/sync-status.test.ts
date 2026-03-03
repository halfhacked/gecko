// E2E: Sync status — verify /api/sync/status reports last sync per device.
//
// Runs against the dev:e2e server (port 17028, E2E_SKIP_AUTH=true).
// IMPORTANT: Skipped unless RUN_E2E=true.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn, type Subprocess } from "bun";

// ---------------------------------------------------------------------------
// Skip guard — only run when explicitly requested
// ---------------------------------------------------------------------------

const SHOULD_RUN = process.env.RUN_E2E === "true";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = "http://localhost:17028";
const STARTUP_TIMEOUT_MS = 30_000;
const DRAIN_WAIT_MS = 4_000;

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: Subprocess | null = null;

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status > 0) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

beforeAll(async () => {
  if (!SHOULD_RUN) return;

  try {
    const res = await fetch(`${BASE_URL}/api/live`);
    if (res.status > 0) {
      console.log("[E2E] Server already running on port 17028");
      return;
    }
  } catch {
    // Not running — start it
  }

  console.log("[E2E] Starting dev:e2e server...");
  server = spawn({
    cmd: ["bun", "run", "dev:e2e"],
    cwd: import.meta.dir + "/../..",
    stdout: "ignore",
    stderr: "ignore",
  });

  await waitForServer(`${BASE_URL}/api/live`, STARTUP_TIMEOUT_MS);
  console.log("[E2E] Server ready.");
}, STARTUP_TIMEOUT_MS + 5_000);

afterAll(() => {
  if (server) {
    console.log("[E2E] Shutting down server...");
    server.kill();
    server = null;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const api = (path: string, init?: RequestInit) =>
  fetch(`${BASE_URL}${path}`, init);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Sync Status E2E", () => {
  // GIVEN: seed a sync so there's at least one sync log entry
  beforeAll(async () => {
    if (!SHOULD_RUN) return;

    const now = Math.floor(Date.now() / 1000);
    const res = await api("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessions: [
          {
            app_name: "Finder",
            bundle_id: "com.apple.finder",
            start_time: now - 120,
            duration: 120,
            title: "Home",
          },
        ],
      }),
    });
    expect(res.status).toBe(202);

    // Wait for queue drain so sync_logs is populated
    await new Promise((r) => setTimeout(r, DRAIN_WAIT_MS));
  });

  test.skipIf(!SHOULD_RUN)(
    "GET /api/sync/status returns devices array",
    async () => {
      const res = await api("/api/sync/status");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty("devices");
      expect(Array.isArray(body.devices)).toBe(true);
    },
  );

  test.skipIf(!SHOULD_RUN)(
    "each device entry has expected fields",
    async () => {
      const res = await api("/api/sync/status");
      const body = await res.json();

      // There should be at least one device after our sync
      expect(body.devices.length).toBeGreaterThanOrEqual(1);

      const device = body.devices[0];
      expect(device).toHaveProperty("deviceId");
      expect(device).toHaveProperty("name");
      expect(device).toHaveProperty("lastSync");
      expect(device).toHaveProperty("sessionCount");
      expect(typeof device.deviceId).toBe("string");
      expect(typeof device.lastSync).toBe("string");
      expect(typeof device.sessionCount).toBe("number");
    },
  );
});
