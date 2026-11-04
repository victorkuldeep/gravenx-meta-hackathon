import { MappingRoute } from "@/components/mapping/MappingRoute";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";

export const metadata = { title: "Mapping Studio" };

export default function MappingPage() {
  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-[1600px] min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pt-3 pb-1">
        <MappingRoute />
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}
