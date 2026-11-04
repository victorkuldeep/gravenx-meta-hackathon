"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import { SupportDialog } from "./SupportDialog";

export function AppFooter({ trail, variant }: { trail?: ReactNode; variant: "full" | "slim" }) {
  const year = new Date().getFullYear();
  const [supportOpen, setSupportOpen] = useState(false);

  const coffeeButton = (
    <button
      type="button"
      onClick={() => setSupportOpen(true)}
      title="Buy me a coffee"
      aria-label="Buy me a coffee"
      className="inline-flex items-center text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="h-4 w-4">
        <path d="M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Z" />
        <path d="M16 9h2a2 2 0 0 1 0 4h-2M7 4c0 1-1 1.5-1 2.5M11 4c0 1-1 1.5-1 2.5" />
      </svg>
    </button>
  );

  if (variant === "slim") {
    return (
      <>
      {trail && (
        <div className="sticky bottom-0 z-30 border-y border-[var(--color-line)] bg-[var(--color-surface)]">
          <div className="mx-auto w-full max-w-5xl px-5">{trail}</div>
        </div>
      )}
      <footer className={`app-chrome-footer w-full bg-[#F5F1E8]/60 mt-auto relative overflow-hidden ${trail ? "" : "border-t border-[var(--color-line)]"}`}>
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-20 pointer-events-none bg-[radial-gradient(#AE9B7D_1px,transparent_1px)] [background-size:24px_24px]"
        />
        <div className="relative mx-auto w-full px-5 lg:px-8 py-1 flex flex-row flex-nowrap items-center justify-between gap-x-3 overflow-x-auto font-mono text-[10px] whitespace-nowrap text-[var(--color-muted)]">
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/" className="font-semibold text-[var(--color-ink)] hover:text-[var(--color-accent)] transition-colors">
              GRAVENX
            </Link>
            <span aria-hidden="true">•</span>
            <span className="hidden xl:inline">For Architects · API-First Teams · Salesforce Practitioners</span>
          </div>
          <small className="shrink-0 text-[10px]">
            © {year}{" "}
            <a
              href="https://www.linkedin.com/in/victorkuldeep/"
              target="_blank"
              rel="noreferrer"
              title="Designed & developed by Kuldeep Singh"
              className="underline hover:text-[var(--color-ink)] transition-colors"
            >
              Kuldeep Singh
            </a>{" "}
            · Independent project.
          </small>
          <div className="flex shrink-0 items-center gap-2">
            <nav aria-label="Legal" className="flex items-center gap-2">
              <Link href="/about" className="hover:text-[var(--color-ink)] hover:underline transition-colors">
                About
              </Link>
              <span aria-hidden="true">•</span>
              <Link href="/privacy" className="hover:text-[var(--color-ink)] hover:underline transition-colors">
                Privacy
              </Link>
              <span aria-hidden="true">•</span>
              <Link href="/terms" className="hover:text-[var(--color-ink)] hover:underline transition-colors">
                Terms
              </Link>
              <span aria-hidden="true">•</span>
              <Link href="/security" className="hover:text-[var(--color-ink)] hover:underline transition-colors">
                Security
              </Link>
            </nav>
            <span aria-hidden="true">•</span>
            {coffeeButton}
          </div>
        </div>
      </footer>
      <SupportDialog open={supportOpen} onClose={() => setSupportOpen(false)} />
      </>
    );
  }

  return (
    <>
    {trail && (
      <div className="sticky bottom-0 z-30 border-y border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto w-full max-w-5xl px-5">{trail}</div>
      </div>
    )}
    <footer
      aria-label="Site footer"
      className={`app-chrome-footer w-full bg-[#F5F1E8]/60 mt-auto relative overflow-hidden ${trail ? "" : "border-t border-[var(--color-line)]"}`}
    >
      {/* Ambient dotted detail */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-20 pointer-events-none bg-[radial-gradient(#AE9B7D_1px,transparent_1px)] [background-size:24px_24px]"
      />

      <div className="relative mx-auto w-full px-5 lg:px-8 pt-10 pb-6">
        {/* Brand + nav grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 pb-8">
          <div className="md:col-span-4 space-y-4">
            <div>
              <p className="text-sm font-bold text-[var(--color-ink)]">
                GRAVEN<span className="bg-gradient-to-r from-bronze-600 via-[#C9A86A] to-bronze-600 bg-clip-text text-transparent">X</span>
              </p>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[2px] text-[var(--color-muted)]">
                The Architecture Engineering Studio
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[2px] text-[var(--color-muted)]">
                Graph · Relationships · Architecture · Vertices · Engineering · Nexus
              </p>
            </div>
            <p className="max-w-sm text-xs leading-relaxed text-[var(--color-ink-soft)]">
              API-first payload design for Salesforce architects - describe live
              metadata, compose batches, diff versions, export anywhere.
            </p>
            <div className="pt-3 border-t border-[var(--color-line-soft)] max-w-sm">
              <a
                href="https://www.linkedin.com/in/victorkuldeep/"
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-[var(--color-surface)] transition-colors"
                aria-label="Kuldeep Singh - Architect, Engineering Leader (LinkedIn)"
              >
                <span className="relative block h-11 w-11 shrink-0 overflow-hidden rounded-full border border-[var(--color-line)] bg-[var(--color-canvas)] shadow-sm ring-1 ring-[var(--color-accent)]/30 group-hover:ring-[var(--color-accent)]/60 transition-all">
                  <Image
                    src="/kuldeep-profile.webp"
                    alt="Kuldeep Singh"
                    width={44}
                    height={44}
                    className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-xs font-bold text-[var(--color-ink)] group-hover:text-[var(--color-accent-dark)] transition-colors">
                    Kuldeep Singh
                    <span aria-hidden="true" className="text-[var(--color-muted)]">↗</span>
                  </span>
                  <span className="block truncate font-mono text-[11px] text-[var(--color-muted)]">
                    Architect / Engineering Leader
                  </span>
                </span>
              </a>
            </div>

            {/* Social icon row */}
            <div className="pt-1">
              <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-2">
                Connections &amp; source
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href="https://github.com/victorkuldeep"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Kuldeep Singh on GitHub"
                  title="GitHub"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:border-[var(--color-accent)] transition-all"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-4 w-4">
                    <path d="M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943" />
                  </svg>
                </a>
                <a
                  href="https://linkedin.com/in/victorkuldeep"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Kuldeep Singh on LinkedIn"
                  title="LinkedIn"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:border-[var(--color-accent)] transition-all"
                >
                  <svg viewBox="0 0 34 34" fill="currentColor" aria-hidden="true" className="h-4 w-4">
                    <path d="M34 2.5v29a2.5 2.5 0 0 1-2.5 2.5h-29A2.5 2.5 0 0 1 0 31.5v-29A2.5 2.5 0 0 1 2.5 0h29A2.5 2.5 0 0 1 34 2.5M10 13H5v16h5zm.45-5.5a2.88 2.88 0 0 0-2.86-2.9H7.5a2.9 2.9 0 0 0 0 5.8 2.88 2.88 0 0 0 2.95-2.81zM29 19.28c0-4.81-3.06-6.68-6.1-6.68a5.7 5.7 0 0 0-5.06 2.58h-.14V13H13v16h5v-8.51a3.32 3.32 0 0 1 3-3.58h.19c1.59 0 2.77 1 2.77 3.52V29h5z" />
                  </svg>
                </a>
                <a
                  href="mailto:kuldeep@coffeediscussions.com"
                  aria-label="Email Kuldeep Singh"
                  title="Email"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:border-[var(--color-accent)] transition-all"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="h-4 w-4">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="m3 7 9 6 9-6" />
                  </svg>
                </a>
                <a
                  href="https://coffeediscussions.com"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Coffee Discussions"
                  title="Coffee Discussions"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:border-[var(--color-accent)] transition-all"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="h-4 w-4">
                    <path d="M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Z" />
                    <path d="M16 9h2a2 2 0 0 1 0 4h-2M7 4c0 1-1 1.5-1 2.5M11 4c0 1-1 1.5-1 2.5" />
                  </svg>
                </a>
              </div>
            </div>
          </div>

          <div className="md:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-6">
            <div className="space-y-2.5">
              <span className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink)]">
                Explore
              </span>
              <nav aria-label="Explore">
                <ul className="space-y-2 font-mono text-xs">
                  <li>
                    <Link
                      href="/"
                      className="text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:underline transition-colors"
                    >
                      Home
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/?mode=schema"
                      className="text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:underline transition-colors"
                    >
                      Schema
                    </Link>
                  </li>
                  <li>
                    <a
                      href="https://excalidraw.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:underline transition-colors inline-flex items-center gap-1"
                    >
                      Excalidraw <span aria-hidden="true">↗</span>
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://workbench.developerforce.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:underline transition-colors inline-flex items-center gap-1"
                    >
                      Workbench <span aria-hidden="true">↗</span>
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://developer.salesforce.com/docs"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:underline transition-colors inline-flex items-center gap-1"
                    >
                      Salesforce Docs <span aria-hidden="true">↗</span>
                    </a>
                  </li>
                </ul>
              </nav>
            </div>

            <div className="space-y-2.5 col-span-2 sm:col-span-1">
              <span className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink)]">
                Connect
              </span>
              <nav aria-label="Ecosystem">
                <ul className="space-y-2 font-mono text-xs">
                  <li>
                    <a
                      href="https://victorkuldeep.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:underline transition-colors inline-flex items-center gap-1"
                    >
                      Portfolio <span aria-hidden="true">↗</span>
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://research.kuldeepsingh.ai"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:underline transition-colors inline-flex items-center gap-1"
                    >
                      KS Research Lab <span aria-hidden="true">↗</span>
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://coffeediscussions.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:underline transition-colors inline-flex items-center gap-1"
                    >
                      Coffee Discussions <span aria-hidden="true">↗</span>
                    </a>
                  </li>
                </ul>
              </nav>
              <p className="pt-1 text-[11px] font-mono leading-relaxed text-[var(--color-muted)]">
                Token lives in session memory only. Calls proxied server-side.
              </p>
            </div>
            <div className="space-y-2.5 col-span-2 sm:col-span-1">
              <span className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink)]">
                Explore other Tools
              </span>
              <nav aria-label="Other tools">
                <ul className="space-y-2 font-mono text-xs">
                  <li>
                    <a
                      href="http://tmf.victorkuldeep.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:underline transition-colors inline-flex items-center gap-1"
                    >
                      TMF API Toolkit <span aria-hidden="true">↗</span>
                    </a>
                  </li>
                </ul>
              </nav>
              <p className="pt-1 text-[11px] font-mono leading-relaxed text-[var(--color-muted)]">
                TMF API Intelligence Toolkit for architects &amp; API-first teams.
              </p>
            </div>
            <div className="space-y-2.5 col-span-2 sm:col-span-1">
              <span className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink)]">
                Legal &amp; Privacy
              </span>
              <nav aria-label="Legal and privacy">
                <ul className="space-y-2 font-mono text-xs">
                  <li>
                    <Link
                      href="/privacy"
                      className="text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:underline transition-colors"
                    >
                      Privacy Policy
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/terms"
                      className="text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:underline transition-colors"
                    >
                      Terms of Use
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/security"
                      className="text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:underline transition-colors"
                    >
                      Security
                    </Link>
                  </li>
                </ul>
              </nav>
              <p className="pt-1 text-[11px] font-mono leading-relaxed text-[var(--color-muted)]">
                GDPR-ready: essential storage only, no tracking cookies.
              </p>
            </div>
          </div>
        </div>

        {/* Workflow track */}
        <div className="py-4 border-y border-[var(--color-line-soft)] flex flex-col md:flex-row md:items-center justify-between gap-3 font-mono text-[11px]">
          <span className="font-bold uppercase tracking-wider text-[var(--color-accent-dark)] shrink-0">
            Builder Workflow
          </span>
          <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-[10px] sm:text-[11px] text-[var(--color-muted)]">
            {["CONNECT", "SELECT", "CONFIGURE", "EXPORT", "VERIFY"].map((step, i, arr) => (
              <span key={step} className="flex items-center gap-1 sm:gap-2">
                <span className="text-[var(--color-ink-soft)] hover:text-[var(--color-accent-dark)] transition-colors font-medium">
                  {step}
                </span>
                {i < arr.length - 1 && <span aria-hidden="true">→</span>}
              </span>
            ))}
          </div>
          <span className="text-[10px] uppercase tracking-widest text-[var(--color-muted)] shrink-0 hidden lg:block">
            API Workbench
          </span>
        </div>

        {/* Bottom bar - one row: brand | © disclaimer | legal + coffee */}
        <div className="pt-4 flex flex-col items-center gap-y-1 font-mono text-[10px] text-[var(--color-muted)] md:flex-row md:flex-nowrap md:justify-between md:gap-x-3 md:whitespace-nowrap">
          <div className="flex items-center gap-2">
            <Link href="/" className="font-semibold text-[var(--color-ink)] hover:text-[var(--color-accent)] transition-colors">
              GRAVENX
            </Link>
            <span aria-hidden="true">•</span>
            <span className="hidden xl:inline">For Architects · API-First Teams · Salesforce Practitioners</span>
          </div>
          <small className="text-[10px]">
            © {year}{" "}
            <a
              href="https://www.linkedin.com/in/victorkuldeep/"
              target="_blank"
              rel="noreferrer"
              title="Designed & developed by Kuldeep Singh"
              className="underline hover:text-[var(--color-ink)] transition-colors"
            >
              Kuldeep Singh
            </a>{" "}
            · Independent project.
          </small>
          <div className="flex items-center gap-2">
            <nav aria-label="Legal" className="flex items-center gap-2">
              <Link href="/about" className="hover:text-[var(--color-ink)] hover:underline transition-colors">
                About
              </Link>
              <span aria-hidden="true">•</span>
              <Link href="/privacy" className="hover:text-[var(--color-ink)] hover:underline transition-colors">
                Privacy
              </Link>
              <span aria-hidden="true">•</span>
              <Link href="/terms" className="hover:text-[var(--color-ink)] hover:underline transition-colors">
                Terms
              </Link>
              <span aria-hidden="true">•</span>
              <Link href="/security" className="hover:text-[var(--color-ink)] hover:underline transition-colors">
                Security
              </Link>
            </nav>
            <span aria-hidden="true">•</span>
            {coffeeButton}
          </div>
        </div>
      </div>
    </footer>
    <SupportDialog open={supportOpen} onClose={() => setSupportOpen(false)} />
    </>
  );
}
