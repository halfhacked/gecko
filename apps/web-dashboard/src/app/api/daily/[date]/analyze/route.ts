/**
 * POST /api/daily/[date]/analyze — Generate AI analysis for a specific date.
 *
 * Requires AI settings to be configured (provider + apiKey in settings).
 * Sends stats + full session timeline (including URLs/titles) to LLM,
 * expects structured JSON response with score, highlights, improvements,
 * time segments, and summary (Chinese).
 * Caches the result in daily_summaries.
 */

import { requireSession, jsonOk, jsonError, getUserTimezone } from "@/lib/api-helpers";
import { dailySummaryRepo } from "@/lib/daily-summary-repo";
import { settingsRepo } from "@/lib/settings-repo";
import {
  resolveAiConfig,
  createAiClient,
  type AiProvider,
  type SdkType,
} from "@/services/ai";
import { generateText } from "ai";
import {
  computeDailyStats,
  type DailyStats,
  type SessionForChart,
} from "@/services/daily-stats";
import { query } from "@/lib/d1";
import { todayInTz, epochToLocalHHMM } from "@/lib/timezone";
import { fetchSessionsForDate } from "@/lib/session-queries";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimeSegment {
  /** e.g. "09:00-11:30" */
  timeRange: string;
  /** Focus label, e.g. "前端开发" or "文档阅读" */
  label: string;
  /** Short description of what happened in this segment */
  description: string;
}

export interface AiAnalysisResult {
  score: number;
  highlights: string[];
  improvements: string[];
  timeSegments: TimeSegment[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Known idle/system-core bundle IDs that represent idle/lock screen. */
const IDLE_BUNDLE_IDS = new Set([
  "com.apple.loginwindow",
  "com.apple.ScreenSaver.Engine",
  "com.apple.screenCaptureUI",
]);

/** Known browser bundle IDs. */
const BROWSER_BUNDLE_IDS = new Set([
  "com.apple.Safari",
  "com.google.Chrome",
  "org.mozilla.firefox",
  "com.microsoft.edgemac",
  "company.thebrowser.Browser",
  "com.brave.Browser",
  "com.operasoftware.Opera",
  "com.vivaldi.Vivaldi",
  "org.chromium.Chromium",
]);

function validateDate(dateStr: string, tz: string): string | null {
  if (!DATE_RE.test(dateStr)) {
    return "Invalid date format. Use YYYY-MM-DD.";
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  const test = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(test.getTime()) || test.getUTCFullYear() !== y || test.getUTCMonth() !== m - 1 || test.getUTCDate() !== d) {
    return "Invalid date.";
  }
  const today = todayInTz(tz);
  if (dateStr > today) {
    return "Cannot analyze future dates.";
  }
  return null;
}

/** Load AI settings from the settings table. */
async function loadAiSettings(userId: string) {
  const all = await settingsRepo.findByUserId(userId);
  const map = new Map(all.map((s) => [s.key, s.value]));
  return {
    provider: map.get("ai.provider") ?? "",
    apiKey: map.get("ai.apiKey") ?? "",
    model: map.get("ai.model") ?? "",
    baseURL: map.get("ai.baseURL") ?? "",
    sdkType: map.get("ai.sdkType") ?? "",
    promptSection1: map.get("ai.prompt.section1") ?? "",
    promptSection2: map.get("ai.prompt.section2") ?? "",
    promptSection3: map.get("ai.prompt.section3") ?? "",
    promptSection4: map.get("ai.prompt.section4") ?? "",
  };
}

// ---------------------------------------------------------------------------
// App context (categories, tags, notes) for enriching the AI prompt
// ---------------------------------------------------------------------------

/** Per-app context: category, tags, and user note. */
export interface AppContext {
  bundleId: string;
  categoryTitle?: string;
  tags: string[];
  note?: string;
}

/** Load categories, tags, and notes for all apps the user has annotated. */
async function loadAppContext(userId: string): Promise<Map<string, AppContext>> {
  // Run all three queries in parallel
  const [categoryRows, tagRows, noteRows] = await Promise.all([
    query<{ bundle_id: string; title: string }>(
      `SELECT m.bundle_id, c.title
       FROM app_category_mappings m
       JOIN categories c ON c.id = m.category_id
       WHERE m.user_id = ?`,
      [userId],
    ),
    query<{ bundle_id: string; tag_name: string }>(
      `SELECT m.bundle_id, t.name as tag_name
       FROM app_tag_mappings m
       JOIN tags t ON t.id = m.tag_id
       WHERE m.user_id = ?`,
      [userId],
    ),
    query<{ bundle_id: string; note: string }>(
      `SELECT bundle_id, note FROM app_notes WHERE user_id = ?`,
      [userId],
    ),
  ]);

  const map = new Map<string, AppContext>();

  const getOrCreate = (bundleId: string): AppContext => {
    let ctx = map.get(bundleId);
    if (!ctx) {
      ctx = { bundleId, tags: [] };
      map.set(bundleId, ctx);
    }
    return ctx;
  };

  for (const row of categoryRows) {
    getOrCreate(row.bundle_id).categoryTitle = row.title;
  }
  for (const row of tagRows) {
    getOrCreate(row.bundle_id).tags.push(row.tag_name);
  }
  for (const row of noteRows) {
    getOrCreate(row.bundle_id).note = row.note;
  }

  return map;
}

/** Format the app context map into a prompt-friendly string. */
function buildAppContextSection(
  appContext: Map<string, AppContext>,
  bundleIdsInDay: Set<string>,
): string {
  // Only include apps that actually appeared in the day's sessions
  const relevant: AppContext[] = [];
  for (const bundleId of bundleIdsInDay) {
    const ctx = appContext.get(bundleId);
    if (ctx && (ctx.categoryTitle || ctx.tags.length > 0 || ctx.note)) {
      relevant.push(ctx);
    }
  }

  if (relevant.length === 0) return "";

  const lines = relevant.map((ctx) => {
    const parts: string[] = [`- **${ctx.bundleId}**`];
    if (ctx.categoryTitle) parts.push(`分类: ${ctx.categoryTitle}`);
    if (ctx.tags.length > 0) parts.push(`标签: ${ctx.tags.join(", ")}`);
    if (ctx.note) parts.push(`备注: ${ctx.note}`);
    return parts.join(" | ");
  });

  return `\n## 应用上下文（用户标注）
以下是用户对部分应用的分类、标签和备注说明，请结合这些信息来理解每个应用的用途和性质：

${lines.join("\n")}
`;
}

// ---------------------------------------------------------------------------
// Session timeline builder
// ---------------------------------------------------------------------------
/** Format seconds to human-readable duration. */
function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h${rm}min` : `${h}h`;
}

/**
 * Build a detailed session timeline for the prompt.
 * Groups sessions chronologically, marks idle sessions,
 * and includes browser URLs/titles.
 */
function buildSessionTimeline(sessions: SessionForChart[], tz: string): string {
  if (sessions.length === 0) return "(no sessions)";

  const sorted = [...sessions].sort((a, b) => a.startTime - b.startTime);
  const lines: string[] = [];

  for (const s of sorted) {
    const time = epochToLocalHHMM(s.startTime, tz);
    const dur = fmtDuration(s.duration);
    const isIdle = s.bundleId ? IDLE_BUNDLE_IDS.has(s.bundleId) : false;
    const isBrowser = s.bundleId ? BROWSER_BUNDLE_IDS.has(s.bundleId) : false;

    let line = `[${time}] ${s.appName} (${dur})`;
    if (isIdle) {
      line += " [IDLE/锁屏]";
    }
    if (s.windowTitle) {
      line += ` — "${s.windowTitle}"`;
    }
    if (isBrowser && s.url) {
      line += ` | URL: ${s.url}`;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Prompt template: default sections & variable expansion
// ---------------------------------------------------------------------------

import {
  DEFAULT_PROMPT_SECTION_1,
  DEFAULT_PROMPT_SECTION_2,
  DEFAULT_PROMPT_SECTION_3,
  DEFAULT_PROMPT_SECTION_4,
} from "@/services/prompt-defaults";

// Re-export for backwards compatibility (tests import from this module)
export {
  DEFAULT_PROMPT_SECTION_1,
  DEFAULT_PROMPT_SECTION_2,
  DEFAULT_PROMPT_SECTION_3,
  DEFAULT_PROMPT_SECTION_4,
};
export { PROMPT_TEMPLATE_VARIABLES } from "@/services/prompt-defaults";

/** Custom prompt sections supplied by the user (all optional). */
export interface CustomPromptSections {
  section1?: string;
  section2?: string;
  section3?: string;
  section4?: string;
}

/**
 * Expand {{variable}} placeholders in a template string.
 * Only known keys are expanded; unknown placeholders are left as-is.
 */
function expandTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, key: string) => {
    return key in vars ? vars[key]! : match;
  });
}

// Export internal helpers for unit testing
export {
  validateDate as _validateDate,
  loadAiSettings as _loadAiSettings,
  loadAppContext as _loadAppContext,
  buildAppContextSection as _buildAppContextSection,
  fmtDuration as _fmtDuration,
  buildSessionTimeline as _buildSessionTimeline,
  buildPrompt as _buildPrompt,
  parseAiResponse as _parseAiResponse,
  expandTemplate as _expandTemplate,
  IDLE_BUNDLE_IDS as _IDLE_BUNDLE_IDS,
  BROWSER_BUNDLE_IDS as _BROWSER_BUNDLE_IDS,
};
export type { AppContext as _AppContext };

/** Build the analysis prompt from stats data and app context. */
function buildPrompt(
  date: string,
  stats: DailyStats,
  appContext: Map<string, AppContext>,
  tz: string,
  custom?: CustomPromptSections,
): string {
  // --- Compute all template variable values ---
  const topAppsStr = stats.topApps
    .slice(0, 10)
    .map(
      (a, i) =>
        `${i + 1}. ${a.appName} — ${Math.round(a.totalDuration / 60)}min (${a.sessionCount} sessions)`,
    )
    .join("\n");

  const scores = stats.scores;
  const timeline = buildSessionTimeline(stats.sessions, tz);

  const bundleIdsInDay = new Set<string>();
  for (const s of stats.sessions) {
    if (s.bundleId) bundleIdsInDay.add(s.bundleId);
  }
  const appContextSection = buildAppContextSection(appContext, bundleIdsInDay);

  const idleSessions = stats.sessions.filter(
    (s) => s.bundleId && IDLE_BUNDLE_IDS.has(s.bundleId),
  );
  const idleDuration = idleSessions.reduce((sum, s) => sum + s.duration, 0);
  const idleNote = idleDuration > 0
    ? `\n- 闲置/锁屏时间：${Math.round(idleDuration / 60)} 分钟（loginwindow/ScreenSaver 等属于闲置，不应算作有效工作）`
    : "";

  const vars: Record<string, string> = {
    date,
    totalDuration: String(Math.round(stats.totalDuration / 60)),
    totalSessions: String(stats.totalSessions),
    totalApps: String(stats.totalApps),
    activeSpan: String(Math.round(stats.activeSpan / 60)),
    idleNote,
    "scores.focus": String(scores.focus),
    "scores.deepWork": String(scores.deepWork),
    "scores.switchRate": String(scores.switchRate),
    "scores.concentration": String(scores.concentration),
    "scores.overall": String(scores.overall),
    topApps: topAppsStr,
    appContext: appContextSection,
    timeline,
  };

  // --- Resolve each section: custom or default ---
  const s1 = custom?.section1 || DEFAULT_PROMPT_SECTION_1;
  const s2Raw = custom?.section2 || DEFAULT_PROMPT_SECTION_2;
  const s3 = custom?.section3 || DEFAULT_PROMPT_SECTION_3;
  const s4 = custom?.section4 || DEFAULT_PROMPT_SECTION_4;

  // Only Section 2 gets template variable expansion
  const s2 = expandTemplate(s2Raw, vars);

  return [s1, s2, s3, s4].join("\n\n");
}

/** Parse and validate the AI response JSON. */
function parseAiResponse(text: string): AiAnalysisResult {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  const score = Number(parsed.score);
  if (!Number.isFinite(score) || score < 1 || score > 100) {
    throw new Error("AI returned invalid score");
  }

  const highlights = parsed.highlights;
  if (!Array.isArray(highlights) || highlights.length === 0) {
    throw new Error("AI returned invalid highlights");
  }

  const improvements = parsed.improvements;
  if (!Array.isArray(improvements) || improvements.length === 0) {
    throw new Error("AI returned invalid improvements");
  }

  const summary = parsed.summary;
  if (typeof summary !== "string" || summary.length === 0) {
    throw new Error("AI returned invalid summary");
  }

  // Parse timeSegments (optional for backward compat, but validate if present)
  let timeSegments: TimeSegment[] = [];
  if (Array.isArray(parsed.timeSegments) && parsed.timeSegments.length > 0) {
    timeSegments = (parsed.timeSegments as Record<string, unknown>[]).map((seg) => ({
      timeRange: String(seg.timeRange ?? ""),
      label: String(seg.label ?? ""),
      description: String(seg.description ?? ""),
    })).filter((seg) => seg.timeRange && seg.label);
  }

  return {
    score: Math.round(score),
    highlights: highlights.map(String),
    improvements: improvements.map(String),
    timeSegments,
    summary: String(summary),
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(
  req: Request,
  { params }: { params: Promise<{ date: string }> },
): Promise<Response> {
  const { user, error } = await requireSession();
  if (error) return error;

  const tz = await getUserTimezone(user.userId);

  const { date } = await params;
  const validationError = validateDate(date, tz);
  if (validationError) {
    return jsonError(validationError, 400);
  }

  // Support ?force=true to skip cache and regenerate
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";

  // Check if AI result already exists (skip if force=true)
  if (!force) {
    const cached = await dailySummaryRepo.findByUserAndDate(user.userId, date);
    if (cached?.ai_result_json) {
      return jsonOk({
        score: cached.ai_score,
        result: JSON.parse(cached.ai_result_json) as AiAnalysisResult,
        model: cached.ai_model,
        generatedAt: cached.ai_generated_at,
        cached: true,
        // No usage/timing for cached results
        usage: null,
        durationMs: null,
      });
    }
  }

  // Load AI config
  const settings = await loadAiSettings(user.userId);
  if (!settings.provider || !settings.apiKey) {
    return jsonError("AI provider and API key must be configured first.", 400);
  }

  let config;
  try {
    config = resolveAiConfig({
      provider: settings.provider as AiProvider,
      apiKey: settings.apiKey,
      model: settings.model,
      baseURL: settings.baseURL || undefined,
      sdkType: (settings.sdkType || undefined) as SdkType | undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid AI configuration";
    return jsonError(msg, 400);
  }

  // Compute stats fresh from D1 — same pattern as GET /api/daily/:date.
  // Stats are never cached; only AI results are cached in daily_summaries.
  const rows = await fetchSessionsForDate(user.userId, date, tz);
  if (rows.length === 0) {
    return jsonError("No sessions found for this date.", 400);
  }
  const stats = computeDailyStats(date, rows);
  const appContext = await loadAppContext(user.userId);

  // Build custom prompt sections from user settings (empty = use default)
  const customSections: CustomPromptSections = {};
  if (settings.promptSection1) customSections.section1 = settings.promptSection1;
  if (settings.promptSection2) customSections.section2 = settings.promptSection2;
  if (settings.promptSection3) customSections.section3 = settings.promptSection3;
  if (settings.promptSection4) customSections.section4 = settings.promptSection4;

  const prompt = buildPrompt(
    date, stats, appContext, tz,
    Object.keys(customSections).length > 0 ? customSections : undefined,
  );

  let text: string;
  let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;
  let durationMs: number;

  // Step 1: Call AI provider (with 55s timeout to stay under Railway's 60s limit)
  try {
    const client = createAiClient(config);
    const startMs = Date.now();
    const response = await generateText({
      model: client(config.model),
      prompt,
      maxOutputTokens: 4096,
      abortSignal: AbortSignal.timeout(55_000),
    });
    text = response.text;
    usage = response.usage;
    durationMs = Date.now() - startMs;
    console.log(
      `[analyze] AI call succeeded: provider=${config.provider} model=${config.model} duration=${durationMs}ms tokens=${usage?.totalTokens ?? "?"}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    console.error(
      `[analyze] AI provider error: provider=${config.provider} model=${config.model} timeout=${isTimeout} error=${message}`,
    );
    if (isTimeout) {
      return jsonError("AI provider timed out. Try again or use a faster model.", 504);
    }
    return jsonError(`AI provider error: ${message}`, 502);
  }

  // Step 2: Parse AI response
  let result: AiAnalysisResult;
  try {
    result = parseAiResponse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[analyze] Failed to parse AI response: ${message}. Raw text (first 500 chars): ${text.slice(0, 500)}`,
    );
    return jsonError(`Failed to parse AI response: ${message}`, 502);
  }

  // Step 3: Cache result
  try {
    await dailySummaryRepo.upsertAiResult(
      user.userId,
      date,
      result.score,
      JSON.stringify(result),
      config.model,
    );
  } catch (err) {
    // Non-fatal: log but still return the result
    console.error(`[analyze] Failed to cache AI result: ${err instanceof Error ? err.message : err}`);
  }

  return jsonOk({
    score: result.score,
    result,
    model: config.model,
    provider: config.provider,
    generatedAt: new Date().toISOString(),
    cached: false,
    usage: {
      promptTokens: usage?.promptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
    },
    durationMs,
  });
}
