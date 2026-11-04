"use client";

import { useState } from "react";
import Button from "../ui/Button";
import { logChange } from "@/lib/experience/migrate";
import { normalizeOperationKey } from "@/lib/experience/apiCatalog";
import type { StudioProject } from "@/lib/studio/types";
import type {
  APIBinding,
  BindingTrigger,
  BindingUsage,
  HttpMethod,
  UIComponent,
} from "@/lib/experience/types";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const inputCls =
  "w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none";

/** Bind a component to shared catalog operations (existing or newly proposed). */
export function BindingEditor({
  project,
  component,
  bindings,
  onMutate,
}: {
  project: StudioProject;
  component: UIComponent;
  bindings: APIBinding[];
  onMutate: (fn: (p: StudioProject) => StudioProject) => void;
}) {
  const catalog = project.apiCatalog!;
  const requirements = project.experience!.requirements.filter((r) => r.componentId === component.id);
  const states = project.experience!.states.filter((s) => s.componentId === component.id);
  const [open, setOpen] = useState(false);
  const [opQuery, setOpQuery] = useState("");
  const [pickedOp, setPickedOp] = useState("");
  const [newName, setNewName] = useState("");
  const [newMethod, setNewMethod] = useState<HttpMethod>("GET");
  const [newPath, setNewPath] = useState("");
  const [usage, setUsage] = useState<BindingUsage>("read");
  const [trigger, setTrigger] = useState<BindingTrigger>("user-action");
  const [reqIds, setReqIds] = useState<string[]>([]);
  const [resIds, setResIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const opMatches = catalog.operations.filter((o) => {
    const q = opQuery.trim().toLowerCase();
    return !q || o.name.toLowerCase().includes(q) || o.path.toLowerCase().includes(q);
  }).slice(0, 30);

  const toggle = (list: string[], id: string, set: (v: string[]) => void) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const save = () => {
    const now = new Date().toISOString();
    let operationId = pickedOp;
    let createdOpName: string | null = null;
    onMutate((p) => {
      if (!p.experience || !p.apiCatalog) return p;
      let ops = p.apiCatalog.operations;
      if (!operationId) {
        // Propose a new shared operation - architect confirms it in the catalog.
        operationId = uid("op");
        createdOpName = newName.trim();
        ops = [
          ...ops,
          {
            id: operationId,
            operationKey: normalizeOperationKey(newMethod, newPath),
            name: newName.trim(),
            method: newMethod,
            path: newPath.trim(),
            layer: "bff",
            errorContractIds: [],
            dependencyIds: [],
            lifecycle: "proposed" as const,
            status: "proposed" as const,
            tags: [],
            createdAt: now,
            updatedAt: now,
          },
        ];
      }
      const binding: APIBinding = {
        id: uid("bind"),
        screenId: component.screenId,
        componentId: component.id,
        operationId,
        usage,
        trigger,
        requestRequirementIds: reqIds,
        responseRequirementIds: resIds,
        stateIds: states.map((s) => s.id),
        notes: notes.trim() || undefined,
        status: "proposed",
        createdAt: now,
        updatedAt: now,
      };
      const next = {
        ...p,
        apiCatalog: { ...p.apiCatalog, operations: ops, updatedAt: now },
        experience: { ...p.experience, bindings: [...p.experience.bindings, binding], updatedAt: now },
        updatedAt: now,
      };
      logChange(next, "binding", binding.id, "created", `Binding proposed: ${component.name} → ${createdOpName ?? operationId}.`, now);
      return next;
    });
    setOpen(false);
    setPickedOp("");
    setNewName("");
    setNewPath("");
    setReqIds([]);
    setResIds([]);
    setNotes("");
  };

  const canSave = !!pickedOp || (!!newName.trim() && !!newPath.trim());

  const remove = (id: string) => {
    onMutate((p) => {
      if (!p.experience) return p;
      return { ...p, experience: { ...p.experience, bindings: p.experience.bindings.filter((b) => b.id !== id) } };
    });
  };

  const opName = (id: string) => catalog.operations.find((o) => o.id === id);

  return (
    <div>
      <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
        {open ? "Cancel" : "+ Bind API"}
      </Button>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-[#F0EBE0] bg-[#FAF8F2] p-2.5">
          <input
            value={opQuery}
            onChange={(e) => {
              setOpQuery(e.target.value);
              setPickedOp("");
            }}
            placeholder="Search catalog, or propose a new operation below…"
            aria-label="Search API operations"
            spellCheck={false}
            className={inputCls}
          />
          {opQuery && (
            <ul className="max-h-[140px] space-y-px overflow-y-auto rounded-lg border border-[#E8E2D8] bg-white p-1">
              {opMatches.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPickedOp(o.id);
                      setOpQuery(`${o.method} ${o.path}`);
                    }}
                    className={`w-full cursor-pointer rounded-md px-2 py-1 text-left font-mono text-[11px] ${pickedOp === o.id ? "bg-[#FAF3E3] outline outline-1 outline-[#A98450]" : "hover:bg-[#FAF8F2]"}`}
                  >
                    {o.method} {o.path} <span className="text-[#A39B8E]">· {o.name} · {o.layer}</span>
                  </button>
                </li>
              ))}
              {opMatches.length === 0 && <li className="px-2 py-1 text-[11px] text-[#A39B8E]">No match - propose it as new below.</li>}
            </ul>
          )}
          {!pickedOp && (
            <div className="grid grid-cols-3 gap-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New operation name" aria-label="New operation name" className={`${inputCls} col-span-3`} />
              <select value={newMethod} onChange={(e) => setNewMethod(e.target.value as HttpMethod)} aria-label="Method" className={`${inputCls} cursor-pointer`}>
                {(["GET", "POST", "PUT", "PATCH", "DELETE", "OTHER"] as HttpMethod[]).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <input value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="/path" aria-label="Path" spellCheck={false} className={`${inputCls} col-span-2 font-mono`} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <select value={usage} onChange={(e) => setUsage(e.target.value as BindingUsage)} aria-label="Usage" className={`${inputCls} cursor-pointer`}>
              {(["read", "create", "update", "delete", "search", "submit", "other"] as BindingUsage[]).map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
            <select value={trigger} onChange={(e) => setTrigger(e.target.value as BindingTrigger)} aria-label="Trigger" className={`${inputCls} cursor-pointer`}>
              {(["screen-load", "component-load", "user-action", "background", "navigation", "other"] as BindingTrigger[]).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          {requirements.length > 0 && (
            <div className="text-[11px]">
              <p className="font-semibold text-[#27241F]">Request requirements</p>
              <div className="flex flex-wrap gap-1.5">
                {requirements.map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-center gap-1 rounded-md border border-[#E8E2D8] bg-white px-1.5 py-0.5">
                    <input type="checkbox" checked={reqIds.includes(r.id)} onChange={() => toggle(reqIds, r.id, setReqIds)} className="accent-[#A98450]" />
                    {r.name}
                  </label>
                ))}
              </div>
              <p className="mt-1 font-semibold text-[#27241F]">Response requirements</p>
              <div className="flex flex-wrap gap-1.5">
                {requirements.map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-center gap-1 rounded-md border border-[#E8E2D8] bg-white px-1.5 py-0.5">
                    <input type="checkbox" checked={resIds.includes(r.id)} onChange={() => toggle(resIds, r.id, setResIds)} className="accent-[#A98450]" />
                    {r.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" aria-label="Binding notes" className={inputCls} />
          <span className="flex justify-end">
            <Button size="sm" disabled={!canSave} onClick={save}>
              Propose binding
            </Button>
          </span>
        </div>
      )}
      <ul className="mt-2 space-y-1">
        {bindings.map((b) => {
          const op = opName(b.operationId);
          return (
            <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#F0EBE0] px-2 py-1.5 text-[12px]">
              <span className="min-w-0 flex-1 font-mono text-[11px] text-[#27241F]">
                {op ? `${op.method} ${op.path}` : b.operationId} · {b.usage} · {b.trigger} · {b.status}
              </span>
              <button type="button" onClick={() => remove(b.id)} aria-label="Remove binding" className="rounded px-1 text-[#B3261E] hover:bg-[#F9E8E6] cursor-pointer">
                ✕
              </button>
            </li>
          );
        })}
        {bindings.length === 0 && <li className="text-[12px] text-[#A39B8E]">No bindings - link what powers this component.</li>}
      </ul>
    </div>
  );
}
