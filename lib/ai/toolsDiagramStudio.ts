import { z } from "zod";
import { blankStudioProject, newStudioId, orphanedItems, type StudioItemKind } from "@/lib/diagram-studio/types";
import { STUDIO_THEMES, studioTheme } from "@/lib/diagram-studio/themes";
import { listDiagramStudios, saveDiagramStudio } from "@/lib/diagram-studio/store";
import { resolvePackItems, type InventoryEntry } from "@/lib/diagram-studio/compose";
import { SKETCH_TOOLS } from "./toolsSketch";
import { listSequences } from "@/lib/sequence/store";
import { listSystemProjects } from "@/lib/system-design/store";
import type { AgentTool } from "./tools";

/**
 * Diagram Studio tool pack: reads run free, pack mutations need panel
 * approval. Compose resolves canvas names against the live inventory -
 * unmatched names fail honestly instead of inventing references.
 */

const noArgs = z.object({});

async function inventory(): Promise<InventoryEntry[]> {
  const [seqs, sys] = await Promise.all([
    listSequences().catch(() => []),
    listSystemProjects().catch(() => []),
  ]);
  return [
    ...seqs.map((d) => ({ kind: "sequence" as const, id: d.id, name: d.name })),
    ...sys.map((s) => ({ kind: "system" as const, id: s.id, name: s.name })),
  ];
}

const listPacks: AgentTool = {
  name: "dstudio_list",
  description: "List diagram studio packs: names, item counts and themes. Read-only.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "List studio packs",
  schema: noArgs,
  execute: async () => {
    const packs = await listDiagramStudios();
    if (packs.length === 0) return { ok: true, result: "No studio packs yet." };
    return {
      ok: true,
      result: packs.map((p) => ({ id: p.id, name: p.name, items: p.items.length, theme: studioTheme(p.themeId).name })),
    };
  },
};

const inventoryTool: AgentTool = {
  name: "dstudio_inventory",
  description: "List canvases available for packs: sequence documents and system canvases by name. Read-only.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "List packable canvases",
  schema: noArgs,
  execute: async () => {
    const inv = await inventory();
    if (inv.length === 0) return { ok: true, result: "No sequences or system canvases exist yet - create one on its tab first." };
    return { ok: true, result: inv.map((e) => ({ kind: e.kind, name: e.name })) };
  },
};

const describeArgs = z.object({
  pack: z.string().min(1).max(200).describe("Pack id or exact name"),
});

const describePack: AgentTool = {
  name: "dstudio_describe",
  description: "Describe one pack: theme, items with resolved canvas names, and orphan flags for deleted sources. Read-only.",
  parameters: {
    type: "object",
    properties: { pack: { type: "string" } },
    required: ["pack"],
    additionalProperties: false,
  },
  needsApproval: false,
  label: () => "Describe studio pack",
  schema: describeArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof describeArgs>;
    const want = args.pack.trim().toLowerCase();
    const packs = await listDiagramStudios();
    const found = packs.find((p) => p.id === want || p.name.trim().toLowerCase() === want);
    if (!found) return { ok: false, error: `No studio pack "${args.pack}". Use dstudio_list for names.` };
    const inv = await inventory();
    const live = new Set(inv.map((e) => e.id));
    const names = new Map(inv.map((e) => [`${e.kind}:${e.id}`, e.name]));
    return {
      ok: true,
      result: {
        id: found.id,
        name: found.name,
        theme: studioTheme(found.themeId).name,
        items: found.items.map((i, n) => ({
          n: n + 1,
          kind: i.kind,
          title: i.titleOverride ?? names.get(`${i.kind}:${i.refId}`) ?? "(deleted source)",
          orphaned: !live.has(i.refId),
        })),
        orphaned: orphanedItems(found.items, live).length,
      },
    };
  },
};

const composeArgs = z.object({
  name: z.string().min(1).max(120).describe("Pack name, e.g. RCA review"),
  theme: z.string().max(60).optional().describe("Theme id - omit for premium-light"),
  items: z
    .array(z.object({ kind: z.enum(["sequence", "system", "flow"]), name: z.string().min(1).max(200) }))
    .min(1)
    .max(20)
    .describe("Canvases by kind + name, in export order"),
});

const composePack: AgentTool = {
  name: "dstudio_compose",
  description: "Create a studio pack from canvas names in export order. Names must match live canvases - unmatched names fail with the list, nothing is invented. Kind flow resolves against system canvases.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" },
      theme: { type: "string" },
      items: { type: "array", items: { type: "object" } },
    },
    required: ["name", "items"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => {
    const v = a as { name?: string; items?: unknown[] };
    return `Compose pack "${v.name ?? "untitled"}" (${Array.isArray(v.items) ? v.items.length : 0} diagrams)`;
  },
  schema: composeArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof composeArgs>;
    const themeId = (args.theme ?? "premium-light").trim() || "premium-light";
    if (!STUDIO_THEMES.some((t) => t.id === themeId)) {
      return { ok: false, error: `Unknown theme "${themeId}". Valid: ${STUDIO_THEMES.map((t) => t.id).join(", ")}.` };
    }
    const inv = await inventory();
    const requested = args.items.map((i) => ({ kind: i.kind as StudioItemKind, name: i.name }));
    const { resolved, unresolved } = resolvePackItems(requested, inv);
    if (unresolved.length > 0) {
      return {
        ok: false,
        error: `Unmatched canvases: ${unresolved.map((u) => `${u.kind} "${u.name}"`).join("; ")}. Use dstudio_inventory for exact names.`,
      };
    }
    const pack = blankStudioProject(args.name.trim());
    pack.themeId = themeId;
    pack.items = resolved.map((r) => ({ id: newStudioId("item"), kind: r.kind, refId: r.refId, addedAt: Date.now() }));
    const saved = await saveDiagramStudio(pack);
    if (!saved) return { ok: false, error: "Pack composed but the browser store refused the save - retry." };
    return { ok: true, result: `Pack "${pack.name}" ready with ${resolved.length} diagram(s): ${resolved.map((r) => r.name).join(" → ")}.` };
  },
};

const themeArgs = z.object({
  pack: z.string().min(1).max(200).describe("Pack id or exact name"),
  theme: z.string().min(1).max(60).describe("Theme id"),
});

const themePack: AgentTool = {
  name: "dstudio_theme",
  description: "Switch a pack's export theme. Rejects unknown theme ids with the valid list.",
  parameters: {
    type: "object",
    properties: { pack: { type: "string" }, theme: { type: "string" } },
    required: ["pack", "theme"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => {
    const v = a as { theme?: string };
    return `Switch pack theme to ${v.theme ?? "?"}`;
  },
  schema: themeArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof themeArgs>;
    const themeId = args.theme.trim();
    if (!STUDIO_THEMES.some((t) => t.id === themeId)) {
      return { ok: false, error: `Unknown theme "${themeId}". Valid: ${STUDIO_THEMES.map((t) => t.id).join(", ")}.` };
    }
    const want = args.pack.trim().toLowerCase();
    const packs = await listDiagramStudios();
    const found = packs.find((p) => p.id === want || p.name.trim().toLowerCase() === want);
    if (!found) return { ok: false, error: `No studio pack "${args.pack}".` };
    const saved = await saveDiagramStudio({ ...found, themeId });
    if (!saved) return { ok: false, error: "Theme switch refused by the browser store - retry." };
    return { ok: true, result: `Pack "${found.name}" now uses ${studioTheme(themeId).name}.` };
  },
};

export const DIAGRAM_STUDIO_TOOLS: AgentTool[] = [listPacks, inventoryTool, describePack, composePack, themePack, ...SKETCH_TOOLS];
