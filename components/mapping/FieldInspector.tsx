"use client";

import { CopyButton } from "@/components/ui/CopyButton";
import type { SnapshotField } from "@/lib/mapping/types";

function Prop({ label, value, tip }: { label: string; value: string; tip?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5" title={tip}>
      <dt className="text-[11px] text-[#A39B8E]">{label}</dt>
      <dd className="font-mono text-[11px] text-[#27241F] text-right break-all">{value}</dd>
    </div>
  );
}

/** Full metadata property panel for the picked field. */
export function FieldInspector({ objectName, field }: { objectName: string | null; field: SnapshotField | null }) {
  if (!field || !objectName) {
    return <p className="text-[12px] text-[#A39B8E]">Pick a field to inspect its metadata.</p>;
  }
  const bool = (v: boolean) => (v ? "yes" : "no");
  return (
    <div>
      <p className="font-mono text-[12px] font-semibold text-[#27241F] break-all">
        {objectName}.{field.name}
      </p>
      <p className="text-[11px] text-[#777168]">{field.label}</p>
      <dl className="mt-2 divide-y divide-[#F0EBE0] border-t border-b border-[#F0EBE0]">
        <Prop label="Type" value={field.type} />
        {field.length > 0 && <Prop label="Length" value={String(field.length)} tip="Maximum characters for string fields." />}
        {field.precision > 0 && <Prop label="Precision / scale" value={`${field.precision} / ${field.scale}`} />}
        <Prop label="Nillable" value={bool(field.nillable)} tip="No = the field may not accept null." />
        <Prop label="Createable" value={bool(field.createable)} />
        <Prop label="Updateable" value={bool(field.updateable)} />
        <Prop label="Defaulted on create" value={bool(field.defaultedOnCreate)} />
        <Prop label="Calculated" value={bool(field.calculated)} />
        <Prop label="Unique" value={bool(field.unique)} />
        <Prop label="External ID" value={bool(field.externalId)} />
        {field.referenceTo.length > 0 && <Prop label="Reference to" value={field.referenceTo.join(", ")} />}
        {field.relationshipName && <Prop label="Relationship" value={field.relationshipName} />}
        {field.restrictedPicklist && <Prop label="Restricted picklist" value="yes" />}
        {field.defaultValue !== null && field.defaultValue !== undefined && (
          <Prop label="Default" value={String(field.defaultValue)} />
        )}
      </dl>
      {field.picklistValues.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
            Picklist · {field.picklistValues.filter((p) => p.active).length} active
          </p>
          <ul className="max-h-[160px] space-y-px overflow-y-auto">
            {field.picklistValues.map((p) => (
              <li
                key={p.value}
                className={`flex items-center gap-2 rounded px-1.5 py-0.5 font-mono text-[11px] ${p.active ? "text-[#27241F]" : "text-[#C9C2B4] line-through"}`}
                title={p.active ? "Active value" : "Inactive value"}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${p.active ? "bg-[#2F7D4F]" : "bg-[#D8CFC0]"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="block truncate">{p.label}</span>
                  <span className="block truncate font-mono text-[10px] text-[#A39B8E]" title={`API name: ${p.value}`}>
                    {p.value}
                  </span>
                </span>
                <CopyButton text={p.value} label="API name" className="text-[#A39B8E] hover:bg-[#F0EBE0] hover:text-[#27241F]" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
