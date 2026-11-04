import { describe, expect, it } from "vitest";
import { parseLog } from "./parser";
import { errorPathIds, isSlowNode, projectExecutionGraph } from "./graph";
import type { ExecutionNode } from "./model";

/**
 * Fixture: apex-07LdM00000eyC8vUAE.log (duplicate-detection transaction).
 * Two EXECUTION_STARTED sequences, seven lines each, both DuplicateDetector
 * + Standard Account Duplicate Rule for UPDATE, ~1.34ms and ~26.1ms.
 */
const FIXTURE = [
  "68.0 APEX_CODE,FINEST;APEX_PROFILING,INFO;CALLOUT,INFO;DATA_ACCESS,INFO;DB,INFO;NBA,INFO;SYSTEM,DEBUG;VALIDATION,INFO;VISUALFORCE,INFO;WAVE,INFO;WORKFLOW,INFO",
  "00:37:53.1 (1088117)|USER_INFO|[EXTERNAL]|0055h000009Yhb4|developer.kuldeep@accenture.prod|(GMT+05:30) India Standard Time (Asia/Kolkata)|GMT+05:30",
  "00:37:53.1 (1158308)|EXECUTION_STARTED",
  "00:37:53.1 (1178518)|CODE_UNIT_STARTED|[EXTERNAL]|DuplicateDetector",
  "00:37:53.1 (1205648)|DUPLICATE_DETECTION_BEGIN",
  "00:37:53.1 (2406086)|DUPLICATE_DETECTION_RULE_INVOCATION|DuplicateRuleId:0Bm5h00000N50b8|DuplicateRuleName:Standard Account Duplicate Rule|DmlType:UPDATE",
  "00:37:53.1 (2476417)|DUPLICATE_DETECTION_END",
  "00:37:53.1 (2483857)|CODE_UNIT_FINISHED|DuplicateDetector",
  "00:37:53.1 (2493387)|EXECUTION_FINISHED",
  "00:37:53.108 (108018037)|USER_INFO|[EXTERNAL]|0055h000009Yhb4|developer.kuldeep@accenture.prod|(GMT+05:30) India Standard Time (Asia/Kolkata)|GMT+05:30",
  "00:37:53.108 (108037487)|EXECUTION_STARTED",
  "00:37:53.108 (108053137)|CODE_UNIT_STARTED|[EXTERNAL]|DuplicateDetector",
  "00:37:53.108 (108060337)|DUPLICATE_DETECTION_BEGIN",
  "00:37:53.108 (108098228)|DUPLICATE_DETECTION_RULE_INVOCATION|DuplicateRuleId:0Bm5h00000N50b8|DuplicateRuleName:Standard Account Duplicate Rule|DmlType:UPDATE",
  "00:37:53.108 (134103102)|DUPLICATE_DETECTION_END",
  "00:37:53.108 (134121442)|CODE_UNIT_FINISHED|DuplicateDetector",
  "00:37:53.108 (134134682)|EXECUTION_FINISHED",
].join("\n");

function node(partial: Partial<ExecutionNode> & { id: string }): ExecutionNode {
  return {
    label: partial.id,
    type: "METHOD",
    children: [],
    eventIds: [],
    status: "SUCCESS",
    ...partial,
  } as ExecutionNode;
}

describe("graph projection", () => {
  it("reconstructs the two-root duplicate-detection fixture", () => {
    const { model } = parseLog(FIXTURE, "07LdM");
    expect(model.rootIds).toHaveLength(2);
    const roots = model.rootIds.map((id) => model.nodes.find((n) => n.id === id)!);
    expect(roots.map((r) => r.type)).toEqual(["TRANSACTION", "TRANSACTION"]);
    // ~1.34ms and ~26.1ms off the EXECUTION_STARTED/FINISHED timestamps.
    expect(roots[0].durationMs).toBeGreaterThan(0.5);
    expect(roots[0].durationMs).toBeLessThan(2);
    expect(roots[1].durationMs).toBeGreaterThan(25);
    expect(roots[1].durationMs).toBeLessThan(28);
    // No exceptions anywhere - green means no detected issue, nothing more.
    expect(model.nodes.some((n) => n.type === "EXCEPTION")).toBe(false);
    expect(errorPathIds(model)).toEqual([]);

    const g = projectExecutionGraph(model);
    expect(g.truncated).toBe(false);
    expect(g.errorPathIds).toEqual([]);
    expect(g.slowIds).toEqual([]);
    // Left-to-right flow: children sit right of their parents.
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    for (const e of g.edges) {
      expect(byId.get(e.target)!.x).toBeGreaterThan(byId.get(e.source)!.x);
    }
    // Both roots kept separate at depth 0.
    expect(g.nodes.filter((n) => n.depth === 0)).toHaveLength(2);
  });

  it("flags dominant slow nodes and walks error paths to the root", () => {
    const slow = node({ id: "s", type: "SOQL", status: "SUCCESS", durationMs: 6000 });
    expect(isSlowNode(slow, 12000)).toBe(true);
    expect(isSlowNode(node({ id: "t", type: "TRANSACTION", durationMs: 12000 }), 12000)).toBe(false);
    expect(isSlowNode(node({ id: "q", type: "SOQL", durationMs: 30 }), 12000)).toBe(false);
  });

  it("skeletonizes past the node cap keeping failures and ancestors", () => {
    const nodes: ExecutionNode[] = [{ ...node({ id: "root", type: "TRANSACTION" }), children: [] }];
    for (let i = 0; i < 700; i++) {
      const id = `leaf${i}`;
      nodes[0].children.push(id);
      nodes.push(node({ id, parentId: "root", status: i === 3 ? "FAILED" : "SUCCESS" }));
    }
    const model = {
      executionId: "ex",
      logId: "l",
      metadata: {},
      rootIds: ["root"],
      nodes,
      events: [],
      unknownEventCount: 0,
      findings: [],
      metrics: { eventCount: 0, soqlCount: 0, dmlCount: 0, calloutCount: 0, exceptionCount: 0 },
    };
    const g = projectExecutionGraph(model);
    expect(g.truncated).toBe(true);
    expect(g.hiddenCount).toBeGreaterThan(0);
    expect(g.nodes.some((n) => n.id === "leaf3")).toBe(true);
    expect(g.nodes.some((n) => n.id === "root")).toBe(true);
  });
});
