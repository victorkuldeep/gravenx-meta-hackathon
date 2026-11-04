import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** All first-party source files (excludes tests, build output, deps). */
function sourceFiles(dir: string, out: string[] = []): string[] {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs)) {
    const rel = path.join(dir, entry);
    const st = statSync(path.join(ROOT, rel));
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      sourceFiles(rel, out);
    } else if (/\.(tsx?|css|ts)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(rel);
    }
  }
  return out;
}

describe("self-hosted fonts (no Google Fonts CDN/API)", () => {
  it("layout does not use next/font/google or Google font hosts", () => {
    const layout = read("app/layout.tsx");
    expect(layout).not.toMatch(/next\/font\/google/);
    // Scheme-qualified: matches real CDN/link references, not prose mentions.
    expect(layout).not.toMatch(/https?:\/\/fonts\.googleapis\.com/);
    expect(layout).not.toMatch(/https?:\/\/fonts\.gstatic\.com/);
  });

  it("layout bundles Inter + JetBrains Mono from @fontsource", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toMatch(/@fontsource\/inter\/latin-400\.css/);
    expect(layout).toMatch(/@fontsource\/jetbrains-mono\/latin-400\.css/);
  });

  it("font stacks prefer the self-hosted faces with system fallbacks", () => {
    expect(read("app/globals.css")).toMatch(/--font-sans:\s*"Inter"/);
    expect(read("tailwind.config.ts")).toMatch(/"Inter"/);
    expect(read("tailwind.config.ts")).toMatch(/"JetBrains Mono"/);
  });

  it("no first-party source references Google Fonts hosts or next/font/google", () => {
    const bad: string[] = [];
    for (const f of [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]) {
      const body = read(f);
      if (/next\/font\/google|https?:\/\/fonts\.googleapis\.com|https?:\/\/fonts\.gstatic\.com/.test(body)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });

  it("CSP keeps font-src self-contained (no Google hosts)", () => {
    const cfg = read("next.config.ts");
    expect(cfg).toMatch(/font-src 'self'/);
    expect(cfg).not.toMatch(/fonts\.googleapis\.com/);
    expect(cfg).not.toMatch(/fonts\.gstatic\.com/);
  });
});

describe("privacy / GDPR surface", () => {
  it("legal pages exist", () => {
    for (const p of ["app/privacy/page.tsx", "app/terms/page.tsx", "app/security/page.tsx"]) {
      expect(existsSync(path.join(ROOT, p)), p).toBe(true);
    }
  });

  it("privacy policy covers GDPR essentials truthfully", () => {
    const privacy = read("app/privacy/page.tsx");
    expect(privacy).toMatch(/GDPR/);
    expect(privacy).toMatch(/sessionStorage/);
    expect(privacy).toMatch(/IndexedDB/);
    expect(privacy).toMatch(/no tracking/i);
    expect(privacy).toMatch(/\/terms/);
    expect(privacy).toMatch(/\/security/);
  });

  it("footer links Privacy, Terms, and Security", () => {
    const footer = read("components/layout/AppFooter.tsx");
    expect(footer).toMatch(/href="\/privacy"/);
    expect(footer).toMatch(/href="\/terms"/);
    expect(footer).toMatch(/href="\/security"/);
  });

  it("privacy banner is visible, GDPR-labelled, and links the legal pages", () => {
    const banner = read("components/PrivacyBanner.tsx");
    expect(banner).toMatch(/fixed inset-x-0 bottom-0/);
    expect(banner).toMatch(/GDPR/);
    expect(banner).toMatch(/href="\/privacy"/);
    expect(banner).toMatch(/href="\/terms"/);
    expect(banner).toMatch(/href="\/security"/);
  });

  it("author mode is create-only: no destructive calls in the design contract", () => {
    const design = read("lib/salesforce/design.ts");
    expect(design).not.toMatch(/\.delete\(|destroy\(|deleteObject|deleteField/i);
    expect(design).toMatch(/tooling\/sobjects/);
  });

  it("system runs support mocks, scoped lanes, and markdown evidence", () => {
    const dialog = read("components/system-design/ChainRunDialog.tsx");
    expect(dialog).toMatch(/top\.mock \?\? null/);
    expect(dialog).toMatch(/lanesOn/);
    expect(dialog).toMatch(/downloadMarkdown/);
    expect(dialog).toMatch(/requests,/);
    const designer = read("components/system-design/SystemDesigner.tsx");
    expect(designer).toMatch(/onLoadTmf/);
    expect(designer).toMatch(/op\.mock/);
  });

  it("all six workbench tabs are live (no disabled planned tabs)", () => {
    const designer = read("components/system-design/SystemDesigner.tsx");
    expect(designer).not.toMatch(/PLANNED_TABS/);
    expect(designer).not.toMatch(/cursor-not-allowed/);
    for (const tab of ["ApiCatalogTab", "TransformsTab", "FlowsTab", "ScenariosTab", "RunsTab", "SettingsTab"]) {
      expect(designer).toMatch(new RegExp(`\\b${tab}\\b`));
    }
    expect(designer).toMatch(/setSubTab/);
    expect(designer).toMatch(/pendingBindOpId/);
    expect(designer).toMatch(/isProduction/);
  });

  it("no native dialogs anywhere - confirms go through the app modal", () => {
    const bad: string[] = [];
    for (const f of [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]) {
      const body = read(f);
      if (/window\.(confirm|alert|prompt)\(/.test(body)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });

  it("shared confirm + prompt dialogs exist for destructive and input flows", () => {
    const dialogs = read("components/ui/ConfirmDialog.tsx");
    expect(dialogs).toMatch(/export function ConfirmDialog/);
    expect(dialogs).toMatch(/export function PromptDialog/);
    expect(dialogs).toMatch(/tone/);
  });

  it("author UI is wired on the ERD canvas with confirm guardrails", () => {
    const panel = read("components/SchemaPanel.tsx");
    expect(panel).toMatch(/authorMode/);
    expect(panel).toMatch(/AuthorFieldDialog/);
    expect(panel).toMatch(/AuthorObjectDialog/);
    expect(panel).toMatch(/pendingProdField/);
    expect(panel).toMatch(/pendingProdObject/);
    expect(panel).toMatch(/tone="danger"/);
    expect(panel).toMatch(/connectable=\{authorMode\}/);
    const node = read("components/erd/ErdTableNode.tsx");
    expect(node).toMatch(/onAddField/);
  });

  it("builder trail is a thin sharp rail in a sticky bordered bar above the footer", () => {
    const stepper = read("components/Stepper.tsx");
    expect(stepper).toMatch(/divide-x/);
    expect(stepper).toMatch(/aria-current/);
    expect(stepper).not.toMatch(/rounded-xl/);
    expect(stepper).not.toMatch(/text-lg/);
    const footer = read("components/layout/AppFooter.tsx");
    expect(footer).toMatch(/sticky bottom-0/);
    expect(footer).toMatch(/border-y border-\[var\(--color-line\)\]/);
  });

  it("connect dialog discloses token handling and links Privacy + Terms", () => {
    const modal = read("components/ConnectModal.tsx");
    expect(modal).toMatch(/sessionStorage/);
    expect(modal).toMatch(/href="\/privacy"/);
    expect(modal).toMatch(/href="\/terms"/);
    expect(modal).toMatch(/Independent project./);
  });

  it("connect requires explicit Terms acceptance before Test & Connect", () => {
    const modal = read("components/ConnectModal.tsx");
    expect(modal).toMatch(/type="checkbox"/);
    expect(modal).toMatch(/I accept the/);
    expect(modal).toMatch(/disabled=\{loading \|\| !accepted\}/);
  });

  it("collection tray lives in builder tabs, never in headers", () => {
    for (const h of ["components/layout/AppHeader.tsx", "components/layout/AppShell.tsx"]) {
      const src = read(h);
      expect(src).not.toMatch(/collectionCount|onCollectionClick|listCollectionItems/);
    }
    for (const p of [
      "components/RestExplorerPanel.tsx",
      "components/ExportPanel.tsx",
      "components/GraphQLPanel.tsx",
      "components/composite-studio/StudioPayload.tsx",
    ]) {
      expect(read(p)).toMatch(/CollectionTrayButton/);
    }
  });
});
