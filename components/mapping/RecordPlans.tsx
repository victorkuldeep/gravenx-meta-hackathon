"use client";

import { useState } from "react";
import Button from "../ui/Button";
import type { MappingProject, OperationIntent, RecordPlan, RelationshipDef } from "@/lib/mapping/types";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Record plans + parent-child relationships for multi-object mappings. */
export function RecordPlans({
  project,
  activePlanId,
  onActivePlan,
  onAddPlan,
  onRemovePlan,
  onAddRelationship,
  onRemoveRelationship,
  onToggleConfirm,
}: {
  project: MappingProject;
  activePlanId: string | null;
  onActivePlan: (id: string | null) => void;
  onAddPlan: (plan: RecordPlan) => void;
  onRemovePlan: (id: string) => void;
  onAddRelationship: (rel: RelationshipDef) => void;
  onRemoveRelationship: (id: string) => void;
  onToggleConfirm: (id: string) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [objectName, setObjectName] = useState("");
  const [intent, setIntent] = useState<OperationIntent>("create");
  const [sourcePath, setSourcePath] = useState("");
  const [cardinality, setCardinality] = useState<"one" | "many">("one");
  const [parentPlanId, setParentPlanId] = useState("");
  const [relChild, setRelChild] = useState("");
  const [relParent, setRelParent] = useState("");
  const [relField, setRelField] = useState("");

  const availableObjects = [...new Set([...project.mappings.map((m) => m.objectName), ...(project.sfSnapshot?.objects.map((o) => o.name) ?? [])])].sort();

  const create = () => {
    if (!name.trim() || !objectName.trim()) return;
    onAddPlan({
      id: uid("plan"),
      name: name.trim(),
      objectName: objectName.trim(),
      intent,
      sourcePath: sourcePath.trim(),
      cardinality,
      parentPlanId: parentPlanId || null,
    });
    setName("");
    setObjectName("");
    setSourcePath("");
    setParentPlanId("");
    setFormOpen(false);
  };

  const planStatus = (plan: RecordPlan): string => {
    const rows = project.mappings.filter((m) => m.planId === plan.id);
    if (rows.length === 0) return "empty";
    if (rows.some((m) => m.status === "incompatible" || m.status === "invalid" || m.status === "stale-target")) return "needs review";
    if (rows.some((m) => m.status === "needs-decision" || m.status === "needs-transformation")) return "decision needed";
    return "in progress";
  };

  const inputCls = "rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none";

  return (
    <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
          Record plans · {project.recordPlans.length}
        </p>
        <Button size="sm" variant="ghost" onClick={() => setFormOpen((v) => !v)}>
          {formOpen ? "Cancel" : "Add plan"}
        </Button>
      </div>

      {formOpen && (
        <div className="mb-2 grid grid-cols-2 gap-2 rounded-lg border border-[#F0EBE0] bg-[#FAF8F2] p-2.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Plan name (e.g. Order Items)" aria-label="Plan name" className={inputCls} />
          <input value={objectName} onChange={(e) => setObjectName(e.target.value)} placeholder="Target object API name" aria-label="Target object" list="mapping-plan-objects" className={`${inputCls} font-mono`} />
          <datalist id="mapping-plan-objects">
            {availableObjects.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <select value={intent} onChange={(e) => setIntent(e.target.value as OperationIntent)} aria-label="Operation intent" className={`${inputCls} cursor-pointer`}>
            <option value="create">create</option>
            <option value="update">update</option>
            <option value="upsert">upsert</option>
            <option value="lookup">lookup</option>
          </select>
          <select value={cardinality} onChange={(e) => setCardinality(e.target.value as "one" | "many")} aria-label="Cardinality" className={`${inputCls} cursor-pointer`}>
            <option value="one">one record</option>
            <option value="many">many records</option>
          </select>
          <input value={sourcePath} onChange={(e) => setSourcePath(e.target.value)} placeholder="Source path (e.g. $.orderItem[])" aria-label="Source path" className={`${inputCls} font-mono`} />
          <select value={parentPlanId} onChange={(e) => setParentPlanId(e.target.value)} aria-label="Parent plan" className={`${inputCls} cursor-pointer`}>
            <option value="">no parent plan</option>
            {project.recordPlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="col-span-2 flex justify-end">
            <Button size="sm" disabled={!name.trim() || !objectName.trim()} onClick={create}>
              Create plan
            </Button>
          </span>
        </div>
      )}

      {project.recordPlans.length === 0 && !formOpen && (
        <p className="text-[12px] text-[#A39B8E]">No record plans - mappings attach directly to objects until you add plans.</p>
      )}

      <ul className="space-y-1.5">
        {project.recordPlans.map((plan) => {
          const count = project.mappings.filter((m) => m.planId === plan.id).length;
          const active = activePlanId === plan.id;
          return (
            <li key={plan.id} className={`rounded-lg border px-2.5 py-1.5 ${active ? "border-[#A98450] bg-[#FAF3E3]" : "border-[#F0EBE0]"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => onActivePlan(active ? null : plan.id)} aria-pressed={active} title="Set as active plan - new mappings attach here" className="min-w-0 flex-1 cursor-pointer text-left">
                  <span className="block truncate text-[12px] font-semibold text-[#27241F]">{plan.name}</span>
                  <span className="block font-mono text-[10px] text-[#A39B8E]">
                    {plan.objectName} · {plan.intent} · {plan.cardinality}
                    {plan.sourcePath ? ` · ${plan.sourcePath}` : ""} · {count} mappings · {planStatus(plan)}
                  </span>
                </button>
                <button type="button" onClick={() => onRemovePlan(plan.id)} aria-label={`Remove plan ${plan.name}`} title="Mappings keep their object but detach from this plan" className="rounded px-1.5 text-[11px] text-[#B3261E] hover:bg-[#F9E8E6] cursor-pointer">
                  remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Relationships */}
      {project.recordPlans.length >= 2 && (
        <div className="mt-3 border-t border-[#F0EBE0] pt-2">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
            Relationships · {project.relationships.length}
          </p>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <select value={relChild} onChange={(e) => setRelChild(e.target.value)} aria-label="Child plan" className={`${inputCls} cursor-pointer`}>
              <option value="">child…</option>
              {project.recordPlans.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select value={relParent} onChange={(e) => setRelParent(e.target.value)} aria-label="Parent plan" className={`${inputCls} cursor-pointer`}>
              <option value="">parent…</option>
              {project.recordPlans.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input value={relField} onChange={(e) => setRelField(e.target.value)} placeholder="Relationship field API name" aria-label="Relationship field" className={`${inputCls} font-mono`} />
            <Button
              size="sm"
              variant="ghost"
              disabled={!relChild || !relParent || relChild === relParent || !relField.trim()}
              onClick={() => {
                onAddRelationship({ id: uid("rel"), childPlanId: relChild, parentPlanId: relParent, fieldName: relField.trim(), strategy: "unresolved", confirmed: false });
                setRelChild("");
                setRelParent("");
                setRelField("");
              }}
            >
              Link
            </Button>
          </div>
          <ul className="space-y-1">
            {project.relationships.map((r) => {
              const child = project.recordPlans.find((p) => p.id === r.childPlanId)?.name ?? "?";
              const parent = project.recordPlans.find((p) => p.id === r.parentPlanId)?.name ?? "?";
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#F0EBE0] px-2 py-1 text-[11px]">
                  <span className="font-mono text-[#27241F]">
                    {child} → {parent} via {r.fieldName}
                  </span>
                  <StrategySelect
                    value={r.strategy}
                    onChange={(strategy) => onAddRelationship({ ...r, strategy })}
                  />
                  <button
                    type="button"
                    onClick={() => onToggleConfirm(r.id)}
                    aria-pressed={r.confirmed}
                    className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold cursor-pointer ${r.confirmed ? "border-[#BFD9C6] bg-[#E9F3EC] text-[#2F7D4F]" : "border-[#E0C491] bg-[#F3EADB] text-[#9A5B13]"}`}
                  >
                    {r.confirmed ? "confirmed" : "unresolved"}
                  </button>
                  <button type="button" onClick={() => onRemoveRelationship(r.id)} aria-label="Remove relationship" className="ml-auto rounded px-1 text-[#B3261E] hover:bg-[#F9E8E6] cursor-pointer">
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function StrategySelect({ value, onChange }: { value: RelationshipDef["strategy"]; onChange: (s: RelationshipDef["strategy"]) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as RelationshipDef["strategy"])}
      aria-label="How the relationship is resolved"
      className="cursor-pointer rounded-md border border-[#E8E2D8] bg-white px-1 py-0.5 font-mono text-[10px]"
    >
      <option value="unresolved">unresolved</option>
      <option value="parent-id">parent ID from earlier create</option>
      <option value="external-id">external ID lookup</option>
      <option value="lookup">existing record lookup</option>
      <option value="other">other (see notes)</option>
    </select>
  );
}
