"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Memoized agent markdown. Memoization is the anti-shake device: finished
 * turns never re-parse, and the streaming turn renders as plain text
 * (AiDock) until it completes, so long replies cannot jitter mid-stream.
 */
export const AiMarkdown = memo(function AiMarkdown({ content }: { content: string }) {
  return (
    <div className="space-y-1.5 text-xs leading-relaxed text-ivory-950">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" className="font-medium text-[#8A6A2F] underline" />,
          code: ({ className, ...props }) => (
            <code {...props} className={`rounded bg-[#F0EBE0] px-1 py-0.5 font-mono text-[11px] ${className ?? ""}`} />
          ),
          pre: ({ ...props }) => (
            <pre {...props} className="overflow-x-auto rounded-lg border border-[var(--color-line-soft)] bg-[#F5F1E8] p-2 font-mono text-[11px] leading-relaxed" />
          ),
          table: ({ ...props }) => (
            <div className="overflow-x-auto rounded-lg border border-[var(--color-line-soft)]">
              <table {...props} className="w-full border-collapse text-[11px]" />
            </div>
          ),
          th: ({ ...props }) => <th {...props} className="border-b border-[var(--color-line-soft)] bg-[#F5F1E8] px-2 py-1 text-left font-semibold" />,
          td: ({ ...props }) => <td {...props} className="border-b border-[var(--color-line-soft)] px-2 py-1 align-top" />,
          ul: ({ ...props }) => <ul {...props} className="list-disc space-y-0.5 pl-4" />,
          ol: ({ ...props }) => <ol {...props} className="list-decimal space-y-0.5 pl-4" />,
          p: ({ ...props }) => <p {...props} className="whitespace-pre-wrap" />,
          h1: ({ ...props }) => <p {...props} className="font-bold text-[13px]" />,
          h2: ({ ...props }) => <p {...props} className="font-bold text-[13px]" />,
          h3: ({ ...props }) => <p {...props} className="font-semibold text-xs" />,
          blockquote: ({ ...props }) => (
            <blockquote {...props} className="border-l-2 border-[#C9A86A] pl-2 text-ivory-700" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
