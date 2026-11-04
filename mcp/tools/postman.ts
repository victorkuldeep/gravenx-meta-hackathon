import { z } from "zod";
import {
  exportProject,
  importProject,
  SYSTEM_DESIGN_SCHEMA_VERSION,
  type SystemConnection,
  type SystemInterface,
  type SystemNode,
  type SystemOperation,
  type SystemProject,
  type SystemType,
} from "@/lib/system-design/model";
import { claimFile, readJson, writeJson } from "../workspace";
import type { McpTool, ToolResult } from "./types";

/**
 * Postman Collection v2.1 -> GRAVENX system project.
 *
 * One system per top-level folder (type guessed from host), every request
 * becomes an operation with its method + path + sample body, and consecutive
 * requests in a folder are linked with DRAFT edges ("follows") - sequence
 * guesses the architect confirms on canvas, never asserted facts.
 * Auth headers and cookies are dropped on import (never stored in files).
 */

interface PmUrl {
  raw?: string;
  host?: string[];
  path?: string | string[];
  query?: { key: string; value: string; disabled?: boolean }[];
}

interface PmRequest {
  method?: string;
  url?: string | PmUrl;
  header?: { key: string; value: string; disabled?: boolean }[];
  body?: { mode?: string; raw?: string };
}

interface PmItem {
  name?: string;
  item?: PmItem[];
  request?: PmRequest | string;
}

interface PmCollection {
  info?: { name?: string };
  item?: PmItem[];
}

const SECRET_HEADERS = new Set(["authorization", "proxy-authorization", "x-api-key", "apikey", "api-key", "cookie", "set-cookie", "x-auth-token"]);

function secretHeaderCount(headers: { key: string; disabled?: boolean }[] | undefined): number {
  if (!headers) return 0;
  return headers.filter((h) => !h.disabled && SECRET_HEADERS.has(h.key.toLowerCase())).length;
}

function urlParts(url: string | PmUrl | undefined): { origin: string; path: string } {
  if (!url) return { origin: "", path: "/" };
  if (typeof url === "string") {
    try {
      const u = new URL(url);
      return { origin: u.origin, path: u.pathname || "/" };
    } catch {
      return { origin: "", path: url };
    }
  }
  const raw = url.raw ?? "";
  if (raw) {
    try {
      const u = new URL(raw);
      return { origin: u.origin, path: u.pathname || "/" };
    } catch {
      /* fall through to parts */
    }
  }
  const host = (url.host ?? []).join(".");
  const p = Array.isArray(url.path) ? url.path.join("/") : (url.path ?? "");
  return { origin: host ? `https://${host}` : "", path: p ? `/${p}` : "/" };
}

function guessType(host: string): SystemType {
  const h = host.toLowerCase();
  if (/salesforce|force\.com|cloudforce\.com/.test(h)) return "salesforce";
  if (/servicenow/.test(h)) return "servicenow";
  if (/mule|boomi|informatica|workato|snaplogic|jitterbit/.test(h)) return "middleware";
  if (/kafka|eventbridge|pubsub|servicebus|rabbitmq/.test(h)) return "queue";
  if (/graphql/.test(h)) return "graphql";
  return "rest";
}

interface FlatReq {
  group: string;
  name: string;
  method: string;
  origin: string;
  path: string;
  sampleBody?: string;
  secretsDropped: number;
}

function flatten(items: PmItem[] | undefined, group: string, out: FlatReq[]): void {
  for (const it of items ?? []) {
    if (Array.isArray(it.item)) {
      flatten(it.item, it.name || group, out);
      continue;
    }
    if (!it.request || typeof it.request === "string") continue;
    const req = it.request;
    const method = (req.method ?? "GET").toUpperCase();
    const { origin, path } = urlParts(req.url);
    const raw = req.body?.mode === "raw" ? req.body.raw : undefined;
    out.push({
      group,
      name: it.name || `${method} ${path}`,
      method,
      origin,
      path,
      sampleBody: typeof raw === "string" ? raw.slice(0, 4000) : undefined,
      secretsDropped: secretHeaderCount(req.header),
    });
  }
}

let n = 0;
function nid(prefix: string): string {
  n += 1;
  return `postman-${prefix}-${n}`;
}

export async function importPostman(
  dir: string,
  args: { name?: string; collectionJson?: string; file?: string; overwrite?: boolean },
): Promise<ToolResult> {
  let text = args.collectionJson ?? "";
  if (!text && args.file) {
    const raw = readJson(`${dir}/${args.file}`.replace(/\\/g, "/"));
    text = typeof raw === "string" ? raw : JSON.stringify(raw);
  }
  if (!text.trim()) {
    return { ok: false, summary: "No collection.", error: "Pass collectionJson (the collection text) or file (a workspace .json filename)." };
  }
  if (text.length > 500000) {
    return { ok: false, summary: "Collection too large.", error: "Collections over ~500KB must be split by folder and imported in parts." };
  }
  let col: PmCollection;
  try {
    col = JSON.parse(text) as PmCollection;
  } catch {
    return { ok: false, summary: "Not JSON.", error: "collectionJson is not valid JSON - export the collection v2.1 format from Postman." };
  }
  if (!Array.isArray(col.item)) {
    return { ok: false, summary: "Not a collection.", error: "JSON has no item array - is this a Postman Collection (v2.1)?" };
  }
  const flat: FlatReq[] = [];
  flatten(col.item, "", flat);
  if (flat.length === 0) return { ok: false, summary: "No requests.", error: "No usable requests found in this collection." };
  if (flat.length > 200) {
    return { ok: false, summary: "Too many requests.", error: `This collection has ${flat.length} requests (max 200) - split by folder first.` };
  }

  n = 0;
  const sysIface = new Map<string, string>();
  const projectName = args.name ?? col.info?.name ?? "Postman import";
  const systems: SystemNode[] = [];
  const interfaces: SystemInterface[] = [];
  const operations: SystemOperation[] = [];
  const connections: SystemConnection[] = [];
  const sysByGroup = new Map<string, SystemNode>();
  const opsByRequest: SystemOperation[] = [];
  let secretsDropped = 0;

  for (const r of flat) {
    const group = r.group || `${projectName} APIs`;
    let sys = sysByGroup.get(group);
    if (!sys) {
      sys = {
        id: nid("sys"),
        name: group,
        systemType: guessType(r.origin),
        description: `Imported from Postman collection "${projectName}".`,
        baseUrl: r.origin || undefined,
        position: { x: 80 + sysByGroup.size * 360, y: 120 },
        iconKey: "server",
      };
      sysByGroup.set(group, sys);
      systems.push(sys);
      const iface: SystemInterface = {
        id: nid("if"),
        systemId: sys.id,
        name: "REST",
        protocol: "REST",
        basePath: "",
      };
      interfaces.push(iface);
      sysIface.set(sys.id, iface.id);
    }
    const op: SystemOperation = {
      id: nid("op"),
      interfaceId: sysIface.get(sys.id)!,
      name: r.name.slice(0, 120),
      method: (["GET", "POST", "PUT", "PATCH", "DELETE"].includes(r.method) ? r.method : "GET") as SystemOperation["method"],
      path: r.path,
      version: "",
      sampleBody: r.sampleBody,
    };
    operations.push(op);
    opsByRequest.push(op);
    secretsDropped += r.secretsDropped;
  }

  // Draft sequence edges inside each group, in collection order.
  const byGroup = new Map<string, SystemOperation[]>();
  flat.forEach((r, i) => {
    const key = r.group || `${projectName} APIs`;
    const list = byGroup.get(key) ?? [];
    list.push(opsByRequest[i]);
    byGroup.set(key, list);
  });
  for (const list of byGroup.values()) {
    for (let i = 1; i < list.length; i += 1) {
      const a = list[i - 1];
      const b = list[i];
      const sysA = interfaces.find((f) => f.id === a.interfaceId)?.systemId;
      const sysB = interfaces.find((f) => f.id === b.interfaceId)?.systemId;
      if (!sysA || !sysB) continue;
      connections.push({
        id: nid("conn"),
        sourceId: sysA,
        targetId: sysB,
        label: sysA === sysB ? "follows" : "calls",
        status: "draft",
        sourceOperationId: a.id,
        targetOperationId: b.id,
      });
    }
  }

  const origins = [...new Set(flat.map((r) => r.origin).filter(Boolean))];
  const project: SystemProject = {
    id: `postman_${Date.now().toString(36)}`,
    name: projectName,
    schemaVersion: SYSTEM_DESIGN_SCHEMA_VERSION,
    updatedAt: Date.now(),
    systems,
    connections,
    interfaces,
    operations,
    environments: origins.length > 0 ? [{ id: nid("env"), name: "Imported", baseUrl: origins[0], baseUrlOverrides: {} }] : [],
    activeEnvironmentId: null,
    notes: `Imported from Postman collection "${projectName}" (${flat.length} requests). Draft edges are collection-order guesses - confirm them on canvas.${secretsDropped > 0 ? ` ${secretsDropped} auth header(s) were dropped, never stored.` : ""}`,
    notesFormat: "md",
    todos: [],
    canvasNotes: [],
    canvasImages: [],
    groups: [],
    flows: [],
    scenarios: [],
    settings: { retentionDays: 30 },
  };

  // Round-trip through the studio validator: only studio-openable files land.
  const check = importProject(exportProject(project) as unknown);
  if (!check.project) {
    return {
      ok: false,
      summary: "Import build failed validation.",
      error: check.issues.slice(0, 8).map((i) => `${i.path}: ${i.message}`).join(" "),
    };
  }
  const file = claimFile(dir, "system", projectName, args.overwrite);
  writeJson(file, exportProject(project));
  return {
    ok: true,
    file,
    summary: `System project "${projectName}": ${systems.length} system(s), ${operations.length} operation(s), ${connections.length} draft edge(s). Open via System Design Import; confirm the draft edges.`,
    data: {
      id: project.id,
      systems: systems.map((s) => s.name),
      operations: operations.length,
      draftEdges: connections.length,
      secretsDropped,
    },
  };
}

export const postmanTools: McpTool[] = [
  {
    name: "system_import_postman",
    description:
      "Import a Postman Collection v2.1 into a GRAVENX system project: one system per folder, every request an operation, collection-order draft edges. Auth headers are dropped, never stored. Open via System Design Import.",
    shape: {
      name: z.string().max(160).optional().describe("Project name (defaults to the collection name)"),
      collectionJson: z.string().max(500000).optional().describe("The collection JSON text"),
      file: z.string().max(200).optional().describe("Workspace .json filename holding the collection, as an alternative"),
      overwrite: z.boolean().optional(),
    },
    run: (dir, args) =>
      importPostman(
        dir,
        args as { name?: string; collectionJson?: string; file?: string; overwrite?: boolean },
      ),
  },
];
