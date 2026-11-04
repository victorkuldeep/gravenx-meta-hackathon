# GRAVENX Skills Bundle

12 Agent Skills playbooks for terminal agents driving GRAVENX through `gravenx-mcp`.
Markdown files are canonical; `mcp/tools/skills.ts` is generated from them (`npm run skills:sync`).

## What's inside

| Skill | When to read it |
|---|---|
| `pairing` | FIRST in every bridged session - pair code, auto mode, snapshot-first discipline |
| `erd-live` | Driving the open ERD tab (canvas, schema discover, Author mode) |
| `system-live` | Driving the open System Design tab (topology, drafts, rebalance) |
| `mapping` | Source-to-Salesforce field mapping |
| `builder` | REST payloads + Composite batches |
| `contracts` | Consumer API contracts |
| `notes` | Design notes + workshop capture |
| `system-import` | Postman Collection -> topology |
| `governance` | ADRs, requirements, traceability, JIRA drafts |
| `activity` | Org-mutation audit trail |
| `sequence` | Sequence interaction models |
| `wireframe` | Schema-aware wireframe experiences |

Agent loop: `skill_list` -> `skill_read` (task packs + `pairing`) -> `*_snapshot` -> act -> snapshot again.

## Install

Unzip the release asset (or use this checkout), then run as YOUR user:

```sh
node scripts/install-skills.mjs --target claude     # ~/.claude/skills
node scripts/install-skills.mjs --target codex      # ~/.codex/skills
node scripts/install-skills.mjs --target cursor     # <project>/.cursor/skills
node scripts/install-skills.mjs --target opencode   # <project>/.opencode/skills
```

Options: `--source <bundle dir>` (default: this repo's `skills/`), `--project <dir>`
for cursor/opencode, `--dir <dir>` to override the destination entirely,
`--list` to show targets.

## MCP server wiring

Point your agent at the MCP bundle (stdio):

- Claude Code (`.mcp.json`): see `mcp/clients/claude-mcp.json`
- Cursor / opencode: see `mcp/clients/cursor-mcp.json`, `mcp/clients/opencode.json`
- Codex (`~/.codex/config.toml`): see `mcp/clients/codex-config.toml`

Then verify inside the agent: call `skill_list` (12 packs), `skill_read` with
`{"name": "pairing"}`, and ask the architect for a pairing code.
