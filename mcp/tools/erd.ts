import { z } from "zod";
import {
  SHARE_LINK_VERSION,
  validateShareStructure,
  type ShareStructure,
} from "@/lib/erd/shareLink";
import { claimFile, findRecords, listKind, writeJson } from "../workspace";
import type { McpTool } from "./types";

function asStructure(data: unknown): ShareStructure | null {
  return validateShareStructure(data);
}

function matchStructure(data: unknown) {
  const s = asStructure(data);
  if (!s) return null;
  return { id: s.name, name: s.name };
}

function loadStructure(dir: string, ref: string): { file: string; structure: ShareStructure } {
  const hits = findRecords(dir, "erd", ref, matchStructure);
  if (hits.length === 0) {
    throw new Error(`No ERD canvas matches "${ref}" - create one first or check the filename.`);
  }
  if (hits.length > 1) {
    throw new Error(`Ambiguous ref "${ref}" - ${hits.length} matches. Use the exact filename.`);
  }
  const structure = asStructure(hits[0].data);
  if (!structure) throw new Error(`File is not a valid ERD structure: ${hits[0].file}`);
  return { file: hits[0].file, structure };
}

/** Deterministic grid layout so headless canvases open readably. */
function gridPositions(nodes: string[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const perRow = 5;
  nodes.forEach((n, i) => {
    positions[n] = { x: 80 + (i % perRow) * 360, y: 80 + Math.floor(i / perRow) * 320 };
  });
  return positions;
}

export const erdTools: McpTool[] = [
  {
    name: "erd_create_canvas",
    description:
      "Create an ERD structure file: object api names plus an optional root focus. Positions auto-grid; open in Schema via share (erd_share_canvas) or the link flow.",
    shape: {
      name: z.string().min(1).max(200),
      root: z.string().min(1).max(255),
      nodes: z.array(z.string().min(1).max(255)).min(1).max(200),
      overwrite: z.boolean().optional(),
    },
    run: async (dir, args) => {
      const nodes = args.nodes as string[];
      const structure: ShareStructure = {
        v: SHARE_LINK_VERSION,
        name: (args.name as string).slice(0, 200),
        root: args.root as string,
        nodes,
        positions: gridPositions(nodes),
        view: "erd",
      };
      const valid = validateShareStructure(structure);
      if (!valid) throw new Error("Built structure failed validation - check node names.");
      const file = claimFile(dir, "erd", structure.name, args.overwrite as boolean | undefined);
      writeJson(file, valid);
      return {
        ok: true,
        file,
        summary: `ERD canvas "${structure.name}" saved (${nodes.length} object(s)) - share it with erd_share_canvas.`,
        data: { name: structure.name, nodes: nodes.length },
      };
    },
  },
  {
    name: "erd_validate",
    description: "Validate a stored ERD structure the same way the share backend does.",
    shape: { ref: z.string().min(1).describe("Canvas filename or name substring") },
    run: async (dir, args) => {
      const { file, structure } = loadStructure(dir, args.ref as string);
      return {
        ok: true,
        file,
        summary: `Valid: ${structure.nodes.length} node(s), root ${structure.root}.`,
      };
    },
  },
  {
    name: "erd_share_canvas",
    description:
      "Publish a stored ERD canvas through the GRAVENX share backend and return the 30-minute link. Needs the studio running: set GRAVENX_BASE_URL (default http://localhost:3000). Structure only - no field data, no tokens.",
    shape: { ref: z.string().min(1).describe("Canvas filename or name substring") },
    run: async (dir, args) => {
      const { file, structure } = loadStructure(dir, args.ref as string);
      const base = (process.env.GRAVENX_BASE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
      let res: Response;
      try {
        res = await fetch(`${base}/api/share`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(structure),
        });
      } catch {
        return {
          ok: false,
          file,
          summary: "Share backend unreachable.",
          error: `Could not reach ${base} - run the studio (npm run dev) or set GRAVENX_BASE_URL. The canvas file is still saved.`,
        };
      }
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !data?.id) {
        return {
          ok: false,
          file,
          summary: "Share backend refused the canvas.",
          error: typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
        };
      }
      return {
        ok: true,
        file,
        summary: "Share link created - expires in 30 minutes.",
        data: { link: `${base}/?share=${data.id}` },
      };
    },
  },
  {
    name: "erd_list",
    description: "List stored ERD canvases with node counts.",
    shape: {},
    run: async (dir) => {
      const items = listKind(dir, "erd").map(({ file, data }) => {
        const s = asStructure(data);
        return {
          file: file.split(/[\\/]/).pop(),
          name: s?.name ?? "(unreadable)",
          nodes: s?.nodes.length ?? 0,
        };
      });
      return { ok: true, summary: `${items.length} canvas(es).`, data: { items } };
    },
  },
];
