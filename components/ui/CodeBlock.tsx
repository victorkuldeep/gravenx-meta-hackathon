"use client";

import { useState } from "react";

interface CodeBlockProps {
  code: string;
  language?: string;
  maxHeight?: string;
}

export default function CodeBlock({ code, language = "json", maxHeight = "400px" }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard API may not be available */
    }
  };

  return (
    <div className="relative rounded border border-ivory-400" style={{ backgroundColor: "#1A1710" }}>
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b"
        style={{ backgroundColor: "#211E14", borderColor: "#2E2A1E" }}
      >
        <span className="text-xs font-mono" style={{ color: "#8A8070" }}>{language}</span>
        <button
          onClick={handleCopy}
          className="rounded px-2 py-1 text-xs transition-colors"
          style={{ color: copied ? "#54440C" : "#8A8070" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#2E2A1E"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
          aria-label="Copy code"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre
        className="overflow-auto p-4 text-sm font-mono leading-relaxed"
        style={{ maxHeight, color: "#ECE8DF" }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
