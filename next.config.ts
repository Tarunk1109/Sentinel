import type { NextConfig } from "next";

// Binding the dev server to 0.0.0.0 (for LAN device testing) makes Next's dev-only
// HMR/asset channel treat even 127.0.0.1 as a foreign origin and silently reject it,
// which aborts client hydration with no thrown error - the page looks right but no
// event handler ever attaches. localhost/127.0.0.1 are always allowlisted below; a LAN
// address is added only when explicitly opted in via SENTINEL_DEV_LAN_ORIGIN (set in a
// gitignored .env.local, never committed), so no developer's network address is baked
// into the repo. This only affects Next's own dev-server channel - unrelated to and
// does not touch src/lib/server/http.ts's assertLocalRequest API guard - and
// allowedDevOrigins has no effect outside `next dev` (not consulted by `next start`).
const devLanOrigin = process.env.SENTINEL_DEV_LAN_ORIGIN?.trim();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  turbopack: { root: process.cwd() },
  allowedDevOrigins: devLanOrigin ? ["127.0.0.1", "localhost", devLanOrigin] : ["127.0.0.1", "localhost"],
};

export default nextConfig;
