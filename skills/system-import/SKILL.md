---
name: system-import
description: Postman Collection to system topology import. Use when the architect hands you a collection to turn into a canvas.
license: MIT
---

# System import skill

1. `system_import_postman` takes the collection JSON (or a workspace file). One system per top-level folder, one operation per request, draft edges in collection order.
2. Types are guessed from host (salesforce/servicenow/middleware/queue/rest) - correct them on canvas.
3. Draft edges are ORDER GUESSES, never asserted flows. Confirm, rewire, or delete each one.
4. Auth headers and cookies are DROPPED on import and counted - never ask for them, never re-add secrets.
5. Cap: 200 requests / 500KB - split big collections by folder first.
6. Open the file via System Design Import; `system_summarize` inventories it headlessly.
