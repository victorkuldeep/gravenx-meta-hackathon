---
name: activity
description: Org-mutation audit trail and JIRA follow-ups. Use when the architect reviews who changed what in the org and whether it worked.
license: MIT
---

# Activity skill

1. `activity_live_list` reads Arch Activity from the paired tab: who deployed/edited what, when, and whether it worked. Filter by actor (architect/agent-bridge) or category (metadata/data).
2. Summarize risk: failed deploys, agent-bridge actions the architect hasn't reviewed, PROD-hour changes.
3. Draft follow-ups with `jira_draft` (file side) citing the activity entries as evidence.
4. Canvas curation (place/hide/remove/tags) is intentionally absent - snapshots cover it, not the trail.

Pitfalls: the trail lives in the tab's IndexedDB - no paired tab means no activity. Export MD from Setup > Arch Activity for offline reviews.
