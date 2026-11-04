import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addContractField, createContract, listContracts, specContract, validateContract } from "./contracts";
import { appendNote, createNote, getNote, listNotes } from "./notes";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gx-epic3-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("contract tools", () => {
  it("creates a contract, adds fields, validates and specs it", async () => {
    const created = await createContract(dir, { name: "Lead Intake", targetObject: "Lead", consumer: "WebForms" });
    expect(created.ok).toBe(true);
    const dup = await addContractField(dir, { ref: "Lead Intake", apiName: "Email" });
    expect(dup.ok).toBe(true);
    const dup2 = await addContractField(dir, { ref: "Lead Intake", apiName: "Email" });
    expect(dup2.ok).toBe(false);
    const validated = await validateContract(dir, { ref: "Lead Intake" });
    expect(validated.ok).toBe(true);
    const spec = await specContract(dir, { ref: "Lead Intake" });
    expect(spec.ok).toBe(true);
    const md = (spec.data as { markdown: string }).markdown;
    expect(md).toContain("# API Contract - Lead Intake");
    expect(md).toContain("Email");
    const listed = await listContracts(dir);
    expect((listed.data as { contracts: unknown[] }).contracts.length).toBe(1);
  });

  it("rejects bad operations and unknown refs", async () => {
    await expect(validateContract(dir, { ref: "Nope" })).rejects.toThrow(/No contract matches/);
    const noConsumer = await createContract(dir, { name: "C0", targetObject: "Account" });
    expect(noConsumer.ok).toBe(false);
    await createContract(dir, { name: "C1", targetObject: "Account", consumer: "WebForms" });
    const bad = await addContractField(dir, { ref: "C1", apiName: "Name", operations: ["DELETE"] });
    expect(bad.ok).toBe(false);
  });
});

describe("note tools", () => {
  it("creates, appends, reads and lists notes", async () => {
    const created = await createNote(dir, { title: "Workshop", body: "# Kickoff\n\nDecided: middleware owns orchestration." });
    expect(created.ok).toBe(true);
    const appended = await appendNote(dir, { ref: "Workshop", body: "Follow-up: retry policy added." });
    expect(appended.ok).toBe(true);
    const got = await getNote(dir, { ref: "Workshop" });
    expect(got.ok).toBe(true);
    expect((got.data as { note: { body: string } }).note.body).toMatch(/Kickoff[\s\S]*Follow-up/);
    const listed = await listNotes(dir);
    expect((listed.data as { notes: unknown[] }).notes.length).toBe(1);
  });

  it("rejects empty bodies", async () => {
    expect((await createNote(dir, { title: "X", body: "   " })).ok).toBe(false);
  });
});
