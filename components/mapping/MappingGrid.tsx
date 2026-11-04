"use client";

import { useMemo, useState } from "react";
import Button from "../ui/Button";
import { analyzeRow } from "@/lib/mapping/diagnostics";
import { FREE_SOURCE_PATH, STATUS_LABELS, type MappingKind, type MappingProject, type MappingRow, type MappingStatus } from "@/lib/mapping/types";
import { snapshotTargets, validateTarget, type PasteRow } from "@/lib/mapping/grid";
import { QuickMapModal } from "./QuickMapModal";
import { STATUS_STYLES } from "./MappingTable";

type ColId = "target" | "kind" | "plan" | "constant" | "notes";
const COLS: ColId[] = ["target", "kind", "plan", "constant", "notes"];

interface GridRow {
  key: string;
  leafId: string | null;
  sourcePath: string;
  example: string;
  mapping: MappingRow | null;
  free: boolean;
}

const BAD_TARGET: MappingStatus[] = ["stale-target", "incompatible", "invalid"];

function rowStatus(project: MappingProject, row: GridRow): MappingStatus {
  if (!row.mapping) return "unmapped";
  if (row.mapping.kind === "excluded") return "excluded";
  if (row.mapping.kind === "hardcoded" && !row.mapping.fieldName) return "hardcoded";
  return analyzeRow(project, row.mapping).suggested;
}

/**
 * Spreadsheet editing surface over the same mappings array the guide
 * edits: click-to-type cells, arrow/Enter keyboard flow, multi-select
 * bulk edits, free constant rows, and paste-from-Excel import.
 */
export function MappingGrid({
  project,
  planId,
  planLabel,
  onUpdateRow,
  onRemoveRow,
  onUpsertRow,
  onImportPaste,
  onOpenConstants,
}: {
  project: MappingProject;
  /** Active record plan - resolves bare-field targets in Quick map. */
  planId: string | null;
  planLabel: string | null;
  onUpdateRow: (id: string, patch: Partial<MappingRow>) => void;
  onRemoveRow: (id: string) => void;
  /** Create-or-retarget a leaf row from typed Object.Field text. */
  onUpsertRow: (sourcePath: string, target: { objectName: string; fieldName: string }) => void;
  /** Paste import: validated rows, last-wins by source. */
  onImportPaste: (rows: PasteRow[]) => void;
  /** Open the constants manager (label + value prompt). */
  onOpenConstants: () => void;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [active, setActive] = useState<{ key: string; col: ColId } | null>(null);
  const [editing, setEditing] = useState<{ key: string; col: ColId; draft: string; error: string | null } | null>(null);
  const [bulkPlan, setBulkPlan] = useState("");
  const [bulkKind, setBulkKind] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);

  const rows = useMemo<GridRow[]>(() => {
    const bySource = new Map(project.mappings.map((m) => [m.sourcePath, m]));
    const leaves = project.source?.paths.filter((p) => p.kind === "scalar" || p.kind === "null") ?? [];
    const out: GridRow[] = leaves.map((leaf) => ({
      key: bySource.get(leaf.id)?.id ?? `leaf:${leaf.id}`,
      leafId: leaf.id,
      sourcePath: leaf.path,
      example: leaf.example === undefined ? "" : String(leaf.example),
      mapping: bySource.get(leaf.id) ?? null,
      free: false,
    }));
    for (const m of project.mappings) {
      if (m.sourcePath !== FREE_SOURCE_PATH) continue;
      out.push({ key: m.id, leafId: null, sourcePath: FREE_SOURCE_PATH, example: "", mapping: m, free: true });
    }
    return out;
  }, [project]);

  const statuses = useMemo(() => {
    const set = new Set<MappingStatus>();
    rows.forEach((r) => set.add(rowStatus(project, r)));
    return [...set];
  }, [rows, project]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const st = rowStatus(project, r);
      if (statusFilter !== "all" && st !== statusFilter) return false;
      if (!q) return true;
      return (
        r.sourcePath.toLowerCase().includes(q) ||
        r.mapping?.objectName.toLowerCase().includes(q) ||
        r.mapping?.fieldName.toLowerCase().includes(q)
      );
    });
  }, [rows, query, statusFilter, project]);

  const targets = useMemo(() => snapshotTargets(project), [project]);

  const cellText = (row: GridRow, col: ColId): string => {
    const m = row.mapping;
    if (!m) return "";
    switch (col) {
      case "target":
        return m.fieldName ? `${m.objectName}.${m.fieldName}` : "";
      case "kind":
        return m.kind;
      case "plan":
        return m.planId ?? "";
      case "constant":
        return m.hardcodedValue === undefined ? "" : String(m.hardcodedValue);
      case "notes":
        return m.notes ?? "";
    }
  };

  const editable = (row: GridRow, col: ColId): boolean => {
    if (col === "target") return true;
    return row.mapping !== null;
  };

  const startEdit = (row: GridRow, col: ColId) => {
    if (!editable(row, col)) return;
    setActive({ key: row.key, col });
    if (col === "kind" || col === "plan") return; // native selects commit inline
    setEditing({ key: row.key, col, draft: cellText(row, col), error: null });
  };

  /** Commit the open editor. True = close, false = hold with error. */
  const commitEdit = (row: GridRow, col: ColId, draft: string): boolean => {
    const text = draft.trim();
    if (col === "target") {
      if (!text) return true; // empty reverts - delete via checkbox bar
      const check = validateTarget(project, text);
      if (!check.ok) {
        setEditing((e) => (e ? { ...e, error: check.reason } : e));
        return false;
      }
      if (row.mapping) {
        onUpdateRow(row.mapping.id, {
          objectName: check.target.objectName,
          fieldName: check.target.fieldName,
          kind: row.mapping.kind === "excluded" ? "direct" : row.mapping.kind,
        });
      } else if (row.leafId) {
        onUpsertRow(row.leafId, check.target);
      }
      return true;
    }
    if (!row.mapping) return true;
    if (col === "constant") {
      // Typing a constant implies the hardcoded kind - the status pill shows it.
      onUpdateRow(row.mapping.id, { hardcodedValue: draft, kind: "hardcoded" });
      return true;
    }
    if (col === "notes") {
      onUpdateRow(row.mapping.id, { notes: draft });
      return true;
    }
    return true;
  };

  const closeEdit = (commit: boolean) => {
    if (!editing) return;
    const row = filtered.find((r) => r.key === editing.key);
    if (commit && row && !commitEdit(row, editing.col, editing.draft)) return;
    setEditing(null);
  };

  const toggleKind = (row: GridRow, kind: MappingKind) => {
    if (!row.mapping) return;
    const next = row.mapping.kind === kind ? "direct" : kind;
    onUpdateRow(row.mapping.id, {
      kind: next,
      status: next === "excluded" ? "excluded" : row.mapping.status,
    });
  };

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (!active || editing) return;
    const idx = filtered.findIndex((r) => r.key === active.key);
    if (idx < 0) return;
    const row = filtered[idx];
    const ci = COLS.indexOf(active.col);
    if (e.key === "ArrowUp" && idx > 0) {
      e.preventDefault();
      setActive({ key: filtered[idx - 1].key, col: active.col });
    } else if (e.key === "ArrowDown" && idx < filtered.length - 1) {
      e.preventDefault();
      setActive({ key: filtered[idx + 1].key, col: active.col });
    } else if (e.key === "ArrowLeft" && ci > 0) {
      e.preventDefault();
      setActive({ key: active.key, col: COLS[ci - 1] });
    } else if (e.key === "ArrowRight" && ci < COLS.length - 1) {
      e.preventDefault();
      setActive({ key: active.key, col: COLS[ci + 1] });
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      startEdit(row, active.col);
    } else if ((e.key === "x" || e.key === "X") && row.mapping) {
      toggleKind(row, "excluded");
    } else if ((e.key === "h" || e.key === "H") && row.mapping) {
      toggleKind(row, "hardcoded");
    }
  };

  const toggleSelect = (id: string, index: number, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && lastChecked !== null) {
        const [a, b] = [Math.min(lastChecked, index), Math.max(lastChecked, index)];
        const want = !next.has(id);
        filtered.slice(a, b + 1).forEach((r) => {
          if (r.mapping) {
            if (want) next.add(r.mapping.id);
            else next.delete(r.mapping.id);
          }
        });
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastChecked(index);
  };

  const mappedVisible = filtered.filter((r) => r.mapping);
  const allChecked = mappedVisible.length > 0 && mappedVisible.every((r) => selected.has(r.mapping!.id));

  const applyBulk = (patch: Partial<MappingRow>) => {
    selected.forEach((id) => onUpdateRow(id, patch));
  };

  const cellRing = (row: GridRow, col: ColId) =>
    active?.key === row.key && active.col === col
      ? "outline outline-2 outline-[#A98450] outline-offset-[-2px]"
      : "";

  const targetCellClass = (st: MappingStatus) =>
    BAD_TARGET.includes(st) ? "text-[#B3261E]" : "text-[#27241F]";

  return (
    <div className="space-y-2" onKeyDown={onGridKeyDown}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter grid…"
          aria-label="Filter grid rows"
          spellCheck={false}
          className="min-w-[140px] flex-1 rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none"
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
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setQuickOpen(true)} title="Fast-forward mapper: dump K:V pairs and auto-map to the template">
            Quick map
          </Button>
          <Button size="sm" variant="secondary" onClick={onOpenConstants} title="Name a label + value constant reusable from Guide and Grid">
            Add constant
          </Button>
        </span>
      </div>
      <p className="font-mono text-[10px] text-[#A39B8E]">
        Arrows move · Enter edits · Esc cancels · X excludes · H hardcodes · Shift-click selects a range
      </p>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#A98450] bg-[#FAF3E3] px-3 py-2 text-[12px]">
          <span className="font-semibold text-[#27241F]">{selected.size} selected</span>
          <select
            value={bulkPlan}
            onChange={(e) => setBulkPlan(e.target.value)}
            aria-label="Bulk plan"
            className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1 text-[11px]"
          >
            <option value="">plan…</option>
            <option value="__none__">(none)</option>
            {project.recordPlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" disabled={!bulkPlan} onClick={() => { applyBulk({ planId: bulkPlan === "__none__" ? null : bulkPlan }); setBulkPlan(""); }}>
            Set plan
          </Button>
          <select
            value={bulkKind}
            onChange={(e) => setBulkKind(e.target.value)}
            aria-label="Bulk kind"
            className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1 text-[11px]"
          >
            <option value="">kind…</option>
            {(["direct", "hardcoded", "excluded", "enum"] as const).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" disabled={!bulkKind} onClick={() => { applyBulk({ kind: bulkKind as MappingKind }); setBulkKind(""); }}>
            Set kind
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              selected.forEach((id) => onRemoveRow(id));
              setSelected(new Set());
            }}
            title="Delete every selected mapping"
          >
            Delete ({selected.size})
          </Button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto cursor-pointer rounded px-1.5 text-[#A39B8E] hover:text-[#27241F]">
            ✕
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[#E8E2D8]">
        <table className="w-full min-w-[1180px] border-collapse bg-white text-left text-[12px]">
          <thead>
            <tr className="border-b border-[#E8E2D8] bg-[#FAF8F2] font-mono text-[10px] uppercase tracking-wider text-[#A39B8E]">
              <th className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={(e) => {
                    if (e.target.checked) setSelected(new Set(mappedVisible.map((r) => (r.mapping as MappingRow).id)));
                    else setSelected(new Set());
                  }}
                  aria-label="Select all rows"
                  className="cursor-pointer accent-[#A98450]"
                />
              </th>
              <th className="px-2 py-2 font-semibold">Status</th>
              <th className="px-2 py-2 font-semibold">Source path</th>
              <th className="px-2 py-2 font-semibold">Example</th>
              <th className="px-2 py-2 font-semibold">Target</th>
              <th className="px-2 py-2 font-semibold">Kind</th>
              <th className="px-2 py-2 font-semibold">Plan</th>
              <th className="px-2 py-2 font-semibold">Constant</th>
              <th className="px-2 py-2 font-semibold">Notes</th>
              <th className="px-2 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, ri) => {
              const st = rowStatus(project, row);
              const m = row.mapping;
              const diag = m ? analyzeRow(project, m).diagnostics : [];
              const firstErr = diag.find((d) => d.severity === "error")?.message;
              const isEditing = (col: ColId) => editing?.key === row.key && editing.col === col;
              return (
                <tr key={row.key} className="border-b border-[#F0EBE0] last:border-0">
                  <td className="px-2 py-1">
                    {m && (
                      <input
                        type="checkbox"
                        checked={selected.has(m.id)}
                        onClick={(e) => toggleSelect(m.id, ri, e.shiftKey)}
                        onChange={() => {}}
                        aria-label={`Select ${row.sourcePath}`}
                        className="cursor-pointer accent-[#A98450]"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <span className={`whitespace-nowrap rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${STATUS_STYLES[st]}`}>
                      {STATUS_LABELS[st]}
                    </span>
                  </td>
                  <td className={`max-w-[220px] truncate px-2 py-1 font-mono text-[11px] ${row.free ? "text-[#A39B8E]" : "text-[#27241F]"}`} title={row.sourcePath}>
                    {row.free ? "(constant)" : row.sourcePath}
                  </td>
                  <td className="max-w-[110px] truncate px-2 py-1 font-mono text-[11px] text-[#777168]" title={row.example}>
                    {row.example || <span className="text-[#C9C2B2]">Null</span>}
                  </td>
                  <td className={`min-w-[170px] px-1 py-0.5 ${cellRing(row, "target")}`} title={firstErr ?? "Object.Field - Enter to commit"}>
                    {isEditing("target") && editing ? (
                      <div>
                        <input
                          autoFocus
                          value={editing.draft}
                          list="grid-targets"
                          onChange={(e) => setEditing({ ...editing, draft: e.target.value, error: null })}
                          onBlur={() => closeEdit(true)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              closeEdit(true);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              closeEdit(false);
                            }
                          }}
                          onFocus={(e) => e.target.select()}
                          aria-label="Target Object.Field"
                          spellCheck={false}
                          className={`w-full rounded-md border bg-white px-1.5 py-1 font-mono text-[11px] focus:outline-none ${editing.error ? "border-[#B3261E]" : "border-[#A98450]"}`}
                        />
                        {editing.error && <p className="mt-0.5 text-[10px] text-[#B3261E]">{editing.error}</p>}
                      </div>
                    ) : (
                      <div onClick={() => startEdit(row, "target")} className={`cursor-text truncate rounded px-1.5 py-1 font-mono text-[11px] hover:bg-[#FAF8F2] ${targetCellClass(st)}`}>
                        {m?.fieldName ? `${m.objectName}.${m.fieldName}` : <span className="text-[#C9C2B2]">type Object.Field…</span>}
                      </div>
                    )}
                  </td>
                  <td className={`px-1 py-0.5 ${cellRing(row, "kind")} min-w-[132px]`}>
                    {m ? (
                      <select
                        value={m.kind}
                        onChange={(e) => {
                          const kind = e.target.value as MappingKind;
                          onUpdateRow(m.id, { kind, status: kind === "excluded" ? "excluded" : m.status });
                        }}
                        onFocus={() => setActive({ key: row.key, col: "kind" })}
                        title={m.kind === "enum" ? "Value map edited in Guide mode" : "Mapping kind"}
                        aria-label="Mapping kind"
                        className="w-full cursor-pointer rounded-md border border-transparent bg-transparent px-1 py-1 font-mono text-[11px] hover:border-[#E8E2D8]"
                      >
                        {(["direct", "hardcoded", "excluded", "enum"] as const).map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="px-1.5 text-[11px] text-[#C9C2B2]">Null</span>
                    )}
                  </td>
                  <td className={`px-1 py-0.5 ${cellRing(row, "plan")} min-w-[150px]`}>
                    {m ? (
                      <select
                        value={m.planId ?? ""}
                        onChange={(e) => onUpdateRow(m.id, { planId: e.target.value || null })}
                        onFocus={() => setActive({ key: row.key, col: "plan" })}
                        aria-label="Record plan"
                        className="w-full cursor-pointer rounded-md border border-transparent bg-transparent px-1 py-1 font-mono text-[11px] hover:border-[#E8E2D8]"
                      >
                        <option value="">(none)</option>
                        {project.recordPlans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="px-1.5 text-[11px] text-[#C9C2B2]">Null</span>
                    )}
                  </td>
                  <td className={`min-w-[150px] px-1 py-0.5 ${cellRing(row, "constant")}`}>
                    {m ? (
                      isEditing("constant") && editing ? (
                        <input
                          autoFocus
                          value={editing.draft}
                          onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
                          onBlur={() => closeEdit(true)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              closeEdit(true);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              closeEdit(false);
                            }
                          }}
                          onFocus={(e) => e.target.select()}
                          aria-label="Constant value"
                          spellCheck={false}
                          placeholder="constant…"
                          className="w-full rounded-md border border-[#A98450] bg-white px-1.5 py-1 font-mono text-[11px] focus:outline-none"
                        />
                      ) : (
                        <div
                          onClick={() => startEdit(row, "constant")}
                          title="Typing a constant switches the row to hardcoded"
                          className="cursor-text truncate rounded px-1.5 py-1 font-mono text-[11px] text-[#27241F] hover:bg-[#FAF8F2]"
                        >
                          {m.hardcodedValue === undefined || m.hardcodedValue === "" ? <span className="text-[#C9C2B2]">Null</span> : String(m.hardcodedValue)}
                        </div>
                      )
                    ) : (
                      <span className="px-1.5 text-[11px] text-[#C9C2B2]">Null</span>
                    )}
                  </td>
                  <td className={`min-w-[170px] px-1 py-0.5 ${cellRing(row, "notes")}`}>
                    {m ? (
                      isEditing("notes") && editing ? (
                        <input
                          autoFocus
                          value={editing.draft}
                          onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
                          onBlur={() => closeEdit(true)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              closeEdit(true);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              closeEdit(false);
                            }
                          }}
                          onFocus={(e) => e.target.select()}
                          aria-label="Row notes"
                          spellCheck={false}
                          placeholder="notes…"
                          className="w-full rounded-md border border-[#A98450] bg-white px-1.5 py-1 font-mono text-[11px] focus:outline-none"
                        />
                      ) : (
                        <div
                          onClick={() => startEdit(row, "notes")}
                          className="cursor-text truncate rounded px-1.5 py-1 font-mono text-[11px] text-[#27241F] hover:bg-[#FAF8F2]"
                        >
                          {m.notes ? m.notes : <span className="text-[#C9C2B2]">Null</span>}
                        </div>
                      )
                    ) : (
                      <span className="px-1.5 text-[11px] text-[#C9C2B2]">Null</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {m && (
                      <button
                        type="button"
                        onClick={() => onRemoveRow(m.id)}
                        aria-label={`Delete mapping for ${row.sourcePath}`}
                        title="Delete mapping"
                        className="cursor-pointer rounded px-1.5 py-0.5 font-mono text-[11px] text-[#A39B8E] hover:bg-[#F9E8E6] hover:text-[#B3261E]"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-2.5 py-6 text-center text-[12px] text-[#A39B8E]">
                  No rows match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <datalist id="grid-targets">
        {targets.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      {quickOpen && (
        <QuickMapModal
          project={project}
          planId={planId}
          planLabel={planLabel}
          onImport={onImportPaste}
          onClose={() => setQuickOpen(false)}
        />
      )}
    </div>
  );
}
