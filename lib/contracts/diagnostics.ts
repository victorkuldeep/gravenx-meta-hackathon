import type { ContractFieldMeta } from "./metadata-adapter";
import { allowedForOperation } from "./field-policy";
import type { ContractOperation, ContractProfile } from "./types";

/**
 * Contract diagnostics (layers A + B + D): profile, metadata and lint
 * checks with severity levels. A warning never claims invalidity.
 */

export interface Diagnostic {
  level: "error" | "warning" | "info";
  code: string;
  path: string;
  message: string;
  requestId?: string;
  mappingId?: string;
  fieldApiName?: string;
}

export interface DiagnoseInput {
  profile: ContractProfile;
  /** Metadata by API name. Absent = offline/stale-tolerant mode. */
  metaByName: Map<string, ContractFieldMeta>;
  /** Epoch ms of the metadata snapshot. Null = unknown age. */
  snapshotCapturedAt: number | null;
  now?: number;
}

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function diagnoseProfile(input: DiagnoseInput): Diagnostic[] {
  const { profile, metaByName, snapshotCapturedAt, now = Date.now() } = input;
  const out: Diagnostic[] = [];
  const push = (d: Diagnostic) => out.push(d);

  const enabledOps = profile.operations.filter((o) => o.enabled);
  if (enabledOps.length === 0) {
    push({ level: "error", code: "no-operations", path: "operations", message: "No operations enabled." });
  }

  // Unique operationIds + external names.
  const opIds = new Set<string>();
  for (const o of profile.operations) {
    if (!o.enabled) continue;
    if (opIds.has(o.operationId)) {
      push({ level: "error", code: "duplicate-operation-id", path: `operations.${o.operation}`, message: `Duplicate operationId "${o.operationId}".` });
    }
    opIds.add(o.operationId);
  }
  const extNames = new Map<string, string>();
  for (const f of profile.fields) {
    const first = extNames.get(f.externalName);
    if (first !== undefined && first !== f.salesforceApiName) {
      push({ level: "error", code: "duplicate-external-name", path: `fields.${f.salesforceApiName}`, message: `External name "${f.externalName}" maps two Salesforce fields.` });
    } else {
      extNames.set(f.externalName, f.salesforceApiName);
    }
  }

  // Snapshot freshness.
  if (snapshotCapturedAt === null) {
    push({ level: "warning", code: "no-snapshot", path: "metadata", message: "No metadata snapshot - offline viewing only, refresh when connected." });
  } else if (now - snapshotCapturedAt > STALE_AFTER_MS) {
    push({ level: "warning", code: "stale-snapshot", path: "metadata", message: "Metadata snapshot is older than 7 days - refresh before publishing." });
  }

  // Per-operation field checks.
  for (const op of enabledOps) {
    const opFields = profile.fields.filter((f) => f.operations.includes(op.operation));
    if (opFields.length === 0) {
      push({ level: "warning", code: "empty-operation", path: `operations.${op.operation}`, message: `${op.operation} selects no fields.` });
    }
    for (const f of opFields) {
      const meta = metaByName.get(f.salesforceApiName);
      const base = `fields.${f.salesforceApiName}.${op.operation}`;
      if (!meta) {
        push({ level: "warning", code: "unknown-field", path: base, message: `${f.salesforceApiName} not in snapshot - cannot verify ${op.operation} support.` });
        continue;
      }
      if (!allowedForOperation(meta, op.operation)) {
        push({ level: "error", code: "not-writable", path: base, message: `${f.salesforceApiName} is not ${op.operation === "POST" ? "createable" : "updateable"} - excluded from ${op.operation}.` });
      }
      if (f.mapping) {
        if (f.mapping.targetField !== f.salesforceApiName) {
          push({ level: "error", code: "mapping-target-mismatch", path: base, message: `Mapping targets ${f.mapping.targetField} but lives on ${f.salesforceApiName}.` });
        }
        if (f.mapping.transform === "enum-map" && meta.sfType !== "picklist" && meta.sfType !== "multipicklist") {
          push({ level: "error", code: "bad-transform", path: base, message: `enum-map on non-picklist ${f.salesforceApiName}.` });
        }
        if (f.mapping.transform === "date-format" && meta.sfType !== "date" && meta.sfType !== "datetime") {
          push({ level: "error", code: "bad-transform", path: base, message: `date-format on non-date ${f.salesforceApiName}.` });
        }
        if (f.mapping.transform === "enum-map" && f.mapping.enumMap) {
          const active = new Set(meta.picklistValues.filter((p) => p.active).map((p) => p.value));
          for (const sv of Object.values(f.mapping.enumMap)) {
            if (active.size > 0 && !active.has(sv)) {
              push({ level: "warning", code: "enum-map-unknown", path: base, message: `enum-map value "${sv}" not in active picklist values.` });
            }
          }
        }
      }
    }
  }

  // Full-object exposure lint.
  const createableCount = [...metaByName.values()].filter((m) => m.createable).length;
  const postFields = profile.fields.filter((f) => f.operations.includes("POST" as ContractOperation)).length;
  if (createableCount > 0 && postFields / createableCount > 0.8 && postFields > 5) {
    push({ level: "warning", code: "wide-exposure", path: "fields", message: `POST exposes ${postFields}/${createableCount} createable fields - confirm the consumer needs them all.` });
  }

  return out;
}

/**
 * Minimal example-vs-schema checker (type, enum, required, nullability).
 * Used by tests to prove generated examples validate; reused by the UI
 * Validate tab later. Returns human-readable violations (empty = valid).
 */
export function validateExampleAgainstSchema(
  example: Record<string, unknown>,
  schema: { properties?: Record<string, { type?: string; enum?: string[]; nullable?: boolean }>; required?: string[] }
): string[] {
  const violations: string[] = [];
  for (const req of schema.required ?? []) {
    if (example[req] === undefined) violations.push(`missing required "${req}"`);
  }
  for (const [key, value] of Object.entries(example)) {
    const prop = schema.properties?.[key];
    if (!prop) {
      violations.push(`"${key}" not in schema`);
      continue;
    }
    if (value === null) {
      if (!prop.nullable) violations.push(`"${key}" is null but not nullable`);
      continue;
    }
    const t = Array.isArray(value) ? "array" : typeof value;
    const want = prop.type ?? "string";
    const ok =
      want === "integer"
        ? t === "number" && Number.isInteger(value)
        : want === "number"
          ? t === "number"
          : want === "object"
            ? t === "object"
            : t === want;
    if (!ok) violations.push(`"${key}" should be ${want}, got ${t}`);
    if (prop.enum && !prop.enum.includes(String(value))) {
      violations.push(`"${key}" value not in enum`);
    }
  }
  return violations;
}
