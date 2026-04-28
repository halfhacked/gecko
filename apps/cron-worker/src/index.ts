/**
 * gecko-cron — fires the hourly auto-analyze tick on the dashboard Worker.
 *
 * The dashboard runs on Cloudflare Workers via @opennextjs/cloudflare; that
 * runtime has no long-lived process to drive setInterval-based scheduling.
 * This Worker is a tiny shim: Cloudflare fires `scheduled` per the cron
 * trigger, we POST to the dashboard's internal cron route with a shared
 * secret, and the dashboard runs the tick.
 */

interface Env {
  TARGET_URL: string;
  CRON_SECRET: string;
}

export default {
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (!env.CRON_SECRET) {
      console.error("[gecko-cron] CRON_SECRET not configured — skipping tick");
      return;
    }

    const start = Date.now();
    const fire = (async () => {
      try {
        const res = await fetch(env.TARGET_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.CRON_SECRET}`,
            "User-Agent": "gecko-cron/1.0",
          },
        });
        const elapsed = Date.now() - start;
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.error(
            `[gecko-cron] tick failed: ${res.status} ${res.statusText} after ${elapsed}ms — ${body.slice(0, 500)}`,
          );
          return;
        }
        console.log(`[gecko-cron] tick ok in ${elapsed}ms`);
      } catch (err) {
        console.error(
          "[gecko-cron] tick threw:",
          err instanceof Error ? err.message : err,
        );
      }
    })();

    // waitUntil keeps the Worker alive past the synchronous return so the
    // dashboard tick (which can take a while — DB queries, AI calls) finishes.
    ctx.waitUntil(fire);
  },
} satisfies ExportedHandler<Env>;
