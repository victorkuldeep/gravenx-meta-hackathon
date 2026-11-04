import { describe, expect, it } from "vitest";
import { validateProject } from "@/lib/system-design/model";
import {
  buildSystemProject,
  guessSystemType,
  parseTopology,
} from "./toSystemDraft";

const box = (id: string, x: number) => ({
  id,
  type: "rectangle",
  x,
  y: 100,
  width: 200,
  height: 120,
  isDeleted: false,
});

const text = (id: string, x: number, y: number, originalText: string, containerId?: string) => ({
  id,
  type: "text",
  x,
  y,
  width: 120,
  height: 30,
  originalText,
  text: originalText,
  isDeleted: false,
  ...(containerId ? { containerId } : {}),
});

const arrow = (id: string, from: string, to: string, points?: number[][]) => ({
  id,
  type: "arrow",
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  isDeleted: false,
  startBinding: { elementId: from },
  endBinding: { elementId: to },
  ...(points ? { points } : {}),
});

describe("topology parser", () => {
  it("turns labeled boxes and a bound arrow into systems + connection", () => {
    const draft = parseTopology([
      box("a", 0),
      text("t1", 10, 110, "Salesforce", "a"),
      box("b", 400),
      text("t2", 410, 110, "Middleware :8080", "b"),
      arrow("e1", "a", "b"),
      text("t3", 250, 90, "/productOrder", "e1"),
    ]);
    expect(draft.warnings).toEqual([]);
    expect(draft.systems.map((s) => s.name)).toEqual(["Salesforce", "Middleware"]);
    expect(draft.systems.map((s) => s.systemType)).toEqual(["salesforce", "middleware"]);
    expect(draft.systems[1].portHint).toBe("8080");
    expect(draft.connections).toHaveLength(1);
    expect(draft.connections[0].label).toBe("/productOrder");
  });

  it("falls back to geometry without bindings and skips dangling arrows", () => {
    const draft = parseTopology([
      box("a", 0),
      text("t1", 10, 110, "Kafka"),
      box("b", 380),
      text("t2", 390, 110, "Snowflake"),
      {
        id: "e1",
        type: "arrow",
        x: 195,
        y: 160,
        width: 0,
        height: 0,
        isDeleted: false,
        startBinding: null,
        endBinding: null,
        points: [
          [0, 0],
          [195, 0],
        ],
      },
      { id: "e2", type: "arrow", x: 900, y: 900, width: 10, height: 10, isDeleted: false },
    ]);
    expect(draft.systems.map((s) => s.systemType)).toEqual(["streaming", "warehouse"]);
    expect(draft.connections).toHaveLength(1);
    expect(draft.warnings.some((w) => w.includes("Arrow 2"))).toBe(true);
  });

  it("names unlabeled boxes and ignores deleted elements", () => {
    const draft = parseTopology([
      box("a", 0),
      { id: "ghost", type: "rectangle", x: 900, y: 900, width: 50, height: 50, isDeleted: true },
    ]);
    expect(draft.systems).toHaveLength(1);
    expect(draft.systems[0].name).toBe("Untitled-1");
    expect(draft.warnings.some((w) => w.includes("no label"))).toBe(true);
  });

  it("reports an empty board", () => {
    expect(parseTopology([]).warnings).toHaveLength(1);
    expect(parseTopology("nope").warnings).toHaveLength(1);
  });

  it("builds a project that passes real validation", () => {
    const draft = parseTopology([
      box("a", 0),
      text("t1", 10, 110, "Salesforce", "a"),
      box("b", 400),
      text("t2", 410, 110, "ServiceNow", "b"),
      arrow("e1", "a", "b"),
    ]);
    const project = buildSystemProject(draft, {
      included: ["box-0"],
      names: { "box-0": "Prod Org" },
      projectName: "Board import",
    });
    expect(project.name).toBe("Board import");
    expect(project.systems.map((s) => s.name)).toEqual(["Prod Org"]);
    expect(project.connections).toEqual([]);
    const { project: valid, issues } = validateProject(project);
    expect(issues).toEqual([]);
    expect(valid?.systems).toHaveLength(1);
  });

  it("guesses common system types", () => {
    expect(guessSystemType("Okta SSO")).toBe("identity");
    expect(guessSystemType("Billing svc")).toBe("billing");
    expect(guessSystemType("mystery box")).toBe("custom");
  });
});
