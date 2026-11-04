import { describe, expect, it } from "vitest";
import {
  canTransition,
  capRawBody,
  debugSessionSchema,
  executionModelSchema,
  findingSchema,
  logTimestamp,
  MAX_RAW_BYTES,
  newDebugSession,
  sessionFindings,
  sessionTraces,
} from "./model";
import { deleteDebugSession, listDebugSessions, loadDebugSession, saveDebugSession } from "./sessionDb";

describe("debug lifecycle", () => {
  it("walks open -> capturing -> parsed -> diagnosed -> handed-off", () => {
    expect(canTransition("open", "capturing")).toBe(true);
    expect(canTransition("capturing", "parsed")).toBe(true);
    expect(canTransition("parsed", "diagnosed")).toBe(true);
    expect(canTransition("diagnosed", "handed-off")).toBe(true);
    expect(canTransition("open", "parsed")).toBe(false);
    expect(canTransition("handed-off", "capturing")).toBe(false);
    expect(canTransition("diagnosed", "capturing")).toBe(true);
  });

  it("rejects sessions with unknown status", () => {
    const s = { ...newDebugSession("org", "t"), status: "vibing" };
    expect(debugSessionSchema.safeParse(s).success).toBe(false);
  });

  it("prefers org StartTime over capture time for ordering", () => {
    expect(logTimestamp({ startTime: "2026-11-02T00:00:00.000Z", capturedAt: 5 })).toBe(Date.parse("2026-11-02T00:00:00.000Z"));
    expect(logTimestamp({ startTime: "not-a-date", capturedAt: 42 })).toBe(42);
    expect(logTimestamp({ capturedAt: 7 })).toBe(7);
  });

  it("lists trace tabs, migrating the legacy single trace", () => {
    const legacy = { target: { kind: "user", id: "005u", name: "Me" }, preset: "smart" } as const;
    expect(sessionTraces({ traces: [], trace: { ...legacy, target: { ...legacy.target } } })).toHaveLength(1);
    expect(sessionTraces({})).toEqual([]);
  });

  it("backfills investigation on pre-investigation sessions", () => {
    const legacy = { ...newDebugSession("org", "t") } as unknown as Record<string, unknown>;
    delete legacy.investigation;
    const parsed = debugSessionSchema.parse(legacy);
    expect(parsed.investigation).toEqual({ hypotheses: [], questions: [] });
  });
});

describe("raw body cap", () => {
  it("passes small bodies through untouched", () => {
    expect(capRawBody("abc")).toEqual({ body: "abc", truncated: false });
  });

  it("cuts at MAX_RAW_BYTES and flags truncation", () => {
    const big = "x".repeat(MAX_RAW_BYTES + 10);
    const out = capRawBody(big);
    expect(out.body.length).toBe(MAX_RAW_BYTES);
    expect(out.truncated).toBe(true);
  });
});

describe("execution model + findings", () => {
  it("accepts a minimal valid execution with rolled-up findings", () => {
    const finding = findingSchema.parse({
      id: "f1",
      type: "EXCEPTION",
      severity: "CRITICAL",
      title: "NullPointerException",
      summary: "Deref of null account in handler",
      evidence: [{ kind: "event", ref: "e12", label: "EXCEPTION_THROWN", lineStart: 120, lineEnd: 120 }],
      relatedNodeIds: ["n3"],
    });
    const exec = executionModelSchema.parse({
      executionId: "ex1",
      logId: "log1",
      rootIds: ["n1"],
      nodes: [{ id: "n1", type: "TRANSACTION", label: "trigger", children: [], eventIds: [] }],
      events: [],
      unknownEventCount: 2,
      findings: [finding],
      metrics: { eventCount: 50, soqlCount: 3, dmlCount: 1, calloutCount: 0, exceptionCount: 1 },
    });
    const s = { ...newDebugSession("org", "t"), executions: [exec] };
    expect(sessionFindings(s)).toHaveLength(1);
  });

  it("rejects findings without evidence-typed refs", () => {
    expect(() => findingSchema.parse({ id: "f", type: "NOPE", severity: "LOW", title: "t", summary: "s" })).toThrow();
  });
});

describe("debug session store degradation", () => {
  it("never throws off-browser", async () => {
    // happy-dom has no IndexedDB: every op degrades to a safe empty.
    await expect(listDebugSessions("org")).resolves.toEqual([]);
    await expect(loadDebugSession("missing")).resolves.toBeNull();
    await expect(saveDebugSession(newDebugSession("org", "t"))).resolves.toMatchObject({ ok: false });
    await expect(deleteDebugSession("id")).resolves.toBe(false);
  });
});
