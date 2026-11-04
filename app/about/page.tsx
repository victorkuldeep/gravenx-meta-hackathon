import Image from "next/image";
import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";

export const metadata = {
  title: "About - Kuldeep Singh",
  description: "The architect behind GRAVENX - Principal Technical Architect, Salesforce Industries, Revenue Cloud, agentic AI.",
  robots: { index: false, follow: false },
};

const DOMAINS = [
  "Experience Architecture",
  "Enterprise Systems Design",
  "Integration & API Topology",
  "Event-Driven Architecture",
  "Platform & Salesforce Engineering",
  "AI-Augmented Architecture",
];

const SOCIALS = [
  { label: "GitHub", href: "https://github.com/victorkuldeep", icon: "github" },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/victorkuldeep/", icon: "linkedin" },
  { label: "Email", href: "mailto:kuldeep@coffeediscussions.com", icon: "mail" },
  { label: "Portfolio", href: "https://kuldeepsingh.ai", icon: "globe" },
] as const;

function SocialIcon({ icon }: { icon: (typeof SOCIALS)[number]["icon"] }) {
  if (icon === "github")
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5">
        <path d="M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943" />
      </svg>
    );
  if (icon === "linkedin")
    return (
      <svg viewBox="0 0 34 34" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5">
        <path d="M34 2.5v29a2.5 2.5 0 0 1-2.5 2.5h-29A2.5 2.5 0 0 1 0 31.5v-29A2.5 2.5 0 0 1 2.5 0h29A2.5 2.5 0 0 1 34 2.5M10 13H5v16h5zm.45-5.5a2.88 2.88 0 0 0-2.86-2.9H7.5a2.9 2.9 0 0 0 0 5.8 2.88 2.88 0 0 0 2.95-2.81zM29 19.28c0-4.81-3.06-6.68-6.1-6.68a5.7 5.7 0 0 0-5.06 2.58h-.14V13H13v16h5v-8.51a3.32 3.32 0 0 1 3-3.58h.19c1.59 0 2.77 1 2.77 3.52V29h5z" />
      </svg>
    );
  if (icon === "mail")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-10 6L2 7" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export default function AboutPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-4 flex-1">
        <p className="font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">About the architect</p>
        <div className="mt-4 grid gap-8 md:grid-cols-[240px_1fr]">
          <div>
            <div className="overflow-hidden rounded-2xl border border-[#E8E2D8] bg-white shadow-sm">
              <Image
                src="/profile-img-1.webp"
                alt="Kuldeep Singh"
                width={480}
                height={600}
                className="h-auto w-full object-cover"
                priority={false}
              />
            </div>
            <p className="mt-2 text-center text-[13px] font-bold text-[#27241F]">Kuldeep Singh</p>
            <p className="text-center font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
              Principal Technical Architect
            </p>
          </div>
          <div>
            <p className="border-l-2 border-[#C9A86A] pl-4 text-[17px] font-semibold leading-relaxed text-[#27241F]">
              “I don’t architect technologies in isolation. I architect the relationships between them.”
            </p>
            <div className="mt-4 space-y-3 text-[13px] leading-relaxed text-[#3A352D]">
              <p>
                Principal Technical Architect with 14+ years across Salesforce Industries — from
                AP/AR billing systems to telecom, media and technology, and Salesforce Revenue
                Cloud. At Accenture I drive headless Revenue Cloud implementations and end-to-end
                integration architecture aligned to TM Forum Open Digital Architecture, and serve
                as an agentic AI SME leading Agentforce adoption.
              </p>
              <p>
                A decade at Wipro as Salesforce Technical Architect covered touchless invoicing,
                Experience Cloud portals, and end-to-end integrations across MuleSoft, Jitterbit
                and ERP systems. Founder of{" "}
                <a href="https://coffeediscussions.com" target="_blank" rel="noreferrer" className="font-semibold text-[#8A6A2F] hover:underline">
                  Coffee Discussions
                </a>
                , an open technology publication on agents, Revenue Cloud and distributed systems.
              </p>
              <p>
                GRAVENX is my flagship productivity tool, hand-crafted for integration work and
                shared with the community — designed by an architect, for architects.
              </p>
              <p>
                Every canvas, rule, and review in this studio was built hand-in-hand with my
                personal coding companion — meet Meta Muse Spark below.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {DOMAINS.map((d) => (
                <span key={d} className="rounded-full border border-[#E8E2D8] bg-white px-2.5 py-1 text-[11px] font-medium text-[#777168]">
                  {d}
                </span>
              ))}
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-[#E8E2D8] bg-white px-3 py-2.5">
                <p className="text-[12px] font-bold text-[#27241F]">Accenture</p>
                <p className="font-mono text-[10px] text-[#A39B8E]">Dec 2023 — Present</p>
                <p className="mt-1 text-[11px] leading-relaxed text-[#777168]">Headless Revenue Cloud · TM Forum ODA · Agentic AI enablement</p>
              </div>
              <div className="rounded-xl border border-[#E8E2D8] bg-white px-3 py-2.5">
                <p className="text-[12px] font-bold text-[#27241F]">Wipro</p>
                <p className="font-mono text-[10px] text-[#A39B8E]">Apr 2013 — Dec 2023</p>
                <p className="mt-1 text-[11px] leading-relaxed text-[#777168]">Billing & finance · Experience Cloud · MuleSoft/Jitterbit integrations</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#E8E2D8] bg-white px-3 py-1.5 text-xs font-semibold text-[#27241F] transition-colors hover:border-[#C9A86A]"
                >
                  <SocialIcon icon={s.icon} />
                  {s.label} <span aria-hidden="true">↗</span>
                </a>
              ))}
              <Link href="/" className="px-2 py-1.5 text-xs font-semibold text-[#8A6A2F] hover:underline">
                ← Back to the studio
              </Link>
            </div>
          </div>
        </div>
        <section className="mt-12" aria-label="Meta Muse Spark">
          <p className="font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">The companion</p>
          <p className="mt-2 max-w-2xl text-[22px] font-bold leading-tight tracking-tight text-[#27241F]">
            Built proudly with Meta Muse Spark.
          </p>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[#3A352D]">
            GRAVENX was designed and engineered together with Meta Muse Spark, my personal
            coding companion — an architect&apos;s thinking partner from the first wireframe
            to the final commit.
          </p>
          <div className="mt-4 overflow-hidden rounded-2xl border border-[#E8E2D8] bg-[#201209] shadow-sm">
            <video
              src="/MuseSpark.mp4"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              className="h-auto w-full object-cover"
              aria-label="Meta Muse Spark photon sphere"
            />
            <p className="px-5 py-3 font-mono text-[10px] uppercase tracking-[2px] text-[#BFA98C]">
              Meta Muse Spark · Photon Sphere
            </p>
          </div>
        </section>
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}
