import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";
import { DocsRoute } from "@/components/docs/DocsRoute";

export const metadata = {
  title: "Docs - Architect Onboarding",
  description: "GRAVENX documentation: tab tour, guides, AI skills, and reference for onboarding architects.",
  robots: { index: false, follow: false },
};

export default function DocsPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-[1600px] px-2.5 pt-3 pb-1 flex-1">
        <DocsRoute />
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}
