"use client";

/**
 * Log Decomposer library hero - same teaching-card shape as the other
 * studios: SVG story, title, one-line pitch, mono capability strip.
 */
export function LogDecomposerHero() {
  return (
    <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
      <svg
        width="430"
        height="150"
        viewBox="0 0 430 150"
        fill="none"
        aria-hidden="true"
        className="mx-auto mt-1 h-auto w-full max-w-[400px]"
      >
        {/* raw log */}
        <rect x="28" y="24" width="112" height="102" rx="10" fill="#FFFFFF" stroke="#9A7653" strokeWidth="1.5" />
        <line x1="42" y1="44" x2="126" y2="44" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
        <line x1="42" y1="58" x2="108" y2="58" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
        <line x1="42" y1="72" x2="126" y2="72" stroke="#722F37" strokeWidth="4" strokeLinecap="round" />
        <line x1="42" y1="86" x2="96" y2="86" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
        <line x1="42" y1="100" x2="118" y2="100" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
        <line x1="42" y1="114" x2="88" y2="114" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
        {/* log -> tree */}
        <line x1="140" y1="75" x2="172" y2="75" stroke="#C9A86A" strokeWidth="1.5" strokeDasharray="4 4" />
        {/* execution tree */}
        <circle cx="184" cy="75" r="9" fill="#27241F" />
        <line x1="192" y1="70" x2="212" y2="50" stroke="#9A7653" strokeWidth="1.5" />
        <line x1="192" y1="75" x2="212" y2="75" stroke="#9A7653" strokeWidth="1.5" />
        <line x1="192" y1="80" x2="212" y2="100" stroke="#9A7653" strokeWidth="1.5" />
        <circle cx="219" cy="45" r="7" fill="#FFFFFF" stroke="#27241F" strokeWidth="2" />
        <circle cx="219" cy="75" r="7" fill="#FFFFFF" stroke="#27241F" strokeWidth="2" />
        <circle cx="219" cy="105" r="7" fill="#722F37" />
        <line x1="226" y1="72" x2="244" y2="62" stroke="#9A7653" strokeWidth="1.5" />
        <line x1="226" y1="78" x2="244" y2="88" stroke="#9A7653" strokeWidth="1.5" />
        <circle cx="250" cy="59" r="6" fill="#FFFFFF" stroke="#27241F" strokeWidth="2" />
        <circle cx="250" cy="91" r="6" fill="#FFFFFF" stroke="#27241F" strokeWidth="2" />
        {/* tree -> verdict */}
        <line x1="258" y1="75" x2="292" y2="75" stroke="#C9A86A" strokeWidth="1.5" strokeDasharray="4 4" />
        <circle cx="312" cy="75" r="20" fill="#27241F" />
        <circle cx="312" cy="75" r="20" stroke="#C9A86A" strokeWidth="1.5" />
        <path d="M303 75 L309.5 81.5 L322 68" stroke="#C9A86A" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <text x="215" y="145" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fontWeight="700" fill="#A39B8E">
          CAPTURE · EXPLORE · DIAGNOSE · RCA
        </text>
      </svg>
      <h2 className="mt-1 text-center text-[15px] font-semibold text-[#27241F]">Log Decomposer</h2>
      <p className="mx-auto mt-1 max-w-xl text-center text-xs text-[#777168]">
        Turn Salesforce debug logs into an interactive execution model - capture the trace, walk the tree and
        timeline, prove the cause with evidence, and hand the brief to Jira or a coding agent.
      </p>
      <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
        Capture · Logs · Explore · Diagnose · RCA
      </p>
    </div>
  );
}
