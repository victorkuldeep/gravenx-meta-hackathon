import { describe, expect, it, vi } from "vitest";
import {
  buildErdBridgeHandlers,
  ERD_BRIDGE_KINDS,
  resolveObjectRef,
  type ErdBridgeContext,
} from "./erd";
import type { SalesforceDescribeResult, SalesforceField } from "../salesforce/types";

function describeOf(
  name: string,
  parents: { field: string; to: string; label?: string }[] = [],
  children: { child: string; via?: string }[] = [],
): SalesforceDescribeResult {
  return {
    name,
    label: `${name} Label`,
    labelPlural: `${name} Labels`,
    custom: name.endsWith("__c"),
    createable: true,
    updateable: true,
    fields: parents.map((p): SalesforceField => ({
      name: p.field,
      label: p.field,
      type: "reference",
      length: 18,
      precision: 0,
      scale: 0,
      nillable: true,
      createable: true,
      updateable: true,
      calculated: false,
      defaultedOnCreate: false,
      unique: false,
      externalId: false,
      referenceTo: [p.to],
      relationshipName: p.label ?? null,
      picklistValues: [],
      restrictedPicklist: false,
      autoNumber: false,
      idLookup: false,
      filterable: true,
      sortable: true,
      groupable: false,
      nameField: false,
      htmlFormatted: false,
      deprecatedAndHidden: false,
      digits: 0,
      byteLength: 18,
      inlineHelpText: null,
      defaultValue: null,
      soapType: "xsd:string",
    })),
    childRelationships: children.map((c) => ({
      childSObject: c.child,
      field: c.via ?? "ParentId",
      relationshipName: `${c.child}List`,
      cascadeDelete: false,
    })),
  };
}

function setupCtx(): ErdBridgeContext & {
  calls: { focus: string[]; views: string[]; hides: boolean[]; modes: string[]; hidden: { names: string[]; hide: boolean }[]; removed: string[][]; upserted: { id: string; name: string; color: string }[]; assigned: { tagId: string; names: string[]; on: boolean }[]; deleted: string[]; fieldDrafts: { childApi: string; apiName: string }[]; objectDrafts: string[] };
} {
  const tagRegistry = [{ id: "tag-1", name: "Core", color: "#722F37" }];
  const nodeTags: Record<string, string[]> = { Account: ["tag-1"] };
  const calls = { focus: [] as string[], views: [] as string[], hides: [] as boolean[], modes: [] as string[], hidden: [] as { names: string[]; hide: boolean }[], removed: [] as string[][], upserted: [] as { id: string; name: string; color: string }[], assigned: [] as { tagId: string; names: string[]; on: boolean }[], deleted: [] as string[], fieldDrafts: [] as { childApi: string; apiName: string }[], objectDrafts: [] as string[] };
  const account = describeOf("Account", [], [{ child: "Contact", via: "AccountId" }]);
  const contact = describeOf("Contact", [{ field: "AccountId", to: "Account", label: "Account" }], []);
  const ctx: ErdBridgeContext = {
    objects: [
      { name: "Account", label: "Account" },
      { name: "Contact", label: "Contact" },
      { name: "Custom__c", label: "Custom Thing" },
    ],
    describes: new Map([["Account", account]]),
    rootName: "Root__c",
    focusName: "Account",
    view: "erd",
    hideSystem: false,
    filterMode: "all",
    tagRegistry,
    nodeTags,
    authorMode: true,
    nodePositions: () => ({ Account: { x: 10, y: 20 } }),
    focusCanvasOn: (name) => { calls.focus.push(name); },
    setFocusName: () => {},
    setView: (v) => { ctx.view = v; calls.views.push(v); },
    setHideSystem: (hide) => { ctx.hideSystem = hide; calls.hides.push(hide); },
    hideNames: (names, hide) => { calls.hidden.push({ names, hide }); },
    removeNames: (names) => { calls.removed.push(names); for (const n of names) ctx.describes.delete(n); },
    setFilterMode: (mode) => { ctx.filterMode = mode; calls.modes.push(mode); },
    upsertTag: (tag) => { calls.upserted.push(tag); ctx.tagRegistry.push(tag); },
    assignTag: (tagId, names, on) => { calls.assigned.push({ tagId, names, on }); },
    deleteTag: (tagId) => { calls.deleted.push(tagId); },
    addNames: async (names) => {
      const fresh = names.map((n) => (n === "Contact" ? contact : describeOf(n)));
      for (const d of fresh) ctx.describes.set(d.name, d);
      return fresh;
    },
    describeCached: async (name) => ctx.describes.get(name) ?? (name === "Contact" ? contact : null),
    submitAuthorField: async (draft, childApi) => {
      calls.fieldDrafts.push({ childApi, apiName: draft.apiName });
    },
    submitAuthorObject: async (draft) => {
      calls.objectDrafts.push(draft.apiName);
    },
  };
  return Object.assign(ctx, { calls });
}

describe("resolveObjectRef", () => {
  const objects = [
    { name: "Account", label: "Account" },
    { name: "Contact", label: "Contact" },
    { name: "Custom__c", label: "Custom Thing" },
  ];
  it("prefers exact api name, case-insensitive", () => {
    expect(resolveObjectRef(objects, "account")).toBe("Account");
  });
  it("falls back to exact label", () => {
    expect(resolveObjectRef(objects, "Custom Thing")).toBe("Custom__c");
  });
  it("auto-resolves a single substring hit", () => {
    expect(resolveObjectRef(objects, "cont")).toBe("Contact");
  });
  it("throws unknown for no match", () => {
    expect(() => resolveObjectRef(objects, "Nope__c")).toThrow(/Unknown object/);
  });
  it("throws ambiguous listing candidates", () => {
    expect(() => resolveObjectRef(objects, "c")).toThrow(/Ambiguous object/);
  });
});

describe("erd bridge handlers", () => {
  it("registers all 14 protocol kinds", () => {
    const handlers = buildErdBridgeHandlers(setupCtx());
    for (const kind of ERD_BRIDGE_KINDS) expect(handlers[kind]).toBeTypeOf("function");
    expect(ERD_BRIDGE_KINDS).toHaveLength(14);
  });

  it("ping reports protocol v1", async () => {
    const data = await buildErdBridgeHandlers(setupCtx())["bridge.ping"]!({});
    expect(data).toMatchObject({ ok: true, protocol: 1 });
  });

  it("snapshot lists on-canvas nodes with positions, focus and filters", async () => {
    const data = (await buildErdBridgeHandlers(setupCtx())["erd.snapshot"]!({})) as {
      nodes: { apiName: string; position: { x: number; y: number } | null }[];
      focus: string;
      view: string;
      links: { source: string; target: string; relation: string }[];
    };
    expect(data.nodes.map((n) => n.apiName)).toEqual(["Account"]);
    expect(data.nodes[0].position).toEqual({ x: 10, y: 20 });
    expect(data.focus).toBe("Account");
    expect(data.view).toBe("erd");
    expect(data.links).toEqual([
      { source: "Account", target: "Contact", label: "ContactList", relation: "child" },
    ]);
  });

  it("discover reports parents/children with on-canvas flags", async () => {
    const handlers = buildErdBridgeHandlers(setupCtx());
    const kids = (await handlers["erd.discover"]!({ apiName: "Account", direction: "children" })) as {
      children: { apiName: string; onCanvas: boolean }[];
    };
    expect(kids.children).toEqual([
      expect.objectContaining({ apiName: "Contact", onCanvas: false }),
    ]);
    const pars = (await handlers["erd.discover"]!({ apiName: "Contact", direction: "parents" })) as {
      parents: { apiName: string; viaField: string; onCanvas: boolean }[];
    };
    expect(pars.parents).toEqual([
      { apiName: "Account", viaField: "AccountId", label: "Account", onCanvas: true },
    ]);
  });

  it("discover rejects unknown objects without hitting the org", async () => {
    const handlers = buildErdBridgeHandlers(setupCtx());
    await expect(handlers["erd.discover"]!({ apiName: "Nope__c" })).rejects.toThrow(/Unknown object/);
  });

  it("objects searches by name or label with canvas flags", async () => {
    const handlers = buildErdBridgeHandlers(setupCtx());
    const all = (await handlers["erd.objects"]!({})) as {
      query: string;
      count: number;
      objects: { apiName: string; custom: boolean; onCanvas: boolean }[];
    };
    expect(all.count).toBe(3);
    expect(all.objects.find((o) => o.apiName === "Custom__c")).toMatchObject({ custom: true, onCanvas: false });
    const filtered = (await handlers["erd.objects"]!({ query: "cont", limit: 5 })) as typeof all;
    expect(filtered.objects.map((o) => o.apiName)).toEqual(["Contact"]);
    expect(filtered.objects[0]).toMatchObject({ label: "Contact", onCanvas: false });
  });

  it("hide and remove curate on-canvas nodes, refusing off-canvas refs", async () => {
    const ctx = setupCtx();
    const handlers = buildErdBridgeHandlers(ctx);
    await expect(handlers["erd.hide"]!({ apiNames: [] })).rejects.toThrow(/at least one/);
    await expect(handlers["erd.hide"]!({ apiNames: ["Contact"] })).rejects.toThrow(/not on the canvas/);
    await expect(handlers["erd.remove"]!({ apiNames: ["Contact"] })).rejects.toThrow(/not on the canvas/);
    const hid = (await handlers["erd.hide"]!({ apiNames: ["Account"] })) as { hidden: string[] };
    expect(hid).toEqual({ hidden: ["Account"] });
    expect(ctx.calls.hidden).toEqual([{ names: ["Account"], hide: true }]);
    const shown = (await handlers["erd.hide"]!({ apiNames: ["account"], hide: false })) as { shown: string[] };
    expect(shown).toEqual({ shown: ["Account"] });
    const out = (await handlers["erd.remove"]!({ apiNames: ["Account"] })) as { removed: string[] };
    expect(out).toEqual({ removed: ["Account"] });
    expect(ctx.calls.removed).toEqual([["Account"]]);
  });

  it("arch.activity reads the audit trail with actor/category filters", async () => {
    const ctx = setupCtx();
    const handlers = buildErdBridgeHandlers(ctx);
    // No IndexedDB in the test env - the trail reads empty instead of throwing.
    const out = (await handlers["arch.activity"]!({ limit: 10 })) as {
      entries: unknown[];
      count: number;
    };
    expect(out).toEqual({ entries: [], count: 0 });
    await expect(handlers["arch.activity"]!({ actor: "someone" })).rejects.toThrow(/Unknown actor/);
    await expect(handlers["arch.activity"]!({ category: "everything" })).rejects.toThrow(/Unknown category/);
  });

  it("place resolves refs then focuses the first placed node", async () => {
    const ctx = setupCtx();
    const out = (await buildErdBridgeHandlers(ctx)["erd.place"]!({ apiNames: ["contact"] })) as {
      placed: string[];
      focused: string;
    };
    expect(out.placed).toEqual(["Contact"]);
    expect(out.focused).toBe("Contact");
    expect(ctx.calls.focus).toEqual(["Contact"]);
    expect(ctx.describes.has("Contact")).toBe(true);
  });

  it("place refuses an empty list", async () => {
    await expect(buildErdBridgeHandlers(setupCtx())["erd.place"]!({ apiNames: [] })).rejects.toThrow(
      /at least one/,
    );
  });

  it("focus requires the node to be on canvas", async () => {
    const ctx = setupCtx();
    await expect(buildErdBridgeHandlers(ctx)["erd.focus"]!({ apiName: "Contact" })).rejects.toThrow(
      /not on the canvas/,
    );
    const out = (await buildErdBridgeHandlers(ctx)["erd.focus"]!({ apiName: "Account" })) as { focused: string };
    expect(out.focused).toBe("Account");
    expect(ctx.calls.focus).toEqual(["Account"]);
  });

  it("mode and filter switch live view state", async () => {
    const ctx = setupCtx();
    const handlers = buildErdBridgeHandlers(ctx);
    await handlers["erd.mode"]!({ mode: "graph" });
    expect(ctx.calls.views).toEqual(["graph"]);
    await expect(handlers["erd.mode"]!({ mode: "bogus" })).rejects.toThrow(/mode/);
    const f = (await handlers["erd.filter"]!({ hideSystem: true })) as { hideSystem: boolean };
    expect(f.hideSystem).toBe(true);
    expect(ctx.calls.hides).toEqual([true]);
    const m = (await handlers["erd.filter"]!({ mode: "custom" })) as { filterMode: string };
    expect(m.filterMode).toBe("custom");
    expect(ctx.calls.modes).toEqual(["custom"]);
    await expect(handlers["erd.filter"]!({ mode: "bogus" })).rejects.toThrow(/Unknown filter mode/);
  });

  it("tags list, create, assign and unassign through the registry", async () => {
    const ctx = setupCtx();
    const handlers = buildErdBridgeHandlers(ctx);
    const listed = (await handlers["erd.tags"]!({})) as {
      tags: { name: string }[];
      assigned: Record<string, string[]>;
    };
    expect(listed.tags.map((t) => t.name)).toEqual(["Core"]);
    expect(listed.assigned).toEqual({ Account: ["tag-1"] });
    await expect(handlers["erd.tags"]!({ action: "frobnicate" })).rejects.toThrow(/list, create, assign/);
    await expect(handlers["erd.tags"]!({ action: "create", name: "   " })).rejects.toThrow(/tag name/);
    const created = (await handlers["erd.tags"]!({ action: "create", name: "  Billing  " })) as {
      created: { id: string; name: string; color: string };
    };
    expect(created.created.name).toBe("Billing");
    expect(created.created.id).not.toBe("tag-1");
    expect(ctx.calls.upserted.map((t) => t.name)).toContain("Billing");
    await expect(handlers["erd.tags"]!({ action: "assign", tag: "Nope", apiNames: ["Account"] })).rejects.toThrow(
      /Unknown tag/,
    );
    await expect(handlers["erd.tags"]!({ action: "assign", tag: "Core", apiNames: ["Nope__c"] })).rejects.toThrow(
      /Unknown object/,
    );
    await expect(handlers["erd.tags"]!({ action: "assign", tag: "Core", apiNames: ["Contact"] })).rejects.toThrow(
      /not on the canvas/,
    );
    const assigned = (await handlers["erd.tags"]!({ action: "assign", tag: "core", apiNames: ["Account"] })) as {
      tag: string;
      assigned: string[];
    };
    expect(assigned).toEqual({ tag: "Core", assigned: ["Account"] });
    expect(ctx.calls.assigned).toEqual([{ tagId: "tag-1", names: ["Account"], on: true }]);
    const unassigned = (await handlers["erd.tags"]!({ action: "unassign", tag: "tag-1", apiNames: ["Account"] })) as {
      tag: string;
      unassigned: string[];
    };
    expect(unassigned).toEqual({ tag: "Core", unassigned: ["Account"] });
    const deleted = (await handlers["erd.tags"]!({ action: "delete", tag: "Core" })) as {
      deleted: string;
    };
    expect(deleted).toEqual({ deleted: "Core" });
    expect(ctx.calls.deleted).toEqual(["tag-1"]);
  });

  it("author_field builds a draft and routes through submit", async () => {
    const ctx = setupCtx();
    const out = (await buildErdBridgeHandlers(ctx)["erd.author_field"]!({
      childApi: "Account",
      apiName: "Tier__c",
      label: "Tier",
      type: "Picklist",
    })) as { scheduled: boolean };
    expect(out.scheduled).toBe(true);
    expect(ctx.calls.fieldDrafts).toEqual([{ childApi: "Account", apiName: "Tier__c" }]);
  });

  it("author_field rejects bad types and missing parents", async () => {
    const ctx = setupCtx();
    const handlers = buildErdBridgeHandlers(ctx);
    await expect(
      handlers["erd.author_field"]!({ childApi: "Account", apiName: "X__c", type: "Hyperdrive" }),
    ).rejects.toThrow(/Unknown field type/);
    await expect(handlers["erd.author_field"]!({ childApi: "Nope__c", apiName: "X__c" })).rejects.toThrow(
      /Unknown object/,
    );
  });

  it("author_object drafts default labels from the api name", async () => {
    const ctx = setupCtx();
    const out = (await buildErdBridgeHandlers(ctx)["erd.author_object"]!({ apiName: "Invoice__c" })) as {
      scheduled: boolean;
    };
    expect(out.scheduled).toBe(true);
    expect(ctx.calls.objectDrafts).toEqual(["Invoice__c"]);
  });

  it("routes the draft verbatim into submitAuthorObject", async () => {
    const ctx = setupCtx();
    const spy = vi.spyOn(ctx, "submitAuthorObject").mockResolvedValue(undefined);
    const out = (await buildErdBridgeHandlers(ctx)["erd.author_object"]!({
      apiName: "Invoice__c",
      label: "Invoice",
    })) as { scheduled: boolean; apiName: string };
    expect(out).toEqual({ scheduled: true, apiName: "Invoice__c" });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatchObject({ apiName: "Invoice__c", label: "Invoice" });
  });
});