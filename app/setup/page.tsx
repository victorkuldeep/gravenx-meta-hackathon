import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";
import { SetupRoute } from "@/components/setup/SetupRoute";

export const metadata = {
  title: "Setup - GRAVENX Admin",
  description: "Admin console: agent control plane, connections, workspace, compliance, about.",
  robots: { index: false, follow: false },
};

export default async function SetupPage({
  searchParams,
}: {
  searchParams?: Promise<{ bridge?: string; port?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const linkCode = typeof params.bridge === "string" ? params.bridge.replace(/\D/g, "").slice(0, 12) : undefined;
  const linkPort = typeof params.port === "string" ? params.port.replace(/\D/g, "").slice(0, 5) : undefined;
  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-[1600px] px-2.5 pt-3 pb-1 flex-1">
        <SetupRoute linkCode={linkCode} linkPort={linkPort} />
      </main>
      <AppFooter variant="slim" />
    </div>
  );
}
