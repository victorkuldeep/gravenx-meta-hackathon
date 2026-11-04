import { beforeEach, describe, expect, it } from "vitest";
import { registerDebugBridge } from "@/lib/log-decomposer/debugBridge";
import { parseLog } from "@/lib/log-decomposer/parser";
import { detectFindings } from "@/lib/log-decomposer/findings";
import { newDebugSession, type DebugSession } from "@/lib/log-decomposer/model";
import { DEBUG_TOOLS } from "./logDecomposerTools";
import { skillForPath } from "./skills";
import { toolsForSkill } from "./toolsSystem";

const LOG = [
  "10:00:00.000 (0)|EXECUTION_STARTED",
  "10:00:00.010 (10000000)|CODE_UNIT_STARTED|[EXTERNAL]|01pxx|OrderService.placeOrder",
  "10:00:01.000 (1000000000)|CALLOUT_REQUEST|[20]|System.HttpRequest[Endpoint=https://hub.example.com/orders, Method=POST]",
  "10:00:01.500 (1500000000)|EXCEPTION_THROWN|[20]|System.CalloutException: Read timed out",
  "10:00:12.000 (12000000000)|CALLOUT_RESPONSE|[20]|System.HttpResponse[Status=Gateway Timeout, StatusCode=504]",
  "10:00:12.020 (12020000000)|EXECUTION_FINISHED",
].join("\n");

let session: DebugSession;

function tool(name: string) {
  const t = DEBUG_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

beforeEach(() => {
  const { model } = parseLog(LOG, "07Lx");
  model.findings = detectFindings(model);
  session = {
    ...newDebugSession("org1", "Order sync timeout", "Orders fail at checkout"),
    status: "parsed",
    logs: [
      {
        id: "log_07Lx",
        sessionId: "dbg_x",
        salesforceLogId: "07Lx",
        operation: "/services/apex",
        capturedAt: Date.now(),
        body: LOG,
        truncated: false,
      },
    ],
    executions: [model],
  };
  registerDebugBridge({
    getSession: () => session,
    getExecution: (id) => session.executions.find((e) => e.executionId === id) ?? null,
    apply: async (fn) => {
      session = fn(session);
      return { ok: true };
    },
  });
});

describe("debug investigator tools", () => {
  it("describes the session census", async () => {
    const out = await tool("debug_describe").execute({});
    expect(out.ok).toBe(true);
    const r = out.result as { executions: Array<{ findings: number }> };
    expect(r.executions[0].findings).toBeGreaterThan(0);
  });

  it("lists findings and exception context with chains", async () => {
    const f = await tool("debug_findings").execute({});
    expect(f.ok).toBe(true);
    expect((f.result as unknown[]).length).toBeGreaterThan(0);
    const e = await tool("debug_exceptions").execute({});
    const rows = (e.result as Array<{ message: string; chain: string[] }>)[0];
    expect(rows.message).toContain("CalloutException");
    expect(rows.chain.join(" ")).toContain("OrderService");
  });

  it("inspects a node and quotes a bounded raw range", async () => {
    const callout = session.executions[0].nodes.find((n) => n.type === "CALLOUT")!;
    const n = await tool("debug_node").execute({ nodeId: callout.id });
    expect(n.ok).toBe(true);
    const bad = await tool("debug_node").execute({ nodeId: "n999" });
    expect(bad.ok).toBe(false);
    const r = await tool("debug_raw_range").execute({ lineStart: 0, lineEnd: 2 });
    expect(r.ok).toBe(true);
    expect((r.result as { lines: unknown[] }).lines).toHaveLength(3);
    const wide = await tool("debug_raw_range").execute({ lineStart: 0, lineEnd: 100 });
    expect(wide.ok).toBe(false);
  });

  it("drafts the RCA through Apply and composes the brief", async () => {
    const d = await tool("debug_rca_draft").execute({});
    expect(d.ok).toBe(true);
    expect(session.rca?.summary).toContain("CalloutException");
    expect(session.status).toBe("diagnosed");
    const b = await tool("debug_brief").execute({});
    expect(b.ok).toBe(true);
    expect(String(b.result)).toContain("Root cause");
    expect(String(b.result)).toContain("lines 1-7");
  });

  it("reports honestly with no session", async () => {
    registerDebugBridge(null);
    await expect(tool("debug_describe").execute({})).resolves.toMatchObject({ ok: false });
  });
});

describe("debug skill wiring", () => {
  it("routes /log-decomposer to the debug pack with tools", () => {
    expect(skillForPath("/log-decomposer").name).toBe("debug");
    expect(skillForPath("/log-decomposer/rca").name).toBe("debug");
    expect(toolsForSkill("debug").map((t) => t.name)).toEqual(DEBUG_TOOLS.map((t) => t.name));
    expect(toolsForSkill("debug").filter((t) => t.needsApproval).map((t) => t.name)).toEqual(["debug_rca_draft"]);
  });
});
