import { z } from "zod";
import {
  COMPONENT_KINDS,
  newScreen,
  type ComponentKind,
  type Experience,
} from "@/lib/wireframe/model";
import { newComponent, patchComponent } from "@/lib/wireframe/registry";
import { suggestApiName } from "@/lib/wireframe/proposed";
import { schemaDelta } from "@/lib/wireframe/proposed";
import { buildSpec } from "@/lib/wireframe/buildSpec";
import { getWireBridge, wireSnapshotOf } from "./wireBridge";
import type { AgentTool } from "./tools";

/**
 * Wireframe-tab tool pack: reads run free, mutations need panel approval.
 * Every mutation goes through the canvas bridge (persist path), so the
 * proposed-fields rollup and autosave keep working exactly as if the
 * human acted. Component/screen refs accept id or name; ambiguous names
 * fail loudly with candidates instead of guessing.
 */

const noArgs = z.object({});

function matchScreen(exp: Experience, ref: string) {
  const q = ref.trim().toLowerCase();
  return exp.screens.find((s) => s.id === ref) ?? exp.screens.find((s) => s.name.toLowerCase() === q) ?? null;
}

function matchComponents(exp: Experience, ref: string) {
  const q = ref.trim().toLowerCase();
  const byId = exp.components.filter((c) => c.id === ref);
  if (byId.length > 0) return byId;
  return exp.components.filter((c) => c.label.trim().toLowerCase() === q);
}

const describeCanvas: AgentTool = {
  name: "wire_describe",
  description: "Summarize the open wireframe experience: name, status, version, screens with component counts, and totals for components, proposals, behaviors and journeys.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "Read experience summary",
  schema: noArgs,
  execute: async () => {
    const { exp } = liveExp();
    if (!exp) return { ok: false, error: "No Wireframe canvas is open - ask the user to open the Wireframe tab and an experience first." };
    return { ok: true, result: wireSnapshotOf(exp) };
  },
};

const screenArgs = z.object({
  screen: z.string().min(1).max(120).optional().describe("Screen id or name - omit for every screen"),
});

const listComponents: AgentTool = {
  name: "wire_components",
  description: "List components with id, kind, label and binding summary, optionally filtered to one screen (id or name). Read-only.",
  parameters: {
    type: "object",
    properties: { screen: { type: "string" } },
    additionalProperties: false,
  },
  needsApproval: false,
  label: () => "List components",
  schema: screenArgs,
  execute: async (raw) => {
    const { exp } = liveExp();
    if (!exp) return { ok: false, error: "No Wireframe canvas is open." };
    const args = raw as z.infer<typeof screenArgs>;
    const live: Experience = exp;
    let list = live.components;
    if (args.screen?.trim()) {
      const s = matchScreen(live, args.screen);
      if (!s) return { ok: false, error: `No screen "${args.screen}" - see wire_describe for names.` };
      list = list.filter((c) => c.parentId === s.id);
    }
    const names = new Map(live.screens.map((s) => [s.id, s.name]));
    return {
      ok: true,
      result: list.slice(0, 200).map((c) => ({
        id: c.id,
        kind: c.kind,
        label: c.label,
        screen: c.parentId ? (names.get(c.parentId) ?? c.parentId) : null,
        binding: c.bindingState === "existing" && c.binding?.object
          ? `${c.binding.object}${c.binding.field ? `.${c.binding.field}` : ""}`
          : c.bindingState === "proposed" && c.proposedField
            ? `proposed ${c.proposedField.object}.${c.proposedField.apiName}`
            : (c.bindingState ?? "unbound"),
        interaction: c.interaction ? `on ${c.interaction.trigger} → ${c.interaction.action}${c.interaction.target ? ` ${c.interaction.target}` : ""}` : null,
      })),
    };
  },
};

const readDelta: AgentTool = {
  name: "wire_delta",
  description: "Show the schema delta: per object, live-bound existing fields vs proposed new fields. Read-only - the Author queue input.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "Read schema delta",
  schema: noArgs,
  execute: async () => {
    const { exp } = liveExp();
    if (!exp) return { ok: false, error: "No Wireframe canvas is open." };
    const delta = schemaDelta(exp);
    if (delta.length === 0) return { ok: true, result: "No bindings yet." };
    return {
      ok: true,
      result: delta.map((d) => ({
        object: d.object,
        existing: d.existing,
        proposed: d.proposed.map((p) => ({ apiName: p.apiName, label: p.label, type: p.type, required: p.required ?? false, values: p.values ?? [] })),
      })),
    };
  },
};

const readSpec: AgentTool = {
  name: "wire_spec",
  description: "Generate the deterministic AI build-instruction markdown for the open experience (screens, delta, contracts, behavior, journeys, build order). Read-only - long output is truncated in transcript; quote sections.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "Generate build spec",
  schema: noArgs,
  execute: async () => {
    const { exp } = liveExp();
    if (!exp) return { ok: false, error: "No Wireframe canvas is open." };
    return { ok: true, result: buildSpec(exp) };
  },
};

function liveExp(): { bridge: NonNullable<ReturnType<typeof getWireBridge>>; exp: Experience } | { bridge: null; exp: null } {
  const bridge = getWireBridge();
  const exp = bridge?.getExperience() ?? null;
  if (!bridge || !exp) return { bridge: null, exp: null };
  return { bridge, exp };
}

const addScreenArgs = z.object({
  name: z.string().min(1).max(120).describe("Screen name, e.g. Customer Detail"),
});

const addScreen: AgentTool = {
  name: "wire_add_screen",
  description: "Add a screen to the open experience. Only new screens - never rename or delete.",
  parameters: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => `Add screen ${(a as { name?: string }).name ?? ""}`.trim(),
  schema: addScreenArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof addScreenArgs>;
    const { bridge, exp } = liveExp();
    if (!bridge || !exp) return { ok: false, error: "No Wireframe canvas is open." };
    const screen = newScreen(args.name, 120 + exp.screens.length * 60, 120);
    const r = bridge.apply((e) => ({ ...e, screens: [...e.screens, screen] }), `AI: add screen ${screen.name}`);
    if (!r.ok) return { ok: false, error: r.error ?? "Apply failed." };
    return { ok: true, result: `Added screen "${screen.name}" (${screen.id}).` };
  },
};

const addComponentArgs = z.object({
  kind: z.string().min(1).describe("Component kind id, e.g. input, select, sffield, button, card, table"),
  screen: z.string().min(1).max(120).describe("Target screen id or name"),
  label: z.string().max(160).optional().describe("Component label - defaults to the kind default"),
  object: z.string().max(120).optional().describe("Salesforce object to bind, e.g. Account - makes the binding live"),
  field: z.string().max(120).optional().describe("Field on the object, e.g. Name"),
});

const addComponent: AgentTool = {
  name: "wire_add_component",
  description: "Add a component to a screen, optionally live-bound to a Salesforce object.field. Use sffield/sflookup/sfpicklist for Salesforce-native fields.",
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string" },
      screen: { type: "string" },
      label: { type: "string" },
      object: { type: "string" },
      field: { type: "string" },
    },
    required: ["kind", "screen"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => {
    const v = a as { kind?: string; label?: string };
    return `Add ${v.label ?? v.kind ?? "component"}`;
  },
  schema: addComponentArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof addComponentArgs>;
    const { bridge, exp } = liveExp();
    if (!bridge || !exp) return { ok: false, error: "No Wireframe canvas is open." };
    if (!(COMPONENT_KINDS as readonly string[]).includes(args.kind)) {
      return { ok: false, error: `Unknown kind "${args.kind}". Use wire_components to see kinds in use, or pick from: text, input, select, checkbox, button, card, table, sffield, sflookup, sfpicklist.` };
    }
    const screen = matchScreen(exp, args.screen);
    if (!screen) return { ok: false, error: `No screen "${args.screen}" - see wire_describe for names.` };
    const comp = newComponent(args.kind as ComponentKind, screen.id);
    if (args.label?.trim()) comp.label = args.label.trim().slice(0, 160);
    if (args.object?.trim()) {
      comp.bindingState = "existing";
      comp.binding = { source: "salesforce", object: args.object.trim().slice(0, 120), field: args.field?.trim().slice(0, 120) || undefined };
    }
    const r = bridge.apply((e) => ({ ...e, components: [...e.components, comp] }), `AI: add ${comp.kind} to ${screen.name}`);
    if (!r.ok) return { ok: false, error: r.error ?? "Apply failed." };
    return { ok: true, result: `Added ${comp.kind} "${comp.label}" (${comp.id}) to "${screen.name}".` };
  },
};

const bindArgs = z.object({
  component: z.string().min(1).describe("Component id or exact label"),
  state: z.enum(["existing", "proposed", "external", "unbound"]).describe("Binding state"),
  object: z.string().max(120).optional().describe("Object for existing/proposed, external label for external"),
  field: z.string().max(120).optional().describe("Field name for an existing binding"),
  apiName: z.string().max(120).optional().describe("Proposed field API name - suggested from the label when omitted"),
  fieldLabel: z.string().max(120).optional().describe("Proposed field label"),
  fieldType: z.string().max(60).optional().describe("Proposed field type, e.g. Text, Picklist, Lookup"),
  values: z.array(z.string().max(120)).max(200).optional().describe("Picklist values or the lookup target object"),
});

const bindComponent: AgentTool = {
  name: "wire_bind",
  description: "Set a component's data binding: existing (live object.field), proposed (authors a new-field proposal), external (labels an outside source) or unbound (clears).",
  parameters: {
    type: "object",
    properties: {
      component: { type: "string" },
      state: { type: "string", enum: ["existing", "proposed", "external", "unbound"] },
      object: { type: "string" },
      field: { type: "string" },
      apiName: { type: "string" },
      fieldLabel: { type: "string" },
      fieldType: { type: "string" },
      values: { type: "array", items: { type: "string" } },
    },
    required: ["component", "state"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => {
    const v = a as { state?: string; object?: string; field?: string };
    return `Bind ${v.state}${v.object ? ` ${v.object}${v.field ? `.${v.field}` : ""}` : ""}`.trim();
  },
  schema: bindArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof bindArgs>;
    const { bridge, exp } = liveExp();
    if (!bridge || !exp) return { ok: false, error: "No Wireframe canvas is open." };
    const hits = matchComponents(exp, args.component);
    if (hits.length === 0) return { ok: false, error: `No component "${args.component}" - see wire_components for ids and labels.` };
    if (hits.length > 1) {
      return { ok: false, error: `Ambiguous - ${hits.length} components share that label (${hits.map((c) => c.id).join(", ")}). Use the id.` };
    }
    const comp = hits[0];
    if (args.state === "unbound") {
      const r = bridge.apply(
        (e) => ({ ...e, components: patchComponent(e.components, comp.id, { bindingState: undefined, binding: undefined, proposedField: undefined }) }),
        "AI: unbind component",
      );
      if (!r.ok) return { ok: false, error: r.error ?? "Apply failed." };
      return { ok: true, result: `Unbound "${comp.label || comp.kind}".` };
    }
    if (args.state === "existing") {
      if (!args.object?.trim()) return { ok: false, error: "An existing binding needs the object." };
      const r = bridge.apply(
        (e) => ({
          ...e,
          components: patchComponent(e.components, comp.id, {
            bindingState: "existing",
            binding: { source: "salesforce", object: args.object!.trim().slice(0, 120), field: args.field?.trim().slice(0, 120) || undefined },
          }),
        }),
        `AI: bind ${args.object}.${args.field ?? ""}`,
      );
      if (!r.ok) return { ok: false, error: r.error ?? "Apply failed." };
      return { ok: true, result: `Bound "${comp.label || comp.kind}" to ${args.object.trim()}${args.field?.trim() ? `.${args.field.trim()}` : ""}.` };
    }
    if (args.state === "proposed") {
      const object = args.object?.trim() ?? comp.binding?.object ?? "";
      const apiName = args.apiName?.trim() || suggestApiName(args.fieldLabel ?? comp.label);
      if (!object) return { ok: false, error: "A proposal needs the object - pass object explicitly." };
      if (!apiName) return { ok: false, error: "Could not derive an API name - pass apiName like Tier__c." };
      const r = bridge.apply(
        (e) => ({
          ...e,
          components: patchComponent(e.components, comp.id, {
            bindingState: "proposed",
            binding: { source: "salesforce", object: object.slice(0, 120) },
            proposedField: {
              object: object.slice(0, 120),
              apiName: apiName.slice(0, 120),
              label: (args.fieldLabel ?? comp.label ?? "").trim().slice(0, 120) || apiName,
              type: (args.fieldType ?? "Text").slice(0, 60),
              values: args.values?.slice(0, 200),
            },
          }),
        }),
        `AI: propose ${object}.${apiName}`,
      );
      if (!r.ok) return { ok: false, error: r.error ?? "Apply failed." };
      return { ok: true, result: `Proposed ${object}.${apiName} on "${comp.label || comp.kind}" - review it in the Delta panel.` };
    }
    const label = args.object?.trim() || "External";
    const r = bridge.apply(
      (e) => ({
        ...e,
        components: patchComponent(e.components, comp.id, {
          bindingState: "external",
          binding: { source: "rest", externalLabel: label.slice(0, 120) },
          proposedField: undefined,
        }),
      }),
      `AI: external-bind ${label}`,
    );
    if (!r.ok) return { ok: false, error: r.error ?? "Apply failed." };
    return { ok: true, result: `Bound "${comp.label || comp.kind}" to external source "${label}".` };
  },
};

const interactArgs = z.object({
  component: z.string().min(1).describe("Component id or exact label"),
  trigger: z.enum(["click", "change", "load", "submit", "delete"]).describe("When it fires"),
  action: z.string().min(1).max(120).describe("What happens, e.g. save, navigate"),
  target: z.string().max(160).optional().describe("Target object or screen, e.g. Account"),
});

const setInteraction: AgentTool = {
  name: "wire_interact",
  description: "Set a component's interaction intent: trigger, action and target (object for saves, screen name for navigate).",
  parameters: {
    type: "object",
    properties: {
      component: { type: "string" },
      trigger: { type: "string", enum: ["click", "change", "load", "submit", "delete"] },
      action: { type: "string" },
      target: { type: "string" },
    },
    required: ["component", "trigger", "action"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => {
    const v = a as { action?: string; target?: string };
    return `${v.action ?? "Interact"}${v.target ? ` ${v.target}` : ""}`.trim();
  },
  schema: interactArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof interactArgs>;
    const { bridge, exp } = liveExp();
    if (!bridge || !exp) return { ok: false, error: "No Wireframe canvas is open." };
    const hits = matchComponents(exp, args.component);
    if (hits.length === 0) return { ok: false, error: `No component "${args.component}" - see wire_components for ids and labels.` };
    if (hits.length > 1) {
      return { ok: false, error: `Ambiguous - ${hits.length} components share that label (${hits.map((c) => c.id).join(", ")}). Use the id.` };
    }
    const comp = hits[0];
    const r = bridge.apply(
      (e) => ({
        ...e,
        components: patchComponent(e.components, comp.id, {
          interaction: { trigger: args.trigger, action: args.action.trim().slice(0, 120), target: args.target?.trim().slice(0, 160) || undefined },
        }),
      }),
      `AI: ${args.action} on ${comp.label || comp.kind}`,
    );
    if (!r.ok) return { ok: false, error: r.error ?? "Apply failed." };
    return { ok: true, result: `On ${args.trigger}, "${comp.label || comp.kind}" will ${args.action}${args.target?.trim() ? ` ${args.target.trim()}` : ""}.` };
  },
};

export const WIREFRAME_TOOLS: AgentTool[] = [
  describeCanvas,
  listComponents,
  readDelta,
  readSpec,
  addScreen,
  addComponent,
  bindComponent,
  setInteraction,
];
