"use client";

import { useMemo, useState } from "react";
import Button from "../ui/Button";
import { useMappingMetadata } from "../mapping/useMappingMetadata";
import { normalizeOperationKey } from "@/lib/experience/apiCatalog";
import { logChange } from "@/lib/experience/migrate";
import type { StudioProject } from "@/lib/studio/types";
import type { MappingProject, SnapshotField, SnapshotObject } from "@/lib/mapping/types";
import type { Screen } from "@/lib/experience/types";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const inputCls =
  "w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none";

type Contract = "standard" | "composite" | "custom";

interface PickedField {
  objectName: string;
  name: string;
  label: string;
  fieldType: string;
  required: boolean;
  sourcePath?: string;
}

function sfDataType(t: string): "string" | "number" | "boolean" | "date" | "unknown" {
  const l = t.toLowerCase();
  if (l === "boolean") return "boolean";
  if (["int", "double", "currency", "percent", "number", "long"].includes(l)) return "number";
  if (["date", "datetime", "time"].includes(l)) return "date";
  return "string";
}

/** Builder-style mandatory rule: writable, non-nullable, no create default. */
export function isMandatory(f: { nillable?: boolean; createable?: boolean; defaultedOnCreate?: boolean }): boolean {
  return !f.nillable && !!f.createable && !f.defaultedOnCreate;
}

/**
 * Screenshot-first field mapper. Drop a form screenshot on the screen, pick a
 * contract (standard object / composite child mapping / custom catalog API),
 * multi-select fields with required pre-filled, attach a note per row, add.
 */
export function ScreenFieldMapper({
  project,
  screen,
  snapshotObjects,
  childMaps,
  payloadChoices,
  onMutate,
}: {
  project: StudioProject;
  screen: Screen;
  snapshotObjects: SnapshotObject[];
  childMaps: MappingProject[];
  payloadChoices: { id: string; label: string }[];
  onMutate: (fn: (p: StudioProject) => StudioProject) => void;
}) {
  const meta = useMappingMetadata();
  const [contract, setContract] = useState<Contract>("standard");
  const [objQuery, setObjQuery] = useState("");
  const [objectName, setObjectName] = useState("");
  const [fieldQuery, setFieldQuery] = useState("");
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [opId, setOpId] = useState("");
  const [compMappingId, setCompMappingId] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const objectList = useMemo(() => {
    if (meta.connected && meta.objects.length > 0) {
      return meta.objects.map((o) => ({ name: o.name, label: o.label, custom: o.custom, live: true }));
    }
    return snapshotObjects.map((o) => ({ name: o.name, label: o.label, custom: o.custom, live: false }));
  }, [meta.connected, meta.objects, snapshotObjects]);

  const filteredObjects = useMemo(() => {
    const q = objQuery.trim().toLowerCase();
    const list = q
      ? objectList.filter((o) => o.name.toLowerCase().includes(q) || o.label.toLowerCase().includes(q))
      : objectList;
    return list.slice(0, 100);
  }, [objectList, objQuery]);

  const liveDescribe = objectName ? meta.describes.get(objectName) : undefined;
  const snapFields: SnapshotField[] | undefined = objectName
    ? snapshotObjects.find((o) => o.name === objectName)?.fields
    : undefined;

  const fields: PickedField[] = useMemo(() => {
    if (liveDescribe) {
      return (liveDescribe.fields ?? []).map((f) => ({
        objectName, name: f.name, label: f.label, fieldType: f.type,
        required: isMandatory(f),
      }));
    }
    return (snapFields ?? []).map((f) => ({
      objectName, name: f.name, label: f.label, fieldType: f.type,
      required: isMandatory(f),
    }));
  }, [liveDescribe, snapFields, objectName]);

  const filteredFields = useMemo(() => {
    const q = fieldQuery.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter(
      (f) => f.name.toLowerCase().includes(q) || f.label.toLowerCase().includes(q) || f.fieldType.toLowerCase().includes(q)
    );
  }, [fields, fieldQuery]);

  const selectObject = (name: string) => {
    setObjectName(name);
    setFieldQuery("");
    setPicked(new Map());
    setResult(null);
    void meta.loadDescribe(name);
  };

  const toggleField = (f: PickedField) => {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(f.name)) next.delete(f.name);
      else next.set(f.name, "");
      return next;
    });
  };

  const selectRequired = () => {
    setPicked((prev) => {
      const next = new Map(prev);
      for (const f of fields) if (f.required && !next.has(f.name)) next.set(f.name, "");
      return next;
    });
  };

  const compRows = useMemo(() => {
    const m = childMaps.find((c) => c.id === compMappingId);
    return m?.mappings.map((r) => ({ objectName: r.objectName, fieldName: r.fieldName, sourcePath: r.sourcePath })) ?? [];
  }, [childMaps, compMappingId]);

  const setNote = (key: string, note: string) => {
    setPicked((prev) => new Map(prev).set(key, note));
  };

  const canAdd =
    contract === "composite"
      ? compRows.length > 0
      : objectName !== "" && (contract === "custom" ? opId !== "" : true) && picked.size > 0;

  const add = () => {
    const now = new Date().toISOString();
    let added = 0;
    let skipped = 0;
    onMutate((p) => {
      if (!p.experience) return p;
      const exp = p.experience;
      const existingReqNames = new Set(exp.requirements.filter((r) => r.screenId === screen.id).map((r) => r.name));
      let ops = p.apiCatalog?.operations ?? [];
      let operationId: string | undefined;
      if (contract === "standard") {
        const key = normalizeOperationKey("POST", `/sobjects/${objectName}`);
        const found = ops.find((o) => o.operationKey === key);
        if (found) {
          operationId = found.id;
        } else {
          operationId = uid("op");
          ops = [
            ...ops,
            {
              id: operationId, operationKey: key, name: `${objectName} create · ${screen.name}`,
              method: "POST", path: `/sobjects/${objectName}`, layer: "salesforce" as const,
              errorContractIds: [], dependencyIds: [], lifecycle: "proposed" as const,
              status: "proposed" as const, tags: [], createdAt: now, updatedAt: now,
            },
          ];
        }
      } else if (contract === "custom") {
        operationId = opId || undefined;
      }
      const rows: PickedField[] =
        contract === "composite"
          ? compRows.map((r) => ({
              objectName: r.objectName, name: r.fieldName || r.sourcePath.split(".").pop() || r.sourcePath,
              label: r.fieldName || r.sourcePath, fieldType: "string", required: false, sourcePath: r.sourcePath,
            }))
          : [...picked.entries()].map(([name]) => {
              const f = fields.find((x) => x.name === name)!;
              return { ...f, sourcePath: undefined };
            });
      // Per-row notes for composite rows live in the picked map keyed by field name.
      const noteFor = (r: PickedField): string => {
        if (contract !== "composite") return picked.get(r.name) ?? "";
        return picked.get(r.name) ?? "";
      };
      const comps = [...exp.components];
      const reqs = [...exp.requirements];
      const binds = [...exp.bindings];
      const compIds: string[] = [];
      for (const r of rows) {
        const reqName = `${r.objectName}.${r.name}`;
        if (existingReqNames.has(reqName)) {
          skipped += 1;
          continue;
        }
        existingReqNames.add(reqName);
        const compId = uid("comp");
        const reqId = uid("req");
        const bindId = operationId ? uid("bind") : undefined;
        comps.push({
          id: compId, screenId: screen.id, name: r.label, componentType: "input" as const,
          purpose: r.sourcePath ? `From ${r.sourcePath}` : undefined,
          requirementIds: [reqId], bindingIds: bindId ? [bindId] : [], actionIds: [], stateIds: [],
          status: "draft" as const, tags: [], createdAt: now, updatedAt: now,
        });
        reqs.push({
          id: reqId, screenId: screen.id, componentId: compId, bindingId: bindId,
          name: reqName, description: `${r.label} · ${r.fieldType}`, direction: "request" as const,
          propertyPath: r.sourcePath ?? r.name, dataType: sfDataType(r.fieldType),
          required: r.required, source: "contract" as const, status: "draft" as const,
          notes: noteFor(r).trim() || undefined,
        });
        if (bindId && operationId) {
          binds.push({
            id: bindId, screenId: screen.id, componentId: compId, operationId,
            usage: "create" as const, trigger: "user-action" as const,
            requestRequirementIds: [reqId], responseRequirementIds: [], stateIds: [],
            status: "proposed" as const, createdAt: now, updatedAt: now,
          });
        }
        compIds.push(compId);
        added += 1;
      }
      let screens = exp.screens;
      if (contract === "composite" && compMappingId) {
        screens = screens.map((s) => (s.id === screen.id ? { ...s, payloadMappingId: compMappingId, updatedAt: now } : s));
      }
      const next = {
        ...p,
        apiCatalog: p.apiCatalog ? { ...p.apiCatalog, operations: ops, updatedAt: now } : p.apiCatalog,
        experience: { ...exp, components: comps, requirements: reqs, bindings: binds, screens, updatedAt: now },
        updatedAt: now,
      };
      logChange(next, "component", compIds[0] ?? screen.id, "created", `Mapped ${added} field${added === 1 ? "" : "s"} on ${screen.name} (${contract}).`, now);
      return next;
    });
    setResult(`${added} added${skipped > 0 ? `, ${skipped} already present` : ""}.`);
    setPicked(new Map());
  };

  const selectedRows =
    contract === "composite"
      ? compRows.map((r) => ({ key: r.fieldName || r.sourcePath, label: `${r.objectName}.${r.fieldName || r.sourcePath}` }))
      : [...picked.keys()].map((name) => {
          const f = fields.find((x) => x.name === name);
          return { key: name, label: f ? `${f.objectName}.${f.name} · ${f.label}` : name };
        });

  return (
    <div className="mt-3 rounded-xl border border-[#E8E2D8] bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Map screenshot fields</p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Contract type">
        {(
          [
            ["standard", "Standard object"],
            ["composite", "Composite mapping"],
            ["custom", "Custom API"],
          ] as [Contract, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={contract === id}
            onClick={() => {
              setContract(id);
              setPicked(new Map());
              setResult(null);
            }}
            className={`cursor-pointer rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${
              contract === id ? "border-[#211F1B] bg-[#211F1B] text-white" : "border-[#E8E2D8] text-[#777168] hover:text-[#27241F]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {contract === "composite" ? (
        <div className="mt-2">
          <select
            value={compMappingId}
            onChange={(e) => {
              setCompMappingId(e.target.value);
              setPicked(new Map());
              setResult(null);
            }}
            aria-label="Child integration mapping"
            className={`${inputCls} cursor-pointer font-mono`}
          >
            <option value="">Pick an integration mapping…</option>
            {childMaps.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.mappings.length} rows
              </option>
            ))}
          </select>
          {compMappingId && (
            <p className="mt-1 font-mono text-[11px] text-[#777168]">
              {compRows.length} rows - links this screen to the mapping and imports each row as a field. Notes optional per row below.
            </p>
          )}
        </div>
      ) : contract === "custom" ? (
        <div className="mt-2">
          <select
            value={opId}
            onChange={(e) => {
              setOpId(e.target.value);
              setResult(null);
            }}
            aria-label="Catalog API operation"
            className={`${inputCls} cursor-pointer font-mono`}
          >
            <option value="">Pick a catalog operation…</option>
            {(project.apiCatalog?.operations ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.method} {o.path} · {o.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {contract !== "composite" && (
        <div className="mt-2">
          <input
            value={objQuery}
            onChange={(e) => setObjQuery(e.target.value)}
            placeholder="Search objects (name or label)…"
            aria-label="Search Salesforce objects"
            spellCheck={false}
            className={inputCls}
          />
          {!meta.connected && (
            <p className="mt-1 text-[11px] text-[#8A6A2F]">Not connected - browsing the project snapshot. Connect via Home for live schema.</p>
          )}
          <ul className="mt-1 max-h-[140px] space-y-px overflow-y-auto">
            {filteredObjects.map((o) => (
              <li key={o.name}>
                <button
                  type="button"
                  onClick={() => selectObject(o.name)}
                  aria-pressed={objectName === o.name}
                  className={`w-full cursor-pointer rounded-md px-2 py-1 text-left font-mono text-[11px] ${
                    objectName === o.name ? "bg-[#FAF3E3] outline outline-1 outline-[#A98450]" : "hover:bg-[#FAF8F2]"
                  }`}
                >
                  {o.name} <span className="text-[#A39B8E]">· {o.label}</span>
                  {!o.live && <span className="ml-1 rounded border border-[#E8E2D8] px-1 text-[9px] text-[#A39B8E]">snapshot</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {contract !== "composite" && objectName !== "" && (
        <div className="mt-2 border-t border-[#F0EBE0] pt-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="font-mono text-[11px] font-semibold text-[#27241F]">{objectName} · {fields.length} fields</p>
            <div className="flex gap-1.5">
              <input
                value={fieldQuery}
                onChange={(e) => setFieldQuery(e.target.value)}
                placeholder="Filter fields…"
                aria-label="Filter fields"
                spellCheck={false}
                className="w-36 rounded-lg border border-[#E8E2D8] px-2 py-1 text-[11px] focus:border-[#A98450] focus:outline-none"
              />
              <button type="button" onClick={selectRequired} className="shrink-0 cursor-pointer rounded-lg border border-[#E8E2D8] px-2 py-1 text-[11px] font-semibold text-[#777168] hover:text-[#27241F]">
                Select required
              </button>
            </div>
          </div>
          <ul className="max-h-[220px] space-y-px overflow-y-auto">
            {filteredFields.map((f) => (
              <li key={f.name}>
                <label className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 ${picked.has(f.name) ? "bg-[#FAF3E3]" : "hover:bg-[#FAF8F2]"}`}>
                  <input type="checkbox" checked={picked.has(f.name)} onChange={() => toggleField(f)} className="accent-[#A98450]" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#27241F]">
                    {f.name} <span className="text-[#A39B8E]">· {f.label} · {f.fieldType}</span>
                  </span>
                  {f.required && <span className="shrink-0 font-mono text-[9px] font-bold text-[#B3261E]" title="Mandatory for create">req</span>}
                </label>
              </li>
            ))}
            {filteredFields.length === 0 && <li className="px-2 py-1 text-[11px] text-[#A39B8E]">No fields match.</li>}
          </ul>
        </div>
      )}

      {selectedRows.length > 0 && (
        <div className="mt-2 border-t border-[#F0EBE0] pt-2">
          <p className="mb-1 text-[12px] font-semibold text-[#27241F]">Review · {selectedRows.length} + note per row (optional)</p>
          <ul className="max-h-[180px] space-y-1 overflow-y-auto">
            {selectedRows.map((r) => (
              <li key={r.key} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#27241F]">{r.label}</span>
                <input
                  value={picked.get(r.key) ?? ""}
                  onChange={(e) => setNote(r.key, e.target.value)}
                  placeholder="Note…"
                  aria-label={`Note for ${r.label}`}
                  spellCheck={false}
                  className="w-40 shrink-0 rounded-lg border border-[#E8E2D8] px-2 py-1 text-[11px] focus:border-[#A98450] focus:outline-none"
                />
                {contract !== "composite" && (
                  <button type="button" onClick={() => setPicked((prev) => { const n = new Map(prev); n.delete(r.key); return n; })} aria-label={`Remove ${r.label}`} className="shrink-0 cursor-pointer rounded px-1 text-[#B3261E] hover:bg-[#F9E8E6]">✕</button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="font-mono text-[10px] text-[#A39B8E]">
              {contract === "composite" ? "Links payload + imports rows as fields." : contract === "custom" ? "Binds to the picked catalog operation." : "Proposes POST /sobjects + create bindings."}
            </p>
            <Button size="sm" disabled={!canAdd} onClick={add}>
              Add {contract === "composite" ? compRows.length : picked.size} field{(contract === "composite" ? compRows.length : picked.size) === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}

      {payloadChoices.length === 0 && contract === "composite" && (
        <p className="mt-2 text-[11px] text-[#A39B8E]">No integration mappings in this project yet - add one under Mappings first.</p>
      )}
      {result && <p className="mt-2 text-[12px] font-semibold text-[#2F7D4F]">{result}</p>}
    </div>
  );
}
