"use client";

import type { ReactNode } from "react";
import { AppHeader, type NavMode } from "./AppHeader";
import { AppFooter } from "./AppFooter";

interface AppShellProps {
  children: ReactNode;
  connected: boolean;
  instanceUrl: string;
  apiVersion: string;
  objectCount: number;
  connecting: boolean;
  onConnectClick: () => void;
  onDisconnect: () => void;
  onNavigate: (mode: NavMode) => void;
  activeMode?: NavMode;
  /** Builder progress trail — docked above the footer, null on home/schema. */
  trail?: ReactNode;
  /** Full website footer on home, slim one-row bar inside work tools. */
  footerVariant: "full" | "slim";
}

export function AppShell({
  children,
  connected,
  instanceUrl,
  apiVersion,
  objectCount,
  connecting,
  onConnectClick,
  onDisconnect,
  onNavigate,
  activeMode,
  footerVariant,
  trail,
}: AppShellProps) {
  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader
        connected={connected}
        instanceUrl={instanceUrl}
        apiVersion={apiVersion}
        objectCount={objectCount}
        connecting={connecting}
        onConnectClick={onConnectClick}
        onDisconnect={onDisconnect}
        onNavigate={onNavigate}
        activeMode={activeMode}
      />
      <div className="flex-1 flex flex-col" id="main-content">
        {children}
      </div>
        <AppFooter trail={trail} variant={footerVariant} />
    </div>
  );
}
