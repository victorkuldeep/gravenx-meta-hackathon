import { SalesforceField, OperationType, CompositeSubRequest, CompositePayload, CompositeRequestItem } from "../salesforce/types";
import { getWritableFields } from "../salesforce/metadata";

export function generatePayload(
  selectedFields: SalesforceField[],
  values: Record<string, unknown>,
  operation: OperationType
): Record<string, unknown> {
  const writableFields = getWritableFields(selectedFields, operation);
  const payload: Record<string, unknown> = {};

  for (const field of writableFields) {
    const val = values[field.name];

    // Skip fields with no value unless explicitly set to null/false/0
    if (val === undefined || val === "") continue;

    // Coerce types where needed
    if (field.type === "int") {
      const num = parseInt(String(val), 10);
      if (!isNaN(num)) payload[field.name] = num;
    } else if (field.type === "double" || field.type === "currency" || field.type === "percent") {
      const num = parseFloat(String(val));
      if (!isNaN(num)) payload[field.name] = num;
    } else if (field.type === "boolean") {
      payload[field.name] = val === true || val === "true";
    } else {
      payload[field.name] = val;
    }
  }

  return payload;
}

/**
 * Derives a camelCase referenceId from a Salesforce object API name.
 * Pricing_Request__c → pricingRequest, Account → account
 */
export function deriveReferenceId(objectName: string): string {
  return objectName
    .replace(/__c$/i, "")
    .replace(/__/g, "_")
    .split("_")
    .filter(Boolean)
    .map((word, i) =>
      i === 0
        ? word.charAt(0).toLowerCase() + word.slice(1)
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join("");
}

/**
 * Makes a referenceId unique across the batch: always suffixed
 * (`account_1`, `account_2`…) so same-object instances never collide.
 */
export function uniqueReferenceId(base: string, taken: Set<string> | string[]): string {
  const used = taken instanceof Set ? taken : new Set(taken);
  const clean = (base || "").trim() || "request";
  let n = 1;
  while (used.has(`${clean}_${n}`)) n++;
  return `${clean}_${n}`;
}

/**
 * Builds the composite API payload from the ordered list of sub-requests.
 */
export function generateCompositePayload(
  subRequests: CompositeSubRequest[],
  apiVersion: string,
  allOrNone: boolean
): CompositePayload {
  const ver = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;
  const items: CompositeRequestItem[] = [];

  for (const sr of subRequests) {
    if (!sr.objectName || !sr.describe) continue;

    const operation: OperationType = sr.method === "PATCH" ? "PATCH" : "POST";
    const selectedFields = sr.describe.fields.filter((f) =>
      sr.selectedFieldNames.has(f.name)
    );
    const body = generatePayload(selectedFields, sr.fieldValues, operation);

    let url = `/services/data/${ver}/sobjects/${sr.objectName}`;
    if ((sr.method === "PATCH" || sr.method === "DELETE") && sr.recordId) {
      url += `/${sr.recordId}`;
    }

    const item: CompositeRequestItem = {
      method: sr.method,
      url,
      referenceId: sr.referenceId,
    };

    if (sr.method !== "GET" && sr.method !== "DELETE") {
      item.body = body;
    }

    items.push(item);
  }

  return { allOrNone, compositeRequest: items };
}

export function generateEndpoint(
  instanceUrl: string,
  apiVersion: string,
  objectName: string,
  operation: OperationType,
  recordId?: string
): string {
  const base = instanceUrl.replace(/\/+$/, "");
  const ver = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;

  if (operation === "PATCH" && recordId) {
    return `${base}/services/data/${ver}/sobjects/${objectName}/${recordId}`;
  }
  return `${base}/services/data/${ver}/sobjects/${objectName}`;
}
