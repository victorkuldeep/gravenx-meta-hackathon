"use client";

import { useMemo, useState } from "react";
import { parseJsonInput, formatJson, formatBytes } from "@/lib/json/studio";
import {
  applyTransformOps,
  escapeForEmbedding,
  buildWrapper,
  unescapeToJson,
  type TransformOp,
} from "@/lib/json/transform";
import Button from "../ui/Button";

const SAMPLE = `{
  "id": "INS-0001",
  "status": "Active",
  "constraintStatus": "Hold",
  "amount": 1200,
  "lines": [
    { "sku": "SVC-A", "qty": 2 }
  ]
}`;

const SAMPLE_OPS: TransformOp[] = [
  { kind: "drop", path: "$.constraintStatus" },
  { kind: "set", path: "$.priority", valueText: '"High"' },
];

const card = "rounded-xl border border-[#E8E2D8] bg-white px-4 py-3";
const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[#777168]";
const area =
  "w-full rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-2 font-mono text-[12px] text-[#27241F] placeholder:text-[#A39B8E] focus:border-[#A98450] focus:outline-none";
const field =
  "rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 font-mono text-[12px] text-[#27241F] placeholder:text-[#A39B8E] focus:border-[#A98450] focus:outline-none";

/** JSON Transform: node surgery, then escape-and-embed as a string-carried payload. */
export function JsonTransform() {
  const [raw, setRaw] = useState("");
  const [ops, setOps] = useState<TransformOp[]>([]);
  const [draftKind, setDraftKind] = useState<TransformOp["kind"]>("drop");
  const [draftPath, setDraftPath] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [wrapperKey, setWrapperKey] = useState("");
  const [pretty, setPretty] = useState(false);
  const [extraText, setExtraText] = useState("");
  const [extraError, setExtraError] = useState<string | null>(null);
  const [unescapeIn, setUnescapeIn] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const parsed = useMemo(() => {
    if (!raw.trim()) return null;
    const r = parseJsonInput(raw);
    return r.ok ? { value: r.value } : { error: r.error };
  }, [raw]);
  const sourceError = parsed && "error" in parsed ? parsed.error : null;
  const sourceValue = parsed && "value" in parsed ? parsed.value : null;

  const { transformed, opErrors } = useMemo(() => {
    if (sourceValue === null && !sourceError) return { transformed: null, opErrors: [] };
    if (sourceValue === null || sourceValue === undefined) return { transformed: null, opErrors: [] };
    const r = applyTransformOps(sourceValue, ops);
    return { transformed: r.value, opErrors: r.errors };
  }, [sourceValue, sourceError, ops]);

  const extra = useMemo(() => {
    if (!extraText.trim()) return { props: {}, error: null as string | null };
    const r = parseJsonInput(extraText);
    if (!r.ok) return { props: {}, error: r.error };
    if (r.value === null || typeof r.value !== "object" || Array.isArray(r.value)) {
      return { props: {}, error: "Extra props must be a JSON object" };
    }
    return { props: r.value as Record<string, unknown>, error: null };
  }, [extraText]);

  const payload = transformed ?? sourceValue;
  const escaped = payload !== null && payload !== undefined ? escapeForEmbedding(payload, pretty) : null;
  const wrapper =
    payload !== null && payload !== undefined && wrapperKey.trim()
      ? buildWrapper(payload, wrapperKey.trim(), extra.props)
      : null;

  const unescaped = useMemo(() => {
    if (!unescapeIn.trim()) return null;
    return unescapeToJson(unescapeIn);
  }, [unescapeIn]);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  const addOp = () => {
    if (draftKind === "rename") {
      if (!draftFrom.trim() || !draftTo.trim()) return;
      setOps((p) => [...p, { kind: "rename", parent: draftPath.trim() || "$", from: draftFrom.trim(), to: draftTo.trim() }]);
      setDraftFrom("");
      setDraftTo("");
    } else {
      if (!draftPath.trim()) return;
      if (draftKind === "drop") setOps((p) => [...p, { kind: "drop", path: draftPath.trim() }]);
      else {
        if (!draftValue.trim()) return;
        setOps((p) => [...p, { kind: "set", path: draftPath.trim(), valueText: draftValue.trim() }]);
        setDraftValue("");
      }
    }
    setDraftPath("");
  };

  const describe = (op: TransformOp): string => {
    if (op.kind === "drop") return `Drop ${op.path}`;
    if (op.kind === "set") return `Set ${op.path} = ${op.valueText}`;
    return `Rename ${op.parent} :: ${op.from} → ${op.to}`;
  };

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-[#27241F]">1 · Source payload</h3>
          <div className="flex items-center gap-2">
            {sourceValue !== null && sourceValue !== undefined && (
              <span className="font-mono text-[11px] text-[#777168]">{formatBytes(new Blob([formatJson(sourceValue)]).size)}</span>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setRaw(SAMPLE);
                setOps(SAMPLE_OPS);
              }}
              title="Load a small instance-style payload with a sample prune + inject"
            >
              Load sample
            </Button>
          </div>
        </div>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder='Paste JSON here - e.g. a getInstance response…'
          spellCheck={false}
          rows={8}
          className={`${area} mt-2 min-h-[140px] resize-y`}
        />
        {sourceError && (
          <p className="mt-1.5 text-[12px] text-red-700" role="alert">{sourceError}</p>
        )}
      </div>

      <div className={card}>
        <h3 className="text-[13px] font-semibold text-[#27241F]">2 · Node surgery <span className="font-normal text-[#777168]">— drop, set, rename by canonical path ($.a[0].b)</span></h3>
        <div className="mt-2 flex flex-wrap items-end gap-1.5">
          <div>
            <label className={label} htmlFor="jx-op">Op</label>
            <select
              id="jx-op"
              value={draftKind}
              onChange={(e) => setDraftKind(e.target.value as TransformOp["kind"])}
              className={`${field} cursor-pointer`}
            >
              <option value="drop">Drop</option>
              <option value="set">Set</option>
              <option value="rename">Rename</option>
            </select>
          </div>
          <div className="min-w-[180px] flex-1">
            <label className={label} htmlFor="jx-path">{draftKind === "rename" ? "Parent path" : "Path"}</label>
            <input
              id="jx-path"
              value={draftPath}
              onChange={(e) => setDraftPath(e.target.value)}
              placeholder={draftKind === "rename" ? "$" : "$.constraintStatus"}
              spellCheck={false}
              className={`${field} w-full`}
            />
          </div>
          {draftKind === "set" && (
            <div className="min-w-[180px] flex-1">
              <label className={label} htmlFor="jx-val">Value (JSON)</label>
              <input
                id="jx-val"
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
                placeholder='"High"'
                spellCheck={false}
                className={`${field} w-full`}
              />
            </div>
          )}
          {draftKind === "rename" && (
            <>
              <div>
                <label className={label} htmlFor="jx-from">From</label>
                <input id="jx-from" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} placeholder="status" spellCheck={false} className={field} />
              </div>
              <div>
                <label className={label} htmlFor="jx-to">To</label>
                <input id="jx-to" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} placeholder="state" spellCheck={false} className={field} />
              </div>
            </>
          )}
          <Button size="sm" onClick={addOp} title="Append this operation">Add op</Button>
          {ops.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setOps([])} title="Remove all operations">Clear</Button>
          )}
        </div>
        {ops.length > 0 && (
          <ul className="mt-2 space-y-1">
            {ops.map((op, i) => {
              const err = opErrors.find((e) => e.op === i);
              return (
                <li
                  key={i}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-[12px] ${
                    err ? "border-red-300 bg-red-50" : "border-[#E8E2D8] bg-white"
                  }`}
                >
                  <span className="font-mono text-[#A39B8E]">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[#27241F]" title={describe(op)}>{describe(op)}</span>
                  {err && <span className="min-w-0 flex-1 truncate text-red-700" title={err.message}>{err.message}</span>}
                  <button
                    type="button"
                    onClick={() => setOps((p) => p.filter((_, j) => j !== i))}
                    aria-label={`Remove operation ${i + 1}`}
                    title="Remove"
                    className="shrink-0 cursor-pointer rounded px-1 text-[#777168] hover:text-red-700"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {transformed !== null && transformed !== undefined && (
          <div className="mt-2">
            <div className="flex items-center justify-between gap-2">
              <p className={label}>Transformed preview</p>
              <Button size="sm" variant="secondary" onClick={() => void copy("preview", formatJson(transformed))}>
                {copied === "preview" ? "Copied ✓" : "Copy JSON"}
              </Button>
            </div>
            <pre className={`${area} mt-1 max-h-[220px] overflow-auto whitespace-pre-wrap`}>{formatJson(transformed)}</pre>
          </div>
        )}
      </div>

      <div className={card}>
        <h3 className="text-[13px] font-semibold text-[#27241F]">3 · Escape &amp; embed <span className="font-normal text-[#777168]">— carry the payload as a string field</span></h3>
        <div className="mt-2 flex flex-wrap items-end gap-1.5">
          <div>
            <label className={label} htmlFor="jx-key">Wrapper key</label>
            <input id="jx-key" value={wrapperKey} onChange={(e) => setWrapperKey(e.target.value)} placeholder="salesTransaction" spellCheck={false} className={field} />
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 pb-1.5 text-[12px] text-[#27241F]">
            <input type="checkbox" checked={pretty} onChange={(e) => setPretty(e.target.checked)} className="h-3.5 w-3.5 accent-[#A98450]" />
            Pretty source
          </label>
          <div className="min-w-[220px] flex-1">
            <label className={label} htmlFor="jx-extra">Extra wrapper props (JSON object, optional)</label>
            <input
              id="jx-extra"
              value={extraText}
              onChange={(e) => {
                setExtraText(e.target.value);
                const r = parseJsonInput(e.target.value);
                setExtraError(!e.target.value.trim() ? null : !r.ok ? r.error : null);
              }}
              placeholder='{"op": "set"}'
              spellCheck={false}
              className={`${field} w-full`}
            />
          </div>
        </div>
        {extraError && <p className="mt-1 text-[12px] text-red-700" role="alert">{extraError}</p>}
        {extra.error && <p className="mt-1 text-[12px] text-red-700" role="alert">{extra.error}</p>}
        {escaped !== null ? (
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className={label}>Escaped string (paste inside quotes)</p>
                <Button size="sm" variant="secondary" onClick={() => void copy("esc", escaped)}>
                  {copied === "esc" ? "Copied ✓" : "Copy escaped"}
                </Button>
              </div>
              <pre className={`${area} mt-1 max-h-[180px] overflow-auto whitespace-pre-wrap break-all`}>{escaped}</pre>
            </div>
            {wrapper !== null ? (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className={label}>Wrapper JSON</p>
                  <Button size="sm" variant="secondary" onClick={() => void copy("wrap", formatJson(wrapper))}>
                    {copied === "wrap" ? "Copied ✓" : "Copy wrapper"}
                  </Button>
                </div>
                <pre className={`${area} mt-1 max-h-[180px] overflow-auto whitespace-pre-wrap`}>{formatJson(wrapper)}</pre>
              </div>
            ) : (
              <p className="mt-2 self-start text-[12px] text-[#777168]">Enter a wrapper key to preview the wrapper JSON - e.g. salesTransaction.</p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-[#777168]">Load a source payload above - the escaped string and wrapper appear here.</p>
        )}
      </div>

      <div className={card}>
        <h3 className="text-[13px] font-semibold text-[#27241F]">4 · Unescape <span className="font-normal text-[#777168]">— escaped string or wrapper back to JSON</span></h3>
        <textarea
          value={unescapeIn}
          onChange={(e) => setUnescapeIn(e.target.value)}
          placeholder='Paste an escaped string ("{\\"a\\":1}") or a wrapper carrying one…'
          spellCheck={false}
          rows={4}
          className={`${area} mt-2 min-h-[80px] resize-y`}
        />
        {unescaped && (unescaped.ok ? (
          <div className="mt-2">
            <div className="flex items-center justify-between gap-2">
              <p className={label}>Unescaped JSON</p>
              <Button size="sm" variant="secondary" onClick={() => void copy("unesc", formatJson(unescaped.value))}>
                {copied === "unesc" ? "Copied ✓" : "Copy JSON"}
              </Button>
            </div>
            <pre className={`${area} mt-1 max-h-[220px] overflow-auto whitespace-pre-wrap`}>{formatJson(unescaped.value)}</pre>
          </div>
        ) : (
          <p className="mt-1.5 text-[12px] text-red-700" role="alert">{unescaped.error}</p>
        ))}
      </div>
    </div>
  );
}
