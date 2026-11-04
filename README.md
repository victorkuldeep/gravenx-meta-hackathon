# GRAVENX — Architecture Engineering Studio

Graph-based architecture engineering environment for designing, connecting, and executing systems — built for Salesforce architects, API-first teams, and integration practitioners. Connect any org, explore live metadata, design ERDs and system topologies on canvas, decompose Apex logs, and drive the whole studio headlessly from terminal coding agents.

> **Meta Hackathon submission.** GRAVENX — Architecture Engineering Studio, a full MIT-licensed product built for the hackathon. Companion repo [`gravenx-mcp`](https://github.com/victorkuldeep/gravenx-mcp) — the MCP server + WebSocket bridge for terminal-agent control. Submitted together: `gravenx-mcp` + `gravenx-meta-hackathon`.

## Quickstart

```sh
npm install
npm run dev        # http://localhost:3000
```

Production build and Cloudflare Workers deploy:

```sh
npm run build            # Next.js production build
npm run build:worker     # OpenNext Cloudflare build
npm run preview          # local worker preview
npm run deploy           # deploy to Cloudflare
```

Connect to Salesforce from the home page (or any tab header): enter your org URL + access token, accept the terms, Test & Connect. The token stays in tab `sessionStorage` and is proxied server-side to your org only — never written to disk, logs, or the model layer.

## What you can do

- **Builder / Composite** — accurate REST payloads and composite batches from live field metadata, with collections, test runner, and OpenAPI validation.
- **Query** — SOQL with query-plan inspection, chunked auto-pagination, aggregates, and a premium results grid; SOSL search across objects.
- **Schema** — ERD + graph views of objects, pull parents/children, record grids, record-type and picklist management, and **Author mode** to create fields/objects from the canvas via the Metadata/Tooling APIs.
- **System Design** — drag systems onto canvas, wire live APIs (GET/POST/PATCH), define transforms, run end-to-end flow simulations with mocks, rebalance layouts, export PNG/Markdown run reports.
- **Sequence** — interaction DSL (sync/async, loops, conditions, parallel, retry, compensation) rendered as architecture sequence diagrams; convertible to/from System Design.
- **Wireframe** — schema-aware UI modeling bound to Salesforce fields (existing / proposed / external), with AI build-spec generation.
- **Draw+** — self-hosted Excalidraw whiteboard (fonts + assets served from our own origin, no CDN).
- **Mapping** — source-to-Salesforce field mapping projects with AI suggestions.
- **Log Decomposer** (`/log-decomposer`) — one-click trace setup, deterministic Apex log parsing into execution trees + flow graphs, timeline, raw log viewer (light/dark), request-chain grouping, auto-detected findings, hotspots, verdict + narrative investigation, RCA board with Markdown handoff, and secrets masking.
- **Console** — architect's task console aggregating canvas TODOs, notes, ADRs, requirements, and JIRA/ServiceNow pushes.
- **Docs** — in-app runbook and onboarding guide.

## AI layer

Ask AI is gated on a live Salesforce connection. Bring your own key — OpenAI, OpenRouter, Groq, Anthropic, Gemini, or DeepSeek — configured in Model Studio. Per-surface skills + tools let the agent query SOQL/SOSL, read ERD canvases, run flows, and explain logs without ever seeing your token (keys stay in the tab, forwarded per request, never stored).

## Headless control — gravenx-mcp + skills bundle

Terminal agents (Claude Code, Codex, Cursor, OpenCode, Muse) drive the studio two ways:

1. **MCP stdio server** — a single self-contained bundle, no source checkout needed on the agent machine:
   ```sh
   npm run mcp:bundle   # -> mcp/dist/gravenx-mcp.cjs
   ```
   Wire it per `mcp/README.md` (`mcp/clients/` has ready-made configs for Claude, Cursor, OpenCode, Codex). The public package lives at [`gravenx-mcp`](https://github.com/victorkuldeep/gravenx-mcp).
2. **Live WebSocket bridge** — open `/setup` in the studio, enable the bridge, and pair with the 6-digit code. The agent then operates the *open* ERD/System canvas in real time (discover, draw, filter, Author-mode changes).
3. **Skills bundle** — 12 agent playbooks (`skills/`: pairing, erd-live, system-live, mapping, builder, contracts, notes, governance, …). Install into your agent:
   ```sh
   node scripts/install-skills.mjs --target claude   # ~/.claude/skills
   node scripts/install-skills.mjs --target codex    # ~/.codex/skills
   node scripts/install-skills.mjs --target cursor   # <project>/.cursor/skills
   ```
   Agent loop: `skill_list` → `skill_read` (task pack + `pairing`) → snapshot → act → snapshot again.

## Privacy & compliance

- GDPR banner + Privacy / Terms / Security links on the home page and in the connect dialog.
- Tokens in session memory only; reads, edits, and Author-mode schema changes travel the same proxied path.
- Self-hosted Inter font and Excalidraw assets — no runtime CDN or Google Fonts calls.

## License

MIT — see [LICENSE](./LICENSE). Excalidraw integration attribution in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

Designed by an architect, for architects. Built with Muse Spark.
