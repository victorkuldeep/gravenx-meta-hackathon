import { LOG_CATEGORIES, LOG_LEVELS } from "@/lib/salesforce/apex";

/**
 * Workspace preferences - small product defaults the architect owns.
 * localStorage, sync reads, sanitized on every read so a stale or
 * hand-edited blob can never crash a panel. Consumers read at mount
 * (or call time); changes apply to new connections and newly opened
 * panels without a code change.
 */

export interface Preferences {
  version: 1;
  /** Connect default when no env override and no saved session, e.g. "v66.0". */
  defaultApiVersion: string;
  apexLogCategory: string;
  apexLogLevel: string;
  /** ERD + graph hide system objects until reviewed. */
  erdHideSystem: boolean;
}

const KEY = "gravenx-preferences";

export const DEFAULT_PREFERENCES: Preferences = {
  version: 1,
  defaultApiVersion: "v66.0",
  apexLogCategory: "ApexCode",
  apexLogLevel: "Debug",
  erdHideSystem: true,
};

const CATEGORY_IDS = new Set<string>(LOG_CATEGORIES.map((c) => c.id));
const LEVEL_IDS = new Set<string>(LOG_LEVELS as readonly string[]);

export function sanitizePreferences(raw: unknown): Preferences {
  const s = (raw ?? {}) as Partial<Preferences>;
  const api = typeof s.defaultApiVersion === "string" && /^v\d+\.0$/.test(s.defaultApiVersion) ? s.defaultApiVersion : DEFAULT_PREFERENCES.defaultApiVersion;
  return {
    version: 1,
    defaultApiVersion: api,
    apexLogCategory: typeof s.apexLogCategory === "string" && CATEGORY_IDS.has(s.apexLogCategory) ? s.apexLogCategory : DEFAULT_PREFERENCES.apexLogCategory,
    apexLogLevel: typeof s.apexLogLevel === "string" && LEVEL_IDS.has(s.apexLogLevel) ? s.apexLogLevel : DEFAULT_PREFERENCES.apexLogLevel,
    erdHideSystem: typeof s.erdHideSystem === "boolean" ? s.erdHideSystem : DEFAULT_PREFERENCES.erdHideSystem,
  };
}

export function getPreferences(): Preferences {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_PREFERENCES };
    const raw = localStorage.getItem(KEY);
    return sanitizePreferences(raw ? (JSON.parse(raw) as unknown) : null);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(p: Preferences): Preferences {
  const clean = sanitizePreferences(p);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* private mode - memory copy governs this tab */
  }
  return clean;
}

export function resetPreferences(): Preferences {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return getPreferences();
}
