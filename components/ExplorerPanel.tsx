"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { isSessionExpiredMessage } from "@/lib/salesforce/client";
import type { SalesforceDescribeResult, SalesforceObject } from "@/lib/salesforce/types";
import { bigObjectScanQuery, classifyObject, mergeBigObjects, OBJECT_KINDS, type BigObjectCandidate, type ObjectKind } from "@/lib/salesforce/objectKind";
import { downloadExplorerWorkbook, fieldAuditQuery, parseAuditEnvelope, type AuditEnvelope, type FieldAudit } from "@/lib/salesforce/fieldAudit";
import { objectInfoPath, parseDependencyGraph, type DepEdge } from "@/lib/salesforce/picklistDeps";
import { toolingQueryPath } from "@/lib/salesforce/picklistValues";
import { PicklistValuesButton } from "@/components/PicklistValuesButton";
import { AutomationModal } from "./erd/AutomationModal";

interface ExplorerPanelProps {
  objects: SalesforceObject[];
  loadingObjects: boolean;
  objectsError: string | null;
  instanceUrl: string;
  apiVersion: string;
  getToken: () => string;
  onSessionExpired?: () => void;
}

type KindFilter = ObjectKind | "All";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <path d={dir === "left" ? "M10 4l-4 4 4 4" : "M6 4l4 4-4 4"} />
    </svg>
  );
}

const KIND_BADGE: Record<ObjectKind, string> = {
  Standard: "border-[var(--color-line)] bg-white text-ivory-600",
  Custom: "border-bronze-300 bg-bronze-50 text-bronze-700",
  "Custom Setting": "border-sky-300 bg-sky-50 text-sky-700",
  "Custom Metadata": "border-violet-300 bg-violet-50 text-violet-700",
  "Big Object": "border-amber-300 bg-amber-50 text-amber-800",
};

/** Read-only data-model explorer: every object family in a searchable,
 *  tabular view with the same dictionary export as the ERD. */
export function ExplorerPanel({
  objects,
  loadingObjects,
  objectsError,
  instanceUrl,
  apiVersion,
  getToken,
  onSessionExpired,
}: ExplorerPanelProps) {
  const [kind, setKind] = useState<KindFilter>("All");
  const [query, setQuery] = useState("");
  const [apiNameInput, setApiNameInput] = useState("");
  const [selName, setSelName] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, SalesforceDescribeResult>>({});
  const [describeLoading, setDescribeLoading] = useState(false);
  const [describeError, setDescribeError] = useState<string | null>(null);
  const [fieldQuery, setFieldQuery] = useState("");
  const [xlsBusy, setXlsBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<"none" | "left" | "right">("none");
  const [audit, setAudit] = useState<Record<string, FieldAudit>>({});
  const [auditNote, setAuditNote] = useState<string | null>(null);
  const [depEdges, setDepEdges] = useState<DepEdge[]>([]);
  const [automationOpen, setAutomationOpen] = useState(false);

  const fetchDeps = async (objectApi: string, labels: Record<string, string>) => {
    setDepEdges([]);
    try {
      const token = getToken();
      if (!token) return;
      const response = await apiFetch("/api/salesforce/rest", {
        instanceUrl,
        token,
        scope: "org",
        method: "GET",
        path: objectInfoPath(apiVersion, objectApi),
        auth: { type: "bearer", token },
      });
      const data = (await response.json()) as {
        success?: boolean;
        body?: { fields?: Record<string, never> };
        error?: string;
      };
      if (!response.ok || data.success === false) return;
      setDepEdges(parseDependencyGraph((data.body ?? {}) as { fields?: Record<string, never> }, labels));
    } catch {
      /* dependency graph is a bonus - the table stands without it */
    }
  };
  const auditCache = useRef<Record<string, Record<string, FieldAudit>>>({});
  // Big objects are absent from global describe - scanned once from
  // EntityDefinition and merged locally. Silent when Tooling is unavailable.
  const [bigCandidates, setBigCandidates] = useState<BigObjectCandidate[]>([]);
  const bigTried = useRef(false);
  const allObjects = useMemo(() => mergeBigObjects(objects, bigCandidates), [objects, bigCandidates]);

  useEffect(() => {
    if (objects.length === 0 || bigTried.current) return;
    bigTried.current = true;
    void (async () => {
      try {
        const token = getToken();
        if (!token) return;
        const found: BigObjectCandidate[] = [];
        let path: string | null = toolingQueryPath(apiVersion, bigObjectScanQuery());
        for (let page = 0; page < 3 && path; page += 1) {
          const response = await apiFetch("/api/salesforce/rest", {
            instanceUrl,
            token,
            scope: "org",
            method: "GET",
            path,
            auth: { type: "bearer", token },
          });
          const data = (await response.json()) as {
            success?: boolean;
            body?: { records?: BigObjectCandidate[]; nextRecordsUrl?: string; done?: boolean };
          };
          if (!response.ok || data.success === false) return;
          found.push(...(data.body?.records ?? []));
          path = !data.body?.done && data.body?.nextRecordsUrl ? data.body.nextRecordsUrl : null;
        }
        setBigCandidates(found);
      } catch {
        /* Tooling unavailable - global describe list stands as is */
      }
    })();
  }, [objects, instanceUrl, apiVersion, getToken]);

  const counts = useMemo(() => {
    const m = new Map<ObjectKind, number>();
    for (const o of allObjects) {
      const k = classifyObject(o);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [allObjects]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allObjects.filter((o) => {
      if (kind !== "All" && classifyObject(o) !== kind) return false;
      if (!q) return true;
      return o.label.toLowerCase().includes(q) || o.name.toLowerCase().includes(q);
    });
  }, [allObjects, kind, query]);

  const describe = selName ? (cache[selName] ?? null) : null;

  const fetchAudit = async (objectApi: string) => {
    if (auditCache.current[objectApi]) {
      setAudit(auditCache.current[objectApi]);
      setAuditNote(null);
      return;
    }
    setAudit({});
    setAuditNote(null);
    try {
      const token = getToken();
      if (!token) return;
      const response = await apiFetch("/api/salesforce/rest", {
        instanceUrl,
        token,
        scope: "org",
        method: "GET",
        path: toolingQueryPath(apiVersion, fieldAuditQuery(objectApi)),
        auth: { type: "bearer", token },
      });
      const data = (await response.json()) as AuditEnvelope;
      if (!response.ok) throw new Error("field audit unavailable");
      const parsed = parseAuditEnvelope(data);
      auditCache.current[objectApi] = parsed;
      setAudit(parsed);
    } catch (err) {
      setAuditNote(err instanceof Error ? err.message : "field audit unavailable");
    }
  };

  const loadDescribe = async (name: string) => {
    const apiName = name.trim();
    if (!apiName) return;
    setSelName(apiName);
    setFieldQuery("");
    setDescribeError(null);
    void fetchAudit(apiName);
    if (cache[apiName]) {
      const labels: Record<string, string> = {};
      for (const f of cache[apiName].fields) labels[f.name] = f.label;
      void fetchDeps(apiName, labels);
      return;
    }
    setDescribeLoading(true);
    try {
      const response = await apiFetch("/api/salesforce/describe", {
        instanceUrl,
        token: getToken(),
        apiVersion,
        objectName: apiName,
      });
      const data = (await response.json()) as SalesforceDescribeResult & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Failed to load object details");
      setCache((prev) => ({ ...prev, [apiName]: data }));
      const labels: Record<string, string> = {};
      for (const f of data.fields) labels[f.name] = f.label;
      void fetchDeps(apiName, labels);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load object details";
      setDescribeError(message);
      if (isSessionExpiredMessage(message)) onSessionExpired?.();
    } finally {
      setDescribeLoading(false);
    }
  };

  const fields = useMemo(() => {
    const all = describe?.fields ?? [];
    const q = fieldQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (f) =>
        f.label.toLowerCase().includes(q) ||
        f.name.toLowerCase().includes(q) ||
        f.type.toLowerCase().includes(q) ||
        (f.inlineHelpText ?? "").toLowerCase().includes(q)
    );
  }, [describe, fieldQuery]);

  const lookups = useMemo(() => (describe?.fields ?? []).filter((f) => f.referenceTo.length > 0), [describe]);
  const children = useMemo(
    () => (describe?.childRelationships ?? []).filter((r) => r.relationshipName),
    [describe]
  );

  const downloadXlsx = async () => {
    if (!describe || !selName) return;
    setXlsBusy(true);
    try {
      await downloadExplorerWorkbook(describe, audit, `${selName.toLowerCase()}-dictionary.xlsx`);
    } finally {
      setXlsBusy(false);
    }
  };

  const auditedCount = describe ? describe.fields.filter((f) => audit[f.name]).length : 0;

  return (
    <div className={`grid grid-cols-1 gap-3 ${collapsed === "none" ? "lg:grid-cols-2" : "lg:grid-cols-[auto_minmax(0,1fr)]"}`}>
      {collapsed !== "none" && (
        <button
          type="button"
          onClick={() => setCollapsed("none")}
          title={collapsed === "left" ? "Expand object list" : "Expand details"}
          aria-label={collapsed === "left" ? "Expand object list" : "Expand details"}
          className="flex cursor-pointer items-center gap-1.5 self-start rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] font-semibold text-ivory-600 hover:text-ivory-950 lg:w-10 lg:flex-col lg:px-1 lg:py-3"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full border border-current" />
          <span className="lg:[writing-mode:vertical-rl]">{collapsed === "left" ? "Objects" : "Details"}</span>
          <Chevron dir={collapsed === "left" ? "right" : "left"} />
        </button>
      )}
      {collapsed !== "left" && (
      <div className="flex min-h-0 flex-col rounded-md border border-[var(--color-line)] bg-white">
        <div className="space-y-2 border-b border-[var(--color-line)] p-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Objects · {visible.length}</h3>
            <button
              type="button"
              onClick={() => setCollapsed("left")}
              title="Collapse object list"
              aria-label="Collapse object list"
              className="ml-auto rounded p-1 text-[var(--color-muted)] hover:bg-ivory-50 hover:text-ivory-950"
            >
              <Chevron dir="left" />
            </button>
          </div>
          <div className="relative">
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-muted)]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 14 14" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search objects…"
              className="w-full rounded-md border border-[var(--color-line)] bg-white py-1.5 pr-8 pl-8 text-sm"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded px-1 text-sm leading-none text-[var(--color-muted)] hover:text-ivory-950"
              >
                ×
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["All", ...OBJECT_KINDS] as KindFilter[]).map((k) => {
              const n = k === "All" ? objects.length : (counts.get(k) ?? 0);
              if (k !== "All" && n === 0) return null;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setKind(k);
                    setQuery("");
                  }}
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    kind === k
                      ? "border-ivory-950 bg-ivory-950 text-ivory-100"
                      : "border-[var(--color-line)] bg-white text-ivory-600 hover:text-ivory-950"
                  }`}
                >
                  {k} · {n}
                </button>
              );
            })}
          </div>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void loadDescribe(apiNameInput);
            }}
          >
            <input
              value={apiNameInput}
              onChange={(e) => setApiNameInput(e.target.value)}
              placeholder="Open by API name, e.g. Archive__b"
              className="min-w-0 flex-1 rounded-md border border-[var(--color-line)] bg-white px-2 py-1 font-mono text-xs"
            />
            <button
              type="submit"
              className="shrink-0 rounded-md border border-[var(--color-line)] px-2 py-1 text-xs hover:bg-ivory-50"
            >
              Open
            </button>
          </form>
        </div>
        <div className="max-h-[31rem] min-h-0 flex-1 overflow-y-auto">
          {loadingObjects ? (
            <p className="px-3 py-6 text-center text-sm text-[var(--color-muted)]">Loading objects…</p>
          ) : objectsError ? (
            <p className="px-3 py-6 text-center text-sm text-red-700">{objectsError}</p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[var(--color-muted)]">No objects match.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {visible.map((o) => {
                const k = classifyObject(o);
                return (
                  <li key={o.name}>
                    <button
                      type="button"
                      onClick={() => void loadDescribe(o.name)}
                      className={`block w-full px-3 py-1.5 text-left hover:bg-ivory-50 ${
                        selName === o.name ? "bg-ivory-100" : ""
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm">{o.label}</span>
                        <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] ${KIND_BADGE[k]}`}>
                          {k}
                        </span>
                      </span>
                      <span className="block truncate font-mono text-xs text-[var(--color-muted)]">{o.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      )}

      {collapsed !== "right" && (
      <div className="min-w-0 rounded-md border border-[var(--color-line)] bg-white p-3">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold">Details{describe ? ` · ${describe.label}` : ""}</h3>
          <button
            type="button"
            onClick={() => setCollapsed("right")}
            title="Collapse details"
            aria-label="Collapse details"
            className="ml-auto rounded p-1 text-[var(--color-muted)] hover:bg-ivory-50 hover:text-ivory-950"
          >
            <Chevron dir="right" />
          </button>
        </div>
        {!selName ? (
          <p className="px-3 py-10 text-center text-sm text-[var(--color-muted)]">
            Pick an object to see its details, fields and relationships in a searchable table.
          </p>
        ) : describeLoading && !describe ? (
          <p className="px-3 py-10 text-center text-sm text-[var(--color-muted)]">Describing {selName}…</p>
        ) : describeError && !describe ? (
          <p className="px-3 py-10 text-center text-sm text-red-700">{describeError}</p>
        ) : describe ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start gap-2 border-b border-[var(--color-line)] pb-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold">
                  {describe.label}{" "}
                  <span className={`ml-1 rounded-full border px-2 py-0.5 align-middle text-[10px] ${KIND_BADGE[classifyObject({ name: describe.name, custom: describe.custom, customSetting: describe.customSetting })]}`}>
                    {classifyObject({ name: describe.name, custom: describe.custom, customSetting: describe.customSetting })}
                  </span>
                </h3>
                <p className="mt-0.5 font-mono text-xs text-[var(--color-muted)]">{describe.name}</p>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  {describe.fields.length} fields · {lookups.length} lookups · {children.length} child relationships · audit {auditedCount}/{describe.fields.length}
                {auditNote ? ` · ${auditNote}` : ""}
                  {describe.recordTypeInfos && describe.recordTypeInfos.length > 0
                    ? ` · ${describe.recordTypeInfos.length} record types`
                    : ""}
                  {describe.custom ? " · custom" : " · standard"}
                  {describe.createable ? "" : " · read-only"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void downloadXlsx()}
                disabled={xlsBusy}
                title="Download this object as .xlsx (same dictionary format as the ERD)"
                className="rounded-md border border-[var(--color-line)] px-2.5 py-1.5 text-xs hover:bg-ivory-50 disabled:opacity-50"
              >
                {xlsBusy ? "Building…" : "Dictionary (.xlsx)"}
              </button>
              <button
                type="button"
                onClick={() => setAutomationOpen(true)}
                title="Automation on this object - triggers, flows, queues, validation, approvals (live Tooling API read)"
                className="rounded-md border border-[var(--color-line)] px-2.5 py-1.5 text-xs font-semibold hover:bg-ivory-50"
              >
                Automation
              </button>
            </div>

            <div>
              <div className="mb-1 flex items-center gap-2">
                <h4 className="text-sm font-semibold">Fields ({fields.length})</h4>
                <input
                  value={fieldQuery}
                  onChange={(e) => setFieldQuery(e.target.value)}
                  placeholder="Search fields…"
                  className="ml-auto w-52 rounded-md border border-[var(--color-line)] bg-white px-2 py-1 text-xs"
                />
              </div>
              <div className="max-h-[30rem] overflow-auto rounded-md border border-[var(--color-line)]">
                <table className="w-full min-w-[72rem] border-collapse text-xs">
                  <thead className="sticky top-0 bg-ivory-100">
                    <tr className="text-left">
                      {["Label", "API Name", "Type", "Length", "Required", "Unique", "External ID", "Reference To", "Default", "Help Text", "Created By", "Created", "Modified By", "Modified"].map((h) => (
                        <th key={h} className="whitespace-nowrap border-b border-[var(--color-line)] px-2 py-1.5 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((f) => (
                      <tr key={f.name} className="border-b border-[var(--color-line)] last:border-0 hover:bg-ivory-50">
                        <td className="max-w-[11rem] truncate px-2 py-1" title={f.label}>{f.label}</td>
                        <td className="whitespace-nowrap px-2 py-1 font-mono">{f.name}</td>
                        <td className="whitespace-nowrap px-2 py-1">
                          <span className="inline-flex items-center gap-1 font-mono">
                            {f.type}
                            {(f.type === "picklist" || f.type === "multipicklist") && f.picklistValues.length > 0 && describe && (
                              <PicklistValuesButton
                                objectName={describe.name}
                                objectLabel={describe.label}
                                fieldName={f.name}
                                fieldLabel={f.label}
                                fieldType={f.type}
                                values={f.picklistValues}
                              />
                            )}
                            {depEdges.some((e) => e.dependent === f.name) && (
                              <span
                                title={`Controlled by ${depEdges.find((e) => e.dependent === f.name)?.controllerLabel ?? "another field"}`}
                                className="rounded-full border border-violet-300 bg-violet-50 px-1.5 py-px font-sans text-[10px] font-semibold text-violet-700"
                              >
                                dependent
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 font-mono">{f.length || ""}</td>
                        <td className="whitespace-nowrap px-2 py-1">{!f.nillable && !f.defaultedOnCreate ? "Y" : "N"}</td>
                        <td className="whitespace-nowrap px-2 py-1">{f.unique ? "Y" : "N"}</td>
                        <td className="whitespace-nowrap px-2 py-1">{f.externalId ? "Y" : "N"}</td>
                        <td className="whitespace-nowrap px-2 py-1 font-mono">{f.referenceTo.join(", ")}</td>
                        <td className="max-w-[10rem] truncate px-2 py-1 font-mono" title={f.defaultValue == null ? "" : String(f.defaultValue)}>
                          {f.defaultValue == null ? "" : String(f.defaultValue)}
                        </td>
                        <td className="max-w-[15rem] truncate px-2 py-1 text-[var(--color-muted)]" title={f.inlineHelpText ?? ""}>
                          {f.inlineHelpText ?? ""}
                        </td>
                        {(() => {
                          const a = audit[f.name];
                          const who = (v: string | null | undefined) => v ?? (f.custom ? "—" : "Salesforce");
                          return (
                            <>
                              <td className="max-w-[8rem] truncate whitespace-nowrap px-2 py-1" title={who(a?.createdBy) ?? ""}>{who(a?.createdBy)}</td>
                              <td className="whitespace-nowrap px-2 py-1 font-mono">{fmtDate(a?.createdDate ?? null)}</td>
                              <td className="max-w-[8rem] truncate whitespace-nowrap px-2 py-1" title={who(a?.modifiedBy) ?? ""}>{who(a?.modifiedBy)}</td>
                              <td className="whitespace-nowrap px-2 py-1 font-mono">{fmtDate(a?.modifiedDate ?? null)}</td>
                            </>
                          );
                        })()}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <h4 className="mb-1 text-sm font-semibold">Lookups ({lookups.length})</h4>
                {lookups.length === 0 ? (
                  <p className="text-xs text-[var(--color-muted)]">No reference fields.</p>
                ) : (
                  <ul className="divide-y divide-[var(--color-line)] rounded-md border border-[var(--color-line)] text-xs">
                    {lookups.map((f) => (
                      <li key={f.name} className="flex items-center gap-2 px-2 py-1">
                        <span className="min-w-0 flex-1 truncate font-mono">
                          {f.relationshipName ?? f.name} <span className="text-[var(--color-muted)]">({f.name})</span>
                        </span>
                        <span className="shrink-0 font-mono text-[var(--color-muted)]">{f.referenceTo.join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h4 className="mb-1 text-sm font-semibold">Child relationships ({children.length})</h4>
                {children.length === 0 ? (
                  <p className="text-xs text-[var(--color-muted)]">Nothing points at this object.</p>
                ) : (
                  <ul className="divide-y divide-[var(--color-line)] rounded-md border border-[var(--color-line)] text-xs">
                    {children.map((r) => (
                      <li key={`${r.childSObject}.${r.field}`} className="flex items-center gap-2 px-2 py-1">
                        <span className="min-w-0 flex-1 truncate font-mono">{r.childSObject}</span>
                        <span className="shrink-0 text-[var(--color-muted)]">
                          via <span className="font-mono">{r.field}</span>
                          {r.cascadeDelete ? " · master-detail" : " · lookup"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {depEdges.length > 0 && (
              <div>
                <h4 className="mb-1 text-sm font-semibold">Picklist dependencies ({depEdges.length})</h4>
                <ul className="space-y-1.5">
                  {depEdges.map((e) => (
                    <li key={e.dependent} className="rounded-md border border-[var(--color-line)] text-xs">
                      <details>
                        <summary className="cursor-pointer px-2 py-1.5">
                          <span className="font-mono">{e.controllerLabel}</span>
                          <span className="text-[var(--color-muted)]"> → </span>
                          <span className="font-mono">{e.dependentLabel}</span>
                          <span className="ml-2 text-[var(--color-muted)]">{e.map.length} controller values</span>
                        </summary>
                        <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
                          {e.map.map((m) => (
                            <li key={m.controller} className="flex flex-wrap items-baseline gap-x-2 px-2 py-1">
                              <span className="shrink-0 font-mono font-semibold">{m.controller}</span>
                              <span className="text-[var(--color-muted)]">→</span>
                              <span className="min-w-0 flex-1">{m.values.join(", ")}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}
      </div>
      )}
      {describe && automationOpen && selName && (
        <AutomationModal
          key={selName}
          apiName={selName}
          label={describe.label}
          keyPrefix=""
          instanceUrl={instanceUrl}
          apiVersion={apiVersion}
          getToken={getToken}
          fields={(describe?.fields ?? []).map((f) => ({ name: f.name, label: f.label }))}
          onClose={() => setAutomationOpen(false)}
        />
      )}
    </div>
  );
}
