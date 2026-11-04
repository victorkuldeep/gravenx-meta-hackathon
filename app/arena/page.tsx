import { ArenaPanel } from "@/components/arena/ArenaPanel";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";

export const metadata = { title: "Design Arena" };

export default function ArenaPage() {
  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <main className="flex w-full min-h-0 flex-1 flex-col px-5 pt-3 pb-1">
        <ArenaPanel />
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}
