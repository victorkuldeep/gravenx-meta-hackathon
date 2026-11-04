"use client";

import { useMemo, useState } from "react";
import { diagnoseProfile } from "@/lib/contracts/diagnostics";
import { adaptDescribe } from "@/lib/contracts/metadata-adapter";
import { compileDraft } from "@/lib/contracts/compile-help";
import Button from "../ui/Button";
import type { ContractsTabsProps } from "./ContractsTabs";

/**
 * Validate tab: profile + metadata + lint diagnostics grouped by
 * severity. Structural OpenAPI validation via @scalar/openapi-parser
 * lands in Phase 4 alongside versions.
 */
export function ContractValidate(props: ContractsTabsProps) {
  const { drafts, activeId, describes, stored } = props;
  const draft = activeId ? (drafts.get(activeId) ?? null) : null;

  const issues = useMemo(() => {
    if (!draft) return [];
    const desc = describes.get(draft.targetObjectApiName);
    const snap = stored.find((s) => s.id === draft.id)?.snapshot ?? null;
    const meta = new Map();
    const source = desc ?? (snap ? (snap.describe as never) : null);
    if (source && typeof source === "object" && "fields" in (source as object)) {
      try {
        for (const f of adaptDescribe(source as never).fields) meta.set(f.apiName, f);
      } catch {
        /* corrupt snapshot - diagnostics flag unknown fields */
      }
    }
    return diagnoseProfile({ profile: draft, metaByName: meta, snapshotCapturedAt: snap?.capturedAt ?? null });
  }, [draft, describes, stored]);

  const compiled = useMemo(
    () => compileDraft(draft, describes, stored),
    [draft, describes, stored]
  );

  const [scalar, setScalar] = useState<{ ran: boolean; valid: boolean; messages: string[] }>({
    ran: false,
    valid: false,
    messages: [],
  });
  const [scalarBusy, setScalarBusy] = useState(false);

  const runScalar = async () => {
    if (!compiled) return;
    setScalarBusy(true);
    try {
      const { validate } = await import("@scalar/openapi-parser");
      const result = await validate(compiled.document);
      const messages = (result.errors ?? []).map((e) =>
        typeof e === "string" ? e : String((e as { message?: string }).message ?? JSON.stringify(e))
      );
      setScalar({ ran: true, valid: messages.length === 0, messages });
    } catch (err) {
      setScalar({ ran: true, valid: false, messages: [err instanceof Error ? err.message : "Scalar validation failed"] });
    } finally {
      setScalarBusy(false);
    }
  };

  if (!draft) {
    return (
      <div className="rounded-xl border border-[#E8E2D8] bg-white p-10 text-center text-sm text-[#A39B8E]">
        Select a profile to validate.
      </div>
    );
  }

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const infos = issues.filter((i) => i.level === "info");

  const group = (title: string, list: typeof issues, cls: string, dot: string) => (
    <div className="rounded-xl border border-[#E8E2D8] bg-white overflow-hidden">
      <p className="border-b border-[#E8E2D8] px-3 py-2 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
        {title} · {list.length}
      </p>
      <div className="max-h-[420px] space-y-1 overflow-y-auto p-2">
        {list.length === 0 && <p className="px-2 py-2 text-[11px] text-[#A39B8E]">None.</p>}
        {list.map((issue, k) => (
          <div key={k} className="rounded-lg bg-[#F8F6F0] px-2 py-1.5">
            <p className={`flex items-center gap-1.5 text-[12px] font-medium ${cls}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
              {issue.message}
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-[#A39B8E]">
              {issue.code} · {issue.path}
            </p>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3 text-[13px] text-[#777168]">
        {errors.length === 0 ? (
          <span className="font-semibold text-[#32815B]">No blocking errors.</span>
        ) : (
          <span className="font-semibold text-[#B84C42]">
            {errors.length} blocking error{errors.length === 1 ? "" : "s"} - fix before publishing.
          </span>
        )}{" "}
        Warnings never claim invalidity. Structural OpenAPI validation runs
        on demand below (Scalar parser, lazy-loaded).
      </div>
      <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-semibold text-[#27241F]">Scalar structural validation</p>
          <span className="flex-1" />
          <Button size="sm" onClick={runScalar} disabled={!compiled || scalarBusy}>
            {scalarBusy ? "Validating…" : scalar.ran ? "Re-run" : "Run validation"}
          </Button>
        </div>
        {scalar.ran && (
          <div className="mt-2">
            {scalar.valid ? (
              <p className="text-[13px] font-semibold text-[#32815B]">
                Valid OpenAPI 3.1 - all references resolve.
              </p>
            ) : (
              <div className="space-y-1">
                {scalar.messages.map((m, k) => (
                  <p key={k} className="rounded-lg bg-red-50 px-2 py-1.5 font-mono text-[11px] text-red-700">
                    {m}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        {group("Errors", errors, "text-[#B84C42]", "bg-[#B84C42]")}
        {group("Warnings", warnings, "text-[#B98335]", "bg-[#B98335]")}
        {group("Info", infos, "text-[#777168]", "bg-[#A39B8E]")}
      </div>
    </div>
  );
}
