---
name: system-live
description: Drive the open System Design tab through the bridge (paired tab required). Use for topology design, draft edges, and canvas layout.
license: MIT
---

# System live skill

1. `system_live_new` starts a blank project from scratch when nothing is open - then snapshot/place/connect.
2. `system_live_snapshot` is canvas truth: systems with types/positions, connections with status.
3. `system_live_place` by type (salesforce, middleware, queue, ...) - max 10 per call, names optional.
4. `system_live_connect` draws DRAFT edges by system name. Drafts are proposals - the architect confirms topology on canvas. Never present a draft edge as an asserted integration.
5. `system_live_remove` drops systems and their dangling connections.
6. Pair with `system_import_postman`: import the collection, snapshot it, then rewire the drafts into the real topology with the architect.
7. `system_live_rebalance` tidies the canvas into a readable flow when the architect drags things around.

Pitfalls: names resolve exactly-then-substring; ambiguity errors list candidates. Start blank with `system_live_new` when nothing is open.
