import { describe, expect, it } from "vitest";
import type { SystemProject } from "@/lib/system-design/model";
import { newSequence } from "./model";
import { parseStatements } from "./dsl";
import { flowToStatements, projectToStatements, sequenceToDraft } from "./systemBridge";

function project(): SystemProject {
  return {
    id: "proj1",
    name: "Shop",
    systems: [
      { id: "s1", name: "Salesforce", systemType: "salesforce", description: "", position: { x: 0, y: 0 }, iconKey: "sf" },
      { id: "s2", name: "Middleware", systemType: "middleware", description: "", position: { x: 0, y: 0 }, iconKey: "mw" },
      { id: "s3", name: "ServiceNow", systemType: "servicenow", description: "", position: { x: 0, y: 0 }, iconKey: "sn" },
    ],
    connections: [
      { id: "e1", sourceId: "s1", targetId: "s2", label: "Create Order", status: "draft" },
      { id: "e2", sourceId: "s2", targetId: "s3", label: "Create Fulfillment", status: "draft" },
    ],
    interfaces: [],
    operations: [],
    flows: [{ id: "f1", name: "Happy path", startEdgeId: "e1", lanes: [], opByEdge: {} }],
    scenarios: [],
    environments: [],
    settings: {},
    updatedAt: 0,
  } as unknown as SystemProject;
}

describe("system -> sequence", () => {
  it("imports a flow lane as statements", () => {
    const p = project();
    const r = flowToStatements(p, p.flows[0]);
    expect(r.warnings).toEqual([]);
    expect(r.statements).toMatch(/participant Salesforce/);
    expect(r.statements).toMatch(/Salesforce -> Middleware: Create Order/);
    expect(r.statements).toMatch(/Middleware -> ServiceNow: Create Fulfillment/);
    // Imported statements parse cleanly.
    expect(parseStatements(r.statements).errors).toEqual([]);
  });

  it("imports whole projects and warns about flows", () => {
    const r = projectToStatements(project());
    expect(r.warnings.join(" ")).toMatch(/1 saved flow/);
    expect(r.statements.split("\n")).toHaveLength(5);
  });

  it("reports unresolvable flows", () => {
    const r = flowToStatements(project(), { id: "fx", name: "Lost", startEdgeId: "nope", lanes: [], opByEdge: {} });
    expect(r.statements).toBe("");
    expect(r.warnings.join(" ")).toMatch(/no lanes/);
  });
});

describe("sequence -> system", () => {
  it("flattens blocks into labeled edges with warnings", () => {
    const parsed = parseStatements(
      "Salesforce -> Middleware: Create Order\nloop each order.lines\nMiddleware -> ServiceNow: Create Line\nend\nServiceNow --> Middleware: 201 Created\n",
    );
    const doc = { ...newSequence("Shop"), participants: parsed.participants, nodes: parsed.nodes };
    const draft = sequenceToDraft(doc);
    expect(draft.systems.map((s) => s.name)).toEqual(["Salesforce", "Middleware", "ServiceNow"]);
    expect(draft.connections).toHaveLength(3);
    expect(draft.connections[1].label).toMatch(/\[LOOP order\.lines\]/);
    expect(draft.warnings.join(" ")).toMatch(/1 control block/);
    expect(draft.warnings.join(" ")).toMatch(/1 response/);
  });
});
