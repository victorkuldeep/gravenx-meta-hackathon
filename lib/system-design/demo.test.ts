"use client";

import { describe, it, expect } from "vitest";
import { buildCdcSyncProject, buildGroqSampleProject, buildOrderFanoutProject, buildRetryFallbackProject, buildRevenueCloudProject, buildTmfSampleProject } from "./demo";
import { validateProject } from "./model";
import { compileMapping } from "./mapping";
import { resolveChain } from "./chain";

describe("groq chat sample", () => {
  it("validates and its edge template builds a chat body from the seed", () => {
    const project = buildGroqSampleProject();
    const { project: valid, issues } = validateProject(project);
    expect(issues).toEqual([]);
    expect(valid).not.toBeNull();
    const edge = valid!.connections[0];
    expect(edge.sourceOperationId).toBeTruthy();
    expect(edge.targetOperationId).toBeTruthy();
    expect(edge.mapping?.mode).toBe("template");    const compiled = compileMapping(
      "template",
      edge.mapping!.template,
      '{ "prompt": "Say hi in five words." }',
      { seed: '{ "prompt": "Say hi in five words." }' }
    );
    expect(compiled.ok).toBe(true);
    expect(JSON.parse(compiled.body)).toEqual({
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: "Say hi in five words." }],
      stream: false,
    });
  });

  it("keeps auth as a vault ref for token prefill and prefills the seed", () => {
    const project = buildGroqSampleProject();
    const chat = project.operations.find((o) => o.id === "op_groq_chat");
    expect(chat?.headers).toEqual([{ key: "Authorization", value: "Bearer $env.GROQ_API_KEY" }]);
    const prompt = project.operations.find((o) => o.id === "op_groq_prompt");
    expect(prompt?.sampleBody).toContain("order-to-cash");
    const { issues } = validateProject(JSON.parse(JSON.stringify(project)));
    expect(issues).toEqual([]);
  });
});

describe("tmf order-flow sample", () => {
  it("validates, fans into two lanes, and wraps the order as a TMF688 event", () => {
    const project = buildTmfSampleProject();
    const { project: valid, issues } = validateProject(JSON.parse(JSON.stringify(project)));
    expect(issues).toEqual([]);
    expect(valid).not.toBeNull();
    const lanes = resolveChain(valid!, "conn_tmf_1");
    expect(lanes.length).toBe(1);
    expect(lanes[0].edges.map((e) => e.id)).toEqual(["conn_tmf_1", "conn_tmf_3"]);
    const lanes2 = resolveChain(valid!, "conn_tmf_2");
    expect(lanes2.length).toBe(1);
    const wrap = valid!.connections.find((c) => c.id === "conn_tmf_2");
    const compiled = compileMapping(
      "template",
      wrap!.mapping!.template,
      '{"id":"00000238","status":"Created"}',
      {}
    );
    expect(compiled.ok).toBe(true);
    expect(JSON.parse(compiled.body)).toEqual({
      event: { productOrder: { id: "00000238", status: "Created" } },
    });
    const replay = valid!.connections.find((c) => c.id === "conn_tmf_3");
    expect(replay!.mapping!.template).toBe("{{request}}");
  });

  it("keeps hub auth as a vault ref", () => {
    const project = buildTmfSampleProject();
    const fwd = project.operations.find((o) => o.id === "op_tmf_fwd");
    expect(fwd?.method).toBe("POST");
    expect(fwd?.headers).toEqual([{ key: "Authorization", value: "Bearer $env.HUB_TOKEN" }]);
    const get = project.operations.find((o) => o.id === "op_tmf_get");
    expect(get?.method).toBe("GET");
  });
});

describe("new starter templates", () => {
  it("validate cleanly, bind every edge end, and resolve runnable lanes", () => {
    const builds = [buildOrderFanoutProject(), buildRevenueCloudProject(), buildCdcSyncProject(), buildRetryFallbackProject()];
    expect(builds).toHaveLength(4);
    for (const project of builds) {
      const { project: valid, issues } = validateProject(JSON.parse(JSON.stringify(project)));
      expect(issues).toEqual([]);
      expect(valid).not.toBeNull();
      // Every edge end binds a real operation on the right system.
      for (const c of valid!.connections) {
        for (const [opKey, sysKey] of [["sourceOperationId", "sourceId"], ["targetOperationId", "targetId"]] as const) {
          const opId = c[opKey];
          if (!opId) continue;
          const op = valid!.operations.find((o) => o.id === opId);
          expect(op).toBeTruthy();
          const iface = valid!.interfaces.find((f) => f.id === op!.interfaceId);
          expect(iface?.systemId).toBe(c[sysKey]);
        }
      }
    }
  });

  it("fan-out runs two lanes per start edge, all hops mocked", () => {
    const project = buildOrderFanoutProject();
    const lanes = resolveChain(project, "conn_fan_1");
    expect(lanes.length).toBe(2);
    expect(lanes.map((l) => l.edges[l.edges.length - 1].id).sort()).toEqual(["conn_fan_3", "conn_fan_4"]);
    const mocked = project.operations.filter((o) => o.mock);
    expect(mocked.length).toBe(project.operations.length);
    const bill = project.operations.find((o) => o.id === "op_fan_bill");
    expect(JSON.parse(bill!.mock!.body)).toMatchObject({ status: "accepted", ackTo: "salesforce" });
  });

  it("revenue and cdc chains resolve end to end", () => {
    const rev = buildRevenueCloudProject();
    const revLanes = resolveChain(rev, "conn_rev_1");
    expect(revLanes.length).toBe(1);
    expect(revLanes[0].edges.map((e) => e.id)).toEqual(["conn_rev_1", "conn_rev_2"]);
    const cdc = buildCdcSyncProject();
    const cdcLanes = resolveChain(cdc, "conn_cdc_1");
    expect(cdcLanes.length).toBe(2);
    expect(cdcLanes.flatMap((l) => l.edges.map((e) => e.id)).sort()).toEqual(["conn_cdc_1", "conn_cdc_1", "conn_cdc_2", "conn_cdc_3"]);
  });
});

describe("retry + fallback starter", () => {
  it("walks the exception path as three lanes", () => {
    const project = buildRetryFallbackProject();
    const lanes = resolveChain(project, "conn_rf_1");
    expect(lanes.length).toBe(3);
    expect(lanes.map((l) => l.edges[l.edges.length - 1].id).sort()).toEqual(["conn_rf_2", "conn_rf_3", "conn_rf_4"]);
  });

  it("keys the fallback charge idempotently off the order", () => {
    const project = buildRetryFallbackProject();
    const fb = project.connections.find((c) => c.id === "conn_rf_3");
    expect(fb && fb.mapping && fb.mapping.mode).toBe("template");
    expect(fb && fb.mapping && fb.mapping.template).toMatch(/idempotencyKey/);
  });
});
