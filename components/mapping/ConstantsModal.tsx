"use client";

import { useState } from "react";
import Button from "../ui/Button";
import type { MappingRow } from "@/lib/mapping/types";

/**
 * Named constants manager: label + literal value pairs the architect
 * reuses wherever the source has no equivalent (e.g. "@type" always
 * ships "ProductOrder"). Guide leaves map onto these; Grid rows read
 * them from the Constant column. One list, both surfaces.
 */
export function ConstantsModal({
  constants,
  onSave,
  onRemove,
  onClose,
}: {
  constants: MappingRow[];
  onSave: (id: string | null, label: string, value: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");

  const startAdd = () => {
    setEditingId(null);
    setLabel("");
    setValue("");
  };

  const startEdit = (c: MappingRow) => {
    setEditingId(c.id);
    setLabel(c.notes ?? "");
    setValue(c.hardcodedValue === undefined ? "" : String(c.hardcodedValue));
  };

  const save = () => {
    if (!value.trim()) return;
    onSave(editingId, label, value);
    startAdd();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Manage constants">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-[#E8E2D8] bg-white shadow-xl">
        <div className="border-b border-[#F0EBE0] px-5 py-4">
          <p className="text-[15px] font-semibold text-[#27241F]">Constants · {constants.length}</p>
          <p className="mt-0.5 text-[12px] text-[#777168]">
            Hardcoded literals with a label - map any source leaf onto one from Guide, or type one straight into Grid.
          </p>
        </div>

        <div className="max-h-[40vh] space-y-1 overflow-y-auto px-3 py-3">
          {constants.length === 0 && (
            <p className="rounded-xl border border-dashed border-[#E8E2D8] px-3 py-5 text-center text-[12px] text-[#A39B8E]">
              No constants yet - name one below and it becomes mappable in Guide and Grid.
            </p>
          )}
          {constants.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-xl px-2.5 py-2 hover:bg-[#FAF8F2]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold text-[#27241F]">{c.notes ?? "Unlabelled"}</span>
                <span className="block truncate font-mono text-[11px] text-[#777168]">
                  {c.hardcodedValue === undefined ? "Null" : String(c.hardcodedValue)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => startEdit(c)}
                aria-label={`Edit constant ${c.notes ?? c.id}`}
                className="cursor-pointer rounded px-1.5 py-0.5 font-mono text-[11px] text-[#A98450] hover:bg-[#F5EEDF]"
              >
                edit
              </button>
              <button
                type="button"
                onClick={() => {
                  if (editingId === c.id) startAdd();
                  onRemove(c.id);
                }}
                aria-label={`Delete constant ${c.notes ?? c.id}`}
                title="Delete constant"
                className="cursor-pointer rounded px-1.5 py-0.5 font-mono text-[11px] text-[#A39B8E] hover:bg-[#F9E8E6] hover:text-[#B3261E]"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t border-[#F0EBE0] bg-[#FAF8F2] px-5 py-4">
          <p className="text-[12px] font-semibold text-[#27241F]">{editingId ? "Edit constant" : "New constant"}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] text-[#777168]">
              Label
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. PRODUCT ORDER"
                spellCheck={false}
                className="mt-1 w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none"
              />
            </label>
            <label className="block text-[11px] text-[#777168]">
              Value
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    save();
                  }
                }}
                placeholder="e.g. ProductOrder"
                spellCheck={false}
                className="mt-1 w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 font-mono text-[12px] focus:border-[#A98450] focus:outline-none"
              />
            </label>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[#A39B8E]">
              {editingId ? (
                <button type="button" onClick={startAdd} className="cursor-pointer underline hover:text-[#27241F]">
                  back to new
                </button>
              ) : (
                "Value ships verbatim - strings stay strings."
              )}
            </span>
            <span className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Done
              </Button>
              <Button onClick={save} disabled={!value.trim()}>
                {editingId ? "Save constant" : "Add constant"}
              </Button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
