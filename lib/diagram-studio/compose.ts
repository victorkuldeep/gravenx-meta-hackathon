import type { StudioItemKind } from "./types";

/**
 * Diagram Studio compose planner (Phase 2): the deterministic half of the
 * AI compose skill. The model proposes {kind, name} pairs in words; this
 * resolves them against the live canvas inventory without inventing ids.
 * Anything unmatched is reported, never guessed.
 */

export interface PackRequest {
  kind: StudioItemKind;
  name: string;
}

export interface InventoryEntry {
  kind: StudioItemKind;
  id: string;
  name: string;
}

export interface ResolvedPackItem {
  kind: StudioItemKind;
  refId: string;
  name: string;
}

export function resolvePackItems(
  requested: PackRequest[],
  inventory: InventoryEntry[]
): { resolved: ResolvedPackItem[]; unresolved: PackRequest[] } {
  const resolved: ResolvedPackItem[] = [];
  const unresolved: PackRequest[] = [];
  const seen = new Set<string>();
  for (const req of requested) {
    const want = req.name.trim().toLowerCase();
    if (!want) {
      unresolved.push(req);
      continue;
    }
    const poolKind = req.kind === "flow" ? "system" : req.kind;
    const pool = inventory.filter((e) => e.kind === poolKind);
    const hit = pool.find((e) => e.name.trim().toLowerCase() === want) ?? pool.find((e) => e.name.toLowerCase().includes(want));
    if (!hit) {
      unresolved.push(req);
      continue;
    }
    const key = `${hit.kind}:${hit.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      resolved.push({ kind: req.kind, refId: hit.id, name: hit.name });
    }
  }
  return { resolved, unresolved };
}
