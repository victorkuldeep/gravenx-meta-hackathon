"use client";

export type BootStage = "connect" | "objects";

interface BootLoaderProps {
  stage: BootStage;
  fading: boolean;
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin text-bronze-600`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function Check() {
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-600 text-[10px] font-bold text-white" aria-hidden="true">
      ✓
    </span>
  );
}

function Pending() {
  return (
    <span className="h-4 w-4 rounded-full border border-[var(--color-line)] bg-[var(--color-canvas)]" aria-hidden="true" />
  );
}

export function BootLoader({ stage, fading }: BootLoaderProps) {
  const connectDone = stage === "objects";
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-canvas)]/92 transition-opacity duration-300 ${
        fading ? "opacity-0" : "opacity-100"
      }`}
      role="status"
      aria-live="polite"
      aria-label={stage === "connect" ? "Connecting to Salesforce" : "Loading Salesforce objects"}
    >
      <div className="modal-card max-w-sm w-[calc(100%-2rem)] px-8 py-9 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-ivory-950 text-xl font-bold text-bronze-200">
          So
        </div>
        <h2 className="text-lg font-bold text-ivory-950">Setting up your studio</h2>
        <p className="mt-1.5 text-sm text-ivory-600">Hold tight - this takes a few seconds.</p>
        <ol className="mt-6 space-y-3 text-left">
          <li className="flex items-center gap-3 text-sm">
            {connectDone ? <Check /> : <Spinner />}
            <span className={connectDone ? "text-ivory-600" : "font-semibold text-ivory-950"}>
              Authenticating with Salesforce
            </span>
          </li>
          <li className="flex items-center gap-3 text-sm">
            {stage === "objects" ? <Spinner /> : <Pending />}
            <span className={stage === "objects" ? "font-semibold text-ivory-950" : "text-ivory-500"}>
              Loading sObject metadata
            </span>
          </li>
        </ol>
      </div>
    </div>
  );
}
