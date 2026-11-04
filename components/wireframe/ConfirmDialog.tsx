"use client";

import { ConfirmDialog } from "../ui/ConfirmDialog";

/**
 * Back-compat re-export: ConfirmDialog now lives in components/ui so every
 * tab shares one dialog. Kept so existing imports keep working.
 */
export { ConfirmDialog };
export default ConfirmDialog;
