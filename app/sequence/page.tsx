import { SequenceRoute } from "@/components/sequence/SequenceRoute";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";

export const metadata = { title: "Sequence Studio" };

export default function SequencePage() {
  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-[1600px] min-h-0 flex-1 flex-col px-2.5 pt-3 pb-1">
        <SequenceRoute />
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}
