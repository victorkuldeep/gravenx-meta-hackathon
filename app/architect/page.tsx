import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";
import { ArchitectRoute } from "@/components/architect/ArchitectRoute";

export const metadata = {
  title: "API Contract Architect",
  description: "Design custom APIs from Salesforce data models - intent, operations, schemas, review.",
  robots: { index: false, follow: false },
};

export default function ArchitectPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-[1600px] px-2.5 pt-3 pb-1 flex-1">
        <ArchitectRoute />
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}
