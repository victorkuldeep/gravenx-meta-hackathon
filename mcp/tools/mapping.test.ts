import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addMappingRule, addRecordPlan, createMappingProject, listMappingProjects, specMappingProject, validateMappingProject } from "./mapping";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gx-mapping-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("mapping tools", () => {
  it("creates a project, plan and rule, then validates and specs it", async () => {
    const created = await createMappingProject(dir, { name: "Order Sync", sourceSystem: "Middleware", sourceApi: "TMF622" });
    expect(created.ok).toBe(true);
    const plan = await addRecordPlan(dir, { ref: "Order Sync", name: "Order", objectName: "Order", intent: "create", sourcePath: "$" });
    expect(plan.ok).toBe(true);
    const rule = await addMappingRule(dir, {
      ref: "Order Sync",
      sourcePath: "$.id",
      objectName: "Order",
      fieldName: "OrderNumber",
      kind: "direct",
      plan: "Order",
    });
    expect(rule.ok).toBe(true);
    expect(rule.data).toMatchObject({ rules: 1 });
    const validated = await validateMappingProject(dir, { ref: "Order Sync" });
    expect(validated.ok).toBe(true);
    const spec = await specMappingProject(dir, { ref: "Order Sync" });
    expect(spec.ok).toBe(true);
    const md = (spec.data as { markdown: string }).markdown;
    expect(md).toContain("# Mapping - Order Sync");
    expect(md).toContain("OrderNumber");
  });

  it("rejects unknown plans, bad kinds and ambiguous refs", async () => {
    await createMappingProject(dir, { name: "A" });
    await createMappingProject(dir, { name: "A Second" });
    // "a" is a substring of both project names -> ambiguous (resolveOne throws).
    await expect(validateMappingProject(dir, { ref: "a" })).rejects.toThrow(/Ambiguous/);
    const badKind = await addMappingRule(dir, {
      ref: "A Second",
      sourcePath: "$.x",
      objectName: "Account",
      fieldName: "Name",
      kind: "fuzzy",
    });
    expect(badKind.ok).toBe(false);
    const unknownPlan = await addMappingRule(dir, {
      ref: "A Second",
      sourcePath: "$.x",
      objectName: "Account",
      fieldName: "Name",
      kind: "direct",
      plan: "Nope",
    });
    expect(unknownPlan.ok).toBe(false);
  });

  it("flags enum rules as needs-decision and lists projects", async () => {
    await createMappingProject(dir, { name: "Enum Case" });
    const rule = await addMappingRule(dir, {
      ref: "Enum Case",
      sourcePath: "$.tier",
      objectName: "Account",
      fieldName: "Tier__c",
      kind: "enum",
      enumMap: [{ sourceValue: "gold", targetValue: "Gold" }],
    });
    expect(rule.ok).toBe(true);
    expect(rule.summary).toMatch(/needs-decision/);
    const listed = await listMappingProjects(dir);
    expect(listed.ok).toBe(true);
    expect((listed.data as { projects: unknown[] }).projects.length).toBe(1);
  });
});
