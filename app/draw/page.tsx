import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";
import { DrawStudio } from "@/components/draw/DrawStudio";

export const metadata = {
  title: "Draw Studio",
  description: "Engineering whiteboard - sketch architecture, flows and topologies on a self-hosted canvas.",
  robots: { index: false, follow: false },
};

export default function DrawPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />
      <main className="w-full flex-1 flex flex-col min-h-0">
        <DrawStudio />
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}
