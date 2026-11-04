"use client";

import { useMemo, useState } from "react";
import { rankObjects } from "@/lib/search/rank";
import { adaptDescribe } from "@/lib/contracts/metadata-adapter";
import type { ContractFieldMeta } from "@/lib/contracts/metadata-adapter";
import { prefillProperty } from "@/lib/api-contracts/schema-prefill";
import type { SnapshotEntry } from "@/lib/api-contracts/persistence";
import type { ApiProject, PropertyDef, SchemaDef } from "@/lib/api-contracts/types";
import Button from "../ui/Button";
import Input from "../ui/Input";
import type { SalesforceDescribeResult, SalesforceObject } from "@/lib/salesforce/types";

interface SchemaWorkbenchProps {
  draft: ApiProject;
  objects: SalesforceObject[];
  describes: Map<string, SalesforceDescribeResult>;
  snapshots: SnapshotEntry[];
  session: { instanceUrl: string; token: string; apiVersion: string } | null;
  onPatchDraft: (id: string, patch: Partial<ApiProject> | ((p: ApiProject) => ApiProject)) => void;
  onFetchDescribe: (objectName: string) => Promise<SalesforceDescribeResult | null>;
  onConnect: () => void;
}

/**
 * Schema workbench: metadata browser (multi-object) + compact key-value
 * rows + full property drawer. Architect owns every value; metadata only
 * prefills on add.
 */
export function SchemaWorkbench(props: SchemaWorkbenchProps) {
  const { draft, objects, describes, snapshots, session } = props;
  const { onPatchDraft, onFetchDescribe, onConnect } = props;
  const [schemaName, setSchemaName] = useState<string | null>(draft.schemas[0]?.name ?? null);
  const [drawerProp, setDrawerProp] = useState<string | null>(null);

  const metaByObject = useMemo(() => {
    const m = new Map<string, ContractFieldMeta[]>();
    const known = new Set<string>();
    for (const [name, d] of describes) {
      try {
        m.set(name, adaptDescribe(d).fields);
        known.add(name);
      } catch {
        /* corrupt describe */
      }
    }
    for (const s of snapshots) {
      if (known.has(s.objectName)) continue;
      try {
        m.set(s.objectName, adaptDescribe(s.describe as never).fields);
      } catch {
        /* corrupt snapshot */
      }
    }
    return m;
  }, [describes, snapshots]);

  const schema: SchemaDef | null = draft.schemas.find((s) => s.name === schemaName) ?? draft.schemas[0] ?? null;

  const setSchemas = (schemas: SchemaDef[]) => onPatchDraft(draft.id, { schemas });

  const addShell = (name: string) => {
    const clean = name.trim().replace(/[^A-Za-z0-9_]/g, "");
    if (clean === "" || draft.schemas.some((s) => s.name === clean)) return;
    setSchemas([...draft.schemas, { name: clean, description: "", properties: [] }]);
    setSchemaName(clean);
  };

  const usedBy = schema
    ? draft.operations.filter((o) => o.requestSchema === schema.name || o.responseSchema === schema.name)
    : [];

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Schemas · {draft.schemas.length}</span>
          {draft.schemas.map((s) => (
            <button
              key={s.name}
              onClick={() => {
                setSchemaName(s.name);
                setDrawerProp(null);
              }}
              className={`rounded-lg border px-2.5 py-1 font-mono text-[12px] transition-colors cursor-pointer ${
                schema?.name === s.name
                  ? "border-[#211F1B] bg-[#211F1B] text-white"
                  : "border-[#E8E2D8] text-[#777168] hover:text-[#27241F]"
              }`}
            >
              {s.name} · {s.properties.length}
            </button>
          ))}
          <NewShellInline onAdd={addShell} />
        </div>
        {schema && usedBy.length > 0 && (
          <p className="mt-1.5 font-mono text-[11px] text-[#A39B8E]">
            used by {usedBy.map((o) => o.operationId).join(", ")}
          </p>
        )}
      </div>

      {!schema ? (
        <div className="rounded-xl border border-[#E8E2D8] bg-white p-10 text-center text-sm text-[#A39B8E]">
          No schemas yet - create a shell above, then add properties from metadata.
        </div>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <PropertyList
            draftId={draft.id}
            schema={schema}
            onPatchDraft={onPatchDraft}
            onOpen={(api) => setDrawerProp(api)}
            drawerProp={drawerProp}
            onCloseDrawer={() => setDrawerProp(null)}
          />
          <MetadataBrowser
            draft={draft}
            schemaName={schema.name}
            objects={objects}
            metaByObject={metaByObject}
            session={session}
            onPatchDraft={onPatchDraft}
            onFetchDescribe={onFetchDescribe}
            onConnect={onConnect}
          />
        </div>
      )}
    </div>
  );
}

function NewShellInline({ onAdd }: { onAdd: (name: string) => void }) {
  const [v, setV] = useState("");
  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onAdd(v);
            setV("");
          }
        }}
        placeholder="+ Shell"
        aria-label="New schema shell name"
        spellCheck={false}
        className="w-24 rounded-lg border border-dashed border-[#E8E2D8] px-2 py-1 font-mono text-[12px] focus:border-[#A98450] focus:outline-none"
      />
    </span>
  );
}

// ── Configured properties ───────────────────────────────────────────────────

function PropertyList({
  draftId,
  schema,
  onPatchDraft,
  onOpen,
  drawerProp,
  onCloseDrawer,
}: {
  draftId: string;
  schema: SchemaDef;
  onPatchDraft: SchemaWorkbenchProps["onPatchDraft"];
  onOpen: (externalName: string) => void;
  drawerProp: string | null;
  onCloseDrawer: () => void;
}) {
  const setProps = (properties: PropertyDef[]) =>
    onPatchDraft(draftId, (p) => ({
      ...p,
      schemas: p.schemas.map((s) => (s.name === schema.name ? { ...s, properties } : s)),
    }));

  const openProp = drawerProp ? schema.properties.find((x) => x.externalName === drawerProp) ?? null : null;

  return (
    <div className="rounded-xl border border-[#E8E2D8] bg-white overflow-hidden">
      <p className="border-b border-[#E8E2D8] px-3 py-2 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
        {schema.name} · {schema.properties.length} properties
      </p>
      {schema.properties.length === 0 && (
        <p className="px-3 py-6 text-center text-[13px] text-[#A39B8E]">
          Empty - add properties from the metadata browser.
        </p>
      )}
      <div className="divide-y divide-[#E8E2D8]">
        {schema.properties.map((prop) => (
          <div key={prop.externalName}>
            <div
              className="flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-[#F5F1E8]"
              onClick={() => onOpen(prop.externalName)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpen(prop.externalName);
              }}
              title="Open property configuration"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-[#27241F]">
                {prop.externalName}
              </span>
              <span className="shrink-0 rounded border border-[#E8E2D8] bg-[#F8F6F0] px-1 font-mono text-[10px] text-[#777168]">
                {prop.type}
              </span>
              {prop.required && (
                <span className="shrink-0 rounded bg-red-700 px-1 font-mono text-[10px] text-white" title="Required">R</span>
              )}
              {(prop.readOnly || prop.writeOnly) && (
                <span className="shrink-0 rounded bg-[#211F1B] px-1 font-mono text-[10px] text-white" title={prop.readOnly ? "Read-only" : "Write-only"}>
                  {prop.readOnly ? "ro" : "wo"}
                </span>
              )}
              {prop.mapping && (
                <span className="shrink-0 font-mono text-[10px] text-[#32815B]" title={`${prop.mapping.targetObject}.${prop.mapping.targetField}`}>
                  ⬦
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setProps(schema.properties.filter((x) => x.externalName !== prop.externalName));
                  if (drawerProp === prop.externalName) onCloseDrawer();
                }}
                aria-label={`Remove ${prop.externalName}`}
                className="shrink-0 rounded p-1 text-[13px] leading-none text-[#A39B8E] hover:text-[#B84C42] hover:bg-red-50 transition-colors cursor-pointer"
              >
                ×
              </button>
            </div>
            {openProp?.externalName === prop.externalName && (
              <PropertyDrawer
                draftId={draftId}
                schemaName={schema.name}
                prop={openProp}
                onPatchDraft={onPatchDraft}
                onClose={onCloseDrawer}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Metadata browser (multi-object) ─────────────────────────────────────────

function MetadataBrowser({
  draft,
  schemaName,
  objects,
  metaByObject,
  session,
  onPatchDraft,
  onFetchDescribe,
  onConnect,
}: {
  draft: ApiProject;
  schemaName: string;
  objects: SalesforceObject[];
  metaByObject: Map<string, ContractFieldMeta[]>;
  session: SchemaWorkbenchProps["session"];
  onPatchDraft: SchemaWorkbenchProps["onPatchDraft"];
  onFetchDescribe: SchemaWorkbenchProps["onFetchDescribe"];
  onConnect: () => void;
}) {
  const [objSearch, setObjSearch] = useState("");
  const [fieldSearch, setFieldSearch] = useState("");
  const [pickedObject, setPickedObject] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const schema = draft.schemas.find((s) => s.name === schemaName);
  const added = new Set(schema?.properties.map((p) => `${p.source?.objectApiName ?? ""}.${p.source?.fieldApiName ?? ""}`));

  const effectiveObject = pickedObject ?? draft.boundary.participatingObjects[0] ?? null;
  const fields = effectiveObject ? (metaByObject.get(effectiveObject) ?? []) : [];

  const candidates = (() => {
    const q = fieldSearch.trim().toLowerCase();
    if (!q) return fields.slice(0, 60);
    return rankObjects(
      fields.map((f) => ({ label: f.label, name: f.apiName })),
      fieldSearch,
      60
    )
      .map((r) => fields.find((f) => f.apiName === r.name))
      .filter((f): f is ContractFieldMeta => Boolean(f));
  })();

  const q = objSearch.trim().toLowerCase();
  const objMatches =
    q === "" ? [] : objects.filter((o) => o.name.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)).slice(0, 8);

  const addPicked = () => {
    if (!effectiveObject || picked.size === 0) return;
    const rows = [...picked]
      .map((api) => metaByObject.get(effectiveObject)?.find((f) => f.apiName === api))
      .filter((f): f is ContractFieldMeta => Boolean(f))
      .filter((f) => !added.has(`${effectiveObject}.${f.apiName}`))
      .map((f) => ({ ...prefillProperty(effectiveObject, f), description: "", notes: undefined }));
    if (rows.length === 0) return;
    onPatchDraft(draft.id, (p) => ({
      ...p,
      schemas: p.schemas.map((s) => (s.name === schemaName ? { ...s, properties: [...s.properties, ...rows] } : s)),
    }));
    setPicked(new Set());
  };

  return (
    <div className="rounded-xl border border-[#E8E2D8] bg-white overflow-hidden">
      <div className="border-b border-[#E8E2D8] p-3 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Metadata browser</p>
        <div className="flex flex-wrap gap-1.5">
          {draft.boundary.participatingObjects.map((o) => (
            <button
              key={o}
              onClick={() => {
                setPickedObject(o);
                setPicked(new Set());
                void onFetchDescribe(o);
              }}
              className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors cursor-pointer ${
                effectiveObject === o ? "border-[#211F1B] bg-[#211F1B] text-white" : "border-[#E8E2D8] text-[#777168] hover:text-[#27241F]"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
        {session ? (
          <div className="relative">
            <Input placeholder="Other object… (describes on pick)" value={objSearch} onChange={(e) => setObjSearch(e.target.value)} aria-label="Describe another object" />
            {q !== "" && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-[#E8E2D8] bg-white shadow-lg">
                {objMatches.map((o) => (
                  <button
                    key={o.name}
                    onClick={() => {
                      setPickedObject(o.name);
                      setPicked(new Set());
                      setObjSearch("");
                      void onFetchDescribe(o.name);
                    }}
                    className="w-full px-3 py-2 text-left text-[13px] hover:bg-[#F5F1E8] cursor-pointer"
                  >
                    <span className="font-medium">{o.label}</span>
                    <span className="ml-2 font-mono text-[11px] text-[#A39B8E]">{o.name}</span>
                  </button>
                ))}
                {objMatches.length === 0 && <p className="px-3 py-2 text-[13px] text-[#A39B8E]">No matches</p>}
              </div>
            )}
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={onConnect}>Connect for live metadata</Button>
        )}
        <Input placeholder="Search fields…" value={fieldSearch} onChange={(e) => setFieldSearch(e.target.value)} aria-label="Search fields" />
      </div>
      <div className="max-h-[380px] overflow-y-auto p-1.5">
        {!effectiveObject && <p className="px-2 py-3 text-[11px] text-[#A39B8E]">Pick a participating object, or connect and search.</p>}
        {effectiveObject && fields.length === 0 && (
          <p className="px-2 py-3 text-[11px] text-[#A39B8E]">Loading {effectiveObject} metadata…</p>
        )}
        {candidates.map((f) => {
          const key = `${effectiveObject}.${f.apiName}`;
          const isAdded = added.has(key);
          const on = picked.has(f.apiName);
          return (
            <div
              key={f.apiName}
              onClick={() => {
                if (isAdded) return;
                setPicked((p) => {
                  const n = new Set(p);
                  if (n.has(f.apiName)) n.delete(f.apiName);
                  else n.add(f.apiName);
                  return n;
                });
              }}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                isAdded ? "opacity-45" : on ? "bg-[#211F1B] text-white" : "hover:bg-[#F5F1E8] text-[#27241F]"
              }`}
              role="checkbox"
              aria-checked={on}
              tabIndex={isAdded ? -1 : 0}
              onKeyDown={(e) => {
                if ((e.key === " " || e.key === "Enter") && !isAdded) {
                  e.preventDefault();
                  setPicked((p) => {
                    const n = new Set(p);
                    if (n.has(f.apiName)) n.delete(f.apiName);
                    else n.add(f.apiName);
                    return n;
                  });
                }
              }}
            >
              <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[10px] leading-none ${on ? "border-white bg-white text-[#211F1B]" : "border-[#A39B8E] text-transparent"}`} aria-hidden="true">✓</span>
              <span className="min-w-0 flex-1 truncate font-medium">{f.label}</span>
              <span className={`truncate font-mono text-[11px] ${on ? "text-white/60" : "text-[#A39B8E]"}`}>{f.apiName}</span>
              <span className={`shrink-0 rounded border px-1 font-mono text-[10px] ${on ? "border-white/30 text-white/70" : "border-[#E8E2D8] bg-[#F8F6F0] text-[#777168]"}`}>{f.sfType}</span>
              {isAdded && <span className="shrink-0 font-mono text-[10px] text-[#32815B]">added</span>}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-[#E8E2D8] p-2">
        <span className="px-1 text-[11px] text-[#A39B8E]">{picked.size} picked</span>
        <Button size="sm" disabled={picked.size === 0} onClick={addPicked}>
          Add{picked.size > 0 ? ` ${picked.size}` : ""}
        </Button>
      </div>
    </div>
  );
}

// ── Property drawer ─────────────────────────────────────────────────────────

function PropertyDrawer({
  draftId,
  schemaName,
  prop,
  onPatchDraft,
  onClose,
}: {
  draftId: string;
  schemaName: string;
  prop: PropertyDef;
  onPatchDraft: SchemaWorkbenchProps["onPatchDraft"];
  onClose: () => void;
}) {
  const set = (patch: Partial<PropertyDef>) =>
    onPatchDraft(draftId, (p) => ({
      ...p,
      schemas: p.schemas.map((s) =>
        s.name === schemaName
          ? { ...s, properties: s.properties.map((x) => (x.externalName === prop.externalName ? { ...x, ...patch } : x)) }
          : s
      ),
    }));
  const setMapping = (patch: Partial<NonNullable<PropertyDef["mapping"]>> | null) =>
    onPatchDraft(draftId, (p) => ({
      ...p,
      schemas: p.schemas.map((s) =>
        s.name === schemaName
          ? {
              ...s,
              properties: s.properties.map((x) =>
                x.externalName === prop.externalName
                  ? {
                      ...x,
                      mapping: patch === null ? undefined : { ...(x.mapping ?? { targetObject: "", targetField: "" }), ...patch } as NonNullable<PropertyDef["mapping"]>,
                    }
                  : x
              ),
            }
          : s
      ),
    }));

  return (
    <div className="border-t border-dashed border-[#D8C7A9] bg-[#FDFBF5] px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] text-[#A39B8E]">
          {prop.source ? `${prop.source.objectApiName}.${prop.source.fieldApiName}` : "unmapped property"}
        </p>
        <button onClick={onClose} className="rounded px-1.5 py-0.5 text-[11px] text-[#777168] hover:bg-[#F5F1E8] cursor-pointer" aria-label="Close property editor">✕ Close</button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input label="External name" value={prop.externalName} onChange={(e) => set({ externalName: e.target.value })} spellCheck={false} />
        <Input label="Description" value={prop.description} onChange={(e) => set({ description: e.target.value })} />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-[#777168]">Type</span>
          <select value={prop.type} onChange={(e) => set({ type: e.target.value })} className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 font-mono text-[13px] cursor-pointer">
            {["string", "integer", "number", "boolean", "array", "object"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <Input label="Format" value={prop.format ?? ""} onChange={(e) => set({ format: e.target.value || undefined })} placeholder="date, email…" spellCheck={false} />
        <Input label="Pattern" value={prop.pattern ?? ""} onChange={(e) => set({ pattern: e.target.value || undefined })} spellCheck={false} />
      </div>
      <div className="flex flex-wrap gap-3">
        {(
          [
            ["required", "Required"],
            ["nullable", "Nullable"],
            ["readOnly", "Read-only"],
            ["writeOnly", "Write-only"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex cursor-pointer items-center gap-1.5 text-[13px]">
            <input type="checkbox" checked={Boolean(prop[k])} onChange={(e) => set({ [k]: e.target.checked } as Partial<PropertyDef>)} className="h-3.5 w-3.5 rounded" />
            {label}
          </label>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input label="maxLength" value={prop.maxLength?.toString() ?? ""} onChange={(e) => set({ maxLength: e.target.value === "" ? undefined : Number(e.target.value) })} spellCheck={false} />
        <Input label="Default" value={prop.default === undefined ? "" : String(prop.default)} onChange={(e) => set({ default: e.target.value === "" ? undefined : e.target.value })} spellCheck={false} />
        <Input label="Example" value={prop.example === undefined ? "" : String(prop.example)} onChange={(e) => set({ example: e.target.value === "" ? undefined : e.target.value })} spellCheck={false} />
      </div>
      <Input
        label="Enum (comma-separated)"
        value={(prop.enum ?? []).join(", ")}
        onChange={(e) => set({ enum: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
        spellCheck={false}
      />
      <div className="rounded-lg border border-[#D8C7A9] bg-[#F5F1E8] p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-[#A98450]">Mapping</p>
          {prop.mapping ? (
            <button onClick={() => setMapping(null)} className="text-[11px] text-[#B84C42] hover:underline cursor-pointer">Remove mapping</button>
          ) : (
            <button
              onClick={() =>
                setMapping({
                  targetObject: prop.source?.objectApiName ?? "",
                  targetField: prop.source?.fieldApiName ?? "",
                  transform: "direct",
                  direction: "inbound",
                  ownership: "consumer",
                })
              }
              className="text-[11px] text-[#A98450] hover:underline cursor-pointer"
            >
              + Add mapping
            </button>
          )}
        </div>
        {prop.mapping && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input label="Target object" value={prop.mapping.targetObject} onChange={(e) => setMapping({ targetObject: e.target.value })} spellCheck={false} />
              <Input label="Target field" value={prop.mapping.targetField} onChange={(e) => setMapping({ targetField: e.target.value })} spellCheck={false} />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block">
                <span className="mb-0.5 block text-[11px] text-[#777168]">Transform</span>
                <select value={prop.mapping.transform} onChange={(e) => setMapping({ transform: e.target.value as NonNullable<PropertyDef["mapping"]>["transform"] })} className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] cursor-pointer">
                  {["direct", "trim", "lowercase", "uppercase", "date-format", "enum-map", "concat", "constant"].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[11px] text-[#777168]">Direction</span>
                <select value={prop.mapping.direction} onChange={(e) => setMapping({ direction: e.target.value as "inbound" | "outbound" })} className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] cursor-pointer">
                  <option value="inbound">inbound</option>
                  <option value="outbound">outbound</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[11px] text-[#777168]">Ownership</span>
                <select value={prop.mapping.ownership} onChange={(e) => setMapping({ ownership: e.target.value as "consumer" | "salesforce" | "shared" })} className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] cursor-pointer">
                  <option value="consumer">consumer</option>
                  <option value="salesforce">salesforce</option>
                  <option value="shared">shared</option>
                </select>
              </label>
            </div>
            {prop.mapping.transform === "date-format" && (
              <Input label="Date pattern" value={prop.mapping.dateFormat ?? ""} onChange={(e) => setMapping({ dateFormat: e.target.value })} placeholder="yyyy-MM-dd" spellCheck={false} />
            )}
            {prop.mapping.transform === "enum-map" && (
              <div>
                <label className="mb-0.5 block text-[11px] text-[#777168]">External = Salesforce (one per line)</label>
                <textarea
                  value={Object.entries(prop.mapping.enumMap ?? {}).map(([k, v]) => `${k} = ${v}`).join("\n")}
                  onChange={(e) => {
                    const map: Record<string, string> = {};
                    for (const line of e.target.value.split("\n")) {
                      const [k, v] = line.split("=").map((s) => s.trim());
                      if (k && v) map[k] = v;
                    }
                    setMapping({ enumMap: map });
                  }}
                  rows={2}
                  spellCheck={false}
                  className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 font-mono text-[13px] focus:border-[#A98450] focus:outline-none"
                />
              </div>
            )}
            <Input label="Mapping notes" value={prop.mapping.notes ?? ""} onChange={(e) => setMapping({ notes: e.target.value })} />
          </>
        )}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-ivory-700">Architect notes</label>
        <textarea value={prop.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} rows={2} className="w-full rounded-lg border border-[#E8E2D8] px-3 py-2 text-sm focus:border-[#A98450] focus:outline-none" />
      </div>
    </div>
  );
}
