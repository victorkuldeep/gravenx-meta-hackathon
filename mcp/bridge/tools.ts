import { z } from "zod";
import type { BridgeHub } from "./hub.js";
import type { McpTool } from "../tools/types.js";

/**
 * Live ERD tools: forward to the paired studio tab through the bridge hub
 * instead of writing files. Reads return immediately; writes run
 * autonomously once paired (pairing is the approval - auto-mode is on by
 * default, audited in the tab; turn it off in Setup to require per-command
 * approval). No tab connected -> every tool fails with pairing instructions.
 */

function live(
  hub: BridgeHub,
  name: string,
  description: string,
  shape: McpTool["shape"],
  command: string,
  pickArgs: (args: Record<string, unknown>) => Record<string, unknown> = (a) => a,
  timeoutMs = 120000,
): McpTool {
  return {
    name,
    description,
    shape,
    run: async (_dir, args) => {
      try {
        const res = await hub.call(command, pickArgs(args), timeoutMs);
        if (!res.ok) {
          return {
            ok: false,
            summary: res.denied ? "Denied by the architect in the studio tab." : "Studio tab reported failure.",
            error: typeof res.error === "string" ? res.error : "Bridge call failed.",
            data: res.data,
          };
        }
        return { ok: true, summary: "Studio tab executed the command.", data: res.data };
      } catch (e) {
        return {
          ok: false,
          summary: "Bridge call failed.",
          error: e instanceof Error ? e.message : "Bridge call failed.",
        };
      }
    },
  };
}

export function liveTools(hub: BridgeHub): McpTool[] {
  const str = (label: string, max = 255) => z.string().min(1).max(max).describe(label);
  return [
    live(hub, "bridge_status", "Bridge state: listening port, pairing code, whether a studio tab is connected.", {}, "bridge.ping", () => ({}), 15000),
    live(hub, "erd_live_snapshot", "Read the live canvas: nodes on canvas, focus object, view mode, active filters.", {}, "erd.snapshot", () => ({}), 30000),
    live(
      hub,
      "erd_live_objects",
      "Browse the live org schema: search objects by name or label (read-only, no canvas change).",
      {
        query: z.string().max(120).optional().describe("Substring to match against api name or label; omit for the first page"),
        limit: z.number().int().min(1).max(100).optional().describe("Max objects to return (default 25)"),
      },
      "erd.objects",
    ),
    live(
      hub,
      "activity_live_list",
      "Read the live tab's org-mutation audit trail (Arch Activity): who deployed what, when, and whether it worked. Read-only - for review, risk summaries and JIRA drafts.",
      {
        limit: z.number().int().min(1).max(200).optional().describe("Max entries, newest first (default 50)"),
        actor: z.enum(["architect", "agent-bridge"]).optional().describe("Filter by who acted"),
        category: z.enum(["metadata", "data"]).optional().describe("Metadata deploys vs record edits"),
      },
      "arch.activity",
      undefined,
      30000,
    ),
    live(
      hub, "system_live_new", "Start a new blank System Design project from scratch (replaces the current canvas; the old project stays saved). Call this first when there is no open project.",
      { name: z.string().min(1).max(80).optional().describe("Project name, e.g. Headless CPQ demo") },
      "sys.new",
    ),
    live(
      hub, "system_live_rebalance", "Rebalance the open canvas into a readable flow (sources left, sinks right, staggered rows). Keeps all connections; undoes with Ctrl+Z.",
      {},
      "sys.rebalance",
    ),
    live(
      hub, "system_live_snapshot", "Read the open System Design project: systems with types/positions, connections with status, counts. Read-only.",
      {},
      "sys.snapshot",
      undefined,
      30000,
    ),
    live(
      hub, "system_live_place", "Place systems on the live System Design canvas by type (salesforce, middleware, queue, ...) with optional names/positions.",
      { systems: z.array(z.object({ type: z.string().min(1).max(40), name: z.string().max(80).optional(), x: z.number().optional(), y: z.number().optional() })).min(1).max(10) },
      "sys.place",
    ),
    live(
      hub, "system_live_connect", "Connect two live systems by name with a draft edge (architect confirms topology on canvas).",
      { from: z.string().min(1).describe("Source system name"), to: z.string().min(1).describe("Target system name"), label: z.string().max(120).optional() },
      "sys.connect",
    ),
    live(
      hub, "system_live_remove", "Remove live systems by name (dangling connections go with them).",
      { names: z.array(z.string().min(1).max(80)).min(1).max(10) },
      "sys.remove",
    ),
    live(
      hub, "erd_live_discover", "Ask the live org (via the tab session) for parents/children of an object - relationships only, nothing placed yet.",
      { apiName: str("Object api name"), direction: z.enum(["parents", "children", "both"]).default("both") },
      "erd.discover",
    ),
    live(
      hub, "erd_live_place", "Describe and drop objects onto the live canvas (asks approval in the tab).",
      { apiNames: z.array(z.string().min(1).max(255)).min(1).max(25) },
      "erd.place",
    ),
    live(
      hub, "erd_live_hide", "Hide (or unhide with hide=false) objects on the live canvas - reversible curation, needs approval in the tab.",
      { apiNames: z.array(z.string().min(1).max(255)).min(1).max(25), hide: z.boolean().optional() },
      "erd.hide",
    ),
    live(
      hub, "erd_live_remove", "Remove objects from the live canvas (re-add anytime with place) - needs approval in the tab.",
      { apiNames: z.array(z.string().min(1).max(255)).min(1).max(25) },
      "erd.remove",
    ),
    live(
      hub, "erd_live_tags", "List, create, assign and delete canvas tags (list/create/assign/unassign/delete) - needs approval in the tab.",
      {
        action: z.enum(["list", "create", "assign", "unassign", "delete"]).default("list"),
        name: z.string().max(24).optional().describe("Tag name for create"),
        color: z.string().max(7).optional().describe("Hex color for create (snapped to palette)"),
        tag: z.string().max(64).optional().describe("Tag name or id for assign/unassign"),
        apiNames: z.array(z.string().min(1).max(255)).min(1).max(25).optional().describe("Objects for assign/unassign"),
      },
      "erd.tags",
    ),
    live(
      hub, "erd_live_focus", "Center the live canvas on an object already placed.",
      { apiName: str("Object api name") },
      "erd.focus", undefined, 30000,
    ),
    live(
      hub, "erd_live_mode", "Switch the live canvas between ERD and graph views.",
      { mode: z.enum(["erd", "graph"]) },
      "erd.mode", undefined, 30000,
    ),
    live(
      hub, "erd_live_filter", "Change live canvas filters (hideSystem true/false, mode all/standard/custom/manual).",
      { hideSystem: z.boolean().optional(), mode: z.enum(["all", "standard", "custom", "manual"]).optional() },
      "erd.filter", undefined, 30000,
    ),
    live(
      hub, "erd_live_author_field", "Create a field on the live canvas via Author mode - travels the exact approval + PROD guardrail flow; needs architect approval in the tab.",
      {
        childApi: str("Parent object api name"),
        apiName: str("New field api name"),
        label: z.string().max(120).optional(),
        type: z.string().max(60).optional(),
      },
      "erd.author_field",
    ),
    live(
      hub, "erd_live_author_object", "Create an object from the live canvas via Author mode - same approval + PROD flow as the UI.",
      { apiName: str("New object api name"), label: z.string().max(120).optional() },
      "erd.author_object",
    ),
  ];
}
