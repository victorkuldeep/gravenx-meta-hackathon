import { SalesforceField, SalesforcePicklistValue, OperationType } from "./types";

const SYSTEM_FIELDS = new Set([
  "Id",
  "CreatedDate",
  "CreatedById",
  "LastModifiedDate",
  "LastModifiedById",
  "SystemModstamp",
  "LastActivityDate",
  "LastViewedDate",
  "LastReferencedDate",
  "IsDeleted",
]);

export function getWritableFields(
  fields: SalesforceField[],
  operation: OperationType
): SalesforceField[] {
  return fields.filter((f) => {
    if (f.deprecatedAndHidden) return false;
    if (f.calculated) return false;
    if (f.autoNumber) return false;
    if (SYSTEM_FIELDS.has(f.name)) return false;

    if (operation === "POST") return f.createable;
    if (operation === "PATCH") return f.updateable;
    return false;
  });
}

export function getActivePicklistValues(field: SalesforceField): SalesforcePicklistValue[] {
  return field.picklistValues.filter((v) => v.active);
}

export function isReferenceField(field: SalesforceField): boolean {
  return field.type === "reference";
}

export function isPicklistField(field: SalesforceField): boolean {
  return field.type === "picklist" || field.type === "multipicklist";
}

export function isRequiredField(field: SalesforceField, operation: OperationType): boolean {
  if (operation === "POST") {
    return !field.nillable && !field.defaultedOnCreate && field.createable;
  }
  return false;
}

export function getFieldEditorType(
  field: SalesforceField
): "string" | "textarea" | "boolean" | "number" | "date" | "datetime" | "email" | "phone" | "url" | "picklist" | "multipicklist" | "reference" {
  switch (field.type) {
    case "boolean":
      return "boolean";
    case "int":
    case "double":
    case "currency":
    case "percent":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "email":
      return "email";
    case "phone":
      return "phone";
    case "url":
      return "url";
    case "picklist":
      return "picklist";
    case "multipicklist":
      return "multipicklist";
    case "reference":
      return "reference";
    case "textarea":
      return "textarea";
    default:
      return "string";
  }
}
