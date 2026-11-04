import type { OperationDef } from "./types";

/**
 * Operation inventory checks: route syntax, duplicates, path params,
 * operationId collisions, dependency references.
 */

export interface RouteIssue {
  level: "error" | "warning";
  code: string;
  operationId: string;
  message: string;
}

const ROUTE_RE = /^\/[A-Za-z0-9_\-./{}]*$/;
const PARAM_RE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

export function extractPathParams(route: string): string[] {
  const out: string[] = [];
  PARAM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PARAM_RE.exec(route)) !== null) out.push(m[1]);
  return out;
}

export function validateOperations(ops: OperationDef[]): RouteIssue[] {
  const issues: RouteIssue[] = [];
  const seen = new Map<string, string>();
  const opIds = new Map<string, string>();
  const ids = new Set(ops.map((o) => o.id));

  for (const o of ops) {
    const at = (code: string, level: RouteIssue["level"], message: string) =>
      issues.push({ level, code, operationId: o.operationId || o.id, message });

    if (!ROUTE_RE.test(o.route)) {
      at("bad-route", "error", `Route "${o.route}" has invalid syntax.`);
    }
    if (o.route.includes("{}") || o.route.includes("{/") || o.route.includes("//")) {
      at("bad-route", "error", `Route "${o.route}" is malformed.`);
    }
    const key = `${o.method} ${o.route}`;
    const first = seen.get(key);
    if (first !== undefined && first !== o.id) {
      at("duplicate-route", "error", `Duplicate ${key} (also ${first}).`);
    } else {
      seen.set(key, o.id);
    }
    if (opIds.has(o.operationId) && opIds.get(o.operationId) !== o.id) {
      at("duplicate-operation-id", "error", `Duplicate operationId "${o.operationId}".`);
    } else {
      opIds.set(o.operationId, o.id);
    }
    const params = extractPathParams(o.route);
    const dupParam = params.find((p, i) => params.indexOf(p) !== i);
    if (dupParam) at("duplicate-param", "error", `Duplicate path parameter {${dupParam}}.`);
    const declared = new Set(o.parameters.filter((p) => p.in === "path").map((p) => p.name));
    for (const p of params) {
      if (!declared.has(p)) at("missing-param", "error", `Path parameter {${p}} has no schema.`);
    }
    for (const d of o.dependencies) {
      if (!ids.has(d)) at("bad-dependency", "error", `Dependency "${d}" matches no operation.`);
      if (d === o.id) at("self-dependency", "error", "An operation cannot depend on itself.");
    }
    if (o.method === "GET" && o.requestSchema) {
      at("get-with-body", "warning", "GET carries a request schema - query parameters are conventional.");
    }
  }
  return issues;
}
