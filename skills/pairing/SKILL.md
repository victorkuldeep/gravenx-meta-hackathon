---
name: pairing
description: Pair this agent session with an open GRAVENX tab before any erd_live_* or system_live_* tool. Read this skill first in every bridged session.
license: MIT
---

# Pairing skill

1. Start the hub (`npm run mcp` in gravenx-mcp). It prints a pairing code + pair link.
2. The architect enters the code in Setup > Terminal Bridge. The tab dials the hub; you see `tab paired`.
3. Pairing IS the authorization. Never ask per command; never ask for tokens, passwords, or org credentials - you never see them.
4. `skill_list` + `skill_read` the packs for your task, then `*_snapshot` BEFORE any write. Stale context is the root cause of every "ack but nothing changed".
5. Writes pause for architect approval in the tab unless bridge auto mode is on. A denial is a decision, not an error - report it and stop that line.
6. If the socket drops, the tab re-pairs with a fresh code. Ask the architect for it; never reuse an old code.

Pitfalls: one paired tab per session; a second tab steals nothing but commands route to the paired one. No paired tab means live tools fail - say so plainly and work file-side instead.
