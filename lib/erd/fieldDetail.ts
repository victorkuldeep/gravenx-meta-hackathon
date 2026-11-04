import type { ErdFieldRow } from "./graph";

/**
 * ERD field tooltip copy: one datatype line plus flag chips, mirroring the
 * Excel field-dictionary vocabulary (raw type + length + reference targets +
 * help text) so the box and the export never disagree.
 */

const cap = (t: string): string => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** "String · 255" / "Lookup → Account" / "Number · 18, 0" / "Picklist · 12 values". */
export function fieldTypeDetail(row: Pick<ErdFieldRow, "type" | "length" | "precision" | "scale" | "refs" | "refKind" | "pickValues">): string {
  const t = row.type;
  if (t === "id") return "ID";
  if (t === "reference") {
    const kind = row.refKind === "master-detail" ? "Master-Detail" : "Lookup";
    return row.refs.length > 0 ? `${kind} → ${row.refs.join(", ")}` : kind;
  }
  if (t === "picklist" || t === "multipicklist") {
    const n = row.pickValues.length;
    return `${cap(t)}${n > 0 ? ` · ${n} value${n === 1 ? "" : "s"}` : ""}`;
  }
  if ((t === "currency" || t === "double" || t === "percent" || t === "number") && row.precision > 0) {
    return `${cap(t)} · ${row.precision}, ${row.scale}`;
  }
  if (row.length > 0) return `${cap(t)} · ${row.length}`;
  return cap(t);
}

/** Small flag chips under the datatype: Required · Unique · External ID · Calculated · Read-only · Name field. */
export function fieldFlags(row: Pick<ErdFieldRow, "required" | "unique" | "externalId" | "calculated" | "updateable" | "isName">): string[] {
  const flags: string[] = [];
  if (row.required) flags.push("Required");
  if (row.unique) flags.push("Unique");
  if (row.externalId) flags.push("External ID");
  if (row.calculated) flags.push("Calculated");
  if (row.isName) flags.push("Name field");
  if (!row.updateable && !row.calculated) flags.push("Read-only");
  return flags;
}
