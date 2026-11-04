"use client";

/**
 * Command handler registry: feature tabs (ERD today, sequence/system next)
 * register the commands they can execute against live state. The inbox
 * dispatches bridge calls here; unknown commands fail closed.
 */

export type BridgeHandler = (args: Record<string, unknown>) => Promise<unknown>;

const handlers = new Map<string, BridgeHandler>();

export function registerBridgeHandler(kind: string, fn: BridgeHandler): void {
  handlers.set(kind, fn);
}

export function unregisterBridgeHandler(kind: string): void {
  handlers.delete(kind);
}

export function hasBridgeHandler(kind: string): boolean {
  return handlers.has(kind);
}

export function runBridgeHandler(kind: string, args: Record<string, unknown>): Promise<unknown> {
  const fn = handlers.get(kind);
  if (!fn) return Promise.reject(new Error(`Unknown bridge command: ${kind}`));
  return fn(args);
}

/** Test seam: snapshot registered kinds. */
export function registeredBridgeKinds(): string[] {
  return [...handlers.keys()];
}
