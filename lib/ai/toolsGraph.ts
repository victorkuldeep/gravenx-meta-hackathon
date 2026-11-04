import { z } from "zod";
import type { AgentTool } from "./tools";
import { loadGraphIndex } from "@/lib/graph/load";
import { GRAPH_SURFACE_LABELS } from "@/lib/graph/links";

/**
 * Knowledge tool pack - the architecture repository behind one read tool.
 * Read-only and approval-free: the agent looks up what references what and
 * reasons in words; links are still created where they live (Console, ADR,
 * REQ panels). Never invents records - misses say so.
 */

const describeArgs = z.object({
  query: z.string().max(120).optional().describe("Name fragment to find, e.g. Middleware, ACME-7"),
  surface: z
    .enum(["system", "wireframe", "sequence", "decision", "requirement", "console", "mapping", "schema", "draw"])
    .optional()
    .describe("Narrow matches to one surface"),
});

const graphDescribe: AgentTool = {
  name: "graph_describe",
  description:
    "Search the architecture index: records by name, what references them (inbound) and what they reference (outbound), plus index totals and dangling-reference count. Read-only.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" }, surface: { type: "string" } },
    additionalProperties: false,
  },
  needsApproval: false,
  label: (a) => `Search the architecture${((a as { query?: string }).query ?? "") ? ` for "${((a as { query?: string }).query ?? "").slice(0, 40)}"` : ""}`,
  schema: describeArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof describeArgs>;
    let index;
    try {
      index = await loadGraphIndex();
    } catch {
      return { ok: false, error: "The architecture index is unavailable in this browser." };
    }
    const bySurface: Record<string, number> = {};
    for (const n of index.nodes) {
      if (n.recordId || n.kind === "external-issue") bySurface[n.surface] = (bySurface[n.surface] ?? 0) + 1;
    }
    const q = (args.query ?? "").trim().toLowerCase();
    const matches = index.nodes
      .filter((n) => n.recordId || n.kind === "external-issue")
      .filter((n) => (args.surface ? n.surface === args.surface : true))
      .filter((n) => (!q ? true : n.name.toLowerCase().includes(q)))
      .slice(0, 20)
      .map((n) => ({
        name: n.name,
        surface: GRAPH_SURFACE_LABELS[n.surface] ?? n.surface,
        kind: n.kind,
        usedBy: index.edges.filter((e) => e.to === n.key).length,
        uses: index.edges.filter((e) => e.from === n.key).length,
        ...(n.stub ? { missing: true } : {}),
      }));
    return {
      ok: true,
      result: {
        recordsBySurface: bySurface,
        links: index.edges.length,
        dangling: index.unresolved.length,
        ...(q || args.surface ? { matches } : { matches: matches.slice(0, 10) }),
      },
    };
  },
};

export const GRAPH_TOOLS: AgentTool[] = [graphDescribe];
