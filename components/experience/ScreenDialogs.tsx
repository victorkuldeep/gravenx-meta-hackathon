"use client";

import { useState } from "react";
import Button from "../ui/Button";
import {
  checkImageFile,
  decodeDimensions,
  deleteAssetRecord,
  hashBlob,
  makeThumbnail,
  saveAssetRecord,
} from "@/lib/experience/assets";
import type { Screen, ScreenAsset } from "@/lib/experience/types";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface PreparedImage {
  asset: ScreenAsset;
  blob: Blob;
  thumbnail: Blob;
}

async function prepareImage(
  projectId: string,
  screenId: string,
  file: File,
  now: string
): Promise<{ prepared?: PreparedImage; error?: string }> {
  const check = checkImageFile(file);
  if (!check.ok) return { error: check.error };
  let dims: { width: number; height: number };
  try {
    dims = await decodeDimensions(file);
  } catch {
    return { error: "That file could not be decoded as an image. Try re-exporting the screenshot." };
  }
  try {
    const thumbnail = await makeThumbnail(file, check.mime!);
    const hash = await hashBlob(file);
    const storageKey = `exp-${projectId}-${uid("img")}`;
    const thumbKey = `${storageKey}-thumb`;
    return {
      prepared: {
        asset: {
          id: uid("asset"),
          screenId,
          fileName: file.name,
          mimeType: check.mime!,
          byteSize: file.size,
          width: dims.width,
          height: dims.height,
          contentHash: hash,
          storageKey,
          thumbnailStorageKey: thumbKey,
          createdAt: now,
        },
        blob: file,
        thumbnail,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Thumbnail generation failed." };
  }
}

async function persistPrepared(projectId: string, prepared: PreparedImage): Promise<void> {
  await saveAssetRecord({
    id: prepared.asset.storageKey,
    projectId,
    assetId: prepared.asset.id,
    blob: prepared.blob,
    thumbnail: prepared.thumbnail,
  });
  await saveAssetRecord({
    id: prepared.asset.thumbnailStorageKey!,
    projectId,
    assetId: prepared.asset.id,
    blob: prepared.thumbnail,
  });
}

const inputCls =
  "w-full rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[13px] focus:border-[#A98450] focus:outline-none";

/** Add screen: name + optional PNG/WebP upload, paste, or placeholder. */
export function AddScreenDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (screen: Screen, asset: ScreenAsset | null) => void;
}) {
  const [name, setName] = useState("");
  const [route, setRoute] = useState("");
  const [feature, setFeature] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreparedImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const takeFile = async (file: File | undefined, screenId: string) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const { prepared, error: err } = await prepareImage(projectId, screenId, file, new Date().toISOString());
    setBusy(false);
    if (err || !prepared) {
      setError(err ?? "Could not read that image.");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreview(prepared);
    setPreviewUrl(URL.createObjectURL(prepared.blob));
  };

  // Stable draft screen id for asset association during creation.
  const [draftId] = useState(() => uid("screen"));

  const create = async (withImage: boolean) => {
    if (!name.trim()) {
      setError("Give the screen a name.");
      return;
    }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      let asset: ScreenAsset | null = null;
      if (withImage && preview) {
        await persistPrepared(projectId, preview);
        asset = preview.asset;
      }
      const screen: Screen = {
        id: draftId,
        name: name.trim(),
        route: route.trim() || undefined,
        feature: feature.trim() || undefined,
        journeyIds: [],
        canvas: {
          sourceWidth: asset?.width ?? 0,
          sourceHeight: asset?.height ?? 0,
          aspectRatio: asset ? asset.width / asset.height : 0,
        },
        componentIds: [],
        actionIds: [],
        bindingIds: [],
        status: "draft",
        tags: [],
        createdAt: now,
        updatedAt: now,
      };
      onCreated(screen, asset);
    } catch {
      setError("Saving the screenshot failed - browser storage may be unavailable.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-label="Add screen">
      <div className="w-full max-w-md rounded-2xl border border-[#E8E2D8] bg-white p-5">
        <p className="text-[14px] font-semibold text-[#27241F]">Add screen</p>
        <label className="mt-3 block text-[12px] font-semibold text-[#27241F]">
          Screen name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Order Details" className={`${inputCls} mt-1 font-normal`} />
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Route (optional)
            <input value={route} onChange={(e) => setRoute(e.target.value)} placeholder="/orders/:id" className={`${inputCls} mt-1 font-mono font-normal`} />
          </label>
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Feature (optional)
            <input value={feature} onChange={(e) => setFeature(e.target.value)} placeholder="Order management" className={`${inputCls} mt-1 font-normal`} />
          </label>
        </div>

        <div
          className="mt-3 rounded-xl border border-dashed border-[#D8CFC0] bg-[#FAF8F2] p-3 text-center"
          onPaste={(e) => {
            const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
            const file = item?.getAsFile();
            if (file) {
              e.preventDefault();
              void takeFile(file, draftId);
            }
          }}
          tabIndex={0}
          aria-label="Screenshot drop zone - paste an image here"
        >
          {preview && previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Screenshot preview" className="mx-auto max-h-40 rounded-lg border border-[#E8E2D8]" />
          ) : (
            <p className="text-[12px] text-[#777168]">
              Drop a PNG/WebP here, paste a screenshot, or{" "}
              <label className="cursor-pointer font-semibold text-[#A98450] hover:underline">
                browse files
                <input
                  type="file"
                  accept="image/png,image/webp,.png,.webp"
                  className="hidden"
                  onChange={(e) => {
                    void takeFile(e.target.files?.[0], draftId);
                    e.target.value = "";
                  }}
                />
              </label>
            </p>
          )}
          {preview && (
            <p className="mt-1 font-mono text-[10px] text-[#A39B8E]">
              {preview.asset.width}×{preview.asset.height} · {(preview.asset.byteSize / 1024).toFixed(0)} KB
            </p>
          )}
        </div>

        {busy && <p className="mt-2 text-[12px] text-[#A39B8E]">Processing screenshot…</p>}
        {error && (
          <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <span className="flex gap-2">
            <Button variant="ghost" disabled={busy || !name.trim()} onClick={() => void create(false)}>
              Create without image
            </Button>
            <Button disabled={busy || !name.trim() || !preview} onClick={() => void create(true)}>
              Create screen
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Replace a screen's image, preserving the screen id. */
export function ReplaceImage({
  projectId,
  screen,
  oldAsset,
  onDone,
  onCancel,
}: {
  projectId: string;
  screen: Screen;
  oldAsset: ScreenAsset;
  onDone: (next: ScreenAsset) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const takeFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const now = new Date().toISOString();
    const { prepared, error: err } = await prepareImage(projectId, screen.id, file, now);
    if (err || !prepared) {
      setBusy(false);
      setError(err ?? "Could not read that image.");
      return;
    }
    try {
      // Reuse storage keys so no orphan blobs accumulate.
      await saveAssetRecord({ id: oldAsset.storageKey, projectId, assetId: oldAsset.id, blob: prepared.blob, thumbnail: prepared.thumbnail });
      if (oldAsset.thumbnailStorageKey) {
        await saveAssetRecord({ id: oldAsset.thumbnailStorageKey, projectId, assetId: oldAsset.id, blob: prepared.thumbnail });
      }
      onDone({ ...oldAsset, ...prepared.asset, id: oldAsset.id, storageKey: oldAsset.storageKey, thumbnailStorageKey: oldAsset.thumbnailStorageKey });
    } catch {
      setError("Saving the replacement failed - browser storage may be unavailable.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-xl border border-[#E8E2D8] bg-[#FAF8F2] p-3">
      <label className="cursor-pointer text-[12px] font-semibold text-[#A98450] hover:underline">
        {busy ? "Processing…" : "Choose replacement PNG/WebP…"}
        <input
          type="file"
          accept="image/png,image/webp,.png,.webp"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            void takeFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      <button type="button" onClick={onCancel} className="ml-3 text-[12px] text-[#777168] hover:underline cursor-pointer">
        Cancel
      </button>
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** Edit screen metadata (name, route, feature, role, device, status). */
export function EditScreenDialog({
  screen,
  onClose,
  onSave,
}: {
  screen: Screen;
  onClose: () => void;
  onSave: (patch: Partial<Screen>) => void;
}) {
  const [name, setName] = useState(screen.name);
  const [route, setRoute] = useState(screen.route ?? "");
  const [feature, setFeature] = useState(screen.feature ?? "");
  const [userRole, setUserRole] = useState(screen.userRole ?? "");
  const [device, setDevice] = useState<NonNullable<Screen["deviceContext"]>>(screen.deviceContext ?? "desktop");
  const [status, setStatus] = useState(screen.status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-label="Edit screen">
      <div className="w-full max-w-md rounded-2xl border border-[#E8E2D8] bg-white p-5">
        <p className="text-[14px] font-semibold text-[#27241F]">Edit screen</p>
        <label className="mt-3 block text-[12px] font-semibold text-[#27241F]">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} mt-1 font-normal`} />
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Route
            <input value={route} onChange={(e) => setRoute(e.target.value)} className={`${inputCls} mt-1 font-mono font-normal`} />
          </label>
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Feature
            <input value={feature} onChange={(e) => setFeature(e.target.value)} className={`${inputCls} mt-1 font-normal`} />
          </label>
          <label className="block text-[12px] font-semibold text-[#27241F]">
            User role
            <input value={userRole} onChange={(e) => setUserRole(e.target.value)} placeholder="Sales rep" className={`${inputCls} mt-1 font-normal`} />
          </label>
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Device
            <select value={device} onChange={(e) => setDevice(e.target.value as "desktop" | "tablet" | "mobile" | "responsive")} className={`${inputCls} mt-1 font-normal cursor-pointer`}>
              <option value="desktop">desktop</option>
              <option value="tablet">tablet</option>
              <option value="mobile">mobile</option>
              <option value="responsive">responsive</option>
            </select>
          </label>
        </div>
        <label className="mt-2 block text-[12px] font-semibold text-[#27241F]">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as Screen["status"])} className={`${inputCls} mt-1 font-normal cursor-pointer`}>
            <option value="draft">draft</option>
            <option value="in-review">in-review</option>
            <option value="confirmed">confirmed</option>
            <option value="changed">changed</option>
            <option value="archived">archived</option>
          </select>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() =>
              onSave({
                name: name.trim(),
                route: route.trim() || undefined,
                feature: feature.trim() || undefined,
                userRole: userRole.trim() || undefined,
                deviceContext: device,
                status,
              })
            }
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

export { deleteAssetRecord };
