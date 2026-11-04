// Single-worker entry: the generated OpenNext handler plus Durable Object
// class exports. Wrangler bundles this file; Durable Objects must be exported
// from the entry module, which the generated file cannot do on its own.
// This file is intentionally tiny and behavior-free — all traffic flows to
// the Next app except DO class registration.
export { default } from "./.open-next/worker.js";
export { WebhookInbox } from "./durable-objects/webhook-inbox.js";
