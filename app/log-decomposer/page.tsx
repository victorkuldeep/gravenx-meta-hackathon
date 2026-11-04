import { LogDecomposerRoute } from "@/components/log-decomposer/LogDecomposerRoute";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";

export const metadata = { title: "Log Decomposer" };

export default function LogDecomposerPage() {
  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <main className="flex w-full min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-3 pb-1">
        <LogDecomposerRoute />
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}
