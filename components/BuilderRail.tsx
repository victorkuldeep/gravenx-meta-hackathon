"use client";

export type BuilderRailId = "object" | "fields" | "payload" | "test";

export interface BuilderRailItem {
  id: BuilderRailId;
  label: string;
  open: boolean;
  onToggle: () => void;
}

interface BuilderRailProps {
  items: BuilderRailItem[];
  /** Payload section exists only when connected with fields chosen. */
  payloadAvailable: boolean;
  /** Test section exists only once a payload was generated. */
  testAvailable: boolean;
}

/**
 * Slim section rail for the builder: Object / Fields / Payload / Test.
 * The default matches the old always-rendered page; collapsing a section
 * docks it here and lets everything below rise. Payload and Test dock
 * automatically when their section cannot exist yet.
 */
export function BuilderRail({ items, payloadAvailable, testAvailable }: BuilderRailProps) {
  const available = (id: BuilderRailId) =>
    id === "payload" ? payloadAvailable : id === "test" ? testAvailable : true;

  return (
    <div className="flex shrink-0 flex-row gap-1 lg:w-10 lg:flex-col" role="toolbar" aria-label="Builder sections">
      {items.map((item) => {
        const ok = available(item.id);
        const shown = item.open && ok;
        return (
          <button
            key={item.id}
            type="button"
            onClick={item.onToggle}
            disabled={!ok}
            aria-expanded={shown}
            title={
              !ok
                ? `${item.label} is unavailable until its section exists`
                : shown
                  ? `Collapse ${item.label} panel`
                  : `Expand ${item.label} panel`
            }
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors lg:flex-col lg:px-1 lg:py-3 ${
              shown
                ? "border-ivory-950 bg-ivory-950 text-ivory-100"
                : "border-[var(--color-line)] bg-[var(--color-surface)] text-ivory-600 hover:text-ivory-950"
            } ${ok ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${shown ? "bg-bronze-400" : "border border-current"}`}
            />
            <span className="lg:[writing-mode:vertical-rl]">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
