import { NotesRoute } from "@/components/notes/NotesRoute";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";

export const metadata = { title: "Notes" };

export default function NotesPage() {
  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-[1600px] min-h-0 flex-1 flex-col px-2.5 pt-1 pb-1">
        <NotesRoute />
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}
