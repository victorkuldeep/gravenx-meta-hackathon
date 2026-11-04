/**
 * System live-bridge command handlers.
 *
 * Pure mapping layer between the tab<->hub bridge protocol
 * (`sys.snapshot`, `sys.place`, `sys.connect`, `sys.remove`) and the live
 * SystemDesigner project. SystemDesigner builds one context object from its
 * state and registers these handlers; the bridge inbox dispatches to them.
 *
 * Reads run free; writes pause for the architect's approval (or run
 * immediately in auto mode). Handlers never see tokens.
 */

import type {
  SystemNode,
  SystemProject,
  SystemType,
} from "../system-design/model";
import { SYSTEM_TEMPLATES } from "../system-design/model";

/** Minimal live System Design surface the handlers need. */
export interface SystemBridgeContext {
  /** Current project (null when no project is open). */
  getProject: () => SystemProject | null;
  newBlankProject: (name?: string) => { id: string; name: string };
  rebalance: () => { moved: number };
  placeSystems: (specs: { type: string; name?: string; x?: number; y?: number }[]) => { placed: string[] };
  connectByName: (from: string, to: string, label?: string) => { from: string; to: string };
  removeByName: (names: string[]) => { removed: string[] };
}

export const SYSTEM_BRIDGE_KINDS = [
  "sys.new",
  "sys.snapshot",
  "sys.place",
  "sys.connect",
  "sys.remove",
  "sys.rebalance",
] as const;

function strArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v.trim() : "";
}

export function resolveSystemByName(systems: SystemNode[], ref: string): SystemNode {
  const q = ref.trim();
  if (!q) throw new Error("System reference is empty.");
  const lower = q.toLowerCase();
  const exact = systems.find((s) => s.name.toLowerCase() === lower || s.id === ref);
  if (exact) return exact;
  const hits = systems.filter((s) => s.name.toLowerCase().includes(lower));
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) {
    const known = systems.length > 0 ? systems.map((s) => s.name).join(", ") : "none - place one first";
    throw new Error(`Unknown system "${q}". On canvas: ${known}.`);
  }
  throw new Error(`Ambiguous system "${q}" - matches ${hits.map((s) => s.name).join(", ")}. Use the exact name.`);
}

export function resolveSystemType(ref: string): { type: SystemType; templateIndex: number } {
  const q = ref.trim().toLowerCase();
  if (!q) throw new Error("System type is empty.");
  const byType = SYSTEM_TEMPLATES.findIndex((t) => t.systemType === q);
  if (byType >= 0) return { type: SYSTEM_TEMPLATES[byType].systemType, templateIndex: byType };
  const byName = SYSTEM_TEMPLATES.findIndex((t) => t.name.toLowerCase() === q);
  if (byName >= 0) return { type: SYSTEM_TEMPLATES[byName].systemType, templateIndex: byName };
  const hits = SYSTEM_TEMPLATES.map((t, i) => ({ t, i })).filter(
    ({ t }) => t.systemType.includes(q) || t.name.toLowerCase().includes(q)
  );
  if (hits.length === 1) return { type: hits[0].t.systemType, templateIndex: hits[0].i };
  if (hits.length === 0) {
    throw new Error(`Unknown system type "${ref}". Known: ${SYSTEM_TEMPLATES.map((t) => t.systemType).join(", ")}.`);
  }
  throw new Error(`Ambiguous system type "${ref}" - matches ${hits.map(({ t }) => t.systemType).join(", ")}.`);
}

export function buildSystemBridgeHandlers(ctx: SystemBridgeContext): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
  return {
    "sys.new": async (args) => {
      const name = strArg(args, "name");
      return ctx.newBlankProject(name || undefined);
    },

    "sys.rebalance": async () => ctx.rebalance(),

    "sys.snapshot": async () => {
      const p = ctx.getProject();
      if (!p) throw new Error("No system project open - open or create one in System Design first.");
      return {
        project: p.name,
        systems: p.systems.map((s) => ({ id: s.id, name: s.name, type: s.systemType, position: s.position })),
        connections: p.connections.map((c) => ({
          id: c.id,
          from: p.systems.find((s) => s.id === c.sourceId)?.name ?? c.sourceId,
          to: p.systems.find((s) => s.id === c.targetId)?.name ?? c.targetId,
          label: c.label,
          status: c.status,
        })),
        counts: { systems: p.systems.length, connections: p.connections.length, operations: p.operations.length, flows: p.flows.length },
      };
    },

    "sys.place": async (args) => {
      const raw = args.systems;
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error("Pass systems: [{type, name?, x?, y?}] with at least one entry.");
      }
      if (raw.length > 10) throw new Error("At most 10 systems per call - place the rest in a second call.");
      const specs = raw.map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        const type = typeof o.type === "string" ? o.type : "";
        if (!type) throw new Error("Every entry needs a type (e.g. salesforce, middleware, queue).");
        const out: { type: string; name?: string; x?: number; y?: number } = { type };
        if (typeof o.name === "string" && o.name.trim()) out.name = o.name.trim().slice(0, 80);
        if (typeof o.x === "number" && Number.isFinite(o.x)) out.x = o.x;
        if (typeof o.y === "number" && Number.isFinite(o.y)) out.y = o.y;
        return out;
      });
      return ctx.placeSystems(specs);
    },

    "sys.connect": async (args) => {
      const from = strArg(args, "from");
      const to = strArg(args, "to");
      if (!from || !to) throw new Error("Pass from and to system names.");
      if (from.toLowerCase() === to.toLowerCase()) throw new Error("Cannot connect a system to itself.");
      return ctx.connectByName(from, to, strArg(args, "label") || undefined);
    },

    "sys.remove": async (args) => {
      const raw = args.names;
      const names = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean) : [];
      if (names.length === 0) throw new Error("Pass names: [system names] with at least one entry.");
      return ctx.removeByName(names);
    },
  };
}
