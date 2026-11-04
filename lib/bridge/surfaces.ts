"use client";

/**
 * Command -> owning surface. The bridge dock is app-wide but handlers are
 * registered by feature tabs; when a call arrives while its tab is not
 * mounted, the inbox navigates there first instead of failing closed.
 * Add a line here when a new surface registers bridge commands.
 */

export function surfaceForCommand(command: string): "/" | "/system" | null {
  if (command.startsWith("sys.")) return "/system";
  if (command.startsWith("erd.") || command === "arch.activity") return "/";
  return null;
}

/** Human label for the navigation notice. */
export function surfaceLabel(path: "/" | "/system"): string {
  return path === "/system" ? "System Design" : "Schema (ERD)";
}
