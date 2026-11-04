"use client";

import { useEffect, useRef, useState } from "react";
import { useIsomorphicLayoutEffect } from "@/lib/ui/useIsomorphicLayoutEffect";
import { useRouter } from "next/navigation";
import { BridgeInbox } from "@/lib/bridge/inbox";
import type { BridgeCall } from "@/lib/bridge/protocol";
import { describeCommand } from "@/lib/bridge/protocol";
import { ensureTabId, getBridgeSettings, setBridgeSettings, useBridgeSettings } from "@/lib/bridge/settings";
import { isSalesforceConnected } from "@/lib/ai/gate";
import { logToolRun } from "@/lib/setup/audit";
import { ConfirmDialog } from "../ui/ConfirmDialog";

const POS_KEY = "gravenx-bridge-pos";

function readDockPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      return { x: Math.max(8, p.x), y: Math.max(8, p.y) };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Agent bridge dock: owns the tab-side inbox lifecycle, renders the
 * connection pill + pairing panel, and surfaces the approval modal every
 * mutating agent command must pass. Reads run free; writes wait here.
 * Mounted app-wide; commands dispatch to whichever tab registered them.
 */
export function BridgeDock() {
  const settings = useBridgeSettings();
  const router = useRouter();
  const inboxRef = useRef<BridgeInbox | null>(null);
  const approveRef = useRef<((ok: boolean) => void) | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<BridgeCall | null>(null);
  const [codeDraft, setCodeDraft] = useState("");
  const [portDraft, setPortDraft] = useState("");
  const [justPaired, setJustPaired] = useState(false);
  // Draggable pill: null = docked bottom-left; a position pins it anywhere so
  // it never covers canvas controls. Survives reloads via localStorage.
  // Initialized null so SSR and first client render match - the stored
  // position applies in a pre-paint layout effect (no flash, no mismatch).
  const [dockPos, setDockPos] = useState<{ x: number; y: number } | null>(null);
  useIsomorphicLayoutEffect(() => {
    setDockPos(readDockPos());
  }, []);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  useEffect(() => {
    if (!justPaired) return;
    const t = window.setTimeout(() => setJustPaired(false), 9000);
    return () => window.clearTimeout(t);
  }, [justPaired]);

  useEffect(() => {
    if (!settings.enabled) {
      inboxRef.current?.close();
      inboxRef.current = null;
      if (getBridgeSettings().status !== "off") setBridgeSettings({ status: "off", error: null });
      return;
    }
    if (!settings.code.trim()) {
      inboxRef.current?.close();
      inboxRef.current = null;
      setBridgeSettings({ status: "off", error: "Enter the pairing code the MCP server printed." });
      return;
    }
    if (!isSalesforceConnected()) {
      inboxRef.current?.close();
      inboxRef.current = null;
      setBridgeSettings({ status: "off", error: "Connect Salesforce first - the bridge acts on the live org." });
      return;
    }
    const inbox = new BridgeInbox({
      onStatus: (status, error) => {
        setBridgeSettings({ status, error: error ?? null });
        if (status === "live") setJustPaired(true);
      },
      onApproval: (call, approve) => {
        approveRef.current = approve;
        setPending(call);
      },
      onEvent: (kind, ok, detail) => {
        void logToolRun({ skill: "agent-bridge", tool: kind, label: detail.slice(0, 200), ok, detail: detail.slice(0, 500) });
      },
      // Agent commands find their tab: sys.* opens System Design, erd.* the
      // Schema canvas. The inbox waits for the tab to register, then runs.
      onNavigatePath: (path) => {
        router.push(path);
      },
    });
    inboxRef.current?.close();
    inboxRef.current = inbox;
    inbox.connect(settings.port, settings.code.trim(), ensureTabId());
    return () => {
      inbox.close();
      if (inboxRef.current === inbox) inboxRef.current = null;
    };
  }, [settings.enabled, settings.code, settings.port, settings.attempt, router]);

  const decide = (ok: boolean) => {
    const call = pending;
    setPending(null);
    approveRef.current?.(ok);
    approveRef.current = null;
    if (call) {
      void logToolRun({
        skill: "agent-bridge",
        tool: call.command,
        label: ok ? "Approved by the architect." : "Denied by the architect.",
        ok,
      });
    }
  };

  // Popover placement follows the dragged pill: it opens above the pill when
  // there is no room below, and hugs the pill's right edge near the viewport's
  // right side, so it never renders clipped off-screen.
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const openUp = dockPos ? dockPos.y > vh - 460 : true;
  const alignRight = dockPos ? dockPos.x > vw - 320 : false;

  const dot =
    settings.status === "live" ? "bg-emerald-500" : settings.status === "connecting" ? "bg-amber-400 animate-pulse" : settings.status === "error" ? "bg-red-500" : "bg-ivory-400";
  const label =
    settings.status === "live"
      ? "Bridge live"
      : settings.status === "connecting"
        ? "Bridge pairing…"
        : settings.status === "error"
          ? "Bridge error"
          : "Bridge off";

  const beginPillDrag = (e: React.PointerEvent) => {
    const el = pillRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top, moved: false };
  };
  const movePillDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    d.moved = true;
    const w = typeof window === "undefined" ? 1200 : window.innerWidth;
    const h = typeof window === "undefined" ? 800 : window.innerHeight;
    setDockPos({
      x: Math.min(Math.max(8, d.ox + dx), Math.max(8, w - 140)),
      y: Math.min(Math.max(8, d.oy + dy), Math.max(8, h - 48)),
    });
  };
  const endPillDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.moved) {
      suppressClickRef.current = true;
      try {
        const el = pillRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(rect.left), y: Math.round(rect.top) }));
        }
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <>
      <div
        ref={pillRef}
        className={dockPos ? "fixed z-40" : "fixed bottom-4 left-4 z-40"}
        style={dockPos ? { left: dockPos.x, top: dockPos.y } : undefined}
      >
        <button
          type="button"
          onPointerDown={beginPillDrag}
          onPointerMove={movePillDrag}
          onPointerUp={endPillDrag}
          onPointerCancel={() => { dragRef.current = null; }}
          onDoubleClick={() => {
            setDockPos(null);
            try { localStorage.removeItem(POS_KEY); } catch { /* ignore */ }
          }}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            setOpen((v) => !v);
            setCodeDraft(getBridgeSettings().code);
            setPortDraft(String(getBridgeSettings().port));
          }}
          title="Agent bridge - drag to move, double-click to re-dock"
          className="flex cursor-grab items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[11px] font-semibold text-ivory-800 shadow-sm hover:border-bronze-500 active:cursor-grabbing"
        >
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          {label}
        </button>
        {open && (
          <div
            className={`w-72 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-lg ${
              openUp ? "absolute bottom-full mb-2" : "absolute top-full mt-2"
            } ${alignRight ? "right-0" : "left-0"}`}
          >
            <p className="text-xs font-bold text-ivory-950">Agent bridge</p>
            <p className="mt-0.5 text-[11px] leading-snug text-ivory-600">
              A paired terminal agent (via MCP) drives this tab like you do. Reads are free;{" "}
              {settings.autoApprove
                ? "writes run immediately in auto mode and stay audited."
                : "every change waits for your allow."}
            </p>
            <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-ivory-800">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setBridgeSettings({ enabled: e.target.checked })}
                className="h-3.5 w-3.5 accent-[#722F37]"
              />
              Enable bridge
            </label>
            <label className="mt-2 block">
              <span className="text-[11px] font-semibold text-ivory-700">Pairing code (from the MCP server log)</span>
              <span className="mt-1 flex gap-1.5">
                <input
                  value={codeDraft}
                  onChange={(e) => setCodeDraft(e.target.value.replace(/\D/g, "").slice(0, 12))}
                  inputMode="numeric"
                  placeholder="6-digit code"
                  spellCheck={false}
                  aria-label="Pairing code"
                  className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-white px-2 font-mono text-xs text-ivory-950 focus:border-bronze-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setBridgeSettings({
                    enabled: true,
                    code: codeDraft.trim(),
                    status: "connecting",
                    error: null,
                    attempt: Date.now(),
                  })}
                  className="cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 text-xs font-semibold text-ivory-800 hover:border-bronze-500"
                >
                  Pair
                </button>
              </span>
            </label>
            <label className="mt-2 block">
              <span className="text-[11px] font-semibold text-ivory-700">Bridge port</span>
              <input
                value={portDraft}
                onChange={(e) => setPortDraft(e.target.value.replace(/\D/g, "").slice(0, 5))}
                onBlur={() => {
                  const n = Number(portDraft);
                  if (Number.isFinite(n) && n > 0 && n < 65536) setBridgeSettings({ port: n });
                }}
                inputMode="numeric"
                aria-label="Bridge port"
                className="mt-1 h-8 w-full rounded-lg border border-[var(--color-line)] bg-white px-2 font-mono text-xs text-ivory-950 focus:border-bronze-500 focus:outline-none"
              />
            </label>
            {settings.error && <p className="mt-1.5 text-[11px] text-red-700">{settings.error}</p>}
            {settings.status === "live" && (
              <button
                type="button"
                onClick={() => setBridgeSettings({ enabled: false })}
                className="mt-2 cursor-pointer rounded-lg border border-red-300 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-50"
              >
                Disconnect (kill switch)
              </button>
            )}
          </div>
        )}
      </div>
      {pending && (
        <ConfirmDialog
          title="Allow this agent action?"
          message={`${describeCommand(pending.command, pending.args)} — requested by the paired terminal agent on the connected org. Deny costs nothing.`}
          confirmLabel="Allow + run"
          tone={pending.command.startsWith("erd.author") ? "danger" : "default"}
          onCancel={() => decide(false)}
          onConfirm={() => decide(true)}
        />
      )}
      {justPaired && settings.status === "live" && !pending && (
        <ConfirmDialog
          title="Terminal agent connected"
          message="Pairing succeeded - the terminal agent can now drive this tab. Reads run free; writes follow your auto-mode setting. This closes on its own."
          confirmLabel="Start driving"
          tone="default"
          onCancel={() => setJustPaired(false)}
          onConfirm={() => setJustPaired(false)}
        />
      )}
    </>
  );
}
