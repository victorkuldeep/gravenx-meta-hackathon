"use client";

import { useSyncExternalStore } from "react";

/**
 * Agent bridge settings: enabled toggle, pairing code entry, bridge port,
 * and live connection status. Shared between Setup (controls) and the
 * inbox dock (connection owner + approval modal).
 */

export type BridgeStatus = "off" | "connecting" | "live" | "error";

export interface BridgeSettings {
  enabled: boolean;
  code: string;
  port: number;
  status: BridgeStatus;
  tabId: string | null;
  error: string | null;
  /** Bumped on every explicit pairing attempt so redials fire even when the code is unchanged. */
  attempt: number;
  /**
   * Auto-approve agent writes: once paired, the agent draws without a modal
   * per command. Pairing itself (code entry) is the authorization; every
   * write is still written to the agent audit trail. Off = approve each write.
   */
  autoApprove: boolean;
}

const PORT_KEY = "gravenx-bridge-port";
const ENABLED_KEY = "gravenx-bridge-enabled";
const TAB_KEY = "gravenx-bridge-tab";
const AUTO_KEY = "gravenx-bridge-autoapprove";

function readTabId(): string {
  try {
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id) {
      id = `tab_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
      sessionStorage.setItem(TAB_KEY, id);
    }
    return id;
  } catch {
    return "tab_fallback";
  }
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

function readPort(): number {
  try {
    const n = Number(localStorage.getItem(PORT_KEY));
    if (Number.isFinite(n) && n > 0 && n < 65536) return n;
  } catch {
    /* fall through */
  }
  return 49321;
}

function readAutoApprove(): boolean {
  try {
    const v = localStorage.getItem(AUTO_KEY);
    // Default ON: pairing authorizes the session; writes stay audited.
    if (v === null) return true;
    return v === "1";
  } catch {
    return true;
  }
}

let state: BridgeSettings = {
  enabled: readEnabled(),
  code: "",
  port: readPort(),
  status: "off",
  tabId: null,
  error: null,
  attempt: 0,
  autoApprove: readAutoApprove(),
};

const listeners = new Set<() => void>();
function emit(): void {
  for (const fn of listeners) fn();
}

export function getBridgeSettings(): BridgeSettings {
  return state;
}

export function setBridgeSettings(patch: Partial<BridgeSettings>): void {
  state = { ...state, ...patch };
  try {
    if (patch.enabled !== undefined) {
      localStorage.setItem(ENABLED_KEY, patch.enabled ? "1" : "0");
    }
    if (patch.port !== undefined) localStorage.setItem(PORT_KEY, String(patch.port));
    if (patch.autoApprove !== undefined) localStorage.setItem(AUTO_KEY, patch.autoApprove ? "1" : "0");
  } catch {
    /* private mode - session only */
  }
  emit();
}

export function ensureTabId(): string {
  if (!state.tabId) setBridgeSettings({ tabId: readTabId() });
  return (state.tabId ?? readTabId()) as string;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useBridgeSettings(): BridgeSettings {
  return useSyncExternalStore(subscribe, getBridgeSettings, getBridgeSettings);
}
