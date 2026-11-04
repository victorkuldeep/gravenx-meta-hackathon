import { WireframeRoute } from "@/components/wireframe/WireframeRoute";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";

export const metadata = { title: "Wireframe Studio" };

export default function WireframePage() {
  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-[1600px] min-h-0 flex-1 flex-col px-2.5 pt-3 pb-1">
        <WireframeRoute />
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}
