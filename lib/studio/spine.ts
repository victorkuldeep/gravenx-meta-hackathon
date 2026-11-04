import { loadArtifactIndex } from "@/lib/studio/artifacts";

/**
 * First-assemby spine: connect -> snapshot -> map -> screen -> export.
 * Completion derives from existing stores (artifact index + session) -
 * no new state machine. Dismissal + export memory live in localStorage.
 */

export type SpineStepId = "connect" | "snapshot" | "map" | "screen" | "export";

export interface SpineStep {
  id: SpineStepId;
  n: string;
  label: string;
  desc: string;
  href: string;
}

export const SPINE_STEPS: SpineStep[] = [
  { id: "connect", n: "01", label: "Connect org", desc: "Session token, proxied server-side.", href: "/" },
  { id: "snapshot", n: "02", label: "Capture snapshot", desc: "Freeze the org's metadata.", href: "/mapping" },
  { id: "map", n: "03", label: "Map a payload", desc: "Source JSON to Salesforce fields.", href: "/mapping" },
  { id: "screen", n: "04", label: "Attach a screen", desc: "Screenshot or wireframe + fields.", href: "/mapping" },
  { id: "export", n: "05", label: "Export the pack", desc: "ZIP, Word, Excel, sign-off.", href: "/mapping" },
];

export interface SpineInput {
  connected: boolean;
  mappings: number;
  screens: number;
  snapshots: number;
  exported: boolean;
}

export function computeSpine(input: SpineInput): Record<SpineStepId, boolean> {
  return {
    connect: input.connected,
    snapshot: input.snapshots > 0,
    map: input.mappings > 0,
    screen: input.screens > 0,
    export: input.exported,
  };
}

const KEY = "gravenx-spine";

function readStore(): { dismissed: boolean; exported: boolean } {
  try {
    if (typeof window === "undefined" || !window.localStorage) return { dismissed: false, exported: false };
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { dismissed: false, exported: false };
    const parsed = JSON.parse(raw) as { dismissed?: boolean; exported?: boolean };
    return { dismissed: !!parsed.dismissed, exported: !!parsed.exported };
  } catch {
    return { dismissed: false, exported: false };
  }
}

function writeStore(v: { dismissed: boolean; exported: boolean }): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode - spine simply reappears */
  }
}

export function spineMemory(): { dismissed: boolean; exported: boolean } {
  return readStore();
}

export function spineDismiss(): void {
  const cur = readStore();
  writeStore({ ...cur, dismissed: true });
}

export function spineMarkExported(): void {
  const cur = readStore();
  writeStore({ ...cur, exported: true });
}

function readSession(): boolean {
  try {
    const raw = sessionStorage.getItem("gravenx_session");
    if (!raw) return false;
    const s = JSON.parse(raw) as { token?: string; instanceUrl?: string };
    return !!(s.token && s.instanceUrl);
  } catch {
    return false;
  }
}

/** Self-sufficient spine input: session + full artifact index. */
export async function loadSpineInput(): Promise<SpineInput & { dismissed: boolean }> {
  const mem = readStore();
  try {
    const entries = await loadArtifactIndex();
    const maps = entries.filter((e) => e.kind === "integration-mapping");
    const screens = entries.filter((e) => e.kind === "wireframe-screen").length;
    return {
      connected: readSession(),
      mappings: maps.length,
      screens,
      snapshots: maps.filter((m) => m.hasSnapshot).length,
      exported: mem.exported,
      dismissed: mem.dismissed,
    };
  } catch {
    return { connected: readSession(), mappings: 0, screens: 0, snapshots: 0, exported: mem.exported, dismissed: mem.dismissed };
  }
}
