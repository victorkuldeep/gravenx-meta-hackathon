import { describe, it, expect } from "vitest";
import { detectJunction, buildEdges, buildErdElements, buildGraphElements, rootNeighbors, bubbleInitials, assignBubbleTags, systemReason, isSystemObject, isNeuralExcluded, customParentTargets, customChildTargets, customParentLinks, customChildLinks, standardParentTargets, standardChildTargets, standardParentLinks, standardChildLinks, objectKindOf, OBJECT_KIND_LABEL } from "./graph";
import type { SalesforceDescribeResult } from "@/lib/salesforce/types";

const desc = (
  name: string,
  fields: Array<{ name: string; type?: string; nillable?: boolean; referenceTo?: string[] }>,
  childRelationships: SalesforceDescribeResult["childRelationships"] = []
): SalesforceDescribeResult => ({
  name,
  label: name,
  labelPlural: name,
  custom: false,
  createable: true,
  updateable: true,
  fields: fields.map((f) => ({
    name: f.name,
    label: f.name,
    type: f.type ?? "string",
    length: 0,
    precision: 0,
    scale: 0,
    nillable: f.nillable ?? true,
    createable: true,
    updateable: true,
    calculated: false,
    defaultedOnCreate: false,
    unique: false,
    externalId: false,
    referenceTo: f.referenceTo ?? [],
    relationshipName: f.referenceTo?.length ? f.name : null,
    picklistValues: [],
    restrictedPicklist: false,
    autoNumber: false,
    idLookup: true,
    filterable: true,
    sortable: true,
    groupable: true,
    nameField: false,
    htmlFormatted: false,
    deprecatedAndHidden: false,
    digits: 0,
    byteLength: 0,
    inlineHelpText: null,
    defaultValue: null,
    soapType: "xsd:string",
  })),
  childRelationships,
});

describe("buildEdges linker labels", () => {
  it("labels every edge with its linker field api name", () => {
    const map = new Map<string, SalesforceDescribeResult>([
      ["Account", desc("Account", [], [])],
      [
        "Contact",
        desc("Contact", [
          { name: "AccountId", type: "reference", referenceTo: ["Account"] },
          { name: "ReportsToId", type: "reference", referenceTo: ["Contact"] },
        ]),
      ],
    ]);
    const edges = buildEdges(map);
    // The click pill reads edge.label: parent|child|field ids, field labels.
    expect(edges.find((e) => e.id === "Account|Contact|AccountId")?.label).toBe("AccountId");
    const loop = edges.find((e) => e.id === "Contact|Contact|ReportsToId");
    expect(loop?.label).toBe("ReportsToId");
    expect((loop?.data as { loopLane?: number })?.loopLane).toBe(0);
  });
});

describe("objectKindOf", () => {
  it("classifies all six object families", () => {
    expect(objectKindOf({ name: "Account", custom: false })).toBe("standard");
    expect(objectKindOf({ name: "Pricing_Request__c", custom: true })).toBe("custom");
    expect(objectKindOf({ name: "Org_Defaults__c", custom: true, customSetting: true })).toBe("custom-setting");
    expect(objectKindOf({ name: "Routing_Rule__mdt", custom: true })).toBe("custom-metadata");
    expect(objectKindOf({ name: "Order_Event__b", custom: false })).toBe("big-object");
    // External objects report custom:true - the __x suffix wins.
    expect(objectKindOf({ name: "Lead__x", custom: true })).toBe("external");
  });

  it("prefers suffixes over flags and labels every kind", () => {
    // A setting-shaped name with the flag off is still just custom.
    expect(objectKindOf({ name: "Thing__c", custom: true, customSetting: false })).toBe("custom");
    expect(OBJECT_KIND_LABEL[objectKindOf({ name: "Account", custom: false })]).toBe("Standard");
    expect(OBJECT_KIND_LABEL[objectKindOf({ name: "R__mdt", custom: true })]).toBe("Custom Metadata");
    expect(OBJECT_KIND_LABEL[objectKindOf({ name: "E__b", custom: false })]).toBe("Big Object");
    expect(OBJECT_KIND_LABEL[objectKindOf({ name: "S__c", custom: true, customSetting: true })]).toBe("Custom Setting");
    expect(OBJECT_KIND_LABEL[objectKindOf({ name: "Lead__x", custom: true })]).toBe("External");
  });
});

describe("custom relationship targets", () => {
  const pricing = () =>
    desc(
      "Pricing_Request__c",
      [
        { name: "Opportunity__c", type: "reference", referenceTo: ["Opportunity"] },
        { name: "Account__c", type: "reference", referenceTo: ["Account", "Account"] },
        { name: "OwnerId", type: "reference", referenceTo: ["User"] },
        { name: "CreatedById", type: "reference", referenceTo: ["User"] },
        { name: "Name", type: "string" },
      ],
      [
        { childSObject: "Pricing_Line__c", field: "Pricing_Request__c", relationshipName: "Pricing_Lines__r", cascadeDelete: true },
        { childSObject: "Task", field: "WhatId", relationshipName: "Tasks", cascadeDelete: false },
        { childSObject: "Pricing_Request__c", field: "Parent__c", relationshipName: "Children__r", cascadeDelete: false },
        { childSObject: "Note", field: "", relationshipName: null, cascadeDelete: false },
      ]
    );

  it("pulls parents through custom lookups only", () => {
    expect(customParentTargets(pricing())).toEqual(["Opportunity", "Account"]);
  });

  it("pulls children attached through custom fields only", () => {
    expect(customChildTargets(pricing())).toEqual(["Pricing_Line__c"]);
  });

  it("carries the driving field and line kind per link", () => {
    expect(customParentLinks(pricing())).toEqual([
      { target: "Opportunity", via: "Opportunity__c", kind: "lookup" },
      { target: "Account", via: "Account__c", kind: "lookup" },
    ]);
    expect(customChildLinks(pricing())).toEqual([
      { target: "Pricing_Line__c", via: "Pricing_Request__c", kind: "md" },
    ]);
  });

  it("skips self links, dupes, and unnamed relationships", () => {
    const d = desc("A__c", [{ name: "Self__c", type: "reference", referenceTo: ["A__c"] }], [
      { childSObject: "B__c", field: "A__c", relationshipName: null, cascadeDelete: false },
    ]);
    expect(customParentTargets(d)).toEqual([]);
    expect(customChildTargets(d)).toEqual([]);
  });
});

describe("standard relationship targets", () => {
  const contact = () =>
    desc(
      "Contact",
      [
        { name: "AccountId", type: "reference", referenceTo: ["Account"] },
        { name: "ReportsToId", type: "reference", referenceTo: ["Contact"] },
        { name: "OwnerId", type: "reference", referenceTo: ["User", "Group"] },
        { name: "CreatedById", type: "reference", referenceTo: ["User"] },
        { name: "Segment__c", type: "reference", referenceTo: ["Segment__c"] },
        { name: "LastName", type: "string" },
      ],
      [
        { childSObject: "Case", field: "ContactId", relationshipName: "Cases", cascadeDelete: false },
        { childSObject: "Task", field: "WhoId", relationshipName: "Tasks", cascadeDelete: false },
        { childSObject: "ContactShare", field: "ParentId", relationshipName: "Shares", cascadeDelete: false },
        { childSObject: "Note__c", field: "Contact__c", relationshipName: "Notes__r", cascadeDelete: false },
        { childSObject: "Contact", field: "ReportsToId", relationshipName: "ReportsTo", cascadeDelete: false },
      ]
    );

  it("pulls standard parents minus audit lookups, self, and custom fields", () => {
    expect(standardParentTargets(contact())).toEqual(["Account"]);
  });

  it("pulls standard children minus platform plumbing and custom fields", () => {
    expect(standardChildTargets(contact())).toEqual(["Case"]);
  });

  it("carries the driving field and line kind per link", () => {
    expect(standardParentLinks(contact())).toEqual([
      { target: "Account", via: "AccountId", kind: "lookup" },
    ]);
    expect(standardChildLinks(contact())).toEqual([
      { target: "Case", via: "ContactId", kind: "lookup" },
    ]);
  });
});

describe("detectJunction", () => {
  const noMd = new Map<string, boolean>();
  it("flags 2+ required non-system lookups as junction", () => {
    const d = desc("X__c", [
      { name: "A__c", type: "reference", nillable: false, referenceTo: ["A__c"] },
      { name: "B__c", type: "reference", nillable: false, referenceTo: ["B__c"] },
    ]);
    expect(detectJunction(d, noMd)).toBe(true);
  });
  it("ignores CreatedById / LastModifiedById / OwnerId", () => {
    const d = desc("Account", [
      { name: "CreatedById", type: "reference", nillable: false, referenceTo: ["User"] },
      { name: "LastModifiedById", type: "reference", nillable: false, referenceTo: ["User"] },
      { name: "OwnerId", type: "reference", nillable: false, referenceTo: ["User"] },
    ]);
    expect(detectJunction(d, noMd)).toBe(false);
  });
  it("does not flag single lookup", () => {
    const d = desc("X__c", [
      { name: "A__c", type: "reference", nillable: false, referenceTo: ["A__c"] },
    ]);
    expect(detectJunction(d, noMd)).toBe(false);
  });
  it("nillable lookups don't count without a master-detail leg", () => {
    const d = desc("X__c", [
      { name: "A__c", type: "reference", nillable: true, referenceTo: ["A__c"] },
      { name: "B__c", type: "reference", nillable: true, referenceTo: ["B__c"] },
    ]);
    expect(detectJunction(d, noMd)).toBe(false);
  });
  it("flags a master-detail leg paired with an optional lookup", () => {
    const d = desc("J__c", [
      { name: "MD__c", type: "reference", nillable: false, referenceTo: ["P__c"] },
      { name: "LK__c", type: "reference", nillable: true, referenceTo: ["Q__c"] },
    ]);
    expect(detectJunction(d, new Map([["J__c::MD__c", true]]))).toBe(true);
  });
  it("does not flag a lone master-detail leg", () => {
    const d = desc("J__c", [
      { name: "MD__c", type: "reference", nillable: false, referenceTo: ["P__c"] },
    ]);
    expect(detectJunction(d, new Map([["J__c::MD__c", true]]))).toBe(false);
  });
});

describe("buildEdges", () => {
  it("draws edge only when both ends described", () => {
    const map = new Map<string, SalesforceDescribeResult>([
      [
        "Account",
        desc(
          "Account",
          [{ name: "OwnerId", type: "reference", referenceTo: ["User"] }],
          [{ childSObject: "Contact", field: "AccountId", cascadeDelete: false, relationshipName: "Contacts" }]
        ),
      ],
      [
        "Contact",
        desc("Contact", [
          { name: "AccountId", type: "reference", referenceTo: ["Account"] },
        ]),
      ],
    ]);
    const edges = buildEdges(map);
    const edge = edges.find((e) => e.source === "Account" && e.target === "Contact");
    expect(edge).toBeDefined();
    expect(edge!.data?.kind).toBe("lookup");
  });

  it("flags master-detail when child's cascadeDelete is true", () => {
    const map = new Map<string, SalesforceDescribeResult>([
      [
        "Account",
        desc(
          "Account",
          [],
          [{ childSObject: "Contact", field: "AccountId", cascadeDelete: true, relationshipName: "Contacts" }]
        ),
      ],
      [
        "Contact",
        desc("Contact", [
          { name: "AccountId", type: "reference", referenceTo: ["Account"] },
        ]),
      ],
    ]);
    const edges = buildEdges(map);
    const edge = edges.find((e) => e.source === "Account" && e.target === "Contact");
    expect(edge!.data?.kind).toBe("md");
  });

  it("dedupes edges between same parent/child/field", () => {
    const map = new Map<string, SalesforceDescribeResult>([
      ["Account", desc("Account", [], [])],
      [
        "Contact",
        desc("Contact", [
          { name: "AccountId", type: "reference", referenceTo: ["Account"] },
        ]),
      ],
    ]);
    const edges = buildEdges(map);
    const matches = edges.filter((e) => e.target === "Contact" && e.source === "Account");
    expect(matches.length).toBe(1);
  });
});

describe("buildGraphElements", () => {
  const labels = new Map<string, string>();
  const notCustom = () => false;

  it("shows removed neighbors as dashed lite previews (ghost fix lives in the panel filter)", () => {
    const root = desc(
      "DandBCompany",
      [],
      [
        { childSObject: "Kept", field: "F", cascadeDelete: false, relationshipName: "Kepts" },
        { childSObject: "Removed", field: "F", cascadeDelete: false, relationshipName: "Removeds" },
      ]
    );
    const neighbors = rootNeighbors(root, labels, notCustom);
    expect(neighbors.map((n) => n.apiName).sort()).toEqual(["Kept", "Removed"]);
    // Ghost-link fix lives in SchemaPanel's neighbor filter (removed names
    // never reach the builder). The builder itself renders every neighbor it
    // is given: described = solid, undescribed = dashed lite preview.
    const described = new Set(["DandBCompany", "Kept"]);
    const { nodes, edges } = buildGraphElements(root, neighbors, described, null, null);
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain("c:Kept");
    expect(ids).toContain("c:Removed");
    const lite = nodes.find((n) => n.id === "c:Removed");
    expect((lite!.data as { loaded: boolean }).loaded).toBe(false);
    expect(edges.some((e) => String(e.target).includes("Removed") || String(e.source).includes("Removed"))).toBe(true);
  });

  it("extends family-tree generations outward from their attach node", () => {
    const root = desc("Lead", [], []);
    const neighbors = [
      { apiName: "Account", label: "Account", custom: false, role: "child" as const, via: "F", kind: "lookup" as const },
      { apiName: "Contact", label: "Contact", custom: false, role: "child" as const, via: "F", kind: "lookup" as const, attachTo: "Account", depth: 2 },
    ];
    const { nodes, edges, extended } = buildGraphElements(root, neighbors, new Set(["Lead", "Account", "Contact"]), null, null);
    expect(extended).toBe(1);
    expect(nodes.map((n) => n.id)).toContain("x:Account:Contact");
    expect(edges.some((e) => e.id === "g|Account|Contact|F")).toBe(true);
  });

  it("renders every described bubble loaded (no dashed ghosts)", () => {
    const root = desc(
      "DandBCompany",
      [],
      [{ childSObject: "Kept", field: "F", cascadeDelete: false, relationshipName: "Kepts" }]
    );
    const neighbors = rootNeighbors(root, labels, notCustom);
    const { nodes } = buildGraphElements(root, neighbors, new Set(["DandBCompany", "Kept"]), null, null);
    const bubble = nodes.find((n) => n.id === "c:Kept");
    expect(bubble).toBeDefined();
    expect((bubble!.data as { loaded: boolean }).loaded).toBe(true);
  });

  it("draws hundreds of neighbors with zero overflow (unbounded orbits)", () => {    const root = desc(
      "Lead",
      [],
      Array.from({ length: 200 }, (_, i) => ({
        childSObject: `Child${i}`,
        field: "F",
        cascadeDelete: false,
        relationshipName: `R${i}`,
      }))
    );
    const neighbors = rootNeighbors(root, labels, notCustom);
    expect(neighbors.length).toBe(200);
    const { nodes, overflow } = buildGraphElements(root, neighbors, new Set(["Lead"]), null, null);
    expect(nodes.length).toBe(201); // root + every neighbor
    expect(overflow).toBe(0);
  });

  it("links extended generations bubble-to-bubble (Account→Asset edge survives)", () => {
    const root = desc("Lead", [], []);
    const neighbors = [
      { apiName: "Account", label: "Account", custom: false, role: "child" as const, via: "F", kind: "lookup" as const },
      { apiName: "Asset", label: "Asset", custom: false, role: "child" as const, via: "AccountId", kind: "lookup" as const, attachTo: "Account", depth: 2 },
    ];
    const { nodes, edges } = buildGraphElements(root, neighbors, new Set(["Lead", "Account"]), null, null);
    const assetNode = nodes.find((n) => (n.data as { apiName: string }).apiName === "Asset");
    expect(assetNode).toBeDefined();
    expect(assetNode!.id).toBe("x:Account:Asset");
    // The edge must reference the REAL level-1 bubble id (p:/c:Account),
    // never the bare "Account" name React Flow cannot resolve.
    const link = edges.find((e) => e.id === "g|Account|Asset|AccountId");
    expect(link).toBeDefined();
    const srcId = String(link!.source);
    const tgtId = String(link!.target);
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids.has(srcId)).toBe(true);
    expect(ids.has(tgtId)).toBe(true);
    expect(tgtId).toBe("x:Account:Asset");
  });

  it("mesh: same object under two parents shares one bubble with two edges", () => {
    const root = desc("Lead", [], []);
    const neighbors = [
      { apiName: "Account", label: "Account", custom: false, role: "child" as const, via: "F", kind: "lookup" as const },
      { apiName: "DNB", label: "D&B", custom: false, role: "child" as const, via: "F", kind: "lookup" as const },
      { apiName: "DNB", label: "D&B", custom: false, role: "child" as const, via: "G", kind: "lookup" as const, attachTo: "Account", depth: 2 },
    ];
    const { nodes, edges } = buildGraphElements(root, neighbors, new Set(["Lead"]), null, null, "mesh");
    const dnb = nodes.filter((n) => (n.data as { apiName: string }).apiName === "DNB");
    expect(dnb).toHaveLength(1); // one shared bubble
    const ids = new Set(nodes.map((n) => n.id));
    const dnbEdges = edges.filter((e) => String(e.id).includes("|DNB|"));
    expect(dnbEdges.length).toBe(2); // Lead>D&B AND Account>D&B
    for (const e of dnbEdges) {
      expect(ids.has(String(e.source))).toBe(true);
      expect(ids.has(String(e.target))).toBe(true);
    }
  });

  it("linear: same object under two parents gets independent bubbles", () => {
    const root = desc("Lead", [], []);
    const neighbors = [
      { apiName: "Account", label: "Account", custom: false, role: "child" as const, via: "F", kind: "lookup" as const },
      { apiName: "DNB", label: "D&B", custom: false, role: "child" as const, via: "F", kind: "lookup" as const },
      { apiName: "DNB", label: "D&B", custom: false, role: "child" as const, via: "G", kind: "lookup" as const, attachTo: "Account", depth: 2 },
    ];
    const { nodes, edges } = buildGraphElements(root, neighbors, new Set(["Lead"]), null, null, "linear");
    const dnb = nodes.filter((n) => (n.data as { apiName: string }).apiName === "DNB");
    expect(dnb.length).toBe(2); // independent bubbles per attach path
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length); // ids unique
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length); // edge ids unique
  });
});

describe("system-noise detection", () => {  it("flags core org objects", () => {
    expect(systemReason({ apiName: "User", role: "parent", via: "OwnerId" })).toBe("system object");
    expect(systemReason({ apiName: "Profile", role: "child", via: "X" })).toBe("system object");
  });
  it("flags audit parents only via audit fields", () => {
    expect(systemReason({ apiName: "User", role: "parent", via: "CreatedById" })).toBe("system object"); // identity wins
    expect(systemReason({ apiName: "SomeParent", role: "parent", via: "CreatedById" })).toBe("audit lookup (CreatedById)");
    expect(systemReason({ apiName: "SomeParent", role: "parent", via: "Custom_Lookup__c" })).toBeNull();
    expect(systemReason({ apiName: "Account", role: "child", via: "CreatedById" })).toBeNull(); // children never audit
  });
  it("flags Share/Feed/History children, keeps real objects", () => {
    expect(systemReason({ apiName: "LeadShare", role: "child", via: "R" })).toBe("platform family");
    expect(systemReason({ apiName: "LeadFeed", role: "child", via: "R" })).toBe("platform family");
    expect(systemReason({ apiName: "LeadHistory", role: "child", via: "R" })).toBe("platform family");
    expect(systemReason({ apiName: "Contact", role: "child", via: "R" })).toBeNull();
    expect(systemReason({ apiName: "Account", role: "parent", via: "AccountId" })).toBeNull();
  });
  it("isSystemObject covers ERD-level names", () => {
    expect(isSystemObject("User")).toBe(true);
    expect(isSystemObject("LeadShare")).toBe(true);
    expect(isSystemObject("Opportunity")).toBe(false);
  });
  it("covers the extended platform list", () => {
    for (const name of [
      "VoiceCall", "VideoCall", "Visit", "EngagementTopic",
      "AttachedContentNote", "GeneratedDocument", "DocumentEnvelope",
      "DocumentChecklistItem", "NoteAndAttachment",
      "RecordAction", "RecordAlert", "ProcessException", "DuplicateRecordItem",
      "NetworkUserHistoryRecent", "OmniAssessmentTask", "GenericVisitTaskContext",
    ]) {
      expect(isSystemObject(name)).toBe(true);
    }
    expect(isSystemObject("Account")).toBe(false);
  });
  it("isNeuralExcluded keeps sweeps domain-only, custom always passes", () => {
    expect(isNeuralExcluded("Task", false)).toBe(true);
    expect(isNeuralExcluded("User", false)).toBe(true);
    expect(isNeuralExcluded("LeadShare", false)).toBe(true);
    expect(isNeuralExcluded("Account", false)).toBe(false);
    expect(isNeuralExcluded("Quote__c", true)).toBe(false);
    expect(isNeuralExcluded("Task__c", true)).toBe(false); // custom always deep
  });
});

describe("bubbleInitials", () => {  it("disambiguates prefixed team names by last two segments", () => {
    expect(bubbleInitials("DESIGNFORM_PRICING_REQUEST__c")).toBe("PR");
    expect(bubbleInitials("DESIGNFORM_REQUEST_TERM")).toBe("RT");
  });
  it("splits camelCase and strips namespaces", () => {
    expect(bubbleInitials("OrderItem")).toBe("OI");
    expect(bubbleInitials("ns__MyObject__c")).toBe("MO");
    expect(bubbleInitials("DandBCompany")).toBe("DB");
  });
  it("keeps first-two-letters for single words", () => {
    expect(bubbleInitials("Lead")).toBe("LE");
    expect(bubbleInitials("Account")).toBe("AC");
  });
});

describe("assignBubbleTags", () => {
  it("word-splits multi-word names and resolves collisions in sequence", () => {
    const tags = assignBubbleTags(["DESIGN_REQUEST__c", "DESIGN_FORM__c", "Lead", "Account"]);
    expect(tags.get("DESIGN_FORM__c")).toBe("DF");
    expect(tags.get("DESIGN_REQUEST__c")).toBe("DR");
    expect(tags.get("Lead")).toBe("LE");
    expect(tags.get("Account")).toBe("AC");
  });
  it("walks FIRST+LAST, earlier words, 3-char, then numeric fallback", () => {
    // AB_X2__c claims AX first (A+X initials); AB_X__c escapes via numeric
    // fallback (AX2); AB_Y__c escapes via FIRST+LAST (AY). All unique.
    const tags = assignBubbleTags(["AB_X__c", "AB_Y__c", "AB_X2__c"]);
    const vals = [...tags.values()];
    expect(new Set(vals).size).toBe(vals.length); // all unique
    expect(tags.get("AB_X2__c")).toBe("AX");
    expect(tags.get("AB_X__c")).toBe("AX2");
    expect(tags.get("AB_Y__c")).toBe("AY");
  });
  it("falls back to numeric suffixes when every candidate collides", () => {
    const tags = assignBubbleTags(["AB", "Ab", "aB"]);
    expect(new Set([...tags.values()]).size).toBe(3);
  });
  it("is deterministic regardless of input order", () => {
    const a = assignBubbleTags(["Zulu", "Alpha", "Mike"]);
    const b = assignBubbleTags(["Mike", "Zulu", "Alpha"]);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });
});

describe("buildErdElements link spotlight", () => {
  const canvas = () =>
    new Map([
      ["Account", desc("Account", [])],
      ["Contact", desc("Contact", [{ name: "AccountId", type: "reference", referenceTo: ["Account"] }])],
      ["Lead", desc("Lead", [])],
    ]);
  const flags = (spot: { focus: string; related: Set<string>; soft?: boolean } | null) => {
    const { nodes } = buildErdElements(canvas(), new Map(), "Account", spot);
    return new Map(nodes.map((n) => [n.id, { spotlight: n.data.spotlight, linked: n.data.linked, linkFocus: n.data.linkFocus, dimmed: n.data.dimmed }]));
  };
  it("marks the clicked link\u2019s other end linked, the rest dimmed", () => {
    const f = flags({ focus: "Account", related: new Set(["Account", "Contact"]) });
    expect(f.get("Account")).toMatchObject({ spotlight: true, linked: false, dimmed: false });
    expect(f.get("Contact")).toMatchObject({ spotlight: false, linked: true, dimmed: false });
    expect(f.get("Lead")).toMatchObject({ spotlight: false, linked: false, dimmed: true });
  });
  it("soft link highlight pairs without dimming the rest", () => {
    const f = flags({ focus: "Account", related: new Set(["Account", "Contact"]), soft: true });
    expect(f.get("Account")).toMatchObject({ spotlight: true, linked: false, linkFocus: true, dimmed: false });
    expect(f.get("Contact")).toMatchObject({ spotlight: false, linked: true, linkFocus: false, dimmed: false });
    expect(f.get("Lead")).toMatchObject({ spotlight: false, linked: false, linkFocus: false, dimmed: false });
  });
  it("clears every flag without a spot", () => {
    const f = flags(null);
    for (const v of f.values()) expect(v).toEqual({ spotlight: false, linked: false, linkFocus: false, dimmed: false });
  });
});

describe("buildErdElements record types", () => {
  it("carries record type infos onto the table node", () => {
    const withRt = {
      ...desc("Account", []),
      recordTypeInfos: [
        { recordTypeId: "012ABC", developerName: "Customer", name: "Customer", active: true, master: false, defaultRecordTypeMapping: true },
      ],
    };
    const { nodes } = buildErdElements(new Map([["Account", withRt]]), new Map(), "Account", null);
    expect(nodes[0].data.recordTypes).toHaveLength(1);
    expect(nodes[0].data.recordTypes[0]).toMatchObject({ developerName: "Customer", recordTypeId: "012ABC" });
  });
  it("defaults to empty without record type infos", () => {
    const { nodes } = buildErdElements(new Map([["Account", desc("Account", [])]]), new Map(), "Account", null);
    expect(nodes[0].data.recordTypes).toEqual([]);
  });
});
