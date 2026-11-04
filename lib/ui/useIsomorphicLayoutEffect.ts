import { useEffect, useLayoutEffect } from "react";

/**
 * Layout effect on the client (runs before paint, so persisted UI positions
 * apply with no flash), passive effect on the server (no SSR warning).
 * Use for client-only reads (localStorage positions) that must not leak
 * into the server render - SSR/first client render stay identical.
 */
export const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
