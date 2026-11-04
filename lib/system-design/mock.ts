"use client";

/**
 * Mock mode: per-operation canned responses with zero network. Runners
 * short-circuit on `operation.mock` - nothing leaves the browser, so
 * VPN/Zscaler-blocked or not-yet-ready systems still simulate. Bodies
 * travel with the project: never paste secrets into a mock.
 */

import type { OperationMock, SystemOperation } from "./model";

export const MOCK_MAX_LATENCY_MS = 30000;

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  422: "Unprocessable Entity",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

export function statusTextFor(status: number): string {
  return STATUS_TEXT[status] ?? "";
}

/** True when the operation serves its canned response instead of the network. */
export function isMocked(op: SystemOperation | null | undefined): boolean {
  return !!op?.mock;
}

export interface MockResult {
  status: number;
  statusText: string;
  /** Simulated latency, clamped to the validated range. */
  durationMs: number;
  bodyPreview: string;
}

/** Build the canned result for a mocked operation (no waiting here). */
export function buildMockResult(mock: OperationMock): MockResult {
  const latency = Number.isInteger(mock.latencyMs)
    ? Math.min(Math.max(mock.latencyMs, 0), MOCK_MAX_LATENCY_MS)
    : 0;
  return {
    status: mock.status,
    statusText: statusTextFor(mock.status),
    durationMs: latency,
    bodyPreview: mock.body,
  };
}

/** Honor the simulated latency. Runners await this before serving the mock. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(ms, MOCK_MAX_LATENCY_MS))));
}

export function defaultMock(): OperationMock {
  return { status: 200, body: '{\n  "mock": true\n}', latencyMs: 300 };
}
