import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";

export const metadata = {
  title: "Terms of Use",
  description: "Terms for using GRAVENX, including the independent-project disclaimer.",
  robots: { index: false, follow: false },
};

const EFFECTIVE_DATE = "October 4, 2026";

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

export default function TermsPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl px-5 pt-10 pb-16 flex-1" id="main-content">
        <p className="font-mono text-[11px] uppercase tracking-[2px] text-[var(--color-accent-dark)]">
          Legal
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--color-ink)]">Terms of Use</h1>
        <p className="mt-2 font-mono text-xs text-[var(--color-muted)]">Effective {EFFECTIVE_DATE}</p>

        <div className="mt-8 space-y-8">
          <Section id="service" title="1. What this tool is">
            <p>
              GRAVENX is a free, browser-first architecture engineering studio:
              live metadata describe, ERD design, payload composition, and API exploration (including the System
              tab for multi-system integration topology). It is an <strong>independent project</strong>.
            </p>
          </Section>

          <Section id="third-party" title="2. Third-party software">
            <p>
              The Draw+ whiteboard is powered by{" "}
              <a href="https://github.com/excalidraw/excalidraw" target="_blank" rel="noreferrer" className="underline hover:text-[var(--color-ink)]">
                Excalidraw
              </a>
              , MIT licensed, integrated as an unmodified package with assets self-hosted from
              our own origin. The MIT licence requires this notice: the software is provided
              &ldquo;as is&rdquo;, without warranty of any kind. GRAVENX itself is an independent
              project and is not affiliated with Excalidraw or Salesforce.
            </p>
          </Section>

          <Section id="licence" title="3. Licence and acceptable use">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>You may use the tool for designing, testing, and documenting integrations against orgs you are authorised to access.</li>
              <li>
                Connect only with credentials you are entitled to use, with the minimum scopes your task needs.
                You are responsible for complying with your org&apos;s policies and Salesforce&apos;s terms.
              </li>
              <li>
                Do not abuse the service: no credential stuffing, no scraping third-party orgs, no attempts to
                bypass rate limits (200 requests/minute per IP) or to disrupt the proxy for others.
              </li>
            </ul>
          </Section>

          <Section id="data" title="4. Your data stays yours">
            <p>
              Sessions live in your browser tab (<code className="font-mono text-[12px]">sessionStorage</code>),
              designs in your browser&apos;s IndexedDB. Nothing is sold, and nothing is used for advertising.
              Exports and shares happen only when you trigger them. See the{" "}
              <Link href="/privacy" className="underline hover:text-[var(--color-ink)]">Privacy Policy</Link>{" "}
              for the full storage and GDPR model.
            </p>
          </Section>

          <Section id="no-warranty" title="5. No warranty; verify before production">
            <p>
              The tool is provided <strong>&ldquo;as is&rdquo;</strong>, without warranties of any kind. Generated
              payloads, API suggestions, and topology views are design aids: always validate against your target
              org (sandbox first) before running anything in production. You accept responsibility for what you
              execute with your own credentials.
            </p>
          </Section>

          <Section id="liability" title="6. Liability">
            <p>
              To the maximum extent permitted by law, the publisher is not liable for indirect, incidental, or
              consequential damages arising from use of the tool — including any change made in a connected
              Salesforce org. Your sole remedy for dissatisfaction is to stop using the tool and clear its site
              data.
            </p>
          </Section>

          <Section id="changes" title="7. Changes and contact">
            <p>
              These terms may be updated; continued use after the effective date constitutes acceptance.
              Questions:{" "}
              <a href="mailto:kuldeep@coffeediscussions.com" className="underline hover:text-[var(--color-ink)]">
                kuldeep@coffeediscussions.com
              </a>
              .
            </p>
          </Section>
        </div>

        <div className="mt-10 flex flex-wrap gap-3 border-t border-[var(--color-line-soft)] pt-6 font-mono text-xs">
          <Link href="/privacy" className="underline hover:text-[var(--color-ink)] text-[var(--color-ink-soft)]">
            Privacy Policy
          </Link>
          <span aria-hidden="true" className="text-[var(--color-muted)]">•</span>
          <Link href="/security" className="underline hover:text-[var(--color-ink)] text-[var(--color-ink-soft)]">
            Security
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
