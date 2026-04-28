import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// initOpenNextCloudflareForDev() simulates a workerd environment under
// `next dev`, but the simulator does not respect compatibility_flags from
// wrangler.jsonc (e.g. nodejs_compat), causing `node:crypto` and friends to
// fail to load. The D1 binding lookup in src/lib/d1.ts is already gated on
// a real-workerd globalThis check, so next dev / E2E don't need binding
// access. Skip the init unless explicitly opted in via OPEN_NEXT_DEV=1.
if (process.env.OPEN_NEXT_DEV === "1") {
  initOpenNextCloudflareForDev();
}

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
