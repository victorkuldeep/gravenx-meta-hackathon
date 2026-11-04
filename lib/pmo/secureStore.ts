/**
 * Encrypted PMO credential store: Jira + ServiceNow secrets the architect
 * opts into remembering. Honest crypto, stated plainly:
 *
 * - AES-GCM-256 via WebCrypto; the key-encryption key comes from PBKDF2
 *   (SHA-256, 210k rounds) over an architect-chosen passphrase + a stored salt.
 * - The KEK lives in module memory only and dies with the tab/reload.
 * - IndexedDB holds ciphertext + salt + non-secret metadata (site, login).
 *   Without the passphrase the rows are opaque - there is no backdoor, no
 *   recovery, no silent fallback.
 * - Skip the passphrase and nothing is persisted: session-only vaults keep
 *   working exactly as before. Remembering is always opt-in per system.
 */
import { STORES, withStore } from "@/lib/db";

export type PmoSystem = "jira" | "snow";

export interface SavedPmoCredential {
  /** Store key - one remembered login per system. */
  id: PmoSystem;
  system: PmoSystem;
  /** Non-secret routing metadata, shown in Setup even while locked. */
  site: string;
  login: string;
  cipher: string;
  iv: string;
  updatedAt: number;
}

const SALT_KEY = "gravenx-pmo-salt";
const PBKDF_ROUNDS = 210_000;

let kek: CryptoKey | null = null;

const te = new TextEncoder();
const td = new TextDecoder();

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Exact-copy bytes typed for WebCrypto (TS 5.9 BufferSource strictness). */
function bytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(data);
}

function getSalt(): Uint8Array<ArrayBuffer> {
  try {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(SALT_KEY) : null;
    if (saved) return unb64(saved);
  } catch {
    /* fresh salt below */
  }
  const salt = bytes(crypto.getRandomValues(new Uint8Array(16)));
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(SALT_KEY, b64(salt));
  } catch {
    /* memory-only salt: rows unreadable after reload - stated in UI */
  }
  return salt;
}

async function derive(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", bytes(te.encode(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF_ROUNDS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function isPmoUnlocked(): boolean {
  return kek !== null;
}

/** Wrong passphrase surfaces as an InvalidAccessError - callers report it plainly. */
export async function unlockPmo(passphrase: string): Promise<void> {
  kek = await derive(passphrase, getSalt());
}

export function lockPmo(): void {
  kek = null;
}

export async function savePmoSecret(system: PmoSystem, site: string, login: string, secret: string): Promise<void> {
  if (!kek) throw new Error("Unlock first - the key lives in memory only.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, bytes(te.encode(secret)));
  const row: SavedPmoCredential = { id: system, system, site, login, cipher: b64(cipher), iv: b64(iv), updatedAt: Date.now() };
  try {
    await withStore(STORES.pmoCredentials, "readwrite", (s) => s.put(row));
  } catch {
    throw new Error("Browser storage refused the write.");
  }
}

/** Metadata list - safe to show while locked, secrets stay sealed. */
export async function listPmoSaved(): Promise<SavedPmoCredential[]> {
  try {
    return await withStore<SavedPmoCredential[]>(STORES.pmoCredentials, "readonly", (s) => s.getAll());
  } catch {
    return [];
  }
}

export async function revealPmoSecret(system: PmoSystem): Promise<string> {
  if (!kek) throw new Error("Locked - enter the passphrase in Setup → Delivery.");
  const rows = await listPmoSaved();
  const row = rows.find((r) => r.system === system);
  if (!row) throw new Error("Nothing remembered for this system.");
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(row.iv) as BufferSource },
      kek,
      unb64(row.cipher)
    );
    return td.decode(plain);
  } catch {
    throw new Error("Wrong passphrase - the saved secret stayed sealed.");
  }
}

export async function forgetPmoSecret(system: PmoSystem): Promise<void> {
  try {
    await withStore(STORES.pmoCredentials, "readwrite", (s) => s.delete(system));
  } catch {
    throw new Error("Browser storage refused the delete - clear site data to be sure.");
  }
}
