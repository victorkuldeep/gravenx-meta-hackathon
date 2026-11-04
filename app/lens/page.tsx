import { LensPanel } from "@/components/lens/LensPanel";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";

export const metadata = { title: "Org Lens" };

export default function LensPage() {
  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-[1600px] min-h-0 flex-1 flex-col px-2.5 pt-3 pb-1">
        <LensPanel />
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}
