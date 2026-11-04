import { effectiveRequired } from "../contracts/field-policy";
import { mapSfTypeToJsonSchema } from "../contracts/type-mapper";
import type { ContractFieldMeta } from "../contracts/metadata-adapter";
import type { PropertyDef } from "./types";

/**
 * Architect-owned property prefill from metadata facts. The architect
 * owns every value after creation - prefill is a suggestion, never
 * a silent decision.
 */
export function prefillProperty(
  objectApiName: string,
  meta: ContractFieldMeta
): Omit<PropertyDef, "description" | "notes"> & { description: string; notes?: string } {
  const mapped = mapSfTypeToJsonSchema(meta);
  const schema = mapped.schema;
  const req = effectiveRequired(meta, false, "POST");
  return {
    externalName: meta.apiName,
    description: "",
    type: typeof schema.type === "string" ? schema.type : "string",
    ...(typeof schema.format === "string" ? { format: schema.format } : {}),
    ...(Array.isArray(schema.enum) ? { enum: [...(schema.enum as string[])] } : {}),
    required: req.required,
    nullable: meta.nillable,
    ...(typeof schema.maxLength === "number" ? { maxLength: schema.maxLength } : {}),
    source: { objectApiName, fieldApiName: meta.apiName },
  };
}
