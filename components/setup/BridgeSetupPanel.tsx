"use client";

import { useEffect, useRef, useState } from "react";
import { BRIDGE_READS, BRIDGE_WRITES, describeCommand } from "@/lib/bridge/protocol";
import { setBridgeSettings, useBridgeSettings } from "@/lib/bridge/settings";

function Card({ title, hint, right, children }: { title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="arch-card overflow-hidden">
      <div className="arch-card__head flex items-center gap-2 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ivory-950">{title}</p>
          {hint ? <p className="mt-0.5 text-[11px] text-ivory-600">{hint}</p> : null}
        </div>
        {right}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  off: "Off",
  connecting: "Pairing…",
  live: "Live",
  error: "Error",
};

const STATUS_DOT: Record<string, string> = {
  off: "bg-ivory-400",
  connecting: "bg-amber-400 animate-pulse",
  live: "bg-emerald-500",
  error: "bg-red-500",
};

/**
 * Setup > Terminal Bridge: own the tab side of the localhost agent bridge.
 * The terminal agent (via gravenx-mcp stdio) gets file-workspace tools plus
 * nine live ERD commands; reads run free, every write pauses for the
 * architect's in-tab approval. Tokens never leave this tab.
 */
export function BridgeSetupPanel({ linkCode, linkPort }: { linkCode?: string; linkPort?: string }) {
  const settings = useBridgeSettings();
  const [codeDraft, setCodeDraft] = useState(linkCode ?? settings.code);
  const [portDraft, setPortDraft] = useState(linkPort ?? String(settings.port));
  const [discoverMsg, setDiscoverMsg] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const linkDialed = useRef(false);

  const codeReady = codeDraft.trim().length > 0;
  const savePairing = (code?: string, port?: string) => {
    const c = (code ?? codeDraft).trim();
    if (!c) return;
    const p = Number(port ?? portDraft);
    // Saving a pairing implies intent to connect: switch on, clear the last
    // error, and bump the attempt so the dial fires even when the code did
    // not change - every click visibly dials (Pairing... -> Live/error).
    setBridgeSettings({
      enabled: true,
      code: c,
      port: Number.isFinite(p) && p > 0 && p < 65536 ? p : settings.port,
      status: "connecting",
      error: null,
      attempt: Date.now(),
    });
  };

  // Deep-link pairing (?bridge=CODE&port=PORT): opening the link is the
  // explicit consent gesture, so dial once automatically.
  useEffect(() => {
    if (!linkCode || linkDialed.current) return;
    linkDialed.current = true;
    setCodeDraft(linkCode);
    if (linkPort) setPortDraft(linkPort);
    setDiscoverMsg("Pairing from the agent link - dialing the local hub…");
    savePairing(linkCode, linkPort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkCode]);

  // Same-machine discovery: the hub writes a beacon file on listen; the
  // /api/bridge/local route reads it. Prefills only - Pair stays manual.
  const discoverLocalHub = async () => {
    setDiscovering(true);
    setDiscoverMsg(null);
    try {
      const res = await fetch("/api/bridge/local", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; port?: number; code?: string; ageMs?: number; error?: string };
      if (!res.ok || !data.ok || !data.code) {
        setDiscoverMsg(data.error ?? "No local hub found - start the MCP server on this machine first.");
        return;
      }
      setCodeDraft(data.code);
      if (data.port) setPortDraft(String(data.port));
      const ageMin = Math.round((data.ageMs ?? 0) / 60000);
      setDiscoverMsg(
        ageMin > 30
          ? `Found a hub started ~${ageMin}m ago - the code may be stale. Press Save pairing; on error, restart the MCP server for a fresh code.`
          : "Found the local hub - code filled in. Press Save pairing to connect."
      );
    } catch {
      setDiscoverMsg("Discovery failed - enter the pairing code manually.");
    } finally {
      setDiscovering(false);
    }
  };

  const snippet = `{
  "mcpServers": {
    "gravenx": {
      "command": "node",
      "args": ["<DIST_DIR>/gravenx-mcp.cjs"],
      "env": {
        "GRAVENX_WORKSPACE": "<WORKSPACE_DIR>",
        "GRAVENX_BRIDGE_PORT": "${settings.port}"
      }
    }
  }
}`;

  return (
    <div className="space-y-3">
      <Card
        title="Terminal bridge"
        hint="Let a paired terminal agent (Cursor, Claude Code, Codex, opencode via gravenx-mcp) drive the open ERD tab. Localhost only - the tab dials the MCP hub, never the reverse."
        right={
          <span className="flex items-center gap-1.5 rounded-full border border-[var(--color-line)] px-2.5 py-1 text-[11px] font-semibold text-ivory-800">
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT[settings.status] ?? STATUS_DOT.off}`} />
            {STATUS_LABEL[settings.status] ?? settings.status}
          </span>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-xs font-semibold text-ivory-800">
            Port
            <input
              value={portDraft}
              onChange={(e) => setPortDraft(e.target.value)}
              inputMode="numeric"
              className="ml-2 w-24 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-ivory-950"
            />
          </label>
          <label className="block text-xs font-semibold text-ivory-800">
            Pairing code
            <input
              value={codeDraft}
              onChange={(e) => setCodeDraft(e.target.value)}
              placeholder="Printed by npm run mcp"
              inputMode="numeric"
              className="ml-2 w-40 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-ivory-950"
            />
          </label>
          <button
            type="button"
            onClick={() => savePairing()}
            disabled={!codeReady}
            title={codeReady ? "Dial the MCP hub now" : "Enter the pairing code first"}
            className="rounded-lg bg-ivory-950 px-3 py-1.5 text-xs font-bold text-ivory-100 hover:bg-ivory-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save pairing
          </button>
          <button
            type="button"
            onClick={() => void discoverLocalHub()}
            disabled={discovering}
            title="Read the pairing code from the MCP hub running on this machine"
            className="rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-xs font-semibold text-ivory-800 hover:border-bronze-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {discovering ? "Finding…" : "Find local hub"}
          </button>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ivory-800" title="Once paired, the agent draws without asking per command. Pairing itself is the authorization; every write stays in the audit trail.">
            <input
              type="checkbox"
              checked={settings.autoApprove}
              onChange={(e) => setBridgeSettings({ autoApprove: e.target.checked })}
              className="h-3.5 w-3.5 accent-[#722F37]"
            />
            Auto mode - draw without asking
          </label>
        </div>
        {settings.error ? <p className="mt-2 text-xs font-semibold text-red-700">{settings.error}</p> : null}
        {discoverMsg ? <p className="mt-2 text-xs text-ivory-700">{discoverMsg}</p> : null}
        {settings.status === "live" ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2">
            <p className="min-w-0 flex-1 text-xs font-semibold text-emerald-900">
              Connected successfully - the paired terminal agent can now drive this tab
              {settings.autoApprove ? " (auto mode: writes run without asking)." : "."}
            </p>
            <button
              type="button"
              onClick={() => setBridgeSettings({ enabled: false })}
              className="shrink-0 rounded-lg border border-red-300 bg-white px-2.5 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50"
            >
              Disconnect
            </button>
          </div>
        ) : null}
        <p className="mt-2 text-[11px] leading-relaxed text-ivory-600">
          Requires a connected Salesforce session - the bridge borrows the tab session and the agent never sees
          tokens. {settings.autoApprove
            ? "Auto mode is on: paired writes run immediately and every one is written to the agent audit trail."
            : "Reads run immediately; every write opens an approval dialog in this tab and is written to the agent audit trail."}
        </p>
      </Card>

      <Card title="Connect a terminal agent" hint="Three steps - code refreshes on every MCP boot.">
        <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-ivory-800">
          <li>
            Start the MCP server where the agent runs: <code className="rounded bg-ivory-200 px-1">npm run mcp</code>{" "}
            (or <code className="rounded bg-ivory-200 px-1">node mcp/dist/gravenx-mcp.cjs</code>). It prints a pairing
            code and a one-click pair link.
          </li>
          <li>
            Easiest: open the pair link, or press Find local hub above and then Save pairing. Manual fallback: paste
            the code above, press Save pairing. Keep this tab open on the Schema canvas.
          </li>
          <li>
            Point the agent at the same port with <code className="rounded bg-ivory-200 px-1">GRAVENX_BRIDGE_PORT</code>{" "}
            (defaults to 49321) - example MCP client config:
          </li>
        </ol>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-ivory-950 p-3 text-[11px] leading-relaxed text-ivory-100">
          {snippet}
        </pre>
      </Card>

      <Card
        title="Live ERD commands"
        hint="What the agent can do once paired. Writes pause for your approval in this tab."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ivory-500">Reads - run free</p>
            <ul className="space-y-1.5">
              {BRIDGE_READS.map((kind) => (
                <li key={kind} className="rounded-lg border border-[var(--color-line)] px-2.5 py-1.5">
                  <code className="text-[11px] font-bold text-ivory-950">{kind}</code>
                  <p className="text-[11px] text-ivory-600">{describeCommand(kind, {})}</p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ivory-500">
              {settings.autoApprove ? "Writes - run immediately in auto mode" : "Writes - need your approval"}
            </p>
            <ul className="space-y-1.5">
              {BRIDGE_WRITES.map((kind) => (
                <li key={kind} className="rounded-lg border border-[var(--color-line)] px-2.5 py-1.5">
                  <code className="text-[11px] font-bold text-ivory-950">{kind}</code>
                  <p className="text-[11px] text-ivory-600">{describeCommand(kind, {})}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ivory-600">
          Author commands (erd.author_field, erd.author_object) travel the exact tab flow: author-mode gate, deploy
          confirm, production guardrails. Denials and approvals land in Agent Control &gt; audit.
        </p>
      </Card>
    </div>
  );
}
