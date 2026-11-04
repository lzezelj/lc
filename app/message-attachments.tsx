"use client";

import type { MessageAttachment } from "./attachment-types";
import { useState } from "react";
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
}: {
  file: MessageAttachment;
  onClose: () => void;
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
        />
      </div>
      <div className="attachmentFileRow">
        <FileDetails file={file} />
        <DownloadAttachment file={file} />
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
  if (deleted || !files?.length) return null;
  const preview = files.find(
    (file) => file.id === previewId && file.type.startsWith("image/"),
  );
  return (
    <>
      <div className="messageAttachments">
        {files.map((file) => (
          <div key={file.id} className="messageAttachment">
            {file.type.startsWith("image/") && (
              <button
                type="button"
                className="attachmentThumbnail"
                aria-label={`Preview ${file.name}`}
                onClick={() => setPreviewId(file.id)}
              >
                {/* Authenticated original image; no public optimizer/cache URL. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/attachments/${file.id}`}
                  alt={file.name}
                  loading="lazy"
                />
              </button>
            )}
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
      {preview && (
        <ImagePreview
          key={preview.id}
          file={preview}
          onClose={() => setPreviewId(null)}
        />
      )}
    </>
  );
}
