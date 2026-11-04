import type { SalesforceField } from "@/lib/salesforce/types";

/**
 * Field types that map cleanly to Salesforce GraphQL scalar selections.
 * Compound / binary types (address, location, base64, …) are excluded -
 * they need nested sub-selections and break generated queries.
 */
const GRAPHQL_SCALAR_TYPES = new Set([
  "id",
  "string",
  "textarea",
  "phone",
  "email",
  "url",
  "picklist",
  "multipicklist",
  "combobox",
  "boolean",
  "int",
  "double",
  "currency",
  "percent",
  "date",
  "datetime",
  "time",
  // Lookup Id fields (e.g. OwnerId) resolve as plain ID scalars on the node.
  "reference",
]);

const SAFE_NAME = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export function isGraphQLSelectable(field: SalesforceField): boolean {
  if (field.deprecatedAndHidden) return false;
  if (!SAFE_NAME.test(field.name)) return false;
  return GRAPHQL_SCALAR_TYPES.has(field.type);
}

export function getGraphQLFields(fields: SalesforceField[]): SalesforceField[] {
  return fields.filter(isGraphQLSelectable);
}

/** Default selection: Id + Name when present, else first 3 selectable fields. */
export function defaultGraphQLSelection(fields: SalesforceField[]): string[] {
  const selectable = getGraphQLFields(fields);
  const names = new Set(selectable.map((f) => f.name));
  const preferred = ["Id", "Name"].filter((n) => names.has(n));
  if (preferred.length > 0) return preferred;
  return selectable.slice(0, 3).map((f) => f.name);
}

/**
 * UI API GraphQL returns value objects, not scalars, for almost everything.
 * Live evidence: Id is the only true scalar. Name, strings, numbers,
 * dates, picklists, lookups all need `{ value }` (SubselectionRequired
 * errors prove it field by field).
 */
export function fieldNeedsValueSubselect(f: {
  name: string;
  type: string;
  nameField: boolean;
}): boolean {
  return f.name !== "Id";
}

// ── Multi-object query engine ─────────────────────────────────────────────

export interface QueryLeaf {
  kind: "leaf";
  name: string;
  needsValue: boolean;
}

/** Parent traversal, e.g. Account { Name { value } } via a lookup's relationshipName. */
export interface QueryParent {
  kind: "parent";
  relation: string;
  fields: QueryLeaf[];
}

/** Child list, e.g. Contacts(first: 5) { edges { node { … } } }. */
export interface QueryChild {
  kind: "child";
  relation: string;
  first: number;
  fields: QueryLeaf[];
}

export type QueryNode = QueryLeaf | QueryParent | QueryChild;

export interface QueryBlock {
  objectName: string;
  first: number;
  nodes: QueryNode[];
}

const MAX_BLOCKS = 10;
const MAX_FIRST = 2000;

export { MAX_BLOCKS };

function clampFirst(n: number): number {
  if (!Number.isFinite(n)) return 10;
  return Math.min(Math.max(Math.floor(n), 1), MAX_FIRST);
}

function renderLeaf(f: QueryLeaf, indent: string): string {
  if (!SAFE_NAME.test(f.name)) throw new Error(`Invalid field name: ${f.name}`);
  return f.needsValue
    ? `${indent}${f.name} {\n${indent}  value\n${indent}}`
    : `${indent}${f.name}`;
}

function renderParent(p: QueryParent, indent: string): string {
  if (!SAFE_NAME.test(p.relation)) throw new Error(`Invalid relationship: ${p.relation}`);
  const leaves = p.fields.filter((f) => SAFE_NAME.test(f.name));
  if (leaves.length === 0) throw new Error(`No fields selected under ${p.relation}`);
  const inner = leaves.map((f) => renderLeaf(f, `${indent}  `)).join("\n");
  return `${indent}${p.relation} {\n${inner}\n${indent}}`;
}

function renderChild(c: QueryChild, indent: string): string {
  if (!SAFE_NAME.test(c.relation)) throw new Error(`Invalid relationship: ${c.relation}`);
  const leaves = c.fields.filter((f) => SAFE_NAME.test(f.name));
  if (leaves.length === 0) throw new Error(`No fields selected under ${c.relation}`);
  const inner = leaves.map((f) => renderLeaf(f, `${indent}      `)).join("\n");
  return (
    `${indent}${c.relation}(first: ${clampFirst(c.first)}) {\n` +
    `${indent}  edges {\n` +
    `${indent}    node {\n` +
    `${inner}\n` +
    `${indent}    }\n` +
    `${indent}  }\n` +
    `${indent}}`
  );
}

function renderNode(n: QueryNode, indent: string): string {
  if (n.kind === "parent") return renderParent(n, indent);
  if (n.kind === "child") return renderChild(n, indent);
  return renderLeaf(n, indent);
}

export function buildGraphQLQueryMulti(blocks: QueryBlock[]): string {
  const valid = blocks.filter((b) => SAFE_NAME.test(b.objectName) && b.nodes.length > 0);
  if (valid.length === 0) throw new Error("Add at least one object with fields");
  if (valid.length > MAX_BLOCKS) throw new Error(`At most ${MAX_BLOCKS} objects per query`);

  const rendered = valid.map((b) => {
    const inner = b.nodes.map((n) => renderNode(n, "          ")).join("\n");
    return (
      `      ${b.objectName}(first: ${clampFirst(b.first)}) {\n` +
      `        edges {\n` +
      `          node {\n` +
      `${inner}\n` +
      `          }\n` +
      `        }\n` +
      `      }`
    );
  });

  return [`{`, `  uiapi {`, `    query {`, ...rendered, `    }`, `  }`, `}`].join("\n");
}

// ── Legacy single-object shape (kept for compatibility) ───────────────────

export interface GraphQLQueryField {
  name: string;
  needsValue: boolean;
}

export interface GraphQLQueryInput {
  objectName: string;
  fields: GraphQLQueryField[];
  first: number;
}

export function buildGraphQLQuery({ objectName, fields, first }: GraphQLQueryInput): string {
  return buildGraphQLQueryMulti([
    {
      objectName,
      first,
      nodes: fields.map((f) => ({ kind: "leaf" as const, ...f })),
    },
  ]);
}

export function graphqlEndpoint(instanceUrl: string, apiVersion: string): string {
  const base = instanceUrl.replace(/\/+$/, "");
  const ver = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;
  return `${base}/services/data/${ver}/graphql`;
}

export function buildGraphQLCurl(endpoint: string, query: string): string {
  const escaped = JSON.stringify({ query });
  return [
    `curl -X POST \\`,
    `  '${endpoint}' \\`,
    `  -H 'Authorization: Bearer $SF_ACCESS_TOKEN' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${escaped}'`,
  ].join("\n");
}
