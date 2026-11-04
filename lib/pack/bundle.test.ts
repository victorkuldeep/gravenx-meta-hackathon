import { describe, expect, it } from "vitest";
import { buildPackJson, buildPackMarkdown } from "./bundle";
import type { SystemProject } from "@/lib/system-design/model";
import { linkDecision, newDecision } from "@/lib/decisions/model";
import { linkRequirement, newRequirement } from "@/lib/requirements/model";

const project = {
  id: "p1",
  name: "Ordering topology",
  systems: [{ id: "s1", name: "Shop", systemType: "custom", description: "Storefront", baseUrl: "https://shop/x", position: { x: 0, y: 0 }, iconKey: "plus" }],
  interfaces: [{ id: "i1", systemId: "s1", name: "Orders", protocol: "REST" }],
  operations: [{ id: "op1", interfaceId: "i1", name: "Create", method: "POST", path: "/orders", version: "v1", policy: { timeoutSecs: 30 } }],
  connections: [],
  environments: [],
  activeEnvironmentId: null,
  notes: "",
  todos: [],
} as unknown as SystemProject;

describe("architecture pack", () => {
  it("bundles topology, policy, linked governance and risks", () => {
    const d = linkDecision(newDecision("Sync for create", "ADR-001", 1), {
      surface: "system",
      recordId: "p1",
      label: "Ordering topology",
    });
    const r = linkRequirement(newRequirement("Confirm fast", "REQ-001", 2), {
      surface: "system",
      recordId: "p1",
      label: "Ordering topology",
    });
    const md = buildPackMarkdown({ project, sequences: [], decisions: [d], requirements: [r] });
    expect(md).toContain("# Architecture Pack - Ordering topology");
    expect(md).toContain("timeout 30s");
    expect(md).toContain("ADR-001 Sync for create");
    expect(md).toContain("REQ-001 Confirm fast");
    expect(md).toContain("## Risks");
    expect(md).toContain("out of pack scope by design");
    const json = JSON.parse(buildPackJson({ project, sequences: [], decisions: [d], requirements: [r] }));
    expect(json.type).toBe("gravenx-architecture-pack");
    expect(json.counts).toMatchObject({ systems: 1, decisions: 1, requirements: 1 });
    expect(json.markdown).toContain("# Architecture Pack - Ordering topology");
  });

  it("reports validation: scenarios with verdicts, findings with proof states", () => {
    const withScenario = {
      ...project,
      operations: [{ id: "op1", interfaceId: "i1", name: "Create", method: "POST", path: "/orders", version: "v1" }],
      connections: [{ id: "c1", sourceId: "s1", targetId: "s1", sourceOperationId: "op1", targetOperationId: "op1", label: "Self", status: "ready" as const }],
      scenarios: [
        {
          id: "scn1",
          name: "Transient failure",
          flowId: null,
          environmentId: null,
          inputPayload: "{}",
          mockOverrides: { op1: { status: 500, body: "{}", latencyMs: 0 } },
          expectStatus: 500,
          validates: [{ rule: "no-retry", refId: "op1", mode: "reproduce" as const }],
        },
      ],
      settings: { retentionDays: 30 },
    } as unknown as SystemProject;
    const runs = [
      {
        id: "run1",
        createdAt: Date.now(),
        projectId: "p1",
        scenarioId: "scn1",
        verdict: "pass" as const,
        operationName: "Chain",
        systemName: "Shop",
        environmentName: "(no environment)",
        method: "CHAIN",
        endpoint: "",
        status: 500,
        statusText: "chain with failures",
        durationMs: 9,
        truncated: false,
        requestHeaders: {},
        requestBodyPreview: "{}",
        responseHeaders: {},
        responseBodyPreview: "",
        kind: "chain" as const,
        steps: [],
      },
    ];
    const md = buildPackMarkdown({ project: withScenario, sequences: [], decisions: [], requirements: [], runs });
    expect(md).toContain("## Validation");
    expect(md).toContain("### Transient failure");
    expect(md).toContain("verdict pass");
    expect(md).toContain("[failed] no-retry");
    const json = JSON.parse(buildPackJson({ project: withScenario, sequences: [], decisions: [], requirements: [], runs }));
    expect(json.counts).toMatchObject({ scenarios: 1, runs: 1 });
  });
});
