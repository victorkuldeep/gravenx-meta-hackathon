"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import type {
  SalesforceObject,
  SalesforceDescribeResult,
  SalesforceField,
  TestRequestResult,
} from "@/lib/salesforce/types";
import {
  getGraphQLFields,
  defaultGraphQLSelection,
  fieldNeedsValueSubselect,
  buildGraphQLQueryMulti,
  MAX_BLOCKS,
  graphqlEndpoint,
  buildGraphQLCurl,
  type QueryBlock,
  type QueryNode,
} from "@/lib/graphql/builder";
import { rankObjects } from "@/lib/search/rank";
import { isSessionExpiredMessage } from "@/lib/salesforce/client";
import { apiFetch } from "@/lib/api";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import Input from "./ui/Input";
import CodeBlock from "./ui/CodeBlock";
import { PicklistValuesButton } from "./PicklistValuesButton";
import { CollectionTrayButton } from "./CollectionTrayButton";

interface GraphQLPanelProps {
  objects: SalesforceObject[];
  instanceUrl: string;
  apiVersion: string;
  getToken: () => string;
  onAddToCollection: (item: NewCollectionItem) => void;
  collectionCount: number;
  onOpenCollection: () => void;
  onSessionExpired?: () => void;
}

interface NestedSel {
  target: string;
  fields: string[];
  first: string;
}

interface BlockState {
  id: string;
  objectName: string;
  first: string;
  selected: string[];
  parents: Record<string, NestedSel>;
  childrenSel: Record<string, NestedSel>;
  open: boolean;
  showParents: boolean;
  showChildren: boolean;
}

type NewCollectionItem = {
  name: string;
  method: "POST";
  kind: "graphql";
  url: string;
  origin: string;
  body: unknown;
};

let blockSeq = 0;
const nextBlockId = () => `gql-${Date.now()}-${++blockSeq}`;

type ExportTab = "query" | "curl";

function leafNeedsValue(
  lookup: Map<string, SalesforceField>,
  name: string
): boolean {
  const f = lookup.get(name);
  if (!f) return name !== "Id";
  return fieldNeedsValueSubselect(f);
}

export default function GraphQLPanel({
  objects,
  instanceUrl,
  apiVersion,
  getToken,
  onAddToCollection,
  collectionCount,
  onOpenCollection,
  onSessionExpired,
}: GraphQLPanelProps) {
  const [blocks, setBlocks] = useState<BlockState[]>([]);
  const [describes, setDescribes] = useState<Map<string, SalesforceDescribeResult>>(new Map());
  const [addSearch, setAddSearch] = useState("");
  const [loadingMsg, setLoadingMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldFilter, setFieldFilter] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<ExportTab>("query");

  const [runLoading, setRunLoading] = useState(false);
  const [result, setResult] = useState<TestRequestResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // Synchronous mirror of the describe cache (state updaters run async,
  // so cache hits must not depend on them)
  const describesRef = useRef<Map<string, SalesforceDescribeResult>>(new Map());

  const addResults = useMemo(
    () => rankObjects(objects, addSearch, 60),
    [objects, addSearch]
  );

  const describeOf = useCallback(
    async (objectName: string): Promise<SalesforceDescribeResult> => {
      const token = getToken();
      if (!token) throw new Error("Session token is no longer available. Please reconnect.");
      const response = await apiFetch("/api/salesforce/describe", {
        instanceUrl,
        token,
        apiVersion,
        objectName,
      });
      const data = (await response.json()) as SalesforceDescribeResult & { error?: string };
      if (!response.ok) {
        const message =
          typeof (data as unknown as { error?: unknown }).error === "string"
            ? (data as unknown as { error: string }).error
            : `Describe failed for ${objectName}`;
        if (isSessionExpiredMessage(message)) onSessionExpired?.();
        throw new Error(message);
      }
      return data;
    },
    [instanceUrl, apiVersion, getToken, onSessionExpired]
  );

  const mergeDescribe = useCallback((d: SalesforceDescribeResult) => {
    describesRef.current.set(d.name, d);
    setDescribes((prev) => {
      if (prev.has(d.name)) return prev;
      const next = new Map(prev);
      next.set(d.name, d);
      return next;
    });
  }, []);

  const updateBlock = useCallback((id: string, patch: Partial<BlockState>) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const addBlock = useCallback(
    async (obj: SalesforceObject) => {
      if (blocks.length >= MAX_BLOCKS) {
        setNotice(`At most ${MAX_BLOCKS} objects per query - remove one first.`);
        return;
      }
      if (blocks.some((b) => b.objectName === obj.name)) {
        setNotice(`${obj.name} is already in this query.`);
        return;
      }
      setLoadError(null);
      setNotice(null);
      setLoadingMsg(`Loading ${obj.name} fields…`);
      try {
        const d = await describeOf(obj.name);
        mergeDescribe(d);
        setBlocks((prev) => [
          ...prev,
          {
            id: nextBlockId(),
            objectName: d.name,
            first: "10",
            selected: defaultGraphQLSelection(d.fields),
            parents: {},
            childrenSel: {},
            open: true,
            showParents: false,
            showChildren: false,
          },
        ]);
        setAddSearch("");
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load object");
      } finally {
        setLoadingMsg(null);
      }
    },
    [blocks, describeOf, mergeDescribe]
  );

  const removeBlock = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setResult(null);
  }, []);

  const toggleLeaf = useCallback(
    (id: string, name: string) => {
      setBlocks((prev) =>
        prev.map((b) =>
          b.id !== id
            ? b
            : {
                ...b,
                selected: b.selected.includes(name)
                  ? b.selected.filter((n) => n !== name)
                  : [...b.selected, name],
              }
        )
      );
      setResult(null);
    },
    []
  );

  const ensureTarget = useCallback(
    async (target: string): Promise<SalesforceDescribeResult | null> => {
      const hit = describesRef.current.get(target);
      if (hit) return hit;
      setLoadingMsg(`Loading ${target} fields…`);
      try {
        const d = await describeOf(target);
        mergeDescribe(d);
        return d;
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : `Failed to load ${target}`);
        return null;
      } finally {
        setLoadingMsg(null);
      }
    },
    [describeOf, mergeDescribe]
  );

  const toggleParent = useCallback(
    async (block: BlockState, relation: string, target: string) => {
      if (block.parents[relation]) {
        const next = { ...block.parents };
        delete next[relation];
        updateBlock(block.id, { parents: next });
        setResult(null);
        return;
      }
      const d = await ensureTarget(target);
      if (!d) return;
      const leaves = getGraphQLFields(d.fields)
        .filter((f) => f.name === "Id" || f.name === "Name")
        .map((f) => f.name);
      updateBlock(block.id, {
        parents: {
          ...block.parents,
          [relation]: {
            target,
            fields: leaves.length > 0 ? leaves : getGraphQLFields(d.fields).slice(0, 3).map((f) => f.name),
            first: "10",
          },
        },
      });
      setResult(null);
    },
    [ensureTarget, updateBlock]
  );

  const toggleParentLeaf = useCallback(
    (block: BlockState, relation: string, name: string) => {
      const cur = block.parents[relation];
      if (!cur) return;
      const fields = cur.fields.includes(name)
        ? cur.fields.filter((n) => n !== name)
        : [...cur.fields, name];
      updateBlock(block.id, { parents: { ...block.parents, [relation]: { ...cur, fields } } });
      setResult(null);
    },
    [updateBlock]
  );

  const toggleChild = useCallback(
    async (block: BlockState, relation: string, target: string) => {
      if (block.childrenSel[relation]) {
        const next = { ...block.childrenSel };
        delete next[relation];
        updateBlock(block.id, { childrenSel: next });
        setResult(null);
        return;
      }
      const d = await ensureTarget(target);
      if (!d) return;
      updateBlock(block.id, {
        childrenSel: {
          ...block.childrenSel,
          [relation]: {
            target,
            fields: defaultGraphQLSelection(d.fields),
            first: "5",
          },
        },
      });
      setResult(null);
    },
    [ensureTarget, updateBlock]
  );

  const toggleChildLeaf = useCallback(
    (block: BlockState, relation: string, name: string) => {
      const cur = block.childrenSel[relation];
      if (!cur) return;
      const fields = cur.fields.includes(name)
        ? cur.fields.filter((n) => n !== name)
        : [...cur.fields, name];
      updateBlock(block.id, { childrenSel: { ...block.childrenSel, [relation]: { ...cur, fields } } });
      setResult(null);
    },
    [updateBlock]
  );

  const query = useMemo(() => {
    if (blocks.length === 0) return "";
    try {
      const qb: QueryBlock[] = [];
      for (const b of blocks) {
        const d = describes.get(b.objectName);
        if (!d) continue;
        const byName = new Map(d.fields.map((f) => [f.name, f]));
        const nodes: QueryNode[] = [];
        for (const name of b.selected) {
          nodes.push({ kind: "leaf", name, needsValue: leafNeedsValue(byName, name) });
        }
        for (const [relation, sel] of Object.entries(b.parents)) {
          if (sel.fields.length === 0) continue;
          const td = describes.get(sel.target);
          const tByName = new Map((td?.fields ?? []).map((f) => [f.name, f]));
          nodes.push({
            kind: "parent",
            relation,
            fields: sel.fields.map((name) => ({ kind: "leaf" as const, name, needsValue: leafNeedsValue(tByName, name) })),
          });
        }
        for (const [relation, sel] of Object.entries(b.childrenSel)) {
          if (sel.fields.length === 0) continue;
          const td = describes.get(sel.target);
          const tByName = new Map((td?.fields ?? []).map((f) => [f.name, f]));
          nodes.push({
            kind: "child",
            relation,
            first: parseInt(sel.first, 10) || 5,
            fields: sel.fields.map((name) => ({ kind: "leaf" as const, name, needsValue: leafNeedsValue(tByName, name) })),
          });
        }
        if (nodes.length === 0) continue;
        qb.push({ objectName: b.objectName, first: parseInt(b.first, 10) || 10, nodes });
      }
      if (qb.length === 0) return "";
      return buildGraphQLQueryMulti(qb);
    } catch {
      return "";
    }
  }, [blocks, describes]);

  const endpoint = graphqlEndpoint(instanceUrl, apiVersion);
  const curl = query ? buildGraphQLCurl(endpoint, query) : "";

  const handleRun = async () => {
    if (!query) return;
    const token = getToken();
    if (!token) {
      setRunError("Session token is no longer available. Please reconnect.");
      return;
    }
    setRunLoading(true);
    setRunError(null);
    setResult(null);
    try {
      const response = await apiFetch("/api/salesforce/graphql", { instanceUrl, token, apiVersion, query });
      const data = (await response.json()) as TestRequestResult & { error?: unknown };
      if (!response.ok || data.error) {
        const message = typeof data.error === "string" ? data.error : "GraphQL request failed";
        setRunError(message);
        if (isSessionExpiredMessage(message)) onSessionExpired?.();
      } else {
        setResult(data);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      setRunError(message);
      if (isSessionExpiredMessage(message)) onSessionExpired?.();
    } finally {
      setRunLoading(false);
    }
  };

  const blockCount = blocks.length;

  return (
    <div className="arch-card overflow-hidden">
      <div className="arch-card__head px-4 py-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ivory-950">GraphQL Query Engine</h2>
        <Badge variant="info">Read-only</Badge>
        {blockCount > 0 && (
          <span className="text-[11px] text-ivory-600">
            {blockCount} object{blockCount === 1 ? "" : "s"} · one round trip
          </span>
        )}
        <span className="text-[11px] text-ivory-600">
          All fields except Id are selected as {"{ value }"}.
        </span>
      </div>

      <div className="grid gap-0 lg:grid-cols-2">
        {/* Left: blocks */}
        <div className="border-b lg:border-b-0 lg:border-r border-[var(--color-line-soft)] p-4 space-y-3">
          <div>
            <Input
              label={blockCount === 0 ? "Add your first object" : "Add another object (up to 10)"}
              placeholder="Search objects - Account, Contact, Lead…"
              value={addSearch}
              onChange={(e) => setAddSearch(e.target.value)}
              aria-label="Add object to query"
            />
            {addSearch.trim() && (
              <div className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-[var(--color-line)] divide-y divide-[var(--color-line-soft)]" role="listbox" aria-label="Matching objects">
                {addResults.length === 0 ? (
                  <p className="p-3 text-xs text-ivory-600">No objects match.</p>
                ) : (
                  addResults.map((o) => {
                    const added = blocks.some((b) => b.objectName === o.name);
                    return (
                      <button
                        key={o.name}
                        role="option"
                        aria-selected={added}
                        onClick={() => void addBlock(o)}
                        disabled={added}
                        className="w-full px-3 py-2 text-left transition-colors cursor-pointer hover:bg-ivory-300 disabled:opacity-50"
                      >
                        <span className="block truncate text-xs font-medium text-ivory-950">
                          {o.label} {added && <span className="text-bronze-600">· added</span>}
                        </span>
                        <span className="block truncate text-[11px] font-mono text-ivory-600">{o.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {loadingMsg && <p className="text-xs text-bronze-600" role="status">{loadingMsg}</p>}
          {loadError && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
              {loadError}
            </div>
          )}
          {notice && <p className="text-xs text-ivory-700">{notice}</p>}

          {blocks.length === 0 && !addSearch.trim() && (
            <div className="rounded-lg border border-dashed border-[var(--color-line)] p-6 text-center text-xs text-ivory-600">
              Add up to {MAX_BLOCKS} objects - each becomes a block in one query.
              Expand parents and child lists for single-round-trip graphs.
            </div>
          )}

          <div className="space-y-3">
            {blocks.map((b) => {
              const d = describes.get(b.objectName);
              const queryable = d ? getGraphQLFields(d.fields) : [];
              const filter = (fieldFilter[b.id] ?? "").toLowerCase().trim();
              const visible = !filter
                ? queryable
                : queryable.filter(
                    (f) =>
                      f.label.toLowerCase().includes(filter) ||
                      f.name.toLowerCase().includes(filter)
                  );
              const parents = (d?.fields ?? []).filter(
                (f) => f.type === "reference" && f.relationshipName && (f.referenceTo ?? []).length > 0
              );
              const kids = (d?.childRelationships ?? []).filter((r) => r.relationshipName);
              return (
                <div key={b.id} className="rounded-xl border border-[var(--color-line)] overflow-hidden">
                  <div className="flex items-center gap-2 bg-[var(--color-surface-soft)] px-3 py-2">
                    <button
                      type="button"
                      onClick={() => updateBlock(b.id, { open: !b.open })}
                      aria-expanded={b.open}
                      title={b.open ? "Collapse this object" : "Expand this object"}
                      className="rounded p-1 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer shrink-0"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className={`transition-transform ${b.open ? "" : "-rotate-90"}`}>
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateBlock(b.id, { open: !b.open })}
                      aria-expanded={b.open}
                      className="min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <span className="block truncate text-xs font-bold text-ivory-950">
                        {d?.label ?? b.objectName}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-ivory-600">
                        {b.objectName} · {b.selected.length} fields
                        {Object.keys(b.parents).length > 0 && ` · ${Object.keys(b.parents).length} parent${Object.keys(b.parents).length === 1 ? "" : "s"}`}
                        {Object.keys(b.childrenSel).length > 0 && ` · ${Object.keys(b.childrenSel).length} child list${Object.keys(b.childrenSel).length === 1 ? "" : "s"}`}
                      </span>
                    </button>
                    <label className="flex items-center gap-1 text-[11px] text-ivory-700" title="Records for this object">
                      ×
                      <input
                        type="number"
                        min={1}
                        max={2000}
                        value={b.first}
                        onChange={(e) => {
                          updateBlock(b.id, { first: e.target.value });
                          setResult(null);
                        }}
                        className="w-14 rounded border border-ivory-400 bg-white px-1.5 py-1 text-[11px] font-mono text-ivory-950 focus:border-bronze-500 focus:outline-none"
                        aria-label={`Record limit for ${b.objectName}`}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeBlock(b.id)}
                      aria-label={`Remove ${b.objectName} from query`}
                      className="rounded p-1 text-ivory-500 hover:text-red-700 hover:bg-red-500/10 cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>

                  {b.open && d && (
                    <div className="p-3 space-y-3">
                      <Input
                        placeholder="Filter fields…"
                        value={fieldFilter[b.id] ?? ""}
                        onChange={(e) => setFieldFilter((p) => ({ ...p, [b.id]: e.target.value }))}
                        aria-label={`Filter ${b.objectName} fields`}
                      />
                      <div className="max-h-52 overflow-y-auto rounded-lg border border-[var(--color-line)] divide-y divide-[var(--color-line-soft)]">
                        {visible.map((f) => (
                          <label
                            key={f.name}
                            className={`flex cursor-pointer items-center gap-2.5 px-3 py-1.5 transition-colors hover:bg-ivory-300 ${
                              b.selected.includes(f.name) ? "bg-ivory-200" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={b.selected.includes(f.name)}
                              onChange={() => toggleLeaf(b.id, f.name)}
                              className="h-4 w-4 shrink-0 rounded border-ivory-400 bg-white text-bronze-600 focus:ring-bronze-500"
                              aria-label={`Select field ${f.label}`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium text-ivory-950">{f.label}</span>
                              <span className="block truncate text-[11px] font-mono text-ivory-600">{f.name}</span>
                            </span>
                            <Badge variant="default">{f.type}</Badge>
                            {(f.type === "picklist" || f.type === "multipicklist") &&
                              (f.picklistValues ?? []).length > 0 && (
                                <PicklistValuesButton
                                  objectName={b.objectName}
                                  objectLabel={d.label}
                                  fieldName={f.name}
                                  fieldLabel={f.label}
                                  fieldType={f.type}
                                  values={f.picklistValues ?? []}
                                />
                              )}
                          </label>
                        ))}
                        {visible.length === 0 && (
                          <p className="p-3 text-xs text-ivory-600">No fields match.</p>
                        )}
                      </div>

                      {/* Parent traversals */}
                      {parents.length > 0 && (
                        <div>
                          <button
                            type="button"
                            onClick={() => updateBlock(b.id, { showParents: !b.showParents })}
                            aria-expanded={b.showParents}
                            className="text-xs font-semibold text-ivory-900 hover:text-bronze-600 cursor-pointer"
                          >
                            {b.showParents ? "▾" : "▸"} Parent lookups ({parents.length})
                          </button>
                          {b.showParents && (
                            <div className="mt-1.5 space-y-2 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] p-2">
                              {parents.map((f) => {
                                const rel = f.relationshipName as string;
                                const target = (f.referenceTo ?? [])[0];
                                const active = !!b.parents[rel];
                                const td = describes.get(target);
                                const targetLeaves = td ? getGraphQLFields(td.fields) : [];
                                return (
                                  <div key={rel} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-2">
                                    <label className="flex cursor-pointer items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={active}
                                        onChange={() => void toggleParent(b, rel, target)}
                                        className="h-4 w-4 shrink-0 rounded border-ivory-400 bg-white text-bronze-600 focus:ring-bronze-500"
                                      />
                                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold text-ivory-950" title={`${f.name} → ${target}`}>
                                        {rel} <span className="font-normal text-ivory-500">({f.name} → {target})</span>
                                      </span>
                                    </label>
                                    {active && (
                                      <div className="mt-1.5 ml-6 max-h-36 space-y-0.5 overflow-y-auto">
                                        {!td ? (
                                          <p className="text-[11px] text-ivory-500">Loading {target}…</p>
                                        ) : (
                                          targetLeaves.slice(0, 40).map((lf) => (
                                            <label key={lf.name} className="flex cursor-pointer items-center gap-2 text-[11px] hover:text-ivory-950 text-ivory-700">
                                              <input
                                                type="checkbox"
                                                checked={(b.parents[rel]?.fields ?? []).includes(lf.name)}
                                                onChange={() => toggleParentLeaf(b, rel, lf.name)}
                                                className="h-3.5 w-3.5 rounded border-ivory-400 text-bronze-600"
                                              />
                                              <span className="truncate font-mono">{lf.name}</span>
                                            </label>
                                          ))
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Child lists */}
                      {kids.length > 0 && (
                        <div>
                          <button
                            type="button"
                            onClick={() => updateBlock(b.id, { showChildren: !b.showChildren })}
                            aria-expanded={b.showChildren}
                            className="text-xs font-semibold text-ivory-900 hover:text-bronze-600 cursor-pointer"
                          >
                            {b.showChildren ? "▾" : "▸"} Child lists ({kids.length})
                          </button>
                          {b.showChildren && (
                            <div className="mt-1.5 space-y-2 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] p-2">
                              {kids.slice(0, 60).map((r) => {
                                const rel = r.relationshipName as string;
                                const active = !!b.childrenSel[rel];
                                const td = describes.get(r.childSObject);
                                const targetLeaves = td ? getGraphQLFields(td.fields) : [];
                                return (
                                  <div key={rel} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-2">
                                    <div className="flex items-center gap-2">
                                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={active}
                                          onChange={() => void toggleChild(b, rel, r.childSObject)}
                                          className="h-4 w-4 shrink-0 rounded border-ivory-400 bg-white text-bronze-600 focus:ring-bronze-500"
                                        />
                                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold text-ivory-950" title={`${r.childSObject}.${r.field}`}>
                                          {rel} <span className="font-normal text-ivory-500">({r.childSObject})</span>
                                        </span>
                                      </label>
                                      {active && (
                                        <label className="flex shrink-0 items-center gap-1 text-[10px] text-ivory-600">
                                          ×
                                          <input
                                            type="number"
                                            min={1}
                                            max={2000}
                                            value={b.childrenSel[rel]?.first ?? "5"}
                                            onChange={(e) => {
                                              const cur = b.childrenSel[rel];
                                              if (!cur) return;
                                              updateBlock(b.id, {
                                                childrenSel: { ...b.childrenSel, [rel]: { ...cur, first: e.target.value } },
                                              });
                                              setResult(null);
                                            }}
                                            className="w-12 rounded border border-ivory-400 bg-white px-1 py-0.5 font-mono text-[10px] text-ivory-950 focus:border-bronze-500 focus:outline-none"
                                            aria-label={`Record limit for ${rel}`}
                                          />
                                        </label>
                                      )}
                                    </div>
                                    {active && (
                                      <div className="mt-1.5 ml-6 max-h-36 space-y-0.5 overflow-y-auto">
                                        {!td ? (
                                          <p className="text-[11px] text-ivory-500">Loading {r.childSObject}…</p>
                                        ) : (
                                          targetLeaves.slice(0, 40).map((lf) => (
                                            <label key={lf.name} className="flex cursor-pointer items-center gap-2 text-[11px] hover:text-ivory-950 text-ivory-700">
                                              <input
                                                type="checkbox"
                                                checked={(b.childrenSel[rel]?.fields ?? []).includes(lf.name)}
                                                onChange={() => toggleChildLeaf(b, rel, lf.name)}
                                                className="h-3.5 w-3.5 rounded border-ivory-400 text-bronze-600"
                                              />
                                              <span className="truncate font-mono">{lf.name}</span>
                                            </label>
                                          ))
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              {kids.length > 60 && (
                                <p className="text-[11px] text-ivory-500">Showing 60 of {kids.length} child lists.</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: preview + run */}
        <div className="p-4 space-y-4">
          <div className="flex rounded-lg border border-[var(--color-line)] overflow-hidden w-fit text-xs font-medium" role="tablist" aria-label="GraphQL export format">
            {(["query", "curl"] as ExportTab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={activeTab === t}
                onClick={() => setActiveTab(t)}
                className={`px-4 py-1.5 transition-colors cursor-pointer ${
                  activeTab === t ? "bg-ivory-950 text-ivory-100" : "bg-[var(--color-surface)] text-ivory-700 hover:text-ivory-950"
                }`}
              >
                {t === "query" ? "Query" : "cURL"}
              </button>
            ))}
          </div>

          {query ? (
            <CodeBlock
              code={activeTab === "query" ? query : curl}
              language={activeTab === "query" ? "graphql" : "bash"}
              maxHeight="320px"
            />
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--color-line)] p-6 text-center text-xs text-ivory-600">
              Add an object and pick fields - parents and child lists nest into the same query.
            </div>
          )}

          <p className="font-mono text-[11px] text-ivory-600 break-all">
            POST {endpoint}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleRun} loading={runLoading} disabled={!query || runLoading}>
              Run Query
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (!query) return;
                const names = blocks.map((b) => b.objectName);
                onAddToCollection({
                  name: names.length > 1 ? `GraphQL - ${names.length} objects` : `GraphQL - ${names[0] ?? "query"}`,
                  method: "POST",
                  kind: "graphql",
                  url: endpoint,
                  origin: instanceUrl,
                  body: { query },
                });
              }}
              disabled={!query}
              title="Stage this query in the collection for bulk Postman export"
            >
              + Collection
            </Button>
            <CollectionTrayButton count={collectionCount} onOpen={onOpenCollection} />
          </div>

          {runError && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700" role="alert">
              {runError}
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className={`text-sm font-bold ${result.success ? "text-green-700" : "text-red-600"}`}>
                  {result.status} {result.statusText}
                </span>
                <span className="text-xs text-ivory-600">{result.responseTime}ms</span>
              </div>
              {result.body !== null && result.body !== undefined && (
                <CodeBlock
                  code={typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2)}
                  language="json"
                  maxHeight="320px"
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
