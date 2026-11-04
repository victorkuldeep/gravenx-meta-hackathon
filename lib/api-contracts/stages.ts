import { validateOperations } from "./operation-model";
import type { ApiProject } from "./types";

/**
 * Phase-2 orchestrator stages. Later phases append schema design,
 * mappings, rules, security, errors, review and generation stages -
 * this list is the resumable backbone, not a rigid wizard.
 */

export interface StageDef {
  id: string;
  n: number;
  title: string;
  purpose: string;
}

export const STAGES: StageDef[] = [
  { id: "intent", n: 1, title: "Business intent", purpose: "Name the capability, purpose, owners and lifecycle." },
  { id: "parties", n: 2, title: "Consumer & provider", purpose: "Who consumes, who provides, how they interact." },
  { id: "boundary", n: 3, title: "API boundary", purpose: "Resources exposed, objects involved, what stays hidden." },
  { id: "operations", n: 4, title: "Operations", purpose: "Inventory of capabilities with summaries and schemas." },
  { id: "routes", n: 5, title: "Routes", purpose: "Methods, paths, parameters - validated, never invented." },
  { id: "schemas", n: 6, title: "Schemas", purpose: "Request/response models from metadata, architect-owned." },
];

export interface StageStatus {
  id: string;
  complete: boolean;
  blockers: string[];
}

export function stageStatus(project: ApiProject): StageStatus[] {
  const routeIssues = validateOperations(project.operations);
  const routeErrors = (opId: string) =>
    routeIssues.filter((i) => i.level === "error" && i.operationId === opId);

  const intentBlockers: string[] = [];
  if (!project.intent.apiName.trim()) intentBlockers.push("API name is empty.");
  if (!project.intent.capability.trim()) intentBlockers.push("Business capability is empty.");
  if (!project.intent.purpose.trim()) intentBlockers.push("Business purpose is empty.");

  const partiesBlockers: string[] = [];
  if (!project.consumer.system.trim()) partiesBlockers.push("Consumer system is empty.");
  if (!project.provider.system.trim()) partiesBlockers.push("Provider system is empty.");

  const boundaryBlockers: string[] = [];
  if (project.boundary.resources.length === 0) boundaryBlockers.push("No business resources listed.");
  if (project.boundary.participatingObjects.length === 0) {
    boundaryBlockers.push("No Salesforce objects participating.");
  }

  const opsBlockers: string[] = [];
  if (project.operations.length === 0) {
    opsBlockers.push("No operations inventoried.");
  }
  for (const op of project.operations) {
    if (!op.summary.trim()) opsBlockers.push(`${op.method} ${op.route || "(no route)"}: summary is empty.`);
    if (op.requestSchema && !project.schemas.some((s) => s.name === op.requestSchema)) {
      opsBlockers.push(`${op.operationId}: request schema "${op.requestSchema}" does not exist.`);
    }
    if (op.responseSchema && !project.schemas.some((s) => s.name === op.responseSchema)) {
      opsBlockers.push(`${op.operationId}: response schema "${op.responseSchema}" does not exist.`);
    }
    for (const e of routeErrors(op.id)) opsBlockers.push(`${op.operationId}: ${e.message}`);
  }

  const routesBlockers: string[] = [];
  for (const op of project.operations) {
    if (!op.route.startsWith("/")) routesBlockers.push(`${op.operationId}: route must start with /.`);
    for (const e of routeErrors(op.id)) {
      if (!routesBlockers.includes(`${op.operationId}: ${e.message}`)) {
        routesBlockers.push(`${op.operationId}: ${e.message}`);
      }
    }
  }

  const done = (b: string[]) => b.length === 0;

  const schemaBlockers: string[] = [];
  if (project.schemas.length === 0) {
    schemaBlockers.push("No schemas defined.");
  }
  for (const s of project.schemas) {
    if (s.properties.length === 0) schemaBlockers.push(`Schema "${s.name}" has no properties.`);
  }

  return [
    { id: "intent", complete: done(intentBlockers), blockers: intentBlockers },
    { id: "parties", complete: done(partiesBlockers), blockers: partiesBlockers },
    { id: "boundary", complete: done(boundaryBlockers), blockers: boundaryBlockers },
    { id: "operations", complete: done(opsBlockers), blockers: opsBlockers },
    { id: "routes", complete: done(routesBlockers), blockers: routesBlockers },
    { id: "schemas", complete: done(schemaBlockers), blockers: schemaBlockers },
  ];
}

export function overallComplete(project: ApiProject): boolean {
  return stageStatus(project).every((s) => s.complete);
}
