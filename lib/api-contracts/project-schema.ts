import { z } from "zod";

/** Zod validation for the canonical API project (project layer). */

const methodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const directionSchema = z.enum(["inbound", "outbound", "bidirectional"]);
const ownershipSchema = z.enum(["consumer", "salesforce", "shared"]);
const transformSchema = z.enum([
  "direct",
  "trim",
  "lowercase",
  "uppercase",
  "date-format",
  "enum-map",
  "concat",
  "constant",
]);

const propertySchema = z.object({
  externalName: z.string().min(1),
  description: z.string(),
  type: z.string().min(1),
  format: z.string().optional(),
  enum: z.array(z.string()).optional(),
  required: z.boolean(),
  nullable: z.boolean(),
  readOnly: z.boolean().optional(),
  writeOnly: z.boolean().optional(),
  maxLength: z.number().int().positive().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  pattern: z.string().optional(),
  default: z.unknown().optional(),
  example: z.unknown().optional(),
  source: z.object({ objectApiName: z.string(), fieldApiName: z.string() }).optional(),
  mapping: z
    .object({
      targetObject: z.string().min(1),
      targetField: z.string().min(1),
      transform: transformSchema,
      dateFormat: z.string().optional(),
      enumMap: z.record(z.string(), z.string()).optional(),
      direction: z.enum(["inbound", "outbound"]),
      ownership: ownershipSchema,
      default: z.unknown().optional(),
      nullHandling: z.string().optional(),
    })
    .optional(),
  notes: z.string().optional(),
});

const schemaDefSchema = z.object({
  name: z.string().min(1).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  description: z.string(),
  properties: z.array(propertySchema),
});

const paramSchema = z.object({
  name: z.string().min(1),
  in: z.enum(["path", "query"]),
  required: z.boolean(),
  type: z.string().min(1),
  description: z.string(),
});

const operationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  operationId: z.string().min(1).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  summary: z.string().min(1),
  description: z.string(),
  tags: z.array(z.string()),
  method: methodSchema,
  route: z.string().min(1).regex(/^\//, "Route must start with /"),
  resource: z.string(),
  interaction: z.enum(["sync-request-response", "async-command", "event-notification", "query", "batch"]),
  requestSchema: z.string().nullable(),
  responseSchema: z.string().nullable(),
  parameters: z.array(paramSchema),
  errorResponses: z.array(z.string()),
  security: z.array(z.string()),
  status: z.enum(["draft", "ready", "approved"]),
  dependencies: z.array(z.string()),
  notes: z.string(),
});

const errorSchema = z.object({
  name: z.string().min(1),
  status: z.number().int().min(100).max(599),
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  classification: z.enum(["business", "technical"]),
});

const ruleSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  kind: z.enum(["conditional-required", "constraint-note"]),
  whenField: z.string().optional(),
  whenEquals: z.unknown().optional(),
  requireFields: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

const decisionSchema = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.string()),
  chosen: z.string(),
  rationale: z.string(),
  owner: z.string(),
  status: z.enum(["proposed", "accepted", "rejected", "deferred", "needs-clarification"]),
  suggested: z.boolean(),
  relatedOps: z.array(z.string()),
  createdAt: z.number(),
  revision: z.number().int().nonnegative(),
});

export const apiProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Project name is required"),
  intent: z.object({
    apiName: z.string().min(1),
    capability: z.string().min(1),
    purpose: z.string().min(1),
    outOfScope: z.string(),
    businessOwner: z.string(),
    technicalOwner: z.string(),
    lifecycle: z.enum(["draft", "in-design", "in-review", "approved", "deprecated", "archived"]),
    targetRelease: z.string(),
    constraints: z.string(),
  }),
  consumer: z.object({ system: z.string().min(1), owner: z.string() }),
  provider: z.object({ system: z.string().min(1), owner: z.string() }),
  direction: directionSchema,
  trustBoundary: z.string(),
  servers: z.array(z.object({ url: z.string().min(1), description: z.string() })),
  boundary: z.object({
    resources: z.array(z.string()),
    entityOriented: z.boolean(),
    hiddenInfo: z.string(),
    participatingObjects: z.array(z.string()),
  }),
  operations: z.array(operationSchema),
  schemas: z.array(schemaDefSchema),
  errors: z.array(errorSchema),
  rules: z.array(ruleSchema),
  securitySchemes: z.array(
    z.object({ name: z.string().min(1), kind: z.enum(["oauth2", "apiKey", "none"]), description: z.string() })
  ),
  defaultSecurity: z.array(z.string()),
  runtime: z.object({
    rateLimit: z.string().optional(),
    timeout: z.string().optional(),
    retry: z.string().optional(),
    idempotency: z.string().optional(),
    pagination: z.string().optional(),
    deprecation: z.string().optional(),
  }),
  decisions: z.array(decisionSchema),
  review: z.object({
    state: z.enum(["incomplete", "ready", "changes-requested", "approved"]),
    findings: z.array(
      z.object({
        id: z.string(),
        category: z.enum(["business", "interface", "data", "behavior", "security", "governance"]),
        severity: z.enum(["error", "warning", "info"]),
        message: z.string(),
        relatedOps: z.array(z.string()),
      })
    ),
  }),
  approval: z.object({
    state: z.enum(["draft", "approved", "deprecated"]),
    by: z.string(),
    at: z.number().nullable(),
  }),
  apiVersion: z.string().min(1),
  salesforceApiVersion: z.string().min(1),
  metadataRefs: z.record(z.string(), z.string()),
  version: z.number().int().nonnegative(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export function validateApiProject(project: unknown): { ok: boolean; errors: string[] } {
  const r = apiProjectSchema.safeParse(project);
  if (r.success) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join(".") || "project"}: ${i.message}`),
  };
}
