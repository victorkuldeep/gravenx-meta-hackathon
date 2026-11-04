"use client";

import { useMemo, useState } from "react";
import Button from "../ui/Button";
import {
  descendantLeafIds,
  flattenFields,
  generateSample,
  ingestMappingSpec,
  schemaForSide,
  type BodySide,
  type FlatField,
  type Operation,
  type SpecIngest,
} from "@/lib/mapping/openapi";

const inputCls =
  "w-full rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[13px] focus:border-[#A98450] focus:outline-none";

/**
 * OpenAPI-sourced mapping start: paste a spec -> pick an operation ->
 * check the fields you need -> drop the generated sample into the wizard.
 */
export function OpenApiSource({
  onUse,
  onBack,
}: {
  onUse: (sample: { name: string; text: string }) => void;
  onBack: () => void;
}) {
  const [fileName, setFileName] = useState("orders-api.yaml");
  const [specText, setSpecText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ingested, setIngested] = useState<SpecIngest | null>(null);
  const [opId, setOpId] = useState<string | null>(null);
  const [side, setSide] = useState<BodySide>("request");
  const [statusCode, setStatusCode] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState(false);

  const op: Operation | undefined = ingested?.operations.find((o) => o.id === opId) ?? ingested?.operations[0];
  const body = useMemo(() => (op ? schemaForSide(op, side, statusCode || undefined) : undefined), [op, side, statusCode]);
  const fields: FlatField[] = useMemo(() => (body ? flattenFields(body.schema) : []), [body]);
  const leafIds = useMemo(() => fields.filter((f) => !f.container).map((f) => f.id), [fields]);

  const load = async () => {
    if (!specText.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await ingestMappingSpec(specText, fileName);
      if (result.errors.length > 0) {
        setError(result.errors.join(" "));
        setIngested(null);
        return;
      }
      setIngested(result);
      const first = result.operations[0];
      setOpId(first.id);
      setSide(first.request ? "request" : "response");
      setStatusCode("");
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  };

  // Default to everything selected once fields arrive; after the first
  // explicit choice the architect owns the set (so Clear stays cleared).
  const effective: Set<string> = useMemo(
    () => (!touched && fields.length > 0 ? new Set(leafIds) : selected),
    [touched, fields, leafIds, selected]
  );
  const sampleText = useMemo(() => {
    if (!body || effective.size === 0) return "";
    try {
      return JSON.stringify(generateSample(body.schema, effective), null, 2);
    } catch {
      return "";
    }
  }, [body, effective]);

  const toggle = (field: FlatField) => {
    const next = new Set(effective);
    const ids = field.container ? descendantLeafIds(fields, field.id) : [field.id];
    if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    setTouched(true);
    setSelected(next);
  };

  const useSample = () => {
    if (!op || !sampleText) return;
    const slug = `${op.method} ${op.path}`.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "operation";
    onUse({ name: `${slug} · ${body?.label ?? side} sample.json`, text: sampleText });
  };

  return (
    <div className="space-y-3">
      {!ingested && (
        <div className="space-y-3">
          <p className="text-[12px] leading-relaxed text-[#777168]">
            Paste an OpenAPI 3.x document (JSON or YAML). Only local references are resolved - remote $refs are refused, nothing leaves your browser.
          </p>
          <label className="block text-[12px] font-semibold text-[#27241F]">
            File name (detects JSON vs YAML)
            <input value={fileName} onChange={(e) => setFileName(e.target.value)} className={`${inputCls} mt-1 font-mono font-normal`} />
          </label>
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Specification
            <textarea
              value={specText}
              onChange={(e) => {
                setSpecText(e.target.value);
                setError(null);
              }}
              rows={10}
              spellCheck={false}
              placeholder='openapi: 3.0.0 …  (paste JSON or YAML)'
              className={`${inputCls} mt-1 font-mono text-[12px] leading-relaxed font-normal`}
            />
          </label>
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={onBack}>
              ← Back
            </Button>
            <Button onClick={() => void load()} disabled={!specText.trim() || loading}>
              {loading ? "Reading spec…" : "Read operations →"}
            </Button>
          </div>
        </div>
      )}

      {ingested && op && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px] font-semibold text-[#27241F]">
              Operation
              <select
                value={op.id}
                onChange={(e) => {
                  setOpId(e.target.value);
                  setSide("request");
                  setStatusCode("");
                  setTouched(false);
                  setSelected(new Set());
                }}
                className={`${inputCls} min-w-0 flex-1 font-mono font-normal`}
              >
                {ingested.operations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.method} {o.path}{o.summary ? ` - ${o.summary}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex overflow-hidden rounded-lg border border-[#E8E2D8]" role="group" aria-label="Payload side">
              {(["request", "response"] as BodySide[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setSide(s);
                    setStatusCode("");
                    setTouched(false);
                    setSelected(new Set());
                  }}
                  aria-pressed={side === s}
                  className={`px-3 py-1.5 text-[12px] font-semibold capitalize ${side === s ? "bg-[#211F1B] text-white" : "bg-white text-[#777168]"}`}
                >
                  {s === "request" ? "Request" : "Response"}
                </button>
              ))}
            </div>
          </div>

          {side === "response" && op.responses.filter((r) => r.contentTypes.some((c) => c.supported)).length > 1 && (
            <label className="flex items-center gap-2 text-[12px] font-semibold text-[#27241F]">
              Status
              <select value={statusCode} onChange={(e) => setStatusCode(e.target.value)} className={`${inputCls} w-auto font-mono font-normal`}>
                <option value="">auto (prefer 2xx)</option>
                {op.responses
                  .filter((r) => r.contentTypes.some((c) => c.supported))
                  .map((r) => (
                    <option key={r.statusCode} value={r.statusCode}>
                      {r.statusCode}
                    </option>
                  ))}
              </select>
            </label>
          )}

          {!body && (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              This {side} has no JSON schema - pick the other side or another operation.
            </p>
          )}

          {body && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-semibold text-[#27241F]">
                  {effective.size} of {leafIds.length} fields
                </span>
                <span className="text-[#A39B8E]">· {body.label} · untick what you will not map</span>
                <span className="ml-auto flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => { setTouched(true); setSelected(new Set(leafIds)); }}>
                    Select all
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setTouched(true); setSelected(new Set(fields.filter((f) => !f.container && f.required).map((f) => f.id))); }}>
                    Required only
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setTouched(true); setSelected(new Set()); }}>
                    Clear
                  </Button>
                </span>
              </div>
              <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-xl border border-[#F0EBE0] p-2">
                {fields.map((f) => {
                  const ids = f.container ? descendantLeafIds(fields, f.id) : [f.id];
                  const checked = ids.length > 0 && ids.every((id) => effective.has(id));
                  return (
                    <li key={f.id}>
                      <label
                        className="flex cursor-pointer items-baseline gap-2 rounded-lg px-2 py-1 hover:bg-[#FAF7F0]"
                        style={{ paddingLeft: `${8 + Math.min(f.depth, 6) * 14}px` }}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggle(f)} className="translate-y-px accent-[#722F37]" />
                        <span className={`font-mono text-[12px] ${f.container ? "font-bold text-[#27241F]" : "text-[#4E342E]"}`}>{f.key}</span>
                        <span className="font-mono text-[10px] text-[#A39B8E]">{f.type}{f.required ? " · required" : ""}</span>
                        {f.description && <span className="truncate text-[11px] text-[#777168]">- {f.description}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
              {sampleText && (
                <div>
                  <p className="mb-1 text-[12px] font-semibold text-[#27241F]">Sample preview - becomes the mapping source</p>
                  <pre className="max-h-48 overflow-auto rounded-xl border border-[#F0EBE0] bg-[#FAF7F0] p-3 font-mono text-[11px] leading-relaxed text-[#4E342E]">
                    {sampleText.length > 4000 ? `${sampleText.slice(0, 4000)}\n… (truncated preview, full sample is used)` : sampleText}
                  </pre>
                </div>
              )}
              <div className="flex justify-between">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setIngested(null);
                    setError(null);
                  }}
                >
                  ← Different spec
                </Button>
                <Button onClick={useSample} disabled={effective.size === 0 || !sampleText}>
                  Use this sample →
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
