/**
 * POST /api/daily/[date]/preview-prompt — Build and return the AI prompt
 * without calling the AI provider.
 *
 * This is a lightweight endpoint that returns instantly. The frontend calls
 * this in parallel with /analyze so the user can see the prompt while the
 * AI is still thinking.
 */

import { requireSession, jsonOk, jsonError, getUserTimezone } from "@/lib/api-helpers";
import {
  _validateDate as validateDate,
  _loadAiSettings as loadAiSettings,
  _loadAppContext as loadAppContext,
  _buildPrompt as buildPrompt,
  type CustomPromptSections,
} from "@/app/api/daily/[date]/analyze/route";
import { computeDailyStats } from "@/services/daily-stats";
import { fetchSessionsForDate } from "@/lib/session-queries";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
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

  // Load settings (for custom prompt sections) and sessions in parallel
  const [settings, rows] = await Promise.all([
    loadAiSettings(user.userId),
    fetchSessionsForDate(user.userId, date, tz),
  ]);

  if (rows.length === 0) {
    return jsonError("No sessions found for this date.", 400);
  }

  const stats = computeDailyStats(date, rows);
  const appContext = await loadAppContext(user.userId);

  const customSections: CustomPromptSections = {};
  if (settings.promptSection1) customSections.section1 = settings.promptSection1;
  if (settings.promptSection2) customSections.section2 = settings.promptSection2;
  if (settings.promptSection3) customSections.section3 = settings.promptSection3;
  if (settings.promptSection4) customSections.section4 = settings.promptSection4;

  const prompt = buildPrompt(
    date, stats, appContext, tz,
    Object.keys(customSections).length > 0 ? customSections : undefined,
  );

  return jsonOk({ prompt });
}
