import { z } from "zod";

/**
 * Zod validation for the studio's OWN canonical profile configuration
 * (validation layer A). OpenAPI-level validation lives in diagnostics.ts
 * and @scalar/openapi-parser.
 */

const operationSchema = z.enum(["POST", "PATCH"]);
const directionSchema = z.enum(["inbound", "outbound", "bidirectional"]);
const transformSchema = z.enum([
  "direct",
  "trim",
  "lowercase",
  "uppercase",
  "date-format",
  "enum-map",
]);
const ownershipSchema = z.enum(["consumer", "salesforce", "shared"]);

const mappingSchema = z.object({
  externalName: z.string().min(1, "External name is required"),
  targetField: z.string().min(1, "Target field is required"),
  transform: transformSchema,
  dateFormat: z.string().optional(),
  enumMap: z.record(z.string(), z.string()).optional(),
  direction: z.enum(["inbound", "outbound"]),
  ownership: ownershipSchema,
  notes: z.string().optional(),
});

const fieldConfigSchema = z.object({
  salesforceApiName: z.string().min(1, "Salesforce API name is required"),
  externalName: z.string().min(1, "External name is required"),
  label: z.string(),
  description: z.string(),
  operations: z.array(operationSchema).min(1, "At least one operation is required"),
  integrationRequired: z.boolean(),
  nullable: z.boolean(),
  defaultValue: z.unknown().optional(),
  enumOverride: z.array(z.string()).optional(),
  ownership: ownershipSchema,
  mapping: mappingSchema.optional(),
});

const operationConfigSchema = z.object({
  operation: operationSchema,
  enabled: z.boolean(),
  operationId: z.string().min(1).regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Must be a valid identifier"),
  summary: z.string().min(1, "Summary is required"),
  description: z.string(),
  tags: z.array(z.string()),
});

export const contractProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Profile name is required"),
  description: z.string(),
  targetObjectApiName: z.string().min(1, "Target object is required"),
  orgId: z.string(),
  consumer: z.string().min(1, "Consumer system is required"),
  direction: directionSchema,
  apiTitle: z.string().min(1, "API title is required"),
  apiVersion: z.string().min(1, "API version is required"),
  salesforceApiVersion: z.string().min(1),
  baseUrl: z.string(),
  resourcePath: z.string(),
  operations: z.array(operationConfigSchema),
  fields: z.array(fieldConfigSchema),
  security: z.object({
    type: z.enum(["oauth2-client-credentials", "api-key", "none"]),
    description: z.string(),
  }),
  revision: z.number().int().nonnegative(),
  createdAt: z.number(),
  updatedAt: z.number(),
  metadataSnapshotRef: z.string().nullable(),
  metadataCapturedAt: z.number().nullable(),
});

export type ContractProfileInput = z.infer<typeof contractProfileSchema>;

/** Parse + flatten zod errors for UI display. */
export function validateProfileConfig(profile: unknown): { ok: boolean; errors: string[] } {
  const r = contractProfileSchema.safeParse(profile);
  if (r.success) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join(".") || "profile"}: ${i.message}`),
  };
}
