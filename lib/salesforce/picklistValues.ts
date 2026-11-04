/**
 * Add-values-to-picklist contract: pure builders for extending an existing
 * picklist field without touching Setup.
 *
 * Two writes, one fast track:
 *  1. Field global set - CustomField.Metadata.valueSet (or GlobalValueSet
 *     when the field is global-backed). The merge rule is total: the PATCH
 *     must carry the COMPLETE list (existing + new), never just the delta,
 *     or the old values are wiped.
 *  2. Record-type assignment - each RecordType carries its own
 *     picklistValues override, so a value added to the field is invisible
 *     on a record type until it is appended there too.
 *
 * Pure functions only - no network. Deploys ride the existing
 * `/api/salesforce/rest` proxy like every other Author write.
 */

export interface PickEntry {
  fullName: string;
  label: string;
  isDefault: boolean;
  isActive: boolean;
}

/** What the field's value set looks like today. */
export interface FieldValueSet {
  /** Global picklist developer name when global-backed - the edit target moves. */
  globalSetName?: string;
  restricted: boolean;
  values: PickEntry[];
}

export const PICKLIST_VALUE_MAX = 255;
export const PICKLIST_ADD_MAX = 200;

function cleanLabel(v: string): string {
  return v.trim().replace(/\s+/g, " ").slice(0, PICKLIST_VALUE_MAX);
}

/** Split pasted text into candidate values - newlines, commas, semicolons. */
export function splitNewValues(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map(cleanLabel)
    .filter(Boolean);
}

/** Validate candidate values against the current set. Case-insensitive. */
export function validateNewValues(current: PickEntry[], candidates: string[]): { ok: string[]; problems: string[] } {
  const seen = new Set(current.map((v) => v.fullName.toLowerCase()));
  const ok: string[] = [];
  const problems: string[] = [];
  for (const raw of candidates) {
    const c = cleanLabel(raw);
    if (!c) continue;
    const key = c.toLowerCase();
    if (seen.has(key)) {
      problems.push(`"${c}" already exists - skipped.`);
      continue;
    }
    seen.add(key);
    ok.push(c);
  }
  if (ok.length + current.length > 1000) {
    return { ok: [], problems: [`That would exceed 1000 active values on one field.`] };
  }
  if (ok.length > PICKLIST_ADD_MAX) {
    return { ok: [], problems: [`Add at most ${PICKLIST_ADD_MAX} values at once.`] };
  }
  return { ok, problems };
}

/**
 * Parse Tooling CustomField Metadata into today's value set. Returns null
 * when the payload is not a value-set picklist (unexpected shape).
 */
export function parseFieldValueSet(metadata: unknown): FieldValueSet | null {
  if (!metadata || typeof metadata !== "object") return null;
  const vs = (metadata as { valueSet?: unknown }).valueSet;
  if (!vs || typeof vs !== "object") return null;
  const rec = vs as { valueSetName?: unknown; restricted?: unknown; valueSetDefinition?: unknown };
  const def = rec.valueSetDefinition as { value?: unknown } | undefined;
  const rawList = Array.isArray(def?.value) ? (def.value as unknown[]) : [];
  const values: PickEntry[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const e = item as { fullName?: unknown; label?: unknown; default?: unknown; isActive?: unknown };
    if (typeof e.fullName !== "string" || !e.fullName) continue;
    values.push({
      fullName: e.fullName,
      label: typeof e.label === "string" && e.label ? e.label : e.fullName,
      isDefault: e.default === true,
      isActive: e.isActive !== false,
    });
  }
  return {
    ...(typeof rec.valueSetName === "string" && rec.valueSetName ? { globalSetName: rec.valueSetName } : {}),
    restricted: rec.restricted === true,
    values,
  };
}

/** Parse Tooling GlobalValueSet Metadata into entries. */
export function parseGlobalValueSet(metadata: unknown): PickEntry[] | null {
  if (!metadata || typeof metadata !== "object") return null;
  const rawList = (metadata as { customValue?: unknown }).customValue;
  if (!Array.isArray(rawList)) return null;
  const values: PickEntry[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const e = item as { fullName?: unknown; label?: unknown; default?: unknown; isActive?: unknown };
    if (typeof e.fullName !== "string" || !e.fullName) continue;
    values.push({
      fullName: e.fullName,
      label: typeof e.label === "string" && e.label ? e.label : e.fullName,
      isDefault: e.default === true,
      isActive: e.isActive !== false,
    });
  }
  return values;
}

/** PATCH body for CustomField: the COMPLETE merged value list. */
export function buildCustomFieldPatch(merged: PickEntry[]): Record<string, unknown> {
  return {
    Metadata: {
      valueSet: {
        valueSetDefinition: {
          value: merged.map((v) => ({
            fullName: v.fullName,
            label: v.label,
            default: v.isDefault,
            isActive: v.isActive,
          })),
        },
      },
    },
  };
}

/** PATCH body for GlobalValueSet: the COMPLETE merged customValue list. */
export function buildGlobalValueSetPatch(merged: PickEntry[]): Record<string, unknown> {
  return {
    Metadata: {
      customValue: merged.map((v) => ({
        fullName: v.fullName,
        label: v.label,
        default: v.isDefault,
        isActive: v.isActive,
      })),
    },
  };
}

export function withAdditions(current: PickEntry[], additions: string[]): PickEntry[] {
  const next = current.map((v) => ({ ...v }));
  for (const label of additions) {
    next.push({ fullName: label, label, isDefault: false, isActive: true });
  }
  return next;
}

function escapeHtmlCell(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Copy-all table for a picklist value list: HTML table (pastes as a real
 * table into Teams/Docs) with a TSV fallback for plain-text targets.
 */
export function buildPicklistCopyTable(values: { label: string; value: string }[]): { html: string; text: string } {
  const rows = values.map(
    (v) => `<tr><td>${escapeHtmlCell(v.label)}</td><td>${escapeHtmlCell(v.value)}</td></tr>`,
  );
  const html = `<table><thead><tr><th>Label</th><th>API Name</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  const text = ["Label\tAPI Name", ...values.map((v) => `${v.label}\t${v.value}`)].join("\n");
  return { html, text };
}

export interface FieldCopyEntry {
  label: string;
  name: string;
  type: string;
  /** Help text - newlines/tabs flatten so the TSV stays one row per field. */
  description: string;
  /** DB-style flag: true renders Y, false renders N. */
  required: boolean;
}

/** Single-line a TSV cell: tabs/newlines become spaces, runs collapse. */
function flatCell(v: string): string {
  return v.replace(/[\t\r\n]+/g, " ").replace(/ {2,}/g, " ").trim();
}

/**
 * Copy-all table for an object's FIELD list (ERD box icon): DB-level
 * artifact - Label | API Name | Data Type | Description | Required (Y/N),
 * as HTML (pastes as a real table in Teams/Docs) plus TSV fallback.
 */
export function buildFieldCopyTable(fields: FieldCopyEntry[]): { html: string; text: string } {
  const head = "<tr><th>Label</th><th>API Name</th><th>Data Type</th><th>Description</th><th>Required</th></tr>";
  const rows = fields.map(
    (f) =>
      `<tr><td>${escapeHtmlCell(f.label)}</td><td>${escapeHtmlCell(f.name)}</td><td>${escapeHtmlCell(f.type)}</td><td>${escapeHtmlCell(flatCell(f.description))}</td><td>${f.required ? "Y" : "N"}</td></tr>`,
  );
  const html = `<table><thead>${head}</thead><tbody>${rows.join("")}</tbody></table>`;
  const text = [
    "Label\tAPI Name\tData Type\tDescription\tRequired",
    ...fields.map((f) => `${flatCell(f.label)}\t${flatCell(f.name)}\t${flatCell(f.type)}\t${flatCell(f.description)}\t${f.required ? "Y" : "N"}`),
  ].join("\n");
  return { html, text };
}

/** Cell text for a live record value inside a copy table. */
export function formatCopyCellValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

/**
 * Copy-all table for an object's fields PLUS the visualized record's values
 * (ERD box icon, live-data only): Label | API Name | Value, so a walked
 * record pastes field-by-field into Teams/Excel/Sheets.
 */
export function buildFieldDataCopyTable(rows: { label: string; name: string; value: unknown }[]): { html: string; text: string } {
  const body = rows.map(
    (r) =>
      `<tr><td>${escapeHtmlCell(r.label)}</td><td>${escapeHtmlCell(r.name)}</td><td>${escapeHtmlCell(formatCopyCellValue(r.value))}</td></tr>`,
  );
  const html = `<table><thead><tr><th>Label</th><th>API Name</th><th>Value</th></tr></thead><tbody>${body.join("")}</tbody></table>`;
  const text = ["Label\tAPI Name\tValue", ...rows.map((r) => `${r.label}\t${r.name}\t${formatCopyCellValue(r.value)}`)].join("\n");
  return { html, text };
}

/** Tooling REST paths for the add-values flow. */
export function toolingQueryPath(apiVersion: string, soql: string): string {
  return `/services/data/${apiVersion}/tooling/query/?q=${encodeURIComponent(soql)}`;
}

export function toolingSobjectPath(apiVersion: string, type: "CustomField" | "GlobalValueSet" | "RecordType", id: string): string {
  return `/services/data/${apiVersion}/tooling/sobjects/${type}/${id}`;
}

export function fieldIdQuery(objectApi: string, developerName: string): string {
  return `SELECT Id, DeveloperName, Metadata FROM CustomField WHERE TableEnumOrId = '${objectApi}' AND DeveloperName = '${developerName}'`;
}

export function globalSetQuery(developerName: string): string {
  return `SELECT Id, DeveloperName, Metadata FROM GlobalValueSet WHERE DeveloperName = '${developerName}'`;
}

export function recordTypeListQuery(objectApi: string): string {
  return `SELECT Id, Name, DeveloperName, IsActive FROM RecordType WHERE SobjectType = '${objectApi}' ORDER BY Name`;
}

export function uiApiAvailabilityPath(apiVersion: string, objectApi: string, recordTypeId: string): string {
  return `/services/data/${apiVersion}/ui-api/object-info/${objectApi}/picklist-values/${recordTypeId}`;
}

/** Master record type shows every active value automatically - never patched. */
export function isMasterRecordType(id: string): boolean {
  return id === "012000000000000AAA";
}

export interface RecordTypeSummary {
  id: string;
  name: string;
  developerName: string;
  isActive: boolean;
}

/** RecordType picklist entry from Tooling Metadata. */
export interface RtPicklistEntry {
  picklist: string;
  values: { fullName: string; isDefault: boolean }[];
}

/** Parse RecordType Metadata.picklistValues into entries. */
export function parseRtPicklists(metadata: unknown): RtPicklistEntry[] {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = (metadata as { picklistValues?: unknown }).picklistValues;
  if (!Array.isArray(raw)) return [];
  const out: RtPicklistEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as { picklist?: unknown; values?: unknown };
    if (typeof e.picklist !== "string" || !e.picklist) continue;
    const values: { fullName: string; isDefault: boolean }[] = [];
    if (Array.isArray(e.values)) {
      for (const v of e.values) {
        if (!v || typeof v !== "object") continue;
        const ve = v as { fullName?: unknown; default?: unknown };
        if (typeof ve.fullName !== "string" || !ve.fullName) continue;
        values.push({ fullName: ve.fullName, isDefault: ve.default === true });
      }
    }
    out.push({ picklist: e.picklist, values });
  }
  return out;
}

/**
 * PATCH body for a RecordType: the FULL picklistValues array with our
 * field's entry extended by the new values (visible). Every other
 * picklist entry passes through untouched.
 */
export function buildRecordTypePatch(
  existing: RtPicklistEntry[],
  fieldApi: string,
  additions: string[],
): Record<string, unknown> {
  const picklistValues = existing.map((entry) => {
    if (entry.picklist.toLowerCase() !== fieldApi.toLowerCase()) {
      return {
        picklist: entry.picklist,
        values: entry.values.map((v) => ({ fullName: v.fullName, default: v.isDefault })),
      };
    }
    const have = new Set(entry.values.map((v) => v.fullName.toLowerCase()));
    const values = entry.values.map((v) => ({ fullName: v.fullName, default: v.isDefault }));
    for (const a of additions) {
      if (!have.has(a.toLowerCase())) values.push({ fullName: a, default: false });
    }
    return { picklist: entry.picklist, values };
  });
  if (!existing.some((e) => e.picklist.toLowerCase() === fieldApi.toLowerCase())) {
    picklistValues.push({
      picklist: fieldApi,
      values: additions.map((a) => ({ fullName: a, default: false })),
    });
  }
  return { Metadata: { picklistValues } };
}

/**
 * Availability of one field inside one record type, from the UI API
 * picklist-values payload. Tolerant of qualified field keys.
 */
export function parseAvailability(payload: unknown, fieldApi: string): string[] {
  if (!payload || typeof payload !== "object") return [];
  const map = (payload as { picklistFieldValues?: unknown }).picklistFieldValues;
  if (!map || typeof map !== "object") return [];
  const key = Object.keys(map).find((k) => k.toLowerCase() === fieldApi.toLowerCase() || k.toLowerCase().endsWith(`.${fieldApi.toLowerCase()}`));
  if (!key) return [];
  const entry = (map as Record<string, unknown>)[key] as { values?: unknown };
  if (!entry || !Array.isArray(entry.values)) return [];
  const out: string[] = [];
  for (const v of entry.values) {
    if (!v || typeof v !== "object") continue;
    const ve = v as { value?: unknown; active?: unknown };
    if (typeof ve.value === "string" && ve.active !== false) out.push(ve.value);
  }
  return out;
}
