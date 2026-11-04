"use client";

import { useEffect, useRef, useState } from "react";
import { List, ListOrdered } from "lucide-react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import {
  FONT_COLORS,
  FONT_FAMILIES,
  HIGHLIGHT_COLORS,
  sameFontStack,
  htmlToText,
  isHtml,
  sanitizeDecisionHtml,
  textToHtml,
} from "@/lib/decisions/richtext";

function ToolButton({
  editor,
  title,
  active,
  onRun,
  children,
}: {
  editor: Editor;
  title: string;
  active?: boolean;
  onRun: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={!!active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onRun();
        editor.commands.focus();
      }}
      className={`min-w-7 shrink-0 cursor-pointer rounded-md px-1.5 py-1 text-[12px] font-semibold transition-colors ${
        active ? "bg-[#27241F] text-[#F5F1E8]" : "text-[#3A352D] hover:bg-[#F5F1E8]"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Copy-for-Word: places sanitized rich HTML plus a plain-text fallback on
 * the clipboard, so pasting into Word/Docs keeps headings, lists, bold,
 * colors and alignment. Falls back to plain text where HTML fails.
 */
function CopyButton({ editor }: { editor: Editor }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      title="Copy for Word - rich text plus plain-text fallback"
      aria-label="Copy for Word"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        void (async () => {
          const clean = sanitizeDecisionHtml(editor.getHTML());
          const plain = htmlToText(clean);
          try {
            if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
              await navigator.clipboard.write([
                new ClipboardItem({
                  "text/html": new Blob([clean], { type: "text/html" }),
                  "text/plain": new Blob([plain], { type: "text/plain" }),
                }),
              ]);
            } else if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(plain);
            } else {
              return;
            }
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1600);
          } catch {
            // Clipboard denied (permissions/iframe) - stay silent, no fake success.
          }
        })();
        editor.commands.focus();
      }}
      className="min-w-7 shrink-0 cursor-pointer rounded-md px-1.5 py-1 text-[12px] font-semibold text-[#3A352D] transition-colors hover:bg-[#F5F1E8]"
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

/**
 * Compact color control: one button shows the current color, clicking it
 * opens a small swatch panel instead of a permanent flat strip. Closes on
 * outside click or Escape; picking keeps the editor selection.
 */
function ColorPicker({ editor, kind }: { editor: Editor; kind: "highlight" | "font" }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  const colors: readonly string[] = kind === "highlight" ? HIGHLIGHT_COLORS : FONT_COLORS;
  const active: string | null =
    kind === "highlight"
      ? (colors.find((c) => editor.isActive("highlight", { color: c })) ?? null)
      : ((editor.getAttributes("textStyle").color as string | undefined) ?? null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  const apply = (color: string | null) => {
    const chain = editor.chain().focus();
    if (kind === "highlight") {
      if (color) chain.setHighlight({ color }).run();
      else chain.unsetHighlight().run();
    } else {
      if (color) chain.setColor(color).run();
      else chain.unsetColor().run();
    }
    setOpen(false);
  };

  const title = kind === "highlight" ? "Highlight color" : "Font color";
  return (
    <span ref={boxRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-expanded={open}
        aria-pressed={active !== null}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className={`flex min-w-7 cursor-pointer items-center justify-center rounded-md px-1.5 py-1 text-[12px] font-semibold transition-colors ${
          open || active !== null ? "bg-[#27241F] text-[#F5F1E8]" : "text-[#3A352D] hover:bg-[#F5F1E8]"
        }`}
      >
        {kind === "highlight" ? (
          <span className="rounded-sm px-0.5" style={{ backgroundColor: active ?? HIGHLIGHT_COLORS[0] }}>
            H
          </span>
        ) : (
          <span style={{ color: active ?? undefined }}>A</span>
        )}
        <span aria-hidden="true" className="ml-0.5 text-[9px]">
          ▾
        </span>
      </button>
      {open && (
        <span
          role="dialog"
          aria-label={title}
          className="absolute left-0 top-full z-20 mt-1 flex items-center gap-1.5 rounded-lg border border-[#E8E2D8] bg-white p-2 shadow-lg"
        >
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              title={kind === "highlight" ? `Highlight ${c}` : `Font ${c}`}
              aria-label={kind === "highlight" ? `Highlight ${c}` : `Font ${c}`}
              aria-pressed={active === c}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(c)}
              style={kind === "highlight" ? { backgroundColor: c } : { color: c }}
              className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border text-[13px] font-bold transition-transform ${
                active === c ? "scale-110 border-[#27241F] ring-1 ring-[#27241F]" : "border-black/20 hover:scale-110"
              }`}
            >
              {kind === "font" ? "A" : ""}
            </button>
          ))}
          <button
            type="button"
            title="No color"
            aria-label="No color"
            aria-pressed={active === null}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => apply(null)}
            className={`h-6 cursor-pointer rounded-md border border-dashed border-[#A39B8E] px-1.5 text-[10px] font-semibold text-[#777168] hover:text-[#27241F] ${
              active === null ? "bg-[#F5F1E8]" : ""
            }`}
          >
            None
          </button>
        </span>
      )}
    </span>
  );
}

/**
 * Typeface control: system stacks only (no downloads, no CDN), each
 * rendered in its own face. Same dismiss behavior as the color picker.
 */
function FontPicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  const raw: string | null = (editor.getAttributes("textStyle").fontFamily as string | undefined) ?? null;
  const current = raw ? (FONT_FAMILIES.find((f) => sameFontStack(f.stack, raw)) ?? null) : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  const apply = (stack: string | null) => {
    const chain = editor.chain().focus();
    if (stack) chain.setFontFamily(stack).run();
    else chain.unsetFontFamily().run();
    setOpen(false);
  };

  return (
    <span ref={boxRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        title="Typeface - system fonts only"
        aria-label="Typeface"
        aria-expanded={open}
        aria-pressed={current !== null}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        style={current ? { fontFamily: current.stack } : undefined}
        className={`max-w-[104px] cursor-pointer truncate rounded-md px-1.5 py-1 text-[12px] font-semibold transition-colors ${
          open || current !== null ? "bg-[#27241F] text-[#F5F1E8]" : "text-[#3A352D] hover:bg-[#F5F1E8]"
        }`}
      >
        {current ? current.label : "Default"}
        <span aria-hidden="true" className="ml-0.5 text-[9px]">
          ▾
        </span>
      </button>
      {open && (
        <span
          role="dialog"
          aria-label="Typeface"
          className="absolute left-0 top-full z-20 mt-1 min-w-[168px] flex flex-col gap-0.5 rounded-lg border border-[#E8E2D8] bg-white p-1.5 shadow-lg"
        >
          <button
            type="button"
            title="Default typeface"
            aria-label="Default typeface"
            aria-pressed={current === null}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => apply(null)}
            className={`cursor-pointer rounded-md px-2 py-1 text-left text-[13px] hover:bg-[#FAF8F2] ${
              current === null ? "bg-[#F5F1E8] font-semibold" : ""
            }`}
          >
            Default
          </button>
          {FONT_FAMILIES.map((f) => (
            <button
              key={f.id}
              type="button"
              title={f.label}
              aria-label={f.label}
              aria-pressed={current?.id === f.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(f.stack)}
              style={{ fontFamily: f.stack }}
              className={`cursor-pointer rounded-md px-2 py-1 text-left text-[15px] hover:bg-[#FAF8F2] ${
                current?.id === f.id ? "bg-[#F5F1E8] font-semibold" : ""
              }`}
            >
              {f.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * Shared rich-text editor (Tiptap, bundled - no CDN), never markdown.
 * Stores sanitized HTML; legacy plain text upgrades to paragraphs on
 * load. Commits on blur like every other field.
 */
export function RichTextEditor({
  value,
  hint,
  label = "Rich text",
  onDone,
  fill,
}: {
  value: string;
  hint?: string;
  label?: string;
  onDone: (html: string) => void;
  /** Stretch to the parent flex height (fullscreen zen) instead of capped rows. */
  fill?: boolean;
}) {
  const [, setTick] = useState(0);
  const committed = useRef<string | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const editorRef = useRef<Editor | null>(null);
  const bump = () => setTick((t) => t + 1);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Highlight.configure({ multicolor: true }),
      Underline,
      TextStyle,
      Color,
      FontFamily,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: value.trim() === "" ? "" : isHtml(value) ? sanitizeDecisionHtml(value) : textToHtml(value),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": label,
        spellcheck: "false",
      },
    },
    onTransaction: bump,
    onSelectionUpdate: bump,
    onBlur: ({ editor: e }) => {
      const clean = sanitizeDecisionHtml(e.getHTML());
      const next = htmlToText(clean) ? clean : "";
      if (committed.current !== next) {
        committed.current = next;
        doneRef.current(next);
      }
    },
  });

  // Seed the baseline from the initial content so a pristine blur (focus
  // then click away without typing) stays silent instead of emitting an
  // empty commit that reads as "cleared" downstream.
  useEffect(() => {
    if (editor && committed.current === null) {
      committed.current = htmlToText(editor.getHTML()) ? editor.getHTML() : "";
    }
    editorRef.current = editor;
  }, [editor]);

  // Flush in-progress keystrokes when the editor unmounts (e.g. switching
  // to the Markdown tab without blurring first) so typed content is never
  // stranded in the destroyed Tiptap instance.
  useEffect(
    () => () => {
      const inst = editorRef.current;
      if (!inst || committed.current === null) return;
      const clean = sanitizeDecisionHtml(inst.getHTML());
      const next = htmlToText(clean) ? clean : "";
      if (committed.current !== next) {
        committed.current = next;
        doneRef.current(next);
      }
    },
    [],
  );

  // External edits (AI propose, import, undo elsewhere) land without
  // clobbering an in-progress keystroke: only when the doc truly differs.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const incoming = value.trim() === "" ? "" : isHtml(value) ? sanitizeDecisionHtml(value) : textToHtml(value);
    if (incoming !== committed.current && editor.getHTML() !== incoming) {
      editor.commands.setContent(incoming);
      committed.current = incoming;
    }
  }, [editor, value]);

  if (!editor) {
    return (
      <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-6 text-[13px] text-[#A39B8E]">
        Loading editor…
      </div>
    );
  }

  const sizeCls = fill
    ? "[&_.tiptap]:min-h-[180px] [&_.tiptap]:flex-1"
    : "[&_.tiptap]:min-h-[220px] [&_.tiptap]:max-h-[420px] [&_.tiptap]:overflow-y-auto";

  return (
    <div
      className={`${fill ? "flex min-h-0 flex-1 flex-col" : ""} overflow-hidden rounded-xl border border-[#E8E2D8] bg-white transition-colors focus-within:border-[#C9A86A]`}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-[#EFE9DB] bg-[#FBFAF7] px-2 py-1.5" role="toolbar" aria-label="Formatting">
        <ToolButton editor={editor} title="Bold" active={editor.isActive("bold")} onRun={() => editor.chain().toggleBold().run()}>
          <span className="font-bold">B</span>
        </ToolButton>
        <ToolButton editor={editor} title="Italic" active={editor.isActive("italic")} onRun={() => editor.chain().toggleItalic().run()}>
          <span className="italic">I</span>
        </ToolButton>
        <ToolButton editor={editor} title="Strikethrough" active={editor.isActive("strike")} onRun={() => editor.chain().toggleStrike().run()}>
          <span className="line-through">S</span>
        </ToolButton>
        <ToolButton editor={editor} title="Underline" active={editor.isActive("underline")} onRun={() => editor.chain().toggleUnderline().run()}>
          <span className="underline">U</span>
        </ToolButton>
        <ColorPicker editor={editor} kind="highlight" />
        <ColorPicker editor={editor} kind="font" />
        <span aria-hidden="true" className="mx-1 h-4 w-px bg-[#E8E2D8]" />
        <span className="inline-flex shrink-0 items-center gap-0.5 px-1" role="group" aria-label="Alignment">
          {(
            [
              ["left", "Align left", "L"],
              ["center", "Align center", "C"],
              ["right", "Align right", "R"],
              ["justify", "Justify", "J"],
            ] as const
          ).map(([align, title, glyph]) => (
            <ToolButton
              key={align}
              editor={editor}
              title={title}
              active={editor.isActive({ textAlign: align })}
              onRun={() => editor.chain().setTextAlign(align).run()}
            >
              {glyph}
            </ToolButton>
          ))}
        </span>
        <span aria-hidden="true" className="mx-1 h-4 w-px bg-[#E8E2D8]" />
        <FontPicker editor={editor} />
        {([1, 2, 3] as const).map((level) => (
          <ToolButton
            key={level}
            editor={editor}
            title={`Heading ${level}`}
            active={editor.isActive("heading", { level })}
            onRun={() => editor.chain().toggleHeading({ level }).run()}
          >
            {`H${level}`}
          </ToolButton>
        ))}
        <ToolButton editor={editor} title="Bullet list" active={editor.isActive("bulletList")} onRun={() => editor.chain().toggleBulletList().run()}>
          <List size={14} aria-hidden="true" />
        </ToolButton>
        <ToolButton editor={editor} title="Numbered list" active={editor.isActive("orderedList")} onRun={() => editor.chain().toggleOrderedList().run()}>
          <ListOrdered size={14} aria-hidden="true" />
        </ToolButton>
        <span aria-hidden="true" className="mx-1 h-4 w-px bg-[#E8E2D8]" />
        <ToolButton editor={editor} title="Quote" active={editor.isActive("blockquote")} onRun={() => editor.chain().toggleBlockquote().run()}>
          Quote
        </ToolButton>
        <ToolButton editor={editor} title="Inline code" active={editor.isActive("code")} onRun={() => editor.chain().toggleCode().run()}>
          <span className="font-mono">&lt;&gt;</span>
        </ToolButton>
        <ToolButton editor={editor} title="Code block" active={editor.isActive("codeBlock")} onRun={() => editor.chain().toggleCodeBlock().run()}>
          <span className="font-mono">{"{ }"}</span>
        </ToolButton>
        <span aria-hidden="true" className="mx-1 h-4 w-px bg-[#E8E2D8]" />
        <ToolButton editor={editor} title="Undo" onRun={() => editor.chain().undo().run()}>
          Undo
        </ToolButton>
        <ToolButton editor={editor} title="Redo" onRun={() => editor.chain().redo().run()}>
          Redo
        </ToolButton>
        <ToolButton editor={editor} title="Clear formatting" onRun={() => editor.chain().clearNodes().unsetAllMarks().run()}>
          Clear
        </ToolButton>
        <span aria-hidden="true" className="mx-1 h-4 w-px bg-[#E8E2D8]" />
        <CopyButton editor={editor} />
      </div>
      <EditorContent
        editor={editor}
        className={`${fill ? "flex min-h-0 flex-1 flex-col overflow-y-auto" : ""} ${sizeCls} [&_.tiptap]:px-4 [&_.tiptap]:py-3 [&_.tiptap]:text-[14px] [&_.tiptap]:leading-relaxed [&_.tiptap]:text-[#27241F] [&_.tiptap]:outline-none [&_.tiptap_p]:my-2 [&_.tiptap_h1]:mb-1 [&_.tiptap_h1]:mt-4 [&_.tiptap_h1]:text-[19px] [&_.tiptap_h1]:font-bold [&_.tiptap_h1]:text-[#27241F] [&_.tiptap_h2]:mb-1 [&_.tiptap_h2]:mt-4 [&_.tiptap_h2]:text-[17px] [&_.tiptap_h2]:font-bold [&_.tiptap_h2]:text-[#27241F] [&_.tiptap_ul]:my-2 [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-6 [&_.tiptap_ol]:my-2 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-6 [&_.tiptap_li]:my-0.5 [&_.tiptap_blockquote]:my-2 [&_.tiptap_blockquote]:border-l-2 [&_.tiptap_blockquote]:border-[#C9A86A] [&_.tiptap_blockquote]:pl-3 [&_.tiptap_blockquote]:italic [&_.tiptap_blockquote]:text-[#3A352D] [&_.tiptap_code]:rounded [&_.tiptap_code]:bg-[#F5F1E8] [&_.tiptap_code]:px-1 [&_.tiptap_code]:font-mono [&_.tiptap_code]:text-[13px] [&_.tiptap_pre]:my-2 [&_.tiptap_pre]:overflow-x-auto [&_.tiptap_pre]:rounded-lg [&_.tiptap_pre]:bg-[#27241F] [&_.tiptap_pre]:p-3 [&_.tiptap_pre]:font-mono [&_.tiptap_pre]:text-[13px] [&_.tiptap_pre]:text-[#F5F1E8] [&_.tiptap_pre_code]:bg-transparent [&_.tiptap_pre_code]:p-0`}
      />
      {hint && <p className="border-t border-[#EFE9DB] bg-[#FBFAF7] px-4 py-1.5 text-[11px] text-[#A39B8E]">{hint}</p>}
    </div>
  );
}
