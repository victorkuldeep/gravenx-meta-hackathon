"use client";

export interface Step {
  label: string;
  hint: string;
}

interface StepperProps {
  steps: Step[];
  current: number;
}

/**
 * Builder progress rail: single thin line, sharp edges, hairline dividers.
 * Lives in a sticky top-and-bottom-bordered bar docked just above the footer.
 */
export function Stepper({ steps, current }: StepperProps) {
  return (
    <ol
      aria-label="Builder progress"
      className="flex items-stretch divide-x divide-[var(--color-line-soft)] overflow-x-auto"
    >
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={step.label}
            aria-current={active ? "step" : undefined}
            className={`flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap px-3 py-1.5 transition-colors ${
              active
                ? "bg-[var(--color-accent-bg)] shadow-[inset_0_-2px_0_var(--color-accent)]"
                : ""
            }`}
          >
            <span
              aria-hidden="true"
              className={`font-mono text-[10px] font-bold tracking-wider ${
                active
                  ? "text-[var(--color-accent-dark)]"
                  : done
                    ? "text-[var(--color-success)]"
                    : "text-[var(--color-muted)]"
              }`}
            >
              {done ? "✓" : `0${i + 1}`}
            </span>
            <span
              className={`truncate text-[11px] font-semibold ${
                active
                  ? "text-[var(--color-ink)]"
                  : done
                    ? "text-[var(--color-ink-soft)]"
                    : "text-[var(--color-muted)]"
              }`}
            >
              {step.label}
              <span
                className={`ml-1.5 font-mono text-[10px] font-normal ${
                  active || done
                    ? "text-[var(--color-ink-soft)]"
                    : "text-[var(--color-muted)]"
                }`}
              >
                {step.hint}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
