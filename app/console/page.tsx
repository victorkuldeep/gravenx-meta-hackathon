import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";
import { ConsoleRoute } from "@/components/console/ConsoleRoute";

export const metadata = {
  title: "Console - Architect Task Manager",
  description: "Personal console: log tasks, track lifecycle, sync two-way with canvas TODOs.",
  robots: { index: false, follow: false },
};

export default function ConsolePage() {
  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-[1600px] px-2.5 pt-3 pb-1 flex-1">
        <ConsoleRoute />
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}
