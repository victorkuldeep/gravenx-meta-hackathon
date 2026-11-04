import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_NAME } from "./db";

/**
 * Real-IndexedDB exercises for the missing-store self-heal (lib/db.ts).
 * These run against fake-indexeddb, not happy-dom's absent IDB, so the
 * upgrade/heal/retry paths execute for real. File order matters: the heal
 * test leaves a v34 database + pin that the reload test reuses.
 */

const PIN_KEY = "gravenx_idb_version";

function openDbAt(version: number, stores: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => {
      for (const name of stores) {
        if (!req.result.objectStoreNames.contains(name)) {
          req.result.createObjectStore(name, { keyPath: "id" });
        }
      }
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error ?? new Error("manual open failed"));
    req.onblocked = () => reject(new Error("manual open blocked"));
  });
}

function deleteDb(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("delete failed"));
    req.onblocked = () => reject(new Error("delete blocked"));
  });
}

const SESSION_ROW = {
  id: "dbg_heal",
  orgKey: "org:test",
  title: "heal probe",
  problem: "",
  status: "open",
  logs: [],
  executions: [],
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  vi.resetModules();
});

describe("missing-store self-heal", () => {
  it("recreates the store through a forced upgrade and reads back the write", async () => {
    localStorage.clear();
    await deleteDb().catch(() => undefined);
    // The wedge: current code version present, debug-sessions absent.
    await openDbAt(33, ["ai-sessions"]);

    const { withStore, STORES } = await import("./db");
    await withStore(STORES.debugSessions, "readwrite", (s) => s.put(SESSION_ROW));
    const rows = await withStore(STORES.debugSessions, "readonly", (s) => s.getAll());

    expect(rows).toHaveLength(1);
    expect((rows[0] as { id: string }).id).toBe("dbg_heal");
    // The bump is pinned so a reload reopens compatibly.
    expect(localStorage.getItem(PIN_KEY)).toBe("34");
  });

  it("reopens the healed database after a simulated reload without upgrading", async () => {
    // Fresh module graph, same browser profile: pin 34 + v34 data survive.
    const { withStore, STORES } = await import("./db");
    const rows = await withStore(STORES.debugSessions, "readonly", (s) => s.getAll());
    expect(rows).toHaveLength(1);
    await withStore(STORES.debugSessions, "readwrite", (s) =>
      s.put({ ...(rows[0] as Record<string, unknown>), title: "heal probe 2" })
    );
    const again = await withStore(STORES.debugSessions, "readonly", (s) => s.getAll());
    expect((again[0] as { title: string }).title).toBe("heal probe 2");
  });

  it("rejects instead of hanging when the database is newer than code + pin", async () => {
    localStorage.clear();
    await deleteDb().catch(() => undefined);
    // A sibling tab healed further than this tab knows.
    await openDbAt(50, ["debug-sessions"]);

    const { withStore, STORES } = await import("./db");
    await expect(withStore(STORES.debugSessions, "readonly", (s) => s.getAll())).rejects.toThrow();
  });
});
