import { auth } from "@/auth";
import { settingsRepo } from "@/lib/settings-repo";

// Setting keys
const KEY_AUTO_SUMMARIZE = "ai.autoSummarize";
const KEY_EMAIL_ENABLED = "notification.email.enabled";
const KEY_EMAIL_ADDRESS = "notification.email.address";

/**
 * GET /api/settings/notifications
 * Returns notification settings for the current user.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const [autoSummarize, emailEnabled, emailAddress] = await Promise.all([
    settingsRepo.findByKey(userId, KEY_AUTO_SUMMARIZE),
    settingsRepo.findByKey(userId, KEY_EMAIL_ENABLED),
    settingsRepo.findByKey(userId, KEY_EMAIL_ADDRESS),
  ]);

  return Response.json({
    autoSummarize: autoSummarize?.value === "true",
    emailEnabled: emailEnabled?.value === "true",
    emailAddress: emailAddress?.value ?? "",
  });
}

/**
 * PUT /api/settings/notifications
 * Updates notification settings for the current user.
 */
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const body = await req.json();

  // Update autoSummarize if provided
  if (typeof body.autoSummarize === "boolean") {
    await settingsRepo.upsert(userId, KEY_AUTO_SUMMARIZE, String(body.autoSummarize));
  }

  // Update email settings if provided
  if (typeof body.emailEnabled === "boolean") {
    await settingsRepo.upsert(userId, KEY_EMAIL_ENABLED, String(body.emailEnabled));
  }

  if (typeof body.emailAddress === "string") {
    const trimmed = body.emailAddress.trim();
    if (trimmed) {
      await settingsRepo.upsert(userId, KEY_EMAIL_ADDRESS, trimmed);
    } else {
      // Delete if empty
      await settingsRepo.delete(userId, KEY_EMAIL_ADDRESS);
    }
  }

  // Return updated settings
  const [autoSummarize, emailEnabled, emailAddress] = await Promise.all([
    settingsRepo.findByKey(userId, KEY_AUTO_SUMMARIZE),
    settingsRepo.findByKey(userId, KEY_EMAIL_ENABLED),
    settingsRepo.findByKey(userId, KEY_EMAIL_ADDRESS),
  ]);

  return Response.json({
    autoSummarize: autoSummarize?.value === "true",
    emailEnabled: emailEnabled?.value === "true",
    emailAddress: emailAddress?.value ?? "",
  });
}
