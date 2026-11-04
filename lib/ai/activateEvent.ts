/**
 * Cross-tree activation link: the Arena gate's quick-connect lives outside
 * AiDock (which owns provider/model state), so after writing the vault +
 * endpoint stores it dispatches this window event and AiDock applies the
 * activation - the same state change Model Studio's onActivate performs.
 * Same-tab only; carries ids, never keys.
 */

export const AI_ACTIVATE_EVENT = "gravenx-ai-activate";

export interface AiActivateDetail {
  providerId: string;
  modelId: string;
}

export function dispatchAiActivate(providerId: string, modelId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AiActivateDetail>(AI_ACTIVATE_EVENT, { detail: { providerId, modelId } }));
}

export function subscribeAiActivate(handler: (detail: AiActivateDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<AiActivateDetail>).detail;
    if (detail && typeof detail.providerId === "string" && typeof detail.modelId === "string") handler(detail);
  };
  window.addEventListener(AI_ACTIVATE_EVENT, listener);
  return () => window.removeEventListener(AI_ACTIVATE_EVENT, listener);
}
