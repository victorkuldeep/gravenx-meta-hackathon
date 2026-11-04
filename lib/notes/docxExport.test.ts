import { describe, expect, it } from "vitest";
import { Packer } from "docx";
import type { CanvasTodo } from "@/lib/inbox/types";
import {
  buildEntryDocx,
  buildNoteDocx,
  entryBodyBlocks,
  entryDocxFilename,
  htmlToDocxBlocks,
  noteDocxFilename,
} from "./docxExport";

function entry(over: Partial<CanvasTodo> = {}): CanvasTodo {
  return {
    id: "e1",
    title: "Verify lookup",
    kind: "task",
    status: "open",
    entityApi: "Invoice__c",
    createdAt: 1000,
    updatedAt: 2000,
    ...over,
  };
}

describe("free note docx", () => {
  it("builds a titled note document from rich or markdown bodies", async () => {
    const rich = buildNoteDocx("Design Notes", ["Canvas prose"], { format: "rich", md: "", html: "<p>Ship <strong>Friday</strong></p>" });
    expect((await Packer.toBuffer(rich)).length).toBeGreaterThan(1000);
    const mdDoc = buildNoteDocx("Empty", [], { format: "md", md: "", html: "" });
    expect((await Packer.toBuffer(mdDoc)).length).toBeGreaterThan(1000);
    expect(noteDocxFilename("Design Notes")).toMatch(/^design-notes-\d{8}\.docx$/);
  });
});

describe("html to docx blocks", () => {
  it("maps headings, marks and links without a DOM", () => {
    const blocks = htmlToDocxBlocks(
      '<h2>Goal</h2><p>Ship <strong>Friday</strong> <em>fast</em> <s>slow</s> <u>now</u> <code>x()</code> <a href="https://x.test">docs</a> &amp; friends</p>',
    );
    expect(blocks[0]).toMatchObject({ kind: "h2" });
    expect(blocks[0].runs[0]).toMatchObject({ text: "Goal" });
    expect(htmlToDocxBlocks("<h1>Top</h1>")[0]).toMatchObject({ kind: "h1" });
    const body = blocks[1];
    expect(body.kind).toBe("p");
    const byText = Object.fromEntries(body.runs.map((r) => [r.text.trim(), r]));
    expect(byText["Friday"]).toMatchObject({ bold: true });
    expect(byText["fast"]).toMatchObject({ italic: true });
    expect(byText["slow"]).toMatchObject({ strike: true });
    expect(byText["now"]).toMatchObject({ underline: true });
    expect(byText["x()"]).toMatchObject({ code: true });
    expect(byText["docs"]).toMatchObject({ link: "https://x.test" });
    expect(body.runs[body.runs.length - 1].text).toContain("& friends");
  });

  it("keeps bullets, ordered positions, levels and checkboxes", () => {
    const blocks = htmlToDocxBlocks(
      "<ul><li>☐ open task</li><li>☑ done task<ul><li>nested</li></ul></li></ul><ol><li>first</li><li>second</li></ol>",
    );
    expect(blocks[0]).toMatchObject({ kind: "bullet", level: 0 });
    expect(blocks[0].runs[0].text).toContain("☐ open task");
    expect(blocks[2]).toMatchObject({ kind: "bullet", level: 1 });
    expect(blocks[3]).toMatchObject({ kind: "numbered", level: 0, index: 1 });
    expect(blocks[4]).toMatchObject({ kind: "numbered", level: 0, index: 2 });
  });

  it("carries quotes, code blocks and highlight colors", () => {
    const blocks = htmlToDocxBlocks(
      '<blockquote>wise</blockquote><pre>code()\nline2</pre><p>Ship <mark data-color="#C6F6C6">Friday</mark> <mark data-color="#NOPE">x</mark></p>',
    );
    expect(blocks[0].kind).toBe("quote");
    expect(blocks[1]).toMatchObject({ kind: "code" });
    expect(blocks[1].runs[0].text).toContain("line2");
    const marks = blocks[2].runs;
    expect(marks.find((r) => r.text.includes("Friday"))).toMatchObject({ shade: "C6F6C6" });
    expect(marks.find((r) => r.text === "x")).toMatchObject({ shade: "FFEB9C" });
  });

  it("drops dangerous links and returns nothing for empty input", () => {
    const blocks = htmlToDocxBlocks('<p><a href="javascript:alert(1)">evil</a></p>');
    expect(blocks[0].runs[0].link).toBeUndefined();
    expect(htmlToDocxBlocks("")).toEqual([]);
    expect(htmlToDocxBlocks("   ")).toEqual([]);
  });
});

describe("entry body resolution", () => {
  it("prefers rich html and converts markdown otherwise", () => {
    const rich = entryBodyBlocks(entry({ bodyFormat: "rich", bodyHtml: "<h2>Hi</h2>", body: "plain" }));
    expect(rich[0]).toMatchObject({ kind: "h2" });
    const md = entryBodyBlocks(entry({ body: "Ship **Friday**" }));
    expect(md[0].kind).toBe("p");
    expect(md[0].runs.some((r) => r.bold && r.text.includes("Friday"))).toBe(true);
    expect(entryBodyBlocks(entry({}))).toEqual([]);
  });

  it("builds stable professional filenames", () => {
    const name = entryDocxFilename("Invoice__c", entry({ title: "Verify lookup!" }));
    expect(name).toMatch(/^invoice__c-task-verify-lookup-\d{8}\.docx$/);
    expect(entryDocxFilename("Account", entry({ title: "   " }))).toMatch(/^account-task-task-\d{8}\.docx$/);
  });

  it("packs a real zip package with title and resolution", async () => {
    const doc = buildEntryDocx("Invoice__c", "Invoice", entry({
      bodyFormat: "rich",
      bodyHtml: "<p>Ship <strong>Friday</strong></p>",
      owner: "Kuldeep",
      dueDate: "2026-10-20",
      resolution: "Confirmed with finance",
    }));
    const buf = await Packer.toBuffer(doc);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf.length).toBeGreaterThan(2000);
  });
});
