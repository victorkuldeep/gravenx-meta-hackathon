"use client";

import { useEffect, useMemo, useState } from "react";
import type { SalesforceField } from "@/lib/salesforce/types";
import { paletteFields } from "@/lib/wireframe/schema";
import type { WireSchema } from "./useWireSchema";

/**
 * Salesforce schema palette (EPIC 05): pick an object, add its fields as
 * live-bound components to the selected screen - or bind a field onto the
 * component open in the Inspector. Silent when disconnected.
 */
export function SchemaPanel({
  schema,
  selectedScreenId,
  inspectedId,
  onAddField,
  onBindField,
}: {
  schema: WireSchema;
  selectedScreenId: string | null;
  inspectedId: string | null;
  onAddField: (field: SalesforceField, objectName: string) => void;
  onBindField: (componentId: string, field: SalesforceField, objectName: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [objectName, setObjectName] = useState<string | null>(null);
  const [fieldQuery, setFieldQuery] = useState("");

  const objects = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? schema.objects.filter((o) => o.name.toLowerCase().includes(q) || o.label.toLowerCase().includes(q))
      : schema.objects;
    return list.slice(0, 100);
  }, [schema.objects, query]);

  useEffect(() => {
    if (objectName) void schema.loadDescribe(objectName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectName]);

  const describe = objectName ? schema.describes.get(objectName) : undefined;
  const fields = useMemo(() => {
    const all = paletteFields(describe);
    const q = fieldQuery.trim().toLowerCase();
    return (q ? all.filter((f) => f.name.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)) : all).slice(0, 150);
  }, [describe, fieldQuery]);

  if (!schema.connected) return null;

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden rounded-xl border border-[#E8E2D8] bg-white" style={{ maxHeight: 640 }} aria-label="Salesforce schema">
      <div className="border-b border-[#EFE9DC] px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-[1px] text-[#27241F]">Salesforce schema</p>
        {schema.loading && <p className="font-mono text-[10px] text-[#A39B8E]">Loading objects…</p>}
        {schema.error && <p className="text-[11px] text-red-700">{schema.error}</p>}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search objects…"
          aria-label="Search objects"
          spellCheck={false}
          className="mt-1.5 w-full rounded-lg border border-[#E8E2D8] px-2 py-1.5 text-xs text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!objectName ? (
          <ul className="p-1.5">
            {objects.map((o) => (
              <li key={o.name}>
                <button
                  type="button"
                  onClick={() => setObjectName(o.name)}
                  className="w-full cursor-pointer truncate rounded-lg px-2 py-1.5 text-left text-xs text-[#27241F] transition-colors hover:bg-[#F5F1E8]"
                >
                  {o.label}
                  <span className="ml-1 font-mono text-[9px] text-[#A39B8E]">{o.name}</span>
                  {o.custom && <span className="ml-1 font-mono text-[9px] text-[#9A7653]">custom</span>}
                </button>
              </li>
            ))}
            {objects.length === 0 && !schema.loading && (
              <li className="px-2 py-3 text-center text-[11px] text-[#A39B8E]">No objects match.</li>
            )}
          </ul>
        ) : (
          <div className="p-1.5">
            <button
              type="button"
              onClick={() => { setObjectName(null); setFieldQuery(""); }}
              className="mb-1 w-full cursor-pointer truncate rounded-lg px-2 py-1.5 text-left font-mono text-[10px] text-[#9A7653] hover:bg-[#F5F1E8]"
            >
              ← {describe?.label ?? objectName}
            </button>
            <input
              value={fieldQuery}
              onChange={(e) => setFieldQuery(e.target.value)}
              placeholder="Search fields…"
              aria-label="Search fields"
              spellCheck={false}
              className="mb-1 w-full rounded-lg border border-[#E8E2D8] px-2 py-1.5 text-xs text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none"
            />
            <ul>
              {fields.map((f) => (
                <li key={f.name} className="group flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs text-[#27241F]" title={`${f.label} · ${f.type}`}>
                    {f.label}
                    <span className="ml-1 font-mono text-[9px] text-[#A39B8E]">{f.type}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onAddField(f, objectName)}
                    disabled={!selectedScreenId}
                    title={selectedScreenId ? `Add ${f.label} to the selected screen` : "Select a screen first"}
                    className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] text-[#9A7653] cursor-pointer hover:bg-[#F5F1E8] disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    + Add
                  </button>
                  {inspectedId && (
                    <button
                      type="button"
                      onClick={() => onBindField(inspectedId, f, objectName)}
                      title={`Bind ${f.label} to the inspected component`}
                      className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] text-[#32815B] cursor-pointer hover:bg-[#F5F1E8]"
                    >
                      Bind
                    </button>
                  )}
                </li>
              ))}
              {fields.length === 0 && (
                <li className="px-2 py-3 text-center text-[11px] text-[#A39B8E]">
                  {describe ? "No fields match." : "Loading fields…"}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
