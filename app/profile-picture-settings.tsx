"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Avatar } from "./avatar";
import { SettingsModal } from "./settings-modal";
import { centeredCrop, cropSquare, type ProfileCrop } from "./profile-crop";

function validateProfilePicture(file: File) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    !file.size ||
    file.size > 2 * 1024 * 1024
  )
    throw new Error("Choose a PNG, JPEG or WebP image up to 2 MB.");
}
export async function prepareProfilePicture(
  file: File,
  crop: ProfileCrop = centeredCrop,
): Promise<Blob> {
  validateProfilePicture(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 16_000_000)
      throw new Error("Choose a picture smaller than 16 megapixels.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const box = cropSquare(image.naturalWidth, image.naturalHeight, crop);
    canvas
      .getContext("2d")!
      .drawImage(image, box.x, box.y, box.size, box.size, 0, 0, 256, 256);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Picture could not be prepared.")),
        "image/png",
      ),
    );
    if (png.size > 512 * 1024)
      throw new Error(
        "Picture could not be made small enough. Choose another image.",
      );
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ProfileCropEditor({
  file,
  busy,
  error,
  onSave,
  onClose,
  kind = "profile",
}: {
  file: File;
  busy: boolean;
  error: string;
  onSave: (crop: ProfileCrop) => void;
  onClose: () => void;
  kind?: "profile" | "server";
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null),
    [loadError, setLoadError] = useState("");
  const [crop, setCrop] = useState<ProfileCrop>(centeredCrop);
  const stage = useRef<HTMLCanvasElement>(null),
    preview = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let active = true;
    const url = URL.createObjectURL(file),
      next = new Image();
    next.src = url;
    void next
      .decode()
      .then(() => {
        if (!active) return;
        if (next.naturalWidth * next.naturalHeight > 16_000_000)
          setLoadError("Choose a picture smaller than 16 megapixels.");
        else setImage(next);
      })
      .catch(() => {
        if (active)
          setLoadError(
            "This picture could not be opened. Choose another image.",
          );
      });
    return () => {
      active = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);
  useLayoutEffect(() => {
    if (!image) return;
    const box = cropSquare(image.naturalWidth, image.naturalHeight, crop);
    for (const canvas of [stage.current, preview.current]) {
      const context = canvas?.getContext("2d");
      context?.clearRect(0, 0, 256, 256);
      context?.drawImage(
        image,
        box.x,
        box.y,
        box.size,
        box.size,
        0,
        0,
        256,
        256,
      );
    }
  }, [image, crop]);
  return (
    <SettingsModal
      title={`Crop ${kind} picture`}
      closeLabel="Close picture editor"
      className={`profileCropModal ${kind === "server" ? "serverPictureSettings" : ""}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>Drag the picture or use the controls to choose your crop.</p>
      <div className="profileCropPreviews">
        <canvas
          ref={stage}
          width="256"
          height="256"
          aria-label="Adjust picture crop"
          className="profileCropStage"
          onPointerDown={(event) => {
            if (!image || busy) return;
            drag.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current || !image || busy) return;
            const dx = event.clientX - drag.current.x,
              dy = event.clientY - drag.current.y;
            drag.current = { x: event.clientX, y: event.clientY };
            const width = event.currentTarget.getBoundingClientRect().width;
            setCrop((current) => {
              const box = cropSquare(
                image.naturalWidth,
                image.naturalHeight,
                current,
              );
              const position = (value: number, delta: number, span: number) =>
                span > 0
                  ? Math.max(
                      0,
                      Math.min(
                        100,
                        value - ((delta * box.size) / width / span) * 100,
                      ),
                    )
                  : 50;
              return {
                ...current,
                x: position(current.x, dx, image.naturalWidth - box.size),
                y: position(current.y, dy, image.naturalHeight - box.size),
              };
            });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        />
        <div className="profileCropResult">
          <canvas
            ref={preview}
            width="256"
            height="256"
            aria-label={`New ${kind} picture preview`}
          />
          <small>
            {kind === "server" ? "Server preview" : "Profile preview"}
          </small>
        </div>
      </div>
      {!image && !loadError && <small role="status">Loading picture…</small>}
      {(
        [
          ["zoom", "Zoom", 1, 3, 0.01],
          ["x", "Horizontal position", 0, 100, 1],
          ["y", "Vertical position", 0, 100, 1],
        ] as const
      ).map(([key, label, min, max, step]) => (
        <label className="profileCropControl" key={key}>
          {label}
          <input
            aria-label={label}
            type="range"
            min={min}
            max={max}
            step={step}
            value={crop[key]}
            disabled={!image || busy}
            onChange={(event) =>
              setCrop((current) => ({
                ...current,
                [key]: Number(event.target.value),
              }))
            }
          />
        </label>
      ))}
      {(loadError || error) && <small role="alert">{loadError || error}</small>}
      <div className="modalActions">
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={!image || busy}
          onClick={() => onSave(crop)}
        >
          {busy ? "Saving picture…" : "Save picture"}
        </button>
      </div>
    </SettingsModal>
  );
}

export function ProfilePictureSettings({
  image,
  onSaved,
  name = "You",
  endpoint = "/api/users/me/avatar",
  kind = "profile",
}: {
  image?: string | null;
  onSaved: (image: string | null) => Promise<void>;
  name?: string;
  endpoint?: string;
  kind?: "profile" | "server";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function save(file?: File, crop?: ProfileCrop) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = file ? await prepareProfilePicture(file, crop) : undefined;
      const response = await fetch(endpoint, {
        method: file ? "PUT" : "DELETE",
        ...(body ? { headers: { "Content-Type": "image/png" }, body } : {}),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error ?? "Profile picture could not be changed.",
        );
      await onSaved(result.image);
      setSelected(null);
      const label = kind === "server" ? "Server picture" : "Profile picture";
      setNotice(file ? `${label} changed.` : `${label} removed.`);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Profile picture could not be changed.",
      );
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div
      className={`profilePictureSettings ${kind === "server" ? "serverPictureSettings" : ""}`}
    >
      <h4>{kind === "server" ? "Server picture" : "Profile picture"}</h4>
      <div className="profilePictureRow">
        <Avatar name={name} image={image} showPlaceholder={kind === "server"} />
        <div className="profilePictureOptions">
          <div className="modalActions">
            <button
              type="button"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              Change picture
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy || !image}
              onClick={() => void save()}
            >
              Remove picture
            </button>
          </div>
          <small>PNG, JPEG or WebP · up to 2 MB</small>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp"
        aria-label={`Choose ${kind} picture`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          setError("");
          setNotice("");
          if (file) {
            try {
              validateProfilePicture(file);
              setSelected(file);
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Choose another picture.",
              );
            }
          }
          event.target.value = "";
        }}
      />
      {busy && <small role="status">Updating picture…</small>}
      {notice && <small role="status">{notice}</small>}
      {error && <small role="alert">{error}</small>}
      {selected && (
        <ProfileCropEditor
          kind={kind}
          file={selected}
          busy={busy}
          error={error}
          onSave={(crop) => void save(selected, crop)}
          onClose={() => {
            if (!busy) {
              setSelected(null);
              setError("");
            }
          }}
        />
      )}
    </div>
  );
}
