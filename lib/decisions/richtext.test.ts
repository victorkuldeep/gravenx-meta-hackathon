import { describe, expect, it } from "vitest";
import { FONT_COLORS, htmlToText, isHtml, sanitizeDecisionHtml, textToHtml } from "./richtext";

describe("decision rich text", () => {
  it("detects markup and converts plain text to paragraphs", () => {
    expect(isHtml("<p>Hi</p>")).toBe(true);
    expect(isHtml("Just words")).toBe(false);
    expect(textToHtml("One\n\nTwo")).toBe("<p>One</p><p>Two</p>");
    expect(textToHtml("  ")).toBe("");
    expect(textToHtml("a < b")).toBe("<p>a &lt; b</p>");
  });

  it("reads tag-free text back for packs and AI", () => {
    expect(htmlToText("<p>Decided <strong>X</strong>.</p><ul><li>One</li><li>Two</li></ul>")).toBe(
      "Decided X.\n- One\n- Two",
    );
    expect(htmlToText("plain stays plain")).toBe("plain stays plain");
    expect(htmlToText("<h2>Title</h2><p>Body &amp; more</p>")).toBe("Title\nBody & more");
  });

  it("keeps structure and drops anything executable", () => {
    const clean = sanitizeDecisionHtml(
      '<p onclick="evil()">Keep <strong>this</strong></p><script>alert(1)</script><a href="javascript:x">no</a><a href="https://x.test">yes</a><weird>gone</weird>',
    );
    expect(clean).toContain("<p>Keep <strong>this</strong></p>");
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("javascript:");
    expect(clean).toContain('<a href="https://x.test">yes</a>');
    expect(clean).toContain("&lt;weird&gt;gone&lt;/weird&gt;");
    expect(sanitizeDecisionHtml("<div>unwrapped <span>words</span></div>")).toBe("unwrapped words");
  });

  it("treats hand-typed plain text as paragraphs, not tags", () => {
    expect(sanitizeDecisionHtml("Use <T> generics")).toBe("<p>Use &lt;T&gt; generics</p>");
  });

  it("keeps palette highlights, drops off-palette colors and inline styles", () => {
    expect(isHtml("<p><mark>Hi</mark></p>")).toBe(true);
    expect(sanitizeDecisionHtml('<p><mark data-color="#C6F6C6">Go</mark></p>')).toBe(
      '<p><mark data-color="#C6F6C6">Go</mark></p>',
    );
    // Lowercase normalizes up; unknown colors and style attrs fall away.
    expect(sanitizeDecisionHtml('<p><mark data-color="#c4e3fc" style="color:red">x</mark></p>')).toBe(
      '<p><mark data-color="#C4E3FC">x</mark></p>',
    );
    expect(sanitizeDecisionHtml('<p><mark data-color="red" style="background:url(x)">x</mark></p>')).toBe(
      "<p><mark>x</mark></p>",
    );
    expect(htmlToText("<p>Ship <mark>Friday</mark> now</p>")).toBe("Ship Friday now");
  });

  it("keeps underline, palette font colors and block alignment - nothing else", () => {
    expect(sanitizeDecisionHtml("<p><u>Filed</u> under notes</p>")).toBe("<p><u>Filed</u> under notes</p>");
    expect(sanitizeDecisionHtml('<p style="text-align: center">Mid</p>')).toBe(
      '<p style="text-align: center">Mid</p>',
    );
    expect(sanitizeDecisionHtml('<h2 style="text-align: right">R</h2>')).toBe('<h2 style="text-align: right">R</h2>');
    // Junk alignment values and non-alignable tags fall back to bare tags.
    expect(sanitizeDecisionHtml('<p style="text-align: diagonal">x</p>')).toBe("<p>x</p>");
    expect(sanitizeDecisionHtml('<strong style="text-align: center">x</strong>')).toBe("<strong>x</strong>");
    expect(sanitizeDecisionHtml('<p style="margin: 99px">x</p>')).toBe("<p>x</p>");
    // Palette colors survive (normalized), everything else unwraps.
    for (const c of FONT_COLORS) {
      expect(sanitizeDecisionHtml(`<p><span style="color: ${c.toLowerCase()}">x</span></p>`)).toBe(
        `<p><span style="color: ${c}">x</span></p>`,
      );
    }
    expect(sanitizeDecisionHtml('<p><span style="color: hotpink">x</span></p>')).toBe("<p>x</p>");
    expect(sanitizeDecisionHtml('<p><span style="color: #C0392B; margin: 1px">x</span></p>')).toBe("<p>x</p>");
    expect(sanitizeDecisionHtml("<p>stray</span> closer</p>")).toBe("<p>stray closer</p>");
    expect(sanitizeDecisionHtml("<h1>Title</h1><h4>Small</h4>")).toBe("<h1>Title</h1>Small");
    expect(sanitizeDecisionHtml('<h1 style="text-align: center">Mid</h1>')).toBe(
      '<h1 style="text-align: center">Mid</h1>',
    );
    // System font stacks survive; anything else is void.
    expect(sanitizeDecisionHtml('<p><span style="font-family: Georgia, \'Times New Roman\', serif">x</span></p>')).toBe(
      '<p><span style="font-family: Georgia, \'Times New Roman\', serif">x</span></p>',
    );
    expect(sanitizeDecisionHtml('<p><span style="font-family: Impact, fantasy">x</span></p>')).toBe("<p>x</p>");
    // Combined palette color + system font on one span survives intact.
    expect(
      sanitizeDecisionHtml('<p><span style="color: #722F37; font-family: Arial, Helvetica, sans-serif">x</span></p>')
    ).toBe('<p><span style="color: #722F37; font-family: Arial, Helvetica, sans-serif">x</span></p>');
    // One rogue declaration voids the whole style, never just itself.
    expect(sanitizeDecisionHtml('<p><span style="color: #722F37; margin: 1px">x</span></p>')).toBe("<p>x</p>");
    expect(htmlToText('<p style="text-align: center">Mid <span style="color: #C0392B">red</span></p>')).toBe("Mid red");
  });
});
