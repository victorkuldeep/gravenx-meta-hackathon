import type { ContractFieldMeta } from "./metadata-adapter";

/**
 * Synthetic request examples. Never real record data - safe to export.
 * Deterministic: same metadata always yields the same example.
 */

export function syntheticExample(meta: ContractFieldMeta): unknown {
  const t = (meta.sfType || "").toLowerCase();
  switch (t) {
    case "boolean":
      return true;
    case "int":
      return 1;
    case "double":
    case "currency":
    case "percent":
      return 100.5;
    case "date":
      return "2026-01-15";
    case "datetime":
      return "2026-01-15T10:00:00.000+0000";
    case "email":
      return "user@example.com";
    case "url":
      return "https://example.com";
    case "phone":
      return "+1-415-555-0100";
    case "id":
      return "001000000000000AAA";
    case "reference":
      return "001000000000000AAA";
    case "picklist":
    case "multipicklist": {
      const active = meta.picklistValues.filter((p) => p.active);
      if (active.length === 0) return "Sample";
      if (t === "multipicklist") return active.slice(0, 2).map((p) => p.value).join(";");
      return active[0].value;
    }
    case "textarea":
    case "longtextarea":
      return "Sample text";
    case "base64":
      return "U2FtcGxl";
    default:
      return "Sample";
  }
}
