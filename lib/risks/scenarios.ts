import { resolveChain } from "@/lib/system-design/chain";
import type {
  OperationMock,
  ScenarioValidates,
  SystemProject,
} from "@/lib/system-design/model";
import type { SequenceDocument } from "@/lib/sequence/model";
import type { RiskFinding } from "./rules";

/**
 * Failure-scenario generator (validation epic) - deterministic drafts that
 * turn a risk finding into the test that would confirm or refute it.
 *
 * Runner-honest by construction: the chain runner serves mocks as-is with
 * no retry/timeout execution, so drafts inject the feared condition and
 * declare intent. reproduce expects the failure (a match confirms the
 * risk); withstand expects the design to hold under latency. Drafts never
 * write - the dialog previews them and the architect confirms.
 */

export interface ScenarioDraft {
  name: string;
  flowId: string | null;
  inputPayload: string;
  mockOverrides: Record<string, OperationMock>;
  expectStatus: number;
  validates: ScenarioValidates[];
  rationale: string;
}

/** Operations cited directly, or owned by a cited system (fan-in hub). */
function targetOpIds(project: SystemProject, finding: RiskFinding): string[] {
  const opIds = new Set(project.operations.map((o) => o.id));
  const direct = finding.refs.filter((r) => r.surface === "system" && opIds.has(r.id)).map((r) => r.id);
  if (direct.length > 0) return direct;
  const sysIds = new Set(finding.refs.filter((r) => r.surface === "system").map((r) => r.id));
  const owned = project.interfaces.filter((i) => sysIds.has(i.systemId)).map((i) => i.id);
  return project.operations.filter((o) => owned.includes(o.interfaceId)).map((o) => o.id);
}

/** Sync messages in a sequence that name a project operation. */
function sequenceOpIds(project: SystemProject, doc: SequenceDocument): string[] {
  const opIds = new Set(project.operations.map((o) => o.id));
  const opNames = new Map(
    project.operations.flatMap((o) => [
      [`${o.method} ${o.path}`.trim().toLowerCase(), o.id],
      [o.name.toLowerCase(), o.id],
    ]),
  );
  const out: string[] = [];
  const walk = (nodes: SequenceDocument["nodes"]): void => {
    for (const n of nodes ?? []) {
      if (n.nodeType === "block") {
        walk(n.children);
        if (n.elseChildren) walk(n.elseChildren);
        continue;
      }
      const m = n as { kind?: string; operationRef?: string };
      if (m.kind !== "sync" || !m.operationRef) continue;
      const hit = opIds.has(m.operationRef) ? m.operationRef : opNames.get(m.operationRef.toLowerCase());
      if (hit && !out.includes(hit)) out.push(hit);
    }
  };
  walk(doc.nodes);
  return out;
}

/** First flow whose resolved chain touches a target op, else first flow. */
function pickFlow(project: SystemProject, opIds: string[]): string | null {
  if (project.flows.length === 0) return null;
  const wanted = new Set(opIds);
  for (const f of project.flows) {
    const lanes = resolveChain(project, f.startEdgeId);
    const touched = lanes.some((l) =>
      l.edges.some((e) => {
        const bound = [e.sourceOperationId, e.targetOperationId].filter(Boolean) as string[];
        const overridden = Object.values(f.opByEdge ?? {});
        return bound.some((id) => wanted.has(id)) || overridden.some((id) => wanted.has(id));
      }),
    );
    if (touched) return f.id;
  }
  return project.flows[0]?.id ?? null;
}

const LATENCY_PROBE_MS = 8000;

export function proposeScenario(
  project: SystemProject,
  finding: RiskFinding,
  sequences: SequenceDocument[] = [],
): ScenarioDraft | null {
  let opIds = targetOpIds(project, finding);
  if (opIds.length === 0 && finding.rule === "naked-sync") {
    const doc = sequences.find((d) => finding.refs.some((r) => r.surface === "sequence" && r.id === d.id));
    if (doc) opIds = sequenceOpIds(project, doc);
  }
  if (opIds.length === 0) return null;
  const [first] = opIds;
  const opName = project.operations.find((o) => o.id === first);
  const label = opName ? `${opName.method} ${opName.path}`.trim() || opName.name : first;
  const refIds = finding.refs
    .filter((r) => r.surface === "system" && (r.id === first || opIds.includes(r.id)))
    .map((r) => r.id);
  const refs = refIds.length > 0 ? refIds : [first];
  const base = {
    flowId: pickFlow(project, opIds),
    inputPayload: "{}",
  };

  switch (finding.rule) {
    case "no-retry":
    case "fan-in-hub":
      return {
        ...base,
        name: `${finding.rule === "fan-in-hub" ? "Hub down" : "Transient failure"} - ${label}`,
        mockOverrides: { [first]: { status: 500, body: '{"error":"injected by validation scenario"}', latencyMs: 300 } },
        expectStatus: 500,
        validates: refs.map((refId) => ({ rule: finding.rule, refId, mode: "reproduce" as const })),
        rationale:
          finding.rule === "fan-in-hub"
            ? "Kills the hub operation with a 500 mock: a matching run confirms every dependent lane stops with it."
            : "Fails the operation once with a 500 mock: a matching run confirms the transient becomes permanent with no retry stated.",
      };
    case "naked-sync":
      return {
        ...base,
        name: `Naked call - ${label}`,
        mockOverrides: { [first]: { status: 500, body: '{"error":"injected by validation scenario"}', latencyMs: 300 } },
        expectStatus: 500,
        validates: refs.map((refId) => ({ rule: finding.rule, refId, mode: "reproduce" as const })),
        rationale:
          "Fails the sequence-invoked operation with a 500 mock: a matching run confirms the caller has no fallback.",
      };
    case "no-timeout":
    case "sync-chain":
    case "unversioned-api":
      return {
        ...base,
        name: `${finding.rule === "sync-chain" ? "Slow hop" : finding.rule === "no-timeout" ? "Hung downstream" : "Contract exercise"} - ${label}`,
        mockOverrides: {
          [first]: { status: 200, body: '{"ok":true}', latencyMs: finding.rule === "unversioned-api" ? 300 : LATENCY_PROBE_MS },
        },
        expectStatus: 200,
        validates: refs.map((refId) => ({ rule: finding.rule, refId, mode: "withstand" as const })),
        rationale:
          finding.rule === "sync-chain"
            ? "Holds the slowest hop open 8s: per-hop durations document the stall exposure while the chain completes."
            : finding.rule === "no-timeout"
              ? "Holds the hop open 8s with no abort: the run evidence shows exactly how long a hung downstream keeps it open."
              : "Exercises the unversioned contract end to end; versioning itself resolves by policy, this run documents the behavior pinned.",
      };
    default:
      return null;
  }
}
