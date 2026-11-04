"use client";

import { useState } from "react";
import Button from "../ui/Button";
import { BindingEditor } from "./BindingEditor";
import { logChange } from "@/lib/experience/migrate";
import type { StudioProject } from "@/lib/studio/types";
import type {
  ActionTrigger,
  ComponentType,
  ExperienceStatus,
  RequirementDirection,
  RequirementSource,
  UIAction,
  UIComponent,
  UIDataRequirement,
  UIStateDefinition,
  UIStateKind,
} from "@/lib/experience/types";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const inputCls =
  "w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none";

type Tab = "overview" | "requirements" | "actions" | "states" | "bindings";

/**
 * Component inspector: overview, data requirements, actions, states.
 * API bindings tab lists current bindings; editing arrives in Sprint 5.
 */
export function ComponentInspector({
  project,
  component,
  annotationLabel,
  onMutate,
}: {
  project: StudioProject;
  component: UIComponent;
  annotationLabel?: string;
  onMutate: (fn: (p: StudioProject) => StudioProject) => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const exp = project.experience!;

  const patch = (patch: Partial<UIComponent>, summary: string) => {
    onMutate((p) => {
      if (!p.experience) return p;
      const now = new Date().toISOString();
      const next = {
        ...p,
        experience: {
          ...p.experience,
          components: p.experience.components.map((c) => (c.id === component.id ? { ...c, ...patch, updatedAt: now } : c)),
          updatedAt: now,
        },
        updatedAt: now,
      };
      logChange(next, "component", component.id, "updated", summary, now);
      return next;
    });
  };

  const requirements = exp.requirements.filter((r) => r.componentId === component.id);
  const actions = exp.actions.filter((a) => a.componentId === component.id);
  const states = exp.states.filter((s) => s.componentId === component.id);
  const bindings = exp.bindings.filter((b) => b.componentId === component.id);

  return (
    <div className="mt-3 rounded-xl border border-[#A98450] bg-[#FFFEFB] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-[13px] font-semibold text-[#27241F]">{component.name}</p>
        {annotationLabel && <span className="font-mono text-[10px] text-[#A39B8E]">region: {annotationLabel}</span>}
        <StatusSelect value={component.status} onChange={(s) => patch({ status: s }, `Component "${component.name}" → ${s}.`)} />
      </div>

      <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Component sections">
        {(
          [
            ["overview", `Overview`],
            ["requirements", `Requirements · ${requirements.length}`],
            ["actions", `Actions · ${actions.length}`],
            ["states", `States · ${states.length}`],
            ["bindings", `APIs · ${bindings.length}`],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold cursor-pointer ${tab === id ? "border-[#211F1B] bg-[#211F1B] text-white" : "border-[#E8E2D8] bg-white text-[#777168] hover:text-[#27241F]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-[11px] text-[#777168]">
            Name
            <input defaultValue={component.name} onBlur={(e) => e.target.value.trim() && patch({ name: e.target.value.trim() }, "Component renamed.")} className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-[11px] text-[#777168]">
            Type
            <select value={component.componentType} onChange={(e) => patch({ componentType: e.target.value as ComponentType }, "Component type changed.")} className={`${inputCls} mt-1 cursor-pointer`}>
              {(["container", "text", "input", "button", "table", "list", "card", "form", "modal", "navigation", "custom"] as ComponentType[]).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] text-[#777168] sm:col-span-2">
            Purpose
            <input defaultValue={component.purpose ?? ""} onBlur={(e) => patch({ purpose: e.target.value || undefined }, "Component purpose updated.")} placeholder="What is this region for?" className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-[11px] text-[#777168] sm:col-span-2">
            Description
            <input defaultValue={component.description ?? ""} onBlur={(e) => patch({ description: e.target.value || undefined }, "Component description updated.")} placeholder="UI requirements, validation rules…" className={`${inputCls} mt-1`} />
          </label>
        </div>
      )}

      {tab === "requirements" && (
        <RequirementEditor component={component} requirements={requirements} onMutate={onMutate} />
      )}
      {tab === "actions" && (
        <ActionEditor component={component} actions={actions} onMutate={onMutate} />
      )}
      {tab === "states" && (
        <StateEditor component={component} states={states} onMutate={onMutate} />
      )}
      {tab === "bindings" && (
        <BindingEditor project={project} component={component} bindings={bindings} onMutate={onMutate} />
      )}
    </div>
  );
}

export function StatusSelect({ value, onChange }: { value: ExperienceStatus; onChange: (s: ExperienceStatus) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as ExperienceStatus)} aria-label="Status" className="cursor-pointer rounded-md border border-[#E8E2D8] bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold">
      {(["draft", "proposed", "confirmed", "changed", "blocked", "open"] as ExperienceStatus[]).map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  );
}

function RequirementEditor({
  component,
  requirements,
  onMutate,
}: {
  component: UIComponent;
  requirements: UIDataRequirement[];
  onMutate: (fn: (p: StudioProject) => StudioProject) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [direction, setDirection] = useState<RequirementDirection>("response");
  const [required, setRequired] = useState(true);

  const add = () => {
    if (!name.trim()) return;
    const now = new Date().toISOString();
    const req: UIDataRequirement = {
      id: uid("req"),
      screenId: component.screenId,
      componentId: component.id,
      name: name.trim(),
      propertyPath: path.trim() || undefined, // proposed until a contract approves it
      direction,
      required,
      source: "design",
      status: "proposed",
    };
    onMutate((p) => {
      if (!p.experience) return p;
      const next = { ...p, experience: { ...p.experience, requirements: [...p.experience.requirements, req], updatedAt: now }, updatedAt: now };
      logChange(next, "requirement", req.id, "created", `Requirement "${req.name}" proposed on ${component.name}.`, now);
      return next;
    });
    setName("");
    setPath("");
    setOpen(false);
  };

  const setStatus = (id: string, status: ExperienceStatus) => {
    onMutate((p) => {
      if (!p.experience) return p;
      const now = new Date().toISOString();
      return { ...p, experience: { ...p.experience, requirements: p.experience.requirements.map((r) => (r.id === id ? { ...r, status } : r)), updatedAt: now }, updatedAt: now };
    });
  };

  const remove = (id: string) => {
    onMutate((p) => {
      if (!p.experience) return p;
      return { ...p, experience: { ...p.experience, requirements: p.experience.requirements.filter((r) => r.id !== id) } };
    });
  };

  return (
    <div>
      <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
        {open ? "Cancel" : "+ Requirement"}
      </Button>
      {open && (
        <div className="mt-2 grid gap-2 rounded-lg border border-[#F0EBE0] bg-[#FAF8F2] p-2.5 sm:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display label (e.g. Order number)" aria-label="Requirement label" className={inputCls} />
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="Property path (e.g. orderNumber)" aria-label="Property path" spellCheck={false} className={`${inputCls} font-mono`} />
          <select value={direction} onChange={(e) => setDirection(e.target.value as RequirementDirection)} aria-label="Direction" className={`${inputCls} cursor-pointer`}>
            <option value="response">response</option>
            <option value="request">request</option>
            <option value="both">both</option>
            <option value="local-only">local-only</option>
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[#777168]">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="accent-[#A98450]" />
            Required
          </label>
          <span className="sm:col-span-2 flex justify-end">
            <Button size="sm" disabled={!name.trim()} onClick={add}>
              Propose requirement
            </Button>
          </span>
        </div>
      )}
      <ul className="mt-2 space-y-1">
        {requirements.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#F0EBE0] px-2 py-1.5 text-[12px]">
            <span className="min-w-0 flex-1">
              <span className="font-semibold text-[#27241F]">{r.name}</span>{" "}
              <span className="font-mono text-[11px] text-[#A98450]">{r.propertyPath ?? "(no path)"}</span>{" "}
              <span className="font-mono text-[10px] text-[#A39B8E]">{r.direction}{r.required ? " · required" : ""}</span>
            </span>
            <StatusSelect value={r.status} onChange={(s) => setStatus(r.id, s)} />
            <button type="button" onClick={() => remove(r.id)} aria-label={`Remove requirement ${r.name}`} className="rounded px-1 text-[#B3261E] hover:bg-[#F9E8E6] cursor-pointer">
              ✕
            </button>
          </li>
        ))}
        {requirements.length === 0 && <li className="text-[12px] text-[#A39B8E]">No requirements - propose what this component displays or submits.</li>}
      </ul>
    </div>
  );
}

function ActionEditor({
  component,
  actions,
  onMutate,
}: {
  component: UIComponent;
  actions: UIAction[];
  onMutate: (fn: (p: StudioProject) => StudioProject) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<ActionTrigger>("click");

  const add = () => {
    if (!name.trim()) return;
    const now = new Date().toISOString();
    const action: UIAction = {
      id: uid("act"), screenId: component.screenId, componentId: component.id,
      name: name.trim(), trigger, bindingIds: [], status: "proposed", createdAt: now, updatedAt: now,
    };
    onMutate((p) => {
      if (!p.experience) return p;
      const next = { ...p, experience: { ...p.experience, actions: [...p.experience.actions, action], updatedAt: now }, updatedAt: now };
      logChange(next, "action", action.id, "created", `Action "${action.name}" proposed on ${component.name}.`, now);
      return next;
    });
    setName("");
    setOpen(false);
  };

  return (
    <div>
      <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
        {open ? "Cancel" : "+ Action"}
      </Button>
      {open && (
        <div className="mt-2 flex flex-wrap gap-2 rounded-lg border border-[#F0EBE0] bg-[#FAF8F2] p-2.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Action name (e.g. Submit Order)" aria-label="Action name" className={`${inputCls} min-w-[180px] flex-1`} />
          <select value={trigger} onChange={(e) => setTrigger(e.target.value as ActionTrigger)} aria-label="Trigger" className={`${inputCls} cursor-pointer`}>
            {(["page-load", "click", "submit", "change", "selection", "navigation", "timer", "other"] as ActionTrigger[]).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <Button size="sm" disabled={!name.trim()} onClick={add}>
            Add
          </Button>
        </div>
      )}
      <ul className="mt-2 space-y-1">
        {actions.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#F0EBE0] px-2 py-1.5 text-[12px]">
            <span className="flex-1">
              <span className="font-semibold text-[#27241F]">{a.name}</span>{" "}
              <span className="font-mono text-[10px] text-[#A39B8E]">{a.trigger} · {a.bindingIds.length} bindings · {a.status}</span>
            </span>
            <button
              type="button"
              onClick={() => onMutate((p) => (!p.experience ? p : { ...p, experience: { ...p.experience, actions: p.experience.actions.filter((x) => x.id !== a.id) } }))}
              aria-label={`Remove action ${a.name}`}
              className="rounded px-1 text-[11px] text-[#B3261E] hover:bg-[#F9E8E6] cursor-pointer"
            >
              ✕
            </button>
          </li>
        ))}
        {actions.length === 0 && <li className="text-[12px] text-[#A39B8E]">No actions - what can the user do here?</li>}
      </ul>
    </div>
  );
}

const STATE_KINDS: UIStateKind[] = ["loading", "success", "empty", "validation-error", "authorization-error", "not-found", "server-error", "timeout", "partial", "disabled", "custom"];

function StateEditor({
  component,
  states,
  onMutate,
}: {
  component: UIComponent;
  states: UIStateDefinition[];
  onMutate: (fn: (p: StudioProject) => StudioProject) => void;
}) {
  const [kind, setKind] = useState<UIStateKind>("loading");
  const [behavior, setBehavior] = useState("");

  const add = () => {
    const now = new Date().toISOString();
    const st: UIStateDefinition = {
      id: uid("state"), screenId: component.screenId, componentId: component.id,
      name: kind, kind, expectedBehavior: behavior.trim() || undefined, status: "proposed",
    };
    onMutate((p) => {
      if (!p.experience) return p;
      return { ...p, experience: { ...p.experience, states: [...p.experience.states, st], updatedAt: now }, updatedAt: now };
    });
    setBehavior("");
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as UIStateKind)} aria-label="State kind" className={`${inputCls} cursor-pointer min-w-[160px] flex-1`}>
          {STATE_KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <input value={behavior} onChange={(e) => setBehavior(e.target.value)} placeholder="Expected behavior (optional)" aria-label="Expected behavior" className={`${inputCls} min-w-[180px] flex-[2]`} />
        <Button
          size="sm"
          disabled={states.some((s) => s.kind === kind)}
          title={states.some((s) => s.kind === kind) ? "This state is already defined" : "Add state"}
          onClick={add}
        >
          Add
        </Button>
      </div>
      <ul className="mt-2 space-y-1">
        {states.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#F0EBE0] px-2 py-1.5 text-[12px]">
            <span className="flex-1">
              <span className="font-mono font-semibold text-[#27241F]">{s.kind}</span>{" "}
              <span className="text-[11px] text-[#777168]">{s.expectedBehavior ?? "no behavior recorded"} · {s.status}</span>
            </span>
            <button
              type="button"
              onClick={() => onMutate((p) => (!p.experience ? p : { ...p, experience: { ...p.experience, states: p.experience.states.filter((x) => x.id !== s.id) } }))}
              aria-label={`Remove state ${s.kind}`}
              className="rounded px-1 text-[#B3261E] hover:bg-[#F9E8E6] cursor-pointer"
            >
              ✕
            </button>
          </li>
        ))}
        {states.length === 0 && <li className="text-[12px] text-[#A39B8E]">No states - define loading, empty, error and success behavior.</li>}
      </ul>
    </div>
  );
}

export type { RequirementSource };
