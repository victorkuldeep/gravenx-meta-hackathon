import { z } from "zod";
import { exportProject, importProject, type SystemProject } from "@/lib/system-design/model";
import {
  buildCdcSyncProject,
  buildDemoProject,
  buildGroqSampleProject,
  buildOrderFanoutProject,
  buildRevenueCloudProject,
  buildRetryFallbackProject,
  buildTmfSampleProject,
} from "@/lib/system-design/demo";
import { claimFile, findRecords, listKind, readJson, writeJson } from "../workspace";
import type { McpTool } from "./types";

const SAMPLES: Record<string, () => SystemProject> = {
  demo: buildDemoProject,
  tmf: buildTmfSampleProject,
  groq: buildGroqSampleProject,
  fanout: buildOrderFanoutProject,
  revenue: buildRevenueCloudProject,
  cdc: buildCdcSyncProject,
  retry: buildRetryFallbackProject,
};

function rawProject(data: unknown): { id?: string; name?: string } {
  const candidate =
    data && typeof data === "object" && "project" in data
      ? (data as { project: unknown }).project
      : data;
  return (candidate ?? {}) as { id?: string; name?: string };
}

/**
 * Identity comes from the stored JSON - importProject re-ids on every load.
 * Validation takes the full export envelope (kind/version/project).
 */
function asProject(data: unknown): SystemProject | null {
  const r = importProject(data);
  return r.project;
}

function matchProject(data: unknown) {
  const p = rawProject(data);
  if (typeof p.id !== "string") return null;
  return { id: p.id, name: p.name };
}

function loadProject(dir: string, ref: string): { file: string; project: SystemProject } {
  const hits = findRecords(dir, "system", ref, matchProject);
  if (hits.length === 0) {
    throw new Error(`No system project matches "${ref}" - create a sample first or check the filename.`);
  }
  if (hits.length > 1) {
    throw new Error(`Ambiguous ref "${ref}" - ${hits.length} matches. Use the exact filename.`);
  }
  const storedId = rawProject(hits[0].data).id;
  const project = asProject(hits[0].data);
  if (!project || typeof storedId !== "string") {
    throw new Error(`File is not a valid system project: ${hits[0].file}`);
  }
  // Restore the stored identity: importProject re-ids, but agents address
  // the file's own id (and the studio shows the same file on import).
  return { file: hits[0].file, project: { ...project, id: storedId } };
}

function summarize(project: SystemProject) {
  return {
    id: project.id,
    name: project.name,
    systems: project.systems.map((s) => s.name),
    connections: project.connections.length,
    operations: project.operations.length,
    flows: project.flows.map((f) => f.name),
    scenarios: project.scenarios.map((s) => s.name),
    environments: project.environments.map((e) => e.name),
  };
}

export const systemTools: McpTool[] = [
  {
    name: "system_create_sample",
    description:
      "Create a runnable system topology from a studio sample (demo lead-triage, TMF order flow, fan-out, retry pattern, CDC sync, Revenue Cloud, GROQ chat). The studio Import button opens the file directly.",
    shape: {
      sample: z.enum(["demo", "tmf", "groq", "fanout", "revenue", "cdc", "retry"]),
      overwrite: z.boolean().optional(),
    },
    run: async (dir, args) => {
      const build = SAMPLES[args.sample as string];
      if (!build) throw new Error(`Unknown sample "${args.sample as string}".`);
      const project = build();
      const file = claimFile(dir, "system", project.name, args.overwrite as boolean | undefined);
      writeJson(file, exportProject(project));
      return {
        ok: true,
        file,
        summary: `System project "${project.name}" saved - open it in System Design via Import.`,
        data: { id: project.id, name: project.name },
      };
    },
  },
  {
    name: "system_validate",
    description: "Validate a stored system project the same way studio import does (issues, not exceptions).",
    shape: { ref: z.string().min(1).describe("Project filename, id, or name substring") },
    run: async (dir, args) => {
      const { file } = loadProject(dir, args.ref as string);
      const { project, issues } = importProject(readJson(file));
      if (!project) {
        return {
          ok: false,
          file,
          summary: "Invalid system project.",
          error: issues.slice(0, 8).map((i) => `${i.path}: ${i.message}`).join(" "),
        };
      }
      return {
        ok: true,
        file,
        summary: `Valid: ${project.systems.length} system(s), ${project.connections.length} connection(s).`,
        data: summarize(project),
      };
    },
  },
  {
    name: "system_summarize",
    description: "Inventory a stored system project: systems, connections, operations, flows, scenarios, environments.",
    shape: { ref: z.string().min(1).describe("Project filename, id, or name substring") },
    run: async (dir, args) => {
      const { file, project } = loadProject(dir, args.ref as string);
      return { ok: true, file, summary: `Project "${project.name}" inventoried.`, data: summarize(project) };
    },
  },
  {
    name: "system_list",
    description: "List stored system projects with system counts.",
    shape: {},
    run: async (dir) => {
      const items = listKind(dir, "system").map(({ file, data }) => {
        const p = asProject(data);
        return {
          file: file.split(/[\\/]/).pop(),
          name: p?.name ?? "(unreadable)",
          systems: p?.systems.length ?? 0,
        };
      });
      return { ok: true, summary: `${items.length} project(s).`, data: { items } };
    },
  },
];
