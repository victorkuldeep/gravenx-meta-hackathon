---
name: contracts
description: Consumer to Salesforce API contracts. Use when the architect defines what a consumer may call and with which fields.
license: MIT
---

# Contracts skill

1. `contract_create` needs name + targetObject + consumer (who calls this - required).
2. `contract_add_field` per field: apiName + operations (POST/PATCH) + ownership + transform. external defaults to the api name; set it when the consumer renames the field.
3. integrationRequired=true marks business-required beyond Salesforce metadata.
4. `contract_validate` runs the studio import validator. `contract_spec` is the review handoff.

Pitfalls: operationIds must be identifiers (auto-generated); DELETE is not a contract operation here.
