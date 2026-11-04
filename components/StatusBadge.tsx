"use client";

type Status = "connected" | "disconnected" | "error" | "loading";

interface StatusBadgeProps {
  status: Status;
  message?: string;
}

const statusConfig: Record<Status, { dot: string; text: string; label: string }> = {
  connected: {
    dot: "bg-green-600",
    text: "text-green-700",
    label: "Connected",
  },
  disconnected: {
    dot: "bg-ivory-500",
    text: "text-ivory-600",
    label: "Not Connected",
  },
  error: {
    dot: "bg-red-500",
    text: "text-red-600",
    label: "Error",
  },
  loading: {
    dot: "bg-ivory-600 animate-pulse",
    text: "text-ivory-700",
    label: "Connecting...",
  },
};

export default function StatusBadge({ status, message }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm"
      aria-label={`Connection status: ${config.label}`}
      role="status"
    >
      <span className={`h-2 w-2 rounded-full ${config.dot}`} aria-hidden="true" />
      <span className={config.text}>{message ?? config.label}</span>
    </span>
  );
}
