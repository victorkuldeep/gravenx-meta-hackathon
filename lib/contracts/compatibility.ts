/**
 * Structural compatibility between two compiled OpenAPI documents.
 * Classifies every structural delta as breaking / compatible / info, with
 * the consumer/provider assumption spelled out - never a bare verdict.
 */

export type ChangeSeverity = "breaking" | "compatible" | "info";

export interface ContractChange {
  severity: ChangeSeverity;
  kind: string;
  path: string;
  detail: string;
}

interface OpEntry {
  method: string;
  path: string;
  op: Record<string, unknown>;
}

function collectOperations(doc: Record<string, unknown>): Map<string, OpEntry> {
  const out = new Map<string, OpEntry>();
  const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
  for (const [path, item] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(item ?? {})) {
      if (method === "parameters" || typeof op !== "object" || op === null) continue;
      out.set(`${method.toUpperCase()} ${path}`, { method: method.toUpperCase(), path, op: op as Record<string, unknown> });
    }
  }
  return out;
}

function refName(ref: unknown): string | null {
  if (typeof ref !== "string") return null;
  const m = ref.match(/#\/components\/schemas\/([\w-]+)/);
  return m ? m[1] : null;
}

function bodySchemaName(op: Record<string, unknown>): string | null {
  const body = op.requestBody as { content?: { "application/json"?: { schema?: { $ref?: string } } } } | undefined;
  return refName(body?.content?.["application/json"]?.schema?.$ref);
}

function schemaOf(doc: Record<string, unknown>, name: string | null): { properties: Record<string, { type?: string; enum?: string[] }>; required: string[] } {
  if (!name) return { properties: {}, required: [] };
  const s = ((doc.components as { schemas?: Record<string, object> } | undefined)?.schemas?.[name] ?? {}) as {
    properties?: Record<string, { type?: string; enum?: string[] }>;
    required?: string[];
  };
  return { properties: s.properties ?? {}, required: s.required ?? [] };
}

/**
 * Diff two compiled documents (as produced by compileContract).
 * Order-insensitive for operations; property-level for bodies.
 */
export function diffCompiledDocuments(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): ContractChange[] {
  const changes: ContractChange[] = [];
  const bOps = collectOperations(before);
  const aOps = collectOperations(after);

  for (const [key, b] of bOps) {
    const a = aOps.get(key);
    if (!a) {
      changes.push({
        severity: "breaking",
        kind: "removed-operation",
        path: key,
        detail: `${key} no longer exists - existing consumers break.`,
      });
      continue;
    }
    const bSchema = schemaOf(before, bodySchemaName(b.op));
    const aSchema = schemaOf(after, bodySchemaName(a.op));
    const bProps = new Set(Object.keys(bSchema.properties));
    const aProps = new Set(Object.keys(aSchema.properties));
    for (const p of bProps) {
      if (!aProps.has(p)) {
        changes.push({
          severity: "breaking",
          kind: "removed-property",
          path: `${key} body.${p}`,
          detail: `Consumers sending "${p}" lose the field - breaking if any client sets it.`,
        });
      }
    }
    for (const p of aProps) {
      if (!bProps.has(p)) {
        const req = aSchema.required.includes(p);
        changes.push({
          severity: req ? "breaking" : "compatible",
          kind: "added-property",
          path: `${key} body.${p}`,
          detail: req
            ? `"${p}" is newly required - old clients omitting it will fail.`
            : `"${p}" is optional - old clients unaffected.`,
        });
      }
    }
    for (const p of bProps) {
      if (!aProps.has(p)) continue;
      const bp = bSchema.properties[p];
      const ap = aSchema.properties[p];
      if (bp.type !== ap.type) {
        changes.push({
          severity: "breaking",
          kind: "type-change",
          path: `${key} body.${p}`,
          detail: `"${p}" changed ${bp.type ?? "?"} → ${ap.type ?? "?"} - old payloads may fail validation.`,
        });
      }
      const bEnum = new Set(bp.enum ?? []);
      const aEnum = new Set(ap.enum ?? []);
      for (const v of bEnum) {
        if (!aEnum.has(v)) {
          changes.push({
            severity: "breaking",
            kind: "enum-removed",
            path: `${key} body.${p}`,
            detail: `Enum value "${v}" removed - clients sending it will fail.`,
          });
        }
      }
      for (const v of aEnum) {
        if (!bEnum.has(v)) {
          changes.push({
            severity: "compatible",
            kind: "enum-added",
            path: `${key} body.${p}`,
            detail: `Enum value "${v}" added - old clients unaffected.`,
          });
        }
      }
      const wasReq = bSchema.required.includes(p);
      const isReq = aSchema.required.includes(p);
      if (!wasReq && isReq) {
        changes.push({
          severity: "breaking",
          kind: "required-added",
          path: `${key} body.${p}`,
          detail: `"${p}" became required - old clients omitting it will fail.`,
        });
      } else if (wasReq && !isReq) {
        changes.push({
          severity: "compatible",
          kind: "required-relaxed",
          path: `${key} body.${p}`,
          detail: `"${p}" became optional - old clients unaffected.`,
        });
      }
    }
  }

  for (const [key] of aOps) {
    if (!bOps.has(key)) {
      changes.push({
        severity: "compatible",
        kind: "added-operation",
        path: key,
        detail: `${key} is new - no existing consumer depends on it.`,
      });
    }
  }

  // Descriptions / summaries only.
  const bInfo = JSON.stringify((before.info ?? {}) as object);
  const aInfo = JSON.stringify((after.info ?? {}) as object);
  if (bInfo !== aInfo) {
    changes.push({ severity: "info", kind: "info-change", path: "info", detail: "API info text changed - documentation only." });
  }

  return changes;
}

export function severityCounts(changes: ContractChange[]): { breaking: number; compatible: number; info: number } {
  return {
    breaking: changes.filter((c) => c.severity === "breaking").length,
    compatible: changes.filter((c) => c.severity === "compatible").length,
    info: changes.filter((c) => c.severity === "info").length,
  };
}
