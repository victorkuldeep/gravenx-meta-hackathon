import type { ContractFieldMeta } from "../contracts/metadata-adapter";
import type { ApiProject } from "./types";

/**
 * Mapping diagnostics for architect schemas: target existence,
 * transform compatibility, enum coverage, multi-source conflicts.
 */

export interface MappingDiagnostic {
  level: "error" | "warning";
  code: string;
  schema: string;
  property: string;
  message: string;
}

export function validateProjectMappings(
  project: ApiProject,
  metaByObject: Map<string, Map<string, ContractFieldMeta>>
): MappingDiagnostic[] {
  const out: MappingDiagnostic[] = [];
  const seenTargets = new Map<string, string>();

  for (const s of project.schemas) {
    for (const p of s.properties) {
      const m = p.mapping;
      if (!m) continue;
      const at = (level: MappingDiagnostic["level"], code: string, message: string) =>
        out.push({ level, code, schema: s.name, property: p.externalName, message });

      const objMeta = metaByObject.get(m.targetObject);
      const fieldMeta = objMeta?.get(m.targetField);
      if (!objMeta) {
        at("warning", "unknown-object", `Target object ${m.targetObject} not in snapshot - cannot verify.`);
        continue;
      }
      if (!fieldMeta) {
        at("error", "unknown-target", `Target ${m.targetObject}.${m.targetField} not in snapshot.`);
        continue;
      }
      if (m.transform === "enum-map" && fieldMeta.sfType !== "picklist" && fieldMeta.sfType !== "multipicklist") {
        at("error", "bad-transform", `enum-map on non-picklist ${m.targetField}.`);
      }
      if (m.transform === "date-format" && fieldMeta.sfType !== "date" && fieldMeta.sfType !== "datetime") {
        at("error", "bad-transform", `date-format on non-date ${m.targetField}.`);
      }
      if (m.transform === "enum-map" && m.enumMap) {
        const active = new Set(fieldMeta.picklistValues.filter((v) => v.active).map((v) => v.value));
        for (const sv of Object.values(m.enumMap)) {
          if (active.size > 0 && !active.has(sv)) {
            at("warning", "enum-map-unknown", `Mapped value "${sv}" not in active picklist values.`);
          }
        }
      }
      const key = `${m.targetObject}.${m.targetField}.${m.direction}`;
      const first = seenTargets.get(key);
      if (first !== undefined && first !== `${s.name}.${p.externalName}`) {
        at("error", "multi-source", `${key} already mapped from ${first} - one target, one source.`);
      } else {
        seenTargets.set(key, `${s.name}.${p.externalName}`);
      }
    }
  }
  return out;
}
