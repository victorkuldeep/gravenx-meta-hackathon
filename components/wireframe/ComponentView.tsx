"use client";

import type { ReactNode } from "react";
import { defFor } from "@/lib/wireframe/registry";
import type { WireComponent } from "@/lib/wireframe/model";
import { WireIcon } from "./WireIcon";

const DOT: Record<string, string> = {
  existing: "bg-[#32815B]",
  proposed: "bg-[#C9A86A]",
  external: "bg-[#5B7FA6]",
};

function FieldBox({ text, tall }: { text?: string; tall?: boolean }) {
  return (
    <div className={`rounded-md border border-[#D8CFBB] bg-white px-2 py-1.5 text-[11px] text-[#A39B8E] ${tall ? "min-h-12" : ""}`}>
      {text ?? ""}
    </div>
  );
}

function FieldLabel({ comp }: { comp: WireComponent }) {
  if (!comp.label) return null;
  return (
    <p className="mb-1 text-[11px] font-medium text-[#27241F]">
      {comp.label}
      {comp.validation?.required && <span className="ml-0.5 text-[#B04A3A]">*</span>}
    </p>
  );
}

export function BindingBadge({ comp }: { comp: WireComponent }) {
  if (!comp.binding && !comp.bindingState) return null;
  const state = comp.bindingState ?? "existing";
  const text = comp.binding?.field
    ? `${comp.binding.object ?? ""}.${comp.binding.field}`
    : (comp.binding?.object ?? comp.binding?.externalLabel ?? (state === "proposed" ? "Proposed field" : "External"));
  return (
    <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded bg-[#F5F1E8] px-1.5 py-px font-mono text-[9px] text-[#777168]" title={text}>
      <span className={`h-1 w-1 shrink-0 rounded-full ${DOT[state]}`} />
      <span className="truncate">{state === "existing" ? "✓ " : state === "proposed" ? "+ " : "⇅ "}{text}</span>
    </span>
  );
}

function ContainerShell({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-[#D8CFBB] bg-[#FBF8F1] p-2">
      {title ? <p className="mb-1.5 text-[11px] font-semibold text-[#27241F]">{title}</p> : null}
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function MiniRows({ rows, cols }: { rows: number; cols?: string[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-[#E3D9C6]">
      {cols && (
        <div className="flex gap-1 border-b border-[#E3D9C6] bg-[#F5F1E8] px-2 py-1">
          {cols.map((c) => (
            <span key={c} className="flex-1 truncate text-[10px] font-semibold text-[#777168]">{c}</span>
          ))}
        </div>
      )}
      {Array.from({ length: Math.min(Math.max(rows, 1), 5) }).map((_, i) => (
        <div key={i} className="flex gap-1 border-b border-[#F5F1E8] px-2 py-1.5 last:border-0">
          <span className="h-2 flex-1 rounded bg-[#EDE7D8]" />
          <span className="h-2 w-10 rounded bg-[#EDE7D8]" />
        </div>
      ))}
    </div>
  );
}

/**
 * Low-fi renderer for one wireframe component. Containers render their
 * slotted children; leaves render schematic previews. Visual only - the
 * model in lib/wireframe/model.ts stays the source of truth.
 */
export function ComponentView({
  comp,
  children,
  selected,
  onSelect,
  onDelete,
}: {
  comp: WireComponent;
  children?: ReactNode;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const props = comp.props as Record<string, unknown>;

  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const num = (v: unknown, fb: number): number => (typeof v === "number" ? v : fb);

  let body: ReactNode = null;
  switch (comp.kind) {
    case "text":
      body = <p className="text-[11px] leading-relaxed text-[#57534A]">{comp.label || "Body copy"}</p>;
      break;
    case "heading":
      body = <p className="text-[15px] font-bold text-[#27241F]">{comp.label || "Section title"}</p>;
      break;
    case "label":
      body = <p className="font-mono text-[10px] uppercase tracking-wide text-[#777168]">{comp.label || "Label"}</p>;
      break;
    case "divider":
      body = <hr className="border-[#E3D9C6]" />;
      break;
    case "spacer":
      body = <div style={{ height: num(props.height, 16) }} />;
      break;
    case "input":
    case "number":
    case "currency":
    case "date":
    case "datetime":
    case "file":
    case "sffield":
    case "sflookup":
      body = (
        <div>
          <FieldLabel comp={comp} />
          <FieldBox text={comp.kind === "currency" ? "$" : comp.kind === "sflookup" ? "⌕ Search…" : undefined} />
          <BindingBadge comp={comp} />
        </div>
      );
      break;
    case "textarea":
      body = (
        <div>
          <FieldLabel comp={comp} />
          <FieldBox tall />
          <BindingBadge comp={comp} />
        </div>
      );
      break;
    case "select":
    case "multiselect":
    case "sfpicklist":
      body = (
        <div>
          <FieldLabel comp={comp} />
          <div className="flex items-center justify-between rounded-md border border-[#D8CFBB] bg-white px-2 py-1.5 text-[11px] text-[#A39B8E]">
            <span className="truncate">{list(props.options)[0] ?? "Select…"}</span>
            <span aria-hidden="true">▾</span>
          </div>
          <BindingBadge comp={comp} />
        </div>
      );
      break;
    case "checkbox":
    case "radio":
    case "toggle":
      body = (
        <div className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`inline-block h-3.5 w-3.5 shrink-0 border border-[#9A7653] bg-white ${comp.kind === "radio" ? "rounded-full" : comp.kind === "toggle" ? "w-7 rounded-full" : "rounded"}`} />
          <span className="truncate text-[11px] text-[#27241F]">{comp.label}</span>
        </div>
      );
      break;
    case "button":
      body = (
        <span className="inline-block rounded-lg bg-[#27241F] px-4 py-1.5 text-[11px] font-semibold text-white">
          {comp.label || "Button"}
        </span>
      );
      break;
    case "buttongroup": {
      const btns = list(props.buttons);
      body = (
        <div className="flex gap-1">
          {(btns.length > 0 ? btns : ["Save", "Cancel"]).map((b, i) => (
            <span key={i} className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold ${i === 0 ? "bg-[#27241F] text-white" : "border border-[#D8CFBB] text-[#57534A]"}`}>
              {b}
            </span>
          ))}
        </div>
      );
      break;
    }
    case "iconbutton":
      body = <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#D8CFBB] text-[12px] text-[#777168]">○</span>;
      break;
    case "icon": {
      const name = typeof props.icon === "string" ? props.icon : "star";
      const size = typeof props.size === "number" && props.size >= 12 && props.size <= 96 ? props.size : 28;
      body = (
        <span className="inline-flex items-center gap-1.5" title={name}>
          <WireIcon name={name} size={size} />
          {comp.label ? <span className="text-[11px] text-[#57534A]">{comp.label}</span> : null}
        </span>
      );
      break;
    }
    case "link":
      body = <span className="text-[11px] font-medium text-[#8A6A2F] underline">{comp.label || "Learn more"}</span>;
      break;
    case "header":
    case "recordheader":
    case "sfrecordheader":
      body = (
        <div className="flex items-center gap-2 rounded-lg bg-[#27241F] px-2.5 py-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#C9A86A] text-[10px] font-bold text-[#27241F]">
            {(comp.label || "R").slice(0, 1)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold text-white">{comp.label || "Record"}</p>
            <BindingBadge comp={comp} />
          </div>
        </div>
      );
      break;
    case "table":
    case "sfdatatable":
      body = (
        <div>
          {comp.label ? <p className="mb-1 text-[11px] font-semibold text-[#27241F]">{comp.label}</p> : null}
          <MiniRows rows={num(props.rows, 3)} cols={list(props.columns)} />
          <BindingBadge comp={comp} />
        </div>
      );
      break;
    case "list":
      body = (
        <div>
          {comp.label ? <p className="mb-1 text-[11px] font-semibold text-[#27241F]">{comp.label}</p> : null}
          <MiniRows rows={num(props.rows, 3)} />
        </div>
      );
      break;
    case "sfrelatedlist":
      body = (
        <div>
          {comp.label ? <p className="mb-1 text-[11px] font-semibold text-[#27241F]">{comp.label}</p> : null}
          <MiniRows rows={2} />
          <p className="mt-1 text-right text-[10px] font-medium text-[#8A6A2F]">View All</p>
          <BindingBadge comp={comp} />
        </div>
      );
      break;
    case "search":
    case "sfrecordsearch":
      body = (
        <div className="rounded-md border border-[#D8CFBB] bg-white px-2 py-1.5 text-[11px] text-[#A39B8E]">
          ⌕ {comp.label || "Search…"}
        </div>
      );
      break;
    case "filter":
      body = (
        <div className="flex gap-1">
          {["All", "Mine", "Recent"].map((f) => (
            <span key={f} className="rounded-full border border-[#D8CFBB] px-2 py-0.5 text-[10px] text-[#777168]">{f}</span>
          ))}
        </div>
      );
      break;
    case "pagination":
      body = <p className="text-center font-mono text-[11px] text-[#777168]">‹ 1 2 3 ›</p>;
      break;
    case "emptystate":
    case "loadingstate":
    case "errorstate":
      body = (
        <div className="rounded-lg border border-dashed border-[#D8CFBB] bg-[#FBF8F1] px-2 py-3 text-center text-[11px] text-[#A39B8E]">
          {comp.label || defFor(comp.kind).defaultLabel}
        </div>
      );
      break;
    case "container":
    case "card":
    case "panel":
    case "accordion":
    case "form":
    case "sfrecordform":
    case "modal":
    case "drawer":
    case "sidebar":
    case "tabs":
      body = <ContainerShell title={comp.label || undefined}>{children}</ContainerShell>;
      break;
    default:
      body = <p className="font-mono text-[10px] text-[#A39B8E]">{comp.kind}</p>;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${defFor(comp.kind).label}${comp.label ? `: ${comp.label}` : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect();
      }}
      className={`group/cmp relative rounded-md transition-shadow ${selected ? "shadow-[0_0_0_2px_#9A7653]" : "hover:shadow-[0_0_0_1px_#D8CFBB]"}`}
    >
      {body}
      {selected && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete component"
          aria-label="Delete component"
          className="absolute -right-1.5 -top-1.5 rounded-full border border-[#E3D9C6] bg-white p-0.5 text-[#A39B8E] cursor-pointer hover:text-red-700"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}
