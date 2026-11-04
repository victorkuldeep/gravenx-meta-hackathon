"use client";

/**
 * Collection tray button: opens the staged-request collection drawer.
 * Lives next to the "+ Collection" stage buttons inside the tabs that use
 * collections (REST, Builder, Composite, GraphQL) - never in the header.
 */

interface CollectionTrayButtonProps {
  count: number;
  onOpen: () => void;
}

export function CollectionTrayButton({ count, onOpen }: CollectionTrayButtonProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative inline-flex items-center gap-1.5 rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:border-[var(--color-accent)] transition-all cursor-pointer"
      title={count === 0 ? "Staged request collection (empty)" : `Open collection (${count} staged)`}
      aria-label={`Open request collection, ${count} staged requests`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" />
      </svg>
      <span className="hidden sm:inline">Collection</span>
      {count > 0 && (
        <span className="min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-ivory-950 text-ivory-100 text-[10px] font-bold">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
