"use client";

import Button from "../ui/Button";

/**
 * Template picker: every starter canvas in one place with what it proves
 * and what it needs - no more guessing which project-bar button to hit.
 */
export function TemplatesModal({
  open,
  onClose,
  onLoadDemo,
  onLoadGroq,
  onLoadTmf,
  onLoadFanout,
  onLoadRevenue,
  onLoadCdc,
  onLoadFlow,
}: {
  open: boolean;
  onClose: () => void;
  onLoadDemo: () => void;
  onLoadGroq: () => void;
  onLoadTmf: () => void;
  onLoadFanout: () => void;
  onLoadRevenue: () => void;
  onLoadCdc: () => void;
  onLoadFlow: () => void;
}) {
  if (!open) return null;

  const card = (
    eyebrow: string,
    title: string,
    body: string,
    needs: string,
    action: () => void,
    actionLabel: string
  ) => (
    <div className="flex h-full max-h-96 flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5">
      <p className="shrink-0 text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">{eyebrow}</p>
      <p className="mt-1 shrink-0 text-sm font-bold text-ivory-950">{title}</p>
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
        <p className="text-xs leading-relaxed text-ivory-600">{body}</p>
        <p className="mt-2 font-mono text-[10px] text-ivory-500">Needs: {needs}</p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="mt-2.5 w-full shrink-0"
        onClick={() => {
          action();
          onClose();
        }}
      >
        {actionLabel}
      </Button>
    </div>
  );

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="tpl-title" onClick={onClose}>
      <div
        className="modal-card max-w-3xl w-[calc(100vw-3rem)] flex flex-col"
        style={{ maxHeight: "88vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)] shrink-0">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
              Starter canvases · replacing the canvas asks first
            </p>
            <h2 id="tpl-title" className="mt-1 text-lg font-bold text-ivory-950">
              Templates
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close templates"
            className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 grid gap-2.5 sm:grid-cols-3">
          {card(
            "Topology tour · 5 systems",
            "Demo: Lead triage flow",
            "Salesforce event fans out through a broker into ServiceNow, a triage console and a live echo edge. Shows draft vs ready edges at a glance.",
            "nothing - the echo edge runs as-is",
            onLoadDemo,
            "Load demo architecture"
          )}
          {card(
            "Live run · 2 systems",
            "Sample: User input → GROQ chat",
            "Static seed prompt flows 1:1 into GROQ chat completions - the edge template grabs {{seed.prompt}} and builds the request body. The grab-and-map shape for Salesforce-vs-ZSP comparisons.",
            "GROQ_API_KEY in Credentials",
            onLoadGroq,
            "Load GROQ chat sample"
          )}
          {card(
            "Branched run · 3 systems",
            "Sample: product order → middleware → events",
            "Salesforce order read fans into two middleware posts (as-is, wrapped order event), then replays into the subscriber via {{request}} - lanes, per-hop picks, and mock mode in one canvas.",
            "Hub base URLs + HUB_TOKEN in Credentials",
            onLoadTmf,
            "Load order-flow sample"
          )}
          {card(
            "TMF fan-out · 4 systems",
            "Sample: TMF order → middleware fan-out → acks",
            "A TMF-style product order crosses middleware as-is and as a wrapped event, then fans out to billing and fulfillment in parallel. Every hop is mocked: the 202 bodies are the downstream acks flowing back toward Salesforce.",
            "nothing - every hop is mocked",
            onLoadFanout,
            "Load fan-out sample"
          )}
          {card(
            "Quote-to-cash · 3 systems",
            "Sample: Revenue Cloud quote → cash",
            "Headless commerce in one chain: quote approval seeds the flow, middleware enriches with tax, billing invoices. The event-seed shape behind every Salesforce-triggered flow.",
            "nothing - every hop is mocked",
            onLoadRevenue,
            "Load Revenue Cloud sample"
          )}
          {card(
            "CDC sync · 4 systems",
            "Sample: Salesforce CDC → warehouse + alerts",
            "Account change events normalize in middleware, then fan out to warehouse ingest and human alerts in parallel - including a hand-written alert template reading {{request}} fields.",
            "nothing - every hop is mocked",
            onLoadCdc,
            "Load CDC sync sample"
          )}
          {card(
            "Flow starter · 5 systems",
            "Sample: order charge with retry + fallback",
            "Order placement walks the exception path as topology: charge attempt, idempotent fallback charge, and dead-letter parking - flip the primary mock to a 500 and run each branch.",
            "nothing - every hop is mocked",
            onLoadFlow,
            "Load retry + fallback sample"
          )}
        </div>
      </div>
    </div>
  );
}
