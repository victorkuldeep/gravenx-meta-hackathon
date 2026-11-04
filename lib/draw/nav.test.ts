import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/** One grouped header everywhere: AppHeader on every page, Draw after System. */
describe("draw navigation", () => {
  it("AppHeader links Draw after System", () => {
    const src = read("components/layout/AppHeader.tsx");
    // JSX spells it href="/draw", route tables spell it href: "/draw".
    const at = (p: string): number => {
      const candidates = [src.indexOf(`href="${p}"`), src.indexOf(`href: "${p}"`)].filter(
        (i) => i >= 0,
      );
      return candidates.length > 0 ? Math.min(...candidates) : -1;
    };
    expect(at("/draw")).toBeGreaterThan(-1);
    expect(at("/draw")).toBeGreaterThan(at("/system"));
  });

  it("every app route renders the grouped AppHeader - no flat second header", () => {
    expect(existsSync(join(ROOT, "components/layout/ToolHeader.tsx"))).toBe(false);
    const dirs = readdirSync(join(ROOT, "app"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((n) => !n.startsWith("_") && !n.startsWith("("));
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) {
      const page = `${dir}/page.tsx`;
      try {
        read(`app/${page}`);
      } catch {
        continue;
      }
      const src = read(`app/${page}`);
      expect(src).not.toContain("ToolHeader");
      expect(src).toContain("AppHeader");
    }
  });

  it("home mobile nav includes Draw", () => {
    const src = read("components/layout/AppHeader.tsx");
    // Grouped nav: one navGroups structure drives desktop panels and the
    // mobile flat row, so Draw must be in the data and the flat renderer.
    expect(src).toContain('href: "/draw"');
    const mobile = src.slice(src.indexOf("md:hidden"));
    expect(mobile).toContain("renderFlatEntry");
    expect(mobile).toContain("navGroups");
  });

  it("tab reads Draw+ with a raised plus", () => {
    // The Draw entry carries plus:true and the shared label renderer
    // raises it in a sup.
    const app = read("components/layout/AppHeader.tsx");
    expect(app).toContain('label: "Draw", plus: true');
    expect(app).toContain("<sup");
  });

  it("JSON, Draw+ and Console stand alone at the end", () => {
    const app = read("components/layout/AppHeader.tsx");
    // Standalone routes render after the groups on desktop and at the end
    // of the mobile flat row - Draw+ and JSON are no longer grouped.
    expect(app).toContain("standaloneRoutes");
    const table = app.slice(app.indexOf("const standaloneRoutes"));
    expect(table.indexOf('href: "/json"')).toBeGreaterThan(-1);
    expect(table.indexOf('href: "/draw"')).toBeGreaterThan(table.indexOf('href: "/json"'));
    expect(table.indexOf('href: "/console"')).toBeGreaterThan(table.indexOf('href: "/draw"'));
    const mobile = app.slice(app.indexOf("md:hidden"));
    expect(mobile).toContain("standaloneRoutes");
  });

  it("grouped panels are full-width mega-panels with brand zones", () => {
    const app = read("components/layout/AppHeader.tsx");
    // Apple-style: one MegaPanel per group, brand copy on the group data,
    // tagline zone follows the hovered entry.
    expect(app).toContain("MegaPanel");
    expect(app).toContain("fixed inset-x-0");
    for (const field of ["eyebrow:", "headline:", "punch:"]) {
      expect(app).toContain(field);
    }
    expect(app).toContain("On this tab");
  });

  it("every studio page is reachable from the header nav - no orphaned tabs", () => {
    // Legal/about pages live in the footer; api/ has route handlers, not
    // pages. Everything else must appear in the header nav data so a page
    // can never again ship without a tab (e.g. /mapping, /validate).
    const FOOTER_ONLY = new Set(["about", "privacy", "terms", "security"]);
    const dirs = readdirSync(join(ROOT, "app"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((n) => !n.startsWith("_") && !n.startsWith("(") && !FOOTER_ONLY.has(n));
    const app = read("components/layout/AppHeader.tsx");
    const missing: string[] = [];
    for (const dir of dirs) {
      try {
        read(`app/${dir}/page.tsx`);
      } catch {
        continue;
      }
      if (!app.includes(`href: "/${dir}"`) && !app.includes(`href="/${dir}"`)) {
        missing.push(`/${dir}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("panels are controlled: hover intent, close on pick and route change", () => {
    const app = read("components/layout/AppHeader.tsx");
    // Grace timer so sub-pixel gaps never slam the panel; Escape closes.
    expect(app).toContain("openGroup");
    expect(app).toContain("scheduleClose");
    expect(app).toContain("setOpenGroup(null)");
    expect(app).toContain("Escape");
    // Mode entries work without onNavigate via ?tab= deep links.
    expect(app).toContain("/?tab=${entry.id}");
  });
});
