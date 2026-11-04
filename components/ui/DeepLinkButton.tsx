"use client";

import { useState } from "react";
import Button from "./Button";
import { copyTextToClipboard, deepLinkFor } from "@/lib/deep/deep";

/**
 * Deep-link copy button: the parent route keeps ?param=value synced to the
 * open record, so the current URL is always the shareable link. Copies it
 * with a brief Copied confirmation; never navigates.
 */
export function DeepLinkButton({
  path,
  param,
  value,
  label = "Copy link",
}: {
  path: string;
  param: string;
  value: string | null;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <Button
      size="sm"
      variant="secondary"
      title="Copy a deep link to this exact record"
      onClick={() => {
        void (async () => {
          const ok = await copyTextToClipboard(deepLinkFor(path, param, value));
          if (ok) {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }
        })();
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
