"use client";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info" | "custom";
type BadgeColor = "blue" | "slate" | "green" | "yellow" | "red" | "purple";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  color?: BadgeColor;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default:  "bg-ivory-300 text-ivory-800 border-ivory-400",
  success:  "bg-green-100 text-green-800 border-green-300",
  warning:  "bg-amber-100 text-amber-800 border-amber-300",
  error:    "bg-red-100 text-red-700 border-red-300",
  info:     "bg-bronze-100 text-bronze-700 border-bronze-300",
  custom:   "",
};

const colorClasses: Record<BadgeColor, string> = {
  blue:   "bg-bronze-100 text-bronze-700 border-bronze-300",
  slate:  "bg-ivory-300 text-ivory-800 border-ivory-400",
  green:  "bg-green-100 text-green-800 border-green-300",
  yellow: "bg-amber-100 text-amber-800 border-amber-300",
  red:    "bg-red-100 text-red-700 border-red-300",
  purple: "bg-ivory-300 text-ivory-900 border-ivory-500",
};

export default function Badge({ children, variant = "default", color, className = "" }: BadgeProps) {
  const classes = color ? colorClasses[color] : variantClasses[variant];
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${classes} ${className}`}
    >
      {children}
    </span>
  );
}
