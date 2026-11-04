"use client";

import { newProject, newSystemFromTemplate, SYSTEM_TEMPLATES, type SystemProject } from "./model";

/**
 * Demo topology: Lead lands in Salesforce, flows through middleware into
 * ServiceNow, surfaced by a React app. Explains the product in one glance:
 * place, connect, inspect - then replace with your own systems.
 */
export function buildDemoProject(): SystemProject {
  const project = newProject("Demo: Lead triage flow");
  const by = (type: string) => SYSTEM_TEMPLATES.find((t) => t.systemType === type)!;
  const sf = { ...newSystemFromTemplate(by("salesforce"), { x: 80, y: 200 }, 1), name: "Salesforce CRM", id: "sys_demo_sf" };
  const mw = { ...newSystemFromTemplate(by("middleware"), { x: 460, y: 200 }, 1), name: "Integration Broker", id: "sys_demo_mw" };
  const sn = { ...newSystemFromTemplate(by("servicenow"), { x: 840, y: 80 }, 1), name: "ServiceNow ITSM", id: "sys_demo_sn" };
  const app = { ...newSystemFromTemplate(by("webapp"), { x: 840, y: 330 }, 1), name: "Triage Console", id: "sys_demo_app" };
  const echo = { ...newSystemFromTemplate(by("rest"), { x: 1220, y: 200 }, 1), name: "Echo Service", id: "sys_demo_echo", baseUrl: "https://postman-echo.com" };
  project.systems = [sf, mw, sn, app, echo];
  project.connections = [
    { id: "conn_demo_1", sourceId: sf.id, targetId: mw.id, label: "Lead created event", status: "draft" as const, sourceOperationId: "op_demo_lead" },
    { id: "conn_demo_2", sourceId: mw.id, targetId: sn.id, label: "Create incident", status: "draft" as const },
    { id: "conn_demo_3", sourceId: mw.id, targetId: app.id, label: "Push triage view", status: "draft" as const },
    { id: "conn_demo_4", sourceId: mw.id, targetId: echo.id, label: "Forward event", status: "draft" as const, sourceOperationId: "op_demo_forward", targetOperationId: "op_demo_echo" },
  ];
  // One bound end on purpose: the demo opens showing a partial edge next to
  // draft ones, so readiness states are visible immediately.
  project.interfaces = [
    { id: "iface_demo_sf", systemId: sf.id, name: "REST API", protocol: "REST", basePath: "/services/data/v66.0" },
    { id: "iface_demo_mw", systemId: mw.id, name: "Inbound events", protocol: "Events", basePath: "/events/lead" },
    { id: "iface_demo_echo", systemId: echo.id, name: "Echo API", protocol: "REST", basePath: "" },
  ];
  project.operations = [
    { id: "op_demo_lead", interfaceId: "iface_demo_sf", name: "Lead Created", method: "EVENT", path: "/events/lead", version: "v1" },
    { id: "op_demo_incident", interfaceId: "iface_demo_mw", name: "Create incident", method: "POST", path: "/incidents", version: "v1" },
    { id: "op_demo_forward", interfaceId: "iface_demo_mw", name: "Forward event", method: "POST", path: "/forward", version: "v1", sampleBody: '{"x":"hello"}' },
    { id: "op_demo_echo", interfaceId: "iface_demo_echo", name: "Echo POST", method: "POST", path: "/post", version: "v1" },
  ];
  project.environments = [{ id: "env_demo", name: "Sandbox", baseUrl: "", baseUrlOverrides: {} }];
  project.activeEnvironmentId = "env_demo";
  return project;
}

/**
 * Sample topology: static User Input seed flows 1:1 into GROQ chat
 * completions. Proves the concept end to end - the edge template grabs the
 * seed prompt ({{seed.prompt}}) and builds the chat body, auth arrives via
 * the session vault ($env.GROQ_API_KEY in the run token field). No real keys
 * live in this file - the vault holds them for the tab only.
 */
/**
 * Sample topology: Salesforce product-order read flows into middleware two
 * ways - as-is passthrough, and wrapped as an order event via template -
 * then on to the event subscriber. Proves branching lanes, per-hop picks,
 * and request-replay ({{requests.*}}) end to end.
 */
export function buildTmfSampleProject(): SystemProject {
  const project = newProject("Sample: product order → middleware → events");
  const by = (type: string) => SYSTEM_TEMPLATES.find((t) => t.systemType === type)!;
  const sf = { ...newSystemFromTemplate(by("salesforce"), { x: 80, y: 200 }, 1), name: "Salesforce", id: "sys_tmf_sf" };
  const mw = { ...newSystemFromTemplate(by("middleware"), { x: 520, y: 200 }, 1), name: "Middleware Hub", id: "sys_tmf_mw", baseUrl: "https://hub-zsp.zke.dev.public.zayo.com" };
  const sub = { ...newSystemFromTemplate(by("streaming"), { x: 960, y: 200 }, 1), name: "Event Subscriber", id: "sys_tmf_sub" };
  project.systems = [sf, mw, sub];
  project.interfaces = [
    { id: "iface_tmf_sf", systemId: sf.id, name: "Apex REST", protocol: "REST", basePath: "/services/apexrest" },
    { id: "iface_tmf_mw", systemId: mw.id, name: "Hub API", protocol: "REST", basePath: "" },
    { id: "iface_tmf_sub", systemId: sub.id, name: "Intake", protocol: "Events", basePath: "/intake" },
  ];
  project.operations = [
    {
      id: "op_tmf_get", interfaceId: "iface_tmf_sf", name: "Get product order",
      method: "GET", path: "/api/orderManagement/v5/productOrder/revenueCloud/00000238", version: "v1",
    },
    {
      id: "op_tmf_fwd", interfaceId: "iface_tmf_mw", name: "Forward order",
      method: "POST", path: "/v4/productOrder", version: "v1",
      headers: [{ key: "Authorization", value: "Bearer $env.HUB_TOKEN" }],
    },
    {
      id: "op_tmf_pub", interfaceId: "iface_tmf_mw", name: "Publish order event",
      method: "POST", path: "/v4/topic/order-events/event", version: "v1",
      headers: [{ key: "Authorization", value: "Bearer $env.HUB_TOKEN" }],
    },
    {
      id: "op_tmf_in", interfaceId: "iface_tmf_sub", name: "Order event intake",
      method: "POST", path: "/intake/order-events", version: "v1",
    },
  ];
  project.connections = [
    {
      id: "conn_tmf_1", sourceId: sf.id, targetId: mw.id, label: "Order as-is",
      status: "draft" as const, sourceOperationId: "op_tmf_get", targetOperationId: "op_tmf_fwd",
      mapping: { mode: "passthrough" as const, template: "" },
    },
    {
      id: "conn_tmf_2", sourceId: sf.id, targetId: mw.id, label: "Order as event",
      status: "draft" as const, sourceOperationId: "op_tmf_get", targetOperationId: "op_tmf_pub",
      mapping: {
        mode: "template" as const,
        template: '{\n  "event": {\n    "productOrder": {{response}}\n  }\n}',
      },
    },
    {
      id: "conn_tmf_3", sourceId: mw.id, targetId: sub.id, label: "Replay to subscriber",
      status: "draft" as const, targetOperationId: "op_tmf_in",
      // Forwards what middleware received ({{request}}), not its ack - so the
      // subscriber sees the real payload on both lanes.
      mapping: { mode: "template" as const, template: "{{request}}" },
    },
  ];
  project.environments = [{ id: "env_tmf", name: "Sandbox", baseUrl: "", baseUrlOverrides: {} }];
  project.activeEnvironmentId = "env_tmf";
  project.notes = [
    "## Product order → middleware → events (2 lanes)",
    "",
    "Lane 1 forwards the order as-is; lane 2 wraps it as an order event.",
    "The final hop replays `{{request}}` (what middleware received), not the",
    "middleware ack - compare with `{{response}}` to see the difference.",
    "",
    "Run it:",
    "",
    "1. Set the Salesforce + Middleware base URLs in the run dialog.",
    "2. Credentials → add `HUB_TOKEN` (tab session only).",
    "3. Run from either Salesforce edge; uncheck a lane to simulate one path.",
    "4. No hub access? Enable Mock on any operation to simulate it.",
  ].join("\n");
  return project;
}

export function buildGroqSampleProject(): SystemProject {
  const project = newProject("Sample: User input → GROQ chat");
  const by = (type: string) => SYSTEM_TEMPLATES.find((t) => t.systemType === type)!;
  const ui = { ...newSystemFromTemplate(by("custom"), { x: 80, y: 200 }, 1), name: "User Input", id: "sys_groq_ui" };
  const groq = {
    ...newSystemFromTemplate(by("rest"), { x: 520, y: 200 }, 1),
    name: "GROQ", id: "sys_groq_api", baseUrl: "https://api.groq.com",
  };
  project.systems = [ui, groq];
  project.interfaces = [
    { id: "iface_groq_ui", systemId: ui.id, name: "Prompt channel", protocol: "Events", basePath: "/prompt" },
    { id: "iface_groq_api", systemId: groq.id, name: "Chat API", protocol: "REST", basePath: "/openai/v1" },
  ];
  project.operations = [
    {
      id: "op_groq_prompt", interfaceId: "iface_groq_ui", name: "Prompt submitted",
      method: "EVENT", path: "/prompt/submitted", version: "v1",
      sampleBody: '{ "prompt": "Explain Revenue Cloud order-to-cash architecture in 5 bullet points." }',
    },
    {
      id: "op_groq_chat", interfaceId: "iface_groq_api", name: "Chat completions",
      method: "POST", path: "/openai/v1/chat/completions", version: "v1",
      // Declarative intent only: the backend never forwards stored auth, but
      // run dialogs prefill their token field from this row - so auth works
      // with zero typing while the wire stays memory-only.
      headers: [{ key: "Authorization", value: "Bearer $env.GROQ_API_KEY" }],
    },
  ];
  project.connections = [
    {
      id: "conn_groq_1",
      sourceId: ui.id,
      targetId: groq.id,
      label: "Ask GROQ",
      status: "draft" as const,
      sourceOperationId: "op_groq_prompt",
      targetOperationId: "op_groq_chat",
      mapping: {
        mode: "template" as const,
        template: '{\n  "model": "openai/gpt-oss-20b",\n  "messages": [\n    {\n      "role": "user",\n      "content": {{seed.prompt}}\n    }\n  ],\n  "stream": false\n}',
      },
    },
  ];
  project.environments = [{ id: "env_groq", name: "Production", baseUrl: "https://api.groq.com", baseUrlOverrides: {}, isProduction: true }];
  project.activeEnvironmentId = "env_groq";
  project.notes = [
    "## GROQ chat sample (1:1)",
    "",
    "Static prompt in, chat completion out. Run it:",
    "",
    "1. Project bar → Credentials → add `GROQ_API_KEY` = your key (tab session only).",
    "2. Select the edge → Run chain from here.",
    "3. Seed is prefilled, token prefills from the stored header - just run.",
    "",
    "Auth travels per run via the token field (the backend drops stored auth",
    "headers so shared files can never auto-send live keys). The edge template",
    "grabs `{{seed.prompt}}` and builds the GROQ body - the same grab-and-map",
    "shape scales to Salesforce-vs-ZSP comparisons.",
  ].join("\n");
  return project;
}

/**
 * Sample topology: a TMF-style product order fans out through middleware to
 * billing and fulfillment in parallel lanes. Every hop is mocked, so the full
 * fan-out runs as-is: the 202 mock bodies ARE the downstream acks (each one
 * carries ackTo + the order id back toward Salesforce). Add explicit return
 * edges later to trace acks as lanes; the response pattern here is the
 * cheaper, honest default.
 */
export function buildOrderFanoutProject(): SystemProject {
  const project = newProject("Sample: TMF order → middleware fan-out → acks");
  const by = (type: string) => SYSTEM_TEMPLATES.find((t) => t.systemType === type)!;
  const sf = { ...newSystemFromTemplate(by("salesforce"), { x: 80, y: 260 }, 1), name: "Salesforce", id: "sys_fan_sf" };
  const mw = { ...newSystemFromTemplate(by("middleware"), { x: 520, y: 260 }, 1), name: "Middleware Hub", id: "sys_fan_mw" };
  const bill = { ...newSystemFromTemplate(by("billing"), { x: 960, y: 120 }, 1), name: "Billing", id: "sys_fan_bill" };
  const fulf = { ...newSystemFromTemplate(by("servicenow"), { x: 960, y: 400 }, 1), name: "Fulfillment", id: "sys_fan_fulf" };
  project.systems = [sf, mw, bill, fulf];
  project.interfaces = [
    { id: "iface_fan_sf", systemId: sf.id, name: "Order API", protocol: "REST", basePath: "/services/apexrest" },
    { id: "iface_fan_mw", systemId: mw.id, name: "Hub API", protocol: "REST", basePath: "" },
    { id: "iface_fan_bill", systemId: bill.id, name: "Invoices", protocol: "REST", basePath: "/v1" },
    { id: "iface_fan_fulf", systemId: fulf.id, name: "Orders", protocol: "REST", basePath: "/api" },
  ];
  const orderBody = '{ "id": "00000238", "state": "acknowledged", "orderTotalPrice": 1499.0 }';
  const ackBody = (system: string) => `{ "status": "accepted", "ackTo": "salesforce", "via": "${system}", "orderId": "00000238" }`;
  project.operations = [
    {
      id: "op_fan_get", interfaceId: "iface_fan_sf", name: "Get product order",
      method: "GET", path: "/tmf/productOrder/00000238", version: "v1",
      mock: { status: 200, body: orderBody, latencyMs: 120 },
    },
    {
      id: "op_fan_fwd", interfaceId: "iface_fan_mw", name: "Forward order as-is",
      method: "POST", path: "/productOrder", version: "v1",
      mock: { status: 202, body: '{ "status": "accepted", "lane": "as-is" }', latencyMs: 80 },
    },
    {
      id: "op_fan_evt", interfaceId: "iface_fan_mw", name: "Publish order event",
      method: "POST", path: "/topic/order-events/event", version: "v1",
      mock: { status: 202, body: '{ "status": "accepted", "lane": "event" }', latencyMs: 80 },
    },
    {
      id: "op_fan_bill", interfaceId: "iface_fan_bill", name: "Create invoice",
      method: "POST", path: "/v1/invoices", version: "v1",
      mock: { status: 202, body: ackBody("billing"), latencyMs: 150 },
    },
    {
      id: "op_fan_fulf", interfaceId: "iface_fan_fulf", name: "Create fulfillment",
      method: "POST", path: "/api/fulfillment", version: "v1",
      mock: { status: 202, body: ackBody("fulfillment"), latencyMs: 200 },
    },
  ];
  project.connections = [
    {
      id: "conn_fan_1", sourceId: sf.id, targetId: mw.id, label: "Order as-is",
      status: "draft" as const, sourceOperationId: "op_fan_get", targetOperationId: "op_fan_fwd",
      mapping: { mode: "passthrough" as const, template: "" },
    },
    {
      id: "conn_fan_2", sourceId: sf.id, targetId: mw.id, label: "Order as event",
      status: "draft" as const, sourceOperationId: "op_fan_get", targetOperationId: "op_fan_evt",
      mapping: {
        mode: "template" as const,
        template: '{\n  "event": {\n    "productOrder": {{response}}\n  }\n}',
      },
    },
    {
      id: "conn_fan_3", sourceId: mw.id, targetId: bill.id, label: "Bill it",
      status: "draft" as const, targetOperationId: "op_fan_bill",
      mapping: { mode: "template" as const, template: "{{request}}" },
    },
    {
      id: "conn_fan_4", sourceId: mw.id, targetId: fulf.id, label: "Fulfill it",
      status: "draft" as const, targetOperationId: "op_fan_fulf",
      mapping: { mode: "template" as const, template: "{{request}}" },
    },
  ];
  project.environments = [{ id: "env_fan", name: "Sandbox", baseUrl: "", baseUrlOverrides: {} }];
  project.activeEnvironmentId = "env_fan";
  project.notes = [
    "## TMF order fan-out (2 lanes × 2 branches)",
    "",
    "Salesforce order → middleware (as-is + wrapped event) → billing and",
    "fulfillment in parallel. Every hop is mocked: the 202 bodies are the",
    "downstream acks flowing back toward Salesforce.",
    "",
    "Run it:",
    "",
    "1. Select either Salesforce edge → Run chain from here.",
    "2. Uncheck a lane to simulate one path (as-is vs event).",
    "3. Replace a mock with a live URL + Credentials to go live per hop.",
  ].join("\n");
  return project;
}

/**
 * Sample topology: headless Revenue Cloud quote-to-cash. Quote approval in
 * Salesforce seeds the flow, middleware enriches (pricing/tax), billing
 * invoices. All mocked - the shape is the deliverable, not the data.
 */
export function buildRevenueCloudProject(): SystemProject {
  const project = newProject("Sample: Revenue Cloud quote → cash");
  const by = (type: string) => SYSTEM_TEMPLATES.find((t) => t.systemType === type)!;
  const sf = { ...newSystemFromTemplate(by("salesforce"), { x: 80, y: 200 }, 1), name: "Revenue Cloud", id: "sys_rev_sf" };
  const mw = { ...newSystemFromTemplate(by("middleware"), { x: 520, y: 200 }, 1), name: "Middleware Hub", id: "sys_rev_mw" };
  const bill = { ...newSystemFromTemplate(by("billing"), { x: 960, y: 200 }, 1), name: "Billing", id: "sys_rev_bill" };
  project.systems = [sf, mw, bill];
  project.interfaces = [
    { id: "iface_rev_sf", systemId: sf.id, name: "Quote API", protocol: "REST", basePath: "/services/data/v66.0" },
    { id: "iface_rev_mw", systemId: mw.id, name: "Enrichment", protocol: "REST", basePath: "" },
    { id: "iface_rev_bill", systemId: bill.id, name: "Invoices", protocol: "REST", basePath: "/v1" },
  ];
  project.operations = [
    {
      id: "op_rev_quote", interfaceId: "iface_rev_sf", name: "Quote approved",
      method: "EVENT", path: "/events/quote-approved", version: "v1",
      sampleBody: '{ "quoteId": "Q-1042", "accountId": "001xx000003DGbP", "amount": 24999.0, "currency": "USD" }',
    },
    {
      id: "op_rev_enrich", interfaceId: "iface_rev_mw", name: "Enrich order",
      method: "POST", path: "/enrich/order", version: "v1",
      mock: { status: 200, body: '{ "quoteId": "Q-1042", "tax": 1999.92, "total": 26998.92 }', latencyMs: 140 },
    },
    {
      id: "op_rev_invoice", interfaceId: "iface_rev_bill", name: "Create invoice",
      method: "POST", path: "/v1/invoices", version: "v1",
      mock: { status: 202, body: '{ "status": "accepted", "ackTo": "salesforce", "invoiceId": "INV-8817" }', latencyMs: 180 },
    },
  ];
  project.connections = [
    {
      id: "conn_rev_1", sourceId: sf.id, targetId: mw.id, label: "Approved quote",
      status: "draft" as const, sourceOperationId: "op_rev_quote", targetOperationId: "op_rev_enrich",
      mapping: { mode: "passthrough" as const, template: "" },
    },
    {
      id: "conn_rev_2", sourceId: mw.id, targetId: bill.id, label: "Bill enriched total",
      status: "draft" as const, targetOperationId: "op_rev_invoice",
      mapping: { mode: "template" as const, template: "{{request}}" },
    },
  ];
  project.environments = [{ id: "env_rev", name: "Sandbox", baseUrl: "", baseUrlOverrides: {} }];
  project.activeEnvironmentId = "env_rev";
  project.notes = [
    "## Revenue Cloud quote → cash (single chain)",
    "",
    "Quote approval seeds the flow; middleware enriches with tax; billing",
    "invoices. Swap the seed body for a real Quote ID and go live per hop.",
    "",
    "Run it: select the Revenue Cloud edge → Run chain from here.",
  ].join("\n");
  return project;
}

/**
 * Sample topology: Salesforce change events stream through middleware into a
 * warehouse and human alerts in parallel. The CDC fan-out shape behind most
 * Salesforce-to-data-platform syncs.
 */
export function buildCdcSyncProject(): SystemProject {
  const project = newProject("Sample: Salesforce CDC → warehouse + alerts");
  const by = (type: string) => SYSTEM_TEMPLATES.find((t) => t.systemType === type)!;
  const sf = { ...newSystemFromTemplate(by("salesforce"), { x: 80, y: 260 }, 1), name: "Salesforce", id: "sys_cdc_sf" };
  const mw = { ...newSystemFromTemplate(by("middleware"), { x: 520, y: 260 }, 1), name: "Middleware Hub", id: "sys_cdc_mw" };
  const wh = { ...newSystemFromTemplate(by("warehouse"), { x: 960, y: 120 }, 1), name: "Warehouse", id: "sys_cdc_wh" };
  const nt = { ...newSystemFromTemplate(by("notify"), { x: 960, y: 400 }, 1), name: "Alerts", id: "sys_cdc_nt" };
  project.systems = [sf, mw, wh, nt];
  project.interfaces = [
    { id: "iface_cdc_sf", systemId: sf.id, name: "Change Events", protocol: "Events", basePath: "/data/ChangeEvents" },
    { id: "iface_cdc_mw", systemId: mw.id, name: "Sync intake", protocol: "REST", basePath: "" },
    { id: "iface_cdc_wh", systemId: wh.id, name: "Ingest", protocol: "REST", basePath: "/v1" },
    { id: "iface_cdc_nt", systemId: nt.id, name: "Notify", protocol: "REST", basePath: "/hooks" },
  ];
  project.operations = [
    {
      id: "op_cdc_change", interfaceId: "iface_cdc_sf", name: "Account change",
      method: "EVENT", path: "/data/ChangeEvents/Account", version: "v1",
      sampleBody: '{ "object": "Account", "changeType": "UPDATE", "recordIds": ["001xx000003DGbP"], "fields": ["AnnualRevenue"] }',
    },
    {
      id: "op_cdc_upsert", interfaceId: "iface_cdc_mw", name: "Normalize change",
      method: "POST", path: "/sync/upsert", version: "v1",
      mock: { status: 200, body: '{ "upserted": 1, "object": "Account" }', latencyMs: 110 },
    },
    {
      id: "op_cdc_wh", interfaceId: "iface_cdc_wh", name: "Warehouse ingest",
      method: "POST", path: "/v1/ingest/accounts", version: "v1",
      mock: { status: 202, body: '{ "status": "accepted", "rows": 1 }', latencyMs: 160 },
    },
    {
      id: "op_cdc_alert", interfaceId: "iface_cdc_nt", name: "Post change alert",
      method: "POST", path: "/hooks/sync-alerts", version: "v1",
      mock: { status: 200, body: '{ "status": "posted", "channel": "sync-alerts" }', latencyMs: 90 },
    },
  ];
  project.connections = [
    {
      id: "conn_cdc_1", sourceId: sf.id, targetId: mw.id, label: "Change captured",
      status: "draft" as const, sourceOperationId: "op_cdc_change", targetOperationId: "op_cdc_upsert",
      mapping: { mode: "template" as const, template: "{{request}}" },
    },
    {
      id: "conn_cdc_2", sourceId: mw.id, targetId: wh.id, label: "Sync rows",
      status: "draft" as const, targetOperationId: "op_cdc_wh",
      mapping: { mode: "template" as const, template: "{{request}}" },
    },
    {
      id: "conn_cdc_3", sourceId: mw.id, targetId: nt.id, label: "Alert humans",
      status: "draft" as const, targetOperationId: "op_cdc_alert",
      mapping: {
        mode: "template" as const,
        template: '{\n  "text": "Sync upserted {{request.upserted}} {{request.object}} record(s)"\n}',
      },
    },
  ];
  project.environments = [{ id: "env_cdc", name: "Sandbox", baseUrl: "", baseUrlOverrides: {} }];
  project.activeEnvironmentId = "env_cdc";
  project.notes = [
    "## CDC sync fan-out (1 chain × 2 branches)",
    "",
    "Account change → normalize → warehouse ingest + human alert in parallel.",
    "The alert branch shows a hand-written template reading {{request}} fields.",
    "",
    "Run it: select the Salesforce edge → Run chain from here.",
  ].join("\n");
  return project;
}

/**
 * Flowchart starter: order placement with retry + fallback. The exception
 * path is topology, not code - charge attempt, fallback charge and DLQ
 * parking are labeled edges an architect can run, mock and replay per hop.
 */
export function buildRetryFallbackProject(): SystemProject {
  const project = newProject("Sample: order charge with retry + fallback");
  const by = (type: string) => SYSTEM_TEMPLATES.find((t) => t.systemType === type)!;
  const sf = { ...newSystemFromTemplate(by("salesforce"), { x: 80, y: 260 }, 1), name: "Salesforce", id: "sys_rf_sf" };
  const mw = { ...newSystemFromTemplate(by("middleware"), { x: 520, y: 260 }, 1), name: "Middleware Hub", id: "sys_rf_mw" };
  const bill = { ...newSystemFromTemplate(by("saas"), { x: 960, y: 80 }, 1), name: "Billing (primary)", id: "sys_rf_bill" };
  const fb = { ...newSystemFromTemplate(by("saas"), { x: 960, y: 260 }, 2), name: "Billing (fallback)", id: "sys_rf_fb" };
  const dlq = { ...newSystemFromTemplate(by("queue"), { x: 960, y: 440 }, 1), name: "Dead-letter queue", id: "sys_rf_dlq" };
  project.systems = [sf, mw, bill, fb, dlq];
  project.interfaces = [
    { id: "iface_rf_sf", systemId: sf.id, name: "Order events", protocol: "Events", basePath: "/data/ChangeEvents" },
    { id: "iface_rf_mw", systemId: mw.id, name: "Orchestrate", protocol: "REST", basePath: "" },
    { id: "iface_rf_bill", systemId: bill.id, name: "Charges", protocol: "REST", basePath: "/v1" },
    { id: "iface_rf_fb", systemId: fb.id, name: "Charges", protocol: "REST", basePath: "/v1" },
    { id: "iface_rf_dlq", systemId: dlq.id, name: "Park", protocol: "REST", basePath: "/v1" },
  ];
  project.operations = [
    {
      id: "op_rf_placed", interfaceId: "iface_rf_sf", name: "Order placed",
      method: "EVENT", path: "/data/ChangeEvents/Order", version: "v1",
      sampleBody: '{ "orderId": "801xx000001ABcD", "amount": 4200, "currency": "USD" }',
    },
    {
      id: "op_rf_orchestrate", interfaceId: "iface_rf_mw", name: "Charge with fallback",
      method: "POST", path: "/charge/orchestrate", version: "v1",
      mock: { status: 200, body: '{ "strategy": "primary-first", "retries": 3 }', latencyMs: 120 },
    },
    {
      id: "op_rf_charge", interfaceId: "iface_rf_bill", name: "Charge attempt",
      method: "POST", path: "/v1/charges", version: "v1",
      mock: { status: 200, body: '{ "id": "ch_9f2", "status": "succeeded" }', latencyMs: 210 },
    },
    {
      id: "op_rf_fbcharge", interfaceId: "iface_rf_fb", name: "Fallback charge",
      method: "POST", path: "/v1/charges", version: "v1",
      mock: { status: 200, body: '{ "id": "ch_7a1", "status": "succeeded", "via": "fallback" }', latencyMs: 260 },
    },
    {
      id: "op_rf_park", interfaceId: "iface_rf_dlq", name: "Park for replay",
      method: "POST", path: "/v1/dlq/orders", version: "v1",
      mock: { status: 202, body: '{ "status": "parked", "replayable": true }', latencyMs: 90 },
    },
  ];
  project.connections = [
    {
      id: "conn_rf_1", sourceId: sf.id, targetId: mw.id, label: "Order captured",
      status: "draft" as const, sourceOperationId: "op_rf_placed", targetOperationId: "op_rf_orchestrate",
      mapping: { mode: "template" as const, template: "{{request}}" },
    },
    {
      id: "conn_rf_2", sourceId: mw.id, targetId: bill.id, label: "Charge attempt",
      status: "draft" as const, targetOperationId: "op_rf_charge",
      mapping: { mode: "template" as const, template: "{{request}}" },
    },
    {
      id: "conn_rf_3", sourceId: mw.id, targetId: fb.id, label: "Fallback charge",
      status: "draft" as const, targetOperationId: "op_rf_fbcharge",
      mapping: {
        mode: "template" as const,
        template: '{\n  "orderId": "{{request.orderId}}",\n  "amount": {{request.amount}},\n  "idempotencyKey": "{{request.orderId}}-fb"\n}',
      },
    },
    {
      id: "conn_rf_4", sourceId: mw.id, targetId: dlq.id, label: "Park for replay",
      status: "draft" as const, targetOperationId: "op_rf_park",
      mapping: { mode: "template" as const, template: "{{request}}" },
    },
  ];
  project.environments = [{ id: "env_rf", name: "Sandbox", baseUrl: "", baseUrlOverrides: {} }];
  project.activeEnvironmentId = "env_rf";
  project.notes = [
    "## Retry + fallback (1 trigger x 3 outcomes)",
    "",
    "Order placed -> orchestrate -> charge attempt. On failure the same payload",
    "replays into Billing (fallback) with an idempotency key, and anything still",
    "failing parks on the dead-letter queue for replay.",
    "",
    "Run it: select the Salesforce edge -> Run chain from here, then flip the",
    "primary charge mock to a 500 to walk the fallback and DLQ branches.",
  ].join("\n");
  return project;
}
