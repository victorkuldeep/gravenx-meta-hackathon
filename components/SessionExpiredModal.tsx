"use client";

import Button from "./ui/Button";

interface SessionExpiredModalProps {
  open: boolean;
  instanceUrl: string;
  onReconnect: () => void;
  onDisconnect: () => void;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function SessionExpiredModal({
  open,
  instanceUrl,
  onReconnect,
  onDisconnect,
}: SessionExpiredModalProps) {
  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="expired-title"
      aria-describedby="expired-desc"
    >
      <div className="modal-card max-w-md">
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 border border-amber-300">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A67C52" strokeWidth="2.2" aria-hidden="true">
              <path d="M12 3 2.5 20h19L12 3Z" strokeLinejoin="round" />
              <path d="M12 10v4.5" strokeLinecap="round" />
              <circle cx="12" cy="17.2" r="0.4" fill="#A67C52" />
            </svg>
          </div>
          <h2 id="expired-title" className="text-lg font-bold text-ivory-950">
            Salesforce session expired
          </h2>
          <p id="expired-desc" className="mt-2 text-sm leading-relaxed text-ivory-700">
            Your token for{" "}
            <span className="font-mono font-semibold text-ivory-950">{hostOf(instanceUrl)}</span>{" "}
            is no longer valid - it expired or was revoked. Reconnect with a fresh
            token to continue. Your staged collections and canvas work are untouched.
          </p>
        </div>
        <div className="px-6 pb-5 flex gap-2">
          <Button variant="secondary" onClick={onDisconnect} className="flex-1">
            Disconnect
          </Button>
          <Button onClick={onReconnect} className="flex-1">
            Reconnect
          </Button>
        </div>
      </div>
    </div>
  );
}
