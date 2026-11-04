/**
 * ServiceNow push: pure core + thin client over our same-origin proxy
 * (/api/pmo/snow). Same posture as the JIRA adapter - username + password
 * ride per request through the worker, never stored server-side, session-only
 * in the tab. Push-only in V1: the record number comes back as a backlink.
 *
 * Bodies stay plain text (ServiceNow has no ADF) - the Console markdown
 * travels as-is into description / work notes.
 */

export interface SnowCreds {
  instance: string;
  user: string;
  pass: string;
}

export interface SnowTable {
  name: string;
  label: string;
}

/** Curated first-class targets; anything else goes through custom table. */
export const SNOW_TABLES: SnowTable[] = [
  { name: "incident", label: "Incident" },
  { name: "sc_task", label: "Catalog Task" },
  { name: "rm_story", label: "Story" },
  { name: "problem", label: "Problem" },
  { name: "change_request", label: "Change" },
];

/** ServiceNow instances only: https origin on *.service-now.com. */
export function normalizeSnowInstance(input: string): { ok: true; instance: string } | { ok: false; error: string } {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Enter your instance, e.g. acme.service-now.com." };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "That instance URL does not parse." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Instance must be https." };
  if (url.username || url.password) return { ok: false, error: "Credentials in the URL are not allowed." };
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9-]+\.service-now\.com$/.test(host)) {
    return { ok: false, error: "Only *.service-now.com instances are supported." };
  }
  return { ok: true, instance: `https://${host}` };
}

/** Table names are API identifiers - lowercase, digits, underscores. */
export function normalizeSnowTable(input: string): { ok: true; table: string } | { ok: false; error: string } {
  const table = input.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,79}$/.test(table)) {
    return { ok: false, error: "Table looks wrong - e.g. incident, sc_task, rm_story." };
  }
  return { ok: true, table };
}

export interface SnowRecordInput {
  shortDescription: string;
  description: string;
  workNotes?: string;
}

/** Console task → Table API record. Labels trace back to the Console. */
export function buildSnowRecord(task: { title: string; body?: string; kind?: string }): SnowRecordInput {
  const title = task.title.trim().slice(0, 160) || "Untitled Console task";
  const body = task.body?.trim() ? task.body.trim().slice(0, 4000) : "";
  const stamp = `[GRAVENX Console · ${task.kind ?? "task"}]`;
  return {
    shortDescription: title,
    description: body ? `${stamp}\n\n${body}` : `${stamp} No description yet.`,
  };
}

export interface SnowRecordRef {
  number: string;
  url: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

async function postSnow(payload: Record<string, unknown>): Promise<unknown> {
  const res = await fetch("/api/pmo/snow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!isRecord(json) || json.ok !== true) {
    const error = isRecord(json) && typeof json.error === "string" ? json.error : `Request failed (${res.status}).`;
    throw new Error(error);
  }
  return json;
}

export interface SnowProbe {
  table: string;
  sampleFields: string[];
}

/**
 * Field probe: reads one row so the architect sees the table is real and
 * which fields exist before pushing. Empty tables still validate - the
 * table exists, there is just nothing to sample.
 */
export async function probeSnowTable(creds: SnowCreds, table: string): Promise<SnowProbe> {
  const json = await postSnow({ action: "probe", ...creds, table });
  if (!isRecord(json) || typeof json.table !== "string" || !Array.isArray(json.sampleFields)) {
    throw new Error("Unexpected response from ServiceNow.");
  }
  return { table: json.table, sampleFields: json.sampleFields.filter((f): f is string => typeof f === "string") };
}

export interface SnowRecordDetail {
  number: string;
  table: string;
  shortDescription: string;
  description: string;
  state: string;
  assignedTo: string;
}

/** Record ingress: one row by number, human fields first, full row inspectable. */
export async function fetchSnowRecord(creds: SnowCreds, table: string, number: string): Promise<SnowRecordDetail> {
  const json = await postSnow({ action: "get", ...creds, table, number });
  if (!isRecord(json) || !isRecord(json.record)) throw new Error("Unexpected response from ServiceNow.");
  const r = json.record;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const disp = (v: unknown): string => (isRecord(v) && typeof v.display_value === "string" ? v.display_value : str(v));
  return {
    number: str(r.number) || number,
    table,
    shortDescription: str(r.short_description),
    description: str(r.description).slice(0, 4000),
    state: disp(r.state) || disp(r.incident_state),
    assignedTo: disp(r.assigned_to),
  };
}

export async function createSnowRecord(creds: SnowCreds, table: string, input: SnowRecordInput): Promise<SnowRecordRef> {
  const json = await postSnow({ action: "create", ...creds, table, fields: { short_description: input.shortDescription, description: input.description } });
  if (!isRecord(json) || typeof json.number !== "string" || typeof json.url !== "string") {
    throw new Error("Unexpected response from ServiceNow.");
  }
  return { number: json.number, url: json.url };
}
