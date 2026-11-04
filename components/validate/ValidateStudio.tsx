"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "../ui/Button";
import { SpecImport } from "./SpecImport";
import { OperationExplorer } from "./OperationExplorer";
import { loadContract } from "@/lib/validate/load";
import { resolveTarget } from "@/lib/validate/target";
import { validatePayload } from "@/lib/validate/engine";
import { pointerToFriendly, pointerToSegments } from "@/lib/validate/findings";
import { supportMatrix } from "@/lib/validate/adapter";
import { SAMPLE_FILE_NAME, SAMPLE_PAYLOAD, SAMPLE_SPEC } from "@/lib/validate/sample";
import type {
  ContractDiagnostic,
  Operation,
  ParsedContract,
  ValidationDirection,
  ValidationFinding,
  ValidationReport,
} from "@/lib/validate/types";

export const JSON_HANDOFF_KEY = "sf_json_handoff";

const STATUS_STYLES: Record<ParsedContract["status"], string> = {
  parsed: "bg-[#E9F3EC] text-[#2F7D4F] border-[#BFD9C6]",
  "parsed-with-warnings": "bg-[#F5EEDF] text-[#8A6A2F] border-[#DCC99A]",
  invalid: "bg-[#F9E8E6] text-[#B3261E] border-[#E5B8B2]",
  unsupported: "bg-[#F5F1E8] text-[#777168] border-[#E8E2D8]",
};

const STATUS_LABELS: Record<ParsedContract["status"], string> = {
  parsed: "Parsed",
  "parsed-with-warnings": "Parsed with warnings",
  invalid: "Invalid specification",
  unsupported: "Unsupported feature",
};

function parsePayload(text: string): { ok: boolean; value?: unknown; error?: string } {
  if (!text.trim()) return { ok: false, error: "Payload is empty - paste JSON to validate." };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const pos = /position (\d+)/.exec(msg)?.[1];
    let suffix = "";
    if (pos) {
      const idx = Number(pos);
      const before = text.slice(0, idx);
      suffix = ` (line ${before.split("\n").length}, column ${idx - before.lastIndexOf("\n")})`;
    }
    return { ok: false, error: `Invalid JSON: ${msg}${suffix}` };
  }
}

function severityDot(sev: string): string {
  return sev === "error" ? "bg-red-500" : sev === "warning" ? "bg-amber-500" : "bg-sky-500";
}

/** Validate workspace: contract conformance + payload validation. */
export function ValidateStudio() {
  const router = useRouter();
  const [contract, setContract] = useState<ParsedContract | null>(null);
  const [isSample, setIsSample] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null);
  const [direction, setDirection] = useState<ValidationDirection>("request");
  const [statusCode, setStatusCode] = useState<string>("");
  const [mediaType, setMediaType] = useState<string>("");
  const [payloadText, setPayloadText] = useState("");
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [selectedFinding, setSelectedFinding] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<"all" | "error" | "warning" | "info">("all");
  const [copied, setCopied] = useState(false);

  const importSpec = async (fileName: string, text: string, byteSize: number, sample: boolean) => {
    setBusy(true);
    try {
      const loaded = await loadContract(fileName, text, byteSize);
      setContract(loaded);
      setIsSample(sample);
      // Auto-select the first operation so the workspace is alive immediately.
      const first = loaded.operations[0] ?? null;
      setSelectedOpId(first?.id ?? null);
      setDirection(first?.request?.contentTypes.some((c) => c.supported) ? "request" : "response");
      setStatusCode("");
      setMediaType("");
      setReport(null);
      setCompileError(null);
      setStale(false);
      setSelectedFinding(null);
    } finally {
      setBusy(false);
    }
  };

  const removeContract = () => {
    setContract(null);
    setIsSample(false);
    setSelectedOpId(null);
    setReport(null);
    setCompileError(null);
    setStale(false);
  };

  const operation: Operation | null =
    contract?.operations.find((o) => o.id === selectedOpId) ?? null;

  const selectOperation = (id: string) => {
    setSelectedOpId(id);
    setReport(null);
    setCompileError(null);
    setStale(false);
    setSelectedFinding(null);
    const op = contract?.operations.find((o) => o.id === id);
    // Default direction: request when available, else response.
    const nextDir: ValidationDirection =
      op?.request?.contentTypes.some((c) => c.supported) ? "request" : "response";
    setDirection(nextDir);
    setStatusCode("");
    setMediaType("");
  };

  const requestOptions = operation?.request?.contentTypes.filter((c) => c.supported) ?? [];
  const responseOptions = useMemo(() => {
    if (!operation) return [];
    return operation.responses.filter((r) => r.contentTypes.some((c) => c.supported));
  }, [operation]);

  const resolution = useMemo(() => {
    if (!contract || !operation) return null;
    const mt =
      mediaType ||
      (direction === "request"
        ? requestOptions[0]?.mediaType
        : responseOptions
            .find((r) => r.statusCode === (statusCode || responseOptions[0]?.statusCode))
            ?.contentTypes.find((c) => c.supported)?.mediaType) ||
      "";
    const sc = direction === "response" ? statusCode || responseOptions[0]?.statusCode || "" : undefined;
    if (!mt) return { blocked: "No supported JSON schema for this selection." };
    return resolveTarget(contract, operation.id, direction, sc || undefined, mt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract, operation, direction, statusCode, mediaType]);

  const parsed = useMemo(() => parsePayload(payloadText), [payloadText]);
  const canValidate =
    !!resolution?.target && parsed.ok && !busy && contract?.status !== "invalid" && contract?.status !== "unsupported";

  const runValidation = () => {
    if (!resolution?.target || !parsed.ok) return;
    const { report: next, compileError: err } = validatePayload(resolution.target, parsed.value);
    if (err) {
      setCompileError(err);
      setReport(null);
    } else if (next) {
      setReport(next);
      setCompileError(null);
      setSelectedFinding(null);
    }
    setStale(false);
  };

  const markStale = () => {
    if (report) setStale(true);
  };

  const openInJsonStudio = (finding?: ValidationFinding) => {
    try {
      sessionStorage.setItem(
        JSON_HANDOFF_KEY,
        JSON.stringify({
          text: payloadText,
          path: finding ? pointerToSegments(finding.path) : null,
          source: "validate",
        })
      );
    } catch {
      /* storage unavailable - JSON Studio opens empty */
    }
    router.push("/json");
  };

  const copyFindings = async () => {
    if (!report) return;
    const text = JSON.stringify(
      {
        outcome: report.outcome,
        operation: report.target.operationId,
        direction: report.target.direction,
        statusCode: report.target.statusCode,
        mediaType: report.target.mediaType,
        findings: report.findings.map((f) => ({
          severity: f.severity,
          path: pointerToFriendly(f.path),
          rule: f.rule,
          message: f.message,
          expected: f.expected,
          actual: f.actual,
        })),
      },
      null,
      2
    );
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const visibleFindings = useMemo(() => {
    if (!report) return [];
    return severityFilter === "all" ? report.findings : report.findings.filter((f) => f.severity === severityFilter);
  }, [report, severityFilter]);

  const blockingDiags = contract?.diagnostics.filter((d) => d.blocking) ?? [];
  const advisoryDiags = contract?.diagnostics.filter((d) => !d.blocking) ?? [];

  if (!contract) {
    return (
      <SpecImport
        busy={busy}
        onLoad={(n, t, b) => importSpec(n, t, b, false)}
        onSample={() => {
          setPayloadText(SAMPLE_PAYLOAD);
          importSpec(SAMPLE_FILE_NAME, SAMPLE_SPEC, SAMPLE_SPEC.length, true);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header: title + contract status + import actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
        <div>
          <h2 className="text-[15px] font-semibold text-[#27241F]">API Contract &amp; Payload Conformance</h2>
          <p className="text-xs text-[#777168]">
            Validate API request and response payloads against OpenAPI contracts, inspect schema requirements, and pinpoint conformance issues.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SpecReplaceButton busy={busy} onLoad={(n, t, b) => importSpec(n, t, b, false)} />
          <Button size="sm" variant="ghost" onClick={removeContract}>
            Remove
          </Button>
        </div>
      </div>

      {/* Contract strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-[#E8E2D8] bg-[#FAF8F2] px-4 py-2.5 font-mono text-[11px] text-[#777168]">
        <span className="font-semibold text-[#27241F]">{contract.name}</span>
        {isSample && (
          <span className="rounded-md border border-[#DCC99A] bg-[#F5EEDF] px-1.5 py-0.5 text-[10px] font-semibold text-[#8A6A2F]">
            EXAMPLE - not your upload
          </span>
        )}
        <span className={`rounded-md border px-1.5 py-0.5 font-semibold ${STATUS_STYLES[contract.status]}`}>
          {STATUS_LABELS[contract.status]}
        </span>
        <span>OpenAPI {contract.version ?? "?"}</span>
        <span>{contract.operations.length} operations</span>
        <span>{contract.schemaCount} schemas</span>
      </div>

      {blockingDiags.length > 0 && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-800">
          <p className="font-semibold">This contract cannot be trusted for validation yet.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {blockingDiags.map((d) => (
              <li key={d.id}>{d.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Left: operation explorer */}
        <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
            Operations · {contract.operations.length}
          </p>
          <OperationExplorer operations={contract.operations} selectedId={selectedOpId} onSelect={selectOperation} />
        </div>

        {/* Center: target + payload + action */}
        <div className="space-y-4">
          <div className="rounded-xl border border-[#E8E2D8] bg-white p-4">
            {!operation ? (
              <p className="py-6 text-center text-[13px] text-[#A39B8E]">
                Select an operation to configure validation.
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-[13px] font-semibold text-[#27241F]">
                    {operation.method} {operation.path}
                  </p>
                  <p className="font-mono text-[11px] text-[#A39B8E]">
                    {operation.summary ?? operation.operationId ?? operation.id}
                  </p>
                </div>

                {/* Direction */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Direction</span>
                  {(
                    [
                      ["request", "Request", requestOptions.length > 0],
                      ["response", "Response", responseOptions.length > 0],
                    ] as [ValidationDirection, string, boolean][]
                  ).map(([dir, label, available]) => (
                    <button
                      key={dir}
                      type="button"
                      disabled={!available}
                      onClick={() => {
                        setDirection(dir);
                        setStatusCode("");
                        setMediaType("");
                        setReport(null);
                        setCompileError(null);
                        setStale(false);
                      }}
                      aria-pressed={direction === dir}
                      title={available ? `Validate the ${dir}` : `No ${dir} schema in this operation`}
                      className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                        !available
                          ? "cursor-not-allowed border-[#E8E2D8] bg-[#F5F1E8] text-[#C9C2B4]"
                          : direction === dir
                            ? "border-[#211F1B] bg-[#211F1B] text-white"
                            : "cursor-pointer border-[#E8E2D8] bg-white text-[#777168] hover:text-[#27241F]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  {operation.request?.required && direction === "request" && (
                    <span className="font-mono text-[10px] text-[#8A6A2F]">request body required by contract</span>
                  )}
                </div>

                {/* Status + media selectors */}
                <div className="flex flex-wrap items-center gap-2">
                  {direction === "response" && (
                    <label className="flex items-center gap-1.5 text-[11px] text-[#777168]">
                      Status
                      <select
                        value={statusCode || responseOptions[0]?.statusCode || ""}
                        onChange={(e) => {
                          setStatusCode(e.target.value);
                          setMediaType("");
                          setReport(null);
                          setStale(false);
                        }}
                        className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-1.5 py-1 font-mono text-[11px]"
                      >
                        {responseOptions.map((r) => (
                          <option key={r.statusCode} value={r.statusCode}>
                            {r.statusCode}{r.description ? ` - ${r.description}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="flex items-center gap-1.5 text-[11px] text-[#777168]">
                    Media type
                    <select
                      value={
                        mediaType ||
                        (direction === "request" ? requestOptions[0]?.mediaType : responseOptions
                          .find((r) => r.statusCode === (statusCode || responseOptions[0]?.statusCode))
                          ?.contentTypes.find((c) => c.supported)?.mediaType) ||
                        ""
                      }
                      onChange={(e) => {
                        setMediaType(e.target.value);
                        setReport(null);
                        setStale(false);
                      }}
                      className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-1.5 py-1 font-mono text-[11px]"
                    >
                      {(direction === "request"
                        ? requestOptions.map((c) => c.mediaType)
                        : (responseOptions.find((r) => r.statusCode === (statusCode || responseOptions[0]?.statusCode))?.contentTypes ?? [])
                            .filter((c) => c.supported)
                            .map((c) => c.mediaType)
                      ).map((mt) => (
                        <option key={mt} value={mt}>
                          {mt}
                        </option>
                      ))}
                    </select>
                  </label>
                  {resolution && "blocked" in resolution && resolution.blocked && (
                    <span className="text-[11px] text-red-700">{resolution.blocked}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Payload editor */}
          <div className="rounded-xl border border-[#E8E2D8] bg-white p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Payload (JSON)</p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    try {
                      const v = JSON.parse(payloadText);
                      setPayloadText(JSON.stringify(v, null, 2));
                    } catch {
                      /* parse error shown below */
                    }
                  }}
                >
                  Format
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPayloadText("");
                    setReport(null);
                    setStale(false);
                  }}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(payloadText);
                    } catch {
                      /* clipboard unavailable */
                    }
                  }}
                >
                  Copy
                </Button>
                <Button size="sm" onClick={() => openInJsonStudio()} disabled={!parsed.ok}>
                  Open in JSON Studio
                </Button>
              </div>
            </div>
            <textarea
              value={payloadText}
              onChange={(e) => {
                setPayloadText(e.target.value);
                markStale();
              }}
              rows={14}
              spellCheck={false}
              aria-label="JSON payload to validate"
              placeholder='{"key": "value"}'
              className="w-full rounded-lg border border-[#E8E2D8] bg-[#FCFBF8] p-3 font-mono text-[12px] leading-relaxed text-[#27241F] focus:border-[#A98450] focus:outline-none"
            />
            {!parsed.ok && (
              <p role="alert" className="mt-1.5 text-[12px] text-red-700">
                {parsed.error}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={runValidation} disabled={!canValidate}>
                Validate Payload
              </Button>
              {stale && report && (
                <span className="rounded-md border border-[#DCC99A] bg-[#F5EEDF] px-2 py-1 text-[11px] font-semibold text-[#8A6A2F]">
                  Payload changed — revalidate
                </span>
              )}
              {!canValidate && operation && (
                <span className="text-[11px] text-[#A39B8E]">
                  {!parsed.ok ? "Fix JSON to enable validation." : "Resolve a supported schema to enable validation."}
                </span>
              )}
            </div>
          </div>

          {/* Results */}
          {compileError && (
            <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
              <p className="font-semibold">Schema configuration error — not a payload failure.</p>
              <p className="mt-0.5 font-mono text-[11px] break-all">{compileError}</p>
            </div>
          )}

          {report && (
            <div className="rounded-xl border border-[#E8E2D8] bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-lg border px-2.5 py-1 text-[12px] font-bold ${
                      report.outcome === "valid"
                        ? "border-[#BFD9C6] bg-[#E9F3EC] text-[#2F7D4F]"
                        : "border-[#E5B8B2] bg-[#F9E8E6] text-[#B3261E]"
                    }`}
                    role="status"
                  >
                    {report.outcome === "valid" ? "Valid" : "Invalid"}
                  </span>
                  <span className="font-mono text-[11px] text-[#777168]">
                    {report.errors} errors · {report.warnings} warnings · {report.infos} info · {report.durationMs.toFixed(1)} ms
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={copyFindings}>
                    {copied ? "Copied" : "Copy Findings"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openInJsonStudio()}>
                    Open in JSON Studio
                  </Button>
                </div>
              </div>
              <p className="mt-1.5 font-mono text-[11px] text-[#A39B8E]">
                {report.target.operationId} · {report.target.direction}
                {report.target.statusCode ? ` · ${report.target.statusCode}` : ""} · {report.target.mediaType} · {report.target.dialect.includes("2020-12") ? "Draft 2020-12" : report.target.dialect}
              </p>

              {report.findings.length > 0 && (
                <>
                  <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Filter findings by severity">
                    {(["all", "error", "warning", "info"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSeverityFilter(s)}
                        aria-pressed={severityFilter === s}
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold cursor-pointer ${
                          severityFilter === s
                            ? "border-[#211F1B] bg-[#211F1B] text-white"
                            : "border-[#E8E2D8] bg-white text-[#777168] hover:text-[#27241F]"
                        }`}
                      >
                        {s === "all" ? `All (${report.findings.length})` : `${s} (${report.findings.filter((f) => f.severity === s).length})`}
                      </button>
                    ))}
                  </div>
                  <ul className="mt-2 max-h-[420px] space-y-1.5 overflow-y-auto">
                    {visibleFindings.map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFinding(f.id);
                            openInJsonStudio(f);
                          }}
                          title="Open payload at this path in JSON Studio"
                          className={`flex w-full cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                            selectedFinding === f.id ? "border-[#A98450] bg-[#FAF3E3]" : "border-[#F0EBE0] hover:border-[#D8CFC0] hover:bg-[#FAF8F2]"
                          }`}
                        >
                          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severityDot(f.severity)}`} aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12px] font-medium text-[#27241F]">{f.message}</span>
                            <span className="mt-0.5 block font-mono text-[11px] text-[#A98450]">{pointerToFriendly(f.path)}</span>
                            <span className="mt-0.5 block font-mono text-[10px] text-[#A39B8E]">
                              {f.rule}
                              {f.expected !== undefined ? ` · expected ${JSON.stringify(f.expected)?.slice(0, 80)}` : ""}
                              {f.actual !== undefined ? ` · actual ${JSON.stringify(f.actual)?.slice(0, 80)}` : ""}
                              {f.schemaPath ? ` · ${f.schemaPath}` : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {report.outcome === "valid" && (
                <p className="mt-2 text-[12px] text-[#2F7D4F]">
                  Payload conforms to the selected schema.
                  {contract.status === "parsed-with-warnings" ? " Contract parsed with warnings - see diagnostics." : ""}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Diagnostics + support matrix */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[#E8E2D8] bg-white p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
            Contract diagnostics · {contract.diagnostics.length}
          </p>
          {contract.diagnostics.length === 0 ? (
            <p className="text-[12px] text-[#2F7D4F]">Clean - no diagnostics.</p>
          ) : (
            <ul className="max-h-[300px] space-y-1.5 overflow-y-auto">
              {[...blockingDiags, ...advisoryDiags].map((d: ContractDiagnostic) => (
                <li key={d.id} className="rounded-lg border border-[#F0EBE0] px-2.5 py-2">
                  <span className="flex items-center gap-2 text-[12px] font-medium text-[#27241F]">
                    <span className={`h-2 w-2 rounded-full ${severityDot(d.severity)}`} aria-hidden="true" />
                    {d.severity}
                    {d.blocking && <span className="font-mono text-[10px] text-red-700">· blocking</span>}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-[#55504A]">{d.message}</span>
                  {d.location && <span className="block font-mono text-[10px] text-[#A39B8E]">{d.location}</span>}
                  {d.hint && <span className="block text-[11px] text-[#8A6A2F]">↳ {d.hint}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-[#E8E2D8] bg-white p-4">
          <details>
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
              Support matrix · for this contract (OpenAPI {contract.version ?? "?"})
            </summary>
            <p className="mt-1 text-[11px] text-[#A39B8E]">
              Both OpenAPI 3.0.x and 3.1.x are supported — this matrix follows the loaded contract.
            </p>
            <table className="mt-2 w-full text-left text-[11px]">
              <tbody>
                {supportMatrix(contract.version ?? "3.0.0").map((row) => (
                  <tr key={row.feature} className="border-t border-[#F0EBE0]">
                    <td className="py-1.5 pr-2 font-semibold text-[#27241F]">{row.feature}</td>
                    <td className="py-1.5 pr-2 font-mono">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          row.status === "supported"
                            ? "bg-[#E9F3EC] text-[#2F7D4F]"
                            : row.status === "limited"
                              ? "bg-[#F5EEDF] text-[#8A6A2F]"
                              : row.status === "unsupported"
                                ? "bg-[#F9E8E6] text-[#B3261E]"
                                : "bg-[#F5F1E8] text-[#777168]"
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="py-1.5 text-[#777168]">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <p className="mt-3 text-[11px] leading-relaxed text-[#A39B8E]">
            Browser-local validation. Specs and payloads never leave this page — no remote $ref fetching, no AI judgments.
          </p>
        </div>
      </div>
    </div>
  );
}

function SpecReplaceButton({
  busy,
  onLoad,
}: {
  busy: boolean;
  onLoad: (fileName: string, text: string, byteSize: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  if (!open) {
    return (
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(true)}>
        Replace
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste spec, or pick a file…"
        aria-label="Replace specification"
        spellCheck={false}
        className="w-44 rounded-lg border border-[#E8E2D8] px-2 py-1 font-mono text-[11px] focus:border-[#A98450] focus:outline-none"
      />
      <Button
        size="sm"
        disabled={busy || !text.trim()}
        onClick={() => {
          onLoad("replaced-specification", text, new Blob([text]).size);
          setText("");
          setOpen(false);
        }}
      >
        Load
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        ✕
      </Button>
    </span>
  );
}
