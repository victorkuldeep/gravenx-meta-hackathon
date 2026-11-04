/**
 * JIRA Cloud push: pure core + thin client over our same-origin proxy
 * (/api/pmo/jira). The token rides per request and is never stored
 * server-side - the same posture as the Salesforce and AI proxies.
 *
 * JIRA needs Atlassian Document Format for rich descriptions, so the Console
 * markdown body goes through a small deterministic MD→ADF converter below.
 * V1 block coverage: headings, paragraphs, bullet/ordered lists, quotes,
 * code blocks, rules. Tables and nested lists degrade to paragraphs.
 */

export interface JiraCreds {
  site: string;
  email: string;
  token: string;
}

export interface JiraIssueType {
  id: string;
  name: string;
}

export interface JiraProject {
  key: string;
  name: string;
  issueTypes: JiraIssueType[];
}

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export interface AdfDoc {
  version: 1;
  type: "doc";
  content: AdfNode[];
}

/** JIRA Cloud only: https origin on *.atlassian.net, no path, no creds. */
export function normalizeJiraSite(input: string): { ok: true; site: string } | { ok: false; error: string } {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Enter your JIRA site, e.g. acme.atlassian.net." };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "That site URL does not parse." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "JIRA site must be https." };
  if (url.username || url.password) return { ok: false, error: "Credentials in the URL are not allowed." };
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9-]+\.atlassian\.net$/.test(host)) {
    return { ok: false, error: "Only *.atlassian.net Cloud sites are supported." };
  }
  return { ok: true, site: `https://${host}` };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Reads GET /rest/api/v3/issue/createmeta?expand=projects.issuetypes.
 * Sub-tasks are filtered - Console pushes are always top-level work.
 */
export function parseCreateMeta(json: unknown): JiraProject[] {
  if (!isRecord(json) || !Array.isArray(json.projects)) return [];
  const out: JiraProject[] = [];
  for (const p of json.projects) {
    if (!isRecord(p) || typeof p.key !== "string" || typeof p.name !== "string") continue;
    if (!Array.isArray(p.issuetypes)) continue;
    const issueTypes: JiraIssueType[] = [];
    for (const t of p.issuetypes) {
      if (!isRecord(t) || typeof t.id !== "string" || typeof t.name !== "string") continue;
      if (t.subtask === true) continue;
      issueTypes.push({ id: t.id, name: t.name });
    }
    if (issueTypes.length === 0) continue;
    out.push({ key: p.key, name: p.name, issueTypes });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const INLINE_SRC =
  "(`[^`\\n]+`)|(\\*\\*([^*\\n]+)\\*\\*)|(__([^_\\n]+)__)|(?<!\\w)\\*([^*\\n]+)\\*(?!\\w)|(?<!\\w)_([^_\\n]+)_(?!\\w)|(~~([^~\\n]+)~~)|\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)";

function textNode(text: string, marks: { type: string; attrs?: Record<string, unknown> }[] = []): AdfNode {
  const node: AdfNode = { type: "text", text };
  if (marks.length > 0) node.marks = marks;
  return node;
}

/** Inline markdown → ADF text nodes. Code spans win over emphasis. */
export function mdInlineToAdf(src: string): AdfNode[] {
  const out: AdfNode[] = [];
  const inline = new RegExp(INLINE_SRC, "g");
  let last = 0;
  for (let m = inline.exec(src); m; m = inline.exec(src)) {
    if (m.index > last) out.push(textNode(src.slice(last, m.index)));
    if (m[1]) out.push(textNode(m[1].slice(1, -1), [{ type: "code" }]));
    else if (m[2]) out.push(textNode(m[3], [{ type: "strong" }]));
    else if (m[4]) out.push(textNode(m[5], [{ type: "strong" }]));
    else if (m[6]) out.push(textNode(m[6], [{ type: "em" }]));
    else if (m[7]) out.push(textNode(m[7], [{ type: "em" }]));
    else if (m[8]) out.push(textNode(m[9], [{ type: "strike" }]));
    else if (m[10]) out.push(textNode(m[10], [{ type: "link", attrs: { href: m[11] } }]));
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(textNode(src.slice(last)));
  if (out.length === 0) out.push(textNode(""));
  return out;
}

function para(lines: string[]): AdfNode {
  return { type: "paragraph", content: mdInlineToAdf(lines.join(" ")) };
}

/** Block markdown → ADF doc. Deterministic, dependency-free. */
export function mdToAdf(md: string): AdfDoc {
  const content: AdfNode[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  const flushList = (items: string[][], ordered: boolean) => {
    if (items.length === 0) return;
    content.push({
      type: ordered ? "orderedList" : "bulletList",
      content: items.map((ls) => ({ type: "listItem", content: [para(ls)] })),
    });
  };
  let bullets: string[][] = [];
  let ordereds: string[][] = [];
  const flushLists = () => {
    flushList(bullets, false);
    flushList(ordereds, true);
    bullets = [];
    ordereds = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith("```")) {
      flushLists();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      content.push({ type: "codeBlock", content: buf.length > 0 ? [{ type: "text", text: buf.join("\n") }] : [] });
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(t);
    if (heading) {
      flushLists();
      content.push({ type: "heading", attrs: { level: heading[1].length }, content: mdInlineToAdf(heading[2]) });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flushLists();
      content.push({ type: "rule" });
      i++;
      continue;
    }
    if (/^>\s?/.test(t)) {
      flushLists();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      content.push({ type: "blockquote", content: [para(buf)] });
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.+)$/.exec(line);
    if (bullet) {
      flushList(ordereds, true);
      ordereds = [];
      bullets.push([bullet[1]]);
      i++;
      continue;
    }
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ordered) {
      flushList(bullets, false);
      bullets = [];
      ordereds.push([ordered[1]]);
      i++;
      continue;
    }
    if (t === "") {
      flushLists();
      i++;
      continue;
    }
    flushLists();
    const buf: string[] = [t];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6}\s|```|>\s?|\s*[-*•]\s+|\s*\d+[.)]\s+|(-{3,}|\*{3,}|_{3,})$)/.test(lines[i])
    ) {
      buf.push(lines[i].trim());
      i++;
    }
    content.push(para(buf));
  }
  flushLists();
  if (content.length === 0) content.push({ type: "paragraph", content: [{ type: "text", text: "" }] });
  return { version: 1, type: "doc", content };
}

export interface JiraIssueInput {
  projectKey: string;
  issueTypeId: string;
  summary: string;
  description: AdfDoc;
  labels: string[];
}

/** Console task → JIRA create payload. Labels trace back to the Console. */
export function buildJiraIssueInput(
  task: { id: string; title: string; body?: string; kind?: string },
  projectKey: string,
  issueTypeId: string,
): JiraIssueInput {
  return {
    projectKey,
    issueTypeId,
    summary: task.title.trim().slice(0, 255) || "Untitled Console task",
    description: mdToAdf(task.body?.trim() ? task.body : "_Logged from GRAVENX Console - no description yet._"),
    labels: ["gravenx-console", `gravenx-${task.kind ?? "task"}`],
  };
}

export interface JiraIssueRef {
  key: string;
  url: string;
}

async function postJira(action: string, payload: Record<string, unknown>): Promise<unknown> {
  const res = await fetch("/api/pmo/jira", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!isRecord(json) || json.ok !== true) {
    const error = isRecord(json) && typeof json.error === "string" ? json.error : `Request failed (${res.status}).`;
    throw new Error(error);
  }
  return json;
}

/** Live project → issue-type map so the architect picks a real destination. */
export async function fetchCreateMeta(creds: JiraCreds): Promise<JiraProject[]> {
  const json = await postJira("createmeta", { ...creds });
  if (!isRecord(json) || !("meta" in json)) throw new Error("Unexpected response from JIRA.");
  const projects = parseCreateMeta(json.meta);
  if (projects.length === 0) throw new Error("No creatable projects on this site for this user.");
  return projects;
}

/**
 * ADF → plain text for ticket ingress. Headings, lists, code and quotes
 * survive as Markdown-ish lines; mentions/cards collapse to their labels.
 * Unknown nodes degrade to their children - never to silence.
 */
export function adfToText(node: unknown): string {
  if (!isRecord(node)) return typeof node === "string" ? node : "";
  const kids = Array.isArray(node.content) ? node.content.map(adfToText).join("") : "";
  switch (node.type) {
    case "doc":
      return kids.replace(/\n{3,}/g, "\n\n").trim();
    case "text":
      return typeof node.text === "string" ? node.text : "";
    case "hardBreak":
      return "\n";
    case "paragraph":
      return `${kids}\n\n`;
    case "heading": {
      const lv: unknown = isRecord(node.attrs) ? node.attrs.level : undefined;
      const level = typeof lv === "number" ? Math.min(6, Math.max(1, lv)) : 1;
      return `${"#".repeat(level)} ${kids}\n\n`;
    }
    case "bulletList":
      return `${kids}\n`;
    case "orderedList": {
      let i = 0;
      const items = (Array.isArray(node.content) ? node.content : [])
        .map((li) => `${++i}. ${adfToText(li).trim()}`)
        .join("\n");
      return `${items}\n\n`;
    }
    case "listItem":
      return `- ${kids.trim()}\n`;
    case "codeBlock":
      return `\`\`\`\n${kids.replace(/\n+$/, "")}\n\`\`\`\n\n`;
    case "blockquote":
      return `${kids
        .trim()
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n")}\n\n`;
    case "rule":
      return `---\n\n`;
    case "mention": {
      const tx: unknown = isRecord(node.attrs) ? node.attrs.text : undefined;
      const name = typeof tx === "string" ? tx : "someone";
      return `@${name}`;
    }
    case "inlineCard":
    case "blockCard": {
      const u: unknown = isRecord(node.attrs) ? node.attrs.url : undefined;
      const url = typeof u === "string" ? u : "";
      return url ? `[link](${url})` : "[link]";
    }
    default:
      return kids ? `${kids}\n\n` : "";
  }
}

export interface JiraIssueDetail {
  key: string;
  summary: string;
  description: string;
  status: string;
  issueType: string;
  priority: string;
  labels: string[];
  commentCount: number;
  recentComments: string[];
}

export function normalizeJiraKey(input: string): { ok: true; key: string } | { ok: false; error: string } {
  const key = input.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) return { ok: false, error: "That is not a ticket key - use ABC-123." };
  return { ok: true, key };
}

/** Ticket ingress: summary + description + status + last comments, as text. */
export async function fetchJiraIssue(creds: JiraCreds, key: string): Promise<JiraIssueDetail> {
  const json = await postJira("get", { ...creds, issueKey: key });
  if (!isRecord(json) || !("issue" in json) || !isRecord(json.issue)) throw new Error("Unexpected response from JIRA.");
  const issue = json.issue;
  const fields = isRecord(issue.fields) ? issue.fields : {};
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const named = (v: unknown): string => (isRecord(v) && typeof v.name === "string" ? v.name : "");
  const comments = isRecord(fields.comment) && Array.isArray(fields.comment.comments) ? fields.comment.comments : [];
  const recentComments = comments
    .slice(-3)
    .map((c: unknown) => (isRecord(c) && "body" in c ? adfToText(c.body).trim() : ""))
    .filter(Boolean);
  return {
    key: str(issue.key) || key,
    summary: str(fields.summary),
    description: adfToText(fields.description).trim(),
    status: named(fields.status),
    issueType: named(fields.issuetype),
    priority: named(fields.priority),
    labels: Array.isArray(fields.labels) ? fields.labels.filter((l): l is string => typeof l === "string") : [],
    commentCount: typeof fields.comment === "object" && fields.comment !== null && typeof (fields.comment as { total?: unknown }).total === "number" ? (fields.comment as { total: number }).total : comments.length,
    recentComments,
  };
}

export async function createJiraIssue(creds: JiraCreds, input: JiraIssueInput): Promise<JiraIssueRef> {
  const json = await postJira("create", {
    ...creds,
    projectKey: input.projectKey,
    issueTypeId: input.issueTypeId,
    summary: input.summary,
    description: input.description,
    labels: input.labels,
  });
  if (!isRecord(json) || typeof json.key !== "string" || typeof json.url !== "string") {
    throw new Error("Unexpected response from JIRA.");
  }
  return { key: json.key, url: json.url };
}

/** Screenshot bytes travel as multipart - the proxy forwards them untouched. */
export async function attachJiraFile(creds: JiraCreds, issueKey: string, file: Blob, filename: string): Promise<void> {
  const form = new FormData();
  form.set("action", "attach");
  form.set("site", creds.site);
  form.set("email", creds.email);
  form.set("token", creds.token);
  form.set("issueKey", issueKey);
  form.set("file", file, filename);
  const res = await fetch("/api/pmo/jira", { method: "POST", body: form });
  const json: unknown = await res.json().catch(() => null);
  if (!isRecord(json) || json.ok !== true) {
    const error = isRecord(json) && typeof json.error === "string" ? json.error : `Upload failed (${res.status}).`;
    throw new Error(error);
  }
}
