---
name: erd-live
description: Drive the open ERD tab through the bridge (paired tab required). Use for canvas curation, schema discovery, and Author-mode metadata changes.
license: MIT
---

# ERD live skill

1. Pair first: the hub prints a code + pair link; the tab dials it (Setup > Terminal Bridge).
2. Reads are free: `erd_live_snapshot` (canvas truth), `erd_live_objects` (browse org schema), `erd_live_discover` (parents/children via the tab session - an org call, needs approval unless auto mode).
3. Writes (`place/hide/remove/tags/focus/mode/filter/author_*`) pause for architect approval unless auto mode is on. Pairing IS the authorization - say so, don't re-ask per command.
4. Refs are fuzzy: exact api name wins, then label, then single substring; ambiguity errors list candidates - ask the architect to pick, never place both.
5. Custom objects MUST come from schema browse/discover - never invent __c names.
6. `arch.activity` reads the tab's mutation audit trail for reviews and JIRA drafts.

Pitfalls: removing the canvas root is refused; removing a tag assignment is not deleting the tag (`tags delete` removes it everywhere). Root cause of 'ack but nothing changed' is always stale ctx - snapshot first.
