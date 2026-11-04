/**
 * Minimal Bayeux (CometD) long-polling client for Salesforce streaming:
 * handshake -> subscribe (+replay) -> connect loop -> disconnect.
 * Hand-rolled on fetch (no dependency): long-polling only, one transport,
 * advice-driven reconnect with resubscribe. The UI owns lifecycle; the
 * transport is injected so tests run without a network.
 */

export interface BayeuxMessage {
  channel: string;
  clientId?: string;
  version?: string;
  minimumVersion?: string;
  supportedConnectionTypes?: string[];
  connectionType?: string;
  advice?: { timeout?: number; interval?: number; reconnect?: string };
  successful?: boolean;
  subscription?: string;
  error?: string;
  data?: unknown;
  event?: { replayId?: number };
  ext?: { replay?: Record<string, number> };
  id?: string | number;
  [key: string]: unknown;
}

/** -1 = new events only, -2 = stored in window, else an explicit replay id. */
export type ReplayPosition = number;

export interface ChannelSub {
  channel: string;
  replay: ReplayPosition;
}

export type BayeuxStatus =
  | { state: "connecting" }
  | { state: "connected"; clientId: string }
  | { state: "reconnecting"; attempt: number; message: string }
  | { state: "disconnected" }
  | { state: "failed"; message: string };

export type BayeuxPost = (messages: BayeuxMessage[], signal?: AbortSignal) => Promise<BayeuxMessage[]>;

export function handshakeMessages(): BayeuxMessage[] {
  return [
    {
      channel: "/meta/handshake",
      version: "1.0",
      minimumVersion: "1.0",
      supportedConnectionTypes: ["long-polling"],
      advice: { timeout: 60000, interval: 0 },
    },
  ];
}

export function connectMessage(clientId: string): BayeuxMessage {
  return { channel: "/meta/connect", clientId, connectionType: "long-polling" };
}

export function subscribeMessage(clientId: string, sub: ChannelSub): BayeuxMessage {
  return {
    channel: "/meta/subscribe",
    clientId,
    subscription: sub.channel,
    ext: { replay: { [sub.channel]: sub.replay } },
  };
}

export function unsubscribeMessage(clientId: string, channel: string): BayeuxMessage {
  return { channel: "/meta/unsubscribe", clientId, subscription: channel };
}

export function disconnectMessage(clientId: string): BayeuxMessage {
  return { channel: "/meta/disconnect", clientId };
}

export function parseHandshake(messages: BayeuxMessage[]): { clientId: string } | { error: string } {
  const reply = messages.find((m) => m.channel === "/meta/handshake");
  if (!reply) return { error: "No handshake reply" };
  if (reply.successful !== true) {
    const detail = typeof reply.error === "string" && reply.error ? `: ${reply.error}` : "";
    return { error: `Handshake refused${detail}` };
  }
  if (typeof reply.clientId !== "string" || !reply.clientId) return { error: "Handshake reply has no clientId" };
  return { clientId: reply.clientId };
}

/** True when the message carries an event payload for a subscribed channel. */
export function isEventDelivery(msg: BayeuxMessage): boolean {
  return (
    typeof msg.channel === "string" &&
    !msg.channel.startsWith("/meta/") &&
    Object.prototype.hasOwnProperty.call(msg, "data")
  );
}

export function extractReplayId(msg: BayeuxMessage): number | null {
  const id = msg.event?.replayId;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
}

/** True when the server no longer knows the session - safe to re-handshake. */
export function isUnknownClient(err: unknown): boolean {
  return err instanceof Error && /unknown client/i.test(err.message);
}

/** Channel path builders + loose validation (custom paths pass through). */
export const platformEventChannel = (apiName: string): string => `/event/${apiName.trim()}`;
export const changeEventChannel = (apiName: string): string => `/data/${apiName.trim()}ChangeEvent`;
export const topicChannel = (name: string): string => `/topic/${name.trim()}`;

export function isChannelPath(text: string): boolean {
  const t = text.trim();
  return t.startsWith("/") && !/\s/.test(t) && t.length > 1;
}

let subSeq = 0;

/**
 * One streaming session: handshake, subscribe all channels, then a connect
 * loop until stop(). A failed connect re-handshakes and resubscribes every
 * channel from its last seen replay id (no gaps, minimal dupes).
 */
export class BayeuxClient {
  private clientId: string | null = null;
  private stopped = true;
  private lastReplay = new Map<string, number>();
  private attempt = 0;
  private subs: ChannelSub[] = [];
  /** Serializes handshake / resubscribe / add work so a hung long-poll that
   *  goes Unknown-client at the same moment as an add-click cannot fork the
   *  session into two half-established clientIds. */
  private op: Promise<void> = Promise.resolve();

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.op.then(fn, fn);
    // Keep the chain alive for the next caller even if this one rejects.
    this.op = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /** Abort handle for the in-flight connect poll, if any. */
  private connectAbort: AbortController | null = null;
  /** Set when the abort came from our own re-handshake (not a real failure). */
  private abortArmed = false;

  /** Wake the delivery loop off a stale session so it re-polls the fresh one now. */
  private abortConnect(): void {
    this.abortArmed = true;
    try {
      this.connectAbort?.abort();
    } catch {
      /* best-effort wake-up */
    }
  }

  constructor(
    private post: BayeuxPost,
    private onEvent: (channel: string, data: unknown, replayId: number | null) => void,
    private onStatus: (s: BayeuxStatus) => void
  ) {}

  get running(): boolean {
    return !this.stopped;
  }

  /**
   * True when the handshake + subscriptions landed and the connect loop is
   * running. False when establish failed (status already reports it) - the
   * caller must not record the subscription in that case.
   */
  async start(subs: ChannelSub[]): Promise<boolean> {
    if (!this.stopped) return true;
    if (subs.length === 0) throw new Error("Subscribe to at least one channel");
    this.stopped = false;
    this.attempt = 0;
    this.subs = [...subs];
    try {
      await this.establish();
    } catch (err) {
      this.stopped = true;
      this.onStatus({ state: "failed", message: err instanceof Error ? err.message : "Connect failed" });
      return false;
    }
    void this.loop();
    return true;
  }

  private async subscribeOnce(channel: string, replay: number): Promise<void> {
    const attempt = async (id: string): Promise<void> => {
      const replies = await this.post([subscribeMessage(id, { channel, replay })]);
      const reply = replies.find((m) => m.channel === "/meta/subscribe");
      if (reply && reply.successful === false) {
        const detail = typeof reply.error === "string" && reply.error ? `: ${reply.error}` : "";
        throw new Error(`Subscribe refused for ${channel}${detail}`);
      }
    };
    const id = this.clientId;
    if (!id) throw new Error("Not connected");
    try {
      await attempt(id);
    } catch (err) {
      // A fresh session can be momentarily unknown upstream (affinity /
      // replication lag): one delayed retry on the SAME session before
      // escalating to a full re-handshake.
      if (this.stopped || !isUnknownClient(err)) throw err;
      await new Promise((r) => setTimeout(r, 1500));
      const retryId = this.clientId;
      if (this.stopped || !retryId) throw err;
      await attempt(retryId);
    }
  }

  /**
   * Subscribe more channels on the live connection (no re-handshake) - with
   * self-heal: if the server forgot the session mid-life (expiry/race,
   * "Unknown client") while a long-poll hung elsewhere, queue behind any
   * in-flight reconnect, claim the new channel first so the re-handshake
   * covers it, and retry once instead of failing the click.
   */
  async addChannels(subs: ChannelSub[]): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped || !this.clientId) throw new Error("Not connected");
      for (const sub of subs) {
        if (this.subs.some((s) => s.channel === sub.channel)) continue;
        const replay = this.lastReplay.get(sub.channel) ?? sub.replay;
        try {
          await this.subscribeOnce(sub.channel, replay);
        } catch (err) {
          if (this.stopped || !isUnknownClient(err)) throw err;
          // Claim it before the re-handshake so establish() resubscribes
          // everything (old + new) on the single fresh session.
          this.subs.push(sub);
          this.clientId = null;
          try {
            await this.establish();
          } catch (e) {
            // Roll back the claim so a retry starts clean.
            this.subs = this.subs.filter((s) => s.channel !== sub.channel);
            throw e;
          }
          if (this.stopped) throw new Error("Not connected");
          // Wake the delivery loop off the stale long-poll so it re-polls
          // the fresh session immediately instead of hanging out the old one.
          this.abortConnect();
          return;
        }
        this.subs.push(sub);
      }
    });
  }

  /** Drop one channel; the connection stays up for the rest. */
  async removeChannel(channel: string): Promise<void> {
    this.subs = this.subs.filter((s) => s.channel !== channel);
    if (this.stopped || !this.clientId) return;
    try {
      await this.post([unsubscribeMessage(this.clientId, channel)]);
    } catch {
      /* goodbye is best-effort */
    }
  }

  get channels(): string[] {
    return this.subs.map((s) => s.channel);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const id = this.clientId;
    this.clientId = null;
    this.abortArmed = false;
    try {
      this.connectAbort?.abort();
    } catch {
      /* best-effort wake-up */
    }
    this.onStatus({ state: "disconnected" });
    if (id) {
      void this.post([disconnectMessage(id)]).catch(() => {
        /* goodbye is best-effort */
      });
    }
  }

  private async establish(cleanRetry = true): Promise<void> {
    const hs = await this.post(handshakeMessages());
    const parsed = parseHandshake(hs);
    if ("error" in parsed) throw new Error(parsed.error);
    this.clientId = parsed.clientId;
    // One batched subscribe for every channel: fewer round trips means a
    // smaller window where a publish can slip past replay -1 listeners.
    const sendBatch = (): Promise<BayeuxMessage[]> =>
      this.post(
        this.subs.map((sub) =>
          subscribeMessage(parsed.clientId, {
            channel: sub.channel,
            replay: this.lastReplay.get(sub.channel) ?? sub.replay,
          })
        )
      );
    let replies = await sendBatch();
    let refused = replies.filter((m) => m.channel === "/meta/subscribe" && m.successful === false);
    const unknownRefusal = (): boolean =>
      refused.some((m) => typeof m.error === "string" && /unknown client/i.test(m.error));
    if (refused.length > 0 && unknownRefusal() && !this.stopped) {
      // Same-session delayed retry first: a fresh handshake can be
      // momentarily unknown upstream, and re-handshaking immediately can
      // 403 the exact same way.
      await new Promise((r) => setTimeout(r, 1500));
      if (!this.stopped && this.clientId) {
        replies = await sendBatch();
        refused = replies.filter((m) => m.channel === "/meta/subscribe" && m.successful === false);
      }
    }
    if (refused.length > 0) {
      const unknown = refused.some((m) => typeof m.error === "string" && /unknown client/i.test(m.error));
      if (unknown && cleanRetry && !this.stopped) {
        // Fresh handshake, stale view somewhere upstream (typical right
        // after Reset) - one clean retry before surfacing the failure.
        this.clientId = null;
        return this.establish(false);
      }
      const first = refused[0];
      const ch = typeof first.subscription === "string" ? first.subscription : (this.subs[0]?.channel ?? "?");
      const detail = typeof first.error === "string" && first.error ? `: ${first.error}` : "";
      throw new Error(`Subscribe refused for ${ch}${detail}`);
    }
    this.onStatus({ state: "connected", clientId: parsed.clientId });
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const id = this.clientId;
      if (!id) {
        // A re-handshake is in flight (add-click or backoff) - wait for the
        // fresh session instead of exiting the only delivery loop.
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      const pollCtrl = new AbortController();
      this.connectAbort = pollCtrl;
      // Any pending wake-up is satisfied by this fresh poll.
      this.abortArmed = false;
      let replies: BayeuxMessage[];
      try {
        replies = await this.post([connectMessage(id)], pollCtrl.signal);
      } catch (err) {
        if (this.connectAbort === pollCtrl) this.connectAbort = null;
        if (this.stopped) return;
        if (this.abortArmed) {
          // Woken by our own re-handshake - the fresh session is ready.
          this.abortArmed = false;
          continue;
        }
        await this.backoff(err, id);
        continue;
      }
      if (this.connectAbort === pollCtrl) this.connectAbort = null;
      for (const m of replies) {
        if (this.stopped) return;
        if (m.channel === "/meta/connect" && m.successful === false) {
          await this.backoff(
            new Error(typeof m.error === "string" && m.error ? m.error : "Connect refused"),
            id
          );
          break;
        }
        if (isEventDelivery(m)) {
          const replayId = extractReplayId(m);
          if (replayId !== null) this.lastReplay.set(m.channel, replayId);
          this.onEvent(m.channel, m.data, replayId);
        }
      }
    }
  }

  private async backoff(err: unknown, failedId?: string | null): Promise<void> {
    this.attempt += 1;
    this.onStatus({
      state: "reconnecting",
      attempt: this.attempt,
      message: err instanceof Error ? err.message : "Connection lost",
    });
    await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (this.attempt - 1), 15000)));
    if (this.stopped) return;
    try {
      await this.enqueue(async () => {
        if (this.stopped) return;
        // An addChannels self-heal may have already re-established while
        // this backoff was sleeping - only skip when a DIFFERENT live
        // session exists. A stale or null id still needs re-establishing.
        if (failedId !== undefined && this.clientId !== null && this.clientId !== failedId) return;
        this.clientId = null;
        await this.establish();
      });
      this.attempt = 0;
    } catch (e) {
      await this.backoff(e);
    }
  }
}

export function nextSubId(): string {
  subSeq += 1;
  return `sub-${subSeq}`;
}
