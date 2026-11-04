"use client";

import { useMemo, useState } from "react";
import Button from "../ui/Button";
import { logChange } from "@/lib/experience/migrate";
import { checkDependencies, type CrossScope } from "@/lib/experience/bridge";
import { DependencyPanel } from "./DependencyPanel";
import { findDuplicateOperations, normalizeOperationKey, operationUsage, orphanOperations } from "@/lib/experience/apiCatalog";
import { downloadApiInventory } from "@/lib/experience/apiInventory";
import type { StudioProject } from "@/lib/studio/types";
import type { ApiCatalog, ApiLayer, ApiLifecycle, APIOperation, HttpMethod } from "@/lib/experience/types";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const inputCls =
  "w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OTHER"];
const LAYERS: ApiLayer[] = ["frontend", "bff", "salesforce", "middleware", "external", "unknown"];

/** Project-level shared API catalog: operations, filters, usage, orphans. */
export function ApiCatalogPanel({
  project,
  cross,
  onMutate,
  onOpenIntegration,
}: {
  project: StudioProject;
  /** Aggregated child snapshots / mappings / plans for cross-child refs. */
  cross: CrossScope;
  onMutate: (fn: (p: StudioProject) => StudioProject) => void;
  onOpenIntegration: () => void;
}) {
  const catalog: ApiCatalog = project.apiCatalog!;
  const bindings = useMemo(() => project.experience?.bindings ?? [], [project.experience?.bindings]);
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState("all");
  const [layer, setLayer] = useState("all");
  const [scope, setScope] = useState<"all" | "used" | "orphan">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [invBusy, setInvBusy] = useState(false);
  const [editing, setEditing] = useState<APIOperation | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const touchCatalog = (fn: (c: ApiCatalog) => ApiCatalog, summary: string, entityId: string) => {
    onMutate((p) => {
      if (!p.apiCatalog) return p;
      const now = new Date().toISOString();
      const next = { ...p, apiCatalog: { ...fn(p.apiCatalog), updatedAt: now }, updatedAt: now };
      logChange(next, "api-operation", entityId, "updated", summary, now);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const orphans = new Set(orphanOperations(catalog.operations, bindings).map((o) => o.id));
    return catalog.operations.filter((o) => {
      if (method !== "all" && o.method !== method) return false;
      if (layer !== "all" && o.layer !== layer) return false;
      if (scope === "used" && orphans.has(o.id)) return false;
      if (scope === "orphan" && !orphans.has(o.id)) return false;
      if (q && !o.name.toLowerCase().includes(q) && !o.path.toLowerCase().includes(q) && !o.description?.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [catalog.operations, bindings, query, method, layer, scope]);

  return (
    <div className="rounded-xl border border-[#E8E2D8] bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
          API Catalog · {catalog.operations.length}
        </p>
        <span className="ml-auto" />
        <Button
          size="sm"
          variant="secondary"
          disabled={invBusy || filtered.length === 0}
          onClick={() => {
            setInvBusy(true);
            const ids = new Set(filtered.map((o) => o.id));
            const safe = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
            void downloadApiInventory(
              project.name,
              { operations: filtered, dependencies: catalog.dependencies.filter((d) => ids.has(d.operationId)) },
              `${safe}-api-inventory.xlsx`,
            ).finally(() => setInvBusy(false));
          }}
          title="Download the visible operations as .xlsx (respects filters)"
        >
          {invBusy ? "Building…" : "Inventory (.xlsx)"}
        </Button>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          Add operation
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, path, description…"
          aria-label="Search API operations"
          spellCheck={false}
          className="min-w-[180px] flex-1 rounded-lg border border-[#E8E2D8] px-2.5 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none"
        />
        {(
          [["method", method, setMethod, ["all", ...METHODS]], ["layer", layer, setLayer, ["all", ...LAYERS]]] as const
        ).map(([label, val, set, opts]) => (
          <select key={label} value={val} onChange={(e) => set(e.target.value)} aria-label={`Filter by ${label}`} className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[11px]">
            {opts.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        ))}
        <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} aria-label="Usage filter" className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[11px]">
          <option value="all">used + unused</option>
          <option value="used">used</option>
          <option value="orphan">unused (orphans)</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#E8E2D8]">
        <table className="w-full min-w-[820px] border-collapse bg-white text-left text-[12px]">
          <thead>
            <tr className="border-b border-[#E8E2D8] bg-[#FAF8F2] font-mono text-[10px] uppercase tracking-wider text-[#A39B8E]">
              <th className="px-2.5 py-2 font-semibold">Operation</th>
              <th className="px-2.5 py-2 font-semibold">Method · Path</th>
              <th className="px-2.5 py-2 font-semibold">Layer</th>
              <th className="px-2.5 py-2 font-semibold">Lifecycle</th>
              <th className="px-2.5 py-2 font-semibold">Contracts</th>
              <th className="px-2.5 py-2 font-semibold">Used by</th>
              <th className="px-2.5 py-2 font-semibold"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const usage = operationUsage(bindings, o.id);
              const usedTotal = usage.screens + usage.components + usage.actions;
              const hasContracts = !!(o.requestContractId || o.responseContractId);
              return (
                <tr key={o.id} className="border-b border-[#F0EBE0] last:border-0 hover:bg-[#FAF8F2]">
                  <td className="max-w-[200px] px-2.5 py-1.5">
                    <span className="block truncate font-semibold text-[#27241F]">{o.name}</span>
                    <span className="block truncate font-mono text-[10px] text-[#A39B8E]">{o.owner ?? "no owner"} · {o.status}</span>
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-[11px]">
                    <span className="mr-1.5 rounded border border-[#E8E2D8] bg-[#F5F1E8] px-1 font-bold">{o.method}</span>
                    {o.path}
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-[11px] text-[#777168]">{o.layer}</td>
                  <td className="px-2.5 py-1.5 font-mono text-[11px] text-[#777168]">{o.lifecycle}</td>
                  <td className="px-2.5 py-1.5 font-mono text-[11px] text-[#777168]">
                    {hasContracts ? "attached" : <span className="text-[#B3261E]">missing</span>}
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-[11px] text-[#777168]">
                    {usedTotal === 0 ? <span className="text-[#A39B8E]">orphan</span> : `${usage.screens} screens · ${usage.components} comps`}
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    <button type="button" onClick={() => setDetailId(detailId === o.id ? null : o.id)} aria-pressed={detailId === o.id} className="rounded px-1.5 py-0.5 font-mono text-[11px] text-[#777168] hover:text-[#27241F] cursor-pointer">
                      deps
                    </button>
                    <button type="button" onClick={() => setEditing(o)} className="rounded px-1.5 py-0.5 font-mono text-[11px] text-[#A98450] hover:bg-[#F5EEDF] cursor-pointer">
                      edit
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2.5 py-6 text-center text-[12px] text-[#A39B8E]">
                  No operations match. Add the first backend operation.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {detailId && catalog.operations.some((o) => o.id === detailId) && (
        <DependencyPanel
          projectId={project.id}
          snapshotObjects={cross.snapshots ?? []}
          integrationChoices={[
            ...(cross.plans ?? []).map((r) => ({ id: r.id, label: `plan: ${r.name ?? r.id}${r.objectName ? ` → ${r.objectName}` : ""}` })),
            ...(cross.mappings ?? []).map((m) => ({ id: m.id, label: `map: ${m.sourcePath} → ${m.objectName}.${m.fieldName || "?"}` })),
          ]}
          dependencies={catalog.dependencies}
          operations={catalog.operations}
          operation={catalog.operations.find((o) => o.id === detailId)!}
          onMutate={onMutate}
          onOpenIntegration={onOpenIntegration}
          brokenFor={new Map(checkDependencies({ apiCatalog: catalog }, cross).map((p) => [p.dependencyId, p.message]))}
        />
      )}

      {showAdd && (
        <OperationDialog
          onClose={() => setShowAdd(false)}
          onSave={(op) => {
            touchCatalog((c) => ({ ...c, operations: [...c.operations, op] }), `API operation "${op.name}" added (${op.layer}).`, op.id);
            setShowAdd(false);
          }}
          existing={catalog.operations}
        />
      )}
      {editing && (
        <OperationDialog
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(op) => {
            touchCatalog((c) => ({ ...c, operations: c.operations.map((x) => (x.id === op.id ? op : x)) }), `API operation "${op.name}" updated.`, op.id);
            setEditing(null);
          }}
          existing={catalog.operations}
        />
      )}
    </div>
  );
}

function OperationDialog({
  initial,
  existing,
  onClose,
  onSave,
}: {
  initial?: APIOperation;
  existing: APIOperation[];
  onClose: () => void;
  onSave: (op: APIOperation) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [method, setMethod] = useState<HttpMethod>(initial?.method ?? "GET");
  const [path, setPath] = useState(initial?.path ?? "");
  const [layer, setLayer] = useState<ApiLayer>(initial?.layer ?? "bff");
  const [lifecycle, setLifecycle] = useState<ApiLifecycle>(initial?.lifecycle ?? "proposed");
  const [owner, setOwner] = useState(initial?.owner ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [reqContract, setReqContract] = useState(initial?.requestContractId ?? "");
  const [resContract, setResContract] = useState(initial?.responseContractId ?? "");

  const dupes = name || path ? findDuplicateOperations(existing, method, path, initial?.id) : [];

  const save = () => {
    if (!name.trim() || !path.trim()) return;
    const now = new Date().toISOString();
    onSave({
      id: initial?.id ?? uid("op"),
      operationKey: normalizeOperationKey(method, path),
      name: name.trim(),
      description: description.trim() || undefined,
      method,
      path: path.trim(),
      layer,
      owner: owner.trim() || undefined,
      requestContractId: reqContract.trim() || undefined,
      responseContractId: resContract.trim() || undefined,
      errorContractIds: initial?.errorContractIds ?? [],
      dependencyIds: initial?.dependencyIds ?? [],
      lifecycle,
      status: initial?.status ?? "proposed",
      tags: initial?.tags ?? [],
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-label="API operation">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#E8E2D8] bg-white p-5 sm:p-6">
        <p className="text-[14px] font-semibold text-[#27241F]">{initial ? "Edit operation" : "Add operation"}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="block text-[12px] font-semibold text-[#27241F] sm:col-span-2">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Get order items" className={`${inputCls} mt-1 font-normal`} />
          </label>
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Method
            <select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)} className={`${inputCls} mt-1 font-normal cursor-pointer`}>
              {METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Path
            <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/orders/{id}/items" spellCheck={false} className={`${inputCls} mt-1 font-mono font-normal`} />
          </label>
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Layer
            <select value={layer} onChange={(e) => setLayer(e.target.value as ApiLayer)} className={`${inputCls} mt-1 font-normal cursor-pointer`}>
              {LAYERS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Lifecycle
            <select value={lifecycle} onChange={(e) => setLifecycle(e.target.value as ApiLifecycle)} className={`${inputCls} mt-1 font-normal cursor-pointer`}>
              <option value="existing">existing</option>
              <option value="proposed">proposed</option>
              <option value="in-review">in-review</option>
              <option value="approved">approved</option>
              <option value="deprecated">deprecated</option>
            </select>
          </label>
          <label className="block text-[12px] font-semibold text-[#27241F] sm:col-span-2">
            Owner (optional)
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="BFF team" className={`${inputCls} mt-1 font-normal`} />
          </label>
          <label className="block text-[12px] font-semibold text-[#27241F] sm:col-span-2">
            Description (optional)
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputCls} mt-1 font-normal`} />
          </label>
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Request contract ref (optional)
            <input value={reqContract} onChange={(e) => setReqContract(e.target.value)} placeholder="contract id / OpenAPI op" spellCheck={false} className={`${inputCls} mt-1 font-mono font-normal`} />
          </label>
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Response contract ref (optional)
            <input value={resContract} onChange={(e) => setResContract(e.target.value)} placeholder="contract id / schema" spellCheck={false} className={`${inputCls} mt-1 font-mono font-normal`} />
          </label>
        </div>
        {dupes.length > 0 && (
          <p role="alert" className="mt-2 rounded-lg border border-[#E0C491] bg-[#F3EADB] px-3 py-2 text-[12px] text-[#9A5B13]">
            Same method + path already exists: {dupes.map((d) => d.name).join(", ")}. Reuse it or version explicitly - saving anyway is allowed.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || !path.trim()} onClick={save}>
            {initial ? "Save" : "Add operation"}
          </Button>
        </div>
      </div>
    </div>
  );
}
