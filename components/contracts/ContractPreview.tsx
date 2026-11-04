"use client";

import { useMemo, useState } from "react";
import { compileDraft } from "@/lib/contracts/compile-help";
import CodeBlock from "../ui/CodeBlock";
import Button from "../ui/Button";
import type { ContractsTabsProps } from "./ContractsTabs";

/** OpenAPI Preview: compiled YAML/JSON, hash, downloads, traceability. */
export function ContractPreview(props: ContractsTabsProps) {
  const { drafts, activeId, describes, stored } = props;
  const [tab, setTab] = useState<"yaml" | "json">("yaml");
  const [copied, setCopied] = useState(false);

  const draft = activeId ? (drafts.get(activeId) ?? null) : null;

  const compiled = useMemo(
    () => compileDraft(draft, describes, stored),
    [draft, describes, stored]
  );

  if (!draft || !compiled) {
    return (
      <div className="rounded-xl border border-[#E8E2D8] bg-white p-10 text-center text-sm text-[#A39B8E]">
        Select a profile to preview its contract.
      </div>
    );
  }

  const text = tab === "yaml" ? compiled.yaml : compiled.json;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };
  const download = (which: "yaml" | "json") => {
    const blob = new Blob([which === "yaml" ? compiled.yaml : compiled.json], {
      type: which === "yaml" ? "text/yaml" : "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "contract"}.openapi.${which}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="overflow-hidden rounded-xl border border-[#E8E2D8] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8E2D8] px-4 py-2.5">
          <div className="flex" role="tablist" aria-label="Document format">
            {(["yaml", "json"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 font-mono text-xs font-bold transition-colors cursor-pointer ${
                  tab === t ? "text-[#27241F] underline underline-offset-4 decoration-[#A98450] decoration-2" : "text-[#A39B8E] hover:text-[#27241F]"
                }`}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          <span className="font-mono text-[11px] text-[#A39B8E]" title="Deterministic content hash">
            {compiled.hash}
          </span>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
            <Button variant="ghost" size="sm" onClick={() => download("yaml")}>YAML</Button>
            <Button variant="ghost" size="sm" onClick={() => download("json")}>JSON</Button>
          </div>
        </div>
        <div className="p-4">
          <CodeBlock code={text} language="yaml" maxHeight="560px" />
        </div>
      </div>

      <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
          Traceability · {compiled.traceability.length}
        </p>
        <div className="mt-1.5 max-h-[560px] space-y-1 overflow-y-auto">
          {compiled.traceability.map((t) => (
            <div key={`${t.salesforceApiName}-${t.operations.join("+")}`} className="rounded-lg bg-[#F8F6F0] px-2 py-1.5">
              <p className="font-mono text-[11px] text-[#27241F]">{t.externalName}</p>
              <p className="font-mono text-[10px] text-[#A39B8E]">
                → {t.salesforceApiName} · {t.operations.join("+")} · {t.transform} · {t.ownership}
              </p>
            </div>
          ))}
          {compiled.traceability.length === 0 && (
            <p className="px-1 py-2 text-[11px] text-[#A39B8E]">No fields configured.</p>
          )}
        </div>
      </div>
    </div>
  );
}
