# GRAVENX Runbook — The Architecture Engineering Studio

Graph · Relationships · Architecture · Vertices · Engineering · Nexus.
A hand-crafted studio for architects: Salesforce metadata and data, ERD/Graph,
runnable system-integration topologies, whiteboard, wireframes, and sequences —
with an AI agent that works every surface.

**Lifecycle:** Think → Model → Design → Connect → Build → Execute.

## 1. Connect to Salesforce (the front door)

Everything org-aware hangs off one connection.

1. Click **Connect** in the header.
2. Paste your **instance URL** (`https://your-org.my.salesforce.com`) and an **access token**.
3. Tick **Accept Terms & Conditions and Privacy Policy** (links are right there), then **Test & List → Connect**.

Get a token via Workbench (login → jump to `/services/data`), `sf org display`,
or a Connected-App OAuth flow.

**Non-negotiables:**
- Token lives in **session memory only** — never disk, never logs, never IDB.
- All org calls are **proxied server-side** to your org; the browser never talks to Salesforce directly.
- Accepting Terms gates the Connect button; Privacy/Terms/Security links live in the footer and the connect dialog.
- The AI dock unlocks **only while connected** (V1 gate: org connection is login).

## 2. Studio tour (tabs)

| Tab | Route | What it does |
|---|---|---|
| Studio home | `/` | 7 modes: Home, Builder, Composite, Query, GraphQL, Schema, REST |
| Builder | home | Object + fields → POST/PATCH payloads; export JSON/cURL/fetch/Apex; test with confirm |
| Composite | home | Dependent creates/updates in one round trip |
| Query | home | SOQL **and** SOSL toggle; flattened grid; history tagged by mode |
| GraphQL | home | Same objects shaped for UI-driven queries |
| Schema (ERD/Graph) | home | sObjects as ERD + Graph; **Data Walkers** open live records; **Author mode** creates fields/objects/relationships (Tooling API, confirmed) |
| REST | home | REST explorer with collections |
| JSON Studio | `/json` | Editor-first: browse/collapse/search/edit any document; Compare A/B side-by-side, unified, findings |
| System Design | `/system` | Runnable integration topologies: systems, API operations, connections, transforms, flows, mocks, runs |
| Mapping | `/mapping` | Project umbrellas (e.g. Accenture) holding many integration mappings + screen-to-payload mapping |
| Validate | `/validate` | OpenAPI validation: spec + payload → walk every finding |
| Architect | `/architect` | Design custom APIs from Salesforce models: intent → operations → schemas → review |
| Contracts | `/contracts` | OpenAPI contracts from live metadata: profiles, operations, mappings, validation |
| Draw+ | `/draw` | Excalidraw whiteboard, self-hosted (zero CDN), IDB autosave, **Send to System Design** |
| Wireframe | `/wireframe` | Schema-aware experience modeling (screens of structured components bound to Salesforce schema) |
| Sequence | `/sequence` | Interaction modeling in a small DSL; two-way bridge with System Design; PNG/Mermaid export |
| Docs | `/docs` | This runbook as searchable in-app onboarding |
| Console | `/console` | Task manager: lifecycle, notes, timeline, two-way sync with System canvas TODOs |
| AI | dock | Agentic assistant with per-tab skills + tools (see §5) |

All work autosaves to **IndexedDB** — reload-safe. Wireframe/Sequence/System projects
export/import as portable JSON packages for fellow devs.

## 3. System Design — the flagship

Design the topology, then **simulate end-to-end runs**.

**Canvas:** drag systems from inventory (Salesforce, Middleware, Queue, DB, REST,
GraphQL, ServiceNow, custom…), connect operations edge-to-edge, `⌘/Ctrl+Z` undo,
`Del` removes. Two-finger scroll pans; diagonal pinch zooms.

**Per node:** base URL, interfaces, operations (GET/POST/PATCH) with headers/body,
per-node **mock responses** for systems behind VPN/Zscaler or not built yet.

**Chaining:** `$body` carries the previous response forward; `$vars` extract and
transform. A middleware POST can pass the payload as-is or reshape it
(e.g. wrap into `{ event: { productOrder: $body } }`).

**Flow Lab:** named run sequences — the replayable path across N systems × M APIs
(start edge + lanes + operation picks). Save any ad-hoc chain via **From last run**.
**Scenarios:** flow + seed input + mocks + expectations; replay before every deploy.
**Runs & Observability:** every run traces forward and backward, downloadable as
Markdown; saved to IDB.
**Settings → Environments:** base URLs only — tokens live in the session vault, never here.
Production targets ask for explicit confirm first.

### Example A — TMF order through middleware (the classic)

1. **Salesforce node:** `GET /services/apexrest/tmf/productOrderingManagement/v5/productOrder/revenueCloud/00000238` → TMF 622 order JSON.
2. **Middleware node:** two operations —
   - `POST /TMF622v401/productOrder` receiving `$body` **as-is** (own auth header on the node);
   - `POST /TMF688v400/topic/TMF622-v401-Events/event` receiving the **transform**: `{ event: { productOrder: $body } }`.
3. Build a **Flow**: Salesforce GET → Middleware op-1 (or op-2). **Run**; responses trace all the way back.
4. Where the hub isn't reachable, flip that node to **mock** with a recorded 201 and keep designing.
5. Save as **Project**, export the run as Markdown, share the package JSON with the team.

Scale the same pattern to Salesforce → Middleware → Kafka → Snow/adapters with
fan-out, async responses, and compensation notes on the edges.

## 4. Wireframe + Sequence — design that ships

**Wireframe (`/wireframe`)** — the canvas is a view; the **Experience Model** is truth.
Screens hold structured components (input, select, table, SF lookup/picklist…),
each bound **Existing** (`Account.Name`), **Proposed** (`Annual_Contract_Value__c`),
or **External** (credit API). Proposed fields land in the **Delta panel** and the
**Author queue** (prefilled, human-confirmed). **API panel** shows impact
(GET/PATCH/related); **Build spec** emits machine-readable implementation
artifacts + AI instructions for Cursor/Codex. States flow
Draft → **In Review** → Approved (clone any experience to fork it).
Snapshots freeze client cuts; **History** exports PNG 2x/3x + full packages.

**Sequence (`/sequence`)** — describe, don't draw. The DSL is the source of truth:

```text
Salesforce -> Middleware: Create Order
Middleware -> ServiceNow: Create Fulfillment
ServiceNow --> Middleware: 201 Created
Middleware --> Salesforce: Order Created

loop each Order Line
    Middleware -> ServiceNow: Create Line
end

parallel
    Middleware -> Salesforce: Update Status
    Middleware -> EventBus: OrderCreated
join
```

Blocks: `loop`, `if/else`, `parallel/join`, `retry`, `timeout`, `try/catch`,
`wait`, `note`, `event`. **System bridge** imports your topology honestly
(lossy where the models differ — it says so); sequence → System sends flows back.
Export PNG 2x/3x, Mermaid (export-only), or full packages.

### Example B — portal RFD in one sitting

1. Wireframe: type "Customer Management Portal" in the name box → **New Exp** → open it → add screen "Customer Detail".
2. Schema panel → drag `Account.Name/Phone/Industry`; type "Customer Segment" → **proposed picklist**.
3. Save button → `wire_interact` click → PATCH Account. Delta shows `+2 fields`.
4. **Build spec** → paste into Cursor → real React form. Author queue creates the fields after client approval.
5. Sequence the save path; send the flow to System Design; simulate against mocks.

## 5. AI — agentic, gated, honest

Open the **AI dock** (header). Pick/configure providers in **Model Studio**
(OpenAI / Anthropic / OpenRouter / Gemini / DeepSeek / Groq — BYOK, session-only,
Test & List → Activate). The agent detects your tab and loads its **skill**:

| Where you are | Agent can (tools) |
|---|---|
| System | `system_describe`, `system_add`, `system_connect` |
| JSON | `json_inspect` (structural census) |
| Studio home | `query_soql_build`, `query_sosl_build`, `erd_snapshots` |
| Draw+ | `draw_describe`, `draw_add_shape/text/arrow` |
| Console | `console_describe`, `console_add/note/move` (two-way canvas sync) |
| Wireframe | 8 `wire_*` (describe/components/delta/spec + add screen/component/bind/interact) |
| Sequence | `seq_describe`, `seq_messages`, `seq_apply` |
| Mapping / Validate / Architect / Contracts | advisor mode — explicit plans in words, **never claims tools** |

**Rules the agent lives by:** reads run free; **every mutation pauses for your
Apply/Discard** (discards are never retried unasked); max 8 steps per message;
key forwarded per request, never stored; per-org chat history in IDB with restore.

**Prompts that work:**
- System: *"Trace a path: Salesforce GET order → hub POST as-is → show me the transforms."*
- Wireframe: *"Add a Customer Detail screen with Account Name/Phone plus a proposed Segment picklist."*
- Sequence: *"Model the retry path when ServiceNow 500s, then send it to System."*
- Draw+: *"What's on my board? Add a Middleware :8080 box."*
- Studio: *"Build the SOQL for Account Name/Industry where Type is Customer, hand me the /query URL."*

## 6. Share, privacy, housekeeping

- **Share live boards** via Cloudflare KV links (bindings survive Git deploys via `wrangler.jsonc`; dashboard build command must be `npm run build:worker`).
- **Privacy/GDPR:** banner + Privacy/Terms/Security pages (`/privacy`, `/terms`, `/security`); Terms acceptance gates Connect; tokens never touch disk.
- **Draw+** ships zero-CDN Excalidraw (self-hosted assets/fonts, `font-src 'self'`).
- **Troubleshooting:** Groq/keys failing → use Model Studio Test & List (adapters ride the `/api/ai/*` proxy, never direct). Canvas weird after reload → Schema restores at root node; Draw restores exact scene. HMR poison (`__webpack_modules__`) → delete `.next` and rebuild.
