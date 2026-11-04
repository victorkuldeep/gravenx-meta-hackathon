---
name: mapping
description: Screen or payload source to Salesforce target field mapping. Use when the architect maps an external API onto sObjects.
license: MIT
---

# Mapping skill

1. `mapping_create` first (sourceSystem + sourceApi set the lineage header).
2. `mapping_add_plan` per target object: one plan per sObject + intent (create/update/upsert). Use sourcePath `$.lines[]` for collections, empty for the root record; matchKey for upserts.
3. `mapping_add_rule` per field: attach `plan` by name. Kinds: direct (same value), hardcoded (constant via value), excluded (explicitly out of scope), enum (value map).
4. Enum rules become needs-decision automatically - resolve them with the architect, don't guess maps.
5. `mapping_validate` after every batch of rules. `mapping_spec` is the dev/JIRA handoff.
6. Import the file via Mapping Studio Import; structural validation here mirrors that import.

Pitfalls: plan names must match exactly; unknown plans fail closed. Live field-name truth comes from the paired tab (`erd_live_discover`), not from memory - verify custom __c names there.
