"use client";

import { describe, it, expect } from "vitest";
import {
  isValidRecordId,
  escapeSoqlString,
  displayFieldNames,
  queryableFieldNames,
  chunkSelect,
  buildRootQuery,
  buildChildrenQuery,
  resolveTarget,
  nodeRecordState,
  selectedRecordId,
  formatWalkValue,
  keyFieldFor,
  targetApiForId,
  kindForId,
  queueLabelFromRow,
  buildLabelQuery,
  buildLookupSearchQuery,
  labelFromRow,
  rowsForApi,
  resolveChildPlans,
  emptyLoadedState,
  type LoadedState,
  type ResolveContext,
} from "./recordWalk";

const leadDesc = {
  fields: [
    { name: "Id", type: "id", referenceTo: [] },
    { name: "Name", type: "string", referenceTo: [] },
    { name: "ConvertedAccountId", type: "reference", referenceTo: ["Account"] },
    { name: "OwnerId", type: "reference", referenceTo: ["User"] },
  ],
  childRelationships: [{ childSObject: "Task", relationshipName: "Tasks" }],
};
const accountDesc = {
  fields: [
    { name: "Id", type: "id", referenceTo: [] },
    { name: "Name", type: "string", referenceTo: [] },
    { name: "ParentId", type: "reference", referenceTo: ["Account"] },
  ],
  childRelationships: [{ childSObject: "Contact", relationshipName: "Contacts" }],
};
const taskDesc = {
  fields: [
    { name: "Id", type: "id", referenceTo: [] },
    { name: "Subject", type: "string", referenceTo: [] },
    { name: "WhoId", type: "reference", referenceTo: ["Lead", "Contact"] },
  ],
  childRelationships: [],
};

const describes = new Map([
  ["Lead", leadDesc],
  ["Account", accountDesc],
  ["Task", taskDesc],
]);

const ctx = (over: Partial<ResolveContext> = {}): ResolveContext => ({
  rootApi: "Lead",
  rootId: "00Qxx0000012345",
  canvasApis: ["Lead", "Account", "Task"],
  getDescribe: (api) => describes.get(api),
  labelOf: (api) => api,
  ...over,
});

const withRoot = (): LoadedState => {
  const s = emptyLoadedState();
  s.singles.set("Lead", new Map([["00Qxx0000012345", { id: "00Qxx0000012345", fields: { Id: "00Qxx0000012345", ConvertedAccountId: "001xx000003DGbP" } }]]));
  return s;
};

describe("record walk engine", () => {
  it("validates record ids", () => {
    expect(isValidRecordId("00Qxx0000012345")).toBe(true);
    expect(isValidRecordId("00Qxx0000012345EAB")).toBe(true);
    expect(isValidRecordId("00Qxx!")).toBe(false);
    expect(isValidRecordId("  ")).toBe(false);
  });

  it("escapes soql strings", () => {
    expect(escapeSoqlString("o'b\\c")).toBe("o\\'b\\\\c");
    expect(buildRootQuery("Lead", ["Id"], "00Q'xx")).toContain("00Q\\'xx");
  });

  it("excludes compound/blob types from full-row pulls, Id first", () => {
    const names = queryableFieldNames([
      { name: "Name", type: "string", referenceTo: [] },
      { name: "BillingAddress", type: "address", referenceTo: [] },
      { name: "VersionData", type: "base64", referenceTo: [] },
      { name: "Id", type: "id", referenceTo: [] },
    ]);
    expect(names[0]).toBe("Id");
    expect(names).not.toContain("BillingAddress");
    expect(names).not.toContain("VersionData");
    expect(names).toContain("Name");
  });

  it("chunks long select lists under the cap", () => {
    const names = Array.from({ length: 100 }, (_, i) => `Custom_Field_${i}__c`);
    const chunks = chunkSelect(names, 500);
    expect(chunks.flat()).toEqual(names);
    for (const c of chunks) {
      expect(c.join(", ").length).toBeLessThanOrEqual(500);
    }
    expect(chunkSelect(["Id", "Name"], 500)).toEqual([["Id", "Name"]]);
    expect(chunkSelect([], 500)).toEqual([[]]);
  });

  it("picks Id + name + lookups for display", () => {
    const { select } = displayFieldNames(leadDesc.fields.map((f) => ({ ...f, nameField: f.name === "Name" })));
    expect(select).toEqual(["Id", "Name", "ConvertedAccountId", "OwnerId"]);
    expect(buildChildrenQuery("Task", "WhoId", "00Q1", ["Id"], 10)).toContain("OFFSET 10");
  });

  it("resolves a parent via a loaded lookup value (single GET)", () => {
    const plan = resolveTarget("Account", withRoot(), ctx());
    expect(plan).toEqual({ kind: "single", apiName: "Account", id: "001xx000003DGbP" });
  });

  it("resolves children via a loaded parent id (1-many query)", () => {
    const plan = resolveTarget("Task", withRoot(), ctx());
    expect(plan.kind).toBe("children");
    if (plan.kind === "children") {
      expect(plan.lookupField).toBe("WhoId");
      expect(plan.parentId).toBe("00Qxx0000012345");
    }
  });

  it("blocks with the canvas parent to load first", () => {
    const plan = resolveTarget("Task", emptyLoadedState(), ctx({ rootApi: null, rootId: null }));
    expect(plan.kind).toBe("blocked");
    if (plan.kind === "blocked") expect(plan.missingApi).toBe("Lead");
  });

  it("uses child-row ids to reach the next level (junction legs)", () => {
    const s = withRoot();
    s.children.set("Task::WhoId::00Qxx0000012345", {
      childApi: "Task", lookupField: "WhoId", parentApi: "Lead", parentId: "00Qxx0000012345",
      rows: [{ Id: "00Txx row" }], offset: 11, exhausted: false,
    });
    // Task rows aboard -> Task node itself is known
    const plan = resolveTarget("Task", s, ctx());
    expect(plan).toEqual({ kind: "single", apiName: "Task", id: "00Txx row" });
  });

  it("reports eye states: live, reachable, locked", () => {
    const empty = nodeRecordState("Task", emptyLoadedState(), ctx({ rootApi: null, rootId: null }));
    expect(empty.state).toBe("locked");
    expect(empty.hint).toContain("Lead");
    const live = nodeRecordState("Lead", withRoot(), ctx());
    expect(live.state).toBe("live");
    const reach = nodeRecordState("Account", withRoot(), ctx());
    expect(reach.state).toBe("reachable");
  });

  it("selects the explicit pick, else first child row, else first single", () => {
    const s = withRoot();
    // singles only: first single wins
    expect(selectedRecordId("Lead", s)).toBe("00Qxx0000012345");
    expect(selectedRecordId("Task", s)).toBeNull();
    // child rows beat cached singles
    s.singles.set("Task", new Map([["00Told", { id: "00Told", fields: { Id: "00Told" } }]]));
    s.children.set("Task::WhoId::00Qxx0000012345", {
      childApi: "Task", lookupField: "WhoId", parentApi: "Lead", parentId: "00Qxx0000012345",
      rows: [{ Id: "00Tfresh", Subject: "Call" }, { Id: "00Tsecond", Subject: "Email" }], offset: 11, exhausted: false,
    });
    expect(selectedRecordId("Task", s)).toBe("00Tfresh");
    // explicit pick wins when aboard, falls back when unknown
    expect(selectedRecordId("Task", s, "00Tsecond")).toBe("00Tsecond");
    expect(selectedRecordId("Task", s, "00Tghost")).toBe("00Tfresh");
  });

  it("formats walk values for peeks", () => {
    expect(formatWalkValue(null)).toBe("—");
    expect(formatWalkValue(undefined)).toBe("—");
    expect(formatWalkValue("Acme")).toBe("Acme");
    expect(formatWalkValue(42)).toBe("42");
    expect(formatWalkValue({ a: 1 })).toBe('{"a":1}');
    expect(formatWalkValue("x".repeat(200))).toHaveLength(120);
  });

  it("resolves key fields via nameField then fallbacks", () => {
    expect(keyFieldFor([{ name: "OrderNumber", type: "string", referenceTo: [], nameField: true }])).toBe("OrderNumber");
    expect(keyFieldFor([
      { name: "Id", type: "id", referenceTo: [] },
      { name: "OrderNumber", type: "string", referenceTo: [] },
    ])).toBe("OrderNumber");
    expect(keyFieldFor([
      { name: "Id", type: "id", referenceTo: [] },
      { name: "Name", type: "string", referenceTo: [] },
    ])).toBe("Name");
    expect(keyFieldFor([{ name: "Id", type: "id", referenceTo: [] }])).toBeNull();
    expect(buildLabelQuery("User", "Name", "005x")).toContain("SELECT Id, Name FROM User");
    expect(labelFromRow({ Id: "005x", Name: "Ada" }, "Name")).toBe("Ada");
    expect(labelFromRow({ Id: "005x" }, "Name")).toBeNull();
    expect(labelFromRow(undefined, "Name")).toBeNull();
  });

  it("routes polymorphic owner ids by prefix (User vs Queue)", () => {
    expect(targetApiForId(["User", "Group"], "005h0000009Yhb4AAC")).toBe("User");
    expect(targetApiForId(["User", "Group"], "00G000000123456E")).toBe("Group");
    expect(targetApiForId(["User"], "00G000000123456E")).toBeNull();
    expect(targetApiForId(["Account"], "001xx000003DGbP")).toBeNull();
    expect(kindForId("User")).toBe("User");
    expect(kindForId("Group")).toBe("Queue");
    expect(kindForId("Account")).toBeNull();
    expect(queueLabelFromRow({ Name: "Ops", Type: "Queue" })).toBe("Ops (queue)");
    expect(queueLabelFromRow({ Name: "Ops", Type: "Regular" })).toBe("Ops");
    expect(queueLabelFromRow({ Id: "00G1" })).toBeNull();
  });

  it("builds lookup picker searches with escaped text", () => {
    expect(buildLookupSearchQuery("Account", "Name", "acme")).toBe(
      "SELECT Id, Name FROM Account WHERE Name LIKE '%acme%' LIMIT 20"
    );
    expect(buildLookupSearchQuery("Account", "Name", "")).toContain("LIKE '%%'");
    expect(buildLookupSearchQuery("Account", "Name", "o'brien")).toContain("o\\'brien");
    expect(buildLookupSearchQuery("Group", null, "ops")).toBe(
      "SELECT Id, Name, Type FROM Group WHERE Name LIKE '%ops%' LIMIT 20"
    );
    expect(buildLookupSearchQuery("Weird__c", null, "")).toBe(
      "SELECT Id FROM Weird__c LIMIT 20"
    );
    expect(buildLookupSearchQuery("Weird__c", null, "001xx")).toBe(
      "SELECT Id FROM Weird__c WHERE Id = '001xx' LIMIT 20"
    );
  });
});

describe("rowsForApi", () => {
  const page = (rows: Record<string, unknown>[]) => ({
    childApi: "Contact",
    lookupField: "AccountId",
    parentApi: "Account",
    parentId: "001A",
    rows,
    offset: rows.length,
    exhausted: true,
  });

  it("merges singles then child rows, deduped by Id", () => {
    const s = emptyLoadedState();
    s.singles.set(
      "Contact",
      new Map([
        ["003A", { id: "003A", fields: { Name: "Ann" } }],
      ])
    );
    s.children.set("Contact::AccountId::001A", page([
      { Id: "003A", Name: "Ann" },
      { Id: "003B", Name: "Bob" },
    ]));
    const rows = rowsForApi(s, "Contact");
    expect(rows.map((r) => r.Id)).toEqual(["003A", "003B"]);
    expect(rows[0]).toMatchObject({ Id: "003A", Name: "Ann" });
  });

  it("ignores other objects and keeps id-less rows", () => {
    const s = emptyLoadedState();
    s.children.set("Task::WhoId::003A", {
      childApi: "Task",
      lookupField: "WhoId",
      parentApi: "Contact",
      parentId: "003A",
      rows: [{ Subject: "stray" }],
      offset: 1,
      exhausted: true,
    });
    expect(rowsForApi(s, "Contact")).toEqual([]);
    expect(rowsForApi(s, "Task")).toEqual([{ Subject: "stray" }]);
  });
});

describe("resolveChildPlans", () => {
  it("fans out one plan per loaded parent (Task WhoId -> Lead + Contact)", () => {
    const s = withRoot();
    s.singles.set("Contact", new Map([["003A", { id: "003A", fields: { Id: "003A" } }]]));
    const plans = resolveChildPlans("Task", s, ctx());
    expect(plans).toEqual([
      { childApi: "Task", lookupField: "WhoId", parentApi: "Lead", parentId: "00Qxx0000012345" },
      { childApi: "Task", lookupField: "WhoId", parentApi: "Contact", parentId: "003A" },
    ]);
  });

  it("dedupes the same parent reached twice and keeps resolveTarget on the first plan", () => {
    const s = withRoot();
    s.children.set("Lead::ConvertedAccountId::001B", {
      childApi: "Lead",
      lookupField: "ConvertedAccountId",
      parentApi: "Account",
      parentId: "001B",
      rows: [{ Id: "00Qxx0000012345" }],
      offset: 1,
      exhausted: true,
    });
    const plans = resolveChildPlans("Task", s, ctx());
    expect(plans).toEqual([
      { childApi: "Task", lookupField: "WhoId", parentApi: "Lead", parentId: "00Qxx0000012345" },
    ]);
    const plan = resolveTarget("Task", s, ctx());
    expect(plan).toEqual({ kind: "children", ...plans[0] });
  });

  it("returns [] when the node has no lookups, and hints the parent count", () => {
    expect(resolveChildPlans("Lead", emptyLoadedState(), ctx())).toEqual([]);
    const s = withRoot();
    s.singles.set("Contact", new Map([["003A", { id: "003A", fields: { Id: "003A" } }]]));
    expect(nodeRecordState("Task", s, ctx())).toEqual({
      state: "reachable",
      hint: "Click to pull via 2 parents",
    });
    expect(nodeRecordState("Task", withRoot(), ctx())).toEqual({
      state: "reachable",
      hint: "Click to pull via Lead",
    });
  });
});
