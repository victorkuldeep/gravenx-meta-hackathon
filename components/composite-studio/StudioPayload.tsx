"use client";

import { useState } from "react";
import type {
  StudioDocument,
  StudioIssue,
  StudioPayload,
} from "@/lib/composite/studio";
import CodeBlock from "../ui/CodeBlock";
import Button from "../ui/Button";
import { CollectionTrayButton } from "../CollectionTrayButton";

export interface StudioTestBundle {
  loading: boolean;
  error: string | null;
  result: { status: number; statusText: string; responseTime: number; body: unknown; success: boolean } | null;
  confirming: boolean;
  onAskSend: () => void;
  onCancelSend: () => void;
  onConfirmSend: () => void;
}

interface StudioPayloadProps {
  doc: StudioDocument;
  payload: StudioPayload | null;
  issues: StudioIssue[];
  compositeEndpoint: string;
  test: StudioTestBundle;
  orderNotice: string | null;
  onFixOrder: () => void;
  onGotoRequest: (id: string) => void;
  onDownload: () => void;
  onAddToCollection: () => void;
  collectionCount: number;
  onOpenCollection: () => void;
}

type ExportTab = "json" | "curl";

/**
 * Screen Three - Payload Composer: execution order + validation left,
 * exact JSON right, test-send below. Regenerate from the toolbar.
 */
export default function StudioPayload({
  doc,
  payload,
  issues,
  compositeEndpoint,
  test,
  orderNotice,
  onFixOrder,
  onGotoRequest,
  onDownload,
  onAddToCollection,
  collectionCount,
  onOpenCollection,
}: StudioPayloadProps) {
  const [tab, setTab] = useState<ExportTab>("json");
  const [copied, setCopied] = useState(false);

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const orderErrors = errors.filter((i) => i.message.includes("must execute before"));

  const json = payload ? JSON.stringify(payload, null, 2) : "";
  const curl = payload
    ? `curl -X POST \\\n  '${compositeEndpoint}' \\\n  -H 'Authorization: Bearer $SF_ACCESS_TOKEN' \\\n  -H 'Content-Type: application/json' \\\n  -d '${json}'`
    : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tab === "json" ? json : curl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* Order + validation */}
      <div className="space-y-3">
        <div className="rounded-xl border border-[#E8E2D8] bg-white overflow-hidden">
          <p className="border-b border-[#E8E2D8] px-3 py-2 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
            Execution order
          </p>
          <div className="max-h-[320px] overflow-y-auto p-1.5">
            {doc.requests.map((r, i) => {
              const bad = issues.some((x) => x.requestId === r.id && x.level === "error");
              return (
                <button
                  key={r.id}
                  onClick={() => onGotoRequest(r.id)}
                  title="Open in Requests"
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-[#F5F1E8] transition-colors"
                >
                  <span className="font-mono text-[11px] text-[#A39B8E]">{String(i + 1).padStart(2, "0")}</span>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${bad ? "bg-[#B84C42]" : "bg-[#32815B]"}`} />
                  <span className="min-w-0 flex-1 truncate font-medium text-[#27241F]">
                    {r.displayName || r.objectLabel || "Untitled"}
                    <span className="ml-1.5 font-mono text-[11px] text-[#A98450]">{r.referenceId}</span>
                  </span>
                </button>
              );
            })}
            {doc.requests.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-[#A39B8E]">Nothing to order yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[#E8E2D8] bg-white overflow-hidden">
          <p className="border-b border-[#E8E2D8] px-3 py-2 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
            Validation · {errors.length} error{errors.length === 1 ? "" : "s"} · {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </p>
          <div className="max-h-[280px] space-y-1 overflow-y-auto p-2">
            {issues.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-[#32815B]">Valid - safe to generate and send.</p>
            )}
            {orderNotice && <p className="rounded-lg bg-[#F5F1E8] px-2 py-1.5 text-[11px] text-[#777168]">{orderNotice}</p>}
            {orderErrors.length > 0 && (
              <button
                onClick={onFixOrder}
                className="w-full rounded-lg bg-[#211F1B] px-2 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition-opacity cursor-pointer"
              >
                Auto-fix order (stable)
              </button>
            )}
            {issues.map((issue, k) => (
              <button
                key={k}
                onClick={() => issue.requestId && onGotoRequest(issue.requestId)}
                className={`block w-full rounded-lg px-2 py-1.5 text-left text-[11px] leading-snug transition-colors cursor-pointer ${
                  issue.level === "error" ? "text-[#B84C42] hover:bg-red-50" : "text-[#B98335] hover:bg-amber-50"
                }`}
              >
                {issue.message}
                {issue.fieldApiName && <span className="font-mono"> · {issue.fieldApiName}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="overflow-hidden rounded-xl border border-[#E8E2D8] bg-white">
        {!payload ? (
          <div className="p-10 text-center">
            <p className="text-sm font-semibold text-[#27241F]">No payload yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-[#777168]">
              Configure requests, then Generate Payload from the toolbar above. Independent requests generate fine.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8E2D8] px-4 py-2.5">
              <div className="flex" role="tablist" aria-label="Export format">
                {(["json", "curl"] as ExportTab[]).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`px-3 py-1.5 font-mono text-xs font-bold transition-colors cursor-pointer ${
                      tab === t ? "text-[#27241F] underline underline-offset-4 decoration-[#A98450] decoration-2" : "text-[#A39B8E] hover:text-[#27241F]"
                    }`}
                  >
                    {t === "json" ? "JSON" : "cURL"}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Button variant="ghost" size="sm" onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
                <Button variant="ghost" size="sm" onClick={onDownload}>Download</Button>
                <Button variant="secondary" size="sm" onClick={onAddToCollection}>+ Collection</Button>
                <CollectionTrayButton count={collectionCount} onOpen={onOpenCollection} />
              </div>
            </div>
            <div className="p-4">
              <CodeBlock code={tab === "json" ? json : curl} language={tab === "json" ? "json" : "bash"} maxHeight="520px" />
            </div>

            {/* Test send */}
            <div className="border-t border-[#E8E2D8] p-4">
              {!test.confirming ? (
                <Button variant="danger" size="sm" onClick={test.onAskSend} disabled={test.loading || errors.length > 0} title={errors.length > 0 ? "Fix validation errors first" : "Send to Salesforce"}>
                  Send Composite Test Request
                </Button>
              ) : (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-3">
                  <p className="text-[13px] text-amber-800">
                    This executes {payload.compositeRequest.length} sub-request(s) against your org{doc.allOrNone ? " - all or none" : ""}. Confirm?
                  </p>
                  <div className="flex gap-2">
                    <Button variant="danger" size="sm" onClick={test.onConfirmSend} loading={test.loading}>Confirm Send</Button>
                    <Button variant="ghost" size="sm" onClick={test.onCancelSend}>Cancel</Button>
                  </div>
                </div>
              )}
              {test.error && (
                <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-[13px] text-red-700">{test.error}</div>
              )}
              {test.result && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold ${test.result.success ? "text-green-700" : "text-red-600"}`}>
                      {test.result.status} {test.result.statusText}
                    </span>
                    <span className="text-xs text-[#777168]">{test.result.responseTime}ms</span>
                  </div>
                  <CodeBlock
                    code={typeof test.result.body === "string" ? test.result.body : JSON.stringify(test.result.body, null, 2)}
                    language="json"
                    maxHeight="400px"
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
