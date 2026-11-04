import type { ApiProject, Decision } from "./types";
import { newDecisionId } from "./decision-model";

/**
 * Rule-based Architecture Assistant. Deterministic facilitation - no LLM,
 * no network. Produces PROPOSED decisions with stable ids (re-runs never
 * duplicate); the architect accepts/rejects/deferrs. Nothing proposed
 * compiles until accepted (see approvedDecisions).
 */

export function suggestForProject(
  project: ApiProject,
  metaFieldCounts: Map<string, number>
): Decision[] {
  const out: Decision[] = [];
  const propose = (d: Omit<Decision, "id" | "status" | "suggested" | "createdAt" | "revision"> & { id: string }) => {
    out.push({ ...d, status: "proposed", suggested: true, createdAt: 0, revision: project.version });
  };

  for (const op of project.operations) {
    if (!op.description) {
      propose({
        id: `sug-desc-${op.id}`,
        topic: "Documentation",
        question: `Add a description for ${op.method} ${op.route}?`,
        options: ["Add description", "Defer"],
        chosen: "",
        rationale: "Undocumented operations fail architecture review.",
        owner: "",
        relatedOps: [op.id],
      });
    }
    if (op.errorResponses.length === 0) {
      propose({
        id: `sug-errors-${op.id}`,
        topic: "Error model",
        question: `Which error responses does ${op.method} ${op.route} document?`,
        options: ["400 Bad Request", "401 Unauthorized", "404 Not Found", "422 Unprocessable", "Defer"],
        chosen: "",
        rationale: "Every operation needs an explicit error strategy before approval.",
        owner: "",
        relatedOps: [op.id],
      });
    }
    if (op.security.length === 0) {
      propose({
        id: `sug-sec-${op.id}`,
        topic: "Security",
        question: `What secures ${op.method} ${op.route}?`,
        options: ["OAuth2", "API key", "None (document why)", "Defer"],
        chosen: "",
        rationale: "Unspecified security blocks approval.",
        owner: "",
        relatedOps: [op.id],
      });
    }
  }

  if (project.defaultSecurity.length === 0) {
    propose({
      id: "sug-default-sec",
      topic: "Security",
      question: "Set a default security requirement for the API?",
      options: ["OAuth2", "API key", "Per-operation only", "Defer"],
      chosen: "",
      rationale: "A default removes per-operation ambiguity.",
      owner: "",
      relatedOps: [],
    });
  }

  // Overexposure: schema covering most of an object's fields.
  for (const s of project.schemas) {
    const sources = new Set(
      s.properties.flatMap((p) => (p.source ? [p.source.objectApiName] : []))
    );
    for (const obj of sources) {
      const total = metaFieldCounts.get(obj) ?? 0;
      const covered = s.properties.filter((p) => p.source?.objectApiName === obj).length;
      if (total > 5 && covered / total > 0.8) {
        propose({
          id: `sug-exposure-${s.name}-${obj}`,
          topic: "Overexposure",
          question: `Schema ${s.name} covers ${covered}/${total} ${obj} fields - intentional?`,
          options: ["Intentional, approve", "Narrow the schema", "Defer"],
          chosen: "",
          rationale: "Metadata is a catalog, not a ready-made public API.",
          owner: "",
          relatedOps: [],
        });
      }
    }
  }

  return out;
}

/** Merge suggestions without duplicating stable ids. Returns added count. */
export function mergeSuggestions(project: ApiProject, suggestions: Decision[]): { project: ApiProject; added: number } {
  const have = new Set(project.decisions.map((d) => d.id));
  const fresh = suggestions.filter((s) => !have.has(s.id));
  if (fresh.length === 0) return { project, added: 0 };
  return {
    project: { ...project, updatedAt: Date.now(), decisions: [...project.decisions, ...fresh] },
    added: fresh.length,
  };
}

export { newDecisionId };

/**
 * Project-gap facilitation for the orchestrator: missing intent, parties,
 * boundary and dangling schema references. Same rules as above - proposed
 * only, stable ids, architect decides.
 */
export function suggestProjectGaps(project: import("./types").ApiProject): import("./types").Decision[] {
  const out: import("./types").Decision[] = [];
  const propose = (
    id: string,
    topic: string,
    question: string,
    options: string[],
    rationale: string,
    relatedOps: string[] = []
  ) => {
    out.push({
      id,
      topic,
      question,
      options,
      chosen: "",
      rationale,
      owner: "",
      status: "proposed",
      suggested: true,
      relatedOps,
      createdAt: 0,
      revision: project.version,
    });
  };

  if (!project.intent.purpose.trim()) {
    propose(
      "sug-gap-purpose",
      "Business intent",
      "What business problem does this API solve?",
      ["Write purpose", "Defer"],
      "An unnamed purpose fails architecture review.",
    );
  }
  if (!project.consumer.system.trim() || !project.provider.system.trim()) {
    propose(
      "sug-gap-parties",
      "Consumer & provider",
      "Which systems consume and provide this API?",
      ["Name both parties", "Defer"],
      "Ownership cannot be reviewed without named parties.",
    );
  }
  if (project.boundary.resources.length === 0) {
    propose(
      "sug-gap-boundary",
      "API boundary",
      "Which business resources does this API expose?",
      ["List resources", "Defer"],
      "Unbounded APIs drift into full-object exposure.",
    );
  }
  for (const op of project.operations) {
    for (const ref of [op.requestSchema, op.responseSchema]) {
      if (ref && !project.schemas.some((s) => s.name === ref)) {
        propose(
          `sug-gap-schema-${op.id}-${ref}`,
          "Schema reference",
          `Schema "${ref}" (used by ${op.operationId}) does not exist - create a shell?`,
          ["Create empty shell", "Pick another", "Defer"],
          "Dangling references break generation.",
          [op.id],
        );
      }
    }
    if (!op.description) {
      propose(
        `sug-gap-opdesc-${op.id}`,
        "Documentation",
        `Describe ${op.method} ${op.route} in one paragraph?`,
        ["Write description", "Defer"],
        "Undocumented operations fail review.",
        [op.id],
      );
    }
  }
  return out;
}

/**
 * Schema-design facilitation: undescribed properties, unmapped required
 * properties, empty schemas. Proposed only, stable ids.
 */
export function suggestSchemaGaps(project: import("./types").ApiProject): import("./types").Decision[] {
  const out: import("./types").Decision[] = [];
  for (const s of project.schemas) {
    if (s.properties.length === 0) {
      out.push({
        id: `sug-schema-empty-${s.name}`,
        topic: "Schema design",
        question: `Schema "${s.name}" has no properties - add from metadata?`,
        options: ["Browse fields", "Defer"],
        chosen: "",
        rationale: "Empty schemas generate empty objects.",
        owner: "",
        status: "proposed",
        suggested: true,
        relatedOps: project.operations.filter((o) => o.requestSchema === s.name || o.responseSchema === s.name).map((o) => o.id),
        createdAt: 0,
        revision: project.version,
      });
      continue;
    }
    const undescribed = s.properties.filter((p) => !p.description.trim());
    if (undescribed.length > 0) {
      out.push({
        id: `sug-schema-desc-${s.name}`,
        topic: "Documentation",
        question: `${undescribed.length} propert${undescribed.length === 1 ? "y" : "ies"} in "${s.name}" lack descriptions - document them?`,
        options: ["Document now", "Defer"],
        chosen: "",
        rationale: "Undescribed properties fail review.",
        owner: "",
        status: "proposed",
        suggested: true,
        relatedOps: [],
        createdAt: 0,
        revision: project.version,
      });
    }
    const unmappedRequired = s.properties.filter((p) => p.required && !p.mapping && !p.readOnly);
    if (unmappedRequired.length > 0) {
      out.push({
        id: `sug-schema-unmapped-${s.name}`,
        topic: "Mapping",
        question: `${unmappedRequired.map((p) => p.externalName).join(", ")} required but unmapped - map to Salesforce?`,
        options: ["Map now", "Intentionally unmapped", "Defer"],
        chosen: "",
        rationale: "Required properties without provenance need an explicit decision.",
        owner: "",
        status: "proposed",
        suggested: true,
        relatedOps: [],
        createdAt: 0,
        revision: project.version,
      });
    }
  }
  return out;
}
