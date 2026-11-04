import { describe, expect, it } from "vitest";
import {
  appendNoteLine,
  commitNoteBody,
  emptyNoteBody,
  entryBodyVacant,
  htmlToMd,
  mdToHtml,
  noteBodyEmpty,
  noteBodyFromHtml,
  noteBodyFromMd,
  noteTabCommit,
} from "./notebody";

const MD_SAMPLE = [
  "## Goal",
  "",
  "Ship **Friday** with *care*, ~~never~~ `code` and ==focus==.",
  "",
  "- [ ] acceptance one",
  "- [x] acceptance two",
  "- plain bullet",
  "",
  "1. first",
  "2. second",
  "",
  "> quoted wisdom",
  "",
  "```",
  "const a = 1;",
  "```",
].join("\n");

describe("note body converters", () => {
  it("maps the shared markdown subset to sanitized html", () => {
    const html = mdToHtml(MD_SAMPLE);
    expect(html).toContain("<h2>Goal</h2>");
    expect(html).toContain("<strong>Friday</strong>");
    expect(html).toContain("<em>care</em>");
    expect(html).toContain("<s>never</s>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<mark>focus</mark>");
    expect(html).toContain("<li>☐ acceptance one</li>");
    expect(html).toContain("<li>☑ acceptance two</li>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<blockquote>quoted wisdom</blockquote>");
    expect(html).toContain("<pre>const a = 1;</pre>");
    expect(html).not.toContain("<script");
  });

  it("escapes hostile input and folds soft wraps", () => {
    expect(mdToHtml("<img src=x onerror=y>")).toContain("&lt;img");
    expect(mdToHtml("line one\nline two")).toBe("<p>line one<br>line two</p>");
  });

  it("reads editor html back to markdown, tasks and marks included", () => {
    const md = htmlToMd(
      "<h2>Goal</h2><p>Ship <strong>Friday</strong> <em>fast</em> <s>slow</s> <code>x</code> <mark>now</mark>.</p>" +
        "<ul><li>☐ open task</li><li>☑ done task</li><li>plain</li></ul>" +
        '<ol><li>one</li><li>two</li></ol><blockquote>wise</blockquote><pre>code()</pre>' +
        '<p><a href="https://x.test">link</a> and <strong>bold <em>both</em></strong></p>',
    );
    expect(md).toContain("## Goal");
    expect(md).toContain("**Friday**");
    expect(md).toContain("*fast*");
    expect(md).toContain("~~slow~~");
    expect(md).toContain("`x`");
    expect(md).toContain("==now==");
    expect(md).toContain("- [ ] open task");
    expect(md).toContain("- [x] done task");
    expect(md).toContain("1. one");
    expect(md).toContain("2. two");
    expect(md).toContain("> wise");
    expect(md).toContain("```\ncode()\n```");
    expect(md).toContain("[link](https://x.test)");
    expect(md).toContain("**bold *both***");
  });

  it("round-trips without losing words or structure", () => {
    const md = htmlToMd(mdToHtml(MD_SAMPLE));
    for (const needle of [
      "## Goal",
      "**Friday**",
      "*care*",
      "~~never~~",
      "`code`",
      "==focus==",
      "- [ ] acceptance one",
      "- [x] acceptance two",
      "1. first",
      "> quoted wisdom",
      "```",
    ]) {
      expect(md).toContain(needle);
    }
    // Rich-authored html survives md and back with the same words.
    const rich = "<h2>T</h2><p>Hello <strong>bold</strong> world.</p><ul><li>☐ todo</li></ul>";
    const back = mdToHtml(htmlToMd(rich));
    expect(back).toContain("<h2>T</h2>");
    expect(back).toContain("<strong>bold</strong>");
    expect(back).toContain("☐ todo");
  });
});

describe("note body commits", () => {
  it("migrates legacy markdown on first touch", () => {
    const b = noteBodyFromMd("## Hi\n\n- [ ] do");
    expect(b.format).toBe("md");
    expect(b.md).toBe("## Hi\n\n- [ ] do");
    expect(b.html).toContain("<h2>Hi</h2>");
    expect(noteBodyEmpty(noteBodyFromMd("  \n "))).toBe(true);
    expect(noteBodyEmpty(emptyNoteBody())).toBe(true);
  });

  it("sanitizes rich commits and keeps the markdown fresh", () => {
    const b = noteBodyFromHtml('<p onclick="x()">Hi <strong>there</strong></p><script>1</script>');
    expect(b.format).toBe("rich");
    expect(b.html).toBe("<p>Hi <strong>there</strong></p>");
    expect(b.md).toBe("Hi **there**");
  });

  it("keeps a pure format switch lossless (colors survive a peek)", () => {
    const rich = noteBodyFromHtml('<p>Ship <mark data-color="#C6F6C6">Friday</mark></p>');
    const asMd = commitNoteBody(rich, "md", htmlToMd(rich.html));
    expect(asMd.format).toBe("md");
    expect(asMd.md).toBe("Ship ==Friday==");
    // Untouched side preserved verbatim - the green mark is still there.
    expect(asMd.html).toBe(rich.html);
    const back = commitNoteBody(asMd, "rich", asMd.html);
    expect(back.html).toContain('data-color="#C6F6C6"');
  });

  it("regenerates the idle side once the author edits", () => {
    const rich = noteBodyFromHtml("<p>Ship <mark>Friday</mark></p>");
    const edited = commitNoteBody(rich, "md", "Ship Saturday");
    expect(edited).toEqual({ format: "md", md: "Ship Saturday", html: "<p>Ship Saturday</p>" });
  });

  it("caps both sides", () => {
    const big = "x".repeat(20000);
    expect(noteBodyFromMd(big).md).toHaveLength(12000);
    expect(noteBodyFromHtml(`<p>${big}</p>`).md.length).toBeLessThanOrEqual(12000);
  });

  it("appends lines to both sides without regenerating rich html", () => {
    const prev = noteBodyFromHtml('<p><mark data-color="#F9C9D4">Plan</mark></p>');
    const next = appendNoteLine(prev, "[Console] TLS verified");
    expect(next.format).toBe("rich");
    expect(next.md).toContain("[Console] TLS verified");
    expect(next.html).toContain('data-color="#F9C9D4"');
    expect(next.html).toContain("<p>[Console] TLS verified</p>");
    const mdOnly = appendNoteLine(noteBodyFromMd("Plan"), "[Console] go");
    expect(mdOnly.html).toContain("[Console] go");
  });
});

describe("tab-switch commits and vacant entries", () => {
  it("stays silent on an untouched draft so a fresh entry survives a tab peek", () => {
    expect(noteTabCommit(emptyNoteBody(), "rich")).toBeNull();
    expect(noteTabCommit(emptyNoteBody(), "md")).toBeNull();
  });

  it("converts a written draft without losing either side", () => {
    const md = noteBodyFromMd("Ship **Friday**");
    const asRich = noteTabCommit(md, "rich");
    expect(asRich?.format).toBe("rich");
    expect(asRich?.html).toContain("<strong>Friday</strong>");
    const rich = noteBodyFromHtml("<p>Ship <strong>Friday</strong></p>");
    const asMd = noteTabCommit(rich, "md");
    expect(asMd?.format).toBe("md");
    expect(asMd?.md).toContain("Friday");
  });

  it("drops only untitled empty rows, never a titled one", () => {
    expect(entryBodyVacant("", emptyNoteBody())).toBe(true);
    expect(entryBodyVacant("  ", emptyNoteBody())).toBe(true);
    expect(entryBodyVacant("Verify lookup", emptyNoteBody())).toBe(false);
    expect(entryBodyVacant("", noteBodyFromMd("drafting"))).toBe(false);
  });
});

describe("dotted ordered markers", () => {
  it("nests 1.1 items under their parent instead of flattening to paragraphs", () => {
    const html = mdToHtml(["1. First", "2. Second", "   1.1. Sub detail", "   1.2. More detail"].join("\n"));
    expect(html).toBe(
      "<ol><li>First</li><li>Second<ol><li>Sub detail</li><li>More detail</li></ol></li></ol>"
    );
  });

  it("keeps plain numbered lists flat", () => {
    expect(mdToHtml("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
  });

  it("maps all three heading levels and reads them back", () => {
    expect(mdToHtml("# One\n## Two\n### Three")).toBe("<h1>One</h1><h2>Two</h2><h3>Three</h3>");
    expect(htmlToMd("<h1>One</h1><h2>Two</h2><h3>Three</h3>")).toBe("# One\n\n## Two\n\n### Three");
  });

  it("round-trips dotted content through reload without losing words or list shape", () => {
    const md = ["1. First point", "   1.1. Sub detail", "- bullet one"].join("\n");
    const stored = noteBodyFromMd(md);
    expect(stored.html).toContain("<ol>");
    const back = htmlToMd(stored.html);
    for (const word of ["First point", "Sub detail", "bullet one"]) expect(back).toContain(word);
    expect(back).toMatch(/1\. First point/);
    expect(back).toMatch(/- bullet one/);
  });

  it("leaves a leading bare decimal as paragraph text", () => {
    expect(mdToHtml("3.14 pi value")).toBe("<p>3.14 pi value</p>");
  });
});
