/**
 * Central IndexedDB access for gravenx-studio.
 * Single DB + version + upgrade path; every feature store lives here.
 * Feature modules (collection, erd snapshots, soql/rest history) import
 * `withStore` + `STORES` instead of rolling their own open/upgrade code.
 */

export const DB_NAME = "gravenx-studio";
// v23: additive heal - recreates any store missing from an already-upgraded
// DB (e.g. decision-records), so a stuck browser self-repairs on next open.
// v25: canvas image blobs for System Design pasted screenshots.
// v29: arch-activity store - audit trail for org mutations from the ERD.
// v30: arena stores - grounding library + engineering sessions.
// v31: pmo-credentials store - encrypted remembered Jira/ServiceNow logins.
// v32: debug-sessions store - Log Decomposer debug sessions.
// v33: heal wedge - a stale HMR mix once upgraded browsers to v32 without
//      creating debug-sessions; reopening at v33 replays the additive heal.
export const DB_VERSION = 33;

export const STORES = {
  items: "request-collection",
  collections: "collections",
  erdSnapshots: "erd-snapshots",
  soqlQueries: "soql-queries",
  restHistory: "rest-history",
  contractProfiles: "contract-profiles",
  contractRevisions: "contract-revisions",
  architectProjects: "architect-projects",
  mappingProjects: "mapping-projects",
  mappingAssets: "mapping-assets",
  studioProjects: "studio-projects",
  workspaces: "workspace-autosave",
  systemProjects: "system-projects",
  systemRuns: "system-runs",
  systemBlobs: "system-blobs",
  drawScenes: "draw-scenes",
  aiSessions: "ai-sessions",
  wireframes: "wireframes",
  wireframeSnapshots: "wireframe-snapshots",
  sequences: "sequences",
  sequenceSnapshots: "sequence-snapshots",
  consoleTasks: "console-tasks",
  consoleAttachments: "console-attachments",
  notes: "standalone-notes",
  decisionRecords: "decision-records",
  requirementRecords: "requirement-records",
  diagramStudios: "diagram-studios",
  diagramSketches: "diagram-sketches",
  agentAudit: "agent-audit",
  archActivity: "arch-activity",
  arenaGrounding: "arena-grounding",
  arenaSessions: "arena-sessions",
  pmoCredentials: "pmo-credentials",
  debugSessions: "debug-sessions",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

const BLOCKED_MESSAGE = "IndexedDB upgrade blocked by another open tab";

function openDbOnce(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, effectiveVersion());
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "id" });
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Never block another tab's upgrade - a stale open connection here
      // used to wedge every save with no visible reason.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
    // A second tab holding an old connection must never hang load/save forever.
    req.onblocked = () => reject(new Error(BLOCKED_MESSAGE));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const VERSION_PIN_KEY = "gravenx_idb_version";

/**
 * In-memory version bump for self-heal. A stale bundle mix can leave a
 * current-version DB missing a store (upgrade ran with an old store list
 * and never replays). Bumping forces onupgradeneeded, whose additive loop
 * creates whatever is missing - the v23 self-repair promise, honored at
 * runtime instead of only during release upgrades. The bump is pinned to
 * localStorage so a reload never reopens at a lower version (which throws).
 */
let versionBump = 0;

function effectiveVersion(): number {
  let pin = DB_VERSION;
  try {
    const raw = Number(localStorage.getItem(VERSION_PIN_KEY) ?? "0");
    if (Number.isFinite(raw)) pin = Math.max(pin, Math.floor(raw));
  } catch {
    /* private mode - session bump only */
  }
  return pin + versionBump;
}

function pinVersion(v: number): void {
  try {
    localStorage.setItem(VERSION_PIN_KEY, String(v));
  } catch {
    /* ignore */
  }
}

function isMissingStore(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "NotFoundError" || /object store.*not found/i.test(err.message))
  );
}

/**
 * Upgrade blocks are transient (the user closes the other tab) - retry a
 * few times before surfacing, so one stale tab doesn't kill every save.
 * A VersionError means a sibling tab already healed to a higher version;
 * re-reading the pin on retry picks the newer version up.
 */
function openDb(attempts = 3): Promise<IDBDatabase> {
  return openDbOnce().catch((err) => {
    const name = err instanceof Error ? err.name : "";
    const retryable =
      attempts > 1 && (err instanceof Error && err.message === BLOCKED_MESSAGE || name === "VersionError");
    if (retryable) {
      return sleep(1000).then(() => openDb(attempts - 1));
    }
    throw err;
  });
}

export function withStore<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
  healed = false
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction(storeName, mode);
        } catch (err) {
          db.close();
          if (!healed && isMissingStore(err)) {
            // Current-version DB missing this store (stale-bundle wedge):
            // force an upgrade pass that recreates it, pin it so reloads
            // stay compatible, then retry once.
            versionBump += 1;
            pinVersion(effectiveVersion());
            resolve(withStore(storeName, mode, fn, true));
            return;
          }
          reject(err instanceof Error ? err : new Error("IndexedDB transaction failed"));
          return;
        }
        const store = tx.objectStore(storeName);
        let result: T;
        try {
          const req = fn(store);
          req.onsuccess = () => {
            result = req.result;
          };
          req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
        } catch (err) {
          reject(err instanceof Error ? err : new Error("IndexedDB request failed"));
          return;
        }
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("IndexedDB transaction failed"));
        };
      })
  );
}
