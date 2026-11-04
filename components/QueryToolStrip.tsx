"use client";

import { useEffect, useMemo, useState } from "react";
import { numericFields, recordFields } from "@/lib/queryFieldStats";
import Button from "./ui/Button";

type Op = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" | "DISTINCT";

const OPS: { id: Op; glyph: string; label: string }[] = [
  { id: "COUNT", glyph: "#", label: "Count rows (or non-empty values)" },
  { id: "SUM", glyph: "Σ", label: "Sum" },
  { id: "AVG", glyph: "x̄", label: "Average" },
  { id: "MIN", glyph: "↓", label: "Minimum" },
  { id: "MAX", glyph: "↑", label: "Maximum" },
  { id: "DISTINCT", glyph: "≠", label: "Distinct values" },
];

const fmt = (v: number): string =>
  Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Lean quick-stats strip for pulled rows: pick a field, hit an op icon,
 * get the answer as a chip and the single-row table. COUNT needs no field.
 */
export function QueryToolStrip({
  records,
  onDisplay,
}: {
  records: unknown[];
  onDisplay: (rows: unknown[] | null, label: string | null) => void;
}) {
  const [field, setField] = useState("");
  const [readout, setReadout] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fields = useMemo(() => recordFields(records), [records]);
  // Only these fields can feed SUM/AVG/MIN/MAX - Ids and Names never qualify,
  // so those icons disable instead of failing after the click.
  const numericSet = useMemo(() => new Set(numericFields(records)), [records]);

  // Fresh run: the previous field may not exist in the new rows.
  useEffect(() => {
    setField("");
    setReadout(null);
  }, [records]);

  const run = async (op: Op) => {
    const f = field.trim();
    if (op !== "COUNT" && !f) {
      setReadout("Pick a field first.");
      return;
    }
    if ((op === "SUM" || op === "AVG" || op === "MIN" || op === "MAX") && !numericSet.has(f)) {
      setReadout(`${f || "Field"} is not numeric.`);
      return;
    }
    setBusy(true);
    try {
      if (op === "DISTINCT") {
        const values = new Set<unknown>();
        for (const r of records) {
          const v = (r as Record<string, unknown> | null)?.[f];
          if (v !== null && v !== undefined && v !== "") values.add(typeof v === "object" ? JSON.stringify(v) : v);
        }
        setReadout(`≠ ${f} = ${fmt(values.size)}`);
        onDisplay([{ field: f, distinct: values.size }], `Distinct ${f} = ${values.size}`);
        return;
      }
      const mod = await import("@/lib/queryFilter");
      const out = mod.aggregateRecords(records, {
        aggs: [{ op, field: f || undefined, alias: "v" }],
      });
      if (!out.ok) {
        setReadout(out.error);
        return;
      }
      const v = ((out.rows[0] as Record<string, unknown> | undefined)?.v ?? null) as number | null;
      const name = op === "COUNT" ? (f ? `non-empty ${f}` : "rows") : f;
      const glyph = OPS.find((o) => o.id === op)?.glyph ?? op;
      setReadout(`${glyph} ${name} = ${typeof v === "number" ? fmt(v) : "—"}`);
      onDisplay(out.rows, `${op} ${name}`);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    setReadout(null);
    onDisplay(null, null);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ivory-600">Quick stats</span>
      <select
        value={field}
        onChange={(e) => setField(e.target.value)}
        aria-label="Stat field"
        className="max-w-[180px] cursor-pointer rounded-md border border-[var(--color-line-soft)] bg-white px-1.5 py-1 font-mono text-[11px] text-ivory-950"
      >
        <option value="">(all rows)</option>
        {fields.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
      <div className="flex items-center gap-0.5" role="toolbar" aria-label="Quick aggregates">
        {OPS.map((o) => {
          const needsNum = o.id === "SUM" || o.id === "AVG" || o.id === "MIN" || o.id === "MAX";
          const off = busy || (needsNum && (!field.trim() || !numericSet.has(field.trim())));
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => void run(o.id)}
              disabled={off}
              title={needsNum && field.trim() && !numericSet.has(field.trim()) ? `${field.trim()} is not numeric` : o.label}
              aria-label={o.label}
              className="h-7 w-7 cursor-pointer rounded-md text-[13px] font-bold text-ivory-700 transition-colors hover:bg-bronze-100 hover:text-bronze-700 disabled:opacity-40"
            >
              {o.glyph}
            </button>
          );
        })}
      </div>
      {readout && (
        <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-bronze-300 bg-bronze-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-bronze-700">
          <span className="truncate" title={readout}>{readout}</span>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Clear quick stat"
            title="Clear (back to server results)"
            className="cursor-pointer rounded-full px-0.5 hover:bg-bronze-200"
          >
            ✕
          </button>
        </span>
      )}
      <span className="flex-1" />
      <Button size="sm" variant="ghost" onClick={dismiss} title="Back to server results">
        Reset view
      </Button>
    </div>
  );
}
