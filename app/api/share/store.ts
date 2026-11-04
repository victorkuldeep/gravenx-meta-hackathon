import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Share backing store behind one host-agnostic shape. Routes never change
 * per host - each deployment target plugs in here:
 * 1. Cloudflare KV binding (production on Workers/Pages).
 * 2. Future hosts (e.g. Upstash Redis on Vercel) implement ShareKV.
 * 3. Local dev fallback: ephemeral in-memory store with identical TTL
 *    semantics. Never prod: production without a binding must fail loudly
 *    (503), not silently store shares in a single-worker's memory.
 */

export const SHARE_TTL_SECONDS = 1800;

export interface ShareKV {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export async function shareKv(): Promise<ShareKV | null> {
  try {
    const { env } = await getCloudflareContext();
    const kv = (env as unknown as { SHARE_KV?: ShareKV }).SHARE_KV;
    if (kv) return kv;
  } catch {
    /* not on Cloudflare - fall through */
  }
  if (process.env.NODE_ENV !== "production") return memoryKv();
  return null;
}

// Dev-only backing store. Same contract as KV: put with TTL, lazy expiry on
// read plus timer sweep. Single dev-server process = shared instance.
const memStore = new Map<string, { value: string; expiresAt: number }>();

function memoryKv(): ShareKV {
  return {
    async get(key: string, type: "json") {
      void type;
      const entry = memStore.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        memStore.delete(key);
        return null;
      }
      try {
        return JSON.parse(entry.value) as unknown;
      } catch {
        return null;
      }
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      const ttlMs = (opts?.expirationTtl ?? SHARE_TTL_SECONDS) * 1000;
      memStore.set(key, { value, expiresAt: Date.now() + ttlMs });
      const timer = setTimeout(() => {
        if ((memStore.get(key)?.expiresAt ?? 0) <= Date.now()) memStore.delete(key);
      }, ttlMs);
      (timer as unknown as { unref?: () => void }).unref?.();
    },
  };
}
