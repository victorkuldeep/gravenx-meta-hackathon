/**
 * Mapping Studio - row-level analysis + project diagnostics.
 *
 * Deterministic rules over mapping rows, source paths and the metadata
 * snapshot. Never invents metadata; absent properties stay absent.
 */

import { checkLength, checkNumeric, checkType } from "./compatibility";
import { FREE_SOURCE_PATH } from "./types";
import type { Diagnostic, MappingRow, MappingProject, SnapshotField, SourcePath } from "./types";

let diagSeq = 0;
const nid = () => `diag-${++diagSeq}-${Date.now().toString(36)}`;

function fieldOf(project: MappingProject, objectName: string, fieldName: string): SnapshotField | undefined {
  return project.sfSnapshot?.objects.find((o) => o.name === objectName)?.fields.find((f) => f.name === fieldName);
}

function pathOf(project: MappingProject, sourcePath: string): SourcePath | undefined {
  return project.source?.paths.find((p) => p.id === sourcePath);
}

/** Analyze one mapping row. Returns diagnostics + suggested status. */
export function analyzeRow(
  project: MappingProject,
  row: MappingRow
): { diagnostics: Diagnostic[]; suggested: MappingRow["status"] } {
  const diagnostics: Diagnostic[] = [];
  if (row.kind === "excluded") return { diagnostics, suggested: "excluded" };
  if (row.kind === "hardcoded" && !row.fieldName)
    return { diagnostics, suggested: "hardcoded" };

  // Free constant rows have no source node by design - the target
  // check below is the whole story for them, never source-missing.
  if (row.sourcePath === FREE_SOURCE_PATH) {
    if (row.fieldName && !fieldOf(project, row.objectName, row.fieldName)) {
      return {
        diagnostics: [
          {
            id: nid(),
            severity: "error",
            category: "target-missing",
            sourcePath: row.sourcePath,
            objectName: row.objectName,
            fieldName: row.fieldName,
            message: `Target ${row.objectName}.${row.fieldName} is not in the project metadata snapshot.`,
            action: "Refresh metadata or remap the row.",
          },
        ],
        suggested: "stale-target",
      };
    }
    return { diagnostics, suggested: row.kind === "hardcoded" ? "hardcoded" : "mapped" };
  }

  const field = fieldOf(project, row.objectName, row.fieldName);
  if (!field) {
    return {
      diagnostics: [
        {
          id: nid(),
          severity: "error",
          category: "target-missing",
          sourcePath: row.sourcePath,
          objectName: row.objectName,
          fieldName: row.fieldName,
          message: `Target ${row.objectName}.${row.fieldName} is not in the project metadata snapshot.`,
          action: "Refresh metadata or remap the row.",
        },
      ],
      suggested: "stale-target",
    };
  }

  const source = pathOf(project, row.sourcePath);
  if (!source) {
    return {
      diagnostics: [
        {
          id: nid(),
          severity: "warning",
          category: "source-missing",
          sourcePath: row.sourcePath,
          objectName: row.objectName,
          fieldName: row.fieldName,
          message: `Source path ${row.sourcePath} no longer exists in the source template. Mapping preserved for review.`,
          action: "Confirm the source change or remap.",
        },
      ],
      suggested: "invalid",
    };
  }

  if (row.kind === "hardcoded") {
    return { diagnostics, suggested: "hardcoded" };
  }

  const compat = checkType(source.jsonType, field.type);
  if (compat.level === "incompatible") {
    diagnostics.push({
      id: nid(),
      severity: "error",
      category: "type-mismatch",
      sourcePath: row.sourcePath,
      objectName: row.objectName,
      fieldName: row.fieldName,
      message: compat.reason,
      expected: field.type,
      actual: source.jsonType,
      action: "Choose a compatible field or mark Needs transformation.",
    });
    return { diagnostics, suggested: "incompatible" };
  }
  if (compat.level === "needs-decision") {
    diagnostics.push({
      id: nid(),
      severity: "warning",
      category: "type-decision",
      sourcePath: row.sourcePath,
      objectName: row.objectName,
      fieldName: row.fieldName,
      message: compat.reason,
      expected: field.type,
      actual: source.jsonType,
      action: "Record the conversion decision in rationale.",
    });
  }

  const len = checkLength(source.example, field.length);
  if (len.flag) {
    diagnostics.push({
      id: nid(),
      severity: "error",
      category: "length",
      sourcePath: row.sourcePath,
      objectName: row.objectName,
      fieldName: row.fieldName,
      message: len.message,
      expected: field.length,
      actual: typeof source.example === "string" ? source.example.length : undefined,
    });
    return { diagnostics, suggested: "incompatible" };
  }

  const num = checkNumeric(source.example, field.precision, field.scale);
  if (num.flag) {
    diagnostics.push({
      id: nid(),
      severity: "error",
      category: "precision",
      sourcePath: row.sourcePath,
      objectName: row.objectName,
      fieldName: row.fieldName,
      message: num.message,
      expected: `${field.precision},${field.scale}`,
      actual: source.example,
    });
    return { diagnostics, suggested: "incompatible" };
  }

  // Picklist correspondence (explicit enum maps are checked in Phase 3 editor;
  // here we flag unmapped scalar values against active values).
  if ((field.type === "picklist" || field.type === "multipicklist") && row.kind !== "enum") {
    const active = field.picklistValues.filter((p) => p.active).map((p) => p.value);
    if (typeof source.example === "string" && active.length > 0 && !active.includes(source.example)) {
      diagnostics.push({
        id: nid(),
        severity: "warning",
        category: "picklist",
        sourcePath: row.sourcePath,
        objectName: row.objectName,
        fieldName: row.fieldName,
        message: `Sample value "${source.example}" is not an active ${row.objectName}.${row.fieldName} value.`,
        expected: active.slice(0, 10),
        actual: source.example,
        action: "Define an explicit enum mapping.",
      });
    }
  }

  const needsDecision = diagnostics.some((d) => d.severity === "warning");
  return { diagnostics, suggested: needsDecision ? "needs-decision" : "mapped" };
}

/** Project-wide review findings (Review dashboard consumes this too). */
export function reviewProject(project: MappingProject): Diagnostic[] {
  const out: Diagnostic[] = [];
  const mappedPaths = new Set(project.mappings.filter((m) => m.kind !== "excluded").map((m) => m.sourcePath));

  for (const row of project.mappings) {
    out.push(...analyzeRow(project, row).diagnostics);
  }

  // Unmapped leaf paths (containers + root excluded from the count).
  const unmapped =
    project.source?.paths.filter((p) => (p.kind === "scalar" || p.kind === "null") && !mappedPaths.has(p.id)) ?? [];
  for (const p of unmapped.slice(0, 200)) {
    out.push({
      id: nid(),
      severity: "info",
      category: "unmapped",
      sourcePath: p.id,
      message: `${p.id} has no mapping yet.`,
    });
  }

  // Required target fields with no mapping, per record plan object.
  const plans = project.recordPlans.length > 0 ? project.recordPlans : [];
  const objects = new Set(plans.map((p) => p.objectName));
  // Also cover directly-mapped objects when no plans exist yet.
  for (const m of project.mappings) objects.add(m.objectName);
  for (const objName of objects) {
    const obj = project.sfSnapshot?.objects.find((o) => o.name === objName);
    if (!obj) continue;
    const mappedFields = new Set(project.mappings.filter((m) => m.objectName === objName).map((m) => m.fieldName));
    for (const f of obj.fields) {
      const required = !f.nillable && !f.defaultedOnCreate && f.createable;
      if (required && !mappedFields.has(f.name)) {
        out.push({
          id: nid(),
          severity: "warning",
          category: "required-unmapped",
          objectName: objName,
          fieldName: f.name,
          message: `Required ${objName}.${f.name} has no mapping.`,
          action: "Map a source path, hardcode a value, or document why it is unset.",
        });
      }
    }
  }
  return out;
}
