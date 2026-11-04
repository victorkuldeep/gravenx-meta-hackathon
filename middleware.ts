import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * In-memory rate limiter for the /api/salesforce proxy.
 * - 200 requests per minute per IP.
 * - Sliding window approximation via timestamps ring.
 * - Tracked by IP from x-forwarded-for / x-real-ip / remoteAddr.
 *
 * In a Cloudflare deployment, prefer Workers Rate Limiting bindings. This
 * middleware is the portable safety net for any deployment target.
 */
type Bucket = number[];
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 200;

const buckets = new Map<string, Bucket>();

function getClientKey(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "anonymous"
  );
}

function prune(bucket: Bucket, now: number): void {
  while (bucket.length > 0 && now - bucket[0] > WINDOW_MS) bucket.shift();
}

export function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/salesforce/")) {
    return NextResponse.next();
  }

  const key = getClientKey(req);
  const now = Date.now();
  const bucket = buckets.get(key) ?? [];
  prune(bucket, now);

  if (bucket.length >= MAX_PER_WINDOW) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - bucket[0])) / 1000);
    return new NextResponse(
      JSON.stringify({
        error: `Rate limit exceeded. Try again in ${retryAfter}s.`,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
        },
      }
    );
  }

  bucket.push(now);
  buckets.set(key, bucket);

  // Soft cap on in-memory bucket map to avoid unbounded growth in long-lived
  // edge workers (proxies rotate IPs constantly).
  if (buckets.size > 5000) {
    const firstKey = buckets.keys().next().value;
    if (firstKey) buckets.delete(firstKey);
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/salesforce/:path*",
};
