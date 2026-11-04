"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import type {
  SalesforceObject,
  SalesforceDescribeResult,
  SalesforceField,
} from "@/lib/salesforce/types";
import {
  getWritableFields,
  getActivePicklistValues,
  isRequiredField,
} from "@/lib/salesforce/metadata";
import { rankObjects } from "@/lib/search/rank";
import type {
  StudioDocument,
  StudioRequest,
  StudioFieldValue,
  StudioIssue,
  StudioMethod,
  FieldMode,
} from "@/lib/composite/studio";
import { PicklistValuesButton } from "../PicklistValuesButton";
import PicklistDropdown from "../ui/PicklistDropdown";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import Input from "../ui/Input";

export interface StudioRequestActions {
  onSelect: (id: string) => void;
  onAddObject: (objectName: string) => void;
  onDuplicate: (id: string, withLinks: boolean) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onUpdateRequest: (id: string, patch: Partial<StudioRequest>) => void;
  onDescribeObject: (id: string, objectName: string) => Promise<void>;
  onAddFields: (requestId: string, fields: SalesforceField[]) => void;
  onRemoveField: (requestId: string, apiName: string) => void;
  onSetLiteral: (requestId: string, apiName: string, value: unknown) => void;
  onSetMode: (requestId: string, apiName: string, mode: FieldMode) => void;
  onCreateMapping: (targetRequestId: string, targetField: string, sourceRequestId: string, sourceProperty: string) => void;
  onRemoveMapping: (mappingId: string, clearValue: boolean) => void;
}

interface StudioRequestsProps {
  doc: StudioDocument;
  objects: SalesforceObject[];
  describes: Map<string, SalesforceDescribeResult>;
  selectedId: string | null;
  issues: StudioIssue[];
  actions: StudioRequestActions;
}

const METHODS: StudioMethod[] = ["POST", "PATCH", "GET", "DELETE"];

const METHOD_STYLE: Record<StudioMethod, string> = {
  POST: "bg-green-100 text-green-800 border-green-300",
  PATCH: "bg-amber-100 text-amber-800 border-amber-300",
  GET: "bg-sky-100 text-sky-800 border-sky-300",
  DELETE: "bg-red-100 text-red-800 border-red-300",
};

/**
 * Screen One - Requests: ordered inventory left, compact key-value editor
 * right. Only configured fields render; linking is explicit per field.
 */
export default function StudioRequests({
  doc,
  objects,
  describes,
  selectedId,
  issues,
  actions,
}: StudioRequestsProps) {
  const [addSearch, setAddSearch] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const selected = doc.requests.find((r) => r.id === selectedId) ?? doc.requests[0] ?? null;

  const suggestions = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    if (!q) return [];
    return rankObjects(objects, addSearch, 8).filter(
      (o) => o.name.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)
    );
  }, [objects, addSearch]);

  const issueFor = (requestId: string) => issues.filter((i) => i.requestId === requestId);
  const linkCount = (requestId: string) =>
    doc.mappings.filter((m) => m.sourceRequestId === requestId || m.targetRequestId === requestId).length;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* ── Inventory ── */}
      <div className="rounded-xl border border-[#E8E2D8] bg-white overflow-hidden">
        <div className="border-b border-[#E8E2D8] p-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
            Requests · {doc.requests.length}/25
          </p>
          <Input
            placeholder="Add request - search objects…"
            value={addSearch}
            onChange={(e) => setAddSearch(e.target.value)}
            aria-label="Search objects to add a request"
          />
          {addSearch.trim() !== "" && (
            <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-[#E8E2D8] bg-white shadow-sm">
              {suggestions.map((o) => (
                <button
                  key={o.name}
                  onClick={() => {
                    actions.onAddObject(o.name);
                    setAddSearch("");
                  }}
                  className="w-full px-3 py-2 text-left text-[13px] hover:bg-[#F5F1E8] transition-colors cursor-pointer"
                >
                  <span className="font-medium text-[#27241F]">{o.label}</span>
                  <span className="ml-2 font-mono text-[11px] text-[#A39B8E]">{o.name}</span>
                </button>
              ))}
              {suggestions.length === 0 && (
                <p className="px-3 py-2 text-[13px] text-[#A39B8E]">No matches</p>
              )}
            </div>
          )}
        </div>

        <div className="max-h-[560px] overflow-y-auto p-1.5" role="listbox" aria-label="Composite requests">
          {doc.requests.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-[#A39B8E]">
              No requests yet - search above to add your first sObject.
            </p>
          )}
          {doc.requests.map((r, i) => {
            const errs = issueFor(r.id).filter((x) => x.level === "error").length;
            const warns = issueFor(r.id).filter((x) => x.level === "warning").length;
            const links = linkCount(r.id);
            const isSel = selected?.id === r.id;
            return (
              <div
                key={r.id}
                role="option"
                aria-selected={isSel}
                onClick={() => actions.onSelect(r.id)}
                className={`group relative flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition-colors ${
                  isSel ? "bg-[#211F1B] text-white" : "hover:bg-[#F5F1E8] text-[#27241F]"
                }`}
                title={r.objectApiName || "Empty request"}
              >
                <span className={`font-mono text-[11px] ${isSel ? "text-white/60" : "text-[#A39B8E]"}`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className={`rounded border px-1 py-px font-mono text-[10px] font-bold ${isSel ? "border-white/30 bg-white/10 text-white" : METHOD_STYLE[r.method]}`}>
                  {r.method}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  {r.displayName || r.objectLabel || <span className={isSel ? "text-white/60" : "text-[#A39B8E]"}>Select object…</span>}
                  {r.referenceId !== "" && (
                    <span className={`ml-1.5 font-mono text-[11px] ${isSel ? "text-[#D8C7A9]" : "text-[#A98450]"}`}>
                      {r.referenceId}
                    </span>
                  )}
                </span>
                {links > 0 && (
                  <span className={`font-mono text-[10px] ${isSel ? "text-white/70" : "text-[#A98450]"}`} title={`${links} link${links === 1 ? "" : "s"}`}>
                    ⬦{links}
                  </span>
                )}
                {(errs > 0 || warns > 0) && (
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${errs > 0 ? "bg-[#B84C42]" : "bg-[#B98335]"}`}
                    title={errs > 0 ? `${errs} error${errs === 1 ? "" : "s"}` : `${warns} warning${warns === 1 ? "" : "s"}`}
                  />
                )}
                <button
                  type="button"
                  aria-label="Request actions"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuFor(menuFor === r.id ? null : r.id);
                  }}
                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs leading-none cursor-pointer ${
                    isSel ? "text-white/70 hover:text-white" : "text-[#A39B8E] hover:text-[#27241F] opacity-0 group-hover:opacity-100"
                  }`}
                >
                  ⋯
                </button>
                {menuFor === r.id && (
                  <div
                    className="absolute right-1 top-full z-30 w-48 overflow-hidden rounded-lg border border-[#E8E2D8] bg-white py-1 text-[#27241F] shadow-lg"
                    onClick={(e) => e.stopPropagation()}
                    role="menu"
                  >
                    {[
                      { label: "Duplicate", run: () => actions.onDuplicate(r.id, false) },
                      { label: "Duplicate with links", run: () => actions.onDuplicate(r.id, true) },
                      { label: "Move earlier", run: () => actions.onMove(r.id, -1), disabled: i === 0 },
                      { label: "Move later", run: () => actions.onMove(r.id, 1), disabled: i === doc.requests.length - 1 },
                      { label: "Delete", run: () => actions.onDelete(r.id), danger: true },
                    ].map((item) => (
                      <button
                        key={item.label}
                        disabled={item.disabled}
                        onClick={() => {
                          setMenuFor(null);
                          item.run();
                        }}
                        className={`block w-full px-3 py-1.5 text-left text-[13px] transition-colors cursor-pointer disabled:opacity-40 ${
                          item.danger ? "text-[#B84C42] hover:bg-red-50" : "hover:bg-[#F5F1E8]"
                        }`}
                        role="menuitem"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Editor ── */}
      {selected ? (
        <RequestEditor
          key={selected.id}
          doc={doc}
          request={selected}
          index={doc.requests.findIndex((r) => r.id === selected.id)}
          describe={describes.get(selected.objectApiName)}
          issues={issueFor(selected.id)}
          objects={objects}
          actions={actions}
        />
      ) : (
        <div className="rounded-xl border border-[#E8E2D8] bg-white p-10 text-center text-sm text-[#A39B8E]">
          Add your first request to begin.
        </div>
      )}
    </div>
  );
}

// ── Request editor ──────────────────────────────────────────────────────────

function RequestEditor({
  doc,
  request,
  index,
  describe,
  issues,
  objects,
  actions,
}: {
  doc: StudioDocument;
  request: StudioRequest;
  index: number;
  describe: SalesforceDescribeResult | undefined;
  issues: StudioIssue[];
  objects: SalesforceObject[];
  actions: StudioRequestActions;
}) {
  const [objSearch, setObjSearch] = useState("");

  const objSuggestions = useMemo(() => {
    const q = objSearch.trim().toLowerCase();
    if (!q) return [];
    return rankObjects(objects, objSearch, 8).filter(
      (o) => o.name.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)
    );
  }, [objects, objSearch]);

  const reqIssues = issues.filter((i) => i.scope === "request");
  const showFields = request.objectApiName !== "" && (request.method === "POST" || request.method === "PATCH");

  return (
    <div className="rounded-xl border border-[#E8E2D8] bg-white overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#E8E2D8] px-4 py-3">
        <span className="font-mono text-xs text-[#A39B8E]">{String(index + 1).padStart(2, "0")}</span>
        <input
          value={request.displayName}
          onChange={(e) => actions.onUpdateRequest(request.id, { displayName: e.target.value })}
          placeholder={request.objectLabel || "Untitled request"}
          aria-label="Display label"
          className="min-w-[120px] flex-1 rounded-md border border-transparent px-1.5 py-1 text-[15px] font-semibold text-[#27241F] hover:border-[#E8E2D8] focus:border-[#A98450] focus:outline-none"
        />
        <div className="flex rounded-lg border border-[#E8E2D8] overflow-hidden" role="group" aria-label="Method">
          {METHODS.map((m) => (
            <button
              key={m}
              onClick={() => actions.onUpdateRequest(request.id, { method: m })}
              aria-pressed={request.method === m}
              className={`px-2.5 py-1 font-mono text-[11px] font-bold transition-colors cursor-pointer ${
                request.method === m ? "bg-[#211F1B] text-white" : "bg-white text-[#777168] hover:text-[#27241F]"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        {request.referenceId !== "" && (
          <span className="font-mono text-xs text-[#A98450]" title="Reference ID">@{request.referenceId}</span>
        )}
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => actions.onDuplicate(request.id, false)}>Duplicate</Button>
          <Button variant="ghost" size="sm" onClick={() => actions.onDelete(request.id)}>Delete</Button>
        </div>
      </div>

      {reqIssues.length > 0 && (
        <div className="space-y-1 border-b border-[#E8E2D8] bg-red-50/50 px-4 py-2">
          {reqIssues.map((issue, k) => (
            <p key={k} className={`text-xs ${issue.level === "error" ? "text-[#B84C42]" : "text-[#B98335]"}`} role="alert">
              {issue.message}
            </p>
          ))}
        </div>
      )}

      <div className="space-y-4 p-4">
        {/* Object */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#777168]">Salesforce Object</label>
          <Input
            placeholder={request.objectApiName || "Search objects…"}
            value={objSearch}
            onChange={(e) => setObjSearch(e.target.value)}
            aria-label="Change object"
          />
          {objSearch.trim() !== "" && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-[#E8E2D8] bg-white shadow-sm">
              {objSuggestions.map((o) => (
                <button
                  key={o.name}
                  onClick={() => {
                    setObjSearch("");
                    void actions.onDescribeObject(request.id, o.name);
                  }}
                  className="w-full px-3 py-2 text-left text-[13px] hover:bg-[#F5F1E8] transition-colors cursor-pointer"
                >
                  <span className="font-medium text-[#27241F]">{o.label}</span>
                  <span className="ml-2 font-mono text-[11px] text-[#A39B8E]">{o.name}</span>
                </button>
              ))}
              {objSuggestions.length === 0 && <p className="px-3 py-2 text-[13px] text-[#A39B8E]">No matches</p>}
            </div>
          )}
          {request.objectApiName !== "" && objSearch.trim() === "" && (
            <p className="mt-1 font-mono text-[11px] text-[#A39B8E]">{request.objectApiName}</p>
          )}
        </div>

        {/* Reference ID */}
        {request.objectApiName !== "" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Input
                label="Reference ID"
                value={request.referenceId}
                onChange={(e: ChangeEvent<HTMLInputElement>) => actions.onUpdateRequest(request.id, { referenceId: e.target.value })}
                hint="@{referenceId.id} in later requests - unique per batch"
                spellCheck={false}
              />
            </div>
            {(request.method === "PATCH" || request.method === "DELETE" || request.method === "GET") && (
              <Input
                label={`Record ID${request.method === "GET" ? " (optional)" : " (required)"}`}
                value={request.recordId}
                onChange={(e: ChangeEvent<HTMLInputElement>) => actions.onUpdateRequest(request.id, { recordId: e.target.value })}
                placeholder="18-character Salesforce ID"
                className="font-mono"
                spellCheck={false}
              />
            )}
          </div>
        )}

        {/* Fields */}
        {showFields && (
          <FieldSection doc={doc} request={request} describe={describe} issues={issues} actions={actions} />
        )}
        {request.objectApiName !== "" && !showFields && (
          <p className="text-[13px] text-[#777168]">
            {request.method} targets <span className="font-mono">{request.objectApiName}</span>
            {request.recordId ? <span className="font-mono"> / {request.recordId}</span> : null} - no body editor needed.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Compact key-value field section ─────────────────────────────────────────

function FieldSection({
  doc,
  request,
  describe,
  issues,
  actions,
}: {
  doc: StudioDocument;
  request: StudioRequest;
  describe: SalesforceDescribeResult | undefined;
  issues: StudioIssue[];
  actions: StudioRequestActions;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const operation = request.method === "PATCH" ? "PATCH" : "POST";
  const writable = useMemo(
    () => (describe ? getWritableFields(describe.fields, operation) : []),
    [describe, operation]
  );
  // Mandatory fields are locked rows - removing one corrupts the request.
  const requiredSet = useMemo(
    () => new Set(writable.filter((f) => isRequiredField(f, operation)).map((f) => f.name)),
    [writable, operation]
  );
  const added = useMemo(() => new Set(request.fields.map((f) => f.apiName)), [request.fields]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = writable.filter((f) => !added.has(f.name));
    if (typeFilter !== "all") list = list.filter((f) => f.type === typeFilter);
    if (!q) return list.slice(0, 60);
    return rankObjects(list, search, 60).filter(
      (f) => f.name.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)
    );
  }, [writable, added, search, typeFilter]);

  const types = useMemo(() => ["all", ...Array.from(new Set(writable.map((f) => f.type))).sort()], [writable]);

  const fieldIssue = (apiName: string) => issues.find((i) => i.fieldApiName === apiName);

  if (!describe) {
    return <p className="text-[13px] text-[#A39B8E]">Loading field metadata…</p>;
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium text-[#777168]">
          Fields <span className="text-[#A39B8E]">({request.fields.length} configured)</span>
        </span>
        <Button variant="secondary" size="sm" onClick={() => { setPicked(new Set()); setPickerOpen((v) => !v); }}>
          {pickerOpen ? "Close picker" : "+ Add fields"}
        </Button>
      </div>

      {pickerOpen && (
        <div className="mb-2 rounded-lg border border-[#E8E2D8] bg-[#F8F6F0]">
          <div className="flex gap-2 p-2">
            <div className="flex-1">
              <Input placeholder="Search label or API name…" value={search} onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} aria-label="Search fields" />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] text-[#27241F] cursor-pointer"
              aria-label="Filter by type"
            >
              {types.map((t) => (
                <option key={t} value={t}>{t === "all" ? "All types" : t}</option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={picked.size === 0}
              onClick={() => {
                const fields = writable.filter((f) => picked.has(f.name));
                actions.onAddFields(request.id, fields);
                setPicked(new Set());
                setSearch("");
              }}
              title="Add selected fields"
            >
              Add{picked.size > 0 ? ` ${picked.size}` : ""}
            </Button>
          </div>
          <div className="flex items-center gap-3 px-2 pb-1.5 text-[12px]">
            <button
              type="button"
              onClick={() => setPicked(new Set(candidates.map((f) => f.name)))}
              className="font-medium text-[#A98450] hover:underline cursor-pointer"
            >
              Select all{candidates.length > 0 ? ` (${candidates.length})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              disabled={picked.size === 0}
              className="text-[#777168] hover:underline cursor-pointer disabled:opacity-40"
            >
              Clear all
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto px-2 pb-2">
            {candidates.map((f) => {
              const on = picked.has(f.name);
              const isPick = (f.type === "picklist" || f.type === "multipicklist") && (f.picklistValues ?? []).length > 0;
              const refs = f.referenceTo ?? [];
              return (
                <div
                  key={f.name}
                  onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(f.name)) n.delete(f.name); else n.add(f.name); return n; })}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors ${on ? "bg-[#211F1B] text-white" : "hover:bg-white text-[#27241F]"}`}
                  role="checkbox"
                  aria-checked={on}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      setPicked((p) => { const n = new Set(p); if (n.has(f.name)) n.delete(f.name); else n.add(f.name); return n; });
                    }
                  }}
                >
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[10px] leading-none ${
                      on ? "border-white bg-white text-[#211F1B]" : "border-[#A39B8E] text-transparent"
                    }`}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{f.label}</span>
                  <span className={`hidden truncate font-mono text-[11px] sm:inline ${on ? "text-white/60" : "text-[#A39B8E]"}`}>{f.name}</span>
                  <span className={`shrink-0 rounded border px-1 font-mono text-[10px] ${on ? "border-white/30 text-white/70" : "border-[#E8E2D8] bg-[#F8F6F0] text-[#777168]"}`}>{f.type}</span>
                  {f.type === "reference" && refs.length > 0 && (
                    <span className={`max-w-[180px] shrink-0 truncate font-mono text-[10px] ${on ? "text-white/70" : "text-[#7A5C9E]"}`} title={`References ${refs.join(", ")}`}>
                      → {refs.join(", ")}
                    </span>
                  )}
                  {isPick && (
                    <span onClick={(e) => e.stopPropagation()}>
                      <PicklistValuesButton
                        objectName={request.objectApiName}
                        objectLabel={request.displayName || request.objectLabel || request.objectApiName}
                        fieldName={f.name}
                        fieldLabel={f.label}
                        fieldType={f.type}
                        values={f.picklistValues ?? []}
                      />
                    </span>
                  )}
                </div>
              );
            })}
            {candidates.length === 0 && <p className="px-2 py-3 text-[13px] text-[#A39B8E]">No fields match.</p>}
          </div>
        </div>
      )}

      {request.fields.length === 0 && (
        <p className="rounded-lg border border-dashed border-[#E8E2D8] px-3 py-4 text-center text-[13px] text-[#A39B8E]">
          No fields yet - add the ones this request actually sends.
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-[#E8E2D8] divide-y divide-[#E8E2D8]">
        {request.fields.map((f) => {
          const meta = describe?.fields.find((x) => x.name === f.apiName);
          return (
            <FieldRow
              key={f.apiName}
              doc={doc}
              request={request}
              field={f}
              meta={meta}
              locked={requiredSet.has(f.apiName)}
              issue={fieldIssue(f.apiName)}
              actions={actions}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Key-value field row ─────────────────────────────────────────────────────

function FieldRow({
  doc,
  request,
  field,
  meta,
  locked,
  issue,
  actions,
}: {
  doc: StudioDocument;
  request: StudioRequest;
  field: StudioFieldValue;
  meta: SalesforceField | undefined;
  locked: boolean;
  issue: StudioIssue | undefined;
  actions: StudioRequestActions;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState("");
  const [linkProp, setLinkProp] = useState("id");
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const mapping = doc.mappings.find((m) => m.id === field.mappingId) ?? null;
  const pickValues = meta ? getActivePicklistValues(meta).map((p) => p.value) : [];
  const pickLabels = meta
    ? Object.fromEntries(getActivePicklistValues(meta).map((p) => [p.value, p.label]))
    : undefined;
  const refTargets = meta?.referenceTo ?? [];
  const isPicklist = (field.fieldType === "picklist" || field.fieldType === "multipicklist") && pickValues.length > 0;
  const sourceReq = mapping ? doc.requests.find((r) => r.id === mapping.sourceRequestId) : undefined;
  const expr = mapping && sourceReq ? `@{${sourceReq.referenceId}.${mapping.sourceProperty}}` : null;

  const priors = doc.requests.filter((r) => r.id !== request.id && r.referenceId !== "");
  // Prefer earlier requests (legal targets) but allow any - validation flags order.
  const orderedPriors = useMemo(() => {
    const idx = new Map(doc.requests.map((r, i) => [r.id, i] as const));
    const me = idx.get(request.id) ?? 0;
    return [...priors].sort((a, b) => {
      const ai = idx.get(a.id) ?? 0, bi = idx.get(b.id) ?? 0;
      const aOk = ai < me ? 0 : 1, bOk = bi < me ? 0 : 1;
      return aOk - bOk || ai - bi;
    });
  }, [doc.requests, priors, request.id]);
  // Type-aware: requests whose object matches the destination referenceTo
  // come first under their own group; the rest stay reachable below.
  const matchedPriors = refTargets.length === 0
    ? orderedPriors
    : orderedPriors.filter((sr) => sr.objectApiName !== "" && refTargets.includes(sr.objectApiName));
  const otherPriors = refTargets.length === 0
    ? []
    : orderedPriors.filter((sr) => !(sr.objectApiName !== "" && refTargets.includes(sr.objectApiName)));
  const priorOption = (sr: StudioRequest) => (
    <option key={sr.id} value={sr.id}>
      @{sr.referenceId} · {sr.displayName || sr.objectLabel || sr.objectApiName}
    </option>
  );

  // Suggest a source whose object matches the describe referenceTo, if known.

  return (
    <div className="bg-white px-3 py-2">
      <div className="grid items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-[#27241F]">{field.fieldLabel}</span>
            <span className="rounded border border-[#E8E2D8] bg-[#F8F6F0] px-1 font-mono text-[10px] text-[#777168]">{field.fieldType}</span>
            {field.fieldType === "reference" && refTargets.length > 0 && (
              <Badge color="purple">→ {refTargets.join(", ")}</Badge>
            )}
            {isPicklist && meta && (
              <PicklistValuesButton
                objectName={request.objectApiName}
                objectLabel={request.displayName || request.objectLabel || request.objectApiName}
                fieldName={field.apiName}
                fieldLabel={field.fieldLabel}
                fieldType={field.fieldType}
                values={meta.picklistValues ?? []}
              />
            )}
            {locked && <Badge variant="error">Required</Badge>}
            {mapping && <Badge variant="success">⬦ link</Badge>}
          </div>
          <p className="truncate font-mono text-[11px] text-[#A39B8E]">{field.apiName}</p>
          {issue && <p className={`mt-0.5 text-[11px] ${issue.level === "error" ? "text-[#B84C42]" : "text-[#B98335]"}`}>{issue.message}</p>}
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="min-w-0 flex-1">
            {field.mode === "reference" ? (
              <span className="block truncate rounded-lg border border-[#D8C7A9] bg-[#F5F1E8] px-2.5 py-1.5 font-mono text-[13px] text-[#A98450]" title={expr ?? "Broken link"}>
                {expr ?? "⚠ missing source"}
              </span>
            ) : field.mode === "null" ? (
              <span className="inline-block rounded-lg border border-[#E8E2D8] bg-[#F8F6F0] px-2.5 py-1.5 font-mono text-[13px] text-[#A39B8E]">null</span>
            ) : (
              <LiteralInput field={field} pickValues={pickValues} pickLabels={pickLabels} onChange={(v) => actions.onSetLiteral(request.id, field.apiName, v)} />
            )}
          </div>
          <select
            value={field.mode}
            onChange={(e) => {
              const mode = e.target.value as FieldMode;
              // Ref applies instantly (missing-source chip shows) and the
              // linker opens for completion; any other choice closes it.
              // Canceling the linker reverts to Text.
              if (mode === "reference") {
                actions.onSetMode(request.id, field.apiName, "reference");
                setLinkOpen(true);
                return;
              }
              setLinkOpen(false);
              actions.onSetMode(request.id, field.apiName, mode);
            }}
            className="shrink-0 cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-1.5 py-1.5 text-[11px] font-medium text-[#777168]"
            aria-label={`Value mode for ${field.apiName}`}
            title="Literal · Reference · Null"
          >
            <option value="literal">Text</option>
            <option value="reference">Ref</option>
            <option value="null">Null</option>
          </select>
          {locked ? (
            <span
              className="shrink-0 rounded-md p-1.5 leading-none text-[#A98450]"
              title="Required field - cannot be removed"
              aria-label={`${field.apiName} is required and cannot be removed`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <rect x="4" y="10" width="16" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
            </span>
          ) : (
            <button
              onClick={() => actions.onRemoveField(request.id, field.apiName)}
              aria-label={`Remove ${field.apiName}`}
              className="shrink-0 rounded-md p-1.5 text-[13px] leading-none text-[#A39B8E] hover:text-[#B84C42] hover:bg-red-50 transition-colors cursor-pointer"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Linker popover (inline) */}
      {linkOpen && (
        <div className="mt-2 rounded-lg border border-[#D8C7A9] bg-[#F5F1E8] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-[#A98450]">
            Link {field.apiName}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-0.5 block text-[11px] text-[#777168]">Source request</span>
              <select
                value={linkTarget}
                onChange={(e) => setLinkTarget(e.target.value)}
                className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] cursor-pointer"
              >
                <option value="">Choose…</option>
                {matchedPriors.length > 0 && (
                  <optgroup label={refTargets.length > 0 ? `Matching ${refTargets.join(", ")}` : "Requests"}>
                    {matchedPriors.map(priorOption)}
                  </optgroup>
                )}
                {otherPriors.length > 0 && (
                  <optgroup label="Other requests">
                    {otherPriors.map(priorOption)}
                  </optgroup>
                )}
              </select>
              {refTargets.length > 0 && matchedPriors.length === 0 && (
                <p className="mt-1 text-[11px] text-[#B98335]">
                  No {refTargets.join(", ")} request yet - add one, or pick below and fix the order later.
                </p>
              )}
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] text-[#777168]">Source property</span>
              <input
                value={linkProp}
                onChange={(e) => setLinkProp(e.target.value)}
                placeholder="id"
                className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 font-mono text-[13px] focus:border-[#A98450] focus:outline-none"
              />
            </label>
          </div>
          {linkTarget !== "" && (
            <p className="mt-1.5 font-mono text-xs text-[#A98450]">
              → @{doc.requests.find((r) => r.id === linkTarget)?.referenceId}.{linkProp || "id"}
            </p>
          )}
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" disabled={linkTarget === ""} onClick={() => {
              actions.onCreateMapping(request.id, field.apiName, linkTarget, linkProp.trim() || "id");
              setLinkOpen(false);
              setLinkTarget("");
              setLinkProp("id");
            }}>
              Apply link
            </Button>
            <Button variant="ghost" size="sm" onClick={() => {
              // Canceling reverts to Text - no half-linked state lingers.
              actions.onSetMode(request.id, field.apiName, "literal");
              setLinkOpen(false);
            }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Unlink confirm */}
      {mapping && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#777168]">
          <span>
            Linked from <span className="font-mono">@{sourceReq?.referenceId}.{mapping.sourceProperty}</span>
          </span>
          {!confirmUnlink ? (
            <button onClick={() => setConfirmUnlink(true)} className="text-[#B84C42] hover:underline cursor-pointer">
              Remove link
            </button>
          ) : (
            <span className="flex gap-1.5">
              <button onClick={() => { actions.onRemoveMapping(mapping.id, true); setConfirmUnlink(false); }} className="rounded border border-[#E8E2D8] bg-white px-1.5 py-0.5 hover:border-[#B84C42] hover:text-[#B84C42] cursor-pointer">
                Clear value
              </button>
              <button onClick={() => { actions.onRemoveMapping(mapping.id, false); setConfirmUnlink(false); }} className="rounded border border-[#E8E2D8] bg-white px-1.5 py-0.5 hover:border-[#B84C42] hover:text-[#B84C42] cursor-pointer">
                Keep as text
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Literal value input by Salesforce type ──────────────────────────────────

function LiteralInput({ field, pickValues, pickLabels, onChange }: { field: StudioFieldValue; pickValues: string[]; pickLabels?: Record<string, string>; onChange: (v: unknown) => void }) {
  const cls =
    "w-full rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[13px] text-[#27241F] placeholder-[#A39B8E] focus:border-[#A98450] focus:outline-none font-mono";
  const str = field.literal === undefined || field.literal === null ? "" : String(field.literal);
  const t = field.fieldType;

  if ((t === "picklist" || t === "multipicklist") && pickValues.length > 0) {
    return (
      <PicklistDropdown
        values={pickValues}
        value={str}
        multiple={t === "multipicklist"}
        ariaLabel={`Pick value for ${field.apiName}`}
        labels={pickLabels}
        onChange={(v) => onChange(v)}
      />
    );
  }

  // NOTE: editorType comes from describe metadata via the picker's stored
  // fieldType string; keep the mapping local and conservative.
  if (t === "boolean") {
    const on = field.literal === true || field.literal === "true";
    return (
      <div className="flex rounded-lg border border-[#E8E2D8] overflow-hidden w-fit" role="group" aria-label="Boolean value">
        {[{ v: true, l: "true" }, { v: false, l: "false" }].map((o) => (
          <button
            key={o.l}
            onClick={() => onChange(o.v)}
            aria-pressed={on === o.v}
            className={`px-3 py-1.5 font-mono text-[13px] transition-colors cursor-pointer ${on === o.v ? "bg-[#211F1B] text-white" : "bg-white text-[#777168] hover:text-[#27241F]"}`}
          >
            {o.l}
          </button>
        ))}
      </div>
    );
  }
  if (t === "int" || t === "double" || t === "currency" || t === "percent") {
    return <input type="number" value={str} onChange={(e) => onChange(e.target.value)} className={cls} step={t === "int" ? "1" : "0.01"} />;
  }
  if (t === "date") {
    return <input type="date" value={str} onChange={(e) => onChange(e.target.value)} className={cls} />;
  }
  if (t === "datetime") {
    return <input type="datetime-local" value={str} onChange={(e) => onChange(e.target.value)} className={cls} />;
  }
  if (t === "textarea" || t === "longtextarea" || (t === "string" && str.length > 80)) {
    return <textarea value={str} onChange={(e) => onChange(e.target.value)} rows={2} className={`${cls} resize-y`} />;
  }
  return <input type="text" value={str} onChange={(e) => onChange(e.target.value)} className={cls} />;
}
