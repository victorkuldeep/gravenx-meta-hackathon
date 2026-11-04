/**
 * Onboarding docs content - architect onboarding to the GRAVENX platform.
 *
 * Structured blocks (not raw markdown) so the docs route can render search,
 * diagrams and route chips natively. Keep entries tight: one idea per block.
 */

export type DocDiagram = "lifecycle" | "system-flow" | "wire-binding" | "seq-mini";

export type DocBlock =
  | { k: "p"; text: string }
  | { k: "list"; items: string[] }
  | { k: "code"; lang: string; text: string }
  | { k: "callout"; title: string; text: string }
  | { k: "diagram"; name: DocDiagram }
  | { k: "routes"; items: { href: string; label: string; note: string }[] };

export interface DocSection {
  id: string;
  group: string;
  title: string;
  keywords: string;
  blocks: DocBlock[];
}

export const DOC_GROUPS = [
  "Start here",
  "Build payloads",
  "Design & simulate",
  "Guides",
  "AI",
  "Reference",
] as const;

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "welcome",
    group: "Start here",
    title: "About GRAVENX",
    keywords: "about onboarding what is gravenx architect studio philosophy lifecycle",
    blocks: [
      {
        k: "p",
        text: "GRAVENX — Graph · Relationships · Architecture · Vertices · Engineering · Nexus. A hand-crafted Architecture Engineering Studio for architects: Salesforce metadata and data, ERD/Graph, runnable system-integration topologies, whiteboard, wireframes, and sequences — with an AI agent that works every surface. Designed by an architect, for architects.",
      },
      { k: "diagram", name: "lifecycle" },
      {
        k: "p",
        text: "One lifecycle runs through everything: Think (Draw+) → Model (Schema, Wireframe) → Design (System, Sequence) → Connect (org, APIs) → Build (specs, payloads) → Execute (runs, observability). Artifacts flow forward — a sketch becomes nodes, a wireframe becomes schema delta, a sequence becomes a runnable flow.",
      },
      {
        k: "callout",
        title: "14 tabs + AI",
        text: "7 home modes (Home, Builder, Composite, Query, GraphQL, Schema, Rest) plus 7 studios (JSON, Contracts, Architect, System, Draw+, Wireframe, Sequence) — and the AI dock, which follows you across all of them. Mapping and Validate are live companion routes.",
      },
    ],
  },
  {
    id: "connect",
    group: "Start here",
    title: "Connect your org",
    keywords: "connect token salesforce login terms session workbench oauth instance url",
    blocks: [
      {
        k: "p",
        text: "Everything org-aware hangs off one connection. Click Connect in the header, paste your instance URL and access token, tick Accept Terms & Conditions and Privacy Policy, then Test & List → Connect.",
      },
      {
        k: "list",
        items: [
          "Get a token via Workbench (login → jump to /services/data), `sf org display`, or a Connected-App OAuth flow.",
          "The token lives in session memory only — never disk, never logs, never IndexedDB.",
          "All org calls are proxied server-side to your org; the browser never talks to Salesforce directly.",
          "Accepting Terms gates the Connect button — no tick, no connect.",
          "The AI dock unlocks only while connected: in V1, org connection is login.",
        ],
      },
    ],
  },
  {
    id: "tour",
    group: "Start here",
    title: "Tab tour",
    keywords: "tabs navigation where tour home builder composite query graphql schema rest json",
    blocks: [
      {
        k: "p",
        text: "Home hosts 7 connected modes; the header links out to 7 independent studios. Each studio owns its tab, its autosave, and its export — nothing is a second-class citizen.",
      },
      {
        k: "routes",
        items: [
          { href: "/", label: "Home modes", note: "Builder · Composite · Query (SOQL+SOSL) · GraphQL · Schema ERD/Graph · REST" },
          { href: "/json", label: "JSON", note: "Editor-first documents + A/B compare" },
          { href: "/contracts", label: "Contracts", note: "OpenAPI contracts from live metadata" },
          { href: "/architect", label: "Architect", note: "Design custom APIs: intent → operations → review" },
          { href: "/system", label: "System", note: "Runnable integration topologies (flagship)" },
          { href: "/draw", label: "Draw+", note: "Self-hosted whiteboard + Send to System" },
          { href: "/wireframe", label: "Wireframe", note: "Schema-aware experience modeling" },
          { href: "/sequence", label: "Sequence", note: "Describe the interaction, see the architecture" },
          { href: "/mapping", label: "Mapping", note: "Project umbrellas of integration mappings" },
          { href: "/validate", label: "Validate", note: "OpenAPI spec vs payload findings" },
        ],
      },
    ],
  },
  {
    id: "console",
    group: "Start here",
    title: "Console: the architect's task manager",
    keywords: "console tasks todo timeline sync activity productivity workflow",
    blocks: [
      {
        k: "p",
        text: "Log tasks (ERD it, sequence it, draw it, API it), track Open → In Progress → Blocked / Awaiting Feedback → Resolved with markdown descriptions, screenshots, notes and due dates, and watch everything land on a vertical activity timeline. One lifecycle runs everywhere: Console, canvas TODOs and Inbox share the same statuses, and Console syncs two-way with System canvas TODOs - link a canvas item, and status moves plus notes push back to the owning project.",
      },
      {
        k: "list",
        items: [
          "Board groups by status; Timeline replays every creation, move, and note newest-first.",
          "Every link lands on the exact record (?task=, ?id=, ?project=&select=) - findings, runs and tasks open where they live.",
          "Link picker pulls live canvas TODOs and design notes — adopting the canvas status so both sides start agreed.",
          "Stale guard: if the canvas moved on, its side keeps the newer state and Console tells you.",
          "Export/import portable JSON packages (re-id, never overwrite).",
          "AI logs, notes, and moves through Apply-gated console_add / console_note / console_move.",
        ],
      },
      {
        k: "routes",
        items: [{ href: "/console", label: "Console", note: "Personal task console with canvas sync" }],
      },
    ],
  },
  {
    id: "decisions",
    group: "Design & simulate",
    title: "Decisions: Architecture Decision Records",
    keywords: "decisions adr architecture decision records propose accept govern traceability",
    blocks: [
      {
        k: "p",
        text: "Decide once, trace everywhere. Each decision is a numbered ADR (ADR-001…) with context, the concrete decision, alternatives considered, and consequences — linked to the systems, experiences, sequences, boards and schema it governs. Links address records, never copy them.",
      },
      {
        k: "list",
        items: [
          "Lifecycle: Proposed → In Review → Accepted, with Deprecated and Superseded terminals; illegal jumps refuse.",
          "Supersede names its successor, so the chain of reasoning never breaks.",
          "Link picker covers System, Wireframe, Sequence and Draw records; schema links arrive via AI or import.",
          "Export/import portable JSON packages (re-id and re-number, never overwrite).",
          "AI proposes, links, and moves through Apply-gated decision_propose / decision_link / decision_move.",
        ],
      },
      {
        k: "routes",
        items: [{ href: "/decisions", label: "Decisions", note: "Decision Studio with governed links" }],
      },
    ],
  },
  {
    id: "risks",
    group: "Design & simulate",
    title: "Risk lens: deterministic architecture review",
    keywords: "risks rules timeout retry idempotency chain spof review resilience policy validation proof verdict scenario reproduce",
    blocks: [
      {
        k: "p",
        text: "The Risks button on the System canvas runs deterministic rules over the model - sync chains, missing timeouts and retries, fan-in hubs, unversioned operations, naked sync calls in linked sequences. Every finding cites its records; unstated policy reads as unchecked, never as safe.",
      },
      {
        k: "list",
        items: [
          "State timeouts, retries and idempotency per operation in the Policy block; the lens only cites what is written.",
          "Each finding jumps to its records on the canvas and can become a linked ADR proposal in one click.",
          "Prove it drafts the failure scenario that tests the finding: reproduce expects the failure (a match confirms the risk), withstand expects the design to hold under latency.",
          "Proof chips read unproven, covered, proven-live, proven-mock, reproduced - derived from pinned run evidence, decaying past retention, never hand-marked.",
          "Track logs a Console task for the finding, linked to the project; run the scenario from Scenarios and the verdict lands on the evidence.",
          "AI reads proof through validation_status, drafts scenarios through Apply-gated scenario_propose_for_risk, and explains verdicts through verdict_explain - it proposes the test, the verdict judges the run.",
        ],
      },
      {
        k: "routes",
        items: [{ href: "/system", label: "System", note: "Risk lens lives on the System canvas" }],
      },
    ],
  },
  {
    id: "requirements",
    group: "Design & simulate",
    title: "Requirements: intent with receipts",
    keywords: "requirements req traceability coverage verify satisfied links",
    blocks: [
      {
        k: "p",
        text: "Each requirement (REQ-102…) states intent and links the systems, experiences, sequences, boards, schema and decisions that satisfy it. Coverage is computed from the live architecture graph - the Check coverage button reports covered counts and names every requirement without design.",
      },
      {
        k: "list",
        items: [
          "Lifecycle: Open → Covered → Verified, with Reopen; status is declared, coverage is derived.",
          "Links address records and land on them (?id=, numbers accepted); dangling links never count as coverage.",
          "Export/import portable JSON packages (re-id and re-number, never overwrite).",
          "AI logs, links, and moves through Apply-gated req_log / req_link / req_move - it never declares coverage.",
        ],
      },
      {
        k: "routes",
        items: [{ href: "/requirements", label: "Requirements", note: "Traceability with derived coverage" }],
      },
    ],
  },
  {
    id: "views-pack",
    group: "Design & simulate",
    title: "C4 views and the architecture pack",
    keywords: "c4 context container component views projections hierarchy pack export stakeholder",
    blocks: [
      {
        k: "p",
        text: "The Views button on the System canvas assigns context/container/component levels (with parents) and projects the same canvas four ways: All, Context, Container, Component. Unleveled projects show everything everywhere - levels are opt-in, never mandatory.",
      },
      {
        k: "p",
        text: "C4 is zoom levels for one architecture: Context is your system in its world (people plus external systems), Containers are the deployable units inside (apps, services, datastores, queues), Components are the modules inside one container. The fourth C4 level, Code, is deliberately out of scope - GRAVENX stops at Component.",
      },
      {
        k: "list",
        items: [
          "The dialog previews the hierarchy tree and reports how many systems each view shows.",
          "Suggest drafts levels and parents from topology and system type - preview with reasons, Accept fills unset only, per-node Unset undoes.",
          "Architecture pack downloads one Markdown bundle: topology, operation policy, touching sequences as DSL, linked decisions and requirements with derived coverage, risk findings, and a Validation section with scenarios, verdicts, and finding proof states.",
          "Wireframe experiences and Draw boards are per-surface and out of pack scope by design.",
        ],
      },
      {
        k: "routes",
        items: [{ href: "/system", label: "System", note: "Views and pack live on the System canvas" }],
      },
    ],
  },
  {
    id: "builder",
    group: "Build payloads",
    title: "Builder, Composite & REST",
    keywords: "builder composite rest payload post patch curl apex fetch collections postman",
    blocks: [
      {
        k: "p",
        text: "Pick an object, tick fields from live metadata, get accurate POST/PATCH payloads — no manual field copy-paste. Export as JSON, cURL ($SF_ACCESS_TOKEN placeholder, never the real token), JavaScript fetch, or Apex. Test sends run only after your confirm.",
      },
      {
        k: "list",
        items: [
          "Composite batches chain dependent creates/updates in one round trip.",
          "Collections live on the Builder/Composite/REST tabs where they are used — never in the header.",
          "Follow the thin sticky builder path at the bottom: Connect → Select → Configure → Export.",
        ],
      },
    ],
  },
  {
    id: "query",
    group: "Build payloads",
    title: "Query: SOQL, SOSL, GraphQL",
    keywords: "soql sosl graphql query search find record walker data",
    blocks: [
      {
        k: "p",
        text: "The Query toggle runs SOQL and SOSL side by side. SOSL rides a server proxy, lands in a flattened grid with an Object column, and history is tagged by mode so you always know which language produced a row.",
      },
      {
        k: "list",
        items: [
          "Build field lists from described metadata — required and restricted fields are flagged before you run.",
          "GraphQL mode shapes the same objects for UI-driven queries.",
          "Ask AI to draft the query and hand you the runnable /query URL — it validates shape, never executes reads itself.",
        ],
      },
    ],
  },
  {
    id: "schema",
    group: "Build payloads",
    title: "Schema: ERD, Graph & Author",
    keywords: "erd graph schema objects relationships author create field metadata tooling api walker dml",
    blocks: [
      {
        k: "p",
        text: "See how objects are structured (ERD + Graph canvas), then take a record ID and walk live data with Data Walkers — including guarded DML. Design mode closes the loop: create fields, objects, and relationships from the canvas itself via the Tooling API, always confirmed.",
      },
      {
        k: "list",
        items: [
          "Canvas restores at the root node, centered — reloads never strand your graph.",
          "Two-finger scroll pans; diagonal pinch zooms (same gesture contract as System).",
          "Wireframe's proposed fields can prefill the Author queue — design first, create after approval.",
        ],
      },
    ],
  },
  {
    id: "json",
    group: "Build payloads",
    title: "JSON Studio",
    keywords: "json editor compare tree browse collapse search edit diff",
    blocks: [
      {
        k: "p",
        text: "Editor-first: paste on the left, then browse, collapse, search, and edit every node. Compare A/B walks two payloads node by node — side-by-side, unified, or findings-only.",
      },
    ],
  },
  {
    id: "mapping",
    group: "Build payloads",
    title: "Mapping",
    keywords: "mapping project transform field map screen payload accenture",
    blocks: [
      {
        k: "p",
        text: "A project umbrella (e.g. Accenture) holding many integration mappings plus UI screen-to-payload mapping. Everything stays in your browser; import/export mapping JSON to share with the team.",
      },
    ],
  },
  {
    id: "validate",
    group: "Build payloads",
    title: "Validate",
    keywords: "validate openapi spec findings rules schema payload example orders",
    blocks: [
      {
        k: "p",
        text: "Import a spec (file, paste, or the labeled sample), match a payload, and walk every finding — schema vs rules, node by node. Draft minimal fixes until the payload satisfies the contract.",
      },
    ],
  },
  {
    id: "contracts",
    group: "Build payloads",
    title: "Contracts",
    keywords: "contracts openapi profiles operations revisions translation rename version",
    blocks: [
      {
        k: "p",
        text: "Design OpenAPI contracts from live Salesforce metadata — profiles, operations, mappings, validation — with explicit translations, renames, and versioning so implementations stay aligned with the contract.",
      },
    ],
  },
  {
    id: "architect",
    group: "Build payloads",
    title: "Architect",
    keywords: "architect custom api design intent operations schemas review",
    blocks: [
      {
        k: "p",
        text: "Design custom APIs from your Salesforce data models: declare intent, shape operations and schemas, then review before anything ships. The contract-first front door to implementation.",
      },
    ],
  },
  {
    id: "system",
    group: "Design & simulate",
    title: "System Design",
    keywords: "system topology integration middleware kafka flow run mock transform vars body scenario environment",
    blocks: [
      {
        k: "p",
        text: "The flagship: drag systems onto the canvas, wire real APIs underneath, and simulate end-to-end flows. Design on canvas, visualize, brainstorm — then run the topology for real or against mocks.",
      },
      { k: "diagram", name: "system-flow" },
      {
        k: "list",
        items: [
          "Systems carry base URLs, interfaces, and GET/POST/PATCH operations with headers and bodies.",
          "$body carries the previous response forward; $vars extract and reshape it mid-path.",
          "Unreachable hosts (VPN, Zscaler, not-built-yet) get per-node mocks — designing never blocks on access.",
          "Flow Lab names replayable paths across N systems × M APIs; save any chain via From last run.",
          "Scenarios bundle flow + seed input + mocks + expectations — replay before every middleware deploy.",
          "Scenario runs stamp a deterministic verdict (expectation vs terminal status, pinned at save) and can validate linked risk findings.",
          "Runs trace forward and backward, export as Markdown, and persist to IndexedDB.",
          "Signed overrides (Mark handled) record human judgment on the run; clearing one recomputes the verdict.",
          "Environments hold base URLs only; tokens live in the session vault. Production runs ask first.",
        ],
      },
    ],
  },
  {
    id: "draw",
    group: "Design & simulate",
    title: "Draw+",
    keywords: "draw whiteboard excalidraw sketch send to system freeform",
    blocks: [
      {
        k: "p",
        text: "Freeform engineering whiteboard powered by Excalidraw (MIT, integrated unmodified) — zero CDN, IDB autosave, full-bleed canvas. One labeled box per system, arrows between ports: Send to System parses the board into runnable nodes.",
      },
      {
        k: "list",
        items: [
          "AI can inventory the board and place labeled boxes, notes, and arrows (each placement needs your Apply).",
          "Labels carrying “Name :port” semantics convert cleanest into System nodes.",
        ],
      },
    ],
  },
  {
    id: "wireframe",
    group: "Design & simulate",
    title: "Wireframe",
    keywords: "wireframe experience screen component bind schema proposed delta api spec build",
    blocks: [
      {
        k: "p",
        text: "Schema-aware experience modeling. The canvas is a view; the Experience Model is the truth. Screens compose structured components bound to Salesforce schema — existing, proposed, or external.",
      },
      { k: "diagram", name: "wire-binding" },
      {
        k: "list",
        items: [
          "Existing fields bind live (Account.Name); proposed fields (Annual_Contract_Value__c) collect in the Delta panel and prefill the Author queue.",
          "Behavior intents (click → validate → PATCH) stay lightweight — System flows consume them later.",
          "API panel shows read/write/related impact per screen; Build spec emits Cursor-ready instructions.",
          "States flow Draft → In Review → Approved; clone any experience to fork it. Snapshots freeze client cuts.",
        ],
      },
    ],
  },
  {
    id: "sequence",
    group: "Design & simulate",
    title: "Sequence",
    keywords: "sequence dsl interaction participants messages loop parallel mermaid png bridge",
    blocks: [
      {
        k: "p",
        text: "Describe the interaction; see the architecture. The DSL is the source of truth and the diagram is its projection — never another drag-and-drop Mermaid.",
      },
      {
        k: "code",
        lang: "text",
        text: "Salesforce -> Middleware: Create Order\nMiddleware -> ServiceNow: Create Fulfillment\nServiceNow --> Middleware: 201 Created\nMiddleware --> Salesforce: Order Created\n\nretry 3 times\n    Middleware -> ServiceNow: Create Fulfillment\non failure\n    Middleware -> Salesforce: Mark Fulfillment Failed\nend",
      },
      { k: "diagram", name: "seq-mini" },
      {
        k: "list",
        items: [
          "Blocks: loop, if/else, parallel/join, retry, timeout, try/catch, wait, note, event.",
          "Two-way System bridge: import a topology honestly (lossy where models differ — it says so), send flows back.",
          "Export PNG 2x/3x, Mermaid round-trip (export .mmd, import it back), or full versioned packages.",
        ],
      },
    ],
  },
  {
    id: "studio",
    group: "Design & simulate",
    title: "Diagram Studio",
    keywords: "studio sketch draw boxes flowchart promote system png theme ai",
    blocks: [
      {
        k: "p",
        text: "Figma-for-systems sketching: drop system boxes and flowchart shapes, link them in seconds, no backend ceremony. Links are static - pure diagrams. System sketches promote to the System tab for real APIs; flowcharts export and deliver as-is.",
      },
      {
        k: "list",
        items: [
          "Palette: Salesforce, Middleware, REST, SaaS, Queue, Database, Custom - plus Process, Decision, Terminator and notes.",
          "Click a palette box to place it, drag between boxes to link, click anything to edit its label. Delete clears selection.",
          "Send to System needs at least one system box: boxes become real systems, links become draft connections, flow shapes ride along as notes.",
          "Theme sets the PNG background; scale picks 2x or 3x. The AI dock draws here too - ask it to place your boxes, adjust by hand, then promote.",
        ],
      },
      {
        k: "routes",
        items: [
          { href: "/studio", label: "Studio", note: "Sketch, then promote" },
          { href: "/system", label: "System", note: "Configure real APIs on promoted sketches" },
          { href: "/sequence", label: "Sequence", note: "Lightweight interaction diagrams" },
        ],
      },
    ],
  },
  {
    id: "guide-sketch-to-system",
    group: "Guides",
    title: "Guide: sketch to runnable system",
    keywords: "guide sketch promote system runnable draft sketch",
    blocks: [
      {
        k: "list",
        items: [
          "Studio tab: new sketch, place Salesforce + Middleware Hub, link them labeled Create Order.",
          "Ask the AI dock to add the fallback boxes, adjust by hand.",
          "Send to System - boxes arrive as real systems, the link as a draft connection.",
          "System tab: bind operations on the link, run end-to-end. Sketch in the morning, live by noon.",
        ],
      },
    ],
  },
  {
    id: "guide-order-flow",
    group: "Guides",
    title: "Guide: product order through middleware",
    keywords: "guide example order middleware hub events tutorial walkthrough",
    blocks: [
      {
        k: "p",
        text: "The canonical first simulation. Salesforce emits a product order; the hub takes it as-is on one operation or as an order event on another.",
      },
      {
        k: "list",
        items: [
          "Salesforce node: GET the productOrder URL → inspect the order JSON in the run trace.",
          "Middleware node: POST /v4/productOrder with $body as-is (hub auth header on the node).",
          "Second operation: POST the events topic with transform { event: { productOrder: $body } }.",
          "Flow: Salesforce GET → Middleware op-1. Run. Responses trace all the way back.",
          "Hub unreachable? Flip it to mock with a recorded 201 and keep designing.",
          "Save as Project, export the run as Markdown, share the package JSON.",
        ],
      },
    ],
  },
  {
    id: "guide-portal",
    group: "Guides",
    title: "Guide: portal RFD in one sitting",
    keywords: "guide example portal wireframe rfd cursor build spec author approval",
    blocks: [
      {
        k: "list",
        items: [
          "Wireframe: name the experience, add a Customer Detail screen.",
          "Schema panel: drag Account Name/Phone/Industry; type Customer Segment → proposed picklist.",
          "Save button: click → validate → PATCH Account. Delta shows +2 fields.",
          "Build spec → Cursor builds the React form; Author queue creates fields after client approval.",
          "Sequence the save path; send the flow to System Design; simulate against mocks.",
        ],
      },
      {
        k: "callout",
        title: "Why this order",
        text: "Experience first (what should exist?), schema second (what must change?), interaction third (what can break?), simulation last (prove it). The guides compose because the models compose.",
      },
    ],
  },
  {
    id: "ai-setup",
    group: "AI",
    title: "AI setup",
    keywords: "ai setup model studio key provider groq openai anthropic gemini deepseek openrouter gate",
    blocks: [
      {
        k: "p",
        text: "Open the AI dock, then Model Studio: paste a provider key (session-only, never stored), Test & List, Activate. Salesforce connection gates the dock — connect first.",
      },
      {
        k: "list",
        items: [
          "Keys ride the /api/ai/* proxy per request — never logged, never persisted.",
          "Chat history is per-org in IndexedDB: restore, continue, or delete sessions anytime.",
          "Markdown answers render in a calm viewer — no shake, deltas stream in.",
        ],
      },
    ],
  },
  {
    id: "ai-skills",
    group: "AI",
    title: "AI skills & tools",
    keywords: "ai skills tools agent tooled advisor apply approve prompt prompts",
    blocks: [
      {
        k: "p",
        text: "The agent loads one skill per tab. Where tools exist it acts through them; where they don't, it says so and plans in words. Reads run free — every mutation pauses for your Apply, and discards are never retried unasked.",
      },
      {
        k: "list",
        items: [
          "System: describe canvas, add nodes, connect edges.",
          "Wireframe: describe, list components, delta, spec — plus add screen/component/bind/interact.",
          "Sequence: describe, list messages, apply DSL (append or explicit-rewrite).",
          "Draw+: describe board, place labeled boxes, notes, arrows.",
          "Studio home: build SOQL/SOSL, snapshot ERD. JSON: structural census.",
          "Mapping / Validate / Architect / Contracts: advisor mode — numbered plans, zero tool claims.",
          "Diagram Studio: list/describe/inventory packs, compose from canvas names, switch themes.",
        ],
      },
      {
        k: "callout",
        title: "Prompts that work",
        text: "“Trace Salesforce GET order → hub POST as-is.” · “Add a Customer Detail screen with a proposed Segment picklist.” · “Model the ServiceNow-500 retry path, then send it to System.” · “What's on my board? Add Middleware :8080.”",
      },
    ],
  },
  {
    id: "share-privacy",
    group: "Reference",
    title: "Share & privacy",
    keywords: "share kv cloudflare export import package privacy gdpr terms security token",
    blocks: [
      {
        k: "list",
        items: [
          "Share live boards via Cloudflare KV links; bindings survive Git deploys (wrangler.jsonc, build via build:worker).",
          "Wireframe/Sequence/System export portable JSON packages — the fellow-dev handoff.",
          "GDPR visible: banner + Privacy/Terms/Security pages; Terms gate Connect; tokens never touch disk.",
          "Draw+ is zero-CDN: self-hosted Excalidraw assets and fonts, font-src 'self'.",
        ],
      },
    ],
  },
  {
    id: "troubleshooting",
    group: "Reference",
    title: "Troubleshooting",
    keywords: "troubleshoot error fix hmr cache reload groq fetch test list",
    blocks: [
      {
        k: "list",
        items: [
          "Provider key fails? Use Model Studio Test & List — adapters ride the /api/ai/* proxy, never direct fetch.",
          "Graph stranded after reload? Schema restores at the root node; Draw restores the exact scene.",
          "HMR poison (__webpack_modules__)? Delete .next and rebuild.",
          "SOSL shapes vary by org — flattened grid + Object column absorb most of it.",
        ],
      },
    ],
  },
];

