"use client";

import {
  BRIDGE_PROTOCOL_V,
  isWriteCommand,
  type BridgeCall,
  type BridgeHello,
  type BridgeResult,
  type BridgeWelcome,
} from "./protocol";
import { hasBridgeHandler, runBridgeHandler } from "./registry";
import { getBridgeSettings } from "./settings";
import { surfaceForCommand, surfaceLabel } from "./surfaces";

/**
 * Tab-side inbox: dials the localhost bridge, pairs with the session code,
 * and dispatches incoming calls to registered handlers. Reads run free;
 * writes pause for the architect's decision via onApproval (the dock's
 * ConfirmDialog) - approve runs the handler, deny resolves denied:true.
 * Everything is audit-logged by the dock through onEvent.
 */

export interface InboxEvents {
  onStatus: (status: "connecting" | "live" | "error", error?: string) => void;
  onApproval: (call: BridgeCall, approve: (ok: boolean) => void) => void;
  onEvent: (kind: string, ok: boolean, detail: string) => void;
  /** Navigate the studio (Next router) so the owning tab can register. Optional - without it, unknown commands fail closed. */
  onNavigatePath?: (path: string) => void;
}

export interface SocketLike {
  send: (text: string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onmessage: ((text: string) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

const defaultFactory: SocketFactory = (url: string) => {
  const ws = new WebSocket(url);
  const socket: SocketLike = {
    send: (text: string) => ws.send(text),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.onopen = () => socket.onopen?.();
  ws.onmessage = (ev: MessageEvent) => socket.onmessage?.(String(ev.data));
  ws.onclose = () => socket.onclose?.();
  ws.onerror = () => socket.onerror?.();
  return socket;
};

export class BridgeInbox {
  private socket: SocketLike | null = null;
  private session = "";
  private closed = false;
  private approvalWaiters = new Map<string, (ok: boolean) => void>();

  constructor(
    private readonly events: InboxEvents,
    private readonly factory: SocketFactory = defaultFactory,
  ) {}

  connect(port: number, code: string, tab: string): void {
    this.close();
    this.closed = false;
    this.events.onStatus("connecting");
    const url = `ws://127.0.0.1:${port}`;
    let socket: SocketLike;
    try {
      socket = this.factory(url);
    } catch (e) {
      this.events.onStatus("error", e instanceof Error ? e.message : "Could not open bridge socket.");
      return;
    }
    this.socket = socket;
    let welcomed = false;
    socket.onmessage = (text: string) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!welcomed) {
        const welcome = msg as unknown as BridgeWelcome;
        if (welcome.type === "welcome" && welcome.v === BRIDGE_PROTOCOL_V && typeof welcome.session === "string") {
          welcomed = true;
          this.session = welcome.session;
          this.events.onStatus("live");
          this.events.onEvent("bridge.paired", true, `Paired with local bridge as ${tab}.`);
        } else {
          this.events.onStatus("error", "Bridge rejected pairing (version or code).");
          this.close();
        }
        return;
      }
      const call = msg as unknown as BridgeCall;
      if (call.type !== "call" || call.v !== BRIDGE_PROTOCOL_V || typeof call.id !== "string") return;
      void this.dispatch(call);
    };
    const fail = () => {
      if (!welcomed && !this.closed) {
        this.events.onStatus("error", `No bridge on 127.0.0.1:${port} - is the MCP server running?`);
        this.events.onEvent("bridge.connect", false, `No bridge on 127.0.0.1:${port}.`);
      } else if (welcomed) {
        this.events.onStatus("error", "Bridge connection lost.");
        this.events.onEvent("bridge.disconnect", false, "Bridge connection lost.");
      }
      this.socket = null;
    };
    socket.onclose = fail;
    socket.onerror = fail;
    const hello: BridgeHello = { v: BRIDGE_PROTOCOL_V, type: "hello", code, tab };
    // Send on open (never pre-open): mirrors the proven manual handshake and
    // avoids any queueing edge in wrappers around the native socket.
    socket.onopen = () => {
      try {
        socket.send(JSON.stringify(hello));
      } catch {
        /* send hookup varies by factory - failure surfaces via onclose */
      }
    };
  }

  private async dispatch(call: BridgeCall): Promise<void> {
    const label = `${call.command}`;
    if (!hasBridgeHandler(call.command)) {
      // The owning tab is not mounted - navigate there and wait for it to
      // register instead of failing closed. Unknown commands still fail.
      if (!(await this.ensureSurface(call))) {
        this.events.onEvent(label, false, `Unknown command ${call.command} - fail closed.`);
        this.reply(call.id, { ok: false, error: `Unknown bridge command: ${call.command}` });
        return;
      }
    }
    if (!isWriteCommand(call.command)) {
      try {
        const data = await runBridgeHandler(call.command, call.args);
        this.events.onEvent(label, true, "Read ok.");
        this.reply(call.id, { ok: true, data });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Handler failed.";
        this.events.onEvent(label, false, message);
        this.reply(call.id, { ok: false, error: message });
      }
      return;
    }
    if (getBridgeSettings().autoApprove) {
      // Auto mode: pairing authorized the session - run without a modal.
      // Still fully audited through onEvent like an approval.
      try {
        const data = await runBridgeHandler(call.command, call.args);
        this.events.onEvent(label, true, "Auto-approved (bridge auto mode) and executed.");
        this.reply(call.id, { ok: true, data });
      } catch (e) {
        const detail = e instanceof Error ? e.message : "Bridge call failed.";
        this.events.onEvent(label, false, detail);
        this.reply(call.id, { ok: false, error: detail });
      }
      return;
    }
    // Writes: architect decides in the tab. The agent waits for the verdict.
    this.events.onEvent(label, true, "Waiting on architect approval in the studio tab.");
    this.approvalWaiters.set(call.id, (approved: boolean) => {
      this.approvalWaiters.delete(call.id);
      if (!approved) {
        this.events.onEvent(label, false, "Denied by the architect.");
        this.reply(call.id, { ok: false, denied: true, error: "Denied by the architect in the studio tab." });
        return;
      }
      void (async () => {
        try {
          const data = await runBridgeHandler(call.command, call.args);
          this.events.onEvent(label, true, "Approved and executed.");
          this.reply(call.id, { ok: true, data });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Handler failed.";
          this.events.onEvent(label, false, message);
          this.reply(call.id, { ok: false, error: message });
        }
      })();
    });
    this.events.onApproval(call, (ok: boolean) => this.approvalWaiters.get(call.id)?.(ok));
  }

  approve(id: string, ok: boolean): void {
    this.approvalWaiters.get(id)?.(ok);
  }

  /**
   * Open the owning surface for a command whose tab is not mounted, then
   * wait for it to register. Returns true when the handler is ready.
   * Unknown commands (no owning surface) return false - fail closed.
   */
  private async ensureSurface(call: BridgeCall): Promise<boolean> {
    const path = surfaceForCommand(call.command);
    if (!path || !this.events.onNavigatePath) return false;
    this.events.onEvent(
      `${call.command}`,
      true,
      `Opening ${surfaceLabel(path)} for the agent - running there in a moment.`
    );
    try {
      this.events.onNavigatePath(path);
    } catch {
      return false;
    }
    for (let i = 0; i < 48; i++) {
      if (hasBridgeHandler(call.command)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    this.events.onEvent(
      `${call.command}`,
      false,
      `Opened ${surfaceLabel(path)} but it never registered ${call.command} - ask the architect to open it.`
    );
    return false;
  }

  private reply(id: string, partial: Omit<BridgeResult, "v" | "id" | "type">): void {
    const result: BridgeResult = { v: BRIDGE_PROTOCOL_V, id, type: "result", ...partial };
    try {
      this.socket?.send(JSON.stringify(result));
    } catch {
      /* tab is going away - the hub times out agent-side */
    }
  }

  close(): void {
    this.closed = true;
    try {
      this.socket?.close();
    } catch {
      /* ignore */
    }
    this.socket = null;
    for (const [, fn] of this.approvalWaiters) fn(false);
    this.approvalWaiters.clear();
  }
}
