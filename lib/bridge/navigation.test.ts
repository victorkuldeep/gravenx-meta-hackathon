import { describe, expect, it, vi } from "vitest";
import { BridgeInbox, type SocketLike } from "./inbox";
import { registerBridgeHandler, unregisterBridgeHandler } from "./registry";
import { surfaceForCommand, surfaceLabel } from "./surfaces";

describe("surfaceForCommand", () => {
  it("routes sys.* to System Design and erd.*/arch.activity to Schema", () => {
    expect(surfaceForCommand("sys.new")).toBe("/system");
    expect(surfaceForCommand("sys.snapshot")).toBe("/system");
    expect(surfaceForCommand("erd.snapshot")).toBe("/");
    expect(surfaceForCommand("arch.activity")).toBe("/");
  });

  it("returns null for unknown commands - fail closed", () => {
    expect(surfaceForCommand("bogus.fn")).toBeNull();
    expect(surfaceForCommand("")).toBeNull();
  });

  it("labels surfaces for notices", () => {
    expect(surfaceLabel("/system")).toBe("System Design");
    expect(surfaceLabel("/")).toBe("Schema (ERD)");
  });
});

function fakeSocketHost() {
  const sent: string[] = [];
  let host: SocketLike | null = null;
  const factory = () => {
    const socket: SocketLike = {
      send: (text) => void sent.push(text),
      close: () => {},
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    host = socket;
    return socket;
  };
  return {
    sent,
    factory,
    open: () => host?.onopen?.(),
    receive: (text: string) => host?.onmessage?.(text),
  };
}

const HELLO_OK = { v: 1, type: "welcome" as const, session: "s1" };

describe("bridge cross-tab navigation", () => {
  it("fails closed for unknown commands without navigating", async () => {
    const link = fakeSocketHost();
    const navigated: string[] = [];
    const events: string[] = [];
    const inbox = new BridgeInbox(
      {
        onStatus: () => {},
        onApproval: () => {},
        onEvent: (_k, _ok, d) => void events.push(d),
        onNavigatePath: (p) => void navigated.push(p),
      },
      link.factory
    );
    inbox.connect(49321, "code", "tab");
    link.open();
    link.receive(JSON.stringify(HELLO_OK));
    link.receive(JSON.stringify({ v: 1, id: "c1", type: "call", session: "s1", command: "bogus.fn", args: {} }));
    await new Promise((r) => setTimeout(r, 50));
    expect(navigated).toEqual([]);
    const reply = link.sent.map((s) => JSON.parse(s)).find((m) => m.id === "c1");
    expect(reply.ok).toBe(false);
    expect(String(reply.error)).toContain("Unknown bridge command");
    inbox.close();
  });

  it("navigates to the owning tab and runs once it registers", async () => {
    const link = fakeSocketHost();
    const navigated: string[] = [];
    const inbox = new BridgeInbox(
      {
        onStatus: () => {},
        onApproval: () => {},
        onEvent: () => {},
        onNavigatePath: (p) => {
          void navigated.push(p);
          // Simulate the tab mounting a moment later.
          setTimeout(() => {
            registerBridgeHandler("sys.snapshot", async () => ({ systems: 0 }));
          }, 300);
        },
      },
      link.factory
    );
    inbox.connect(49321, "code", "tab");
    link.open();
    link.receive(JSON.stringify(HELLO_OK));
    // Auto-approve path needs settings; reads run free without it.
    link.receive(JSON.stringify({ v: 1, id: "c2", type: "call", session: "s1", command: "sys.snapshot", args: {} }));
    await new Promise((r) => setTimeout(r, 1200));
    expect(navigated).toEqual(["/system"]);
    const reply = link.sent.map((s) => JSON.parse(s)).find((m) => m.id === "c2");
    expect(reply.ok).toBe(true);
    expect(reply.data).toEqual({ systems: 0 });
    unregisterBridgeHandler("sys.snapshot");
    inbox.close();
  });

  it("errors clearly when the tab never registers", async () => {
    const link = fakeSocketHost();
    const inbox = new BridgeInbox(
      {
        onStatus: () => {},
        onApproval: () => {},
        onEvent: () => {},
        onNavigatePath: () => {},
      },
      link.factory
    );
    inbox.connect(49321, "code", "tab");
    link.open();
    link.receive(JSON.stringify(HELLO_OK));
    link.receive(JSON.stringify({ v: 1, id: "c3", type: "call", session: "s1", command: "sys.place", args: {} }));
    await vi.waitFor(
      () => {
        const reply = link.sent.map((s) => JSON.parse(s)).find((m) => m.id === "c3");
        expect(reply).toBeDefined();
      },
      { timeout: 15000 }
    );
    const reply = link.sent.map((s) => JSON.parse(s)).find((m) => m.id === "c3");
    // sys.place is a write and the handler never appeared: the wait times
    // out and the call fails closed with guidance, never hangs.
    expect(reply.ok).toBe(false);
    inbox.close();
  }, 20000);
});
