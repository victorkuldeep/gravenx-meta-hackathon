"use client";

import { useEffect, useMemo, useState } from "react";
import { rankObjects } from "@/lib/search/rank";
import { adaptDescribe } from "@/lib/contracts/metadata-adapter";
import { diagnoseProfile } from "@/lib/contracts/diagnostics";
import type { ContractFieldConfig, ContractOperation, TransformKind } from "@/lib/contracts/types";
import Input from "../ui/Input";
import type { ContractsTabsProps } from "./ContractsTabs";

/**
 * Designer tab: profile + operations left, field contract center,
 * inspector right, field drawer for configuration + mappings.
 */
export function ContractDesigner(props: ContractsTabsProps) {
  const { drafts, activeId, describes, session, stored } = props;
  const { onPatchDraft, onFetchDescribe, onConnect } = props;
  const draft = activeId ? (drafts.get(activeId) ?? null) : null;

  const [drawerField, setDrawerField] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selFilter, setSelFilter] = useState<"all" | "selected" | "unselected">("all");
  const [sort, setSort] = useState<"label" | "api">("label");

  const describe = draft ? describes.get(draft.targetObjectApiName) : undefined;
  const storedSnap = activeId ? (stored.find((s) => s.id === activeId)?.snapshot ?? null) : null;

  useEffect(() => {
    if (session && draft?.targetObjectApiName && !describes.has(draft.targetObjectApiName)) {
      void onFetchDescribe(draft.targetObjectApiName);
    }
  }, [session, draft?.targetObjectApiName, describes, onFetchDescribe]);

  const meta = useMemo(() => (describe ? adaptDescribe(describe).fields : []), [describe]);

  const issues = useMemo(() => {
    if (!draft) return [];
    const m = new Map(meta.map((f) => [f.apiName, f]));
    return diagnoseProfile({ profile: draft, metaByName: m, snapshotCapturedAt: storedSnap?.capturedAt ?? null });
  }, [draft, meta, storedSnap]);

  const configured = useMemo(() => new Set(draft?.fields.map((f) => f.salesforceApiName) ?? []), [draft]);

  const candidates = useMemo(() => {
    const matchesBase = (m: (typeof meta)[number]) => {
      if (typeFilter !== "all" && m.sfType !== typeFilter) return false;
      const sel = configured.has(m.apiName);
      if (selFilter === "selected" && !sel) return false;
      if (selFilter === "unselected" && sel) return false;
      return true;
    };
    const q = search.trim().toLowerCase();
    if (!q) {
      return meta
        .filter(matchesBase)
        .sort((a, b) => (sort === "label" ? a.label.localeCompare(b.label) : a.apiName.localeCompare(b.apiName)))
        .slice(0, 60);
    }
    const ranked = new Set(
      rankObjects(
        meta.filter(matchesBase).map((m) => ({ label: m.label, name: m.apiName })),
        search,
        60
      ).map((r) => r.name)
    );
    return meta.filter((m) => ranked.has(m.apiName));
  }, [meta, typeFilter, selFilter, configured, search, sort]);

  const types = useMemo(() => ["all", ...Array.from(new Set(meta.map((f) => f.sfType))).sort()], [meta]);

  if (!draft) {
    return (
      <div className="rounded-xl border border-[#E8E2D8] bg-white p-10 text-center text-sm text-[#A39B8E]">
        Select a profile to design - or create one from the Profiles tab.
      </div>
    );
  }

  const patch = (p: Partial<typeof draft>) => onPatchDraft(draft.id, p);

  const addField = (apiName: string) => {
    const m = meta.find((f) => f.apiName === apiName);
    if (!m || configured.has(apiName)) return;
    const ops = draft.operations.filter((o) => o.enabled).map((o) => o.operation);
    const row: ContractFieldConfig = {
      salesforceApiName: apiName,
      externalName: apiName,
      label: m.label,
      description: "",
      operations: ops.length > 0 ? ops : (["POST"] as ContractOperation[]),
      integrationRequired: false,
      nullable: false,
      ownership: "consumer",
      mapping: {
        externalName: apiName,
        targetField: apiName,
        transform: "direct",
        direction: "inbound",
        ownership: "consumer",
      },
    };
    onPatchDraft(draft.id, { fields: [...draft.fields, row] });
  };

  const drawerCfg = drawerField ? (draft.fields.find((f) => f.salesforceApiName === drawerField) ?? null) : null;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)_260px]">
      {/* LEFT: profile + operations */}
      <div className="space-y-3">
        <div className="rounded-xl border border-[#E8E2D8] bg-white p-3 space-y-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Profile</p>
          <Input label="Name" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
          <Input label="Consumer system" value={draft.consumer} onChange={(e) => patch({ consumer: e.target.value })} placeholder="Acquisition Platform" />
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-0.5 block text-[11px] text-[#777168]">Direction</span>
              <select
                value={draft.direction}
                onChange={(e) => patch({ direction: e.target.value as typeof draft.direction })}
                className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] cursor-pointer"
              >
                <option value="inbound">inbound</option>
                <option value="outbound">outbound</option>
                <option value="bidirectional">bidirectional</option>
              </select>
            </label>
            <Input label="Contract version" value={draft.apiVersion} onChange={(e) => patch({ apiVersion: e.target.value })} spellCheck={false} />
          </div>
          <Input label="API title" value={draft.apiTitle} onChange={(e) => patch({ apiTitle: e.target.value })} />
          <Input label="External base URL" value={draft.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} placeholder="Empty = Salesforce-native" spellCheck={false} />
          <Input label="Resource path" value={draft.resourcePath} onChange={(e) => patch({ resourcePath: e.target.value })} placeholder="/v1/leads" spellCheck={false} />
          <p className="font-mono text-[11px] text-[#A39B8E]">
            {draft.targetObjectApiName} · {draft.salesforceApiVersion} · rev {draft.revision}
          </p>
          <div className="rounded-lg bg-[#F8F6F0] px-2 py-1.5 text-[11px] text-[#777168]">
            {describe ? (
              <span><span className="text-[#32815B] font-semibold">● Live</span> metadata loaded</span>
            ) : storedSnap ? (
              <span><span className="text-[#B98335] font-semibold">● Snapshot</span> {new Date(storedSnap.capturedAt).toLocaleDateString()} - stale?</span>
            ) : (
              <span><span className="text-[#B84C42] font-semibold">● No metadata</span> - connect to load</span>
            )}
            {session && (
              <button onClick={() => void onFetchDescribe(draft.targetObjectApiName)} className="ml-2 underline cursor-pointer">Refresh</button>
            )}
            {!session && (
              <button onClick={onConnect} className="ml-2 underline cursor-pointer">Connect</button>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[#E8E2D8] bg-white p-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Operations</p>
          {(["POST", "PATCH"] as ContractOperation[]).map((op) => {
            const cfg = draft.operations.find((o) => o.operation === op);
            const count = draft.fields.filter((f) => f.operations.includes(op)).length;
            return (
              <div key={op} className="rounded-lg border border-[#E8E2D8] p-2">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={cfg?.enabled ?? false}
                    onChange={(e) =>
                      onPatchDraft(draft.id, {
                        operations: draft.operations.map((o) => (o.operation === op ? { ...o, enabled: e.target.checked } : o)),
                      })
                    }
                    className="h-3.5 w-3.5 rounded"
                  />
                  <span className="font-mono text-xs font-bold text-[#27241F]">{op}</span>
                  <span className="ml-auto font-mono text-[11px] text-[#A39B8E]">{count}f</span>
                </label>
                {cfg?.enabled && (
                  <div className="mt-1.5 space-y-1.5">
                    <Input
                      value={cfg.operationId}
                      onChange={(e) =>
                        onPatchDraft(draft.id, {
                          operations: draft.operations.map((o) => (o.operation === op ? { ...o, operationId: e.target.value } : o)),
                        })
                      }
                      aria-label={`${op} operationId`}
                      spellCheck={false}
                    />
                    <Input
                      value={cfg.summary}
                      onChange={(e) =>
                        onPatchDraft(draft.id, {
                          operations: draft.operations.map((o) => (o.operation === op ? { ...o, summary: e.target.value } : o)),
                        })
                      }
                      aria-label={`${op} summary`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* CENTER: field contract */}
      <div className="rounded-xl border border-[#E8E2D8] bg-white overflow-hidden">
        <div className="border-b border-[#E8E2D8] p-3 space-y-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <Input placeholder="Search label or API name…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search fields" />
            </div>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] cursor-pointer" aria-label="Filter by type">
              {types.map((t) => (
                <option key={t} value={t}>{t === "all" ? "All types" : t}</option>
              ))}
            </select>
            <select value={selFilter} onChange={(e) => setSelFilter(e.target.value as typeof selFilter)} className="rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] cursor-pointer" aria-label="Filter by selection">
              <option value="all">All</option>
              <option value="selected">Selected</option>
              <option value="unselected">Unselected</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] cursor-pointer" aria-label="Sort">
              <option value="label">A-Z</option>
              <option value="api">API name</option>
            </select>
          </div>
          <p className="font-mono text-[11px] text-[#A39B8E]">
            {draft.fields.length} configured · {meta.length > 0 ? `${meta.length} in metadata` : "metadata not loaded"}
          </p>
        </div>
        <div className="max-h-[560px] overflow-y-auto p-1.5">
          {meta.length === 0 && (
            <p className="px-3 py-8 text-center text-[13px] text-[#A39B8E]">
              {session ? "Loading metadata…" : "Connect an org to browse fields - saved contracts stay viewable from snapshots."}
            </p>
          )}
          {candidates.map((m) => {
            const cfg = draft.fields.find((f) => f.salesforceApiName === m.apiName) ?? null;
            const on = cfg !== null;
            return (
              <div
                key={m.apiName}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors ${on ? "bg-[#211F1B] text-white" : "hover:bg-[#F5F1E8] text-[#27241F]"}`}
                onClick={() => (on ? setDrawerField(m.apiName) : addField(m.apiName))}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (on) setDrawerField(m.apiName);
                    else addField(m.apiName);
                  }
                }}
                title={on ? "Open field configuration" : "Add field"}
              >
                <span className={`min-w-0 flex-1 truncate font-medium`}>{m.label}</span>
                <span className={`truncate font-mono text-[11px] ${on ? "text-white/60" : "text-[#A39B8E]"}`}>{m.apiName}</span>
                <span className={`shrink-0 rounded border px-1 font-mono text-[10px] ${on ? "border-white/30 text-white/70" : "border-[#E8E2D8] bg-[#F8F6F0] text-[#777168]"}`}>{m.sfType}</span>
                {on && cfg && (
                  <span className="flex shrink-0 gap-0.5 font-mono text-[10px]">
                    {cfg.operations.includes("POST") && <span className="rounded bg-green-700 px-1 text-white">POST</span>}
                    {cfg.operations.includes("PATCH") && <span className="rounded bg-amber-600 px-1 text-white">PATCH</span>}
                    {(cfg.integrationRequired || (cfg.operations.includes("POST") && !m.nillable && m.createable && !m.defaultedOnCreate)) && (
                      <span className="rounded bg-red-700 px-1 text-white" title="Required">R</span>
                    )}
                  </span>
                )}
                {on && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPatchDraft(draft.id, { fields: draft.fields.filter((f) => f.salesforceApiName !== m.apiName) });
                      if (drawerField === m.apiName) setDrawerField(null);
                    }}
                    aria-label={`Remove ${m.apiName}`}
                    title="Remove field"
                    className={`shrink-0 rounded p-1 text-[13px] leading-none cursor-pointer ${on ? "text-white/60 hover:text-white" : ""}`}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT: inspector */}
      <div className="space-y-3">
        <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Inspector</p>
          {draft.operations.filter((o) => o.enabled).map((o) => {
            const fs = draft.fields.filter((f) => f.operations.includes(o.operation));
            return (
              <div key={o.operation} className="mt-2 rounded-lg bg-[#F8F6F0] px-2 py-1.5 font-mono text-[11px] text-[#777168]">
                <span className="font-bold text-[#27241F]">{o.operation}</span> · {fs.length} fields
              </div>
            );
          })}
          {issues.filter((i) => i.level === "error").length > 0 && (
            <p className="mt-2 text-[11px] text-[#B84C42]">
              {issues.filter((i) => i.level === "error").length} error(s) - see Validate.
            </p>
          )}
          {issues.filter((i) => i.level === "warning").length > 0 && (
            <p className="mt-1 text-[11px] text-[#B98335]">
              {issues.filter((i) => i.level === "warning").length} warning(s) - see Validate.
            </p>
          )}
          {issues.length === 0 && <p className="mt-2 text-[11px] text-[#32815B]">Clean.</p>}
        </div>
        <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Contract</p>
          <p className="mt-1 font-mono text-[11px] text-[#777168] break-all">
            {draft.baseUrl.trim() === "" ? `/services/data/${draft.salesforceApiVersion}/sobjects/${draft.targetObjectApiName}` : `${draft.baseUrl}${draft.resourcePath}`}
          </p>
          <p className="mt-1 text-[11px] text-[#A39B8E]">
            {draft.security.type === "none" ? "No auth declared" : draft.security.type === "api-key" ? "API key (placeholder)" : "OAuth2 (placeholder)"} · rev {draft.revision}
          </p>
        </div>
      </div>

      {/* Field drawer */}
      {drawerCfg && (
        <FieldDrawer
          draftId={draft.id}
          field={drawerCfg}
          metaApiNames={new Map(meta.map((m) => [m.apiName, m]))}
          issues={issues.filter((i) => i.fieldApiName === drawerCfg.salesforceApiName)}
          onPatchDraft={onPatchDraft}
          onClose={() => setDrawerField(null)}
        />
      )}
    </div>
  );
}

// ── Field drawer ────────────────────────────────────────────────────────────

function FieldDrawer({
  draftId,
  field,
  metaApiNames,
  issues,
  onPatchDraft,
  onClose,
}: {
  draftId: string;
  field: ContractFieldConfig;
  metaApiNames: Map<string, { sfType: string; referenceTo: string[]; picklistValues: { value: string }[] }>;
  issues: { level: string; message: string }[];
  onPatchDraft: ContractsTabsProps["onPatchDraft"];
  onClose: () => void;
}) {
  const set = (patch: Partial<ContractFieldConfig>) =>
    onPatchDraft(draftId, (p) => ({
      ...p,
      fields: p.fields.map((f) => (f.salesforceApiName === field.salesforceApiName ? { ...f, ...patch } : f)),
    }));
  const setMapping = (patch: Partial<NonNullable<ContractFieldConfig["mapping"]>>) =>
    onPatchDraft(draftId, (p) => ({
      ...p,
      fields: p.fields.map((f) =>
        f.salesforceApiName === field.salesforceApiName
          ? {
              ...f,
              mapping: {
                externalName: f.externalName,
                targetField: f.salesforceApiName,
                transform: "direct" as const,
                direction: "inbound" as const,
                ownership: f.ownership,
                ...(f.mapping ?? {}),
                ...patch,
              },
            }
          : f
      ),
    }));
  const meta = metaApiNames.get(field.salesforceApiName);
  const transforms: { v: TransformKind; label: string }[] = [
    { v: "direct", label: "Direct" },
    { v: "trim", label: "Trim" },
    { v: "lowercase", label: "Lowercase" },
    { v: "uppercase", label: "Uppercase" },
    { v: "date-format", label: "Date format" },
    { v: "enum-map", label: "Enum map" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label={`Configure ${field.salesforceApiName}`}>
      <div className="absolute inset-0 bg-[rgba(24,20,12,0.4)]" onClick={onClose} />
      <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-[#E8E2D8] bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-mono text-xs text-[#A39B8E]">{field.salesforceApiName}</p>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-xs text-[#777168] hover:bg-[#F5F1E8] cursor-pointer" aria-label="Close drawer">✕</button>
        </div>
        <Input label="External name" value={field.externalName} onChange={(e) => set({ externalName: e.target.value })} spellCheck={false} />
        <Input label="Label" value={field.label} onChange={(e) => set({ label: e.target.value })} />
        <Input label="Description" value={field.description} onChange={(e) => set({ description: e.target.value })} />
        <div className="flex gap-3">
          {(["POST", "PATCH"] as const).map((op) => (
            <label key={op} className="flex cursor-pointer items-center gap-1.5 text-[13px]">
              <input
                type="checkbox"
                checked={field.operations.includes(op)}
                onChange={(e) =>
                  set({
                    operations: e.target.checked
                      ? [...field.operations, op]
                      : field.operations.filter((o) => o !== op),
                  })
                }
                className="h-3.5 w-3.5 rounded"
              />
              <span className="font-mono text-xs">{op}</span>
            </label>
          ))}
          <label className="flex cursor-pointer items-center gap-1.5 text-[13px]" title="Business-required beyond Salesforce metadata">
            <input
              type="checkbox"
              checked={field.integrationRequired}
              onChange={(e) => set({ integrationRequired: e.target.checked })}
              className="h-3.5 w-3.5 rounded"
            />
            Required
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-[13px]" title="Allow explicit null (PATCH clearing)">
            <input
              type="checkbox"
              checked={field.nullable}
              onChange={(e) => set({ nullable: e.target.checked })}
              className="h-3.5 w-3.5 rounded"
            />
            Nullable
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-[#777168]">Ownership</span>
            <select value={field.ownership} onChange={(e) => set({ ownership: e.target.value as typeof field.ownership })} className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] cursor-pointer">
              <option value="consumer">consumer</option>
              <option value="salesforce">salesforce</option>
              <option value="shared">shared</option>
            </select>
          </label>
          <Input label="Default value" value={field.defaultValue === undefined ? "" : String(field.defaultValue)} onChange={(e) => set({ defaultValue: e.target.value === "" ? undefined : e.target.value })} spellCheck={false} />
        </div>
        <Input
          label="Enum override (comma-separated)"
          value={(field.enumOverride ?? []).join(", ")}
          onChange={(e) => set({ enumOverride: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          spellCheck={false}
        />
        {meta && meta.referenceTo.length > 0 && (
          <p className="font-mono text-[11px] text-[#7A5C9E]">→ {meta.referenceTo.join(", ")}</p>
        )}

        <div className="rounded-lg border border-[#D8C7A9] bg-[#F5F1E8] p-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-[#A98450]">Mapping</p>
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-[#777168]">Transform</span>
            <select
              value={field.mapping?.transform ?? "direct"}
              onChange={(e) => setMapping({ transform: e.target.value as TransformKind })}
              className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] cursor-pointer"
            >
              {transforms.map((t) => (
                <option key={t.v} value={t.v}>{t.label}</option>
              ))}
            </select>
          </label>
          {field.mapping?.transform === "date-format" && (
            <Input label="Date pattern" value={field.mapping.dateFormat ?? ""} onChange={(e) => setMapping({ dateFormat: e.target.value })} placeholder="yyyy-MM-dd" spellCheck={false} />
          )}
          {field.mapping?.transform === "enum-map" && (
            <div>
              <label className="mb-0.5 block text-[11px] text-[#777168]">External = Salesforce (one per line)</label>
              <textarea
                value={Object.entries(field.mapping.enumMap ?? {}).map(([k, v]) => `${k} = ${v}`).join("\n")}
                onChange={(e) => {
                  const map: Record<string, string> = {};
                  for (const line of e.target.value.split("\n")) {
                    const [k, v] = line.split("=").map((s) => s.trim());
                    if (k && v) map[k] = v;
                  }
                  setMapping({ enumMap: map });
                }}
                rows={3}
                spellCheck={false}
                placeholder={"Tech = Technology\nFin = Finance"}
                className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 font-mono text-[13px] focus:border-[#A98450] focus:outline-none"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-0.5 block text-[11px] text-[#777168]">Direction</span>
              <select value={field.mapping?.direction ?? "inbound"} onChange={(e) => setMapping({ direction: e.target.value as "inbound" | "outbound" })} className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] cursor-pointer">
                <option value="inbound">inbound</option>
                <option value="outbound">outbound</option>
              </select>
            </label>
            <Input label="Notes" value={field.mapping?.notes ?? ""} onChange={(e) => setMapping({ notes: e.target.value })} />
          </div>
        </div>

        {issues.length > 0 && (
          <div className="space-y-1">
            {issues.map((issue, k) => (
              <p key={k} className={`text-[11px] ${issue.level === "error" ? "text-[#B84C42]" : "text-[#B98335]"}`}>
                {issue.message}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
