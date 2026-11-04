import { z } from "zod";
import type { McpTool } from "./types";

/**
 * Skill packs: opinionated GRAVENX playbooks per surface. Agents read the
 * pack BEFORE calling that surface's tools so plans follow studio
 * conventions (naming, validation order, what the Import buttons accept).
 * Start with skill_list, then skill_read for the surfaces in play.
 *
 * GENERATED from the skills pack markdown by scripts/sync-skills.mjs - do not edit.
 * The markdown files are canonical (Agent Skills format, MIT).
 */
const SKILLS: Record<string, { when: string; body: string }> = {
  "activity": {
    when: "Org-mutation audit trail and JIRA follow-ups. Use when the architect reviews who changed what in the org and whether it worked.",
    body: [
      "# Activity skill",
      "",
      "1. `activity_live_list` reads Arch Activity from the paired tab: who deployed/edited what, when, and whether it worked. Filter by actor (architect/agent-bridge) or category (metadata/data).",
      "2. Summarize risk: failed deploys, agent-bridge actions the architect hasn't reviewed, PROD-hour changes.",
      "3. Draft follow-ups with `jira_draft` (file side) citing the activity entries as evidence.",
      "4. Canvas curation (place/hide/remove/tags) is intentionally absent - snapshots cover it, not the trail.",
      "",
      "Pitfalls: the trail lives in the tab's IndexedDB - no paired tab means no activity. Export MD from Setup > Arch Activity for offline reviews.",
    ].join("\n"),
  },
  "builder": {
    when: "Single REST payloads and multi-request Composite batches. Use when the architect builds or validates Salesforce API calls.",
    body: [
      "# Builder skill",
      "",
      "1. `payload_build` for one call: method + object + fields -> runnable URL + JSON body. PATCH/DELETE/GET require recordId. Save with `save: true` to replay later.",
      "2. `composite_create` for batches (max 25 subrequests, allOrNone default true).",
      "3. `composite_add_request` in dependency order. Link with {apiName, from: referenceId, property} to emit `@{ref.id}` references - the referenced request MUST exist first.",
      "4. `composite_validate` checks structure (dup refs, PATCH-without-id, method rules). Org required-field checks need the live tab - flag them, don't invent values.",
      "5. `composite_payload` emits the exact Composite JSON + execution order. Paste into the REST runner.",
      "",
      "Pitfalls: referenceIds are batch-scoped and must match [A-Za-z][A-Za-z0-9_]*; unknown `from` fails the whole add.",
    ].join("\n"),
  },
  "contracts": {
    when: "Consumer to Salesforce API contracts. Use when the architect defines what a consumer may call and with which fields.",
    body: [
      "# Contracts skill",
      "",
      "1. `contract_create` needs name + targetObject + consumer (who calls this - required).",
      "2. `contract_add_field` per field: apiName + operations (POST/PATCH) + ownership + transform. external defaults to the api name; set it when the consumer renames the field.",
      "3. integrationRequired=true marks business-required beyond Salesforce metadata.",
      "4. `contract_validate` runs the studio import validator. `contract_spec` is the review handoff.",
      "",
      "Pitfalls: operationIds must be identifiers (auto-generated); DELETE is not a contract operation here.",
    ].join("\n"),
  },
  "erd-live": {
    when: "Drive the open ERD tab through the bridge (paired tab required). Use for canvas curation, schema discovery, and Author-mode metadata changes.",
    body: [
      "# ERD live skill",
      "",
      "1. Pair first: the hub prints a code + pair link; the tab dials it (Setup > Terminal Bridge).",
      "2. Reads are free: `erd_live_snapshot` (canvas truth), `erd_live_objects` (browse org schema), `erd_live_discover` (parents/children via the tab session - an org call, needs approval unless auto mode).",
      "3. Writes (`place/hide/remove/tags/focus/mode/filter/author_*`) pause for architect approval unless auto mode is on. Pairing IS the authorization - say so, don't re-ask per command.",
      "4. Refs are fuzzy: exact api name wins, then label, then single substring; ambiguity errors list candidates - ask the architect to pick, never place both.",
      "5. Custom objects MUST come from schema browse/discover - never invent __c names.",
      "6. `arch.activity` reads the tab's mutation audit trail for reviews and JIRA drafts.",
      "",
      "Pitfalls: removing the canvas root is refused; removing a tag assignment is not deleting the tag (`tags delete` removes it everywhere). Root cause of 'ack but nothing changed' is always stale ctx - snapshot first.",
    ].join("\n"),
  },
  "governance": {
    when: "Architecture decisions, requirements, traceability, JIRA drafts. Use when the architect records why something was decided or what must be covered.",
    body: [
      "# Governance skill",
      "",
      "1. `decision_create` auto-numbers (ADR-001...). Move along the legal trail only: proposed -> in-review -> accepted; accepted -> deprecated/superseded. Illegal jumps fail.",
      "2. `decision_link` binds a decision to what it governs (system/wireframe/sequence/draw/schema).",
      "3. `requirement_create` auto-numbers (REQ-001...); trail is open -> covered -> verified.",
      "4. `requirement_link` with surface=decision builds requirement->decision traceability.",
      "5. `decision_summarize` is the review digest: counts, open items, accepted governance.",
      "6. `jira_draft` turns open decisions + requirements (+ a mapping's open items) into an acceptance-criteria story, saved as a note. Paste into JIRA - never invent coverage.",
      "",
      "Pitfalls: history is append-only; updates re-validate through the studio importer.",
    ].join("\n"),
  },
  "mapping": {
    when: "Screen or payload source to Salesforce target field mapping. Use when the architect maps an external API onto sObjects.",
    body: [
      "# Mapping skill",
      "",
      "1. `mapping_create` first (sourceSystem + sourceApi set the lineage header).",
      "2. `mapping_add_plan` per target object: one plan per sObject + intent (create/update/upsert). Use sourcePath `$.lines[]` for collections, empty for the root record; matchKey for upserts.",
      "3. `mapping_add_rule` per field: attach `plan` by name. Kinds: direct (same value), hardcoded (constant via value), excluded (explicitly out of scope), enum (value map).",
      "4. Enum rules become needs-decision automatically - resolve them with the architect, don't guess maps.",
      "5. `mapping_validate` after every batch of rules. `mapping_spec` is the dev/JIRA handoff.",
      "6. Import the file via Mapping Studio Import; structural validation here mirrors that import.",
      "",
      "Pitfalls: plan names must match exactly; unknown plans fail closed. Live field-name truth comes from the paired tab (`erd_live_discover`), not from memory - verify custom __c names there.",
    ].join("\n"),
  },
  "notes": {
    when: "Design notes, workshop capture, meeting records. Use when the architect needs a Markdown record that pastes into the studio Notes tab.",
    body: [
      "# Notes skill",
      "",
      "1. `note_create` with Markdown body; `note_append` adds timestamped sections (separator automatic).",
      "2. Bodies paste straight into the studio Notes tab - keep headings + bullets, no HTML.",
      "3. One note per topic; link related decisions by mentioning their ADR numbers in text.",
      "",
      "Pitfalls: 20KB per write - split long workshops across appends.",
    ].join("\n"),
  },
  "pairing": {
    when: "Pair this agent session with an open GRAVENX tab before any erd_live_* or system_live_* tool. Read this skill first in every bridged session.",
    body: [
      "# Pairing skill",
      "",
      "1. Start the hub (`npm run mcp` in gravenx-mcp). It prints a pairing code + pair link.",
      "2. The architect enters the code in Setup > Terminal Bridge. The tab dials the hub; you see `tab paired`.",
      "3. Pairing IS the authorization. Never ask per command; never ask for tokens, passwords, or org credentials - you never see them.",
      "4. `skill_list` + `skill_read` the packs for your task, then `*_snapshot` BEFORE any write. Stale context is the root cause of every \"ack but nothing changed\".",
      "5. Writes pause for architect approval in the tab unless bridge auto mode is on. A denial is a decision, not an error - report it and stop that line.",
      "6. If the socket drops, the tab re-pairs with a fresh code. Ask the architect for it; never reuse an old code.",
      "",
      "Pitfalls: one paired tab per session; a second tab steals nothing but commands route to the paired one. No paired tab means live tools fail - say so plainly and work file-side instead.",
    ].join("\n"),
  },
  "sequence": {
    when: "Sequence interaction models - parse the DSL, validate control blocks, export Mermaid. Use when the architect describes system-to-system behavior over time.",
    body: [
      "# Sequence skill",
      "",
      "1. `sequence_parse` first: paste the architect's statements (sync `->`, async `->>`, `loop`, `parallel`, `retry`, `timeout`, `try/catch`) into the canonical interaction model. The diagram is a projection - the model is truth.",
      "2. Participants should resolve to the System Design registry (same names as `system_live_snapshot`), not free text. Ask when a name doesn't match a known system.",
      "3. `sequence_validate` after every edit: unclosed blocks, orphan replies, missing timeout/retry on cross-boundary calls.",
      "4. `sequence_mermaid` is the export format for docs and PRs. Mermaid is output only - never hand-edit it and re-import.",
      "5. `sequence_create` persists the validated model; `sequence_list` recalls it. One interaction per sequence - split sagas, don't nest sagas.",
      "",
      "Pitfalls: draft edges from System Design are order guesses, not sequence evidence. Retry/timeout/compensation blocks are semantic (they drive future execution), not decoration - don't add them speculatively.",
    ].join("\n"),
  },
  "system-import": {
    when: "Postman Collection to system topology import. Use when the architect hands you a collection to turn into a canvas.",
    body: [
      "# System import skill",
      "",
      "1. `system_import_postman` takes the collection JSON (or a workspace file). One system per top-level folder, one operation per request, draft edges in collection order.",
      "2. Types are guessed from host (salesforce/servicenow/middleware/queue/rest) - correct them on canvas.",
      "3. Draft edges are ORDER GUESSES, never asserted flows. Confirm, rewire, or delete each one.",
      "4. Auth headers and cookies are DROPPED on import and counted - never ask for them, never re-add secrets.",
      "5. Cap: 200 requests / 500KB - split big collections by folder first.",
      "6. Open the file via System Design Import; `system_summarize` inventories it headlessly.",
    ].join("\n"),
  },
  "system-live": {
    when: "Drive the open System Design tab through the bridge (paired tab required). Use for topology design, draft edges, and canvas layout.",
    body: [
      "# System live skill",
      "",
      "1. `system_live_new` starts a blank project from scratch when nothing is open - then snapshot/place/connect.",
      "2. `system_live_snapshot` is canvas truth: systems with types/positions, connections with status.",
      "3. `system_live_place` by type (salesforce, middleware, queue, ...) - max 10 per call, names optional.",
      "4. `system_live_connect` draws DRAFT edges by system name. Drafts are proposals - the architect confirms topology on canvas. Never present a draft edge as an asserted integration.",
      "5. `system_live_remove` drops systems and their dangling connections.",
      "6. Pair with `system_import_postman`: import the collection, snapshot it, then rewire the drafts into the real topology with the architect.",
      "7. `system_live_rebalance` tidies the canvas into a readable flow when the architect drags things around.",
      "",
      "Pitfalls: names resolve exactly-then-substring; ambiguity errors list candidates. Start blank with `system_live_new` when nothing is open.",
    ].join("\n"),
  },
  "wireframe": {
    when: "Schema-aware wireframe experiences - screens of structured components bound to Salesforce schema. Use when the architect models a UI before building it.",
    body: [
      "# Wireframe skill",
      "",
      "1. `wireframe_create` opens the experience, `wireframe_add_screen` per route/view, `wireframe_add_component` per element. Canvas position is a view property - the experience model is truth.",
      "2. Every data-bound component declares its state: EXISTING (`Account.Name`), PROPOSED (`Customer_Segment__c` + type), or EXTERNAL (source system + API). Never bind a field you haven't verified.",
      "3. Proposed fields accumulate into a schema delta - report it alongside the design so the architect approves new API names deliberately.",
      "4. `wireframe_validate` checks bindings and interaction intents (click -> save -> PATCH). `wireframe_spec` is the Cursor/Claude Code build handoff.",
      "5. Keep V1 to the core set (form, layout, data components). A wireframe that tries to be a design system stops being a thinking tool.",
      "",
      "Pitfalls: component names are experience-scoped; screen names must be unique. The spec embeds the schema delta - regenerating after binding changes, never hand-editing the old spec.",
    ].join("\n"),
  },
};

export function listSkills(): { name: string; when: string }[] {
  return Object.entries(SKILLS).map(([name, s]) => ({ name, when: s.when }));
}

export function readSkill(name: string): string {
  const key = name.trim().toLowerCase();
  const hit = SKILLS[key];
  if (!hit) {
    throw new Error(`Unknown skill "${name}". Available: ${Object.keys(SKILLS).join(", ")}.`);
  }
  return hit.body;
}

export const skillTools: McpTool[] = [
  {
    name: "skill_list",
    description: "List GRAVENX skill packs (activity, builder, contracts, erd-live, governance, mapping, notes, pairing, sequence, system-import, system-live, wireframe). Read the relevant pack before planning work on that surface.",
    shape: {},
    run: async () => ({ ok: true, summary: `${Object.keys(SKILLS).length} skill packs.`, data: { skills: listSkills() } }),
  },
  {
    name: "skill_read",
    description: "Read one skill pack: conventions, tool order, pitfalls for that surface.",
    shape: { name: z.string().min(1).max(40) },
    run: async (_dir, args) => {
      try {
        const body = readSkill(args.name as string);
        return { ok: true, summary: `Skill "${(args.name as string).trim().toLowerCase()}".`, data: { markdown: body } };
      } catch (e) {
        return { ok: false, summary: "Unknown skill.", error: e instanceof Error ? e.message : "Unknown skill." };
      }
    },
  },
];
