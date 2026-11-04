import { contentHash, stableStringify, toJsonString, toYamlString } from "../contracts/export";
import type { ApiProject, HttpMethod, PropertyDef } from "./types";

/**
 * Deterministic OpenAPI 3.1 compiler for architect projects. Pure
 * function of the canonical model - no React, no network, no LLM.
 * Custom routes, independent request/response schemas, reusable
 * components, declared errors. Proposed decisions never compile:
 * only accepted/authored model state is read.
 */

export const ARCHITECT_COMPILER_VERSION = "architect-1";
export const OPENAPI_VERSION = "3.1.0";

export interface ArchitectDiagnostic {
  level: "error" | "warning" | "info";
  code: string;
  path: string;
  message: string;
}

export interface ArchitectTrace {
  schema: string;
  externalName: string;
  sourceObject: string | null;
  sourceField: string | null;
  operations: string[];
  ownership: string | null;
  transform: string | null;
}

export interface ArchitectCompileResult {
  document: Record<string, unknown>;
  diagnostics: ArchitectDiagnostic[];
  traceability: ArchitectTrace[];
  examples: Record<string, unknown>;
  hash: string;
  yaml: string;
  json: string;
}

const SUCCESS_STATUS: Record<HttpMethod, string> = {
  POST: "201",
  GET: "200",
  PUT: "200",
  PATCH: "200",
  DELETE: "204",
};

function exampleForType(p: PropertyDef): unknown {
  if (p.example !== undefined) return p.example;
  if (p.default !== undefined) return p.default;
  if (p.enum && p.enum.length > 0) return p.enum[0];
  switch (p.type) {
    case "boolean":
      return true;
    case "integer":
      return 1;
    case "number":
      return 100.5;
    default:
      if (p.format === "date") return "2026-01-15";
      if (p.format === "date-time") return "2026-01-15T10:00:00.000+0000";
      if (p.format === "email") return "user@example.com";
      if (p.format === "uri") return "https://example.com";
      return "string";
  }
}

function propertySchema(p: PropertyDef): Record<string, unknown> {
  const s: Record<string, unknown> = { type: p.type };
  if (p.format) s.format = p.format;
  if (p.enum) s.enum = [...p.enum];
  if (p.maxLength !== undefined) s.maxLength = p.maxLength;
  if (p.minimum !== undefined) s.minimum = p.minimum;
  if (p.maximum !== undefined) s.maximum = p.maximum;
  if (p.pattern) s.pattern = p.pattern;
  if (p.nullable) s.nullable = true;
  if (p.readOnly) s.readOnly = true;
  if (p.writeOnly) s.writeOnly = true;
  if (p.default !== undefined) s.default = p.default;
  if (p.description) s.description = p.description;
  return s;
}

export function compileArchitectProject(
  project: ApiProject,
  now: number = Date.now()
): ArchitectCompileResult {
  const diagnostics: ArchitectDiagnostic[] = [];
  const push = (d: ArchitectDiagnostic) => diagnostics.push(d);

  const schemaByName = new Map(project.schemas.map((s) => [s.name, s]));
  const errorByName = new Map(project.errors.map((e) => [e.name, e]));
  const schemeByName = new Map(project.securitySchemes.map((s) => [s.name, s]));

  // Model-level checks.
  const opIds = new Set<string>();
  for (const op of project.operations) {
    if (opIds.has(op.operationId)) {
      push({ level: "error", code: "duplicate-operation-id", path: `operations.${op.id}`, message: `Duplicate operationId "${op.operationId}".` });
    }
    opIds.add(op.operationId);
    if (!op.summary) push({ level: "warning", code: "missing-summary", path: `operations.${op.id}`, message: `${op.method} ${op.route} has no summary.` });
    if (!op.description) push({ level: "info", code: "missing-description", path: `operations.${op.id}`, message: `${op.method} ${op.route} has no description.` });
    for (const r of [op.requestSchema, op.responseSchema]) {
      if (r && !schemaByName.has(r)) {
        push({ level: "error", code: "unknown-schema", path: `operations.${op.id}`, message: `Schema "${r}" does not exist.` });
      }
    }
    for (const e of op.errorResponses) {
      if (!errorByName.has(e)) push({ level: "error", code: "unknown-error", path: `operations.${op.id}`, message: `Error response "${e}" is not defined.` });
    }
    for (const s of op.security) {
      if (!schemeByName.has(s)) push({ level: "error", code: "unknown-security", path: `operations.${op.id}`, message: `Security scheme "${s}" is not declared.` });
    }
    if (op.errorResponses.length === 0) {
      push({ level: "warning", code: "no-errors", path: `operations.${op.id}`, message: `${op.method} ${op.route} documents no error responses.` });
    }
  }

  const paths: Record<string, unknown> = {};
  const schemas: Record<string, unknown> = {};
  const examples: Record<string, unknown> = {};
  const traceability: ArchitectTrace[] = [];

  // Schemas first (sorted for determinism), properties in defined order.
  for (const s of [...project.schemas].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const example: Record<string, unknown> = {};
    for (const p of s.properties) {
      properties[p.externalName] = propertySchema(p);
      if (p.required) required.push(p.externalName);
      example[p.externalName] = exampleForType(p);
      traceability.push({
        schema: s.name,
        externalName: p.externalName,
        sourceObject: p.source?.objectApiName ?? null,
        sourceField: p.source?.fieldApiName ?? null,
        operations: project.operations
          .filter((o) => o.requestSchema === s.name || o.responseSchema === s.name)
          .map((o) => o.operationId),
        ownership: p.mapping?.ownership ?? null,
        transform: p.mapping?.transform ?? null,
      });
    }
    const def: Record<string, unknown> = {
      type: "object",
      properties,
      ...(s.description ? { description: s.description } : {}),
    };
    if (required.length > 0) def.required = required;
    schemas[s.name] = def;
    examples[s.name] = example;
  }

  // Operations in array order (execution/design order is meaningful).
  for (const op of project.operations) {
    const pathItem = (paths[op.route] ?? {}) as Record<string, unknown>;
    const method = op.method.toLowerCase();
    const operation: Record<string, unknown> = {
      operationId: op.operationId,
      summary: op.summary || `${op.method} ${op.route}`,
      ...(op.description ? { description: op.description } : {}),
      ...(op.tags.length > 0 ? { tags: [...op.tags] } : {}),
    };

    // Parameters: declared first, then auto-added path params (warned).
    const parameters: Record<string, unknown>[] = [];
    const declaredPath = new Set(op.parameters.filter((p) => p.in === "path").map((p) => p.name));
    for (const p of op.parameters) {
      parameters.push({
        name: p.name,
        in: p.in,
        required: p.in === "path" ? true : p.required,
        ...(p.description ? { description: p.description } : {}),
        schema: { type: p.type },
      });
    }
    const routeParams = [...op.route.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]);
    for (const rp of new Set(routeParams)) {
      if (!declaredPath.has(rp)) {
        parameters.push({ name: rp, in: "path", required: true, schema: { type: "string" } });
        push({ level: "warning", code: "auto-path-param", path: `operations.${op.id}`, message: `Path parameter {${rp}} auto-declared as string - declare it explicitly.` });
      }
    }
    if (parameters.length > 0) operation.parameters = parameters;

    if (op.requestSchema && ["POST", "PUT", "PATCH"].includes(op.method)) {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: { $ref: `#/components/schemas/${op.requestSchema}` } } },
      };
    }
    const success = SUCCESS_STATUS[op.method];
    const responses: Record<string, unknown> = {};
    if (op.method === "DELETE" && success === "204") {
      responses["204"] = { description: op.responseSchema ? "Deleted" : "No content" };
    } else {
      responses[success] = {
        description: "Success",
        ...(op.responseSchema
          ? { content: { "application/json": { schema: { $ref: `#/components/schemas/${op.responseSchema}` } } } }
          : {}),
      };
    }
    for (const e of op.errorResponses) {
      const def = errorByName.get(e);
      if (def) responses[String(def.status)] = { $ref: `#/components/responses/${def.name}` };
    }
    operation.responses = responses;
    if (op.security.length > 0) operation.security = op.security.map((s) => ({ [s]: [] }));
    pathItem[method] = operation;
    paths[op.route] = pathItem;
  }

  // Reusable error responses + envelope.
  const errorResponses: Record<string, unknown> = {};
  for (const e of project.errors) {
    errorResponses[e.name] = {
      description: `${e.status} - ${e.message}`,
      content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
      "x-error-code": e.code,
      "x-retryable": e.retryable,
      "x-classification": e.classification,
    };
  }
  schemas.ErrorEnvelope = {
    type: "object",
    required: ["message"],
    properties: {
      message: { type: "string" },
      code: { type: "string" },
      correlationId: { type: "string" },
      details: { type: "array", items: { type: "string" } },
    },
  };

  const securitySchemes: Record<string, unknown> = {};
  for (const s of project.securitySchemes) {
    if (s.kind === "oauth2") {
      securitySchemes[s.name] = {
        type: "oauth2",
        description: `${s.description} (placeholder - no secrets exported)`,
        flows: { clientCredentials: { tokenUrl: "https://login.salesforce.com/services/oauth2/token", scopes: {} } },
      };
    } else if (s.kind === "apiKey") {
      securitySchemes[s.name] = {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: `${s.description} (placeholder - no secrets exported)`,
      };
    }
  }

  const document: Record<string, unknown> = {
    openapi: OPENAPI_VERSION,
    info: {
      title: project.name,
      version: project.apiVersion,
      description: project.intent.purpose || `${project.intent.capability} - designed in API Contract Architect.`,
    },
    servers: project.servers.map((s) => ({ url: s.url, description: s.description })),
    tags: [...new Set(project.operations.flatMap((o) => o.tags))].map((t) => ({ name: t })),
    paths,
    components: {
      schemas,
      responses: errorResponses,
      ...(Object.keys(securitySchemes).length > 0 ? { securitySchemes } : {}),
    },
    ...(project.defaultSecurity.length > 0
      ? { security: project.defaultSecurity.map((s) => ({ [s]: [] })) }
      : {}),
    "x-project": {
      id: project.id,
      version: project.version,
      approval: project.approval.state,
      compiler: ARCHITECT_COMPILER_VERSION,
      generatedAt: new Date(now).toISOString(),
    },
  };

  const hash = contentHash(stableStringify(document));
  return {
    document,
    diagnostics,
    traceability,
    examples,
    hash,
    yaml: toYamlString(document),
    json: toJsonString(document),
  };
}
