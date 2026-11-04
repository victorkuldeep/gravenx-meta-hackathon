import { DecisionsRoute } from "@/components/decisions/DecisionsRoute";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";

export const metadata = { title: "Decision Studio" };

export default function DecisionsPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-[1600px] px-2.5 pt-3 pb-1 flex-1">
        <DecisionsRoute />
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}
