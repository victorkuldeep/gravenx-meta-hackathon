import type { ConsolePriority, ConsoleStatus } from "./model";
import type { InboxItemKind } from "@/lib/inbox/types";

/**
 * Starter gallery for Console: the three tasks every architect logs in
 * week one - a design review, an open question, and a decision to record.
 * Inserted by title (never duplicated); the architect edits from there.
 */
export interface ConsoleSample {
  title: string;
  kind: InboxItemKind;
  status: ConsoleStatus;
  priority: ConsolePriority;
  owner?: string;
  body: string;
}

export const CONSOLE_SAMPLES: ConsoleSample[] = [
  {
    title: "Sample: review the order-to-fulfillment sequence",
    kind: "task",
    status: "open",
    priority: "high",
    owner: "Architect",
    body: "Open Sequence Studio and walk the happy path end to end.\n\n- [ ] Every hop has an owner\n- [ ] Timeouts are stated, not assumed\n- [ ] Failure branches land somewhere visible",
  },
  {
    title: "Sample: who owns orchestration?",
    kind: "question",
    status: "awaiting-feedback",
    priority: "normal",
    body: "Middleware or the storefront? Record the answer as a decision before the next workshop.",
  },
  {
    title: "Sample: middleware owns orchestration",
    kind: "decision",
    status: "resolved",
    priority: "normal",
    body: "Decided: the middleware layer orchestrates cross-system flows.\n\nStorefront stays thin; ServiceNow owns fulfillment state.",
  },
];
