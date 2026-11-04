import type { Finding } from "./compare";

export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Parse with a human error (line-aware when V8 reports position). */
export function parseJsonInput(text: string): JsonParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: "Empty input - paste JSON first." };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid JSON";
    return { ok: false, error: prettifyJsonError(msg, trimmed) };
  }
}

function prettifyJsonError(msg: string, text: string): string {
  const at = msg.match(/position (\d+)/);
  if (!at) return msg;
  const pos = Number(at[1]);
  const upto = text.slice(0, pos).split("\n");
  return `${msg} (line ${upto.length}, col ${upto[upto.length - 1].length + 1})`;
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Priority order: lowercase id (REST/API convention) wins over Id (Salesforce). */
export const COMPARE_KEY_PRESETS = ["id", "Id", "referenceId", "Name"] as const;

/**
 * Scans both payloads for an array (2+ items, all plain objects) where one
 * of the common id-ish keys is present and unique across every item.
 * Returns the highest-priority usable key, or "" when none qualifies.
 * Powers the Auto default so a typical API payload gets correct array
 * matching without the user having to find the dropdown first.
 */
export function detectArrayMatchKey(a: unknown, b: unknown): string {
  const candidates: string[] = [...COMPARE_KEY_PRESETS];
  const usable = new Set<string>();

  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  const checkArray = (arr: unknown[]) => {
    if (arr.length < 2 || !arr.every(isPlainObject)) return;
    for (const key of candidates) {
      if (usable.has(key)) continue;
      const values = (arr as Record<string, unknown>[])
        .map((o) => o[key])
        .filter((v): v is string | number => typeof v === "string" || typeof v === "number");
      if (values.length === arr.length && new Set(values).size === values.length) {
        usable.add(key);
      }
    }
  };

  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      checkArray(v);
      for (const item of v) walk(item);
    } else if (isPlainObject(v)) {
      for (const value of Object.values(v)) walk(value);
    }
  };

  walk(a);
  walk(b);
  return candidates.find((k) => usable.has(k)) ?? "";
}

const SAMPLE_A = {
  allOrNone: true,
  compositeRequest: [
    {
      method: "POST",
      url: "/services/data/v66.0/sobjects/Pricing_Request__c",
      referenceId: "pricingRequest_1",
      body: { Status__c: "New", Quote__c: "0Q0WE000006bZkv0AE" },
    },
    {
      method: "POST",
      url: "/services/data/v66.0/sobjects/Request_Term__c",
      referenceId: "requestTerm_1",
      body: { Pricing_Request__c: "@{pricingRequest_1.id}", Term_Value__c: "12 Months", requested_MRC__c: 100 },
    },
    {
      method: "POST",
      url: "/services/data/v66.0/sobjects/Request_Term__c",
      referenceId: "requestTerm_2",
      body: { Pricing_Request__c: "@{pricingRequest_1.id}", Term_Value__c: "24 Months", requested_MRC__c: 120 },
    },
  ],
};

const SAMPLE_B = {
  allOrNone: true,
  compositeRequest: [
    {
      method: "POST",
      url: "/services/data/v66.0/sobjects/Pricing_Request__c",
      referenceId: "pricingRequest_1",
      body: { Status__c: "Approved", Quote__c: "0Q0WE000006bZkv0AE" },
    },
    {
      method: "POST",
      url: "/services/data/v66.0/sobjects/Request_Term__c",
      referenceId: "requestTerm_2",
      body: { Pricing_Request__c: "@{pricingRequest_1.id}", Term_Value__c: "24 Months", requested_MRC__c: 140 },
    },
    {
      method: "POST",
      url: "/services/data/v66.0/sobjects/Request_Term__c",
      referenceId: "requestTerm_1",
      body: { Pricing_Request__c: "@{pricingRequest_1.id}", Term_Value__c: "12 Months", requested_MRC__c: 100, floor_MRC__c: 105 },
    },
    {
      method: "POST",
      url: "/services/data/v66.0/sobjects/Pricing_Request_Vendor__c",
      referenceId: "pricingRequestVendor_1",
      body: { Pricing_Request__c: "@{pricingRequest_1.id}", Vendor__c: "001WE00001FrgJVYAZ" },
    },
  ],
};

export function samplePair(): { a: string; b: string } {
  return { a: formatJson(SAMPLE_A), b: formatJson(SAMPLE_B) };
}

/** Full-fidelity cell text for export (never truncated). */
export function tableCellFull(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (typeof v === "string") return v;
  return JSON.stringify(v) ?? "null";
}

/**
 * Tab-separated Node / Value in A / Value in B rows: header + one line per
 * finding, quoted per TSV rules. Pastes straight into Excel/Sheets.
 */
export function diffTableTsv(rows: Finding[]): string {
  const esc = (sv: string) => (/[\t\n\r"]/.test(sv) ? '"' + sv.replace(/"/g, '""') + '"' : sv);
  const nodeOf = (f: Finding): string => f.pathA ?? f.pathB ?? "$";
  const lines = ["Node\tValue in A\tValue in B"];
  for (const f of rows) {
    lines.push(esc(nodeOf(f)) + "\t" + esc(tableCellFull(f.oldValue)) + "\t" + esc(tableCellFull(f.newValue)));
  }
  return lines.join("\n");
}
