/**
 * Anonymous Apex via the SOAP Apex API - the Workbench "Apex Execute"
 * equivalent. The REST Tooling executeAnonymous returns no log and takes no
 * debug levels, so we go SOAP like Workbench does: DebuggingHeader carries
 * the Log Category + Level, and the response carries the debug log inline.
 * Runs through a dedicated /api/salesforce/apex proxy - token stays in
 * session memory, never in a URL.
 */

/** Log categories exactly as Workbench lists them (UI ids; the SOAP enum
 * spells two of them differently - see SOAP_CATEGORY below). */
export const LOG_CATEGORIES = [
  { id: "Db", label: "Database" },
  { id: "Workflow", label: "Workflow" },
  { id: "Validation", label: "Validation" },
  { id: "Callout", label: "Callout" },
  { id: "ApexCode", label: "Apex Code" },
  { id: "ApexProfiling", label: "Apex Profiling" },
] as const;

export type LogCategory = (typeof LOG_CATEGORIES)[number]["id"];

export const LOG_LEVELS = [
  "None",
  "Error",
  "Warn",
  "Info",
  "Debug",
  "Fine",
  "Finer",
  "Finest",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export const DEFAULT_LOG_CATEGORY: LogCategory = "ApexCode";
export const DEFAULT_LOG_LEVEL: LogLevel = "Debug";

/** Workbench header token per category, e.g. "68.0 APEX_CODE,DEBUG". */
const CATEGORY_TOKENS: Record<LogCategory, string> = {
  Db: "DATABASE",
  Workflow: "WORKFLOW",
  Validation: "VALIDATION",
  Callout: "CALLOUT",
  ApexCode: "APEX_CODE",
  ApexProfiling: "APEX_PROFILING",
};

/** SOAP wants the bare version: "v68.0" -> "68.0". */
export function soapVersion(apiVersion: string): string {
  const v = apiVersion.startsWith("v") ? apiVersion.slice(1) : apiVersion;
  return /^\d+\.0$/.test(v) ? v : v;
}

/** Workbench-style header line for the results block. */
export function apexHeaderLine(apiVersion: string, category: LogCategory, level: LogLevel): string {
  return `${soapVersion(apiVersion)} ${CATEGORY_TOKENS[category]},${level.toUpperCase()}`;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Level per SOAP category. The chosen category runs at the chosen level;
 * ApexCode never drops below DEBUG (unless it IS the chosen category) so
 * System.debug output stays visible - the exact complaint that started this.
 * Everything else stays at INFO, the platform default.
 */
export function categoryLevels(category: LogCategory, level: LogLevel): Record<string, string> {
  const all = ["Db", "Workflow", "Validation", "Callout", "ApexCode", "ApexProfiling", "System", "Visualforce"];
  const out: Record<string, string> = {};
  for (const c of all) {
    if (c === category) out[c] = level;
    else if (c === "ApexCode") out[c] = "DEBUG";
    else out[c] = "INFO";
  }
  return out;
}

/**
 * SOAP LogCategory enum names. The server rejects the camelCase UI ids:
 * "ApexCode" is not a valid value - it must be "Apex_code" (same for
 * Apex_profiling). Db/Workflow/Validation/Callout match as-is.
 */
const SOAP_CATEGORY: Record<string, string> = {
  ApexCode: "Apex_code",
  ApexProfiling: "Apex_profiling",
};

export function soapCategory(category: string): string {
  return SOAP_CATEGORY[category] ?? category;
}

/** SOAP executeAnonymous envelope with Workbench's DebuggingHeader. */
export function buildExecuteAnonymousEnvelope(
  code: string,
  category: LogCategory,
  level: LogLevel,
  sessionId: string
): string {
  const levels = categoryLevels(category, level);
  const cats = Object.entries(levels)
    .map(([c, l]) => `<apex:categories><apex:category>${soapCategory(c)}</apex:category><apex:level>${l}</apex:level></apex:categories>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:apex="http://soap.sforce.com/2006/08/apex">` +
    `<soapenv:Header>` +
    `<apex:SessionHeader><apex:sessionId>${escapeXml(sessionId)}</apex:sessionId></apex:SessionHeader>` +
    `<apex:DebuggingHeader>${cats}</apex:DebuggingHeader>` +
    `</soapenv:Header>` +
    `<soapenv:Body>` +
    `<apex:executeAnonymous><apex:String>${escapeXml(code)}</apex:String></apex:executeAnonymous>` +
    `</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

export interface ApexRunResult {
  compiled: boolean;
  success: boolean;
  line: number | null;
  column: number | null;
  compileProblem: string | null;
  exceptionMessage: string | null;
  exceptionStackTrace: string | null;
  debugLog: string | null;
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : null;
}

/** Parse the SOAP executeAnonymous response. Never throws. */
export function parseApexSoapResponse(xml: unknown): ApexRunResult {
  const empty: ApexRunResult = {
    compiled: false,
    success: false,
    line: null,
    column: null,
    compileProblem: null,
    exceptionMessage: null,
    exceptionStackTrace: null,
    debugLog: null,
  };
  if (typeof xml !== "string" || !xml) return empty;
  const num = (v: string | null): number | null => {
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const str = (v: string | null): string | null => (v !== null && v !== "" ? v : null);
  const rawLog = tag(xml, "debugLog");
  return {
    compiled: tag(xml, "compiled") === "true",
    success: tag(xml, "success") === "true",
    line: num(tag(xml, "line")),
    column: num(tag(xml, "column")),
    compileProblem: str(tag(xml, "compileProblem")),
    exceptionMessage: str(tag(xml, "exceptionMessage")),
    exceptionStackTrace: str(tag(xml, "exceptionStackTrace")),
    debugLog: str(rawLog === null ? null : unescapeXml(rawLog)),
  };
}

/** Pull a SOAP faultstring out of a non-200 response. */
export function parseSoapFault(xml: unknown): string | null {
  if (typeof xml !== "string" || !xml) return null;
  const f = tag(xml, "faultstring");
  return f ? unescapeXml(f) : null;
}

/** One-line human summary for history rows. */
export function apexSummary(result: ApexRunResult): string {
  if (!result.compiled) {
    const where = result.line !== null ? ` (line ${result.line})` : "";
    return `Compile failed${where}: ${result.compileProblem ?? "see details"}`;
  }
  if (!result.success) return `Exception: ${result.exceptionMessage ?? "see details"}`;
  return "Executed clean";
}
