"use client";

import { useCallback, useMemo, useState } from "react";
import Button from "../ui/Button";
import { analyzeRow } from "@/lib/mapping/diagnostics";
import { STATUS_LABELS, type EnumValueMap, type MappingProject, type MappingRow, type MappingStatus, type SnapshotField } from "@/lib/mapping/types";

export const STATUS_STYLES: Record<MappingStatus, string> = {
  unmapped: "bg-[#F5F1E8] text-[#777168] border-[#E8E2D8]",
  mapped: "bg-[#E9F3EC] text-[#2F7D4F] border-[#BFD9C6]",
  hardcoded: "bg-[#F5EEDF] text-[#8A6A2F] border-[#DCC99A]",
  excluded: "bg-[#F5F1E8] text-[#A39B8E] border-[#E8E2D8]",
  "needs-transformation": "bg-[#F3EADB] text-[#9A5B13] border-[#E0C491]",
  "needs-decision": "bg-[#F3EADB] text-[#9A5B13] border-[#E0C491]",
  incompatible: "bg-[#F9E8E6] text-[#B3261E] border-[#E5B8B2]",
  "stale-target": "bg-[#F9E8E6] text-[#B3261E] border-[#E5B8B2]",
  invalid: "bg-[#F9E8E6] text-[#B3261E] border-[#E5B8B2]",
};

interface PendingTarget {
  objectName: string;
  field: SnapshotField;
}

/** Spreadsheet-like mapping work surface with inline row editor. */
export function MappingTable({
  project,
  selectedSource,
  onSelectSource,
  pendingTarget,
  planMismatch,
  onConfirmMap,
  constants,
  onOpenConstants,
  onMapConstant,
  onUpdateRow,
  onRemoveRow,
}: {
  project: MappingProject;
  selectedSource: string | null;
  onSelectSource: (pathId: string | null) => void;
  pendingTarget: PendingTarget | null;
  planMismatch: string | null;
  onConfirmMap: (sourcePath: string) => void;
  constants: MappingRow[];
  onOpenConstants: () => void;
  onMapConstant: (sourcePath: string, constantId: string) => void;
  onUpdateRow: (id: string, patch: Partial<MappingRow>) => void;
  onRemoveRow: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [constantId, setConstantId] = useState("");

  const rows = useMemo(() => {
    const bySource = new Map(project.mappings.map((m) => [m.sourcePath, m]));
    const leaves = project.source?.paths.filter((p) => p.kind === "scalar" || p.kind === "null") ?? [];
    return leaves.map((leaf) => ({ leaf, mapping: bySource.get(leaf.id) ?? null }));
  }, [project]);

  const rowStatus = useCallback(
    (leafId: string, mapping: MappingRow | null): MappingStatus => {
      void leafId;
      if (!mapping) return "unmapped";
      if (mapping.kind === "excluded") return "excluded";
      if (mapping.kind === "hardcoded" && !mapping.fieldName) return "hardcoded";
      return analyzeRow(project, mapping).suggested;
    },
    [project]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(({ leaf, mapping }) => {
      const st = rowStatus(leaf.id, mapping);
      if (statusFilter !== "all" && st !== statusFilter) return false;
      if (!q) return true;
      return (
        leaf.path.toLowerCase().includes(q) ||
        mapping?.objectName.toLowerCase().includes(q) ||
        mapping?.fieldName.toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, statusFilter, project]);

  const statuses = useMemo(() => {
    const set = new Set<MappingStatus>();
    rows.forEach(({ leaf, mapping }) => set.add(rowStatus(leaf.id, mapping)));
    return [...set];
  }, [rows, rowStatus]);

  const editing = project.mappings.find((m) => m.id === editingId) ?? null;

  return (
    <div className="space-y-2">
      {/* Pending map bar */}
      {selectedSource && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#A98450] bg-[#FAF3E3] px-3 py-2 text-[12px]">
          <span className="font-mono font-semibold text-[#27241F]">{selectedSource}</span>
          <span className="text-[#777168]">→</span>
          {pendingTarget ? (
            <span className="font-mono text-[#27241F]">
              {pendingTarget.objectName}.{pendingTarget.field.name}
            </span>
          ) : (
            <span className="text-[#A39B8E]">pick a field in the Salesforce explorer…</span>
          )}
          <span className="flex items-center gap-1.5 border-l border-[#E8D9BE] pl-2">
            <select
              value={constantId}
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  onOpenConstants();
                  setConstantId("");
                } else {
                  setConstantId(e.target.value);
                }
              }}
              aria-label="Map a constant instead of a Salesforce field"
              title="Map a hardcoded constant onto this source"
              className="max-w-[190px] cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1 text-[11px]"
            >
              <option value="">constant…</option>
              {constants.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.notes ?? "Unlabelled"} · {c.hardcodedValue === undefined ? "Null" : String(c.hardcodedValue)}
                </option>
              ))}
              <option value="__new__">+ New constant…</option>
            </select>
            <Button
              size="sm"
              variant="secondary"
              disabled={!constantId}
              onClick={() => {
                onMapConstant(selectedSource, constantId);
                setConstantId("");
              }}
            >
              Map constant
            </Button>
          </span>
          <span className="ml-auto flex gap-1.5">
            <Button size="sm" disabled={!pendingTarget} onClick={() => onConfirmMap(selectedSource)}>
              Confirm mapping
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onSelectSource(null)}>
              Cancel
            </Button>
          </span>
        </div>
      )}
      {selectedSource && planMismatch && (
        <p role="alert" className="rounded-xl border border-[#E0C491] bg-[#F3EADB] px-3 py-2 text-[11px] text-[#9A5B13]">
          {planMismatch}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter mappings…"
          aria-label="Filter mapping rows"
          spellCheck={false}
          className="min-w-[160px] flex-1 rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[11px]"
        >
          <option value="all">All</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <span className="font-mono text-[10px] text-[#A39B8E]">{filtered.length} rows</span>
        <Button size="sm" variant="secondary" onClick={onOpenConstants} title="Name label + value constants reusable from Guide and Grid">
          Constants{constants.length > 0 ? ` (${constants.length})` : ""}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#E8E2D8]">
        <table className="w-full min-w-[760px] border-collapse bg-white text-left text-[12px]">
          <thead>
            <tr className="border-b border-[#E8E2D8] bg-[#FAF8F2] font-mono text-[10px] uppercase tracking-wider text-[#A39B8E]">
              <th className="px-2.5 py-2 font-semibold">Status</th>
              <th className="px-2.5 py-2 font-semibold">Source path</th>
              <th className="px-2.5 py-2 font-semibold">Example</th>
              <th className="px-2.5 py-2 font-semibold">Target field</th>
              <th className="px-2.5 py-2 font-semibold">Kind</th>
              <th className="px-2.5 py-2 font-semibold"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ leaf, mapping }) => {
              const st = rowStatus(leaf.id, mapping);
              const isActive = selectedSource === leaf.id;
              return (
                <tr
                  key={leaf.id}
                  onClick={() => onSelectSource(isActive ? null : leaf.id)}
                  className={`cursor-pointer border-b border-[#F0EBE0] last:border-0 transition-colors ${
                    isActive ? "bg-[#FAF3E3]" : "hover:bg-[#FAF8F2]"
                  }`}
                >
                  <td className="px-2.5 py-1.5">
                    <span className={`whitespace-nowrap rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${STATUS_STYLES[st]}`}>
                      {STATUS_LABELS[st]}
                    </span>
                  </td>
                  <td className="max-w-[260px] truncate px-2.5 py-1.5 font-mono text-[11px] text-[#27241F]" title={leaf.path}>
                    {leaf.path}
                    <span className="ml-1 text-[10px] text-[#A39B8E]">{leaf.jsonType}</span>
                  </td>
                  <td className="max-w-[140px] truncate px-2.5 py-1.5 font-mono text-[11px] text-[#777168]" title={String(leaf.example ?? "")}>
                    {leaf.example === undefined ? <span className="text-[#C9C2B2]">Null</span> : String(leaf.example)}
                  </td>
                  <td className="max-w-[220px] truncate px-2.5 py-1.5 font-mono text-[11px] text-[#27241F]" title={mapping ? `${mapping.objectName}.${mapping.fieldName}` : ""}>
                    {mapping?.kind === "hardcoded" ? (
                      mapping.hardcodedValue === undefined || mapping.hardcodedValue === "" ? (
                        <span className="text-[#C9C2B2]">Null</span>
                      ) : (
                        <span>&quot;{String(mapping.hardcodedValue)}&quot;{mapping.notes ? ` · ${mapping.notes}` : ""}</span>
                      )
                    ) : mapping?.fieldName ? `${mapping.objectName}.${mapping.fieldName}` : mapping ? `${mapping.objectName} (no field)` : <span className="text-[#C9C2B2]">Null</span>}
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-[11px] text-[#777168]">{mapping?.kind ?? <span className="text-[#C9C2B2]">Null</span>}</td>
                  <td className="px-2.5 py-1.5 text-right">
                    {mapping && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(editingId === mapping.id ? null : mapping.id);
                        }}
                        aria-label={`Edit mapping for ${leaf.path}`}
                        className="rounded px-1.5 py-0.5 font-mono text-[11px] text-[#A98450] hover:bg-[#F5EEDF] cursor-pointer"
                      >
                        edit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2.5 py-6 text-center text-[12px] text-[#A39B8E]">
                  No rows match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Inline row editor */}
      {editing && (
        <RowEditor
          row={editing}
          project={project}
          onPatch={(patch) => onUpdateRow(editing.id, patch)}
          onRemove={() => {
            onRemoveRow(editing.id);
            setEditingId(null);
          }}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

function RowEditor({
  row,
  project,
  onPatch,
  onRemove,
  onClose,
}: {
  row: MappingRow;
  project: MappingProject;
  onPatch: (patch: Partial<MappingRow>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { diagnostics } = analyzeRow(project, row);
  return (
    <div className="rounded-xl border border-[#A98450] bg-[#FFFEFB] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate font-mono text-[12px] font-semibold text-[#27241F]">
          {row.sourcePath} → {row.objectName}.{row.fieldName || "(no field)"}
        </p>
        <button type="button" onClick={onClose} aria-label="Close row editor" className="rounded px-1.5 text-[#A39B8E] hover:text-[#27241F] cursor-pointer">
          ✕
        </button>
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Mapping kind">
        {(["direct", "hardcoded", "excluded", "enum"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onPatch({ kind: k, status: k === "excluded" ? "excluded" : row.status })}
            aria-pressed={row.kind === k}
            className={`rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer ${
              row.kind === k ? "border-[#211F1B] bg-[#211F1B] text-white" : "border-[#E8E2D8] bg-white text-[#777168] hover:text-[#27241F]"
            }`}
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPatch({ status: row.status === "needs-decision" ? "mapped" : "needs-decision" })}
          aria-pressed={row.status === "needs-decision"}
          title="Flag for a workshop decision"
          className={`rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer ${
            row.status === "needs-decision" ? "border-[#9A5B13] bg-[#F3EADB] text-[#9A5B13]" : "border-[#E8E2D8] bg-white text-[#777168] hover:text-[#27241F]"
          }`}
        >
          needs decision
        </button>
      </div>
      {row.kind === "hardcoded" && (
        <label className="mb-2 block text-[11px] text-[#777168]">
          Hardcoded value (original JSON type preserved)
          <input
            defaultValue={row.hardcodedValue === undefined ? "" : String(row.hardcodedValue)}
            onBlur={(e) => onPatch({ hardcodedValue: e.target.value })}
            placeholder='e.g. "false" (string, not boolean)'
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 font-mono text-[12px] focus:border-[#A98450] focus:outline-none"
          />
        </label>
      )}
      {row.kind === "enum" && <EnumEditor row={row} project={project} onPatch={onPatch} />}
      <label className="mb-2 block text-[11px] text-[#777168]">
        Rationale
        <input
          defaultValue={row.rationale ?? ""}
          onBlur={(e) => onPatch({ rationale: e.target.value })}
          placeholder="Why this target?"
          spellCheck={false}
          className="mt-1 w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none"
        />
      </label>
      <label className="mb-2 block text-[11px] text-[#777168]">
        Notes
        <input
          defaultValue={row.notes ?? ""}
          onBlur={(e) => onPatch({ notes: e.target.value })}
          placeholder="Workshop notes…"
          spellCheck={false}
          className="mt-1 w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none"
        />
      </label>
      {diagnostics.length > 0 && (
        <ul className="mb-2 space-y-1">
          {diagnostics.map((d) => (
            <li key={d.id} className={`rounded-lg border px-2 py-1.5 text-[11px] ${d.severity === "error" ? "border-[#E5B8B2] bg-[#F9E8E6] text-[#B3261E]" : d.severity === "warning" ? "border-[#E0C491] bg-[#F3EADB] text-[#9A5B13]" : "border-[#E8E2D8] bg-[#FAF8F2] text-[#777168]"}`}>
              {d.message}
              {d.action && <span className="block text-[10px] opacity-80">↳ {d.action}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <button type="button" onClick={onRemove} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-[#B3261E] hover:bg-[#F9E8E6] cursor-pointer">
          Clear mapping
        </button>
      </div>
    </div>
  );
}

/** Explicit source→picklist value correspondence. Nothing is auto-substituted. */
function EnumEditor({
  row,
  project,
  onPatch,
}: {
  row: MappingRow;
  project: MappingProject;
  onPatch: (patch: Partial<MappingRow>) => void;
}) {
  const field = project.sfSnapshot?.objects
    .find((o) => o.name === row.objectName)
    ?.fields.find((f) => f.name === row.fieldName);
  const active = field?.picklistValues.filter((p) => p.active) ?? [];
  const entries = row.enumMap ?? [];

  const setEntries = (next: EnumValueMap[]) => onPatch({ enumMap: next });

  return (
    <div className="mb-2 rounded-lg border border-[#F0EBE0] bg-[#FAF8F2] p-2">
      <p className="mb-1.5 text-[11px] font-semibold text-[#27241F]">
        Value mapping · {active.length > 0 ? `${active.length} active target values` : "no picklist metadata - enter target values manually"}
      </p>
      {entries.length === 0 && (
        <p className="mb-1.5 text-[11px] text-[#A39B8E]">No correspondences yet. Each source value needs an explicit target.</p>
      )}
      <ul className="space-y-1.5">
        {entries.map((e, i) => (
          <li key={i} className="flex flex-wrap items-center gap-1.5">
            <input
              defaultValue={e.sourceValue}
              onBlur={(ev) => {
                const next = [...entries];
                next[i] = { ...next[i], sourceValue: ev.target.value };
                setEntries(next);
              }}
              placeholder="source value"
              aria-label="Source value"
              spellCheck={false}
              className="w-28 rounded-md border border-[#E8E2D8] bg-white px-1.5 py-1 font-mono text-[11px] focus:border-[#A98450] focus:outline-none"
            />
            <span aria-hidden="true" className="text-[#A39B8E]">→</span>
            {active.length > 0 ? (
              <select
                value={e.targetValue}
                onChange={(ev) => {
                  const next = [...entries];
                  next[i] = { ...next[i], targetValue: ev.target.value };
                  setEntries(next);
                }}
                aria-label="Target picklist value"
                className="cursor-pointer rounded-md border border-[#E8E2D8] bg-white px-1.5 py-1 font-mono text-[11px]"
              >
                <option value="">choose…</option>
                {active.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}{p.label !== p.value ? ` (${p.value})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                defaultValue={e.targetValue}
                onBlur={(ev) => {
                  const next = [...entries];
                  next[i] = { ...next[i], targetValue: ev.target.value };
                  setEntries(next);
                }}
                placeholder="target value"
                aria-label="Target value"
                spellCheck={false}
                className="w-28 rounded-md border border-[#E8E2D8] bg-white px-1.5 py-1 font-mono text-[11px] focus:border-[#A98450] focus:outline-none"
              />
            )}
            <button
              type="button"
              onClick={() => {
                const next = [...entries];
                next[i] = { ...next[i], decided: !next[i].decided };
                setEntries(next);
              }}
              aria-pressed={e.decided}
              className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold cursor-pointer ${e.decided ? "border-[#BFD9C6] bg-[#E9F3EC] text-[#2F7D4F]" : "border-[#E8E2D8] bg-white text-[#777168]"}`}
            >
              {e.decided ? "decided" : "open"}
            </button>
            <button
              type="button"
              onClick={() => setEntries(entries.filter((_, j) => j !== i))}
              aria-label="Remove value mapping"
              className="rounded px-1 text-[#B3261E] hover:bg-[#F9E8E6] cursor-pointer"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setEntries([...entries, { sourceValue: "", targetValue: "", decided: false }])}
        className="mt-1.5 rounded-md border border-[#E8E2D8] bg-white px-2 py-1 text-[11px] font-semibold text-[#777168] hover:text-[#27241F] cursor-pointer"
      >
        + Add correspondence
      </button>
    </div>
  );
}
