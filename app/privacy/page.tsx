import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";

export const metadata = {
  title: "Privacy Policy",
  description:
    "How GRAVENX handles your Salesforce session, browser storage, and personal data under GDPR and global privacy laws.",
  robots: { index: false, follow: false },
};

const CONTACT_EMAIL = "kuldeep@coffeediscussions.com";
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

export default function PrivacyPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl px-5 pt-10 pb-16 flex-1" id="main-content">
        <p className="font-mono text-[11px] uppercase tracking-[2px] text-[var(--color-accent-dark)]">
          Legal · GDPR-ready
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--color-ink)]">Privacy Policy</h1>
        <p className="mt-2 font-mono text-xs text-[var(--color-muted)]">Effective {EFFECTIVE_DATE}</p>
        <p className="mt-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          GRAVENX is a browser-first Salesforce workbench for architects. It is designed so that your
          Salesforce credentials and org data stay with you: session secrets live in your browser tab, your
          work is stored in your browser&apos;s local databases, and this site sets{" "}
          <strong>no tracking cookies and runs no analytics or advertising</strong>. This page explains what
          is stored, why (including the GDPR lawful basis), and what rights you have.
        </p>

        <div className="mt-8 space-y-8">
          <Section id="controller" title="1. Who is responsible">
            <p>
              For data-protection purposes, <strong>you (or your organisation)</strong> are the controller of
              the Salesforce org data you choose to load into the tool. The tool itself performs no independent
              processing of your org data — it renders what you request, in your browser, against the org you
              connect.
            </p>
            <p>
              The publisher of this utility is Kuldeep Singh. Privacy questions:{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="underline hover:text-[var(--color-ink)]">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>

          <Section id="what-we-store" title="2. What is stored, where, and why">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <strong>Salesforce session (instance URL, access token, API version)</strong> — kept in{" "}
                <code className="font-mono text-[12px]">sessionStorage</code> (tab-scoped; cleared when the tab
                closes) and in page memory so you can work across tabs of this tool. Lawful basis: your consent
                when you click Connect, and performance of the service you requested (GDPR Art. 6(1)(a), (b)).
              </li>
              <li>
                <strong>Your designs (collections, payloads, snapshots, history, autosaves)</strong> — kept in
                your browser&apos;s <strong>IndexedDB</strong>, per organisation. They never leave your device
                except when you explicitly export or share them.
              </li>
              <li>
                <strong>Banner acknowledgement</strong> — a single{" "}
                <code className="font-mono text-[12px]">localStorage</code> flag records that you dismissed the
                privacy banner, so we don&apos;t show it again. Strictly necessary, no consent required.
              </li>
              <li>
                <strong>No accounts, no tracking, no ad cookies.</strong> There is nothing to log into on our
                side and nothing measuring you across sites.
              </li>
            </ul>
          </Section>

          <Section id="proxy" title="3. How Salesforce calls travel">
            <p>
              When you connect, your browser sends the session to this app&apos;s server-side API routes, which
              proxy the request to your Salesforce org (e.g.{" "}
              <code className="font-mono text-[12px]">*.salesforce.com</code>,{" "}
              <code className="font-mono text-[12px]">*.force.com</code>) and return the response. This covers
              reads, the record edits you make in Data Walkers, and — only in Author mode on the schema
              canvas — the metadata changes you explicitly confirm (new custom fields, objects, and
              relationships). Tokens are used only to fulfil your request and are not written to server disks
              or logs beyond transient error handling. Rate limiting (200 requests/minute per IP) protects the
              proxy from abuse.
            </p>
          </Section>

          <Section id="retention" title="4. Retention and deletion">
            <p>
              Close the tab and the session secret is gone from <code className="font-mono text-[12px]">sessionStorage</code>;
              use Disconnect and it is cleared immediately. IndexedDB designs persist on your device until you
              delete them (per-item delete, collection delete, or browser site-data clearing). The banner flag
              persists until you clear site data.
            </p>
          </Section>

          <Section id="rights" title="5. Your rights (GDPR / UK GDPR and equivalents)">
            <p>
              Because processing happens in your own browser, most rights are exercised directly: access and
              portability via Export, rectification by editing, erasure by deleting items or clearing site data,
              restriction by disconnecting. For anything you cannot do yourself — or for requests under
              applicable laws (GDPR, UK GDPR, CCPA/CPRA, and similar regimes) — contact{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="underline hover:text-[var(--color-ink)]">
                {CONTACT_EMAIL}
              </a>
              . You also have the right to lodge a complaint with your supervisory authority.
            </p>
          </Section>

          <Section id="sharing" title="6. Sharing and international transfers">
            <p>
              We sell no data and share nothing with advertisers. The only transfer is the one you initiate: your
              authorised Salesforce API calls, routed to the org URL you provided (which may sit in any Salesforce
              region). If you use the optional share/export features, you choose what leaves your browser and where
              it goes.
            </p>
          </Section>

          <Section id="security" title="7. Security">
            <p>
              Transport is HTTPS-only with strict security headers (Content-Security-Policy, no framing,
              no-sniff, strict referrer). See the <Link href="/security" className="underline hover:text-[var(--color-ink)]">Security overview</Link> for
              the full model — and note the shared-responsibility part: use least-privilege tokens, rotate them,
              and never paste a production session into a shared machine.
            </p>
          </Section>

          <Section id="children" title="8. Children and changes">
            <p>
              This is a professional tooling site, not directed at children. If this policy changes materially,
              the effective date above will be updated and the change noted in the tool.
            </p>
          </Section>
        </div>

        <div className="mt-10 flex flex-wrap gap-3 border-t border-[var(--color-line-soft)] pt-6 font-mono text-xs">
          <Link href="/terms" className="underline hover:text-[var(--color-ink)] text-[var(--color-ink-soft)]">
            Terms of Use
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
