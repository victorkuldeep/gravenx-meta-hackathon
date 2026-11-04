---
name: notes
description: Design notes, workshop capture, meeting records. Use when the architect needs a Markdown record that pastes into the studio Notes tab.
license: MIT
---

# Notes skill

1. `note_create` with Markdown body; `note_append` adds timestamped sections (separator automatic).
2. Bodies paste straight into the studio Notes tab - keep headings + bullets, no HTML.
3. One note per topic; link related decisions by mentioning their ADR numbers in text.

Pitfalls: 20KB per write - split long workshops across appends.
