/**
 * Dual-format note bodies: every note that offers the Rich/Markdown choice
 * stores BOTH representations, kept fresh on every commit. The Markdown side
 * feeds previews, exports, search and AI; the HTML side feeds the rich
 * editor. Switching editors without editing is lossless - the untouched side
 * is preserved verbatim, so highlight colors survive a peek at the Markdown.
 *
 * Converters cover the shared subset (headings, bold/italic/strike, code,
 * lists, task items, quotes, highlights, links). Markdown has no colors: a
 * colored highlight degrades to ==text== there and returns default yellow.
 * DOM-free so tests run in Node.
 */

import { sanitizeDecisionHtml } from "@/lib/decisions/richtext";

export type NoteFormat = "md" | "rich";

export interface NoteBody {
  /** The editor the author last used - per-note memory. */
  format: NoteFormat;
  /** Markdown side: previews, exports, search, AI. Always fresh. */
  md: string;
  /** Sanitized HTML side: the rich editor. Always fresh. */
  html: string;
}

export const NOTE_MD_MAX = 12000;
export const NOTE_HTML_MAX = 30000;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

/** Inline markdown-lite spans → HTML. Input must already be escaped. */
function mdInlineToHtml(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/==([^=]+)==/g, "<mark>$1</mark>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

const BULLET_RE = /^\s*[-*]\s+/;
/**
 * Ordered markers include dotted hierarchy (1.1., 2.1) - depth follows the
 * dots. Multi-segment markers need their closing dot/paren, so a line
 * starting with a bare decimal ("3.14 pi") stays a paragraph.
 */
const ORDERED_RE = /^\s*(?:\d+[.)]|\d+(?:\.\d+)+[.)])\s+/;

interface ListNode {
  html: string;
  children: ListNode[];
}

function mdListItems(lines: string[], ordered: boolean): { depth: number; html: string }[] {
  return lines.map((l) => {
    const m = ordered ? /^\s*(\d+[.)]|\d+(?:\.\d+)+[.)])\s+([\s\S]*)$/.exec(l) : /^\s*[-*]\s+([\s\S]*)$/.exec(l);
    const marker = ordered ? (m?.[1] ?? "") : "";
    const rest = (ordered ? m?.[2] : m?.[1]) ?? l;
    const depth = ordered ? marker.replace(/[.)]$/, "").split(".").length - 1 : 0;
    const task = /^\[([ xX])\]\s+([\s\S]*)$/.exec(rest);
    if (task) {
      const box = task[1] === " " ? "☐" : "☑";
      return { depth, html: `${box} ${mdInlineToHtml(escapeHtml(task[2]))}` };
    }
    return { depth, html: mdInlineToHtml(escapeHtml(rest)) };
  });
}

function mdToHtmlListBlock(lines: string[], ordered: boolean): string {
  const items = mdListItems(lines, ordered);
  if (!ordered) {
    return `<ul>${items.map((i) => `<li>${i.html}</li>`).join("")}</ul>`;
  }
  // Nest by dotted depth so 1.1. survives as structure, not a paragraph.
  const root: ListNode[] = [];
  const stack: { depth: number; node: ListNode }[] = [];
  for (const item of items) {
    const node: ListNode = { html: item.html, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].depth >= item.depth) stack.pop();
    if (stack.length === 0) root.push(node);
    else stack[stack.length - 1].node.children.push(node);
    stack.push({ depth: item.depth, node });
  }
  const render = (nodes: ListNode[]): string =>
    `<ol>${nodes.map((n) => `<li>${n.html}${n.children.length > 0 ? render(n.children) : ""}</li>`).join("")}</ol>`;
  return render(root);
}

/** Markdown-lite → sanitized HTML (the shared subset). */
export function mdToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre>${escapeHtml(buf.join("\n"))}</pre>`);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const tag = h[1].length === 1 ? "h1" : h[1].length === 2 ? "h2" : "h3";
      out.push(`<${tag}>${mdInlineToHtml(escapeHtml(h[2]))}</${tag}>`);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      i++;
      continue;
    }
    const q: string[] = [];
    while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
      q.push(mdInlineToHtml(escapeHtml(lines[i].replace(/^\s*>\s?/, ""))));
      i++;
    }
    if (q.length > 0) {
      out.push(`<blockquote>${q.join("<br>")}</blockquote>`);
      continue;
    }
    if (BULLET_RE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) { buf.push(lines[i]); i++; }
      out.push(mdToHtmlListBlock(buf, false));
      continue;
    }
    if (ORDERED_RE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && ORDERED_RE.test(lines[i])) { buf.push(lines[i]); i++; }
      out.push(mdToHtmlListBlock(buf, true));
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const buf = [mdInlineToHtml(escapeHtml(line))];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3}\s|```|---+\s*$|\s*>\s?|(\s*)[-*]\s|(\s*)(?:\d+[.)]|\d+(?:\.\d+)+[.)])\s)/.test(lines[i])
    ) {
      buf.push(mdInlineToHtml(escapeHtml(lines[i])));
      i++;
    }
    out.push(`<p>${buf.join("<br>")}</p>`);
  }
  return sanitizeDecisionHtml(out.join(""));
}

interface ListCtx {
  ordered: boolean;
  n: number;
}

/**
 * Sanitized editor HTML → Markdown-lite. Handles nesting by indenting two
 * spaces per level; task boxes (☐/☑) map back to - [ ]/- [x].
 */
export function htmlToMd(html: string): string {
  const clean = sanitizeDecisionHtml(html);
  if (!clean.trim()) return "";
  const blocks: string[] = [];
  const listStack: ListCtx[] = [];
  let para: string[] = [];
  let quoteDepth = 0;
  let pre = false;
  let preBuf = "";

  const pushBlock = (text: string) => {
    const cleanText = text.trim();
    if (!cleanText) return;
    blocks.push(quoteDepth > 0 ? cleanText.split("\n").map((l) => `> ${l}`).join("\n") : cleanText);
  };

  const flushPara = () => {
    pushBlock(para.join(""));
    para = [];
  };

  // Emit the pending <li> text as a numbered/bullet markdown line. Used on
  // </li> - and when a nested list opens: the parent's own line must ship
  // before the sublist, or parents with children lose their number.
  const emitPendingItem = () => {
    const ctx = listStack[listStack.length - 1];
    let text = para.join("").trim();
    para = [];
    if (!text) return;
    if (!ctx) {
      pushBlock(text);
      return;
    }
    const indent = "  ".repeat(Math.max(0, listStack.length - 1));
    const box = text.startsWith("☐ ") ? "[ ] " : text.startsWith("☑ ") ? "[x] " : "";
    if (box) text = text.slice(2);
    if (ctx.ordered && !box) {
      ctx.n++;
      pushBlock(`${indent}${ctx.n}. ${text}`);
    } else {
      pushBlock(`${indent}- ${box}${text}`);
    }
  };

  // Inline stack: an opener records where its run starts, the closer wraps
  // every run since - nesting stays correct.
  const inlineStack: { name: string; start: number; href?: string }[] = [];
  const wrapFor = (name: string): string =>
    name === "code" ? "`" : name === "mark" ? "==" : name === "s" || name === "strike" ? "~~" : name === "em" || name === "i" ? "*" : "**";

  // Tokenize: tags drive structure, text lands in the current collector.
  const tok = /(<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>]*)?\s*\/?>)|([^<>]+)/g;
  let m: RegExpExecArray | null;

  while ((m = tok.exec(clean)) !== null) {
    if (m[2] !== undefined) {
      const text = unescapeHtml(m[2]);
      if (pre) preBuf += text;
      else para.push(text);
      continue;
    }
    const tag = m[1];
    const lower = tag.toLowerCase();
    const name = /^<\/?([a-z0-9]+)/.exec(lower)?.[1] ?? "";
    const closing = lower.startsWith("</");
    if (name === "pre" && !closing) {
      flushPara();
      pre = true;
      preBuf = "";
      continue;
    }
    if (name === "pre" && closing) {
      pre = false;
      pushBlock(`\`\`\`\n${preBuf.replace(/\n+$/, "")}\n\`\`\``);
      continue;
    }
    if (pre) continue;
    if ((name === "p" || name === "h1" || name === "h2" || name === "h3") && closing) {
      const text = para.join("").trim();
      para = [];
      if (!text) continue;
      const hashes = name === "p" ? "" : name === "h1" ? "# " : name === "h2" ? "## " : "### ";
      pushBlock(`${hashes}${text}`);
      continue;
    }
    if (name === "blockquote" && !closing) {
      flushPara();
      quoteDepth++;
      continue;
    }
    if (name === "blockquote" && closing) {
      flushPara();
      quoteDepth = Math.max(0, quoteDepth - 1);
      continue;
    }
    if ((name === "ul" || name === "ol") && !closing) {
      if (listStack.length > 0) emitPendingItem();
      else flushPara();
      listStack.push({ ordered: name === "ol", n: 0 });
      continue;
    }
    if ((name === "ul" || name === "ol") && closing) {
      flushPara();
      listStack.pop();
      continue;
    }
    if (name === "li" && closing) {
      emitPendingItem();
      continue;
    }
    if (name === "br") {
      para.push("\n");
      continue;
    }
    if (name === "a" && !closing) {
      const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag)?.[2] ?? "";
      inlineStack.push({ name: "a", start: para.length, href });
      continue;
    }
    if (["strong", "b", "em", "i", "s", "strike", "code", "mark"].includes(name)) {
      if (!closing) {
        inlineStack.push({ name, start: para.length });
      } else {
        // Pop to the matching opener (tolerates soup), wrap its runs.
        let at = inlineStack.length - 1;
        while (at >= 0 && inlineStack[at].name !== name && inlineStack[at].name !== "a") at--;
        if (at >= 0 && inlineStack[at].name !== "a") {
          const opener = inlineStack.splice(at, 1)[0];
          const runs = para.splice(opener.start).join("");
          const wrap = wrapFor(opener.name);
          para.push(`${wrap}${runs}${wrap}`);
        }
      }
      continue;
    }
    if (name === "a" && closing) {
      let at = inlineStack.length - 1;
      while (at >= 0 && inlineStack[at].name !== "a") at--;
      if (at >= 0) {
        const opener = inlineStack.splice(at, 1)[0];
        const runs = para.splice(opener.start).join("");
        para.push(opener.href ? `[${runs}](${opener.href})` : runs);
      }
      continue;
    }
  }
  flushPara();
  return blocks
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function emptyNoteBody(): NoteBody {
  return { format: "md", md: "", html: "" };
}

/** Legacy plain-markdown string → dual body (first touch migrates it). */
export function noteBodyFromMd(md: string): NoteBody {
  const capped = md.slice(0, NOTE_MD_MAX);
  if (!capped.trim()) return emptyNoteBody();
  return { format: "md", md: capped, html: mdToHtml(capped).slice(0, NOTE_HTML_MAX) };
}

/** Rich editor HTML → dual body. */
export function noteBodyFromHtml(html: string): NoteBody {
  const clean = sanitizeDecisionHtml(html).slice(0, NOTE_HTML_MAX);
  if (!clean.trim()) return { format: "rich", md: "", html: "" };
  return { format: "rich", md: htmlToMd(clean).slice(0, NOTE_MD_MAX), html: clean };
}

/**
 * Commit content from one editor. The other side regenerates - except on a
 * pure format switch (content already equals the converted counterpart),
 * where the untouched side is preserved verbatim (highlight colors survive).
 */
export function commitNoteBody(prev: NoteBody, format: NoteFormat, content: string): NoteBody {
  if (format === "md") {
    const md = content.slice(0, NOTE_MD_MAX);
    if (!md.trim()) return { format, md: "", html: "" };
    if (prev.format === "rich" && prev.html && htmlToMd(prev.html) === md) {
      return { format, md, html: prev.html };
    }
    return { format, md, html: mdToHtml(md).slice(0, NOTE_HTML_MAX) };
  }
  const html = sanitizeDecisionHtml(content).slice(0, NOTE_HTML_MAX);
  if (!html.trim()) return { format, md: "", html: "" };
  if (prev.format === "md" && prev.md && mdToHtml(prev.md) === html) {
    return { format, md: prev.md, html };
  }
  return { format, md: htmlToMd(html).slice(0, NOTE_MD_MAX), html };
}

export function noteBodyEmpty(b: NoteBody): boolean {
  return b.md.trim() === "" && b.html.trim() === "";
}

/**
 * Tab-switch commit for Rich | Markdown | Preview. Returns null when the
 * draft holds nothing on either side: switching tabs on an untouched entry
 * must stay a purely local view change and never emit an empty body, or the
 * caller reads it as "cleared" and drops a still-untitled entry.
 */
export function noteTabCommit(prev: NoteBody, tab: NoteFormat): NoteBody | null {
  if (noteBodyEmpty(prev)) return null;
  return commitNoteBody(prev, tab, tab === "rich" ? prev.html : prev.md);
}

/**
 * Vacant-entry rule: an entry with no body text and no title holds nothing,
 * so an empty body commit may drop it (abandoned fresh row). A titled entry
 * is never vacant - clearing its description keeps the row.
 */
export function entryBodyVacant(title: string, body: NoteBody): boolean {
  return noteBodyEmpty(body) && title.trim() === "";
}

/**
 * Append a line (Console pushes, system stamps) to both sides. The rich
 * side grows a paragraph instead of regenerating, so highlights survive.
 */
export function appendNoteLine(prev: NoteBody, line: string): NoteBody {
  const md = `${prev.md}${prev.md ? "\n\n" : ""}${line}`.slice(0, NOTE_MD_MAX);
  const html = prev.html.trim()
    ? `${prev.html}<p>${escapeHtml(line)}</p>`.slice(0, NOTE_HTML_MAX)
    : mdToHtml(md).slice(0, NOTE_HTML_MAX);
  return { format: prev.format, md, html };
}
