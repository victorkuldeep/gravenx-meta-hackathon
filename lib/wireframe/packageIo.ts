import { ExperienceSchema, buildOdaManifest, type Experience } from "./model";
import { buildSpec } from "./buildSpec";

/**
 * Experience package import: the mirror of the History dialog export.
 * Accepts the exported package or a raw experience object, validates it
 * against the schema, then re-ids it so an import can never overwrite an
 * existing experience. Internal refs (screens, parents, journeys) travel
 * untouched - only the document identity is fresh.
 */

function uid(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    /* fall through */
  }
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface ExperienceImport {
  ok: boolean;
  experience?: Experience;
  error?: string;
}

/** Portable package: the exact shape the History dialog downloads, so file
 * export, KV share and file import all round-trip through one builder. */
export function experiencePackage(exp: Experience): {
  kind: string;
  packageVersion: number;
  exportedAt: string;
  experience: Experience;
  manifest: ReturnType<typeof buildOdaManifest>;
  spec: ReturnType<typeof buildSpec>;
} {
  return {
    kind: "gravenx-experience-package",
    packageVersion: 1,
    exportedAt: new Date().toISOString(),
    experience: exp,
    manifest: buildOdaManifest(exp),
    spec: buildSpec(exp),
  };
}

export function importExperiencePackage(text: string): ExperienceImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: "Not valid JSON - export a package from History first." };
  }
  const candidate =
    raw && typeof raw === "object" && "experience" in raw
      ? (raw as { experience?: unknown }).experience
      : raw;
  const parsed = ExperienceSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: "Not a GRAVENX experience package - schema check failed." };
  }
  const experience: Experience = {
    ...parsed.data,
    id: uid("exp"),
    name: `${parsed.data.name} (imported)`.slice(0, 160),
    updatedAt: Date.now(),
  };
  return { ok: true, experience };
}
