/**
 * Server instrumentation — runs once on server startup.
 *
 * On Bun/Node servers (e.g. Railway), this is the correct place for
 * process-level initialization (such as setInterval-based schedulers).
 * On Cloudflare Workers there is no long-running process between requests,
 * so periodic work must be moved to a separate Cron-Triggered Worker.
 */

import { ensureAutoAnalyze } from "@/lib/auto-analyze";

function isCloudflareWorker(): boolean {
  return typeof globalThis !== "undefined" && "WebSocketPair" in globalThis;
}

export function register(): void {
  if (isCloudflareWorker()) {
    // TODO: replace setInterval-based HourlyScheduler with a Cron-Triggered
    // Worker that posts to /api/internal/hourly-tick.
    return;
  }
  ensureAutoAnalyze();
}
