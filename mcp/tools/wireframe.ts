import { z } from "zod";
import {
  COMPONENT_KINDS,
  ExperienceSchema,
  newExperience,
  newScreen,
  type Experience,
  type WireComponent,
} from "@/lib/wireframe/model";
import { newComponent } from "@/lib/wireframe/registry";
import { buildSpec } from "@/lib/wireframe/buildSpec";
import { importExperiencePackage } from "@/lib/wireframe/packageIo";
import {
  claimFile,
  findRecords,
  listKind,
  readJson,
  writeJson,
} from "../workspace";
import type { McpTool } from "./types";

/** The stored shape is the studio experience-package envelope. */
function asExperience(data: unknown): Experience | null {
  const candidate =
    data && typeof data === "object" && "experience" in data
      ? (data as { experience: unknown }).experience
      : data;
  const parsed = ExperienceSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function matchExp(data: unknown) {
  const exp = asExperience(data);
  if (!exp) return null;
  return { id: exp.id, name: exp.name };
}

function loadExp(dir: string, ref: string): { file: string; exp: Experience } {
  const hits = findRecords(dir, "experience", ref, matchExp);
  if (hits.length === 0) {
    throw new Error(`No experience matches "${ref}" - create one first or check the filename.`);
  }
  if (hits.length > 1) {
    throw new Error(`Ambiguous ref "${ref}" - ${hits.length} matches. Use the exact filename.`);
  }
  const exp = asExperience(hits[0].data);
  if (!exp) throw new Error(`File is not a valid experience package: ${hits[0].file}`);
  return { file: hits[0].file, exp };
}

/** Persist through the studio importer shape so files stay import-clean. */
function saveExp(file: string, exp: Experience): void {
  const r = importExperiencePackage(
    JSON.stringify({ kind: "gravenx-experience-package", packageVersion: 1, experience: exp }),
  );
  if (!r.ok || !r.experience) {
    throw new Error(`Experience failed validation: ${r.error ?? "schema check failed"}`);
  }
  // Keep the author's identity (import re-ids); store the validated model.
  const parsed = ExperienceSchema.safeParse(exp);
  if (!parsed.success) throw new Error("Experience failed validation.");
  writeJson(file, {
    kind: "gravenx-experience-package",
    packageVersion: 1,
    exportedAt: new Date().toISOString(),
    experience: parsed.data,
  });
}

const bindingShape = z
  .object({
    source: z.enum(["salesforce", "rest", "event"]),
    object: z.string().max(120).optional(),
    field: z.string().max(120).optional(),
  })
  .optional();

export const wireframeTools: McpTool[] = [
  {
    name: "wireframe_create",
    description:
      "Create an experience package file (screens + components come next). The studio Import button opens the file directly.",
    shape: { name: z.string().min(1).max(160), overwrite: z.boolean().optional() },
    run: async (dir, args) => {
      const exp = newExperience(args.name as string);
      const file = claimFile(dir, "experience", exp.name, args.overwrite as boolean | undefined);
      saveExp(file, exp);
      return {
        ok: true,
        file,
        summary: `Experience "${exp.name}" saved - add screens, then components.`,
        data: { id: exp.id, name: exp.name },
      };
    },
  },
  {
    name: "wireframe_add_screen",
    description: "Add a screen (mobile 390x844 canvas card) to a stored experience.",
    shape: {
      ref: z.string().min(1).describe("Experience filename, id, or name substring"),
      name: z.string().min(1).max(120),
    },
    run: async (dir, args) => {
      const { file, exp } = loadExp(dir, args.ref as string);
      const next = exp.screens.length;
      const screen = newScreen(args.name as string, 120 + next * 60, 120);
      saveExp(file, { ...exp, screens: [...exp.screens, screen], updatedAt: Date.now() });
      return {
        ok: true,
        file,
        summary: `Screen "${screen.name}" added.`,
        data: { id: screen.id, name: screen.name },
      };
    },
  },
  {
    name: "wireframe_add_component",
    description:
      "Add a palette component to a screen: form inputs, Salesforce-bound fields (sffield/sflookup/sfpicklist), layout, data, actions. Bindings reference live schema by object/field name.",
    shape: {
      ref: z.string().min(1).describe("Experience filename, id, or name substring"),
      screen: z.string().min(1).describe("Screen id or name substring"),
      kind: z.enum(COMPONENT_KINDS as unknown as [string, ...string[]]),
      label: z.string().max(160).optional(),
      binding: bindingShape,
      bindingState: z.enum(["existing", "proposed", "external"]).optional(),
    },
    run: async (dir, args) => {
      const { file, exp } = loadExp(dir, args.ref as string);
      const q = (args.screen as string).trim().toLowerCase();
      const target =
        exp.screens.find((s) => s.id === args.screen) ??
        exp.screens.find((s) => s.name.toLowerCase().includes(q));
      if (!target) throw new Error(`No screen matches "${args.screen as string}".`);
      const comp: WireComponent = {
        ...newComponent(
          args.kind as Parameters<typeof newComponent>[0],
          target.id,
          (args.label as string | undefined) ?? undefined,
        ),
        ...(args.binding ? { binding: args.binding as WireComponent["binding"] } : {}),
        ...(args.bindingState ? { bindingState: args.bindingState as WireComponent["bindingState"] } : {}),
      };
      saveExp(file, {
        ...exp,
        components: [...exp.components, comp],
        updatedAt: Date.now(),
      });
      return {
        ok: true,
        file,
        summary: `Component "${comp.label}" (${comp.kind}) added to "${target.name}".`,
        data: { id: comp.id, kind: comp.kind, screen: target.name },
      };
    },
  },
  {
    name: "wireframe_get",
    description: "Read a stored experience back as JSON (screens, components, bindings).",
    shape: { ref: z.string().min(1).describe("Experience filename, id, or name substring") },
    run: async (dir, args) => {
      const { file } = loadExp(dir, args.ref as string);
      return { ok: true, file, summary: "Experience loaded.", data: readJson(file) };
    },
  },
  {
    name: "wireframe_validate",
    description: "Schema-check a stored experience the same way studio import does.",
    shape: { ref: z.string().min(1).describe("Experience filename, id, or name substring") },
    run: async (dir, args) => {
      const { file } = loadExp(dir, args.ref as string);
      const parsed = ExperienceSchema.safeParse(
        (readJson(file) as { experience?: unknown }).experience,
      );
      if (!parsed.success) {
        return {
          ok: false,
          file,
          summary: "Invalid experience.",
          error: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join(" "),
        };
      }
      return {
        ok: true,
        file,
        summary: `Valid: ${parsed.data.screens.length} screen(s), ${parsed.data.components.length} component(s).`,
      };
    },
  },
  {
    name: "wireframe_spec",
    description:
      "Generate the AI build-instruction spec for a stored experience (screens, schema delta, API impact) - paste straight into a coding agent.",
    shape: { ref: z.string().min(1).describe("Experience filename, id, or name substring") },
    run: async (dir, args) => {
      const { file, exp } = loadExp(dir, args.ref as string);
      return { ok: true, file, summary: "Build spec generated.", data: { spec: buildSpec(exp) } };
    },
  },
  {
    name: "wireframe_list",
    description: "List stored experiences with screen/component counts.",
    shape: {},
    run: async (dir) => {
      const items = listKind(dir, "experience").map(({ file, data }) => {
        const exp = asExperience(data);
        return {
          file: file.split(/[\\/]/).pop(),
          name: exp?.name ?? "(unreadable)",
          screens: exp?.screens.length ?? 0,
          components: exp?.components.length ?? 0,
        };
      });
      return { ok: true, summary: `${items.length} experience(s).`, data: { items } };
    },
  },
];
