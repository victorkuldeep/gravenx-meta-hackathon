import type { ContractFieldMeta } from "./metadata-adapter";
import { allowedForOperation, effectiveRequired } from "./field-policy";
import { mapSfTypeToJsonSchema, type JsonSchema } from "./type-mapper";
import { syntheticExample } from "./examples";
import { diagnoseProfile, type Diagnostic } from "./diagnostics";
import { contentHash, stableStringify, toJsonString, toYamlString } from "./export";
import type { ContractOperation, ContractProfile } from "./types";

/**
 * Deterministic OpenAPI 3.1 compiler. Pure function of
 * (profile, metadata) - no React, no I/O. Same input always yields
 * byte-identical YAML and JSON.
 */

export const COMPILER_VERSION = "contracts-1";
export const OPENAPI_VERSION = "3.1.0";

export interface TraceEntry {
  externalName: string;
  salesforceApiName: string;
  operations: ContractOperation[];
  ownership: string;
  transform: string;
  required: { POST: boolean; PATCH: boolean };
}

export interface CompileInput {
  profile: ContractProfile;
  metaByName: Map<string, ContractFieldMeta>;
  snapshotCapturedAt: number | null;
  now?: number;
}

export interface CompileResult {
  document: Record<string, unknown>;
  diagnostics: Diagnostic[];
  traceability: TraceEntry[];
  examples: Record<string, Record<string, unknown>>;
  hash: string;
  yaml: string;
  json: string;
}

const pascal = (s: string): string =>
  s
    .replace(/__c$/i, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("") || "Object";

function sanitizeId(s: string): string {
  const clean = s.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
  return clean === "" ? "op" : clean;
}

function fieldSchema(
  meta: ContractFieldMeta | undefined,
  cfg: { externalName: string; enumOverride?: string[]; nullable: boolean; defaultValue?: unknown }
): { schema: JsonSchema; warnings: string[] } {
  if (!meta) {
    return {
      schema: { type: "string", description: "Unknown field - not in metadata snapshot." },
      warnings: [`${cfg.externalName}: no metadata, emitted as plain string.`],
    };
  }
  const mapped = mapSfTypeToJsonSchema(meta);
  const schema: JsonSchema = { ...mapped.schema };
  if (cfg.enumOverride && cfg.enumOverride.length > 0) {
    schema.enum = [...cfg.enumOverride];
    schema.description = `${schema.description ?? ""} Contract enum subset.`.trim();
  }
  if (cfg.nullable) schema.nullable = true;
  if (cfg.defaultValue !== undefined) schema.default = cfg.defaultValue;
  return { schema, warnings: mapped.warnings };
}

export function compileContract(input: CompileInput): CompileResult {
  const { profile, metaByName, snapshotCapturedAt, now = Date.now() } = input;
  const diagnostics: Diagnostic[] = diagnoseProfile({ profile, metaByName, snapshotCapturedAt, now });
  const traceability: TraceEntry[] = [];
  const examples: Record<string, Record<string, unknown>> = {};

  const ver = profile.salesforceApiVersion.startsWith("v")
    ? profile.salesforceApiVersion
    : `v${profile.salesforceApiVersion}`;
  const native = profile.baseUrl.trim() === "";
  const objectPascal = pascal(profile.targetObjectApiName);

  const paths: Record<string, unknown> = {};
  const schemas: Record<string, unknown> = {
    StandardError: {
      type: "object",
      required: ["message"],
      properties: {
        message: { type: "string" },
        errorCode: { type: "string" },
        fields: { type: "array", items: { type: "string" } },
      },
    },
  };

  const opOrder: ContractOperation[] = ["POST", "PATCH"];
  for (const opCfg of profile.operations.filter((o) => o.enabled).sort((a, b) => opOrder.indexOf(a.operation) - opOrder.indexOf(b.operation))) {
    const op = opCfg.operation;
    const configured = profile.fields.filter((f) => f.operations.includes(op));
    // Hard gate: metadata-forbidden fields never enter the schema.
    const usable = configured.filter((f) => {
      const meta = metaByName.get(f.salesforceApiName);
      if (!meta) return true; // unknown warned, not dropped (diagnostic covers it)
      return allowedForOperation(meta, op);
    });

    const schemaName = `${objectPascal}${op === "POST" ? "Create" : "Update"}Request`;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    const example: Record<string, unknown> = {};

    for (const f of usable) {
      const meta = metaByName.get(f.salesforceApiName);
      const built = fieldSchema(meta, f);
      for (const w of built.warnings) {
        diagnostics.push({ level: "warning", code: "schema-note", path: `fields.${f.salesforceApiName}.${op}`, message: w });
      }
      properties[f.externalName] = built.schema;
      const req = effectiveRequired(
        meta ?? {
          apiName: f.salesforceApiName, nillable: true, createable: true, updateable: true,
          defaultedOnCreate: false, sfType: "string",
        } as ContractFieldMeta,
        f.integrationRequired,
        op
      );
      // PATCH properties stay optional unless integration-required.
      if (req.required && (op === "POST" || f.integrationRequired)) required.push(f.externalName);
      if (meta) example[f.externalName] = syntheticExample(meta);
      traceability.push({
        externalName: f.externalName,
        salesforceApiName: f.salesforceApiName,
        operations: [op],
        ownership: f.ownership,
        transform: f.mapping?.transform ?? "direct",
        required: { POST: op === "POST" && req.required, PATCH: op === "PATCH" && req.required },
      });
    }

    const schema: Record<string, unknown> = {
      type: "object",
      properties,
      description: `${opCfg.summary} (${profile.targetObjectApiName}).`,
    };
    if (required.length > 0) schema.required = required;
    schemas[schemaName] = schema;
    examples[op] = example;

    const pathKey = native
      ? op === "POST"
        ? `/services/data/${ver}/sobjects/${profile.targetObjectApiName}`
        : `/services/data/${ver}/sobjects/${profile.targetObjectApiName}/{recordId}`
      : op === "POST"
        ? profile.resourcePath || `/${profile.targetObjectApiName}`
        : profile.resourcePath.includes("{id}")
          ? profile.resourcePath
          : `${profile.resourcePath || `/${profile.targetObjectApiName}`}/{id}`;

    const method = op.toLowerCase();
    const pathItem = (paths[pathKey] ?? {}) as Record<string, unknown>;
    const operation: Record<string, unknown> = {
      operationId: sanitizeId(opCfg.operationId),
      summary: opCfg.summary,
      description: opCfg.description,
      tags: [...opCfg.tags],
      responses: op === "POST"
        ? {
            "201": { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/SalesforceCreateResult" } } } },
            "400": { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/StandardError" } } } },
            "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/StandardError" } } } },
          }
        : {
            "200": { description: "Updated", content: { "application/json": { schema: { $ref: "#/components/schemas/SalesforceUpdateResult" } } } },
            "400": { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/StandardError" } } } },
            "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/StandardError" } } } },
            "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/StandardError" } } } },
          },
    };
    if (op === "POST" || op === "PATCH") {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` }, example } },
      };
    }
    if (op === "PATCH") {
      operation.parameters = [
        {
          name: "recordId",
          in: "path",
          required: true,
          description: `Salesforce record ID of the ${profile.targetObjectApiName} to update.`,
          schema: { type: "string" },
        },
      ];
    }
    if (profile.security.type !== "none") {
      operation.security = [{ [profile.security.type === "api-key" ? "ApiKeyAuth" : "OAuth2"]: [] }];
    }
    pathItem[method] = operation;
    paths[pathKey] = pathItem;
  }

  schemas.SalesforceCreateResult = {
    type: "object",
    required: ["id", "success"],
    properties: {
      id: { type: "string", description: "Created record ID." },
      success: { type: "boolean" },
      errors: { type: "array", items: { type: "string" } },
    },
  };
  schemas.SalesforceUpdateResult = {
    type: "object",
    properties: {
      success: { type: "boolean" },
      errors: { type: "array", items: { type: "string" } },
    },
  };

  const document: Record<string, unknown> = {
    openapi: OPENAPI_VERSION,
    info: {
      title: profile.apiTitle,
      version: profile.apiVersion,
      description: profile.description || `${profile.name} - generated by API Contract Studio.`,
    },
    servers: [
      {
        url: native ? "https://<your-org>.my.salesforce.com" : profile.baseUrl,
        description: native
          ? "Salesforce org - replace with the target instance URL. Exporting OpenAPI does not implement an endpoint."
          : "External implementation - distinct from the Salesforce native API.",
      },
    ],
    tags: [{ name: profile.targetObjectApiName, description: `${profile.consumer} (${profile.direction})` }],
    paths,
    components: {
      schemas,
      ...(profile.security.type !== "none"
        ? {
            securitySchemes:
              profile.security.type === "api-key"
                ? { ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key", description: "Placeholder - never export real keys." } }
                : {
                    OAuth2: {
                      type: "oauth2",
                      description: "Placeholder - never export real tokens or secrets.",
                      flows: { clientCredentials: { tokenUrl: "https://login.salesforce.com/services/oauth2/token", scopes: {} } },
                    },
                  },
          }
        : {}),
    },
    "x-contract": {
      profileId: profile.id,
      revision: profile.revision,
      compiler: COMPILER_VERSION,
      generatedAt: new Date(now).toISOString(),
      snapshotRef: profile.metadataSnapshotRef,
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
