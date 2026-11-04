/**
 * Local-dev mesh for webhooks. Plain `next dev` has no Cloudflare runtime, so
 * there are no Durable Objects — but the REAL WebhookInbox class runs here
 * against an in-memory storage shim, one instance per name. Same code path as
 * production; state is per dev-server process (lost on restart, like the
 * share store's dev fallback). Never used in production: without a binding
 * the routes fail loudly (503) instead of silently forking state.
 */
import { WebhookInbox, type WebhookStorage } from "../../durable-objects/webhook-inbox";
import type { WebhookInboxNamespace, WebhookInboxStub } from "../../durable-objects/binding";

function memoryStorage(): WebhookStorage {
  const kv = new Map<string, unknown>();
  return {
    async get(key: string | string[]) {
      if (Array.isArray(key)) {
        const m = new Map<string, unknown>();
        for (const k of key) {
          if (kv.has(k)) m.set(k, kv.get(k));
        }
        return m as never;
      }
      return kv.get(key) as never;
    },
    async put(key: string, value: unknown) {
      kv.set(key, value);
    },
    async delete(key: string | string[]) {
      if (Array.isArray(key)) {
        let n = 0;
        for (const k of key) {
          if (kv.delete(k)) n += 1;
        }
        return n;
      }
      return kv.delete(key);
    },
    async deleteAll() {
      kv.clear();
    },
    async setAlarm() {
      /* no timers in dev: TTL is enforced lazily via alarm() per call */
    },
  };
}

const mesh = new Map<string, WebhookInbox>();
/** Scheduled alarm per instance - mirrors production, where the runtime only
 *  fires alarms that were actually scheduled. Owner-index DOs never schedule
 *  one, so their registry is never swept. */
const alarms = new Map<string, number>();

export function devNamespace(): WebhookInboxNamespace {
  return {
    getByName(name: string): WebhookInboxStub {
      let inbox = mesh.get(name);
      if (!inbox) {
        const base = memoryStorage();
        const storage: WebhookStorage = {
          ...base,
          async setAlarm(when: number | Date) {
            alarms.set(name, new Date(when).getTime());
          },
        };
        inbox = new WebhookInbox({ storage, id: { name } });
        mesh.set(name, inbox);
      }
      const inst = inbox;
      return {
        async fetch(input: Request): Promise<Response> {
          const due = alarms.get(name);
          if (due !== undefined && Date.now() > due) {
            alarms.delete(name);
            await inst.alarm().catch(() => {});
          }
          return inst.fetch(input);
        },
      };
    },
  };
}
