"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  buildCustomFieldPatch,
  buildGlobalValueSetPatch,
  buildRecordTypePatch,
  fieldIdQuery,
  globalSetQuery,
  isMasterRecordType,
  parseAvailability,
  parseFieldValueSet,
  parseGlobalValueSet,
  parseRtPicklists,
  recordTypeListQuery,
  splitNewValues,
  toolingQueryPath,
  toolingSobjectPath,
  uiApiAvailabilityPath,
  validateNewValues,
  withAdditions,
  type PickEntry,
  type RecordTypeSummary,
} from "@/lib/salesforce/picklistValues";

interface LoadedState {
  current: PickEntry[];
  target: { kind: "field"; id: string } | { kind: "global"; id: string; name: string };
  restricted: boolean;
  recordTypes: (RecordTypeSummary & { available: string[] | null })[];
}

interface StepResult {
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * Add values to an EXISTING picklist field without visiting Setup.
 * Step 1 merges into the field's global set (CustomField or GlobalValueSet
 * when global-backed - the PATCH always carries the complete list). Step 2
 * appends the new values to each chosen record type's override, because a
 * value is invisible on a record type until it is listed there. Master is
 * automatic and never patched.
 */
export function AddPicklistValuesDialog({
  objectApi,
  objectLabel,
  fieldApi,
  fieldLabel,
  instanceUrl,
  apiVersion,
  getToken,
  isProduction,
  onClose,
  onApplied,
  onSessionExpired,
}: {
  objectApi: string;
  objectLabel: string;
  fieldApi: string;
  fieldLabel: string;
  instanceUrl: string;
  apiVersion: string;
  getToken: () => string | null;
  isProduction: boolean;
  onClose: () => void;
  onApplied: () => void;
  onSessionExpired?: () => void;
}) {
  const [phase, setPhase] = useState<"loading" | "edit" | "working" | "done">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [draft, setDraft] = useState("");
  const [checkedRt, setCheckedRt] = useState<Set<string>>(new Set());
  const [prodAck, setProdAck] = useState(false);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [workingLabel, setWorkingLabel] = useState("");

  async function rest<T>(method: "GET" | "PATCH", path: string, body?: Record<string, unknown>): Promise<T> {
    const token = getToken();
    if (!token) throw new Error("Session token unavailable. Please reconnect.");
    const response = await apiFetch("/api/salesforce/rest", {
      instanceUrl,
      token,
      scope: "org",
      method,
      path,
      ...(body ? { body: JSON.stringify(body) } : {}),
      auth: { type: "bearer", token },
    });
    const data = (await response.json()) as { success?: boolean; status?: number; body?: unknown; error?: string };
    if (!response.ok || data.success === false) {
      const message =
        (typeof data.error === "string" && data.error) ||
        (data.body && typeof data.body === "object"
          ? (data.body as { message?: unknown }).message
          : null);
      const text = typeof message === "string" && message ? message : `Request failed (${data.status ?? response.status}).`;
      if (/session expired|invalid session/i.test(text)) onSessionExpired?.();
      throw new Error(text);
    }
    return data.body as T;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const devName = fieldApi.replace(/__c$/, "");
        const fieldRows = await rest<{ records?: { Id: string; Metadata?: unknown }[] }>(
          "GET",
          toolingQueryPath(apiVersion, fieldIdQuery(objectApi, devName)),
        );
        const field = (fieldRows.records ?? [])[0];
        if (!field) throw new Error(`${fieldApi} is not a custom field on ${objectApi} - only custom picklists can grow here.`);
        const vs = parseFieldValueSet(field.Metadata);
        if (!vs) throw new Error(`${fieldApi} has no value set to extend.`);
        let current = vs.values;
        let target: LoadedState["target"] = { kind: "field", id: field.Id };
        if (vs.globalSetName) {
          const gRows = await rest<{ records?: { Id: string; Metadata?: unknown }[] }>(
            "GET",
            toolingQueryPath(apiVersion, globalSetQuery(vs.globalSetName)),
          );
          const g = (gRows.records ?? [])[0];
          if (!g) throw new Error(`Global value set ${vs.globalSetName} not found.`);
          const gv = parseGlobalValueSet(g.Metadata);
          if (!gv) throw new Error(`Global value set ${vs.globalSetName} is unreadable.`);
          current = gv;
          target = { kind: "global", id: g.Id, name: vs.globalSetName };
        }
        const rtRows = await rest<{ records?: RecordTypeSummary[] }>(
          "GET",
          toolingQueryPath(apiVersion, recordTypeListQuery(objectApi)),
        );
        const summaries = (rtRows.records ?? []).filter((r) => r && typeof r.id === "string" && r.id) as RecordTypeSummary[];
        const withAvail = await Promise.all(
          summaries.map(async (rt) => {
            if (isMasterRecordType(rt.id)) return { ...rt, available: null as string[] | null };
            try {
              const payload = await rest<unknown>("GET", uiApiAvailabilityPath(apiVersion, objectApi, rt.id));
              return { ...rt, available: parseAvailability(payload, fieldApi) };
            } catch {
              return { ...rt, available: null as string[] | null };
            }
          }),
        );
        if (cancelled) return;
        setLoaded({ current, target, restricted: vs.restricted, recordTypes: withAvail });
        // Pre-check record types missing at least one current value's company:
        // default to the ones that will actually change, decided after typing.
        setCheckedRt(new Set(withAvail.filter((r) => !isMasterRecordType(r.id)).map((r) => r.id)));
        setPhase("edit");
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Could not load picklist state.");
          setPhase("edit");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const candidates = useMemo(() => splitNewValues(draft), [draft]);
  const validation = useMemo(
    () => (loaded ? validateNewValues(loaded.current, candidates) : { ok: [], problems: [] }),
    [loaded, candidates],
  );

  const rtMissing = useMemo(() => {
    if (!loaded) return new Map<string, string[]>();
    const map = new Map<string, string[]>();
    for (const rt of loaded.recordTypes) {
      if (isMasterRecordType(rt.id)) continue;
      if (rt.available === null) {
        map.set(rt.id, [...validation.ok]);
        continue;
      }
      const have = new Set(rt.available.map((v) => v.toLowerCase()));
      map.set(
        rt.id,
        validation.ok.filter((v) => !have.has(v.toLowerCase())),
      );
    }
    return map;
  }, [loaded, validation.ok]);

  const deployable = (loaded !== null && validation.ok.length > 0 && !loadError && (!isProduction || prodAck)) === true;

  async function deploy() {
    if (!loaded || validation.ok.length === 0) return;
    setPhase("working");
    setSteps([]);
    const results: StepResult[] = [];
    const push = (s: StepResult) => {
      results.push(s);
      setSteps([...results]);
    };
    const merged = withAdditions(loaded.current, validation.ok);
    // Step 1: the field (or its global set) - the complete list, never a delta.
    try {
      setWorkingLabel(loaded.target.kind === "global" ? `Updating global set ${loaded.target.name}…` : `Updating ${fieldApi}…`);
      const patch = loaded.target.kind === "global" ? buildGlobalValueSetPatch(merged) : buildCustomFieldPatch(merged);
      await rest("PATCH", toolingSobjectPath(apiVersion, loaded.target.kind === "global" ? "GlobalValueSet" : "CustomField", loaded.target.id), patch);
      push({
        label: loaded.target.kind === "global" ? `Global set ${loaded.target.name}` : `Field ${objectApi}.${fieldApi}`,
        ok: true,
        detail: `${merged.length} values live (${validation.ok.length} new).`,
      });
    } catch (err) {
      push({
        label: `Field ${objectApi}.${fieldApi}`,
        ok: false,
        detail: err instanceof Error ? err.message : "Field update failed - record types untouched.",
      });
      setPhase("done");
      return;
    }
    // Step 2: each chosen record type gets the new values appended.
    for (const rt of loaded.recordTypes) {
      if (isMasterRecordType(rt.id) || !checkedRt.has(rt.id)) continue;
      const missing = rtMissing.get(rt.id) ?? [];
      if (missing.length === 0) {
        push({ label: `Record type ${rt.name}`, ok: true, detail: "Already offers every new value - skipped." });
        continue;
      }
      try {
        setWorkingLabel(`Assigning to ${rt.name}…`);
        const full = await rest<{ Metadata?: unknown }>("GET", toolingSobjectPath(apiVersion, "RecordType", rt.id));
        const patch = buildRecordTypePatch(parseRtPicklists(full.Metadata), fieldApi, validation.ok);
        await rest("PATCH", toolingSobjectPath(apiVersion, "RecordType", rt.id), patch);
        push({ label: `Record type ${rt.name}`, ok: true, detail: `${missing.length} value${missing.length === 1 ? "" : "s"} now available.` });
      } catch (err) {
        push({ label: `Record type ${rt.name}`, ok: false, detail: err instanceof Error ? err.message : "Record type update failed." });
      }
    }
    setWorkingLabel("");
    setPhase("done");
    onApplied();
  }

  const fieldTargetNote =
    loaded?.target.kind === "global"
      ? `Global-backed (${loaded.target.name}) - one edit serves every field on it.`
      : "Local value set - this field only.";

  return (
    <div role="dialog" aria-modal="true" aria-label={`Add values to ${fieldApi}`} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-5" onClick={onClose}>
      <div className="flex h-[calc(100vh-40px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2 border-b border-[#E8E2D8] px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold text-[#27241F]">Add picklist values</h3>
            <p className="truncate font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
              {objectLabel} · {fieldLabel} · {loaded ? `${loaded.current.length} values` : "loading…"}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded p-1.5 text-[#A39B8E] hover:bg-[#F5F1E8] hover:text-[#27241F]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {phase === "loading" && <p className="py-8 text-center text-[13px] text-[#777168]">Reading the value set and record types from the org…</p>}

          {phase !== "loading" && (
            <>
              {loadError && (
                <p role="alert" className="rounded-xl border border-[#E5AFAF] bg-[#F9E9E9] px-3 py-2 text-[12px] text-[#A02C2C]">{loadError}</p>
              )}
              {loaded && (
                <>
                  <p className="rounded-xl border border-[#E8E2D8] bg-[#FBFAF7] px-3 py-2 text-[12px] text-[#3A352D]">
                    {fieldTargetNote} {loaded.restricted ? "Restricted: values outside the list stay blocked." : "Unrestricted."} Master record type picks new values up automatically.
                  </p>
                  <div>
                    <label htmlFor="add-pick-values" className="mb-1 block text-[12px] font-semibold text-[#3A352D]">
                      New values <span className="font-normal text-[#A39B8E]">· one per line, comma or semicolon</span>
                    </label>
                    <textarea
                      id="add-pick-values"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={5}
                      autoFocus
                      placeholder={"Partner\nStrategic\nAt Risk"}
                      spellCheck={false}
                      disabled={phase === "working" || phase === "done"}
                      className="w-full resize-y rounded-xl border border-[#E8E2D8] bg-white px-3 py-2 font-mono text-[12px] leading-relaxed text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none disabled:opacity-60"
                    />
                    {validation.problems.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {validation.problems.map((p, i) => (
                          <li key={i} className="text-[11px] text-[#8A6A2F]">{p}</li>
                        ))}
                      </ul>
                    )}
                    {validation.ok.length > 0 && (
                      <p className="mt-1 text-[12px] font-semibold text-[#3E6B34]">{validation.ok.length} new value{validation.ok.length === 1 ? "" : "s"}: {validation.ok.join(", ")}</p>
                    )}
                  </div>
                  <div>
                    <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">Record types · make the new values available</p>
                    <ul className="mt-1.5 space-y-1.5">
                      {loaded.recordTypes.map((rt) => {
                        if (isMasterRecordType(rt.id)) {
                          return (
                            <li key={rt.id} className="flex items-center gap-2 rounded-xl border border-[#E8E2D8] bg-[#FBFAF7] px-3 py-2 opacity-70">
                              <span className="text-[12px] font-semibold text-[#27241F]">{rt.name}</span>
                              <span className="ml-auto font-mono text-[10px] text-[#777168]">master · automatic</span>
                            </li>
                          );
                        }
                        const missing = rtMissing.get(rt.id) ?? [];
                        return (
                          <li key={rt.id}>
                            <label className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 ${checkedRt.has(rt.id) ? "border-[#C9A86A] bg-[#FBFAF7]" : "border-[#E8E2D8] bg-white"}`}>
                              <input
                                type="checkbox"
                                checked={checkedRt.has(rt.id)}
                                disabled={phase === "working" || phase === "done" || !rt.isActive}
                                onChange={(e) => {
                                  const next = new Set(checkedRt);
                                  if (e.target.checked) next.add(rt.id);
                                  else next.delete(rt.id);
                                  setCheckedRt(next);
                                }}
                                className="h-3.5 w-3.5 accent-[#7A5C3A]"
                              />
                              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#27241F]">
                                {rt.name} {!rt.isActive && <span className="font-normal text-[#A39B8E]">(inactive)</span>}
                              </span>
                              <span className="shrink-0 font-mono text-[10px] text-[#777168]">
                                {rt.available === null
                                  ? "availability unknown"
                                  : missing.length === 0 && validation.ok.length > 0
                                    ? "already complete"
                                    : `${rt.available.length} visible now`}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                      {loaded.recordTypes.length === 0 && (
                        <li className="text-[12px] text-[#A39B8E]">No record types on {objectApi} - the field update is the whole job.</li>
                      )}
                    </ul>
                  </div>
                  {isProduction && phase !== "done" && (
                    <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                      <input type="checkbox" checked={prodAck} onChange={(e) => setProdAck(e.target.checked)} className="h-3.5 w-3.5 accent-[#7A5C3A]" />
                      Production org - I understand this goes live immediately.
                    </label>
                  )}
                </>
              )}
              {(phase === "working" || phase === "done") && (
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">
                    {phase === "working" ? workingLabel || "Deploying…" : "Result"}
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {steps.map((s, i) => (
                      <li key={i} className={`rounded-xl border px-3 py-2 text-[12px] ${s.ok ? "border-[#B5CFA8] bg-[#EBF2E6] text-[#3E6B34]" : "border-[#E5AFAF] bg-[#F9E9E9] text-[#A02C2C]"}`}>
                        <span className="font-semibold">{s.ok ? "✓" : "✗"} {s.label}</span>
                        <span className="block font-normal">{s.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 border-t border-[#E8E2D8] px-5 py-3">
          {phase === "done" ? (
            <button type="button" onClick={onClose} className="cursor-pointer rounded-lg bg-[#27241F] px-4 py-1.5 text-xs font-semibold text-[#F5F1E8] hover:bg-[#3A352D]">
              Done
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={phase === "working"} className="cursor-pointer rounded-lg border border-[#E8E2D8] px-3 py-1.5 text-xs font-semibold text-[#27241F] hover:border-[#C9A86A] disabled:opacity-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deploy()}
                disabled={!deployable || phase === "working" || phase === "loading"}
                title={
                  !loaded || validation.ok.length === 0
                    ? "Type at least one new value"
                    : isProduction && !prodAck
                      ? "Acknowledge production first"
                      : "Write the field, then the chosen record types"
                }
                className="cursor-pointer rounded-lg bg-[#27241F] px-4 py-1.5 text-xs font-semibold text-[#F5F1E8] hover:bg-[#3A352D] disabled:cursor-default disabled:opacity-40"
              >
                Deploy values
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
