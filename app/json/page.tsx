import { JsonStudio } from "@/components/json-studio/JsonStudio";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";

export const metadata = { title: "JSON Studio" };

export default function JsonPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-[1600px] px-2.5 pt-3 pb-1 flex-1">
        <JsonStudio />
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}

