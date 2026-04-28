/**
 * Server instrumentation — runs once on server startup.
 *
 * Vinext (Next.js on Vite) auto-discovers this file and calls register()
 * before any request is handled. This is the correct place for process-level
 * initialization that must not depend on a specific route being visited.
 */

import { ensureAutoAnalyze } from "@/lib/auto-analyze";

export function register(): void {
  ensureAutoAnalyze();
}
