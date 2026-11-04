"use client";

import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="arch-card flex flex-col items-center justify-center text-center px-6 py-12">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-accent-bg)] border border-[var(--color-line)] text-[var(--color-accent-dark)]">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-ivory-950">{title}</h3>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-ivory-600">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
