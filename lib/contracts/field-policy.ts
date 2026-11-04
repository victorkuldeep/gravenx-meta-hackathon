import { isRequiredField } from "../salesforce/metadata";
import type { SalesforceField } from "../salesforce/types";
import type { ContractFieldMeta } from "./metadata-adapter";
import type { ContractOperation } from "./types";

/**
 * Field policy: operation gating + requiredness, reusing the existing
 * isRequiredField rule (no duplicate metadata logic).
 */

export function allowedForOperation(
  meta: Pick<ContractFieldMeta, "createable" | "updateable">,
  operation: ContractOperation
): boolean {
  return operation === "POST" ? meta.createable : meta.updateable;
}

export type RequiredSource = "salesforce" | "integration" | "none";

export function effectiveRequired(
  meta: Pick<
    ContractFieldMeta,
    "apiName" | "nillable" | "createable" | "updateable" | "defaultedOnCreate" | "sfType"
  >, integrationRequired: boolean,
  operation: ContractOperation
): { required: boolean; source: RequiredSource } {
  // Reuse the app's rule against a compatible field shape.
  const sfRequired = isRequiredField(
    {
      nillable: meta.nillable,
      createable: meta.createable,
      updateable: meta.updateable,
      defaultedOnCreate: meta.defaultedOnCreate,
      type: meta.sfType,
      name: meta.apiName,
    } as SalesforceField,
    operation
  );
  if (sfRequired) return { required: true, source: "salesforce" };
  if (integrationRequired) return { required: true, source: "integration" };
  return { required: false, source: "none" };
}
