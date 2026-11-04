import type { SystemProject } from "@/lib/system-design/model";
import type { C4Level } from "./views";

/**
 * C4 auto-levels (Suggest) - deterministic placement from topology plus
 * system type. Fills gaps only: explicit levels always win, unconnected
 * nodes get no suggestion (absent evidence reads as unstated, never as
 * external). Every suggestion carries its rationale; the dialog previews
 * before anything is written.
 */

export interface C4Suggestion {
  id: string;
  name: string;
  /** Null when the topology says nothing (unconnected node). */
  level: C4Level | null;
  parentId?: string;
  rationale: string;
  alreadySet: boolean;
}

/** Stateful backing services - containers, or components of their service. */
const STORE_TYPES = new Set(["database", "warehouse", "queue", "streaming"]);

/** Someone else's system or the human edge - context when peripheral. */
const EXTERNAL_TYPES = new Set(["saas", "notify", "identity", "clm"]);

export function suggestC4(p: SystemProject): C4Suggestion[] {
  const neighbors = new Map<string, Set<string>>();
  for (const s of p.systems) neighbors.set(s.id, new Set());
  for (const c of p.connections) {
    if (c.sourceId === c.targetId) continue;
    neighbors.get(c.sourceId)?.add(c.targetId);
    neighbors.get(c.targetId)?.add(c.sourceId);
  }
  const degree = (id: string): number => neighbors.get(id)?.size ?? 0;
  const maxDegree = Math.max(0, ...p.systems.map((s) => degree(s.id)));

  // First pass: levels (suggested or explicit).
  const levelFor = new Map<string, C4Level | null>();
  const rationaleFor = new Map<string, string>();
  for (const s of p.systems) {
    const d = degree(s.id);
    const type = (s.systemType ?? "").toLowerCase();
    if (d === 0) {
      levelFor.set(s.id, null);
      rationaleFor.set(s.id, "Unconnected - assign by intent, the topology says nothing.");
    } else if (STORE_TYPES.has(type) && d > 1) {
      levelFor.set(s.id, "container");
      rationaleFor.set(s.id, "Stateful backing service shared by several neighbors.");
    } else if (STORE_TYPES.has(type) && d === 1) {
      levelFor.set(s.id, "container");
      rationaleFor.set(s.id, "Store at the edge - still ours unless it nests under its service.");
    } else if (EXTERNAL_TYPES.has(type) && d === 1) {
      levelFor.set(s.id, "context");
      rationaleFor.set(s.id, "Third-party or human edge hanging off one neighbor.");
    } else if (d === 1) {
      levelFor.set(s.id, "context");
      rationaleFor.set(s.id, "Single connection - the edge of the modeled topology.");
    } else if (d >= 3 && d === maxDegree) {
      levelFor.set(s.id, "container");
      rationaleFor.set(s.id, `Busiest hub (${d} neighbors route through it).`);
    } else {
      levelFor.set(s.id, "container");
      rationaleFor.set(s.id, "Connected interior node - a deployable unit.");
    }
  }

  // Second pass: parents. A lone datastore leaf nests inside its service -
  // but only when that service reads as a container (explicit or suggested),
  // so components never dangle under context.
  return p.systems.map((s) => {
    const d = degree(s.id);
    const type = (s.systemType ?? "").toLowerCase();
    let parentId: string | undefined;
    let rationale = rationaleFor.get(s.id) ?? "";
    if (levelFor.get(s.id) !== null && STORE_TYPES.has(type) && d === 1) {
      const only = [...(neighbors.get(s.id) ?? [])][0];
      const parentLevel = p.systems.find((x) => x.id === only)?.level ?? levelFor.get(only ?? "") ?? null;
      if (only && parentLevel === "container") {
        const parentName = p.systems.find((x) => x.id === only)?.name ?? only;
        parentId = only;
        rationale = `Sole datastore of ${parentName} - nests as its component.`;
      }
    }
    const level = levelFor.get(s.id) ?? null;
    return {
      id: s.id,
      name: s.name,
      level: parentId ? "component" : level,
      ...(parentId ? { parentId } : {}),
      rationale,
      alreadySet: s.level !== undefined,
    };
  });
}
