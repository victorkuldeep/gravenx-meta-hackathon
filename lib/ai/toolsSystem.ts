import { z } from "zod";
import {
  newId,
  newSystemFromTemplate,
  SYSTEM_TEMPLATES,
  type SystemProject,
} from "@/lib/system-design/model";
import { getSystemBridge } from "./systemBridge";
import { JSON_TOOLS, STUDIO_TOOLS } from "./toolsStudio";
import { SALESFORCE_TOOLS } from "./toolsSalesforce";
import { buildDefaultPolicy, setPolicyDefaults, skillEnabled, toolEnabled } from "@/lib/setup/policy";
import { WIREFRAME_TOOLS } from "./toolsWireframe";
import { SEQUENCE_TOOLS } from "./toolsSequence";
import { DIAGRAM_STUDIO_TOOLS } from "./toolsDiagramStudio";
import { DRAW_TOOLS } from "./toolsDraw";
import { CONSOLE_TOOLS } from "./toolsConsole";
import { PMO_TOOLS } from "./toolsPmo";
import { GRAPH_TOOLS } from "./toolsGraph";
import { DECISION_TOOLS } from "./toolsDecisions";
import { REQUIREMENT_TOOLS } from "./toolsRequirements";
import { RISK_TOOLS } from "./toolsRisks";
import { VALIDATION_TOOLS } from "./toolsValidation";
import { DEBUG_TOOLS } from "./logDecomposerTools";
import type { AgentTool } from "./tools";

/**
 * System-tab tool pack: reads run free, mutations need panel approval.
 * Every mutation goes through the canvas bridge (mutate path), so undo,
 * dirty-dot and autosave keep working exactly as if the human acted.
 */

const noArgs = z.object({});

const addSystemArgs = z.object({
  type: z.string().min(1).describe("Template type id (salesforce, middleware, queue, …) or 'custom'"),
  name: z.string().max(80).optional().describe("Display name - defaults to the template name"),
  x: z.number().optional().describe("Canvas x - defaults to a free spot"),
  y: z.number().optional().describe("Canvas y - defaults to a free spot"),
});

const connectArgs = z.object({
  from: z.string().min(1).describe("Source system name or id"),
  to: z.string().min(1).describe("Target system name or id"),
  label: z.string().max(120).optional().describe("Edge label, e.g. order POST"),
});

function needCanvas() {
  const bridge = getSystemBridge();
  const snap = bridge?.getSnapshot() ?? null;
  if (!bridge || !snap) return { bridge: null, snap: null };
  return { bridge, snap };
}

function matchSystem(project: SystemProject, ref: string) {
  const q = ref.trim().toLowerCase();
  return (
    project.systems.find((s) => s.id === ref) ??
    project.systems.find((s) => s.name.toLowerCase() === q) ??
    null
  );
}

const describeCanvas: AgentTool = {
  name: "system_describe",
  description: "Summarize the current canvas: project name, systems with positions, connections, and counts of interfaces, operations, flows and scenarios.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "Read canvas summary",
  schema: noArgs,
  execute: async () => {
    const { snap } = needCanvas();
    if (!snap) return { ok: false, error: "No System canvas is open - ask the user to open the System tab first." };
    return { ok: true, result: snap };
  },
};

const addSystem: AgentTool = {
  name: "system_add",
  description: "Add a system node from a template (salesforce, middleware, queue, database, rest, graphql, webapp, servicenow, custom). Position defaults to a free spot right of the canvas.",
  parameters: {
    type: "object",
    properties: {
      type: { type: "string", description: "Template type id or 'custom'" },
      name: { type: "string", description: "Display name" },
      x: { type: "number" },
      y: { type: "number" },
    },
    required: ["type"],
    additionalProperties: false,
  },
  needsApproval: true,
  undoable: true,
  label: (a) => {
    const v = a as { type?: string; name?: string };
    return `Add ${v.name ?? v.type ?? "system"}`;
  },
  schema: addSystemArgs,
  execute: async (raw) => {
    const { bridge } = needCanvas();
    if (!bridge) return { ok: false, error: "No System canvas is open." };
    const args = raw as z.infer<typeof addSystemArgs>;
    const t = SYSTEM_TEMPLATES.find((k) => k.systemType === args.type.toLowerCase()) ??
      SYSTEM_TEMPLATES.find((k) => k.systemType === "custom")!;
    let done = "";
    const r = bridge.apply(
      (p) => {
        const occupied = p.systems.map((s) => s.position);
        const x = args.x ?? (occupied.length === 0 ? 120 : Math.max(...occupied.map((o) => o.x)) + 260);
        const y = args.y ?? 160;
        const node = newSystemFromTemplate(t, { x, y }, p.systems.length + 1);
        if (args.name?.trim()) node.name = args.name.trim().slice(0, 80);
        done = `${node.name} (${node.id})`;
        return { ...p, systems: [...p.systems, node], updatedAt: Date.now() };
      },
      `AI: add system ${args.name ?? args.type}`,
    );
    if (!r.ok) return { ok: false, error: r.error ?? "Apply failed." };
    return { ok: true, result: `Added ${done}.` };
  },
};

const connectSystems: AgentTool = {
  name: "system_connect",
  description: "Draw a connection edge between two systems by name or id. Creates a draft edge; operation binding stays manual in the canvas.",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string" },
      to: { type: "string" },
      label: { type: "string" },
    },
    required: ["from", "to"],
    additionalProperties: false,
  },
  needsApproval: true,
  undoable: true,
  label: (a) => {
    const v = a as { from?: string; to?: string };
    return `Connect ${v.from ?? "?"} → ${v.to ?? "?"}`;
  },
  schema: connectArgs,
  execute: async (raw) => {
    const { bridge } = needCanvas();
    if (!bridge) return { ok: false, error: "No System canvas is open." };
    const args = raw as z.infer<typeof connectArgs>;
    let done = "";
    let failure: string | null = null;
    const r = bridge.apply(
      (p) => {
        const from = matchSystem(p, args.from);
        const to = matchSystem(p, args.to);
        if (!from || !to) {
          failure = `Could not find ${!from ? `"${args.from}"` : ""}${!from && !to ? " and " : ""}${!to ? `"${args.to}"` : ""} on the canvas.`;
          return p;
        }
        if (from.id === to.id) {
          failure = "A system cannot connect to itself.";
          return p;
        }
        const dup = p.connections.some(
          (c) => (c.sourceId === from.id && c.targetId === to.id) || (c.sourceId === to.id && c.targetId === from.id),
        );
        if (dup) {
          failure = `${from.name} and ${to.name} are already connected.`;
          return p;
        }
        const edge = {
          id: newId("conn"),
          sourceId: from.id,
          targetId: to.id,
          label: (args.label ?? `${from.name} → ${to.name}`).slice(0, 120),
          status: "draft" as const,
        };
        done = `${from.name} → ${to.name}`;
        return { ...p, connections: [...p.connections, edge], updatedAt: Date.now() };
      },
      `AI: connect ${args.from} to ${args.to}`,
    );
    if (!r.ok) return { ok: false, error: r.error ?? "Apply failed." };
    if (failure) return { ok: false, error: failure };
    return { ok: true, result: `Connected ${done}.` };
  },
};

export const SYSTEM_TOOLS: AgentTool[] = [describeCanvas, addSystem, connectSystems, ...RISK_TOOLS, ...VALIDATION_TOOLS];

/**
 * Tool set for the active route. System, Wireframe, Sequence and Draw get
 * live canvas packs; studio home and JSON get headless read-only packs.
 * Mapping, Validate, Architect and Contracts stay in advisor mode
 * until their bridges exist.
 */
/**
 * Tool inventory for the Control Plane: every skill with the tools the
 * model may call. The policy store derives its defaults from this, so
 * adding a tool here automatically surfaces it in Setup - no second list.
 */
export function policyInventory(): { skill: string; tools: { name: string; needsApproval: boolean; description: string; schema: unknown }[] }[] {
  const packs: [string, AgentTool[]][] = [
    ["system", SYSTEM_TOOLS],
    ["studio", [...STUDIO_TOOLS, ...SALESFORCE_TOOLS]],
    ["json", JSON_TOOLS],
    ["wireframe", WIREFRAME_TOOLS],
    ["sequence", SEQUENCE_TOOLS],
    ["diagram-studio", DIAGRAM_STUDIO_TOOLS],
    ["draw", DRAW_TOOLS],
    ["console", [...CONSOLE_TOOLS, ...PMO_TOOLS]],
    ["knowledge", GRAPH_TOOLS],
    ["decisions", DECISION_TOOLS],
    ["requirements", REQUIREMENT_TOOLS],
    ["debug", DEBUG_TOOLS],
  ];
  return packs.map(([skill, tools]) => ({
    skill,
    tools: tools.map((t) => ({ name: t.name, needsApproval: t.needsApproval, description: t.description, schema: t.parameters })),
  }));
}

let policyBooted = false;

/** Register code defaults once - Setup edits layer on top from localStorage. */
function bootPolicy(): void {
  if (policyBooted) return;
  policyBooted = true;
  try {
    setPolicyDefaults(buildDefaultPolicy(policyInventory()));
  } catch {
    /* policy store degrades to code defaults */
  }
}

export function toolsForSkill(skillName: string): AgentTool[] {
  bootPolicy();
  if (!skillEnabled(skillName)) return [];
  const pick = (tools: AgentTool[]): AgentTool[] => tools.filter((t) => toolEnabled(skillName, t.name));
  if (skillName === "system") return pick(SYSTEM_TOOLS);
  if (skillName === "studio") return pick([...STUDIO_TOOLS, ...SALESFORCE_TOOLS]);
  if (skillName === "json") return pick(JSON_TOOLS);
  if (skillName === "wireframe") return pick(WIREFRAME_TOOLS);
  if (skillName === "sequence") return pick(SEQUENCE_TOOLS);
  if (skillName === "diagram-studio") return pick(DIAGRAM_STUDIO_TOOLS);
  if (skillName === "draw") return pick(DRAW_TOOLS);
  if (skillName === "console") return pick([...CONSOLE_TOOLS, ...PMO_TOOLS]);
  if (skillName === "knowledge") return pick(GRAPH_TOOLS);
  if (skillName === "decisions") return pick(DECISION_TOOLS);
  if (skillName === "requirements") return pick(REQUIREMENT_TOOLS);
  if (skillName === "debug") return pick(DEBUG_TOOLS);
  return [];
}
