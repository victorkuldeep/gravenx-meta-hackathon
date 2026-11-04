/**
 * Minimal structural types for the WEBHOOK_INBOX binding. Local on purpose:
 * no external type packages, so `next build` typechecks identically on a
 * laptop and in Cloudflare's build container.
 */
export interface WebhookInboxStub {
  fetch(input: Request): Promise<Response>;
}

export interface WebhookInboxNamespace {
  getByName(name: string): WebhookInboxStub;
}
