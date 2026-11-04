import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";

export const metadata = {
  title: "Security",
  description:
    "Security model of GRAVENX: credential handling, server-side proxying, headers, and shared responsibilities.",
  robots: { index: false, follow: false },
};

const EFFECTIVE_DATE = "October 3, 2026";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20">
      <h2 id={`${id}-heading`} className="text-lg font-bold text-[var(--color-ink)]">
        {title}
      </h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">{children}</div>
    </section>
  );
}

export default function SecurityPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl px-5 pt-10 pb-16 flex-1" id="main-content">
        <p className="font-mono text-[11px] uppercase tracking-[2px] text-[var(--color-accent-dark)]">
          Legal · Trust
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--color-ink)]">Security Overview</h1>
        <p className="mt-2 font-mono text-xs text-[var(--color-muted)]">Effective {EFFECTIVE_DATE}</p>

        <div className="mt-8 space-y-8">
          <Section id="model" title="1. Architecture in one paragraph">
            <p>
              Your Salesforce token is held in your browser tab (sessionStorage + page memory) and sent only to
              this app&apos;s server-side API routes, which forward your authorised request to the Salesforce org
              URL you supplied and return the response. Tokens are never written to server disks, never logged,
              and never sent anywhere except your org. Your designs persist in your browser&apos;s IndexedDB.
            </p>
          </Section>

          <Section id="controls" title="2. Platform controls">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>HTTPS-only transport; strict Content-Security-Policy (<code className="font-mono text-[12px]">font-src &apos;self&apos;</code>, no external fonts or scripts), framing denied, no-sniff, strict referrer.</li>
              <li>Self-hosted fonts (Inter + JetBrains Mono bundled locally) — zero calls to font CDNs or Google APIs at build or runtime.</li>
              <li>Server-side rate limiting on Salesforce proxy routes (200 requests/minute per IP, HTTP 429 beyond).</li>
              <li>Schema writes are create-only and always confirmed: Author mode deploys one change at a time through the Tooling API, with an explicit confirm on production-like orgs and no delete path.</li>
              <li>No cookies, no analytics beacons, no third-party trackers — there is nothing to steal a session through on our side.</li>
            </ul>
          </Section>

          <Section id="shared" title="3. Your part (shared responsibility)">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Use least-privilege, short-lived tokens; prefer sandboxes for exploration and rotate production sessions after use.</li>
              <li>Never paste a production session into a shared or recorded machine; always Disconnect when finished.</li>
              <li>Review generated payloads before executing them — the tool drafts, you decide.</li>
            </ul>
          </Section>

          <Section id="report" title="4. Reporting an issue">
            <p>
              Found a security concern? Email{" "}
              <a href="mailto:kuldeep@coffeediscussions.com" className="underline hover:text-[var(--color-ink)]">
                kuldeep@coffeediscussions.com
              </a>{" "}
              with steps to reproduce. Please do not include live production tokens in the report.
            </p>
          </Section>
        </div>

        <div className="mt-10 flex flex-wrap gap-3 border-t border-[var(--color-line-soft)] pt-6 font-mono text-xs">
          <Link href="/privacy" className="underline hover:text-[var(--color-ink)] text-[var(--color-ink-soft)]">
            Privacy Policy
          </Link>
          <span aria-hidden="true" className="text-[var(--color-muted)]">•</span>
          <Link href="/terms" className="underline hover:text-[var(--color-ink)] text-[var(--color-ink-soft)]">
            Terms of Use
          </Link>
          <span aria-hidden="true" className="text-[var(--color-muted)]">•</span>
          <Link href="/" className="underline hover:text-[var(--color-ink)] text-[var(--color-ink-soft)]">
            Back to Studio
          </Link>
        </div>
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}
