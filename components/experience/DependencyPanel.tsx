"use client";

import { useMemo, useState } from "react";
import Button from "../ui/Button";
import { logChange } from "@/lib/experience/migrate";
import type { StudioProject } from "@/lib/studio/types";
import type { SnapshotObject } from "@/lib/mapping/types";
import type { APIOperation, BackendDependency, DependencyKind } from "@/lib/experience/types";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const inputCls =
  "rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none";

const KINDS: DependencyKind[] = ["salesforce-object", "salesforce-field", "integration-mapping", "external-service", "middleware", "api-operation", "unknown"];

/** Backend dependencies for one operation + integrity display. */
export function DependencyPanel({
  projectId,
  snapshotObjects,
  integrationChoices,
  dependencies,
  operations,
  operation,
  onMutate,
  onOpenIntegration,
  brokenFor,
}: {
  /** Workspace root id (stored on references). */
  projectId: string;
  /** Aggregated snapshot objects across child mappings. */
  snapshotObjects: SnapshotObject[];
  /** Mapping rows + record plans across child mappings. */
  integrationChoices: { id: string; label: string }[];
  /** All catalog dependencies (filtered to this operation internally). */
  dependencies: BackendDependency[];
  /** Other catalog operations (for api-operation chaining). */
  operations: APIOperation[];
  operation: APIOperation;
  onMutate: (fn: (p: StudioProject) => StudioProject) => void;
  onOpenIntegration: () => void;
  /** Broken-dependency messages computed by the parent scope. */
  brokenFor: Map<string, string>;
}) {
  const [kind, setKind] = useState<DependencyKind>("salesforce-object");
  const [objName, setObjName] = useState("");
  const [fieldName, setFieldName] = useState("");
  const [artifactId, setArtifactId] = useState("");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");

  const deps = useMemo(
    () => (dependencies ?? []).filter((d) => d.operationId === operation.id),
    [dependencies, operation.id]
  );
  const problems = brokenFor;

  const mutateDeps = (fn: (list: BackendDependency[]) => BackendDependency[], summary: string, entityId: string) => {
    onMutate((p) => {
      if (!p.apiCatalog) return p;
      const now = new Date().toISOString();
      const next = { ...p, apiCatalog: { ...p.apiCatalog, dependencies: fn(p.apiCatalog.dependencies), updatedAt: now }, updatedAt: now };
      logChange(next, "dependency", entityId, "updated", summary, now);
      return next;
    });
  };

  const fieldsFor = objName ? (snapshotObjects.find((o) => o.name === objName)?.fields ?? []) : [];
  const otherOps = operations.filter((o) => o.id !== operation.id);

  const add = () => {
    const id = uid("dep");
    let reference: BackendDependency["reference"];
    let depLabel = label.trim();
    if (kind === "salesforce-object" && objName) {
      reference = { objectApiName: objName, label: snapshotObjects.find((o) => o.name === objName)?.label };
      depLabel = depLabel || objName;
    } else if (kind === "salesforce-field" && objName && fieldName) {
      reference = { objectApiName: objName, fieldApiName: fieldName };
      depLabel = depLabel || `${objName}.${fieldName}`;
    } else if (kind === "integration-mapping" && artifactId) {
      const choice = integrationChoices.find((c) => c.id === artifactId);
      reference = { projectId, artifactId, label: choice?.label };
      depLabel = depLabel || choice?.label || artifactId;
    } else if (kind === "api-operation" && artifactId) {
      const op = otherOps.find((o) => o.id === artifactId);
      reference = { artifactId, label: op ? `${op.method} ${op.path}` : undefined };
      depLabel = depLabel || op?.name || artifactId;
    } else if ((kind === "external-service" || kind === "middleware" || kind === "unknown") && depLabel) {
      reference = undefined;
    } else {
      return;
    }
    const dep: BackendDependency = { id, operationId: operation.id, kind, reference, label: depLabel, notes: notes.trim() || undefined, status: "proposed" };
    mutateDeps((list) => [...list, dep], `Dependency "${depLabel}" proposed on ${operation.name}.`, id);
    setObjName("");
    setFieldName("");
    setArtifactId("");
    setLabel("");
    setNotes("");
  };

  return (
    <div className="mt-3 rounded-xl border border-[#E8E2D8] bg-[#FAF8F2] p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
        Backend dependencies · {deps.length}
      </p>
      <ul className="space-y-1.5">
        {deps.map((d) => {
          const broken = problems.get(d.id);
          return (
            <li key={d.id} className={`rounded-lg border bg-white px-2.5 py-2 ${broken ? "border-[#E5B8B2]" : "border-[#F0EBE0]"}`}>
              <span className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="rounded border border-[#E8E2D8] bg-[#F5F1E8] px-1 font-mono text-[10px]">{d.kind}</span>
                <span className="font-semibold text-[#27241F]">{d.label}</span>
                <StatusDot status={d.status} />
                {d.kind === "integration-mapping" && (
                  <button type="button" onClick={onOpenIntegration} className="font-mono text-[10px] text-[#A98450] hover:underline cursor-pointer">
                    open integration ↗
                  </button>
                )}
                <span className="ml-auto flex gap-1">
                  {(["proposed", "confirmed", "open", "blocked"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => mutateDeps((list) => list.map((x) => (x.id === d.id ? { ...x, status: s } : x)), `Dependency "${d.label}" → ${s}.`, d.id)}
                      aria-pressed={d.status === s}
                      className={`rounded px-1 font-mono text-[10px] cursor-pointer ${d.status === s ? "bg-[#211F1B] text-white" : "text-[#A39B8E] hover:text-[#27241F]"}`}
                    >
                      {s}
                    </button>
                  ))}
                  <button type="button" onClick={() => mutateDeps((list) => list.filter((x) => x.id !== d.id), `Dependency "${d.label}" removed.`, d.id)} aria-label={`Remove dependency ${d.label}`} className="rounded px-1 text-[#B3261E] hover:bg-[#F9E8E6] cursor-pointer">
                    ✕
                  </button>
                </span>
              </span>
              {d.notes && <span className="block text-[11px] text-[#777168]">{d.notes}</span>}
              {broken ? (
                <span className="block text-[11px] text-[#B3261E]">⚠ {broken} Repair explicitly - nothing was redirected.</span>
              ) : (
                d.reference && (
                  <span className="block font-mono text-[10px] text-[#A39B8E]">
                    {[d.reference.objectApiName, d.reference.fieldApiName].filter(Boolean).join(".") || d.reference.artifactId || ""}
                  </span>
                )
              )}
            </li>
          );
        })}
        {deps.length === 0 && <li className="text-[12px] text-[#A39B8E]">No backend dependencies yet.</li>}
      </ul>

      {/* Add form */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <select value={kind} onChange={(e) => setKind(e.target.value as DependencyKind)} aria-label="Dependency kind" className={`${inputCls} cursor-pointer`}>
          {KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        {(kind === "salesforce-object" || kind === "salesforce-field") && (
          <select value={objName} onChange={(e) => { setObjName(e.target.value); setFieldName(""); }} aria-label="Salesforce object" className={`${inputCls} cursor-pointer font-mono`}>
            <option value="">object… ({snapshotObjects.length} in snapshot)</option>
            {snapshotObjects.map((o) => (
              <option key={o.name} value={o.name}>{o.name}</option>
            ))}
          </select>
        )}
        {kind === "salesforce-field" && (
          <select value={fieldName} onChange={(e) => setFieldName(e.target.value)} aria-label="Salesforce field" disabled={!objName} className={`${inputCls} cursor-pointer font-mono`}>
            <option value="">field…</option>
            {fieldsFor.map((f) => (
              <option key={f.name} value={f.name}>{f.name} · {f.type}</option>
            ))}
          </select>
        )}
        {(kind === "integration-mapping" || kind === "api-operation") && (
          <select value={artifactId} onChange={(e) => setArtifactId(e.target.value)} aria-label="Artifact" className={`${inputCls} cursor-pointer font-mono`}>
            <option value="">{kind === "integration-mapping" ? "mapping artifact…" : "operation…"}</option>
            {(kind === "integration-mapping" ? integrationChoices : otherOps.map((o) => ({ id: o.id, label: `${o.method} ${o.path} · ${o.name}` }))).map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        )}
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" aria-label="Dependency label" className={`${inputCls} w-32`} />
        <Button size="sm" variant="ghost" onClick={add}>
          Add
        </Button>
      </div>
      {snapshotObjects.length === 0 && (kind === "salesforce-object" || kind === "salesforce-field") && (
        <p className="mt-1 text-[11px] text-[#9A5B13]">No schema snapshot in this project - capture one from the Overview workspace first. No fields invented.</p>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: BackendDependency["status"] }) {
  const cls =
    status === "confirmed" ? "bg-[#2F7D4F]" : status === "blocked" ? "bg-[#B3261E]" : status === "open" ? "bg-[#A39B8E]" : "bg-[#DCC99A]";
  return (
    <span className="flex items-center gap-1 font-mono text-[10px] text-[#777168]">
      <span className={`h-1.5 w-1.5 rounded-full ${cls}`} aria-hidden="true" />
      {status}
    </span>
  );
}
