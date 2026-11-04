/**
 * Validate workspace - operation extraction.
 *
 * Normalizes the dereferenced OpenAPI document into the canonical
 * Operation model. Method + path is the identity; collisions get a
 * numeric suffix. Only JSON-compatible media types are validatable.
 */

import { adaptSchema } from "./adapter";
import type {
  ContentDefinition,
  ContractDiagnostic,
  Operation,
  ParameterDefinition,
  RequestDefinition,
  ResponseDefinition,
} from "./types";

export const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"] as const;

let diagSeq = 0;
function diag(
  severity: ContractDiagnostic["severity"],
  message: string,
  opts?: Partial<ContractDiagnostic>
): ContractDiagnostic {
  return { id: `op-${++diagSeq}`, severity, message, blocking: severity === "error", ...opts };
}

export function isJsonMediaType(mediaType: string): boolean {
  const base = mediaType.split(";")[0].trim().toLowerCase();
  return base === "application/json" || base.endsWith("+json");
}

interface AdaptCtx {
  version: string;
  direction: "request" | "response";
  location: string;
}

function toContent(
  mediaType: string,
  mediaObj: unknown,
  ctx: AdaptCtx
): ContentDefinition {
  if (!isJsonMediaType(mediaType)) {
    return {
      mediaType,
      supported: false,
      diagnostics: [
        diag("warning", `Media type ${mediaType} is not validatable - only JSON bodies are supported in this release.`, {
          location: ctx.location,
        }),
      ],
    };
  }
  const schema = (mediaObj as Record<string, unknown> | null)?.schema;
  if (schema === undefined) {
    return {
      mediaType,
      supported: false,
      diagnostics: [diag("warning", `Media type ${mediaType} declares no schema - nothing to validate against.`, { location: ctx.location })],
    };
  }
  const adapted = adaptSchema(schema, { version: ctx.version, direction: ctx.direction });
  return {
    mediaType,
    schema: adapted.supported ? adapted.schema : undefined,
    supported: adapted.supported,
    diagnostics: adapted.diagnostics,
  };
}

function toParameters(list: unknown, pathLevel: ParameterDefinition[]): ParameterDefinition[] {
  const out = [...pathLevel];
  if (!Array.isArray(list)) return out;
  for (const p of list) {
    if (typeof p !== "object" || p === null) continue;
    const rec = p as Record<string, unknown>;
    if (typeof rec.name !== "string") continue;
    out.push({
      name: rec.name,
      in: rec.in === "query" || rec.in === "header" || rec.in === "path" || rec.in === "cookie" ? rec.in : "query",
      required: rec.required === true || rec.in === "path",
    });
  }
  return out;
}

/** Extract operations from a dereferenced OpenAPI document. */
export function extractOperations(
  dereferenced: unknown,
  version: string
): { operations: Operation[]; diagnostics: ContractDiagnostic[]; schemaCount: number } {
  const diagnostics: ContractDiagnostic[] = [];
  const operations: Operation[] = [];
  const doc = dereferenced as Record<string, unknown>;
  const paths = (doc?.paths ?? {}) as Record<string, unknown>;
  const seenIds = new Set<string>();

  const components = (doc?.components as Record<string, unknown> | undefined)?.schemas as
    | Record<string, unknown>
    | undefined;
  const schemaCount = components && typeof components === "object" ? Object.keys(components).length : 0;

  for (const [path, pathItem] of Object.entries(paths)) {
    if (typeof pathItem !== "object" || pathItem === null) continue;
    const item = pathItem as Record<string, unknown>;
    const pathParams = toParameters(item.parameters, []);

    for (const method of HTTP_METHODS) {
      const raw = item[method];
      if (typeof raw !== "object" || raw === null) continue;
      const op = raw as Record<string, unknown>;
      const methodUpper = method.toUpperCase();

      let id = `${methodUpper} ${path}`;
      let n = 2;
      while (seenIds.has(id)) id = `${methodUpper} ${path} (${n++})`;
      seenIds.add(id);

      const opDiagnostics: ContractDiagnostic[] = [];
      const parameters = toParameters(op.parameters, pathParams);

      // Request body
      let request: RequestDefinition | undefined;
      const rawRequest = op.requestBody as Record<string, unknown> | undefined;
      if (rawRequest && typeof rawRequest === "object") {
        const content = (rawRequest.content ?? {}) as Record<string, unknown>;
        const entries = Object.entries(content);
        if (entries.length === 0) {
          opDiagnostics.push(diag("warning", "Request body declares no content - request validation unavailable.", { location: `#/paths/${path}/${method}/requestBody` }));
        } else {
          request = {
            required: rawRequest.required === true,
            contentTypes: entries.map(([mt, media]) =>
              toContent(mt, media, { version, direction: "request", location: `#/paths/${path}/${method}/requestBody/content/${mt}` })
            ),
          };
        }
      }

      // Responses
      const responses: ResponseDefinition[] = [];
      const rawResponses = (op.responses ?? {}) as Record<string, unknown>;
      for (const [statusCode, rawResp] of Object.entries(rawResponses)) {
        if (typeof rawResp !== "object" || rawResp === null) continue;
        const resp = rawResp as Record<string, unknown>;
        const content = (resp.content ?? {}) as Record<string, unknown>;
        responses.push({
          statusCode,
          description: typeof resp.description === "string" ? resp.description : undefined,
          contentTypes: Object.entries(content).map(([mt, media]) =>
            toContent(mt, media, { version, direction: "response", location: `#/paths/${path}/${method}/responses/${statusCode}/content/${mt}` })
          ),
        });
      }
      if (responses.length === 0) {
        opDiagnostics.push(diag("warning", "Operation declares no responses - response validation unavailable.", { location: `#/paths/${path}/${method}/responses` }));
      }

      operations.push({
        id,
        path,
        method: methodUpper,
        operationId: typeof op.operationId === "string" ? op.operationId : undefined,
        summary: typeof op.summary === "string" ? op.summary : undefined,
        description: typeof op.description === "string" ? op.description : undefined,
        parameters,
        request,
        responses,
        diagnostics: opDiagnostics,
      });
    }
  }

  if (operations.length === 0) {
    diagnostics.push(diag("error", "No operations found under #/paths.", { location: "#/paths" }));
  }

  return { operations, diagnostics, schemaCount };
}
