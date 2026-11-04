---
name: wireframe
description: Schema-aware wireframe experiences - screens of structured components bound to Salesforce schema. Use when the architect models a UI before building it.
license: MIT
---

# Wireframe skill

1. `wireframe_create` opens the experience, `wireframe_add_screen` per route/view, `wireframe_add_component` per element. Canvas position is a view property - the experience model is truth.
2. Every data-bound component declares its state: EXISTING (`Account.Name`), PROPOSED (`Customer_Segment__c` + type), or EXTERNAL (source system + API). Never bind a field you haven't verified.
3. Proposed fields accumulate into a schema delta - report it alongside the design so the architect approves new API names deliberately.
4. `wireframe_validate` checks bindings and interaction intents (click -> save -> PATCH). `wireframe_spec` is the Cursor/Claude Code build handoff.
5. Keep V1 to the core set (form, layout, data components). A wireframe that tries to be a design system stops being a thinking tool.

Pitfalls: component names are experience-scoped; screen names must be unique. The spec embeds the schema delta - regenerating after binding changes, never hand-editing the old spec.
