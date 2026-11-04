import type { ApiProject, OperationDef, PropertyDef, SchemaDef } from "./types";

const NOW = 1758412800000; // fixed seed timestamp (deterministic fixtures)

function prop(
  externalName: string,
  type: string,
  required: boolean,
  extra: Partial<PropertyDef> = {}
): PropertyDef {
  return {
    externalName,
    description: "",
    type,
    required,
    nullable: false,
    ...extra,
  };
}

function op(
  id: string,
  name: string,
  operationId: string,
  method: OperationDef["method"],
  route: string,
  summary: string,
  extra: Partial<OperationDef> = {}
): OperationDef {
  return {
    id,
    name,
    operationId,
    summary,
    description: "",
    tags: ["Lead"],
    method,
    route,
    resource: "Lead",
    interaction: "sync-request-response",
    requestSchema: null,
    responseSchema: null,
    parameters: [],
    errorResponses: [],
    security: [],
    status: "draft",
    dependencies: [],
    notes: "",
    ...extra,
  };
}

const ERRORS = [
  { name: "BadRequest", status: 400, code: "BAD_REQUEST", message: "The request body failed validation.", retryable: false, classification: "technical" as const },
  { name: "Unauthorized", status: 401, code: "UNAUTHORIZED", message: "Missing or invalid credentials.", retryable: false, classification: "technical" as const },
  { name: "Conflict", status: 409, code: "DUPLICATE", message: "A matching record already exists.", retryable: false, classification: "business" as const },
];

const leadCreateRequest: SchemaDef = {
  name: "LeadCreateRequest",
  description: "Acquisition payload for creating a lead.",
  properties: [
    { ...prop("sourceLeadId", "string", false, { description: "External acquisition identifier.", source: undefined }), },
    { ...prop("firstName", "string", false, { maxLength: 40, source: { objectApiName: "Lead", fieldApiName: "FirstName" }, mapping: { targetObject: "Lead", targetField: "FirstName", transform: "direct", direction: "inbound", ownership: "consumer" } }) },
    { ...prop("lastName", "string", true, { maxLength: 80, source: { objectApiName: "Lead", fieldApiName: "LastName" }, mapping: { targetObject: "Lead", targetField: "LastName", transform: "direct", direction: "inbound", ownership: "consumer" } }) },
    { ...prop("company", "string", true, { maxLength: 255, source: { objectApiName: "Lead", fieldApiName: "Company" }, mapping: { targetObject: "Lead", targetField: "Company", transform: "direct", direction: "inbound", ownership: "consumer" } }) },
    { ...prop("email", "string", false, { format: "email", source: { objectApiName: "Lead", fieldApiName: "Email" }, mapping: { targetObject: "Lead", targetField: "Email", transform: "lowercase", direction: "inbound", ownership: "consumer" } }) },
    { ...prop("leadSource", "string", false, { enum: ["Web", "Partner", "Campaign"], source: { objectApiName: "Lead", fieldApiName: "LeadSource" }, mapping: { targetObject: "Lead", targetField: "LeadSource", transform: "direct", direction: "inbound", ownership: "consumer" } }) },
  ],
};

const leadCreateResponse: SchemaDef = {
  name: "LeadCreateResponse",
  description: "Created lead identity.",
  properties: [
    prop("leadId", "string", true, { description: "Created Salesforce record ID." }),
    prop("status", "string", true, { enum: ["New"] }),
    prop("createdAt", "string", true, { format: "date-time", readOnly: true }),
    prop("sourceLeadId", "string", false),
  ],
};

const leadEnrichRequest: SchemaDef = {
  name: "LeadEnrichRequest",
  description: "Provider-supplied enrichment patch.",
  properties: [
    { ...prop("company", "string", false, { source: { objectApiName: "Lead", fieldApiName: "Company" }, mapping: { targetObject: "Lead", targetField: "Company", transform: "direct", direction: "inbound", ownership: "shared" } }) },
    { ...prop("website", "string", false, { format: "uri", source: { objectApiName: "Lead", fieldApiName: "Website" }, mapping: { targetObject: "Lead", targetField: "Website", transform: "lowercase", direction: "inbound", ownership: "shared" } }) },
    { ...prop("industry", "string", false, { source: { objectApiName: "Lead", fieldApiName: "Industry" }, mapping: { targetObject: "Lead", targetField: "Industry", transform: "enum-map", enumMap: { Tech: "Technology" }, direction: "inbound", ownership: "shared" } }) },
    { ...prop("numberOfEmployees", "integer", false, { source: { objectApiName: "Lead", fieldApiName: "NumberOfEmployees" }, mapping: { targetObject: "Lead", targetField: "NumberOfEmployees", transform: "direct", direction: "inbound", ownership: "shared" } }) },
    { ...prop("annualRevenue", "number", false, { source: { objectApiName: "Lead", fieldApiName: "AnnualRevenue" }, mapping: { targetObject: "Lead", targetField: "AnnualRevenue", transform: "direct", direction: "inbound", ownership: "shared" } }) },
  ],
};

const leadEnrichResponse: SchemaDef = {
  name: "LeadEnrichResponse",
  description: "Enrichment acknowledgement.",
  properties: [
    prop("leadId", "string", true),
    prop("status", "string", true),
  ],
};

function base(name: string, id: string): ApiProject {
  return {
    id,
    name,
    intent: {
      apiName: name,
      capability: "Lead management",
      purpose: `${name} business purpose.`,
      outOfScope: "",
      businessOwner: "",
      technicalOwner: "",
      lifecycle: "draft",
      targetRelease: "",
      constraints: "",
    },
    consumer: { system: "", owner: "" },
    provider: { system: "Salesforce-facing API layer", owner: "" },
    direction: "inbound",
    trustBoundary: "",
    servers: [{ url: "https://api.example.com", description: "External implementation (placeholder)." }],
    boundary: { resources: ["Lead"], entityOriented: true, hiddenInfo: "", participatingObjects: ["Lead"] },
    operations: [],
    schemas: [],
    errors: ERRORS.map((e) => ({ ...e })),
    rules: [],
    securitySchemes: [
      { name: "OAuth2", kind: "oauth2", description: "Client credentials (placeholder, no secrets exported)." },
    ],
    defaultSecurity: ["OAuth2"],
    runtime: {},
    decisions: [],
    review: { state: "incomplete", findings: [] },
    approval: { state: "draft", by: "", at: null },
    apiVersion: "1.0.0",
    salesforceApiVersion: "v66.0",
    metadataRefs: { Lead: "seed" },
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** Project A: Lead Acquisition (Marketing Platform → POST /leads). */
export function seedAcquisitionProject(): ApiProject {
  const p = base("Lead Acquisition API", "arch-acquisition");
  p.consumer = { system: "Marketing Platform", owner: "" };
  p.operations = [
    op("op-acq-create", "Create lead", "createLead", "POST", "/leads", "Create a lead", {
      requestSchema: "LeadCreateRequest",
      responseSchema: "LeadCreateResponse",
      errorResponses: ["BadRequest", "Unauthorized", "Conflict"],
      security: ["OAuth2"],
    }),
    op("op-acq-get", "Get lead", "getLead", "GET", "/leads/{leadId}", "Retrieve a lead by ID", {
      responseSchema: "LeadCreateResponse",
      errorResponses: ["Unauthorized"],
      security: ["OAuth2"],
      parameters: [{ name: "leadId", in: "path", required: true, type: "string", description: "Salesforce record ID." }],
    }),
  ];
  p.schemas = [leadCreateRequest, leadCreateResponse];
  return p;
}

/** Project B: Lead Enrichment (Provider → PATCH /leads/{leadId}). */
export function seedEnrichmentProject(): ApiProject {
  const p = base("Lead Enrichment API", "arch-enrichment");
  p.consumer = { system: "Enrichment Provider", owner: "" };
  p.operations = [
    op("op-enr-patch", "Enrich lead", "enrichLead", "PATCH", "/leads/{leadId}", "Update selected lead details", {
      requestSchema: "LeadEnrichRequest",
      responseSchema: "LeadEnrichResponse",
      errorResponses: ["BadRequest", "Unauthorized"],
      security: ["OAuth2"],
      parameters: [{ name: "leadId", in: "path", required: true, type: "string", description: "Salesforce record ID." }],
    }),
  ];
  p.schemas = [leadEnrichRequest, leadEnrichResponse];
  p.rules = [    {
      id: "rule-enr-1",
      description: "Provider may update company data but not acquisition attribution.",
      kind: "constraint-note",
    },
  ];
  return p;
}
