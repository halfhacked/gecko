"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { AppShell } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  User,
  Mail,
  Globe,
  Check,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Settings Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { data: session } = useSession();

  return (
    <AppShell breadcrumbs={[{ label: "Settings" }]}>
      <div className="space-y-8 max-w-2xl">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your profile and preferences.
          </p>
        </div>

        {/* Profile section */}
        <ProfileSection session={session} />

        <Separator />

        {/* Timezone section */}
        <TimezoneSection />
      </div>
    </AppShell>
  );
}

// =============================================================================
// Profile Section (read-only, data from Google OAuth)
// =============================================================================

function ProfileSection({
  session,
}: {
  session: ReturnType<typeof useSession>["data"];
}) {
  const user = session?.user;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <User className="size-5 text-muted-foreground" strokeWidth={1.5} />
        <h2 className="text-lg font-semibold">Profile</h2>
      </div>

      <div className="rounded-2xl bg-secondary p-5 space-y-4">
        <div className="flex items-center gap-4">
          {user?.image ? (
            <img
              src={user.image}
              alt="Avatar"
              className="size-14 rounded-full ring-2 ring-border"
            />
          ) : (
            <div className="size-14 rounded-full bg-muted flex items-center justify-center ring-2 ring-border">
              <User className="size-6 text-muted-foreground" />
            </div>
          )}
          <div>
            <p className="font-medium">{user?.name ?? "—"}</p>
            <p className="text-sm text-muted-foreground">
              Managed by Google OAuth
            </p>
          </div>
        </div>

        <Separator />

        <div className="grid gap-3 sm:grid-cols-2">
          <InfoField
            icon={<User className="size-4" />}
            label="Name"
            value={user?.name ?? "—"}
          />
          <InfoField
            icon={<Mail className="size-4" />}
            label="Email"
            value={user?.email ?? "—"}
          />
        </div>
      </div>
    </section>
  );
}

function InfoField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-sm font-medium truncate">{value}</p>
    </div>
  );
}

// =============================================================================
// Timezone Section
// =============================================================================

/** Common IANA timezones — mirrored from lib/timezone.ts for client use. */
const COMMON_TIMEZONES = [
  { value: "Asia/Shanghai", label: "China Standard Time (UTC+8)" },
  { value: "Asia/Tokyo", label: "Japan Standard Time (UTC+9)" },
  { value: "Asia/Seoul", label: "Korea Standard Time (UTC+9)" },
  { value: "Asia/Taipei", label: "Taipei Standard Time (UTC+8)" },
  { value: "Asia/Hong_Kong", label: "Hong Kong Time (UTC+8)" },
  { value: "Asia/Singapore", label: "Singapore Time (UTC+8)" },
  { value: "Asia/Kolkata", label: "India Standard Time (UTC+5:30)" },
  { value: "Asia/Dubai", label: "Gulf Standard Time (UTC+4)" },
  { value: "Europe/London", label: "Greenwich Mean Time (UTC+0/+1)" },
  { value: "Europe/Paris", label: "Central European Time (UTC+1/+2)" },
  { value: "Europe/Berlin", label: "Central European Time (UTC+1/+2)" },
  { value: "Europe/Moscow", label: "Moscow Standard Time (UTC+3)" },
  { value: "America/New_York", label: "Eastern Time (UTC-5/-4)" },
  { value: "America/Chicago", label: "Central Time (UTC-6/-5)" },
  { value: "America/Denver", label: "Mountain Time (UTC-7/-6)" },
  { value: "America/Los_Angeles", label: "Pacific Time (UTC-8/-7)" },
  { value: "America/Anchorage", label: "Alaska Time (UTC-9/-8)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (UTC-10)" },
  { value: "Pacific/Auckland", label: "New Zealand Time (UTC+12/+13)" },
  { value: "Australia/Sydney", label: "Australian Eastern Time (UTC+10/+11)" },
];

function TimezoneSection() {
  const [timezone, setTimezone] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch current timezone on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings/timezone");
        if (res.ok) {
          const data = await res.json();
          setTimezone(data.timezone);
        }
      } catch {
        // Fall back to default
        setTimezone("Asia/Shanghai");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleChange(newTz: string) {
    setTimezone(newTz);
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const res = await fetch("/api/settings/timezone", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: newTz }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save timezone");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save timezone");
    } finally {
      setSaving(false);
    }
  }

  function handleDetect() {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && detected !== timezone) {
      handleChange(detected);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="size-5 text-muted-foreground" strokeWidth={1.5} />
        <h2 className="text-lg font-semibold">Timezone</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        Your timezone determines how daily boundaries are calculated for
        stats, charts, and AI analysis.
      </p>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="rounded-2xl bg-secondary p-5 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="timezone-select">Timezone</Label>
          {loading ? (
            <div className="h-10 rounded-md bg-muted animate-pulse" />
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Select
                  id="timezone-select"
                  value={timezone}
                  onChange={(e) => handleChange(e.target.value)}
                  disabled={saving}
                >
                  {/* If the current timezone isn't in COMMON_TIMEZONES, show it as a custom option */}
                  {!COMMON_TIMEZONES.some((t) => t.value === timezone) && timezone && (
                    <option value={timezone}>{timezone}</option>
                  )}
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDetect}
                disabled={saving}
              >
                Detect
              </Button>
            </div>
          )}
        </div>

        {/* Status */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {saving && <span>Saving...</span>}
          {saved && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <Check className="size-3" /> Saved
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
