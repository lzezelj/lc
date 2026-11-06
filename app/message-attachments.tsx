"use client";

import type { MessageAttachment } from "./attachment-types";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SettingsModal } from "./settings-modal";

function DownloadAttachment({ file }: { file: MessageAttachment }) {
  return (
    <a
      className="attachmentDownload"
      href={`/api/attachments/${file.id}?download=1`}
      download={file.name}
      aria-label={`Download ${file.name}`}
      title="Download file"
    >
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </svg>
    </a>
  );
}

function FileDetails({ file }: { file: MessageAttachment }) {
  const size =
    file.size < 1024 * 1024
      ? `${Math.max(1, Math.round(file.size / 1024))} KB`
      : `${(file.size / 1024 / 1024).toFixed(1)} MB`;
  return (
    <div className="attachmentDetails">
      <strong title={file.name}>{file.name}</strong>
      <span>
        {file.type === "application/pdf" ? "PDF document" : "Image"} · {size}
      </span>
    </div>
  );
}

function ImagePreview({
  file,
  onClose,
  onDownloadMenu,
}: {
  file: MessageAttachment;
  onClose: () => void;
  onDownloadMenu: (event: React.MouseEvent, file: MessageAttachment) => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  return (
    <SettingsModal
      title="Image preview"
      className="attachmentPreviewModal"
      closeLabel="Close image preview"
      onClose={onClose}
    >
      <div className="attachmentPreviewStage" aria-busy={state === "loading"}>
        {state !== "ready" && (
          <p role={state === "error" ? "alert" : "status"}>
            {state === "error"
              ? "This image could not be loaded. It may have been deleted or access may have changed."
              : "Loading image…"}
          </p>
        )}
        {/* Authenticated original image; no public optimizer/cache URL. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/attachments/${file.id}`}
          alt={file.name}
          hidden={state !== "ready"}
          onLoad={() => setState("ready")}
          onError={() => setState("error")}
          onContextMenu={(event) => onDownloadMenu(event, file)}
        />
      </div>
    </SettingsModal>
  );
}

export function MessageAttachments({
  files,
  deleted,
}: {
  files?: MessageAttachment[];
  deleted?: boolean;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [gallery, setGallery] = useState(false);
  const [capacity, setCapacity] = useState(1);
  const [downloadMenu, setDownloadMenu] = useState<{
    file: MessageAttachment;
    x: number;
    y: number;
    parent: HTMLElement;
  } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!downloadMenu) return;
    menu.current
      ?.querySelector<HTMLAnchorElement>("a")
      ?.focus({ preventScroll: true });
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof KeyboardEvent) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (
        event.type === "pointerdown" &&
        menu.current?.contains(event.target as Node)
      )
        return;
      setDownloadMenu(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [downloadMenu]);
  const row = useRef<HTMLDivElement>(null);
  const images = files?.filter((file) => file.type.startsWith("image/")) ?? [];
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () =>
      setCapacity(
        Math.min(3, Math.max(1, Math.floor((element.clientWidth + 8) / 128))),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [deleted, images.length]);
  if (deleted || !files?.length) return null;
  const preview = files.find(
    (file) => file.id === previewId && file.type.startsWith("image/"),
  );
  const visible =
    images.length > Math.min(2, capacity)
      ? Math.min(2, Math.max(0, capacity - 1))
      : images.length;
  function openDownloadMenu(event: React.MouseEvent, file: MessageAttachment) {
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget as HTMLElement;
    setDownloadMenu({
      file,
      x: Math.max(8, Math.min(event.clientX, innerWidth - 188)),
      y: Math.max(8, Math.min(event.clientY, innerHeight - 64)),
      parent: element.closest<HTMLElement>("dialog") ?? document.body,
    });
  }
  function thumbnail(file: MessageAttachment, overflow = 0) {
    return (
      <button
        type="button"
        key={file.id}
        className={`attachmentThumbnail ${overflow ? "attachmentOverflow" : ""}`}
        aria-label={
          overflow
            ? `View all ${images.length} pictures (${overflow} more)`
            : `Preview ${file.name}`
        }
        onClick={() => (overflow ? setGallery(true) : setPreviewId(file.id))}
        onContextMenu={(event) => {
          if (overflow) {
            event.preventDefault();
            event.stopPropagation();
            setDownloadMenu(null);
          } else openDownloadMenu(event, file);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/attachments/${file.id}`}
          alt={file.name}
          loading="lazy"
        />
        {overflow > 0 && <span>+{overflow}</span>}
      </button>
    );
  }
  return (
    <>
      <div className="messageAttachments">
        {images.length > 0 && (
          <div className="attachmentImageRow" ref={row}>
            {images.slice(0, visible).map((file) => thumbnail(file))}
            {visible < images.length &&
              thumbnail(images[visible], images.length - visible)}
          </div>
        )}
        {files
          .filter((file) => !file.type.startsWith("image/"))
          .map((file) => (
            <div key={file.id} className="messageAttachment">
              <div className="attachmentFileRow">
                <span className="attachmentFileIcon" aria-hidden="true">
                  <svg
                    width="21"
                    height="21"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14 2H5v20h14V7zM14 2v6h5M8 13h8M8 17h5" />
                  </svg>
                </span>
                <FileDetails file={file} />
                <DownloadAttachment file={file} />
              </div>
            </div>
          ))}
      </div>
      {gallery && (
        <SettingsModal
          title="Pictures"
          closeLabel="Close pictures"
          className="attachmentGalleryModal"
          onClose={() => setGallery(false)}
        >
          <div className="attachmentGalleryViewport">
            <div className="attachmentGalleryGrid">
              {images.map((file) => thumbnail(file))}
            </div>
          </div>
        </SettingsModal>
      )}
      {preview && (
        <ImagePreview
          key={preview.id}
          file={preview}
          onClose={() => setPreviewId(null)}
          onDownloadMenu={openDownloadMenu}
        />
      )}
      {downloadMenu &&
        createPortal(
          <div
            ref={menu}
            className="messageContextMenu imageDownloadMenu"
            role="menu"
            aria-label="Picture actions"
            style={{ left: downloadMenu.x, top: downloadMenu.y }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <a
              role="menuitem"
              href={`/api/attachments/${downloadMenu.file.id}?download=1`}
              download={downloadMenu.file.name}
              onClick={() => setDownloadMenu(null)}
            >
              Download picture
            </a>
          </div>,
          downloadMenu.parent,
        )}
    </>
  );
}
