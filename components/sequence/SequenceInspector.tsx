"use client";

import Button from "../ui/Button";
import { ImpactSection } from "../graph/ImpactSection";
import type { MessageKind, Participant, SeqBlock, SeqMessage, SeqNode } from "@/lib/sequence/model";

const inputCls =
  "w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-xs text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none";
const labelCls = "mb-1 block font-mono text-[10px] uppercase tracking-[1.5px] text-[#A39B8E]";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[#EFE9DC] px-3 py-2.5 last:border-0">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[1px] text-[#27241F]">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

/**
 * Node inspector (EPIC 04): click a message or block in the diagram and
 * edit it here. Every change reprints the DSL, so text and diagram never
 * drift - the editor is the same model either way.
 */
export function SequenceInspector({
  node,
  participants,
  onPatch,
  onDelete,
  onClose,
}: {
  node: SeqNode;
  participants: Participant[];
  onPatch: (next: SeqNode) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden rounded-xl border border-[#E8E2D8] bg-white" style={{ maxHeight: 640 }} aria-label="Sequence inspector">
      <div className="flex items-center justify-between gap-2 border-b border-[#EFE9DC] px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-[#27241F]">
          {node.nodeType === "message" ? "Message" : `${node.type[0].toUpperCase()}${node.type.slice(1)} block`}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="rounded p-1 text-[#A39B8E] cursor-pointer hover:bg-[#F5F1E8] hover:text-[#27241F]"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {node.nodeType === "message" ? (
          <MessageForm node={node} participants={participants} onPatch={onPatch} />
        ) : (
          <BlockForm node={node} onPatch={onPatch} />
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-[#EFE9DC] px-3 py-2">
        <span className="flex-1 font-mono text-[10px] text-[#A39B8E]">{node.id}</span>
        <Button size="sm" variant="ghost" onClick={onDelete} title="Delete node">
          Delete
        </Button>
      </div>
    </aside>
  );
}

function MessageForm({ node: m, participants, onPatch }: { node: SeqMessage; participants: Participant[]; onPatch: (n: SeqNode) => void }) {
  const set = (patch: Partial<SeqMessage>) => onPatch({ ...m, ...patch });
  return (
    <>
      <Section title="Message">
        <div>
          <label className={labelCls} htmlFor="seq-label">Label</label>
          <input
            id="seq-label" value={m.label}
            onChange={(e) => set({ label: e.target.value.slice(0, 200) })}
            spellCheck={false} className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="seq-kind">Kind</label>
          <select
            id="seq-kind" value={m.kind}
            onChange={(e) => set({ kind: e.target.value as MessageKind })}
            className={`${inputCls} cursor-pointer`}
          >
            <option value="sync">→ sync call</option>
            <option value="response">⇢ response</option>
            <option value="async">↠ async / event</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className={labelCls} htmlFor="seq-from">From</label>
            <select
              id="seq-from" value={m.from}
              onChange={(e) => set({ from: e.target.value })}
              className={`${inputCls} cursor-pointer`}
            >
              {participants.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="seq-to">To</label>
            <select
              id="seq-to" value={m.to}
              onChange={(e) => set({ to: e.target.value })}
              className={`${inputCls} cursor-pointer`}
            >
              {participants.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
      </Section>
      <Section title="Policy">
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className={labelCls} htmlFor="seq-retry">Retries</label>
            <input
              id="seq-retry" type="number" min={0} max={100}
              value={m.retry?.attempts ?? ""}
              placeholder="—"
              onChange={(e) => {
                const v = e.target.value === "" ? undefined : Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 0));
                set({ retry: v === undefined ? undefined : { ...(m.retry ?? { attempts: 3 }), attempts: v } });
              }}
              className={`${inputCls} font-mono text-[11px]`}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="seq-timeout">Timeout (s)</label>
            <input
              id="seq-timeout" type="number" min={0} max={86400}
              value={m.timeoutSecs ?? ""}
              placeholder="—"
              onChange={(e) => set({ timeoutSecs: e.target.value === "" ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0) })}
              className={`${inputCls} font-mono text-[11px]`}
            />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="seq-note">Note</label>
          <input
            id="seq-note" value={m.note ?? ""}
            onChange={(e) => set({ note: e.target.value.slice(0, 500) || undefined })}
            placeholder="e.g. idempotent on orderId"
            spellCheck={false} className={inputCls}
          />
        </div>
      </Section>
      <Section title="Operation">
        <div>
          <label className={labelCls} htmlFor="seq-opref">Operation ref</label>
          <input
            id="seq-opref" value={m.operationRef ?? ""}
            onChange={(e) => set({ operationRef: e.target.value.slice(0, 200) || undefined })}
            placeholder="e.g. POST /orders"
            spellCheck={false} className={`${inputCls} font-mono text-[11px]`}
          />
        </div>
        {m.operationRef && (
          <ImpactSection
            key={m.operationRef}
            query={{ surface: "system", text: m.operationRef }}
            caption={m.operationRef}
          />
        )}
      </Section>
    </>
  );
}

function BlockForm({ node: b, onPatch }: { node: SeqBlock; onPatch: (n: SeqNode) => void }) {
  const set = (patch: Partial<SeqBlock>) => onPatch({ ...b, ...patch });
  return (
    <Section title="Block">
      {b.type === "loop" && (
        <div>
          <label className={labelCls} htmlFor="seq-iter">Iterate each</label>
          <input
            id="seq-iter" value={b.iterator ?? ""}
            onChange={(e) => set({ iterator: e.target.value.slice(0, 200) || undefined })}
            placeholder="order.lines"
            spellCheck={false} className={`${inputCls} font-mono text-[11px]`}
          />
        </div>
      )}
      {b.type === "condition" && (
        <>
          <div>
            <label className={labelCls} htmlFor="seq-cond">If</label>
            <input
              id="seq-cond" value={b.condition ?? ""}
              onChange={(e) => set({ condition: e.target.value.slice(0, 200) || undefined })}
              placeholder="Serviceable"
              spellCheck={false} className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="seq-else">Else label</label>
            <input
              id="seq-else" value={b.elseLabel ?? ""}
              onChange={(e) => set({ elseLabel: e.target.value.slice(0, 200) || undefined })}
              placeholder="Otherwise"
              spellCheck={false} className={inputCls}
            />
          </div>
        </>
      )}
      {b.type === "retry" && (
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className={labelCls} htmlFor="seq-att">Attempts</label>
            <input
              id="seq-att" type="number" min={1} max={100}
              value={b.attempts ?? 3}
              onChange={(e) => set({ attempts: Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
              className={`${inputCls} font-mono text-[11px]`}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="seq-wait">Wait (s)</label>
            <input
              id="seq-wait" type="number" min={0} max={86400}
              value={b.waitSecs ?? ""}
              placeholder="—"
              onChange={(e) => set({ waitSecs: e.target.value === "" ? undefined : Math.max(0, parseFloat(e.target.value) || 0) })}
              className={`${inputCls} font-mono text-[11px]`}
            />
          </div>
        </div>
      )}
      {b.type !== "note" && b.type !== "condition" && (
        <div>
          <label className={labelCls} htmlFor="seq-btitle">Title</label>
          <input
            id="seq-btitle" value={b.title}
            onChange={(e) => set({ title: e.target.value.slice(0, 200) })}
            spellCheck={false} className={inputCls}
          />
        </div>
      )}
      {b.type === "note" && (
        <div>
          <label className={labelCls} htmlFor="seq-ntext">Text</label>
          <input
            id="seq-ntext" value={b.title}
            onChange={(e) => set({ title: e.target.value.slice(0, 200) })}
            spellCheck={false} className={inputCls}
          />
        </div>
      )}
    </Section>
  );
}
