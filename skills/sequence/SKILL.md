---
name: sequence
description: Sequence interaction models - parse the DSL, validate control blocks, export Mermaid. Use when the architect describes system-to-system behavior over time.
license: MIT
---

# Sequence skill

1. `sequence_parse` first: paste the architect's statements (sync `->`, async `->>`, `loop`, `parallel`, `retry`, `timeout`, `try/catch`) into the canonical interaction model. The diagram is a projection - the model is truth.
2. Participants should resolve to the System Design registry (same names as `system_live_snapshot`), not free text. Ask when a name doesn't match a known system.
3. `sequence_validate` after every edit: unclosed blocks, orphan replies, missing timeout/retry on cross-boundary calls.
4. `sequence_mermaid` is the export format for docs and PRs. Mermaid is output only - never hand-edit it and re-import.
5. `sequence_create` persists the validated model; `sequence_list` recalls it. One interaction per sequence - split sagas, don't nest sagas.

Pitfalls: draft edges from System Design are order guesses, not sequence evidence. Retry/timeout/compensation blocks are semantic (they drive future execution), not decoration - don't add them speculatively.
