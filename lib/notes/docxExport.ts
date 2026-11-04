import {
  ExternalHyperlink,
  File,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  TextRun,
} from "docx";
import type { CanvasTodo } from "@/lib/inbox/types";
import { mdToHtml, type NoteBody } from "@/lib/notes/notebody";
import { HIGHLIGHT_COLORS } from "@/lib/decisions/richtext";

/**
 * Per-entry Word export: the editor stays the source of truth and whatever
 * is in it (rich HTML or markdown) lands in a styled .docx - title header,
 * lifecycle metadata, then the body with headings, lists, checkboxes,
 * code, quotes, links and highlight colors preserved.
 */

export type DocxRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  code?: boolean;
  /** Hex without "#", e.g. "FFEB9C". */
  shade?: string;
  link?: string;
};

export type DocxBlockKind = "p" | "h1" | "h2" | "h3" | "bullet" | "numbered" | "quote" | "code";

export type DocxBlock = {
  kind: DocxBlockKind;
  /** Nesting level for list items (0-8). */
  level?: number;
  /** 1-based position inside its ordered list. */
  index?: number;
  runs: DocxRun[];
};

const VALID_SHADE = new Set<string>(HIGHLIGHT_COLORS.map((c) => c.replace("#", "").toUpperCase()));
const TOKEN = /<!--[\s\S]*?-->|<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>]*)?\s*\/?>|[^<]+/g;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function parseTag(token: string): { close: boolean; name: string; attrs: string } | null {
  const m = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>$/.exec(token.trim());
  if (!m) return null;
  return { close: m[1] === "/", name: m[2].toLowerCase(), attrs: m[3] ?? "" };
}

function parseHref(attrs: string): string | undefined {
  const m = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  const raw = (m?.[2] ?? m?.[3] ?? m?.[4] ?? "").trim();
  if (/^(https?:\/\/|mailto:)/i.test(raw)) return raw;
  return undefined;
}

function parseShade(attrs: string): string | undefined {
  const m = /data-color\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  const raw = (m?.[2] ?? m?.[3] ?? m?.[4] ?? "").trim().replace("#", "").toUpperCase();
  if (VALID_SHADE.has(raw)) return raw;
  return undefined;
}

/**
 * Sanitized entry HTML (our allowlist: p h1 h2 h3 strong em s u code
 * pre blockquote ul ol li a mark br) to an intermediate block list.
 * DOM-free so it runs in Node tests and the browser alike.
 */
export function htmlToDocxBlocks(html: string): DocxBlock[] {
  const blocks: DocxBlock[] = [];
  let current: DocxBlock | null = null;
  const listStack: ("ul" | "ol")[] = [];
  const olCounters: number[] = [];
  const marks = { bold: 0, italic: 0, strike: 0, underline: 0, code: 0 };
  const linkStack: (string | undefined)[] = [];
  const shadeStack: (string | undefined)[] = [];
  let preMode = false;

  const openBlock = (kind: DocxBlockKind, level?: number, index?: number) => {
    current = { kind, runs: [], ...(level !== undefined ? { level } : {}), ...(index !== undefined ? { index } : {}) };
    blocks.push(current);
  };
  const pushText = (raw: string) => {
    const text = preMode ? raw.replace(/\r\n?/g, "\n") : decodeEntities(raw);
    if (!text || (!preMode && !text.trim())) return;
    if (!current) openBlock("p");
    const run: DocxRun = { text };
    if (marks.bold > 0) run.bold = true;
    if (marks.italic > 0) run.italic = true;
    if (marks.strike > 0) run.strike = true;
    if (marks.underline > 0) run.underline = true;
    if (marks.code > 0 || preMode) run.code = true;
    const link = linkStack.length > 0 ? linkStack[linkStack.length - 1] : undefined;
    if (link) run.link = link;
    const shade = shadeStack.length > 0 ? shadeStack[shadeStack.length - 1] : undefined;
    if (shade) run.shade = shade;
    const prev = current!.runs[current!.runs.length - 1];
    if (
      prev &&
      prev.bold === run.bold &&
      prev.italic === run.italic &&
      prev.strike === run.strike &&
      prev.underline === run.underline &&
      prev.code === run.code &&
      prev.link === run.link &&
      prev.shade === run.shade
    ) {
      prev.text += run.text;
    } else {
      current!.runs.push(run);
    }
  };

  for (const token of html.match(TOKEN) ?? []) {
    if (!token.startsWith("<")) {
      pushText(token);
      continue;
    }
    const tag = parseTag(token);
    if (!tag || token.startsWith("<!--")) continue;
    const { close, name, attrs } = tag;
    if (!close) {
      switch (name) {
        case "p":
          openBlock("p");
          break;
        case "h1":
          openBlock("h1");
          break;
        case "h2":
          openBlock("h2");
          break;
        case "h3":
          openBlock("h3");
          break;
        case "blockquote":
          openBlock("quote");
          break;
        case "pre":
          openBlock("code");
          preMode = true;
          break;
        case "ul":
          listStack.push("ul");
          break;
        case "ol":
          listStack.push("ol");
          olCounters.push(0);
          break;
        case "li": {
          const inner = listStack[listStack.length - 1];
          const level = Math.min(Math.max(listStack.length - 1, 0), 8);
          if (inner === "ol") {
            const n = (olCounters.pop() ?? 0) + 1;
            olCounters.push(n);
            openBlock("numbered", level, n);
          } else {
            openBlock("bullet", level);
          }
          break;
        }
        case "br":
          pushText("\n");
          break;
        case "strong":
        case "b":
          marks.bold += 1;
          break;
        case "em":
        case "i":
          marks.italic += 1;
          break;
        case "s":
        case "strike":
          marks.strike += 1;
          break;
        case "u":
          marks.underline += 1;
          break;
        case "code":
          marks.code += 1;
          break;
        case "a":
          linkStack.push(parseHref(attrs));
          break;
        case "mark":
          shadeStack.push(parseShade(attrs) ?? "FFEB9C");
          break;
        default:
          break;
      }
    } else {
      switch (name) {
        case "ul":
          if (listStack[listStack.length - 1] === "ul") listStack.pop();
          break;
        case "ol":
          if (listStack[listStack.length - 1] === "ol") {
            listStack.pop();
            olCounters.pop();
          }
          break;
        case "pre":
          preMode = false;
          break;
        case "strong":
        case "b":
          marks.bold = Math.max(0, marks.bold - 1);
          break;
        case "em":
        case "i":
          marks.italic = Math.max(0, marks.italic - 1);
          break;
        case "s":
        case "strike":
          marks.strike = Math.max(0, marks.strike - 1);
          break;
        case "u":
          marks.underline = Math.max(0, marks.underline - 1);
          break;
        case "code":
          marks.code = Math.max(0, marks.code - 1);
          break;
        case "a":
          linkStack.pop();
          break;
        case "mark":
          shadeStack.pop();
          break;
        default:
          break;
      }
    }
  }
  return blocks.filter((b) => b.runs.some((r) => r.text !== ""));
}

const CODE_SHADE = "F2EFE6";
const MUTED = "777168";
const BURGUNDY = "722F37";

function toTextRuns(runs: DocxRun[], forceFont?: string, forceColor?: string): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  for (const run of runs) {
    // Split hard breaks so Word honors line structure inside one paragraph.
    const parts = run.text.split("\n");
    parts.forEach((part, i) => {
      if (part === "" && parts.length > 1) return;
      const tr = new TextRun({
        text: part,
        ...(run.bold ? { bold: true } : {}),
        ...(run.italic ? { italics: true } : {}),
        ...(run.strike ? { strike: true } : {}),
        ...(run.underline ? { underline: {} } : {}),
        ...(forceFont || run.code ? { font: forceFont ?? "Consolas" } : {}),
        ...(forceColor ? { color: forceColor } : {}),
        ...(run.shade ? { shading: { type: ShadingType.CLEAR, fill: run.shade } } : {}),
        ...(run.code && !forceFont ? { shading: { type: ShadingType.CLEAR, fill: CODE_SHADE } } : {}),
        ...(i > 0 ? { break: 1 } : {}),
      });
      out.push(run.link ? new ExternalHyperlink({ children: [tr], link: run.link }) : tr);
    });
  }
  return out;
}

function blockToParagraph(block: DocxBlock): Paragraph | null {
  if (block.kind === "code") {
    const children = toTextRuns(block.runs, "Consolas");
    if (children.length === 0) return null;
    return new Paragraph({
      children,
      shading: { type: ShadingType.CLEAR, fill: CODE_SHADE },
    });
  }
  const children = toTextRuns(block.runs, undefined, block.kind === "quote" ? MUTED : undefined);
  if (children.length === 0) return null;
  switch (block.kind) {
    case "h1":
      return new Paragraph({ heading: HeadingLevel.HEADING_1, children });
    case "h2":
      return new Paragraph({ heading: HeadingLevel.HEADING_2, children });
    case "h3":
      return new Paragraph({ heading: HeadingLevel.HEADING_3, children });
    case "bullet":
      return new Paragraph({ bullet: { level: Math.min(block.level ?? 0, 8) }, children });
    case "numbered":
      return new Paragraph({
        indent: { left: 720, hanging: 360 },
        children: [new TextRun({ text: `${block.index ?? 1}.  `, bold: true }), ...children],
      });
    case "quote":
      return new Paragraph({ indent: { left: 720 }, children });
    default:
      return new Paragraph({ children });
  }
}

function metaLine(parts: (string | undefined)[]): Paragraph | null {
  const text = parts.filter((p) => p && p.trim()).join("  ·  ");
  if (!text) return null;
  return new Paragraph({
    children: [new TextRun({ text, color: MUTED })],
    spacing: { after: 120 },
  });
}

function dateLine(n: number): string {
  const d = new Date(n);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const KIND_LABEL: Record<string, string> = { note: "Note", task: "Task", question: "Question", decision: "Decision" };

/** Whatever the editor holds (rich HTML preferred, markdown converted) as blocks. */
export function entryBodyBlocks(entry: Pick<CanvasTodo, "body" | "bodyFormat" | "bodyHtml">): DocxBlock[] {
  const html = entry.bodyFormat === "rich" && entry.bodyHtml?.trim() ? entry.bodyHtml : mdToHtml(entry.body ?? "");
  if (!html.trim()) return [];
  return htmlToDocxBlocks(html);
}

/** Download filename: account-task-verify-lookup-20261007.docx style. */
export function entryDocxFilename(apiName: string, entry: Pick<CanvasTodo, "kind" | "title">): string {
  const slug = (entry.title.trim() || entry.kind || "entry")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return `${apiName.toLowerCase()}-${entry.kind ?? "note"}-${slug || "entry"}-${stamp}.docx`;
}

export function buildEntryDocx(apiName: string, entityLabel: string, entry: CanvasTodo): File {
  const title = entry.title.trim() || "Untitled entry";
  const kind = entry.kind ?? "note";
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: title, color: BURGUNDY, bold: true })],
    }),
    metaLine([entityLabel, KIND_LABEL[kind] ?? kind, entry.status]) ?? new Paragraph({ children: [] }),
    metaLine([
      entry.owner ?? entry.assignee ? `Owner ${entry.owner ?? entry.assignee}` : undefined,
      entry.team ? `Team ${entry.team}` : undefined,
      entry.dueDate ? `Due ${entry.dueDate}` : undefined,
      entry.anchor && entry.anchor.type !== "canvas" ? `Anchor ${entry.anchor.id}` : undefined,
      `Updated ${dateLine(entry.updatedAt)}`,
    ]) ?? new Paragraph({ children: [] }),
  ];
  const blocks = entryBodyBlocks(entry);
  if (blocks.length === 0) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "No description recorded.", color: MUTED, italics: true })],
        spacing: { before: 200 },
      }),
    );
  } else {
    for (const block of blocks) {
      const p = blockToParagraph(block);
      if (p) children.push(p);
    }
  }
  if (entry.resolution?.trim()) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Resolution" })], spacing: { before: 320 } }),
    );
    for (const line of entry.resolution.split("\n")) {
      if (!line.trim()) continue;
      children.push(new Paragraph({ children: [new TextRun({ text: line })] }));
    }
  }
  return new File({
    creator: "GRAVENX",
    title: `${entityLabel} - ${title}`,
    subject: `${KIND_LABEL[kind] ?? kind} log entry`,
    description: `Exported from GRAVENX on ${dateLine(Date.now())}.`,
    sections: [{ children }],
  });
}

export async function entryToDocxBlob(apiName: string, entityLabel: string, entry: CanvasTodo): Promise<Blob> {
  return Packer.toBlob(buildEntryDocx(apiName, entityLabel, entry));
}

/** Download filename for a free note: design-notes-20261007.docx style. */
export function noteDocxFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return `${slug || "note"}-${stamp}.docx`;
}

/** A titled free note (canvas prose, standalone notes) as a styled document. */
export function buildNoteDocx(title: string, meta: string[], body: NoteBody): File {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: title, color: BURGUNDY, bold: true })],
    }),
    metaLine(meta) ?? new Paragraph({ children: [] }),
  ];
  const blocks = entryBodyBlocks({ body: body.md, bodyFormat: body.format, bodyHtml: body.html });
  if (blocks.length === 0) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "No content recorded.", color: MUTED, italics: true })],
        spacing: { before: 200 },
      }),
    );
  } else {
    for (const block of blocks) {
      const p = blockToParagraph(block);
      if (p) children.push(p);
    }
  }
  return new File({
    creator: "GRAVENX",
    title,
    subject: "note",
    description: `Exported from GRAVENX on ${dateLine(Date.now())}.`,
    sections: [{ children }],
  });
}

export async function noteToDocxBlob(title: string, meta: string[], body: NoteBody): Promise<Blob> {
  return Packer.toBlob(buildNoteDocx(title, meta, body));
}
