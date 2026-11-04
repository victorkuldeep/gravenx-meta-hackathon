import { describe, expect, it } from "vitest";
import { buildTaskWorkbook } from "./taskExport";
import { consoleTaskKey, newConsoleTask } from "./model";

describe("task export", () => {
  it("lists tasks with keys, labels, and attachment counts", async () => {
    const t = newConsoleTask("Prove the timeout", 1);
    t.kind = "question";
    t.owner = "kul";
    t.priority = "high";
    t.dueDate = "2026-02-01";
    t.body = "Run the scenario.";
    t.links = [{ surface: "system", recordId: "p1", label: "Middleware" }];
    t.notes = [{ id: "n1", at: 2, text: "Waiting on VPN." }];
    const wb = await buildTaskWorkbook([t], { [t.id]: 2 });
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Tasks"]);
    const tasks = wb.getWorksheet("Tasks")!;
    const row = tasks.getRow(2).values as unknown[];
    expect(row[1]).toBe(consoleTaskKey(t));
    expect(row.slice(2, 8)).toEqual(["Prove the timeout", "question", "kul", "Open", "high", "2026-02-01"]);
    expect(row[8]).toBe("Run the scenario.");
    expect(row[9]).toBe("system: Middleware");
    expect(row[11]).toBe("2 files");
  });
});
