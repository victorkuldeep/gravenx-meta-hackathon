/**
 * Validate workspace - specification ingestion.
 *
 * Detects JSON/YAML, enforces size limits, parses safely, identifies the
 * OpenAPI version, structurally validates via @scalar/openapi-parser and
 * dereferences LOCAL refs only. Never fetches remote $refs.
 */

import { parse as parseYaml } from "yaml";
import type { ContractDiagnostic, ContractFormat, ParsedContract } from "./types";

export const MAX_SPEC_BYTES = 5 * 1024 * 1024;
export const MAX_SPEC_TEXT = 2_000_000;

let contractSeq = 0;

function diag(
  id: string,
  severity: ContractDiagnostic["severity"],
  message: string,
  opts?: Partial<ContractDiagnostic>
): ContractDiagnostic {
  return { id, severity, message, blocking: severity === "error", ...opts };
}

/** Detect source format from filename + content sniffing. */
export function detectFormat(fileName: string, text: string): "json" | "yaml" {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") ? "json" : "yaml";
}

/** Parse raw text; returns the document or a diagnostic. Never throws. */
export function parseSpecText(
  text: string,
  format: "json" | "yaml"
): { document?: unknown; diagnostic?: ContractDiagnostic } {
  try {
    if (format === "json") {
      return { document: JSON.parse(text) };
    }
    const doc = parseYaml(text, { strict: true, uniqueKeys: true });
    return { document: doc ?? {} };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      diagnostic: diag("parse-error", "error", `Could not parse ${format.toUpperCase()}: ${message}`, {
        hint: format === "yaml" ? "Check indentation and quoting - YAML is whitespace-sensitive." : "Validate the JSON with the Format action in the payload editor.",
      }),
    };
  }
}

/** Identify the OpenAPI version string, if present. */
export function detectOpenApiVersion(document: unknown): string | undefined {
  if (typeof document !== "object" || document === null) return undefined;
  const v = (document as Record<string, unknown>).openapi;
  return typeof v === "string" ? v : undefined;
}

/** Collect external $ref targets so we can refuse them explicitly. */
export function findExternalRefs(document: unknown, seen = new Set<unknown>()): string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node !== "object" || node === null || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "$ref" && typeof v === "string" && !v.startsWith("#")) found.push(v);
      else walk(v);
    }
  };
  walk(document);
  return [...new Set(found)];
}

/** Structural validation via Scalar. Returns messages (empty = clean). */
export async function scalarCheck(document: unknown): Promise<string[]> {
  try {
    const { validate } = await import("@scalar/openapi-parser");
    const result = await validate(document as never);
    const errors = (result as { errors?: unknown[] }).errors ?? [];
    return errors.map((e) =>
      typeof e === "string" ? e : String((e as { message?: string }).message ?? JSON.stringify(e))
    );
  } catch (err) {
    return [`Structural check could not run: ${err instanceof Error ? err.message : String(err)}`];
  }
}

/** Dereference local refs via Scalar. External refs are refused, never fetched. */
export async function dereferenceLocal(document: unknown): Promise<{ schema?: unknown; errors: string[] }> {
  try {
    const { dereference } = await import("@scalar/openapi-parser");
    const result = (await dereference(document as never, {
      throwOnError: false,
    } as never)) as { schema?: unknown; errors?: unknown[] };
    const errors = (result.errors ?? []).map((e) =>
      typeof e === "string" ? e : String((e as { message?: string }).message ?? JSON.stringify(e))
    );
    return { schema: result.schema, errors };
  } catch (err) {
    return { errors: [`Reference resolution failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

export interface IngestInput {
  fileName: string;
  text: string;
  byteSize: number;
}

/**
 * Full ingestion pipeline: limits -> detect -> parse -> identify ->
 * structural check -> external-ref policy -> dereference.
 * Returns a ParsedContract SKELETON (operations filled by operations.ts).
 */
export async function ingestSpec(input: IngestInput): Promise<{
  contract: Omit<ParsedContract, "operations" | "status" | "schemaCount">;
  dereferenced?: unknown;
  diagnostics: ContractDiagnostic[];
  fatal: boolean;
}> {
  const diagnostics: ContractDiagnostic[] = [];
  const format = detectFormat(input.fileName, input.text);
  const contractFormat: ContractFormat = format === "json" ? "openapi-json" : "openapi-yaml";

  if (input.byteSize > MAX_SPEC_BYTES || input.text.length > MAX_SPEC_TEXT) {
    return {
      contract: {
        id: `contract-${++contractSeq}`,
        name: input.fileName,
        format: contractFormat,
        originalText: "",
        diagnostics: [],
      },
      diagnostics: [
        diag("size-limit", "error", `Specification exceeds the ${(MAX_SPEC_BYTES / 1024 / 1024).toFixed(0)} MB import limit.`, {
          blocking: true,
          hint: "Split the contract or remove embedded examples before importing.",
        }),
      ],
      fatal: true,
    };
  }

  const { document, diagnostic } = parseSpecText(input.text, format);
  if (!document || diagnostic) {
    return {
      contract: {
        id: `contract-${++contractSeq}`,
        name: input.fileName,
        format: contractFormat,
        originalText: input.text,
        diagnostics: [],
      },
      diagnostics: diagnostic ? [diagnostic] : [diag("empty", "error", "The specification is empty.")],
      fatal: true,
    };
  }

  const version = detectOpenApiVersion(document);
  if (!version) {
    const looksSwagger =
      typeof document === "object" && document !== null && "swagger" in document;
    return {
      contract: {
        id: `contract-${++contractSeq}`,
        name: input.fileName,
        format: contractFormat,
        originalText: input.text,
        diagnostics: [],
      },
      diagnostics: [
        diag(
          looksSwagger ? "swagger-2.0" : "no-version",
          "error",
          looksSwagger
            ? "Swagger 2.0 is not supported - convert the document to OpenAPI 3.0 or 3.1 first."
            : "No OpenAPI version found - this does not look like an OpenAPI document.",
          {
            location: "#",
            hint: "Only OpenAPI 3.0 and 3.1 documents are supported in this release.",
          }
        ),
      ],
      fatal: true,
    };
  }

  const major = version.startsWith("3.1") ? "3.1" : version.startsWith("3.0") ? "3.0" : null;
  if (!major) {
    diagnostics.push(
      diag("unsupported-version", "error", `OpenAPI version ${version} is not supported. Only 3.0.x and 3.1.x are supported.`, {
        location: "#/openapi",
        hint: "Convert Swagger 2.0 documents to OpenAPI 3.x before importing.",
      })
    );
    return {
      contract: {
        id: `contract-${++contractSeq}`,
        name: input.fileName,
        format: contractFormat,
        version,
        originalText: input.text,
        diagnostics: [],
      },
      diagnostics,
      fatal: true,
    };
  }

  const structural = await scalarCheck(document);
  for (const msg of structural.slice(0, 25)) {
    diagnostics.push(diag(`structural-${diagnostics.length}`, "warning", msg, { location: "#" }));
  }

  const external = findExternalRefs(document);
  if (external.length > 0) {
    diagnostics.push(
      diag("external-refs", "error", `${external.length} external $ref(s) found - remote references are never fetched. Inline them before importing.`, {
        hint: external.slice(0, 3).join(", "),
      })
    );
    return {
      contract: {
        id: `contract-${++contractSeq}`,
        name: input.fileName,
        format: contractFormat,
        version,
        dialect: major === "3.1" ? "https://json-schema.org/draft/2020-12/schema" : "openapi-3.0",
        originalText: input.text,
        diagnostics: [],
      },
      diagnostics,
      fatal: true,
    };
  }

  const { schema: dereferenced, errors: derefErrors } = await dereferenceLocal(document);
  for (const msg of derefErrors.slice(0, 25)) {
    diagnostics.push(
      diag(`deref-${diagnostics.length}`, "error", msg, {
        hint: "Unresolved references block trustworthy validation.",
      })
    );
  }
  if (derefErrors.length > 0) {
    return {
      contract: {
        id: `contract-${++contractSeq}`,
        name: input.fileName,
        format: contractFormat,
        version,
        dialect: major === "3.1" ? "https://json-schema.org/draft/2020-12/schema" : "openapi-3.0",
        originalText: input.text,
        diagnostics: [],
      },
      diagnostics,
      fatal: true,
    };
  }

  return {
    contract: {
      id: `contract-${++contractSeq}`,
      name: input.fileName,
      format: contractFormat,
      version,
      dialect: major === "3.1" ? "https://json-schema.org/draft/2020-12/schema" : "openapi-3.0",
      originalText: input.text,
      diagnostics: [],
    },
    dereferenced,
    diagnostics,
    fatal: false,
  };
}
