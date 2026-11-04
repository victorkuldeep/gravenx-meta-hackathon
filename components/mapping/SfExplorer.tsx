"use client";

import { useMemo, useState } from "react";
import type { SalesforceDescribeResult, SalesforceObject } from "@/lib/salesforce/types";
import type { SnapshotField, SnapshotObject } from "@/lib/mapping/types";
import { rankByQuery } from "@/lib/mapping/rank";

/** Salesforce object + field explorer. Live session first, snapshot fallback. */
export function SfExplorer({
  connected,
  loading,
  objects,
  describes,
  snapshotObjects,
  onEnsureDescribe,
  onPickField,
  activeObject,
  activeField,
}: {
  connected: boolean;
  loading: boolean;
  objects: SalesforceObject[];
  describes: Map<string, SalesforceDescribeResult>;
  snapshotObjects: SnapshotObject[];
  onEnsureDescribe: (objectName: string) => void;
  onPickField: (objectName: string, field: SnapshotField) => void;
  activeObject: string | null;
  activeField: string | null;
}) {
  const [objQuery, setObjQuery] = useState("");
  const [fieldQuery, setFieldQuery] = useState("");
  const [selectedObject, setSelectedObject] = useState<string | null>(null);

  const objectList: { name: string; label: string; custom: boolean; live: boolean }[] = useMemo(() => {
    if (connected && objects.length > 0) {
      return objects.map((o) => ({ name: o.name, label: o.label, custom: o.custom, live: true }));
    }
    return snapshotObjects.map((o) => ({ name: o.name, label: o.label, custom: o.custom, live: false }));
  }, [connected, objects, snapshotObjects]);

  const filteredObjects = useMemo(() => {
    const q = objQuery.trim();
    if (!q) return objectList.slice(0, 200);
    // Relevance first: an exact "Order" hit outranks "AssessmentTaskOrder".
    return rankByQuery(objectList, q, 200);
  }, [objectList, objQuery]);

  const fields: SnapshotField[] = useMemo(() => {
    if (!selectedObject) return [];
    const live = describes.get(selectedObject);
    if (live) {
      return (live.fields ?? []).map((f) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        length: f.length,
        precision: f.precision,
        scale: f.scale,
        nillable: f.nillable,
        createable: f.createable,
        updateable: f.updateable,
        calculated: f.calculated,
        defaultedOnCreate: f.defaultedOnCreate,
        unique: f.unique,
        externalId: f.externalId,
        referenceTo: f.referenceTo ?? [],
        relationshipName: f.relationshipName,
        restrictedPicklist: f.restrictedPicklist,
        defaultValue: f.defaultValue ?? null,
        picklistValues: (f.picklistValues ?? []).map((p) => ({ value: p.value, label: p.label, active: p.active })),
      }));
    }
    return snapshotObjects.find((o) => o.name === selectedObject)?.fields ?? [];
  }, [selectedObject, describes, snapshotObjects]);

  const filteredFields = useMemo(() => {
    const q = fieldQuery.trim();
    if (!q) return fields;
    // Exact-name hits first; type text still matches as a fallback.
    const ranked = rankByQuery(fields, q, 500);
    if (ranked.length > 0) return ranked;
    const lq = q.toLowerCase();
    return fields.filter((f) => f.type.toLowerCase().includes(lq));
  }, [fields, fieldQuery]);

  const selectObject = (name: string) => {
    setSelectedObject(name);
    setFieldQuery("");
    onEnsureDescribe(name);
  };

  return (
    <div className="space-y-2">
      {!connected && (
        <p className="rounded-lg border border-[#DCC99A] bg-[#F5EEDF] px-2.5 py-2 text-[11px] leading-relaxed text-[#8A6A2F]">
          Not connected - browsing the project&apos;s saved metadata snapshot. Connect via Home to search live Salesforce schema.
        </p>
      )}
      <input
        value={objQuery}
        onChange={(e) => setObjQuery(e.target.value)}
        placeholder="Search objects (name or label)…"
        aria-label="Search Salesforce objects"
        spellCheck={false}
        className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none"
      />
      {loading && <p className="text-[11px] text-[#A39B8E]">Loading objects…</p>}
      <ul className="max-h-[180px] space-y-px overflow-y-auto">
        {filteredObjects.map((o) => (
          <li key={o.name}>
            <button
              type="button"
              onClick={() => selectObject(o.name)}
              aria-pressed={selectedObject === o.name}
              className={`flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left ${
                selectedObject === o.name ? "bg-[#FAF3E3] outline outline-1 outline-[#A98450]" : "hover:bg-[#FAF8F2]"
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#27241F]">
                {o.name}
                <span className="block truncate text-[10px] text-[#A39B8E]">{o.label}</span>              </span>
              {o.custom && <span className="shrink-0 rounded border border-[#DCC99A] px-1 font-mono text-[9px] text-[#8A6A2F]">custom</span>}
              {!o.live && <span className="shrink-0 rounded border border-[#E8E2D8] px-1 font-mono text-[9px] text-[#A39B8E]">snapshot</span>}
            </button>
          </li>
        ))}
        {filteredObjects.length === 0 && (
          <li className="rounded-lg border border-dashed border-[#E8E2D8] p-3 text-center text-[12px] text-[#A39B8E]">
            {connected ? "No objects match." : "No snapshot objects - connect and capture a snapshot."}
          </li>
        )}
      </ul>

      {selectedObject && (
        <div className="border-t border-[#F0EBE0] pt-2">
          <p className="mb-1.5 font-mono text-[11px] font-semibold text-[#27241F]">{selectedObject}</p>
          <input
            value={fieldQuery}
            onChange={(e) => setFieldQuery(e.target.value)}
            placeholder="Search fields…"
            aria-label="Search fields"
            spellCheck={false}
            className="mb-1.5 w-full rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none"
          />
          <ul className="max-h-[260px] space-y-px overflow-y-auto">
            {filteredFields.map((f) => {
              const isActive = activeObject === selectedObject && activeField === f.name;
              return (
                <li key={f.name}>
                  <button
                    type="button"
                    onClick={() => onPickField(selectedObject, f)}
                    aria-pressed={isActive}
                    title={`${f.label} · ${f.type}`}
                    className={`w-full cursor-pointer rounded-md px-2 py-1 text-left ${
                      isActive ? "bg-[#FAF3E3] outline outline-1 outline-[#A98450]" : "hover:bg-[#FAF8F2]"
                    }`}
                  >
                    <span className="block truncate font-mono text-[11px] text-[#27241F]">{f.name}</span>
                    <span className="flex items-center gap-1">
                      <span className="truncate text-[10px] text-[#A39B8E]">{f.label} · {f.type}</span>
                      {!f.nillable && <span className="shrink-0 font-mono text-[9px] font-bold text-[#B3261E]" title="Not nillable">req</span>}
                      {f.externalId && <span className="shrink-0 font-mono text-[9px] text-[#5F7048]" title="External ID">ext</span>}
                      {(f.type === "picklist" || f.type === "multipicklist") && <span className="shrink-0 font-mono text-[9px] text-[#8A6A2F]" title="Picklist">pick</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 font-mono text-[10px] text-[#A39B8E]">{filteredFields.length} fields</p>
        </div>
      )}
    </div>
  );
}
