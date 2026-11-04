import { htmlToText } from "@/lib/decisions/richtext";
import type { SystemProject } from "@/lib/system-design/model";
import type { SequenceDocument } from "@/lib/sequence/model";
import type { Decision } from "@/lib/decisions/model";
import type { Requirement } from "@/lib/requirements/model";
import type { SystemRunRecord } from "@/lib/system-design/runStore";
import { analyzeProject, sequencesForProject } from "@/lib/risks/rules";
import { findingKey, proveFindings } from "@/lib/risks/proof";
import { coverageSummary } from "@/lib/requirements/coverage";
import { buildIndex } from "@/lib/graph/index";
import { printStatements } from "@/lib/sequence/dsl";

/**
 * Architecture Pack (Epic 6) - one-click stakeholder bundle for a System
 * project. Markdown narrative plus a JSON manifest, both generated from
 * live records: topology, policy, touching sequences (as DSL), linked
 * decisions and requirements (with derived coverage), risk findings,
 * and the Validation section (scenarios with verdicts, findings with
 * derived proof states). Wireframe experiences and Draw boards are not
 * project-linked, so the pack says so instead of guessing.
 */

export interface PackInput {
  project: SystemProject;
  sequences: SequenceDocument[];
  decisions: Decision[];
  requirements: Requirement[];
  /** Pinned run evidence for the Validation section - absent reads as none. */
  runs?: SystemRunRecord[];
}

function linked<T extends { links: { surface: string; recordId: string }[] }>(items: T[], projectId: string): T[] {
  return items.filter((i) => i.links.some((l) => l.surface === "system" && l.recordId === projectId));
}

export function buildPackMarkdown(input: PackInput): string {
  const { project: p } = input;
  const seqs = sequencesForProject(p, input.sequences);
  const decs = linked(input.decisions, p.id);
  const reqs = linked(input.requirements, p.id);
  const risks = analyzeProject(p, seqs);
  const index = buildIndex({ systems: [p], sequences: seqs, decisions: decs, requirements: reqs });
  const cov = coverageSummary(index, reqs);
  const L: string[] = [];
  L.push(`# Architecture Pack - ${p.name}`, "");
  L.push(`Generated ${new Date().toISOString()} from live GRAVENX records.`, "");

  L.push("## Systems", "");
  for (const s of p.systems) {
    L.push(`### ${s.name} (${s.systemType})`);
    if (s.description) L.push(s.description);
    if (s.baseUrl) L.push(`Base URL: ${s.baseUrl}`);
    L.push("");
  }

  L.push("## Interfaces & operations", "");
  for (const i of p.interfaces) {
    const sys = p.systems.find((s) => s.id === i.systemId)?.name ?? i.systemId;
    L.push(`### ${i.name} [${i.protocol}] on ${sys}`);
    for (const op of p.operations.filter((o) => o.interfaceId === i.id)) {
      const policy = op.policy
        ? `timeout ${op.policy.timeoutSecs ?? "-"}s, retries ${op.policy.retryAttempts ?? "-"}, idempotent ${op.policy.idempotency === true ? "yes" : "unstated"}`
        : "policy unstated";
      L.push(`- ${op.method} ${op.path} (v${op.version || "unversioned"}) - ${policy}`);
    }
    L.push("");
  }

  L.push("## Connections", "");
  for (const c of p.connections) {
    const from = p.systems.find((s) => s.id === c.sourceId)?.name ?? c.sourceId;
    const to = p.systems.find((s) => s.id === c.targetId)?.name ?? c.targetId;
    L.push(`- ${from} → ${to}${c.label ? `: ${c.label}` : ""} [${c.status}]`);
  }
  L.push("");

  L.push("## Sequences", "");
  if (seqs.length === 0) L.push("No sequences touch this project.", "");
  for (const q of seqs) {
    L.push(`### ${q.name}`, "```", printStatements(q.participants, q.nodes), "```", "");
  }

  L.push("## Decisions", "");
  if (decs.length === 0) L.push("No decisions govern this project yet.", "");
  for (const d of decs) {
    L.push(`### ${d.number} ${d.title} (${d.status})`);
    if (d.decision) L.push(htmlToText(d.decision));
    L.push("");
  }

  L.push(`## Requirements (${cov.covered}/${cov.total} covered)`, "");
  if (reqs.length === 0) L.push("No requirements trace to this project yet.", "");
  for (const r of reqs) {
    L.push(`### ${r.number} ${r.title}`);
    if (r.body) L.push(r.body);
    L.push("");
  }
  if (cov.uncovered.length > 0) {
    L.push(`Without design: ${cov.uncovered.map((u) => u.number).join(", ")}`, "");
  }

  L.push("## Risks", "");
  if (risks.length === 0) L.push("No findings from the deterministic lens.", "");
  for (const f of risks) {
    L.push(`- [${f.severity}] ${f.message}`);
  }
  L.push("");

  L.push("## Validation", "");
  const packScenarios = p.scenarios ?? [];
  const proofs = proveFindings(risks, packScenarios, input.runs ?? [], p.settings?.retentionDays ?? 30);
  if (packScenarios.length === 0) L.push("No scenarios exercise this design yet.", "");
  for (const s of packScenarios) {
    const linked = (input.runs ?? []).filter((r) => r.scenarioId === s.id);
    const latest = [...linked].sort((a, b) => b.createdAt - a.createdAt)[0];
    const intent = (s.validates ?? []).map((v) => `${v.rule} (${v.mode === "reproduce" ? "reproduce" : "withstand"})`).join(", ") || "no linked findings";
    L.push(`### ${s.name}`);
    L.push(`Expects ${s.expectStatus ?? "no expectation"} · validates ${intent}.`);
    L.push(latest ? `Last run: ${latest.status} · verdict ${latest.verdict ?? "none"} (${linked.length} run${linked.length === 1 ? "" : "s"} pinned).` : "Never run.");
    L.push("");
  }
  for (const f of risks) {
    const proof = proofs.find((x) => x.key === findingKey(f));
    L.push(`- [${proof?.state ?? "unproven"}] ${f.rule}: ${f.message}`);
  }
  L.push("");

  L.push("---", "Wireframe experiences and Draw boards are modeled per-surface and are not project-linked, so they are out of pack scope by design.");
  return L.join("\n");
}

export function buildPackJson(input: PackInput): string {
  const { project: p } = input;
  return JSON.stringify(
    {
      version: 1,
      type: "gravenx-architecture-pack",
      exportedAt: new Date().toISOString(),
      project: p.name,
      counts: {
        systems: p.systems.length,
        connections: p.connections.length,
        interfaces: p.interfaces.length,
        operations: p.operations.length,
        sequences: sequencesForProject(p, input.sequences).length,
        decisions: linked(input.decisions, p.id).length,
        requirements: linked(input.requirements, p.id).length,
        scenarios: (p.scenarios ?? []).length,
        runs: (input.runs ?? []).length,
      },
      markdown: buildPackMarkdown(input),
    },
    null,
    2,
  );
}
