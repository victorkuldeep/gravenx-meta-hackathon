import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Base CSP - tight by default. Note: we keep 'unsafe-inline' on script-src
// because Next.js inlines small bootstrap scripts in production. 'unsafe-eval'
// is NOT enabled in production.
const cspDirectives = [
  "default-src 'self'",
  // Dev needs unsafe-eval for React Refresh / webpack HMR runtime.
  // Prod does not.
  isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // libraries.excalidraw.com: user-initiated Draw+ library installs only.
// The hook fetches the chosen .excalidrawlib on explicit "Add" - nothing
// else contacts this host. Matches DrawCanvas validateLibraryUrl.
  "connect-src 'self' https://*.salesforce.com https://*.force.com https://*.cloudforce.com https://libraries.excalidraw.com ws: wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

const securityHeaders = [
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Content-Security-Policy",
    value: cspDirectives.join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
