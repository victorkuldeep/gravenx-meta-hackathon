import { describe, expect, it } from "vitest";
import {
  buildMockResult,
  defaultMock,
  isMocked,
  statusTextFor,
} from "./mock";
import { validateProject, newProject } from "./model";

describe("mock mode", () => {
  it("derives status text for common codes", () => {
    expect(statusTextFor(200)).toBe("OK");
    expect(statusTextFor(404)).toBe("Not Found");
    expect(statusTextFor(299)).toBe("");
  });

  it("detects mocked operations", () => {
    expect(isMocked(null)).toBe(false);
    expect(isMocked(undefined)).toBe(false);
    expect(isMocked({ id: "o", interfaceId: "i", name: "n", method: "GET", path: "/", version: "v1" })).toBe(false);
    expect(
      isMocked({
        id: "o", interfaceId: "i", name: "n", method: "GET", path: "/", version: "v1",
        mock: defaultMock(),
      })
    ).toBe(true);
  });

  it("builds canned results with clamped latency", () => {
    const r = buildMockResult({ status: 201, body: '{"ok":true}', latencyMs: 1200 });
    expect(r).toMatchObject({ status: 201, statusText: "Created", durationMs: 1200, bodyPreview: '{"ok":true}' });
    expect(buildMockResult({ status: 200, body: "", latencyMs: 99999 }).durationMs).toBe(30000);
    expect(buildMockResult({ status: 200, body: "", latencyMs: -5 }).durationMs).toBe(0);
  });

  it("validates mock shapes on import", () => {
    const p = newProject("m");
    const bad = {
      ...p,
      interfaces: [{ id: "if", systemId: "nope", name: "i" }],
      operations: [
        { id: "op1", interfaceId: "if", name: "n", method: "GET", path: "/", version: "v1", mock: { status: 99, body: "", latencyMs: 0 } },
      ],
    };
    const v = validateProject(bad);
    expect(v.issues.some((i) => i.path === "$.operations[0].mock.status")).toBe(true);
    const good = {
      ...p,
      operations: [
        { id: "op1", interfaceId: "if", name: "n", method: "GET", path: "/", version: "v1", mock: defaultMock() },
      ],
    };
    const v2 = validateProject(good);
    expect(v2.issues.filter((i) => i.path.startsWith("$.operations[0].mock")).length).toBe(0);
  });
});
