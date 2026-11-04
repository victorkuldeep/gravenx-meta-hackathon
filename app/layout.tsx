import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AiDock } from "@/components/ai/AiDock";
import { BridgeDock } from "@/components/bridge/BridgeDock";
// Self-hosted fonts (bundled via @fontsource, zero external requests):
// no Google Fonts CDN, no build-time Google API fetch — required for
// regions where fonts.googleapis.com / fonts.gstatic.com are not approved.
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";

export const viewport: Viewport = {
  themeColor: "#FAF8F2",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  ),
  title: {
    default: "GRAVENX - The Architecture Engineering Studio",
    template: "%s - GRAVENX",
  },
  description:
    "Metadata-driven Salesforce REST payload builder. Connect live, describe any sObject, generate Table API + Composite payloads and export to JSON, cURL, JS or Apex.",
  authors: [{ name: "Kuldeep Singh" }],
  creator: "Kuldeep Singh",
  formatDetection: { email: false, address: false, telephone: false },
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--color-canvas)] text-[var(--color-ink)] antialiased flex flex-col">
        <a href="#main-content" className="skip-to-content">
          Skip to main content
        </a>
        {children}
        <AiDock />
        <BridgeDock />
      </body>
    </html>
  );
}
