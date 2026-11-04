import type { ContractFieldMeta } from "./metadata-adapter";

/**
 * Explicit Salesforce → JSON Schema mapping (§10). Every branch is tested;
 * unmappable or polymorphic cases emit warnings instead of fake schemas.
 */

export interface JsonSchema {
  type?: string;
  format?: string;
  maxLength?: number;
  enum?: string[];
  description?: string;
  default?: unknown;
  nullable?: boolean;
  [key: string]: unknown;
}

export interface TypeMapResult {
  schema: JsonSchema;
  warnings: string[];
}

/** Salesforce reference targets that are polymorphic (multi-target). */
export function isPolymorphic(meta: ContractFieldMeta): boolean {
  return meta.sfType === "reference" && meta.referenceTo.length > 1;
}

export function mapSfTypeToJsonSchema(meta: ContractFieldMeta): TypeMapResult {
  const warnings: string[] = [];
  const t = (meta.sfType || "").toLowerCase();

  const withLength = (s: JsonSchema): JsonSchema =>
    meta.length > 0 && meta.length < 100000 ? { ...s, maxLength: meta.length } : s;

  switch (t) {
    case "string":
    case "textarea":
    case "longtextarea":
    case "phone":
      return { schema: withLength({ type: "string" }), warnings };
    case "email":
      return { schema: withLength({ type: "string", format: "email" }), warnings };
    case "url":
      return { schema: withLength({ type: "string", format: "uri" }), warnings };
    case "boolean":
      return { schema: { type: "boolean" }, warnings };
    case "int":
      return { schema: { type: "integer" }, warnings };
    case "double":
    case "currency":
    case "percent":
      return { schema: { type: "number" }, warnings };
    case "date":
      return { schema: { type: "string", format: "date" }, warnings };
    case "datetime":
      return { schema: { type: "string", format: "date-time" }, warnings };
    case "id":
      return { schema: { type: "string", description: "Salesforce ID (18-character)." }, warnings };
    case "reference": {
      const targets = meta.referenceTo;
      if (targets.length === 0) {
        warnings.push(`${meta.apiName}: reference with no known targets - emitted as plain ID string.`);
        return { schema: { type: "string", description: "Salesforce reference ID." }, warnings };
      }
      if (targets.length > 1) {
        warnings.push(
          `${meta.apiName}: polymorphic reference (${targets.join(", ")}) - emitted as ID string, marked explicitly.`
        );
        return {
          schema: {
            type: "string",
            description: `Polymorphic reference ID. Valid targets: ${targets.join(", ")}.`,
            "x-sf-polymorphic": targets,
          },
          warnings,
        };
      }
      return {
        schema: { type: "string", description: `Reference ID → ${targets[0]}.` },
        warnings,
      };
    }
    case "picklist":
    case "multipicklist": {
      const active = meta.picklistValues.filter((p) => p.active).map((p) => p.value);
      if (active.length === 0) {
        warnings.push(`${meta.apiName}: picklist has no active values - enum omitted, metadata may be stale.`);
        return { schema: { type: "string" }, warnings };
      }
      const schema: JsonSchema = { type: "string", enum: active };
      if (meta.restrictedPicklist) {
        schema.description = "Restricted picklist - only the listed values validate.";
      }
      if (t === "multipicklist") {
        schema.description = `${schema.description ?? ""} Multi-select: semicolon-separated values.`.trim();
      }
      return { schema, warnings };
    }
    case "base64":
      warnings.push(`${meta.apiName}: binary content - emitted as base64 string.`);
      return { schema: { type: "string", format: "byte" }, warnings };
    case "address":
    case "location":
      warnings.push(`${meta.apiName}: compound ${t} type - emitted as free-form object, verify semantics.`);
      return {
        schema: { type: "object", description: `Compound Salesforce ${t} - verify field semantics.` },
        warnings,
      };
    default:
      warnings.push(`${meta.apiName}: unsupported Salesforce type "${meta.sfType}" - emitted as string.`);
      return { schema: { type: "string" }, warnings };
  }
}
