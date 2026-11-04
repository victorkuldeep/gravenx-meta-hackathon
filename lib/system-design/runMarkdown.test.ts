import { describe, expect, it } from "vitest";
import { renderRunMarkdown } from "./runMarkdown";

const hop = (over: Record<string, unknown> = {}) => ({
  label: "Call · GET Get order (Salesforce)",
  status: "ok" as const,
  durationMs: 120,
  endpoint: "https://api.example.com/order",
  requestBody: "",
  responseBody: '{"id":"00000238"}',
  note: "",
  ...over,
});

describe("run markdown", () => {
  it("renders lanes, verdict, and fenced bodies", () => {
    const md = renderRunMarkdown({
      title: "Chain run",
      projectName: "TMF",
      environmentName: "Sandbox",
      startedAt: 0,
      seedBody: "{}",
      lanes: [
        { path: ["Salesforce", "Middleware"], hops: [hop()], stopped: null },
        { path: ["Salesforce", "Middleware"], hops: [hop({ status: "failed", note: "stopped" })], stopped: "Hop cap" },
      ],
    });
    expect(md).toContain("# Chain run");
    expect(md).toContain("Verdict: FAIL (1/2 steps ok, 240ms)");
    expect(md).toContain("## Lane 1: Salesforce → Middleware");
    expect(md).toContain("```json");
    expect(md).toContain('"id":"00000238"');
    expect(md).toContain("Stopped: Hop cap");
  });

  it("marks empty bodies and skipped lanes", () => {
    const md = renderRunMarkdown({
      title: "t", projectName: "p", environmentName: "e", startedAt: 0, seedBody: "",
      lanes: [{ path: ["A"], hops: [], stopped: null }],
    });
    expect(md).toContain("_empty_");
    expect(md).toContain("_No hops executed._");
  });
});
