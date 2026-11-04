/**
 * Starter gallery for Sequence Studio: three training cuts that parse
 * cleanly and show the interaction language at increasing depth. The RCA
 * flow is the original in-app sample; the other two mirror the flagship
 * Salesforce -> Middleware -> ServiceNow story architects actually run.
 */
export interface SequenceSample {
  name: string;
  hint: string;
  dsl: string;
}

const RCA_DSL = [
  "participant React",
  "participant Salesforce",
  "React -> Salesforce: Configure request",
  "Salesforce --> React: Transaction context",
  "if valid",
  "React -> Salesforce: Update attributes",
  "Salesforce --> React: Final pricing",
  "else",
  "Salesforce --> React: Validation errors",
  "end",
].join("\n");

const ORDER_FULFILLMENT_DSL = [
  "participant Salesforce",
  "participant Middleware",
  "participant ServiceNow",
  "Salesforce -> Middleware: Create Order",
  "Middleware -> ServiceNow: Create Fulfillment",
  "if serviceable",
  "ServiceNow --> Middleware: Fulfillment Accepted",
  "parallel downstream fan-out",
  "Middleware -> Salesforce: Update Order Status",
  "Middleware -> ServiceNow: Confirm Fulfillment",
  "end",
  "Middleware --> Salesforce: Order Accepted",
  "else not serviceable",
  "Middleware --> Salesforce: Mark Order Exception",
  "end",
].join("\n");

const RETRY_PATTERN_DSL = [
  "participant Portal",
  "participant Middleware",
  "participant Billing",
  "Portal -> Middleware: Submit Order",
  "retry 3 times wait 5s",
  "Middleware -> Billing: Create Subscription",
  "end",
  "Billing --> Middleware: Subscription Created",
  "note Billing is down? Sign an override on the run",
  "Middleware --> Portal: Order Confirmed",
].join("\n");

export const SEQUENCE_SAMPLES: SequenceSample[] = [
  {
    name: "Sample: RCA configure flow",
    hint: "Sync request, transaction context, a condition branch.",
    dsl: RCA_DSL,
  },
  {
    name: "Sample: order to fulfillment",
    hint: "Salesforce to middleware to ServiceNow with fan-out.",
    dsl: ORDER_FULFILLMENT_DSL,
  },
  {
    name: "Sample: retry pattern",
    hint: "Retry block plus an architect note on the evidence.",
    dsl: RETRY_PATTERN_DSL,
  },
];
