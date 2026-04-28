// API key generation and hashing utilities for macOS app authentication.
// Keys use format: gk_<64 hex chars> (32 random bytes).
// Only the SHA-256 hash is stored server-side.
//
// Uses the Web Crypto API (available in Node, workerd, and Edge runtimes)
// instead of node:crypto so this module can be imported from any runtime.

export const API_KEY_PREFIX = "gk_";

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Generate a new API key: gk_ + 32 random bytes as hex. */
export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return API_KEY_PREFIX + bytesToHex(bytes);
}

/** Compute SHA-256 hash of an API key. Returns lowercase hex string. */
export async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}
