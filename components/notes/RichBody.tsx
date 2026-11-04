"use client";

import { sanitizeDecisionHtml } from "@/lib/decisions/richtext";

/**
 * Read-only rich body: renders sanitized editor HTML with the same
 * typography as the editor (see .rich-body mark rules in globals.css).
 * Safe by construction - only allowlisted tags reach the DOM.
 */
export function RichBody({ html, compact }: { html: string; compact?: boolean }) {
  const clean = sanitizeDecisionHtml(html);
  if (!clean.trim()) return null;
  return (
    <div
      className={`rich-body leading-relaxed text-[#27241F] [&_h1]:mb-1 [&_h1]:mt-4 [&_h1]:font-bold [&_h1]:text-[#27241F] [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:font-bold [&_h2]:text-[#27241F] [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-[#C9A86A] [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-[#3A352D] [&_code]:rounded [&_code]:bg-[#F5F1E8] [&_code]:px-1 [&_code]:font-mono [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[#27241F] [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[#F5F1E8] [&_pre_code]:bg-transparent [&_pre_code]:p-0 ${
        compact ? "text-xs [&_h1]:text-[15px] [&_h2]:text-[13px] [&_h3]:text-xs [&_code]:text-[11px] [&_pre]:text-[11px]" : "text-[14px] [&_h1]:text-[19px] [&_h2]:text-[17px] [&_h3]:text-[15px] [&_code]:text-[13px] [&_pre]:text-[13px]"
      }`}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
