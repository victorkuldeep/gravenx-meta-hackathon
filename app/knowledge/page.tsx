import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";
import { KnowledgeRoute } from "@/components/knowledge/KnowledgeRoute";

export const metadata = {
  title: "Knowledge - Architecture Repository",
  description: "One index of every record: what references it, what it references, and what dangles.",
  robots: { index: false, follow: false },
};

export default function KnowledgePage() {
  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-[1600px] px-2.5 pt-3 pb-1 flex-1">
        <KnowledgeRoute />
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}
