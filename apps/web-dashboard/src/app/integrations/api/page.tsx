"use client";

import { useState, useEffect, useCallback } from "react";
import { AppShell } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Copy,
  Check,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  Key,
  Globe,
  Pencil,
  Play,
} from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface ApiKey {
  id: string;
  name: string;
  deviceId: string;
  createdAt: string;
  lastUsed: string | null;
}

// =============================================================================
// Clipboard helper
// =============================================================================

function useCopyToClipboard() {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = useCallback(async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  return { copiedId, copy };
}

// =============================================================================
// API Endpoint Section
// =============================================================================

function EndpointSection() {
  const { copiedId, copy } = useCopyToClipboard();

  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "";

  const endpoint = `${baseUrl}/api/v1/snapshot?date=YYYY-MM-DD`;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="size-5 text-muted-foreground" strokeWidth={1.5} />
        <h2 className="text-lg font-semibold">Endpoints</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        Use these endpoints to access your Gecko data programmatically.
        All requests require a valid API key in the Authorization header.
      </p>

      <div className="rounded-2xl bg-secondary p-5 space-y-3">
        <div className="space-y-2">
          <Label>Daily Snapshot</Label>
          <p className="text-xs text-muted-foreground">
            Returns the full daily snapshot including stats, scores, sessions, and AI analysis for a given date.
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center rounded-lg bg-background ring-1 ring-border overflow-hidden">
              <span className="shrink-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2.5 py-2 text-xs font-mono font-semibold">
                GET
              </span>
              <code className="flex-1 px-3 py-2 text-xs font-mono break-all select-all">
                {endpoint}
              </code>
            </div>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => copy(endpoint, "endpoint")}
            >
              {copiedId === "endpoint" ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>
        </div>

        <div className="space-y-2 pt-2">
          <Label>Authentication</Label>
          <div className="flex items-center rounded-lg bg-background ring-1 ring-border overflow-hidden">
            <code className="px-3 py-2 text-xs font-mono text-muted-foreground">
              Authorization: Bearer gk_your_api_key
            </code>
          </div>
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// API Keys Section
// =============================================================================

function ApiKeysSection({
  keys,
  loading,
  onRefresh,
}: {
  keys: ApiKey[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copiedId, copy } = useCopyToClipboard();

  // Rename state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to create key");
      }

      const data = await res.json();
      setRevealedKey(data.key);
      setNewKeyName("");
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRename(id: string) {
    if (!editName.trim()) return;
    setRenaming(true);

    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to rename key");
      }

      setEditingId(null);
      setEditName("");
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename key");
    } finally {
      setRenaming(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    try {
      const res = await fetch(`/api/keys/${deleteTarget.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to delete key");
      }

      setDeleteTarget(null);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete key");
    } finally {
      setDeleting(false);
    }
  }

  function startEditing(key: ApiKey) {
    setEditingId(key.id);
    setEditName(key.name);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditName("");
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Key className="size-5 text-muted-foreground" strokeWidth={1.5} />
        <h2 className="text-lg font-semibold">API Keys</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        Create and manage API keys for authenticating requests.
        Keys are shown only once when created — store them securely.
      </p>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Create new key */}
      <div className="rounded-2xl bg-secondary p-5 space-y-4">
        <Label>Create New Key</Label>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Key name (e.g. Shortcuts, n8n)"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            disabled={creating}
          />
          <Button
            onClick={handleCreate}
            disabled={creating || !newKeyName.trim()}
            size="sm"
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Create
          </Button>
        </div>
      </div>

      {/* Key list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-16 rounded-xl bg-muted animate-pulse"
            />
          ))}
        </div>
      ) : keys.length === 0 ? (
        <div className="rounded-xl border border-dashed py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No API keys yet. Create one to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center gap-3 rounded-xl bg-background px-4 py-3 ring-1 ring-border"
            >
              <Key className="size-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                {editingId === k.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(k.id);
                        if (e.key === "Escape") cancelEditing();
                      }}
                      className="h-7 text-sm"
                      autoFocus
                      disabled={renaming}
                    />
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => handleRename(k.id)}
                      disabled={renaming || !editName.trim()}
                    >
                      {renaming ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Check className="size-3" />
                      )}
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium truncate">{k.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Created {formatRelativeTime(k.createdAt)}
                      {k.lastUsed && (
                        <span className="ml-2">
                          · Last used {formatRelativeTime(k.lastUsed)}
                        </span>
                      )}
                    </p>
                  </>
                )}
              </div>
              {editingId !== k.id && (
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => startEditing(k)}
                    title="Rename"
                  >
                    <Pencil className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setDeleteTarget(k)}
                    title="Delete"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Revealed key dialog (shown once after creation) */}
      <Dialog
        open={!!revealedKey}
        onOpenChange={(open) => !open && setRevealedKey(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
            <DialogDescription>
              Copy your API key now. You won&apos;t be able to see it again.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 py-2">
            <code className="flex-1 rounded-lg bg-secondary px-3 py-2 text-xs font-mono break-all select-all">
              {revealedKey}
            </code>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() =>
                revealedKey && copy(revealedKey, "revealed-key")
              }
            >
              {copiedId === "revealed-key" ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>

          <DialogFooter>
            <Button onClick={() => setRevealedKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete API Key</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}
              &rdquo;? Any integrations using this key will stop working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// =============================================================================
// API Test Section
// =============================================================================

function TestSection({ keys }: { keys: ApiKey[] }) {
  const [selectedDate, setSelectedDate] = useState(
    () => new Date().toISOString().split("T")[0],
  );
  const [selectedKeyId, setSelectedKeyId] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{
    status: number;
    body: unknown;
    durationMs: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copiedId, copy } = useCopyToClipboard();

  // Auto-select first key when keys load
  useEffect(() => {
    if (keys.length > 0 && !selectedKeyId) {
      setSelectedKeyId(keys[0].id);
    }
  }, [keys, selectedKeyId]);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    setError(null);

    try {
      const start = performance.now();
      const res = await fetch(
        `/api/v1/snapshot?date=${selectedDate}`,
      );
      const durationMs = Math.round(performance.now() - start);

      const body = await res.json();
      setResult({ status: res.status, body, durationMs });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Request failed",
      );
    } finally {
      setTesting(false);
    }
  }

  const resultJson = result ? JSON.stringify(result.body, null, 2) : null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Play className="size-5 text-muted-foreground" strokeWidth={1.5} />
        <h2 className="text-lg font-semibold">Test API</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        Test the snapshot API with your current session. The request uses your
        dashboard session for auth so no API key is needed here.
      </p>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="rounded-2xl bg-secondary p-5 space-y-4">
        <div className="flex items-end gap-3">
          <div className="space-y-2 flex-1">
            <Label htmlFor="test-date">Date</Label>
            <Input
              id="test-date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          <Button
            onClick={handleTest}
            disabled={testing || !selectedDate}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            Send Request
          </Button>
        </div>

        {result && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span
                className={`rounded px-2 py-0.5 text-xs font-mono font-semibold ${
                  result.status >= 200 && result.status < 300
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {result.status}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {result.durationMs}ms
              </span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() =>
                  resultJson && copy(resultJson, "test-result")
                }
                className="ml-auto"
              >
                {copiedId === "test-result" ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
                Copy
              </Button>
            </div>
            <pre className="max-h-80 overflow-auto rounded-lg bg-background p-3 text-xs font-mono ring-1 ring-border">
              {resultJson}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString();
}

// =============================================================================
// Main Page
// =============================================================================

export default function ApiPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/keys");
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys ?? []);
      }
    } catch {
      // Silently handle — UI will show empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  return (
    <AppShell
      breadcrumbs={[
        { label: "Integrations" },
        { label: "API" },
      ]}
    >
      <div className="space-y-8 max-w-2xl">
        <div>
          <h1 className="text-2xl font-semibold">API</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Access your Gecko data programmatically. Manage API keys and test
            endpoints.
          </p>
        </div>

        <EndpointSection />

        <Separator />

        <ApiKeysSection
          keys={keys}
          loading={loading}
          onRefresh={fetchKeys}
        />

        <Separator />

        <TestSection keys={keys} />
      </div>
    </AppShell>
  );
}
