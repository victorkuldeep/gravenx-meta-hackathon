# gravenx-mcp — headless GRAVENX for terminal agents

A local **stdio MCP server** that lets Cursor, Claude Code, Muse, Codex and
OpenCode operate the studio's domain models through files: sequences,
wireframe experiences, system projects, ERD canvases, decisions, requirements
and console tasks. It reuses the exact `lib/` validators the studio UI uses,
so anything the agent writes the studio can open.

**Direction of travel:** MCP sits between the terminal agent and GRAVENX.
The agent authors workspace `*.json` files; the architect opens them with
the studio **Import** buttons. No Ask-AI detour, no API keys in the loop.

## Distribution (no source needed)

The server ships as **one self-contained file** — no repo clone, no
`node_modules`, no source on the target machine. Only system `node` is
required. Build it with:

```sh
npm run mcp:bundle   # -> mcp/dist/gravenx-mcp.cjs (~860 KB)
```

Copy `gravenx-mcp.cjs` to any machine (laptop, showcase laptop, MD's desk)
and point the client at it. Replace `<DIST_DIR>` with the folder holding the
file and `<WORKSPACE_DIR>` with where record files should live.

**Cursor** — copy `mcp/clients/cursor-mcp.json` to `.cursor/mcp.json`
(or merge the `gravenx` entry), then restart Cursor.

**Claude Code** — copy `mcp/clients/claude-mcp.json` to `.mcp.json`,
or register imperatively:

```sh
claude mcp add --transport stdio gravenx \
  --env GRAVENX_WORKSPACE=<WORKSPACE_DIR> \
  --env GRAVENX_BASE_URL=https://studio.yourdomain.com \
  -- node <DIST_DIR>/gravenx-mcp.cjs
```

**Muse** — same shape as Claude Code:

```sh
muse mcp add --transport stdio gravenx \
  --env GRAVENX_WORKSPACE=<WORKSPACE_DIR> \
  -- node <DIST_DIR>/gravenx-mcp.cjs
```

**OpenCode** — merge `mcp/clients/opencode.json` into your `opencode.json`.

**Codex CLI** — add to `~/.codex/config.toml`:

```toml
[mcp_servers.gravenx]
command = "node"
args = ["<DIST_DIR>/gravenx-mcp.cjs"]
env = { GRAVENX_WORKSPACE = "<WORKSPACE_DIR>" }
```

**Developing from source** (studio contributors only): `npm run mcp`
runs `mcp/server.ts` via tsx with live `@/lib` imports.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `GRAVENX_WORKSPACE` | `<cwd>/gravenx-workspace` | Where record files live (gitignored) |
| `GRAVENX_BASE_URL` | `http://localhost:3000` | Studio origin, used only by `erd_share_canvas` |

## Tool catalog

| Tool | What it does |
|---|---|
| `sequence_parse` | Validate interaction DSL, no file written |
| `sequence_create` | DSL → studio package file (sync/async, loop, condition, parallel, retry, note) |
| `sequence_mermaid` | Stored sequence → Mermaid `sequenceDiagram` text |
| `sequence_validate` / `sequence_list` | Studio-grade schema check / inventory |
| `wireframe_create` | Empty experience package file |
| `wireframe_add_screen` | Add a screen card |
| `wireframe_add_component` | Add palette component, optional Salesforce binding (`sffield`, `sflookup`, `sfpicklist`, …) |
| `wireframe_get` / `wireframe_validate` / `wireframe_spec` / `wireframe_list` | Read, check, emit the AI build spec, inventory |
| `system_create_sample` | Starter topology: `demo`, `tmf`, `groq`, `fanout`, `revenue`, `cdc`, `retry` |
| `system_validate` / `system_summarize` / `system_list` | Import-grade check / inventory / list |
| `erd_create_canvas` | Objects + root → auto-gridded structure file |
| `erd_validate` / `erd_list` | Backend-grade check / inventory |
| `erd_share_canvas` | POST the structure to your running studio, get a 30-min link (opt-in network) |
| `decision_create` / `decision_list` | ADR records, auto-numbered, studio-importable |
| `decision_update` | Status trail (proposed→in-review→accepted) + text revision, history appended |
| `decision_link` | Link a decision to system/wireframe/sequence/draw/schema |
| `decision_summarize` | Review digest: counts, open items, accepted governance |
| `requirement_create` / `requirement_list` | REQ records, auto-numbered, studio-importable |
| `requirement_update` | Move open→covered→verified, revise body |
| `requirement_link` | Link a requirement to coverage (incl. decisions) |
| `jira_draft` | Story draft with acceptance criteria from open decisions/requirements/mapping, saved as a note |
| `console_create_task` / `console_list_tasks` | Console queue entries (task/note/question/decision) |
| `mapping_create` / `mapping_add_plan` / `mapping_add_rule` | Screen/payload→Salesforce mappings, plans + field rules |
| `mapping_validate` / `mapping_spec` / `mapping_list` | Studio-import check / JIRA handoff Markdown / inventory |
| `payload_build` | One REST payload: method + object + fields → runnable URL + JSON |
| `composite_create` / `composite_add_request` | Ordered subrequest batches with @{ref.id} references |
| `composite_validate` / `composite_payload` / `composite_list` | Structural check / runnable Composite JSON + order / inventory |
| `contract_create` / `contract_add_field` | Consumer↔Salesforce contracts, field mappings |
| `contract_validate` / `contract_spec` / `contract_list` | Studio-import check / review Markdown / inventory |
| `note_create` / `note_append` / `note_get` / `note_list` | Markdown design notes, paste into Notes |
| `system_import_postman` | Postman Collection → system project (draft edges, secrets dropped) |
| `skill_list` / `skill_read` | Playbooks per surface - read before planning |
| `workspace_files` | Every file + envelope type |
| `bridge_status` | Hub health + pairing instructions when no tab is connected |
| `erd_live_snapshot/objects/discover` | Read canvas, browse org schema, parents/children (reads free) |
| `erd_live_place/hide/remove/focus/mode/filter` | Curate the live canvas (approval-gated unless auto mode) |
| `erd_live_tags` | List/create/assign/unassign/delete canvas tags |
| `erd_live_author_field/object` | Author-mode deploys through the tab session (audited) |
| `activity_live_list` | Read the tab's org-mutation audit trail |
| `system_live_snapshot/place/connect/remove` | Read, place, draft-connect, and remove on the System canvas |

## Demo script (MD showcase)

1. `npm run mcp` in one terminal (or connect your agent first).
2. Ask the agent: *"Create a sequence for order-to-fulfillment: Salesforce
   creates the order in Middleware, Middleware fans out to ServiceNow and
   updates Salesforce, with a retry around the billing call."*
3. The agent writes `gravenx-workspace/sequence-<slug>.json`.
4. Sequence Studio → **Import** → the file renders as a live diagram.
5. Ask for Mermaid (`sequence_mermaid`) and paste it into the review doc.

Same loop works for wireframes (`wireframe_*` → Wireframe Studio Import),
topologies (`system_create_sample` / `system_import_postman` → System Import),
mappings (`mapping_*` → Mapping Import), batches (`composite_payload` → REST
runner), contracts (`contract_*` → Contracts Import), and governance
(`decision_create`, `jira_draft` → Import / JIRA).

## Security posture (V1, by design)

- Files only. The server reads/writes the workspace dir and nothing else.
- No Salesforce tokens, no org calls, no secrets in files — ever. Prompts
  that look like tokens are not executed anywhere; there is no executor.
- `erd_share_canvas` is the single network call: an explicit POST of an
  org-independent structure to an origin **you** configure. Everything else
  is offline.
- Overwrites are refused unless the caller passes `overwrite: true`, and
  ambiguous refs resolve to an error naming every match, never a guess.

## Troubleshooting

- *"tsx: command not found"* — run from the repo root so `npx` finds the
  local dev dependency, or `npm i -D tsx` if it was pruned.
- *"Share backend unreachable"* — start the studio (`npm run dev`) or set
  `GRAVENX_BASE_URL` to the deployed origin (shares need a live backend).
- *Client shows no tools* — restart the client after adding the config;
  most clients only read MCP servers at launch.
