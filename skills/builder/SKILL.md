---
name: builder
description: Single REST payloads and multi-request Composite batches. Use when the architect builds or validates Salesforce API calls.
license: MIT
---

# Builder skill

1. `payload_build` for one call: method + object + fields -> runnable URL + JSON body. PATCH/DELETE/GET require recordId. Save with `save: true` to replay later.
2. `composite_create` for batches (max 25 subrequests, allOrNone default true).
3. `composite_add_request` in dependency order. Link with {apiName, from: referenceId, property} to emit `@{ref.id}` references - the referenced request MUST exist first.
4. `composite_validate` checks structure (dup refs, PATCH-without-id, method rules). Org required-field checks need the live tab - flag them, don't invent values.
5. `composite_payload` emits the exact Composite JSON + execution order. Paste into the REST runner.

Pitfalls: referenceIds are batch-scoped and must match [A-Za-z][A-Za-z0-9_]*; unknown `from` fails the whole add.
