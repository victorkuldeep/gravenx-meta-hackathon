import { z } from "zod";
import { canTransition as canTransitionDecision, DECISION_LINK_SURFACES, DECISION_STATUSES, newDecision, nextDecisionNumber } from "@/lib/decisions/model";
import { importDecisions } from "@/lib/decisions/store";
import type { Decision, DecisionLink } from "@/lib/decisions/model";
import { canTransition as canTransitionRequirement, newRequirement, nextRequirementNumber, REQUIREMENT_LINK_SURFACES } from "@/lib/requirements/model";
import { importRequirements } from "@/lib/requirements/store";
import type { Requirement, RequirementLink } from "@/lib/requirements/model";
import { newConsoleTask } from "@/lib/console/model";
import { importConsoleTasks } from "@/lib/console/store";
import type { ConsoleTask } from "@/lib/console/model";
import type { InboxItemKind } from "@/lib/inbox/types";
import { claimFile, listKind, writeJson } from "../workspace";
import type { McpTool } from "./types";

function decisionsIn(data: unknown): Decision[] {
  if (data && typeof data === "object" && "decisions" in data) {
    const arr = (data as { decisions: unknown }).decisions;
    return Array.isArray(arr) ? (arr as Decision[]) : [];
  }
  return [];
}

function requirementsIn(data: unknown): Requirement[] {
  if (data && typeof data === "object" && "requirements" in data) {
    const arr = (data as { requirements: unknown }).requirements;
    return Array.isArray(arr) ? (arr as Requirement[]) : [];
  }
  return [];
}

function tasksIn(data: unknown): ConsoleTask[] {
  if (data && typeof data === "object" && "tasks" in data) {
    const arr = (data as { tasks: unknown }).tasks;
    return Array.isArray(arr) ? (arr as ConsoleTask[]) : [];
  }
  return [];
}

function decisionPackage(d: Decision) {
  return {
    version: 1,
    type: "gravenx-decisions-package",
    exportedAt: new Date().toISOString(),
    decisions: [d],
  };
}

function requirementPackage(r: Requirement) {
  return {
    version: 1,
    type: "gravenx-requirements-package",
    exportedAt: new Date().toISOString(),
    requirements: [r],
  };
}

function consolePackage(t: ConsoleTask) {
  return {
    version: 2,
    type: "gravenx-console-package",
    exportedAt: new Date().toISOString(),
    tasks: [t],
    attachments: [],
  };
}

/** Locate one decision by number, id or title substring across files. */
function resolveDecision(dir: string, ref: string): { file: string; data: { decisions: Decision[] }; decision: Decision } {
  const q = ref.trim().toLowerCase();
  const matches: { file: string; data: { decisions: Decision[] }; decision: Decision }[] = [];
  for (const { file, data } of listKind(dir, "decision")) {
    for (const d of decisionsIn(data)) {
      if (d.number.toLowerCase() === q || d.id === ref || d.title.toLowerCase().includes(q)) {
        matches.push({ file, data: data as { decisions: Decision[] }, decision: d });
      }
    }
  }
  if (matches.length === 0) throw new Error(`No decision matches "${ref}".`);
  if (matches.length > 1) throw new Error(`Ambiguous ref "${ref}" - ${matches.length} matches. Use the exact number (ADR-001).`);
  return matches[0];
}

function resolveRequirement(dir: string, ref: string): { file: string; data: { requirements: Requirement[] }; requirement: Requirement } {
  const q = ref.trim().toLowerCase();
  const matches: { file: string; data: { requirements: Requirement[] }; requirement: Requirement }[] = [];
  for (const { file, data } of listKind(dir, "requirement")) {
    for (const r of requirementsIn(data)) {
      if (r.number.toLowerCase() === q || r.id === ref || r.title.toLowerCase().includes(q)) {
        matches.push({ file, data: data as { requirements: Requirement[] }, requirement: r });
      }
    }
  }
  if (matches.length === 0) throw new Error(`No requirement matches "${ref}".`);
  if (matches.length > 1) throw new Error(`Ambiguous ref "${ref}" - ${matches.length} matches. Use the exact number (REQ-001).`);
  return matches[0];
}

function allDecisions(dir: string): Decision[] {
  return listKind(dir, "decision").flatMap(({ data }) => decisionsIn(data));
}

function allRequirements(dir: string): Requirement[] {
  return listKind(dir, "requirement").flatMap(({ data }) => requirementsIn(data));
}

function stampHistory(what: string): { at: number; what: string } {
  return { at: Date.now(), what: what.slice(0, 300) };
}

export const governanceTools: McpTool[] = [
  {
    name: "decision_create",
    description:
      "Record an Architecture Decision (ADR) as a studio package file. Auto-numbers (ADR-001...). The Decisions Import button opens the file directly.",
    shape: {
      title: z.string().min(1).max(160),
      context: z.string().max(8000).optional(),
      decision: z.string().max(20000).optional(),
      consequences: z.string().max(8000).optional(),
      overwrite: z.boolean().optional(),
    },
    run: async (dir, args) => {
      const taken = listKind(dir, "decision").flatMap(({ data }) => decisionsIn(data));
      const number = nextDecisionNumber(taken);
      const d: Decision = {
        ...newDecision(args.title as string, number),
        ...(args.context ? { context: args.context as string } : {}),
        ...(args.decision ? { decision: args.decision as string } : {}),
        ...(args.consequences ? { consequences: args.consequences as string } : {}),
      };
      const check = importDecisions(JSON.stringify(decisionPackage(d)), taken);
      if (check.error || check.decisions.length === 0) {
        return {
          ok: false,
          summary: "Decision failed validation.",
          error: check.error ?? "Studio importer rejected the record.",
        };
      }
      const file = claimFile(dir, "decision", `${number} ${d.title}`, args.overwrite as boolean | undefined);
      writeJson(file, decisionPackage(d));
      return {
        ok: true,
        file,
        summary: `Decision ${number} saved - open it in Decisions via Import.`,
        data: { id: d.id, number, title: d.title },
      };
    },
  },
  {
    name: "decision_list",
    description: "List stored decisions (number, title, status).",
    shape: {},
    run: async (dir) => {
      const items = listKind(dir, "decision").flatMap(({ file, data }) =>
        decisionsIn(data).map((d) => ({
          file: file.split(/[\\/]/).pop(),
          number: d.number,
          title: d.title,
          status: d.status,
        })),
      );
      return { ok: true, summary: `${items.length} decision(s).`, data: { items } };
    },
  },
  {
    name: "requirement_create",
    description:
      "Record a requirement (REQ) as a studio package file. Auto-numbers (REQ-001...). The Requirements Import button opens the file directly.",
    shape: {
      title: z.string().min(1).max(160),
      body: z.string().max(20000).optional(),
      overwrite: z.boolean().optional(),
    },
    run: async (dir, args) => {
      const taken = listKind(dir, "requirement").flatMap(({ data }) => requirementsIn(data));
      const number = nextRequirementNumber(taken);
      const r: Requirement = {
        ...newRequirement(args.title as string, number),
        ...(args.body ? { body: args.body as string } : {}),
      };
      const check = importRequirements(JSON.stringify(requirementPackage(r)), taken);
      if (check.error || check.requirements.length === 0) {
        return {
          ok: false,
          summary: "Requirement failed validation.",
          error: check.error ?? "Studio importer rejected the record.",
        };
      }
      const file = claimFile(dir, "requirement", `${number} ${r.title}`, args.overwrite as boolean | undefined);
      writeJson(file, requirementPackage(r));
      return {
        ok: true,
        file,
        summary: `Requirement ${number} saved - open it in Requirements via Import.`,
        data: { id: r.id, number, title: r.title },
      };
    },
  },
  {
    name: "requirement_list",
    description: "List stored requirements (number, title, status).",
    shape: {},
    run: async (dir) => {
      const items = listKind(dir, "requirement").flatMap(({ file, data }) =>
        requirementsIn(data).map((r) => ({
          file: file.split(/[\\/]/).pop(),
          number: r.number,
          title: r.title,
          status: r.status,
        })),
      );
      return { ok: true, summary: `${items.length} requirement(s).`, data: { items } };
    },
  },
  {
    name: "console_create_task",
    description:
      "Log a Console task/note/question/decision as a studio package file. Surfaces in Console via Import, then syncs to canvases from there.",
    shape: {
      title: z.string().min(1).max(160),
      kind: z.enum(["note", "task", "question", "decision"]).optional(),
      status: z.enum(["open", "in-progress", "blocked", "awaiting-feedback", "resolved"]).optional(),
      priority: z.enum(["low", "normal", "high", "critical"]).optional(),
      owner: z.string().max(120).optional(),
      body: z.string().max(20000).optional(),
      overwrite: z.boolean().optional(),
    },
    run: async (dir, args) => {
      const t: ConsoleTask = {
        ...newConsoleTask(args.title as string),
        ...(args.kind ? { kind: args.kind as InboxItemKind } : {}),
        ...(args.status ? { status: args.status as ConsoleTask["status"] } : {}),
        ...(args.priority ? { priority: args.priority as ConsoleTask["priority"] } : {}),
        ...(args.owner ? { owner: args.owner as string } : {}),
        ...(args.body ? { body: args.body as string } : {}),
      };
      const check = importConsoleTasks(JSON.stringify(consolePackage(t)));
      if (check.error || check.tasks.length === 0) {
        return {
          ok: false,
          summary: "Task failed validation.",
          error: check.error ?? "Studio importer rejected the record.",
        };
      }
      const file = claimFile(dir, "console", t.title, args.overwrite as boolean | undefined);
      writeJson(file, consolePackage(t));
      return {
        ok: true,
        file,
        summary: `Task "${t.title}" saved - open it in Console via Import.`,
        data: { id: t.id, title: t.title },
      };
    },
  },
  {
    name: "console_list_tasks",
    description: "List stored console tasks (title, kind, status).",
    shape: {},
    run: async (dir) => {
      const items = listKind(dir, "console").flatMap(({ file, data }) =>
        tasksIn(data).map((t) => ({
          file: file.split(/[\\/]/).pop(),
          title: t.title,
          kind: t.kind ?? "task",
          status: t.status,
        })),
      );
      return { ok: true, summary: `${items.length} task(s).`, data: { items } };
    },
  },
  {
    name: "decision_update",
    description:
      "Update a decision: move status along the legal trail (proposed->in-review->accepted, accepted->deprecated/superseded), or revise the text. History is appended, never rewritten.",
    shape: {
      ref: z.string().min(1).describe("Decision number (ADR-001), id, or title"),
      status: z.enum(["proposed", "in-review", "accepted", "deprecated", "superseded"]).optional(),
      decision: z.string().max(20000).optional(),
      context: z.string().max(8000).optional(),
      consequences: z.string().max(8000).optional(),
    },
    run: async (dir, args) => {
      const { file, data, decision } = resolveDecision(dir, args.ref as string);
      const patch = args as { status?: Decision["status"]; decision?: string; context?: string; consequences?: string };
      if (patch.status && patch.status !== decision.status && !canTransitionDecision(decision.status, patch.status)) {
        return {
          ok: false,
          summary: "Illegal transition.",
          error: `${decision.number} is ${decision.status} - cannot move to ${patch.status}. Legal: proposed->in-review->accepted, accepted->deprecated/superseded.`,
        };
      }
      const updated: Decision = {
        ...decision,
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.decision !== undefined ? { decision: patch.decision } : {}),
        ...(patch.context !== undefined ? { context: patch.context } : {}),
        ...(patch.consequences !== undefined ? { consequences: patch.consequences } : {}),
        history: [...decision.history, stampHistory(`Updated via MCP${patch.status ? `: status -> ${patch.status}` : ""}.`)],
        updatedAt: Date.now(),
      };
      const others = allDecisions(dir).filter((d) => d.id !== decision.id);
      const check = importDecisions(JSON.stringify({ ...data, decisions: data.decisions.map((d) => (d.id === decision.id ? updated : d)) }), others);
      if (check.error) return { ok: false, summary: "Update failed validation.", error: check.error };
      writeJson(file, { ...data, decisions: data.decisions.map((d) => (d.id === decision.id ? updated : d)), exportedAt: new Date().toISOString() });
      return { ok: true, file, summary: `${updated.number} updated (${updated.status}).`, data: { number: updated.number, status: updated.status } };
    },
  },
  {
    name: "decision_link",
    description: "Link a decision to the architecture it governs (system, wireframe, sequence, draw, schema). Links are addresses, shown in reviews and traceability.",
    shape: {
      ref: z.string().min(1).describe("Decision number (ADR-001), id, or title"),
      surface: z.enum(["system", "wireframe", "sequence", "draw", "schema"]),
      recordId: z.string().min(1).max(160).describe("Owning record id (e.g. system project id)"),
      label: z.string().min(1).max(200),
    },
    run: async (dir, args) => {
      const a = args as { ref: string; surface: DecisionLink["surface"]; recordId: string; label: string };
      if (!DECISION_LINK_SURFACES.includes(a.surface)) {
        return { ok: false, summary: "Bad surface.", error: `Surface must be one of ${DECISION_LINK_SURFACES.join(", ")}.` };
      }
      const { file, data, decision } = resolveDecision(dir, a.ref);
      if (decision.links.some((l) => l.surface === a.surface && l.recordId === a.recordId)) {
        return { ok: true, file, summary: "Already linked - nothing added.", data: { links: decision.links.length } };
      }
      const updated: Decision = {
        ...decision,
        links: [...decision.links, { surface: a.surface, recordId: a.recordId, label: a.label }],
        history: [...decision.history, stampHistory(`Linked to ${a.surface}:${a.label}.`)],
        updatedAt: Date.now(),
      };
      const others = allDecisions(dir).filter((d) => d.id !== decision.id);
      const check = importDecisions(JSON.stringify({ ...data, decisions: data.decisions.map((d) => (d.id === decision.id ? updated : d)) }), others);
      if (check.error) return { ok: false, summary: "Link failed validation.", error: check.error };
      writeJson(file, { ...data, decisions: data.decisions.map((d) => (d.id === decision.id ? updated : d)), exportedAt: new Date().toISOString() });
      return { ok: true, file, summary: `${decision.number} linked to ${a.surface}:${a.label}.`, data: { links: updated.links.length } };
    },
  },
  {
    name: "decision_summarize",
    description: "Digest of all decisions: counts by status, open items needing review, and what each accepted decision governs. Feed it to reviews.",
    shape: {},
    run: async (dir) => {
      const all = allDecisions(dir);
      const counts: Record<string, number> = {};
      for (const d of all) counts[d.status] = (counts[d.status] ?? 0) + 1;
      const open = all.filter((d) => d.status === "proposed" || d.status === "in-review");
      const lines = [
        `# Decision digest - ${all.length} total`,
        ``,
        ...DECISION_STATUSES.map((s) => `- ${s}: ${counts[s] ?? 0}`),
        ``,
        `## Needs review (${open.length})`,
      ];
      for (const d of open) lines.push(`- ${d.number}: ${d.title} [${d.status}]`);
      lines.push(``, `## Accepted governance`);
      for (const d of all.filter((x) => x.status === "accepted")) {
        const gov = d.links.length > 0 ? d.links.map((l) => `${l.surface}:${l.label}`).join(", ") : "no links yet";
        lines.push(`- ${d.number}: ${d.title} -> ${gov}`);
      }
      return { ok: true, summary: `${all.length} decision(s), ${open.length} open.`, data: { markdown: lines.join("\n"), counts, open: open.map((d) => d.number) } };
    },
  },
  {
    name: "requirement_update",
    description: "Move a requirement along its trail (open->covered->verified) or revise the body. History is appended.",
    shape: {
      ref: z.string().min(1).describe("Requirement number (REQ-001), id, or title"),
      status: z.enum(["open", "covered", "verified"]).optional(),
      body: z.string().max(8000).optional(),
    },
    run: async (dir, args) => {
      const { file, data, requirement } = resolveRequirement(dir, args.ref as string);
      const patch = args as { status?: Requirement["status"]; body?: string };
      if (patch.status && patch.status !== requirement.status && !canTransitionRequirement(requirement.status, patch.status)) {
        return {
          ok: false,
          summary: "Illegal transition.",
          error: `${requirement.number} is ${requirement.status} - cannot move to ${patch.status}. Legal: open->covered->verified.`,
        };
      }
      const updated: Requirement = {
        ...requirement,
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        history: [...requirement.history, stampHistory(`Updated via MCP${patch.status ? `: status -> ${patch.status}` : ""}.`)],
        updatedAt: Date.now(),
      };
      const others = allRequirements(dir).filter((r) => r.id !== requirement.id);
      const check = importRequirements(JSON.stringify({ ...data, requirements: data.requirements.map((r) => (r.id === requirement.id ? updated : r)) }), others);
      if (check.error) return { ok: false, summary: "Update failed validation.", error: check.error };
      writeJson(file, { ...data, requirements: data.requirements.map((r) => (r.id === requirement.id ? updated : r)), exportedAt: new Date().toISOString() });
      return { ok: true, file, summary: `${updated.number} updated (${updated.status}).`, data: { number: updated.number, status: updated.status } };
    },
  },
  {
    name: "requirement_link",
    description: "Link a requirement to its coverage (system, wireframe, sequence, draw, schema, or a decision). Unlinked requirements surface in reviews.",
    shape: {
      ref: z.string().min(1).describe("Requirement number (REQ-001), id, or title"),
      surface: z.enum(["system", "wireframe", "sequence", "draw", "schema", "decision"]),
      recordId: z.string().min(1).max(160),
      label: z.string().min(1).max(200),
    },
    run: async (dir, args) => {
      const a = args as { ref: string; surface: RequirementLink["surface"]; recordId: string; label: string };
      if (!REQUIREMENT_LINK_SURFACES.includes(a.surface)) {
        return { ok: false, summary: "Bad surface.", error: `Surface must be one of ${REQUIREMENT_LINK_SURFACES.join(", ")}.` };
      }
      const { file, data, requirement } = resolveRequirement(dir, a.ref);
      if (requirement.links.some((l) => l.surface === a.surface && l.recordId === a.recordId)) {
        return { ok: true, file, summary: "Already linked - nothing added.", data: { links: requirement.links.length } };
      }
      const updated: Requirement = {
        ...requirement,
        links: [...requirement.links, { surface: a.surface, recordId: a.recordId, label: a.label } as RequirementLink],
        history: [...requirement.history, stampHistory(`Linked to ${a.surface}:${a.label}.`)],
        updatedAt: Date.now(),
      };
      const others = allRequirements(dir).filter((r) => r.id !== requirement.id);
      const check = importRequirements(JSON.stringify({ ...data, requirements: data.requirements.map((r) => (r.id === requirement.id ? updated : r)) }), others);
      if (check.error) return { ok: false, summary: "Link failed validation.", error: check.error };
      writeJson(file, { ...data, requirements: data.requirements.map((r) => (r.id === requirement.id ? updated : r)), exportedAt: new Date().toISOString() });
      return { ok: true, file, summary: `${requirement.number} linked to ${a.surface}:${a.label}.`, data: { links: updated.links.length } };
    },
  },
  {
    name: "jira_draft",
    description: "Draft a JIRA-ready story from open decisions, open requirements, and optionally a mapping project's open items. Saved as a note file; paste into JIRA.",
    shape: {
      title: z.string().min(1).max(160),
      mappingRef: z.string().max(200).optional().describe("Mapping filename or project name to pull open decisions/rules from"),
      overwrite: z.boolean().optional(),
    },
    run: async (dir, args) => {
      const a = args as { title: string; mappingRef?: string; overwrite?: boolean };
      const openDec = allDecisions(dir).filter((d) => d.status === "proposed" || d.status === "in-review");
      const openReq = allRequirements(dir).filter((r) => r.status === "open");
      const lines = [`# ${a.title}`, ``, `## Context`];
      for (const d of openDec) lines.push(`- ${d.number} ${d.title}: ${d.decision || d.context}`.slice(0, 300));
      if (openDec.length === 0) lines.push(`- (no open decisions)`);
      lines.push(``, `## Requirements in scope`);
      for (const r of openReq) lines.push(`- ${r.number} ${r.title}`);
      if (openReq.length === 0) lines.push(`- (no open requirements)`);
      if (a.mappingRef) {
        const hits = listKind(dir, "mapping");
        const q = a.mappingRef.trim().toLowerCase();
        const hit = hits.find(({ file, data }) => {
          const d = data as { project?: { name?: string; id?: string } };
          const name = d.project && typeof d.project === "object" ? d.project.name : (data as { name?: string }).name;
          return file.toLowerCase().includes(q) || (name ?? "").toLowerCase().includes(q);
        });
        if (hit) {
          const p = (hit.data as { project?: unknown }).project ?? hit.data;
          const proj = p as { recordPlans?: { name: string; objectName: string; intent: string }[]; mappings?: { sourcePath: string; objectName: string; fieldName: string; status: string }[]; decisions?: { title: string; status: string }[] };
          lines.push(``, `## Mapping scope`);
          for (const pl of proj.recordPlans ?? []) lines.push(`- Plan: ${pl.intent.toUpperCase()} ${pl.objectName} (${pl.name})`);
          const uncovered = (proj.mappings ?? []).filter((m) => m.status === "unmapped" || m.status === "needs-decision" || m.status === "invalid");
          for (const m of uncovered.slice(0, 20)) lines.push(`- [ ] Map ${m.sourcePath} -> ${m.objectName}.${m.fieldName || "(no field)"} [${m.status}]`);
          for (const d of (proj.decisions ?? []).filter((x) => x.status === "open")) lines.push(`- [ ] Decide: ${d.title}`);
        } else {
          lines.push(``, `(mapping ref "${a.mappingRef}" not found - skipped)`);
        }
      }
      lines.push(``, `## Acceptance criteria`, `- [ ] All items above are mapped, decided, or explicitly deferred`, `- [ ] Studio import of every touched file passes validation`);
      const markdown = lines.join("\n");
      const file = claimFile(dir, "note", `JIRA - ${a.title}`, a.overwrite);
      writeJson(file, {
        format: "gravenx-note",
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        note: { id: `note_${Date.now().toString(36)}`, title: `JIRA - ${a.title}`, body: markdown, status: "open", createdAt: Date.now(), updatedAt: Date.now() },
      });
      return { ok: true, file, summary: `JIRA draft saved (${openDec.length} open decision(s), ${openReq.length} open requirement(s)).`, data: { markdown } };
    },
  },
  {
    name: "workspace_files",
    description: "List every file in the GRAVENX workspace with its envelope type (what the studio can import).",
    shape: {},
    run: async (dir) => {
      const kinds = ["sequence", "experience", "system", "erd", "decision", "requirement", "console", "mapping", "composite", "payload", "contract", "note"];
      const items = kinds.flatMap((kind) =>
        listKind(dir, kind).map(({ file }) => ({
          file: file.split(/[\\/]/).pop(),
          kind,
        })),
      );
      return { ok: true, summary: `${items.length} file(s) in workspace.`, data: { dir, items } };
    },
  },
];
