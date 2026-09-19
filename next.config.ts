import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  turbopack: { root: process.cwd() },
  // Binding the dev server to 0.0.0.0 (for LAN device testing) makes Next's dev-only
  // HMR/asset channel treat even 127.0.0.1 as a foreign origin and silently reject it,
  // which aborts client hydration with no thrown error - the page looks right but no
  // event handler ever attaches. This only allowlists Next's own dev-server channel
  // (unrelated to src/lib/server/http.ts's assertLocalRequest API guard) and has no
  // effect outside `next dev`.
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.2.98"],
};

export default nextConfig;
