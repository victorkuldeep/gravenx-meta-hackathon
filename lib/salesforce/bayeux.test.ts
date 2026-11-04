import { describe, it, expect, vi } from "vitest";
import {
  handshakeMessages,
  connectMessage,
  subscribeMessage,
  unsubscribeMessage,
  disconnectMessage,
  parseHandshake,
  isEventDelivery,
  extractReplayId,
  isUnknownClient,
  platformEventChannel,
  changeEventChannel,
  topicChannel,
  isChannelPath,
  BayeuxClient,
  type BayeuxMessage,
} from "./bayeux";

const hsOk = (id: string): BayeuxMessage[] => [
  { channel: "/meta/handshake", successful: true, clientId: id, advice: { reconnect: "retry" } },
];
const subOk = (channel: string): BayeuxMessage[] => [
  { channel: "/meta/subscribe", successful: true, subscription: channel },
];

describe("bayeux message builders", () => {
  it("handshakes with long-polling only", () => {
    const [m] = handshakeMessages();
    expect(m.channel).toBe("/meta/handshake");
    expect(m.supportedConnectionTypes).toEqual(["long-polling"]);
  });

  it("frames the replay extension on subscribe", () => {
    expect(subscribeMessage("c1", { channel: "/event/Foo__e", replay: -1 })).toEqual({
      channel: "/meta/subscribe",
      clientId: "c1",
      subscription: "/event/Foo__e",
      ext: { replay: { "/event/Foo__e": -1 } },
    });
  });

  it("builds connect/unsubscribe/disconnect", () => {
    expect(connectMessage("c1").channel).toBe("/meta/connect");
    expect(unsubscribeMessage("c1", "/event/Foo__e").subscription).toBe("/event/Foo__e");
    expect(disconnectMessage("c1").clientId).toBe("c1");
  });

  it("parses handshake replies", () => {
    expect(parseHandshake(hsOk("abc"))).toEqual({ clientId: "abc" });
    expect(parseHandshake([{ channel: "/meta/handshake", successful: false, error: "403" }])).toEqual({
      error: "Handshake refused: 403",
    });
    expect(parseHandshake([])).toEqual({ error: "No handshake reply" });
  });

  it("detects event deliveries and replay ids", () => {
    expect(isEventDelivery({ channel: "/event/Foo__e", data: { a: 1 } })).toBe(true);
    expect(isEventDelivery({ channel: "/meta/connect", successful: true })).toBe(false);
    expect(extractReplayId({ channel: "/event/Foo__e", data: {}, event: { replayId: 42 } })).toBe(42);
    expect(extractReplayId({ channel: "/event/Foo__e", data: {} })).toBeNull();
  });

  it("builds channel paths", () => {
    expect(platformEventChannel("Foo__e")).toBe("/event/Foo__e");
    expect(changeEventChannel("Account")).toBe("/data/AccountChangeEvent");
    expect(topicChannel("MyTopic")).toBe("/topic/MyTopic");
    expect(isChannelPath("/event/Foo__e")).toBe(true);
    expect(isChannelPath("nope")).toBe(false);
  });
});

describe("BayeuxClient", () => {
  it("handshakes, subscribes, and streams events until stopped", async () => {
    const events: { channel: string; replayId: number | null }[] = [];
    const statuses: string[] = [];
    let connects = 0;
    const post = vi.fn(async (msgs: BayeuxMessage[]): Promise<BayeuxMessage[]> => {
      const [m] = msgs;
      if (m.channel === "/meta/handshake") return hsOk("c9");
      if (m.channel === "/meta/subscribe") return subOk(m.subscription as string);
      if (m.channel === "/meta/connect") {
        connects += 1;
        if (connects === 1) {
          return [
            { channel: "/meta/connect", successful: true },
            { channel: "/event/Foo__e", data: { n: 1 }, event: { replayId: 7 } },
          ];
        }
        // Park further connects until stop() flips the flag.
        await new Promise((r) => setTimeout(r, 50));
        return [{ channel: "/meta/connect", successful: true }];
      }
      return [];
    });
    const client = new BayeuxClient(
      post,
      (channel, _data, replayId) => events.push({ channel, replayId }),
      (s) => statuses.push(s.state)
    );
    await client.start([{ channel: "/event/Foo__e", replay: -1 }]);
    expect(statuses).toContain("connected");
    // Let the first connect round-trip land.
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toEqual([{ channel: "/event/Foo__e", replayId: 7 }]);
    client.stop();
    expect(statuses).toContain("disconnected");
    // A goodbye disconnect goes out best-effort.
    expect(post.mock.calls.some(([msgs]) => (msgs as BayeuxMessage[])[0].channel === "/meta/disconnect")).toBe(true);
  });

  it("resubscribes from the last seen replay id after a dropped connect", async () => {
    const seenReplays: number[] = [];
    let connects = 0;
    const post = vi.fn(async (msgs: BayeuxMessage[]): Promise<BayeuxMessage[]> => {
      const [m] = msgs;
      if (m.channel === "/meta/handshake") return hsOk("c9");
      if (m.channel === "/meta/subscribe") {
        seenReplays.push((m.ext?.replay as Record<string, number>)["/event/Foo__e"]);
        return subOk("/event/Foo__e");
      }
      connects += 1;
      if (connects === 1) {
        return [
          { channel: "/meta/connect", successful: true },
          { channel: "/event/Foo__e", data: {}, event: { replayId: 9 } },
        ];
      }
      if (connects === 2) throw new Error("socket hang up");
      await new Promise((r) => setTimeout(r, 60));
      return [{ channel: "/meta/connect", successful: true }];
    });
    const statuses: string[] = [];
    const client = new BayeuxClient(
      post,
      () => {},
      (s) => statuses.push(s.state)
    );
    await client.start([{ channel: "/event/Foo__e", replay: -1 }]);
    await new Promise((r) => setTimeout(r, 30));
    expect(statuses).toContain("reconnecting");
    // Speed past the backoff timer.
    await vi.waitFor(() => expect(seenReplays).toEqual([-1, 9]), { timeout: 20000 });
    client.stop();
  });

  it("adds a channel on the live connection without re-handshaking", async () => {
    let handshakes = 0;
    const seen: string[] = [];
    const post = vi.fn(async (msgs: BayeuxMessage[]): Promise<BayeuxMessage[]> => {
      const [m] = msgs;
      if (m.channel === "/meta/handshake") {
        handshakes += 1;
        return hsOk("c9");
      }
      if (m.channel === "/meta/subscribe") {
        seen.push(m.subscription as string);
        return subOk(m.subscription as string);
      }
      await new Promise((r) => setTimeout(r, 50));
      return [{ channel: "/meta/connect", successful: true }];
    });
    const client = new BayeuxClient(post, () => {}, () => {});
    await client.start([{ channel: "/event/A__e", replay: -1 }]);
    await client.addChannels([{ channel: "/event/B__e", replay: -2 }]);
    expect(handshakes).toBe(1);
    expect(seen).toEqual(["/event/A__e", "/event/B__e"]);
    expect(client.channels).toEqual(["/event/A__e", "/event/B__e"]);
    // Duplicate adds are ignored.
    await client.addChannels([{ channel: "/event/A__e", replay: -1 }]);
    expect(seen).toEqual(["/event/A__e", "/event/B__e"]);
    client.stop();
  });

  it("removes a channel with an unsubscribe message and keeps the rest", async () => {
    const unsubscribed: string[] = [];
    const post = vi.fn(async (msgs: BayeuxMessage[]): Promise<BayeuxMessage[]> => {
      const [m] = msgs;
      if (m.channel === "/meta/handshake") return hsOk("c9");
      if (m.channel === "/meta/subscribe") return subOk(m.subscription as string);
      if (m.channel === "/meta/unsubscribe") {
        unsubscribed.push(m.subscription as string);
        return [{ channel: "/meta/unsubscribe", successful: true }];
      }
      await new Promise((r) => setTimeout(r, 50));
      return [{ channel: "/meta/connect", successful: true }];
    });
    const client = new BayeuxClient(post, () => {}, () => {});
    await client.start([
      { channel: "/event/A__e", replay: -1 },
      { channel: "/event/B__e", replay: -1 },
    ]);
    await client.removeChannel("/event/A__e");
    expect(unsubscribed).toEqual(["/event/A__e"]);
    expect(client.channels).toEqual(["/event/B__e"]);
    client.stop();
  });

  it("fails fast on a refused handshake", async () => {
    const statuses: string[] = [];
    const client = new BayeuxClient(
      async () => [{ channel: "/meta/handshake", successful: false, error: "401::auth" }],
      () => {},
      (s) => statuses.push(s.state)
    );
    await client.start([{ channel: "/event/Foo__e", replay: -1 }]);
    expect(statuses).toContain("failed");
    expect(client.running).toBe(false);
  });

  it("reports start success so callers never record dead subs", async () => {
    const okPost = vi.fn(async (msgs: BayeuxMessage[]): Promise<BayeuxMessage[]> => {
      const [m] = msgs;
      if (m.channel === "/meta/handshake") return hsOk("c1");
      if (m.channel === "/meta/subscribe") return subOk(m.subscription as string);
      await new Promise((r) => setTimeout(r, 20));
      return [{ channel: "/meta/connect", successful: true }];
    });
    const okClient = new BayeuxClient(
      okPost,
      () => {},
      () => {}
    );
    expect(await okClient.start([{ channel: "/event/A__e", replay: -1 }])).toBe(true);
    expect(okClient.running).toBe(true);
    okClient.stop();

    const states: string[] = [];
    const badClient = new BayeuxClient(
      async () => [{ channel: "/meta/handshake", successful: false, error: "403" }],
      () => {},
      (s) => states.push(s.state)
    );
    expect(await badClient.start([{ channel: "/event/A__e", replay: -1 }])).toBe(false);
    expect(badClient.running).toBe(false);
    expect(states).toContain("failed");
  });

  it("recovers on the same session when the refusal is just replication lag", async () => {
    let handshakes = 0;
    let batchSends = 0;
    const post = vi.fn(async (msgs: BayeuxMessage[]): Promise<BayeuxMessage[]> => {
      const [m] = msgs;
      if (m.channel === "/meta/handshake") {
        handshakes += 1;
        return hsOk(`c${handshakes}`);
      }
      if (m.channel === "/meta/subscribe") {
        batchSends += 1;
        // First batched send lands before the fresh session replicates.
        if (batchSends === 1) {
          return msgs.map((s) => ({
            channel: "/meta/subscribe",
            successful: false,
            error: "403::Unknown client",
            subscription: (s as BayeuxMessage).subscription,
          }));
        }
        return msgs.flatMap((s) => subOk((s as BayeuxMessage).subscription as string));
      }
      if (m.channel === "/meta/connect") {
        await new Promise((r) => setTimeout(r, 20));
        return [{ channel: "/meta/connect", successful: true }];
      }
      return [];
    });
    const client = new BayeuxClient(
      post,
      () => {},
      () => {}
    );
    expect(
      await client.start([
        { channel: "/event/A__e", replay: -1 },
        { channel: "/event/B__e", replay: -1 },
      ])
    ).toBe(true);
    // No re-handshake needed: the delayed same-session retry lands.
    expect(handshakes).toBe(1);
    expect(batchSends).toBe(2);
    expect(client.channels).toEqual(["/event/A__e", "/event/B__e"]);
    client.stop();
  });

  it("detects unknown-client sessions", () => {
    expect(isUnknownClient(new Error("403::Unknown client"))).toBe(true);
    expect(isUnknownClient(new Error("Subscribe refused for /event/X: 403::Unknown client"))).toBe(true);
    expect(isUnknownClient(new Error("Not connected"))).toBe(false);
    expect(isUnknownClient("nope")).toBe(false);
  });

  it("re-handshakes and retries when the server forgets the session mid-life", async () => {
    let handshakes = 0;
    const subAttempts = new Map<string, number>();
    const post = vi.fn(async (msgs: BayeuxMessage[]): Promise<BayeuxMessage[]> => {
      const [m] = msgs;
      if (m.channel === "/meta/handshake") {
        handshakes += 1;
        return hsOk(`c${handshakes}`);
      }
      if (m.channel === "/meta/subscribe") {
        return msgs.flatMap((s) => {
          const ch = (s as BayeuxMessage).subscription as string;
          subAttempts.set(ch, (subAttempts.get(ch) ?? 0) + 1);
          // The first session is dead: every subscribe on it is refused, so
          // the same-session retry also fails and the client must heal.
          if (ch === "/event/B__e" && handshakes === 1) {
            return [{ channel: "/meta/subscribe", successful: false, error: "403::Unknown client", subscription: ch }];
          }
          return subOk(ch);
        });
      }
      if (m.channel === "/meta/connect") {
        await new Promise((r) => setTimeout(r, 20));
        return [{ channel: "/meta/connect", successful: true }];
      }
      return [];
    });
    const client = new BayeuxClient(
      post,
      () => {},
      () => {}
    );
    expect(await client.start([{ channel: "/event/A__e", replay: -1 }])).toBe(true);
    await client.addChannels([{ channel: "/event/B__e", replay: -1 }]);
    expect(handshakes).toBe(2);
    // Initial attempt + same-session delayed retry (both refused on the dead
    // session) + the healed session's batched resubscribe.
    expect(subAttempts.get("/event/B__e")).toBe(3);
    expect(client.channels).toEqual(["/event/A__e", "/event/B__e"]);
    client.stop();
  });

  it("retries establish once when the fresh handshake is refused as unknown", async () => {
    let handshakes = 0;
    const post = vi.fn(async (msgs: BayeuxMessage[]): Promise<BayeuxMessage[]> => {
      const [m] = msgs;
      if (m.channel === "/meta/handshake") {
        handshakes += 1;
        return hsOk(`c${handshakes}`);
      }
      if (m.channel === "/meta/subscribe") {
        // First session is a stale upstream view: every subscribe refused.
        if (handshakes === 1) {
          return msgs.map((s) => ({
            channel: "/meta/subscribe",
            successful: false,
            error: "403::Unknown client",
            subscription: (s as BayeuxMessage).subscription,
          }));
        }
        return msgs.map((s) => subOk((s as BayeuxMessage).subscription as string)).flat();
      }
      if (m.channel === "/meta/connect") {
        await new Promise((r) => setTimeout(r, 20));
        return [{ channel: "/meta/connect", successful: true }];
      }
      return [];
    });
    const client = new BayeuxClient(
      post,
      () => {},
      () => {}
    );
    expect(
      await client.start([
        { channel: "/event/A__e", replay: -1 },
        { channel: "/event/B__e", replay: -1 },
        { channel: "/event/C__e", replay: -1 },
      ])
    ).toBe(true);
    expect(handshakes).toBe(2);
    expect(client.channels).toEqual(["/event/A__e", "/event/B__e", "/event/C__e"]);
    client.stop();
  });

  it("wakes the delivery loop onto the fresh session after a heal", async () => {
    let handshakes = 0;
    const seen: string[] = [];
    const post = vi.fn(async (msgs: BayeuxMessage[], signal?: AbortSignal): Promise<BayeuxMessage[]> => {
      const [m] = msgs;
      if (m.channel === "/meta/handshake") {
        handshakes += 1;
        return hsOk(`c${handshakes}`);
      }
      if (m.channel === "/meta/subscribe") {
        return msgs.flatMap((s) => {
          const ch = (s as BayeuxMessage).subscription as string;
          // First session is dead: any subscribe on it is refused.
          if (ch === "/event/B__e" && handshakes === 1) {
            return [{ channel: "/meta/subscribe", successful: false, error: "403::Unknown client", subscription: ch }];
          }
          return subOk(ch);
        });
      }
      if (m.channel === "/meta/connect") {
        if (m.clientId === "c1") {
          // Stale long-poll on the dead session: hang until the client
          // aborts us after its re-handshake.
          await new Promise<void>((resolve, reject) => {
            if (signal?.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
          return [{ channel: "/meta/connect", successful: false, error: "403::Unknown client" }];
        }
        // Fresh session delivers the new channel's event right away.
        await new Promise((r) => setTimeout(r, 20));
        return [
          { channel: "/event/B__e", data: { ok: true }, event: { replayId: 7 } },
          { channel: "/meta/connect", successful: true },
        ];
      }
      return [];
    });
    const client = new BayeuxClient(
      post,
      (channel) => {
        seen.push(channel);
      },
      () => {}
    );
    expect(await client.start([{ channel: "/event/A__e", replay: -1 }])).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    await client.addChannels([{ channel: "/event/B__e", replay: -1 }]);
    await new Promise((r) => setTimeout(r, 200));
    expect(handshakes).toBe(2);
    expect(seen).toContain("/event/B__e");
    client.stop();
  });
});
