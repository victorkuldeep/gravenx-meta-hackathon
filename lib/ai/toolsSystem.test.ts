import { describe, expect, it, vi, beforeEach } from "vitest";
import { runAgentLoop, type AgentTool } from "./tools";
import { registerSystemBridge } from "./systemBridge";
import { SYSTEM_TOOLS, toolsForSkill } from "./toolsSystem";
import { z } from "zod";

function sse(chunks: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } }),
    { status: 200 },
  );
}

const txt = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
const call = (id: string, name: string, args: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: args } }] } }] })}\n\n`;
const DONE = "data: [DONE]\n\n";

const base = { baseURL: "https://x.test/v1", apiKey: "k", model: "m", system: "sys", history: [] as never[] };

beforeEach(() => registerSystemBridge(null));

describe("agent loop", () => {
  it("answers directly when the model makes no calls", async () => {
    const fetchImpl = (async () => sse([txt("Hello"), DONE])) as unknown as typeof fetch;
    const r = await runAgentLoop({ ...base, tools: [], fetchImpl });
    expect(r.text).toBe("Hello");
    expect(r.steps).toBe(1);
  });

  it("auto-runs read tools and feeds results back", async () => {
    registerSystemBridge({
      getSnapshot: () => ({ name: "P", systems: [], connections: [], interfaceCount: 0, operationCount: 0, flowCount: 0, scenarioCount: 0, dirty: false }),
      apply: () => ({ ok: true }),
      getProject: () => null,
    });
    const seen: string[] = [];
    const fetchImpl = (async () => {
      seen.push("call");
      if (seen.length === 1) return sse([call("c1", "system_describe", "{}"), DONE]);
      return sse([txt("Canvas is empty."), DONE]);
    }) as unknown as typeof fetch;
    const r = await runAgentLoop({ ...base, tools: SYSTEM_TOOLS, fetchImpl });
    expect(r.steps).toBe(2);
    expect(r.text).toContain("Canvas is empty.");
  });

  it("asks approval for mutations and honors discard", async () => {
    const approvals: string[] = [];
    const fetchImpl = (async () => {
      if (approvals.length === 0) return sse([call("c1", "system_add", JSON.stringify({ type: "queue" })), DONE]);
      return sse([txt("Skipped."), DONE]);
    }) as unknown as typeof fetch;
    const applied: string[] = [];
    registerSystemBridge({
      getSnapshot: () => ({ name: "P", systems: [], connections: [], interfaceCount: 0, operationCount: 0, flowCount: 0, scenarioCount: 0, dirty: false }),
      apply: () => {
        applied.push("x");
        return { ok: true };
      },
      getProject: () => null,
    });
    const r = await runAgentLoop({
      ...base,
      tools: SYSTEM_TOOLS,
      fetchImpl,
      events: { onApproval: async (req) => { approvals.push(req.label); return "discard"; } },
    });
    expect(approvals).toEqual(["Add queue"]);
    expect(applied).toEqual([]);
    expect(r.text).toContain("Skipped.");
  });

  it("reports unknown tools and invalid args without crashing", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n === 1) return sse([call("c1", "nope_tool", "{}"), DONE]);
      if (n === 2) return sse([call("c2", "system_add", "{broken"), DONE]);
      return sse([txt("Recovered."), DONE]);
    }) as unknown as typeof fetch;
    const r = await runAgentLoop({ ...base, tools: SYSTEM_TOOLS, fetchImpl });
    expect(r.text).toContain("Recovered.");
    expect(r.steps).toBe(3);
  });

  it("caps runaway loops", async () => {
    const fetchImpl = (async () => sse([call("c1", "system_describe", "{}"), DONE])) as unknown as typeof fetch;
    registerSystemBridge({
      getSnapshot: () => ({ name: "P", systems: [], connections: [], interfaceCount: 0, operationCount: 0, flowCount: 0, scenarioCount: 0, dirty: false }),
      apply: () => ({ ok: true }),
      getProject: () => null,
    });
    const onToolAuto = vi.fn();
    const r = await runAgentLoop({ ...base, tools: SYSTEM_TOOLS, fetchImpl, events: { onToolAuto } });
    expect(r.steps).toBe(8);
    expect(r.stopped).toMatch(/Step cap/);
    expect(onToolAuto).toHaveBeenCalledTimes(8);
  });

  it("routes packs by skill", () => {
    expect(toolsForSkill("system").map((t: AgentTool) => t.name)).toEqual(["system_describe", "system_add", "system_connect", "risk_describe", "risk_propose_adr", "validation_status", "scenario_propose_for_risk", "verdict_explain"]);
    expect(toolsForSkill("validate")).toEqual([]);
  });

  it("validates tool args with zod", () => {
    const add = SYSTEM_TOOLS.find((t) => t.name === "system_add")!;
    expect(add.schema.safeParse({ type: "queue" }).success).toBe(true);
    expect(add.schema.safeParse({}).success).toBe(false);
    expect(z.object({}).safeParse(undefined).success).toBe(false);
  });
});
