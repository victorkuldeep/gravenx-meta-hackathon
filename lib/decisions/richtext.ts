/**
 * ADR rich text: the Decision field stores HTML (never markdown), edited in
 * a built-in contentEditable toolbar. These pure helpers bridge the two
 * worlds - legacy plain text becomes paragraphs on load, and exports/AI
 * read back tag-free text. DOM-free so tests run in Node.
 */

const ALLOWED = new Set([
  "p", "h1", "h2", "h3", "strong", "b", "em", "i", "u", "s", "strike",
  "ul", "ol", "li", "blockquote", "code", "pre", "br", "a", "mark",
]);

/**
 * Fixed font palette: the only text colors the sanitizer keeps. RAG triad
 * for architecture marking, brand pair, working neutrals and info blue.
 */
export const FONT_COLORS = [
  "#27241F", // Ink - default body
  "#722F37", // Burgundy - brand
  "#C0392B", // Red - risk / RAG
  "#B45309", // Amber - caution / RAG
  "#2F7D4F", // Green - go / RAG
  "#1E4D2B", // Dark Green
  "#2B5F9E", // Blue - info
  "#A98450", // Bronze - brand accent
] as const;
export type FontColor = (typeof FONT_COLORS)[number];
const FONT_SET = new Set<string>(FONT_COLORS);

/** Block tags that may carry an alignment (nothing else keeps style). */
const ALIGNABLE = new Set(["p", "h1", "h2", "h3", "li", "blockquote"]);
/** A style attribute is safe only when it holds exactly one palette color. */
const STYLE_ATTR_RE = /style\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i;

function styleValue(attrs: string | undefined): string {
  if (!attrs) return "";
  return STYLE_ATTR_RE.exec(attrs)?.[2] ?? "";
}

/** System font stacks: no downloads, no CDN - the only families kept. */
export const FONT_FAMILIES = [
  { id: "arial", label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { id: "georgia", label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { id: "verdana", label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { id: "courier", label: "Courier New", stack: "'Courier New', Courier, monospace" },
] as const;
export type FontFamilyId = (typeof FONT_FAMILIES)[number]["id"];

const normStack = (s: string) => s.replace(/['"]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** True when both stacks name the same families (quote/case tolerant). */
export function sameFontStack(a: string, b: string): boolean {
  return normStack(a) === normStack(b);
}

interface KeptStyle {
  color: string | null;
  align: string | null;
  font: string | null;
}

/**
 * Allowlist style reader: every declaration must be known (palette color,
 * block alignment, system font stack) with a valid value, or the whole
 * style is void - one rogue declaration never smuggles the rest through.
 */
function pickKeptStyle(attrs: string | undefined): KeptStyle | null {
  const raw = styleValue(attrs);
  if (!raw.trim()) return null;
  const kept: KeptStyle = { color: null, align: null, font: null };
  for (const decl of raw.split(";")) {
    if (!decl.trim()) continue;
    const m = /^\s*([a-zA-Z-]+)\s*:\s*(.+?)\s*$/.exec(decl);
    if (!m) return null;
    const prop = m[1].toLowerCase();
    const val = m[2];
    if (prop === "color") {
      const color = val.trim().toUpperCase();
      if (!FONT_SET.has(color)) return null;
      kept.color = color;
    } else if (prop === "text-align") {
      const align = val.trim().toLowerCase();
      if (!["left", "center", "right", "justify"].includes(align)) return null;
      kept.align = align;
    } else if (prop === "font-family") {
      const hit = FONT_FAMILIES.find((f) => normStack(f.stack) === normStack(val));
      if (!hit) return null;
      kept.font = hit.stack;
    } else {
      return null;
    }
  }
  return kept.color || kept.align || kept.font ? kept : null;
}

function pickTextAlign(attrs: string | undefined): string | null {
  return pickKeptStyle(attrs)?.align ?? null;
}

function pickFontFamily(attrs: string | undefined): string | null {
  return pickKeptStyle(attrs)?.font ?? null;
}

/** Fixed highlight palette: the only data-color values the sanitizer keeps. */
export const HIGHLIGHT_COLORS = ["#FFEB9C", "#C6F6C6", "#F9C9D4", "#C4E3FC"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
const HIGHLIGHT_SET = new Set<string>(HIGHLIGHT_COLORS);

/** Pasted containers: unwrap (keep the words, drop the wrapper). */
const UNWRAP = new Set([
  "div", "span", "font", "section", "article", "header", "footer", "main",
  "aside", "nav", "figure", "figcaption", "table", "thead", "tbody", "tr",
  "td", "th", "h4", "h5", "h6", "hr", "small", "big", "center",
  // Word-import extras: images drop silently (no binary in notes),
  // sup/sub keep their inner text (footnote refs, ordinals).
  "img", "sup", "sub",
]);

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MARKUP_TAG = /<\/?(p|h1|h2|h3|strong|b|em|i|u|s|strike|ul|ol|li|blockquote|code|pre|br|a|mark|span|div|table)(\s[^<>]*)?\s*\/?>/i;

/** True when the stored value already carries markup (a lone <T> is text). */
export function isHtml(value: string): boolean {
  return MARKUP_TAG.test(value);
}

/** Legacy plain text (or AI-proposed text) → safe paragraph HTML. */
export function textToHtml(text: string): string {
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length === 0) return "";
  return blocks.map((b) => `<p>${escapeHtml(b).replace(/\n/g, "<br>")}</p>`).join("");
}

/** Strip tags for packs, AI and anywhere else that reads plain words. */
export function htmlToText(html: string): string {
  if (!isHtml(html)) return html.trim();
  return (
    html
      // Block boundaries become newlines before tags fall away.
      .replace(/<\/(p|h1|h2|h3|li|blockquote|pre|ul|ol)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .split("\n")
      .map((l) => l.trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Allowlist sanitizer for editor HTML: keeps structure + inline marks,
 * drops scripts, styles, event handlers and dangerous links. Tag soup
 * (unclosed tags from hand edits) degrades to escaped text, never breaks.
 */
export function sanitizeDecisionHtml(html: string): string {
  if (!html.trim()) return "";
  if (!isHtml(html)) return textToHtml(html);
  // Remove script/style elements wholesale, with or without closers.
  let out = html.replace(/<(script|style|iframe|object|embed)[^>]*>[\s\S]*?(<\/\1\s*>|$)/gi, "");
  out = out.replace(/<\/?(html|head|body)[^>]*>/gi, "");
  // Kept palette-color spans pair open/close through a local stack so
  // pasted multi-color text survives while stray closers still vanish.
  const spanStack: boolean[] = [];
  out = out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)(\s[^<>]*)?\s*(\/?)>/g, (m, close: string, tagRaw: string, attrs: string | undefined, self: string) => {
    const tag = tagRaw.toLowerCase();
    if (tag === "span") {
      if (close) return spanStack.pop() ? "</span>" : "";
      const kept = pickKeptStyle(attrs);
      const style =
        kept && (kept.color || kept.font)
          ? [kept.color ? `color: ${kept.color}` : "", kept.font ? `font-family: ${kept.font}` : ""]
              .filter(Boolean)
              .join("; ")
          : null;
      spanStack.push(style !== null);
      return style !== null ? `<span style="${style}">` : "";
    }
    if (!ALLOWED.has(tag)) return UNWRAP.has(tag) ? (tag === "hr" ? "<br>" : "") : escapeHtml(m);
    if (close) return `</${tag}>`;
    if (tag === "br") return "<br>";
    if (ALIGNABLE.has(tag)) {
      const align = pickTextAlign(attrs);
      const font = pickFontFamily(attrs);
      const parts = [align ? `text-align: ${align}` : "", font ? `font-family: ${font}` : ""].filter(Boolean);
      if (parts.length > 0) return `<${tag} style="${parts.join("; ")}">`;
    }
    if (tag === "a") {
      const href = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs ?? "")?.[2] ?? "";
      const safe = /^(https?:\/\/|mailto:|\/|#)/i.test(href.trim()) ? escapeHtml(href.trim()) : "";
      return safe ? `<a href="${safe}">` : "<a>";
    }
    if (tag === "mark") {
      const raw = /data-color\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs ?? "")?.[2] ?? "";
      const color = raw.trim().toUpperCase();
      return HIGHLIGHT_SET.has(color) ? `<mark data-color="${color}">` : "<mark>";
    }
    void self;
    return `<${tag}>`;
  });
  // Neutralize anything that still looks executable.
  out = out.replace(/javascript:/gi, "");
  return out.trim();
}
