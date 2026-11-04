import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { importSequenceFile } from "@/lib/sequence/packageIo";
import { importExperiencePackage } from "@/lib/wireframe/packageIo";
import { importProject } from "@/lib/system-design/model";
import { importDecisions } from "@/lib/decisions/store";
import { importRequirements } from "@/lib/requirements/store";
import { importConsoleTasks } from "@/lib/console/store";
import { claimFile, readJson, resolveWorkspace, writeJson } from "./workspace";
import { createSequence, parseDsl } from "./tools/sequence";
import { wireframeTools } from "./tools/wireframe";
import { systemTools } from "./tools/system";
import { erdTools } from "./tools/erd";
import { governanceTools } from "./tools/governance";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gravenx-mcp-"));
});

function tool(name: string) {
  const all = [...wireframeTools, ...systemTools, ...erdTools, ...governanceTools];
  const t = all.find((x) => x.name === name);
  if (!t) throw new Error(`tool missing: ${name}`);
  return t;
}

describe("mcp workspace", () => {
  it("resolves and creates the dir", () => {
    expect(typeof resolveWorkspace()).toBe("string");
  });

  it("refuses to clobber without overwrite", () => {
    const f = claimFile(dir, "sequence", "Dupe Flow");
    writeJson(f, { hello: 1 });
    expect(() => claimFile(dir, "sequence", "Dupe Flow")).toThrow(/File exists/);
    expect(claimFile(dir, "sequence", "Dupe Flow", true)).toBe(f);
  });

  it("round-trips JSON", () => {
    const f = claimFile(dir, "sequence", "RT");
    writeJson(f, { a: [1, 2] });
    expect(readJson(f)).toEqual({ a: [1, 2] });
    expect(JSON.parse(readFileSync(f, "utf8")).a).toEqual([1, 2]);
  });
});

describe("mcp sequence tools", () => {
  const dsl = ["participant A", "participant B", "A -> B: Hello", "B --> A: Hi"].join("\n");

  it("parses valid DSL and rejects garbage with line numbers", async () => {
    const ok = await parseDsl(dsl);
    expect(ok.ok).toBe(true);
    expect((ok.data as { participants: string[] }).participants).toEqual(["A", "B"]);
    const bad = await parseDsl("end\n");
    expect(bad.ok).toBe(false);
    expect(bad.error ?? "").toMatch(/line 1/);
  });

  it("creates a studio-importable package file", async () => {
    const r = await createSequence(dir, { name: "Hello Flow", dsl });
    expect(r.ok).toBe(true);
    const stored = readJson(r.file as string);
    const back = importSequenceFile(JSON.stringify(stored), "hello.json");
    expect(back.ok).toBe(true);
    expect(back.document?.participants.map((p) => p.name)).toEqual(["A", "B"]);
  });
});

describe("mcp wireframe tools", () => {
  it("builds an experience screens-first, components bound, spec out", async () => {
    const create = tool("wireframe_create");
    const c = await create.run(dir, { name: "Portal" });
    expect(c.ok).toBe(true);

    const addScreen = tool("wireframe_add_screen");
    const s = await addScreen.run(dir, { ref: "portal", name: "Capture" });
    expect(s.ok).toBe(true);
    const screenId = (s.data as { id: string }).id;

    const addComp = tool("wireframe_add_component");
    const good = await addComp.run(dir, {
      ref: "portal",
      screen: screenId,
      kind: "sffield",
      label: "Customer name",
      binding: { source: "salesforce", object: "Account", field: "Name" },
      bindingState: "existing",
    });
    expect(good.ok).toBe(true);

    const badKind = addComp.run(dir, { ref: "portal", screen: screenId, kind: "nope", label: "x" });
    await expect(badKind).rejects.toThrow();

    const validate = tool("wireframe_validate");
    const v = await validate.run(dir, { ref: "portal" });
    expect(v.ok).toBe(true);

    const spec = tool("wireframe_spec");
    const sp = await spec.run(dir, { ref: "portal" });
    expect(sp.ok).toBe(true);
    expect(typeof (sp.data as { spec: string }).spec).toBe("string");

    // Studio opens the exact file the agent wrote.
    const stored = readJson(c.file as string);
    const back = importExperiencePackage(JSON.stringify(stored));
    expect(back.ok).toBe(true);
  });
});

describe("mcp system tools", () => {
  it("creates a sample, validates and summarizes it", async () => {
    const create = tool("system_create_sample");
    const c = await create.run(dir, { sample: "fanout" });
    expect(c.ok).toBe(true);
    const id = (c.data as { id: string }).id;

    const validate = tool("system_validate");
    const v = await validate.run(dir, { ref: id });
    expect(v.ok).toBe(true);

    const summarize = tool("system_summarize");
    const s = await summarize.run(dir, { ref: id });
    expect(s.ok).toBe(true);
    expect(((s.data as { systems: string[] }).systems ?? []).length).toBeGreaterThan(0);

    const stored = readJson(c.file as string);
    expect(importProject(stored).project).not.toBeNull();
  });
});

describe("mcp erd tools", () => {
  it("creates a gridded canvas and validates it", async () => {
    const create = tool("erd_create_canvas");
    const c = await create.run(dir, {
      name: "Orders",
      root: "Account",
      nodes: ["Account", "Contact", "Order__c"],
    });
    expect(c.ok).toBe(true);
    const stored = readJson(c.file as string) as {
      positions: Record<string, { x: number; y: number }>;
    };
    expect(Object.keys(stored.positions)).toEqual(["Account", "Contact", "Order__c"]);

    const validate = tool("erd_validate");
    const v = await validate.run(dir, { ref: "orders" });
    expect(v.ok).toBe(true);
  });
});

describe("mcp governance tools", () => {
  it("numbers decisions and requirements, validates through studio importers", async () => {
    const mkDecision = tool("decision_create");
    const d1 = await mkDecision.run(dir, { title: "Use middleware" });
    const d2 = await mkDecision.run(dir, { title: "Async downstream" });
    expect((d1.data as { number: string }).number).toBe("ADR-001");
    expect((d2.data as { number: string }).number).toBe("ADR-002");
    for (const r of [d1, d2]) {
      const stored = readJson(r.file as string);
      const back = importDecisions(JSON.stringify(stored), []);
      expect(back.decisions.length).toBe(1);
    }

    const mkReq = tool("requirement_create");
    const q = await mkReq.run(dir, { title: "Order confirmation email", body: "Send it." });
    expect((q.data as { number: string }).number).toBe("REQ-001");
    const stored = readJson(q.file as string);
    expect(importRequirements(JSON.stringify(stored), []).requirements.length).toBe(1);
  });

  it("logs console tasks the studio can import", async () => {
    const mkTask = tool("console_create_task");
    const t = await mkTask.run(dir, {
      title: "Review retry policy",
      kind: "task",
      priority: "high",
      body: "- [ ] timeouts stated",
    });
    expect(t.ok).toBe(true);
    const stored = readJson(t.file as string);
    expect(importConsoleTasks(JSON.stringify(stored)).tasks.length).toBe(1);

    const list = tool("console_list_tasks");
    const l = await list.run(dir, {});
    expect(((l.data as { items: unknown[] }).items ?? []).length).toBe(1);
  });
});
