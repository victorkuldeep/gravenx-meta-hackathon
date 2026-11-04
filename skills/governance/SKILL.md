---
name: governance
description: Architecture decisions, requirements, traceability, JIRA drafts. Use when the architect records why something was decided or what must be covered.
license: MIT
---

# Governance skill

1. `decision_create` auto-numbers (ADR-001...). Move along the legal trail only: proposed -> in-review -> accepted; accepted -> deprecated/superseded. Illegal jumps fail.
2. `decision_link` binds a decision to what it governs (system/wireframe/sequence/draw/schema).
3. `requirement_create` auto-numbers (REQ-001...); trail is open -> covered -> verified.
4. `requirement_link` with surface=decision builds requirement->decision traceability.
5. `decision_summarize` is the review digest: counts, open items, accepted governance.
6. `jira_draft` turns open decisions + requirements (+ a mapping's open items) into an acceptance-criteria story, saved as a note. Paste into JIRA - never invent coverage.

Pitfalls: history is append-only; updates re-validate through the studio importer.
