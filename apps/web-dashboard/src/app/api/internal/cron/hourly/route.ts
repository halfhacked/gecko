import { NextResponse } from "next/server";
import { runHourlyTick } from "@/lib/auto-analyze";

// Constant-time string comparison to avoid timing leaks on the Bearer secret.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function POST(req: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on this Worker" },
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!safeEqual(presented, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await runHourlyTick();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[cron/hourly] tick failed:", err);
    return NextResponse.json(
      { error: "tick_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
