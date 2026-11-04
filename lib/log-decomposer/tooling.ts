import { z } from "zod";

/**
 * Tooling API surface for Log Decomposer capture. Pure builders +
 * allowlists - the route handlers stay thin, and everything here is
 * unit-testable without a live org.
 *
 * Write is scoped to TraceFlag + DebugLevel (tracing setup/teardown).
 * ApexLog, ApexClass, ApexTrigger and User are read-only sources for
 * target picking and log listing.
 */

export const TOOLING_WRITABLE = ["TraceFlag", "DebugLevel"] as const;
export const TOOLING_READABLE = ["ApexLog", "ApexClass", "ApexTrigger", "User"] as const;
/** Delete-only: logs are ephemeral - Setup deletes them in one click, so can we. */
export const TOOLING_DELETABLE = ["ApexLog"] as const;

export type ToolingSobject = (typeof TOOLING_WRITABLE)[number] | (typeof TOOLING_READABLE)[number];

const ALL_TOOLING = new Set<string>([...TOOLING_WRITABLE, ...TOOLING_READABLE]);

export function isToolingSobject(name: string): name is ToolingSobject {
  return ALL_TOOLING.has(name);
}

export function isWritableSobject(name: string): boolean {
  return (TOOLING_WRITABLE as readonly string[]).includes(name);
}

export function isDeletableSobject(name: string): boolean {
  return (TOOLING_DELETABLE as readonly string[]).includes(name);
}

export const debugCategories = [
  "ApexCode",
  "ApexProfiling",
  "Callout",
  "Database",
  "System",
  "Validation",
  "Visualforce",
  "Workflow",
] as const;

export type DebugCategory = (typeof debugCategories)[number];

export const debugLevels = ["NONE", "ERROR", "WARN", "INFO", "DEBUG", "FINE", "FINER", "FINEST"] as const;

export type DebugLevelName = (typeof debugLevels)[number];

export type TracePreset = "smart" | "apex-deep" | "integration" | "performance" | "custom";

export const TRACE_PRESETS: Record<TracePreset, Record<DebugCategory, DebugLevelName>> = {
  smart: {
    ApexCode: "DEBUG",
    ApexProfiling: "INFO",
    Callout: "INFO",
    Database: "INFO",
    System: "DEBUG",
    Validation: "INFO",
    Visualforce: "INFO",
    Workflow: "INFO",
  },
  "apex-deep": {
    ApexCode: "FINEST",
    ApexProfiling: "FINEST",
    Callout: "INFO",
    Database: "INFO",
    System: "DEBUG",
    Validation: "INFO",
    Visualforce: "INFO",
    Workflow: "INFO",
  },
  integration: {
    ApexCode: "DEBUG",
    ApexProfiling: "INFO",
    Callout: "FINEST",
    Database: "INFO",
    System: "DEBUG",
    Validation: "INFO",
    Visualforce: "INFO",
    Workflow: "INFO",
  },
  performance: {
    ApexCode: "INFO",
    ApexProfiling: "FINEST",
    Callout: "INFO",
    Database: "FINEST",
    System: "INFO",
    Validation: "INFO",
    Visualforce: "INFO",
    Workflow: "INFO",
  },
  custom: {
    ApexCode: "INFO",
    ApexProfiling: "INFO",
    Callout: "INFO",
    Database: "INFO",
    System: "INFO",
    Validation: "INFO",
    Visualforce: "INFO",
    Workflow: "INFO",
  },
};

/** DebugLevel create payload for a preset. DeveloperName must be org-unique. */
export function debugLevelPayload(developerName: string, masterLabel: string, preset: TracePreset): Record<string, string> {
  const levels = TRACE_PRESETS[preset];
  return {
    DeveloperName: developerName,
    MasterLabel: masterLabel,
    ApexCode: levels.ApexCode,
    ApexProfiling: levels.ApexProfiling,
    Callout: levels.Callout,
    Database: levels.Database,
    System: levels.System,
    Validation: levels.Validation,
    Visualforce: levels.Visualforce,
    Workflow: levels.Workflow,
  };
}

/** TraceFlag create payload. Expiration is ISO; Salesforce caps flag life. */
export function traceFlagPayload(tracedEntityId: string, debugLevelId: string, expirationIso: string): Record<string, string> {
  return {
    TracedEntityId: tracedEntityId,
    DebugLevelId: debugLevelId,
    LogType: "DEVELOPER_LOG",
    ExpirationDate: expirationIso,
  };
}

/** Default flag life: 30 minutes from now. */
export function defaultExpirationIso(fromMs = Date.now()): string {
  return new Date(fromMs + 30 * 60 * 1000).toISOString();
}

const apexLogRowSchema = z.object({
  Id: z.string(),
  Application: z.string().optional(),
  Operation: z.string().optional(),
  Status: z.string().optional(),
  DurationMilliseconds: z.number().optional(),
  LogLength: z.number().optional(),
  Request: z.string().optional(),
  RequestIdentifier: z.string().optional(),
  StartTime: z.string().optional(),
  LogUserId: z.string().optional(),
});

export type ApexLogRow = z.infer<typeof apexLogRowSchema>;

/** Validate tooling query rows; unknown shapes are dropped, not fatal. */
export function parseApexLogRows(records: unknown): ApexLogRow[] {
  if (!Array.isArray(records)) return [];
  const out: ApexLogRow[] = [];
  for (const r of records) {
    const parsed = apexLogRowSchema.safeParse(r);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Escape once for SOQL string literals (doubles single quotes). */
export function soqlEscape(raw: string): string {
  return raw.replace(/'/g, "''").replace(/[%_]/g, (m) => `\\${m}`);
}

/** Bounded target search per traceable kind - newest-first not needed, name order. */
export function traceTargetSearchSoql(kind: "user" | "class" | "trigger", query: string): string {
  const q = `%${soqlEscape(query.trim()).slice(0, 60)}%`;
  if (kind === "user") {
    // NOTE: Tooling User has no IsActive column (SOAP/REST-only) - an
    // IsActive filter 400s here, so the picker searches names as-is.
    return "SELECT Id, Name, Username FROM User " + `WHERE (Name LIKE '${q}' OR Username LIKE '${q}') ORDER BY Name LIMIT 20`;
  }
  if (kind === "class") {
    return `SELECT Id, Name, NamespacePrefix FROM ApexClass WHERE Name LIKE '${q}' ORDER BY Name LIMIT 20`;
  }
  return `SELECT Id, Name FROM ApexTrigger WHERE Name LIKE '${q}' ORDER BY Name LIMIT 20`;
}

export interface TraceTargetRow {
  id: string;
  name: string;
  detail: string;
}

/** Shape the loose Tooling rows into picker rows; drops malformed, never throws. */
export function parseTraceTargetRows(kind: "user" | "class" | "trigger", records: unknown): TraceTargetRow[] {
  if (!Array.isArray(records)) return [];
  const out: TraceTargetRow[] = [];
  for (const r of records) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    if (typeof o.Id !== "string" || typeof o.Name !== "string") continue;
    out.push({
      id: o.Id,
      name: o.Name,
      detail: kind === "user" && typeof o.Username === "string" ? o.Username : kind === "class" && typeof o.NamespacePrefix === "string" && o.NamespacePrefix ? `ns: ${o.NamespacePrefix}` : o.Id,
    });
  }
  return out;
}

/**
 * Bounded ApexLog list query - newest first. Every column verified against
 * the live Tooling describe for ApexLog (Id, LogUserId, LogLength,
 * LastModifiedDate, Request, Operation, Application, Status,
 * DurationMilliseconds, SystemModstamp, StartTime, Location,
 * RequestIdentifier). Notably: Request and RequestIdentifier exist -
 * RequestId does not (a live 400 proved it).
 */
export function apexLogListSoql(limit: number): string {
  const n = Math.min(Math.max(Math.floor(limit), 1), 100);
  return (
    "SELECT Id, Application, Operation, Status, DurationMilliseconds, LogLength, Request, RequestIdentifier, StartTime, LogUserId " +
    `FROM ApexLog ORDER BY StartTime DESC LIMIT ${n}`
  );
}

const traceFlagRowSchema = z.object({
  Id: z.string(),
  TracedEntityId: z.string(),
  DebugLevelId: z.string(),
  LogType: z.string().optional(),
  StartDate: z.string().optional(),
  ExpirationDate: z.string().optional(),
});

export type TraceFlagRow = z.infer<typeof traceFlagRowSchema>;

const debugLevelRowSchema = z.object({
  Id: z.string(),
  DeveloperName: z.string().optional(),
  MasterLabel: z.string().optional(),
});

/** Active flags on the org - whatever set them (Dev Console, Setup, this studio). */
export function traceFlagListSoql(): string {
  return "SELECT Id, TracedEntityId, DebugLevelId, LogType, StartDate, ExpirationDate FROM TraceFlag ORDER BY ExpirationDate DESC LIMIT 50";
}

export function debugLevelListSoql(): string {
  return "SELECT Id, DeveloperName, MasterLabel FROM DebugLevel LIMIT 100";
}

export function parseTraceFlagRows(records: unknown): TraceFlagRow[] {
  if (!Array.isArray(records)) return [];
  const out: TraceFlagRow[] = [];
  for (const r of records) {
    const parsed = traceFlagRowSchema.safeParse(r);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function parseDebugLevelRows(records: unknown): Map<string, string> {
  const names = new Map<string, string>();
  if (!Array.isArray(records)) return names;
  for (const r of records) {
    const parsed = debugLevelRowSchema.safeParse(r);
    if (parsed.success) names.set(parsed.data.Id, parsed.data.MasterLabel ?? parsed.data.DeveloperName ?? parsed.data.Id);
  }
  return names;
}

/** Salesforce id prefix -> traced entity kind (005 user, 01p class, 01q trigger). */
export function guessTargetKind(tracedEntityId: string): "user" | "class" | "trigger" | "other" {
  if (tracedEntityId.startsWith("005")) return "user";
  if (tracedEntityId.startsWith("01p")) return "class";
  if (tracedEntityId.startsWith("01q")) return "trigger";
  return "other";
}
