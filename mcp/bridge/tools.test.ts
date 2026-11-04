import { describe, expect, it, vi } from "vitest";
import type { BridgeHub } from "./hub";
import { liveTools } from "./tools";

function fakeHub() {
  const call = vi.fn();
  return { call, hub: { call } as unknown as BridgeHub };
}

describe("live bridge MCP tools", () => {
  it("exposes the tab commands with stable names", () => {
    const { hub } = fakeHub();
    const names = liveTools(hub).map((t) => t.name);
    expect(names).toEqual([
      "bridge_status",
      "erd_live_snapshot",
      "erd_live_objects",
      "activity_live_list",
      "system_live_new",
      "system_live_rebalance",
      "system_live_snapshot",
      "system_live_place",
      "system_live_connect",
      "system_live_remove",
      "erd_live_discover",
      "erd_live_place",
      "erd_live_hide",
      "erd_live_remove",
      "erd_live_tags",
      "erd_live_focus",
      "erd_live_mode",
      "erd_live_filter",
      "erd_live_author_field",
      "erd_live_author_object",
    ]);
  });

  it("forwards the protocol command with picked args", async () => {
    const { call, hub } = fakeHub();
    call.mockResolvedValue({ ok: true, data: { focused: "Account" } });
    const tools = liveTools(hub);
    const focus = tools.find((t) => t.name === "erd_live_focus")!;
    const out = await focus.run("", { apiName: "Account" });
    expect(call).toHaveBeenCalledWith("erd.focus", { apiName: "Account" }, expect.any(Number));
    expect(out).toMatchObject({ ok: true, data: { focused: "Account" } });
  });

  it("sends empty args for bridge_status", async () => {
    const { call, hub } = fakeHub();
    call.mockResolvedValue({ ok: true, data: { live: true } });
    const status = liveTools(hub).find((t) => t.name === "bridge_status")!;
    await status.run("", {});
    expect(call).toHaveBeenCalledWith("bridge.ping", {}, expect.any(Number));
  });

  it("maps a tab denial to an actionable failure", async () => {
    const { call, hub } = fakeHub();
    call.mockResolvedValue({ ok: false, denied: true, error: "Nope." });
    const place = liveTools(hub).find((t) => t.name === "erd_live_place")!;
    const out = await place.run("", { apiNames: ["Account"] });
    expect(out.ok).toBe(false);
    expect(out.summary).toMatch(/Denied by the architect/);
  });

  it("maps a hub throw (no tab) to an actionable failure", async () => {
    const { call, hub } = fakeHub();
    call.mockRejectedValue(new Error("No studio tab connected - open GRAVENX, enable Agent bridge in Setup, and pair."));
    const snap = liveTools(hub).find((t) => t.name === "erd_live_snapshot")!;
    const out = await snap.run("", {});
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/No studio tab connected/);
  });
});
