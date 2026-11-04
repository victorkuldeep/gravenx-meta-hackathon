import { describe, expect, it } from "vitest";
import { buildIndex, whereUsed } from "./index";
import type { SystemProject } from "@/lib/system-design/model";
import type { Experience } from "@/lib/wireframe/model";
import type { SequenceDocument } from "@/lib/sequence/model";
import { linkDecision, newDecision } from "@/lib/decisions/model";
import { newConsoleTask } from "@/lib/console/model";
import type { ErdSnapshot } from "@/lib/erd/snapshotDb";
import { blankProject } from "@/lib/mapping/types";

const project = {
  id: "p1",
  name: "Ordering topology",
  systems: [
    { id: "s1", name: "Salesforce" },
    { id: "s2", name: "Middleware" },
  ],
  interfaces: [{ id: "i1", systemId: "s2", name: "Orders API", protocol: "REST" }],
  operations: [{ id: "op1", interfaceId: "i1", name: "Create order", method: "POST", path: "/orders" }],
  connections: [
    { id: "c1", sourceId: "s1", targetId: "s2", label: "Create Order", sourceOperationId: "op1" },
    { id: "c2", sourceId: "s1", targetId: "gone", label: "Lost hop" },
  ],
} as unknown as SystemProject;

const snapshot = {
  id: "snap1",
  orgDomain: "x.my.salesforce.com",
  name: "Orders ERD",
  createdAt: 1,
  root: "Account",
  focus: "Account",
  nodes: ["Account", "Contact"],
  positions: {},
} as ErdSnapshot;

const experience = {
  id: "e1",
  name: "Customer portal",
  screens: [{ id: "sc1", name: "Detail", viewport: { width: 1, height: 1 }, position: { x: 0, y: 0 } }],
  components: [
    { id: "w1", kind: "input", label: "Name", binding: { source: "salesforce", object: "Account", field: "Name" } },
    {
      id: "w2",
      kind: "select",
      label: "Segment",
      proposedField: { object: "Account", apiName: "Segment__c", label: "Segment", type: "Picklist" },
    },
  ],
  journeys: [],
  proposedFields: [],
} as unknown as Experience;

const sequence = {
  id: "q1",
  name: "Order flow",
  participants: [
    { id: "pt1", name: "Salesforce" },
    { id: "pt2", name: "Middleware", systemRef: "Middleware" },
  ],
  nodes: [
    { nodeType: "message", id: "m1", from: "pt1", to: "pt2", label: "Create Order", kind: "sync", operationRef: "op1" },
    { nodeType: "message", id: "m2", from: "pt2", to: "ghost", label: "Lost reply", kind: "response" },
  ],
} as unknown as SequenceDocument;

function world() {
  const d1 = linkDecision(newDecision("Middleware owns orchestration", "ADR-001", 1), {
    surface: "system",
    recordId: "p1",
    label: "Ordering topology",
  });
  // Stale id, live name: import renamed the project, the label survived.
  const d2 = linkDecision(newDecision("Events downstream", "ADR-002", 2), {
    surface: "system",
    recordId: "p-old",
    label: "Ordering topology",
  });
  const d3 = linkDecision(newDecision("Gone system", "ADR-003", 3), {
    surface: "system",
    recordId: "p-gone",
    label: "Deleted project",
  });
  const t = { ...newConsoleTask("Track the portal", 4), links: [{ surface: "wireframe" as const, recordId: "e1", label: "Customer portal" }] };
  return buildIndex({ systems: [project], snapshots: [snapshot], experiences: [experience], sequences: [sequence], decisions: [d1, d2, d3], tasks: [t], drawBoard: true });
}

describe("graph index", () => {
  it("indexes every surface and binds operations", () => {
    const g = world();
    const kinds = new Set(g.nodes.map((n) => n.kind));
    for (const k of ["project", "system", "operation", "experience", "component", "sequence", "participant", "decision", "console-task", "snapshot", "schema-object", "schema-field", "draw-board"]) {
      expect(kinds.has(k as never)).toBe(true);
    }
    const binds = g.edges.filter((e) => e.kind === "binds" && e.resolution === "id");
    expect(binds.length).toBeGreaterThan(0);
    const invokes = g.edges.find((e) => e.kind === "invokes" && e.resolution === "id");
    expect(invokes?.label).toBe("Create Order");
  });

  it("resolves id-first, falls back to name, then surfaces unresolved", () => {
    const g = world();
    const idEdge = g.edges.find((e) => e.kind === "links" && e.label === "Ordering topology" && e.resolution === "id");
    expect(idEdge).toBeDefined();
    const nameEdge = g.edges.find((e) => e.kind === "links" && e.label === "Ordering topology" && e.resolution === "name");
    // d1 (id hit) and d2 (name fallback) both link the same project.
    expect(nameEdge).toBeDefined();
    const bad = g.edges.find((e) => e.kind === "links" && e.label === "Deleted project");
    expect(bad?.resolution).toBe("unresolved");
    expect(g.unresolved.some((u) => u.raw === "p-gone" && u.name === "Deleted project")).toBe(true);
    // Dangling connection target + ghost participant are visible too.
    expect(g.unresolved.some((u) => u.raw === "gone")).toBe(true);
    expect(g.unresolved.some((u) => u.raw === "ghost")).toBe(true);
  });

  it("answers where-used for schema fields, systems and operations", () => {
    const g = world();
    const field = whereUsed(g, { object: "Account", field: "Name" });
    expect(field.node?.kind).toBe("schema-field");
    expect(field.inbound.some((e) => e.kind === "binds")).toBe(true);
    const sys = whereUsed(g, { surface: "system", name: "Middleware" });
    expect(sys.inbound.some((e) => e.kind === "connects")).toBe(true);
    expect(sys.inbound.some((e) => e.kind === "maps-to" && e.resolution === "name")).toBe(true);
    const missing = whereUsed(g, { object: "Nope", field: "Nothing__c" });
    expect(missing.node).toBeNull();
  });

  it("tracks proposed fields as proposes edges", () => {
    const g = world();
    const proposes = g.edges.filter((e) => e.kind === "proposes");
    expect(proposes).toHaveLength(1);
    expect(g.nodes.find((n) => n.key === proposes[0].to)?.name).toBe("Account.Segment__c");
  });

  it("indexes mapping projects field-deep: plans, rows, unresolved", () => {
    const f = (name: string) => ({
      name, label: name, type: "string", length: 255, precision: 0, scale: 0,
      nillable: true, createable: true, updateable: true, calculated: false,
      defaultedOnCreate: false, unique: false, externalId: false, referenceTo: [],
      relationshipName: null, restrictedPicklist: false, defaultValue: null,
      picklistValues: [],
    });
    const proj = {
      ...blankProject({ id: "mp1", name: "Order sync", now: "t" }),
      sfSnapshot: {
        id: "snap1", capturedAt: "t", fingerprint: "fp",
        objects: [{ name: "Account", label: "Account", custom: false, fields: [f("Name"), f("Industry")] }],
      },
      recordPlans: [
        { id: "pl1", name: "Acct", objectName: "Account", intent: "create" as const, sourcePath: "", cardinality: "one" as const, parentPlanId: null },
      ],
      mappings: [
        { id: "r1", sourcePath: "$.order.name", planId: "pl1", objectName: "Account", fieldName: "Name", kind: "direct" as const, status: "mapped" as const, updatedAt: "t" },
        { id: "r2", sourcePath: "$.order.nope", planId: "pl1", objectName: "Account", fieldName: "Nope__c", kind: "direct" as const, status: "mapped" as const, updatedAt: "t" },
        { id: "r3", sourcePath: "", planId: null, objectName: "", fieldName: "", kind: "direct" as const, status: "unmapped" as const, updatedAt: "t" },
        { id: "r4", sourcePath: "$.x", planId: "pl1", objectName: "Account", fieldName: "Industry", kind: "direct" as const, status: "excluded" as const, updatedAt: "t" },
      ],
    };
    const g = buildIndex({ mappings: [proj] });
    // Project + plan records exist; plan lands back on the project.
    expect(g.nodes.filter((n) => n.kind === "mapping-project").map((n) => n.name)).toEqual(["Order sync"]);
    expect(g.nodes.filter((n) => n.kind === "mapping-plan").map((n) => n.name)).toEqual(["Acct → Account"]);
    // Clean row r1: plan → Account.Name labeled with its source path.
    const rowEdge = g.edges.find((e) => e.kind === "maps-to" && e.label === "$.order.name");
    expect(rowEdge?.resolution).toBe("id");
    expect(g.nodes.find((n) => n.key === rowEdge?.to)?.name).toBe("Account.Name");
    // Mistyped r2 surfaces unresolved; r3 (untargeted) and r4 (ignored) stay out.
    expect(g.unresolved.map((u) => u.raw)).toContain("Account.Nope__c");
    expect(g.edges.some((e) => e.label === "$.order.nope" && e.resolution === "unresolved")).toBe(true);
    expect(g.unresolved.some((u) => u.raw === "")).toBe(false);
    // Where-used on the field walks back to the plan.
    const used = whereUsed(g, { object: "Account", field: "Name" });
    expect(used.inbound.some((e) => e.kind === "maps-to" && e.label === "$.order.name")).toBe(true);
  });

  it("indexes pushed JIRA/SNOW backlinks as external issue nodes", () => {
    const jira = {
      ...newConsoleTask("Ship it", 5),
      links: [],
      pmo: { system: "jira" as const, key: "ACME-7", url: "https://acme.atlassian.net/browse/ACME-7", at: 6 },
    };
    const snow = {
      ...newConsoleTask("Page it", 7),
      links: [],
      pmo: { system: "snow" as const, key: "INC0010007", url: "https://acme.service-now.com/nav_to.do", at: 8 },
    };
    const g = buildIndex({ tasks: [jira, snow] });
    const issues = g.nodes.filter((n) => n.kind === "external-issue");
    expect(issues.map((n) => n.name).sort()).toEqual(["ACME-7 (JIRA)", "INC0010007 (ServiceNow)"]);
    expect(issues.find((n) => n.name.startsWith("ACME-7"))?.url).toBe("https://acme.atlassian.net/browse/ACME-7");
    const refs = g.edges.filter((e) => e.kind === "references" && e.resolution === "id");
    expect(refs).toHaveLength(2);
    // Where-used on the issue walks back to the owning task.
    const used = whereUsed(g, { surface: "console", name: "ACME-7 (JIRA)" });
    expect(used.inbound).toHaveLength(1);
  });
});
