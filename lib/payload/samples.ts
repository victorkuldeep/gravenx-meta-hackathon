import { SalesforceField } from "../salesforce/types";
import { getActivePicklistValues } from "../salesforce/metadata";

export function generateSampleValues(fields: SalesforceField[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    values[field.name] = getSampleValueForField(field);
  }
  return values;
}

export function getSampleValueForField(field: SalesforceField): unknown {
  const nameLower = field.name.toLowerCase();
  const labelLower = field.label.toLowerCase();

  switch (field.type) {
    case "id":
      return "000000000000000AAA";

    case "reference":
      // Use object-key prefix hints if available, otherwise generic 18-char placeholder
      return referencePlaceholder(field);

    case "boolean":
      return true;

    case "int": {
      const max = field.digits > 0 ? Math.min(field.digits, 6) : 4;
      return parseInt("1" + "0".repeat(max - 1), 10);
    }

    case "double":
    case "currency":
    case "percent": {
      const intPart = field.precision - field.scale > 0 ? field.precision - field.scale : 4;
      const dec = field.scale > 0 ? field.scale : 2;
      return parseFloat(
        "1" + "0".repeat(Math.min(intPart - 1, 3)) + "." + "0".repeat(dec - 1) + "1"
      );
    }

    case "date":
      return new Date().toISOString().split("T")[0];

    case "datetime":
      return new Date().toISOString().replace("Z", "+0000");

    case "email":
      return "sample@example.com";

    case "phone":
      return "+1 555 0100";

    case "url":
      return "https://example.com";

    case "picklist": {
      const active = getActivePicklistValues(field);
      return active.length > 0 ? active[0].value : "";
    }

    case "multipicklist": {
      const active = getActivePicklistValues(field);
      return active.length > 0 ? active[0].value : "";
    }

    case "string":
    case "textarea":
    case "encryptedstring":
      return smartStringValue(nameLower, labelLower, field);

    default:
      return smartStringValue(nameLower, labelLower, field);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns an 18-char placeholder that hints at the target object type.
 * Salesforce IDs start with a 3-char key prefix - we use known ones for common objects.
 */
function referencePlaceholder(field: SalesforceField): string {
  const target = field.referenceTo[0] ?? "";
  const prefixMap: Record<string, string> = {
    Account:          "001",
    Contact:          "003",
    Opportunity:      "006",
    Lead:             "00Q",
    Case:             "500",
    User:             "005",
    Campaign:         "701",
    Contract:         "800",
    Order:            "801",
    Product2:         "01t",
    Pricebook2:       "01s",
    PricebookEntry:   "01u",
    Quote:            "0Q0",
    Asset:            "02i",
  };
  const prefix = prefixMap[target] ?? "000";
  // Pad to 18 chars: prefix + X's + AAA (standard Salesforce ID shape)
  return (prefix + "X".repeat(15 - prefix.length) + "AAA").slice(0, 18);
}

/**
 * Generates context-aware sample strings based on field name / label patterns.
 */
function smartStringValue(nameLower: string, labelLower: string, field: SalesforceField): string {
  // Detect external ID / record key patterns
  if (nameLower.includes("external") || nameLower.includes("externalid") || nameLower.includes("ext_id")) {
    return "EXT-REF-001";
  }
  if (nameLower.endsWith("number__c") || labelLower.includes("number")) {
    return "ORD-00001";
  }
  if (nameLower.includes("code") || labelLower.includes("code")) {
    return "CODE-001";
  }
  if (labelLower.includes("rationale") || labelLower.includes("reason") || labelLower.includes("notes") || labelLower.includes("description") || field.type === "textarea") {
    return "Sample description text";
  }
  if (labelLower.includes("name") && !labelLower.includes("username")) {
    return "Sample Name";
  }
  if (labelLower.includes("subject") || labelLower.includes("title")) {
    return "Sample Subject";
  }
  if (labelLower.includes("status")) {
    return "Active";
  }
  if (labelLower.includes("type")) {
    return "Standard";
  }
  if (labelLower.includes("category") || labelLower.includes("segment")) {
    return "Category A";
  }
  if (labelLower.includes("comment") || labelLower.includes("note")) {
    return "Sample comment";
  }
  if (labelLower.includes("need") || labelLower.includes("requirement")) {
    return "Sample customer requirement";
  }
  if (labelLower.includes("value") && field.type === "string") {
    return "SampleValue";
  }
  // Respect max length hint
  const maxLen = field.length > 0 ? field.length : 255;
  const base = "Sample Value";
  return base.slice(0, maxLen);
}
