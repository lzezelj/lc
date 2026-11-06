"use client";

import {
  useId,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { mentionQuery, type MentionMember } from "./mentions";
import { EmojiPicker } from "./emoji-picker";
import {
  attachmentAccept,
  attachmentMaxBytes,
  attachmentMaxCount,
  attachmentMaxTotalBytes,
} from "./attachment-types";

function PendingImage({ file }: { file: File }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (image.current) image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    // Local file preview; the temporary URL is released on removal or unmount.
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={image} className="pendingImage" alt={`Preview of ${file.name}`} />
  );
}

export function MessageComposer({
  value,
  onChange,
  files,
  onFiles,
  placeholder,
  disabled,
  busy,
  progress,
  children,
  editId,
  onCancelEdit,
  mentionMembers,
  onTyping,
}: {
  value: string;
  onChange: (text: string) => void;
  files: File[];
  onFiles: (files: File[]) => void;
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  progress: number | null;
  children?: ReactNode;
  editId?: string;
  onCancelEdit?: () => void;
  mentionMembers?: MentionMember[];
  onTyping?: (active: boolean) => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [caret, setCaret] = useState(0),
    [mentionIndex, setMentionIndex] = useState(0),
    [dismissed, setDismissed] = useState("");
  const mentionListId = useId();
  const token = mentionQuery(value, caret),
    mentionKey = `${value}:${caret}`;
  const candidates = token
    ? (mentionMembers ?? [])
        .filter(
          (member) =>
            member.name
              .toLocaleLowerCase()
              .startsWith(token.query.toLocaleLowerCase()) ||
            member.handle
              ?.toLocaleLowerCase()
              .startsWith(token.query.toLocaleLowerCase()),
        )
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const mentionOpen =
    !!candidates.length && !busy && !disabled && dismissed !== mentionKey;
  const selectedMention = mentionIndex % candidates.length || 0;
  useLayoutEffect(() => {
    if (mentionOpen)
      document
        .getElementById(`${mentionListId}-${selectedMention}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [mentionOpen, mentionListId, selectedMention]);
  function insertMention(member: MentionMember) {
    if (!token) return;
    const insertion = `@${member.handle || member.name} `,
      position = token.start + insertion.length;
    onChange(value.slice(0, token.start) + insertion + value.slice(token.end));
    onTyping?.(true);
    setCaret(position);
    setDismissed("");
    setMentionIndex(0);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(position, position);
    });
  }
  useLayoutEffect(() => {
    if (editId) {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(0, textarea.current.value.length);
    }
  }, [editId]);
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    const resize = () => {
      element.style.height = "0px";
      const style = getComputedStyle(element);
      const max =
        parseFloat(style.lineHeight) * 3 +
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom);
      element.style.height = `${Math.min(element.scrollHeight, max)}px`;
      element.style.overflowY = element.scrollHeight > max ? "auto" : "hidden";
    };
    resize();
    let width = element.clientWidth;
    const widthObserver = new ResizeObserver(() => {
      if (element.clientWidth !== width) {
        width = element.clientWidth;
        resize();
      }
    });
    widthObserver.observe(element);
    return () => widthObserver.disconnect();
  }, [value]);
  function addFiles(incoming: File[]) {
    if (disabled || busy || editId) return;
    if (files.length + incoming.length > attachmentMaxCount) {
      setError(`Attach up to ${attachmentMaxCount} files per message.`);
      return;
    }
    if (incoming.some((file) => !file.size || file.size > attachmentMaxBytes)) {
      setError("Each file must be between 1 byte and 10 MB.");
      return;
    }
    if (
      [...files, ...incoming].reduce((bytes, file) => bytes + file.size, 0) >
      attachmentMaxTotalBytes
    ) {
      setError("Attach up to 40 MB in total per message.");
      return;
    }
    if (
      incoming.some((file) => !attachmentAccept.split(",").includes(file.type))
    ) {
      setError("Choose PNG, JPEG, GIF, WebP or PDF files.");
      return;
    }
    setError("");
    onFiles([...files, ...incoming]);
  }
  return (
    <div
      className={`messageComposer ${dragging ? "attachmentDragging" : ""}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {children}
      {mentionOpen && (
        <div
          className="mentionSuggestions"
          role="listbox"
          id={mentionListId}
          aria-label="Mention a server member"
        >
          {candidates.map((member, index) => (
            <button
              key={member.id}
              type="button"
              role="option"
              aria-selected={index === selectedMention}
              id={`${mentionListId}-${index}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertMention(member)}
            >
              <span className="avatar">{member.name[0]?.toUpperCase()}</span>
              <span>
                <strong>{member.name}</strong>
                {member.handle && <small>@{member.handle}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
      {editId && (
        <div className="replyingTo editingMessage">
          <span>Editing message</span>
          <button
            type="button"
            aria-label="Cancel editing"
            disabled={busy}
            onClick={onCancelEdit}
          >
            ×
          </button>
        </div>
      )}
      {!!files.length && (
        <ul className="pendingAttachments">
          {files.map((file, index) => (
            <li key={index}>
              {file.type.startsWith("image/") && <PendingImage file={file} />}
              <span>{file.name}</span>
              <button
                type="button"
                disabled={busy}
                aria-label={`Remove ${file.name}`}
                onClick={() => onFiles(files.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="composerInputRow">
        <input
          ref={picker}
          type="file"
          hidden
          multiple
          accept={attachmentAccept}
          disabled={disabled || busy || !!editId}
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <button
          className="addAttachment"
          type="button"
          aria-label="Add attachment"
          title="Add images or PDFs (10 MB each)"
          disabled={disabled || busy || !!editId}
          onClick={() => picker.current?.click()}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9" />
            <path d="m7 14 7-7" />
          </svg>
        </button>
        <textarea
          ref={textarea}
          rows={1}
          value={value}
          onChange={(event) => {
            setCaret(event.target.selectionStart);
            setMentionIndex(0);
            setDismissed("");
            onChange(event.target.value);
            onTyping?.(!!event.target.value.trim());
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onBlur={() => onTyping?.(false)}
          role={mentionMembers ? "combobox" : undefined}
          aria-autocomplete={mentionMembers ? "list" : undefined}
          aria-expanded={mentionMembers ? mentionOpen : undefined}
          aria-controls={mentionOpen ? mentionListId : undefined}
          aria-activedescendant={
            mentionOpen ? `${mentionListId}-${selectedMention}` : undefined
          }
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={disabled || busy}
          maxLength={4000}
          onKeyDown={(event) => {
            if (mentionOpen && !event.nativeEvent.isComposing) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setMentionIndex(
                  (current) =>
                    (current +
                      (event.key === "ArrowDown" ? 1 : candidates.length - 1)) %
                    candidates.length,
                );
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                insertMention(candidates[selectedMention]);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setDismissed(mentionKey);
                return;
              }
            }
            if (event.key === "Escape" && editId && !busy) {
              event.preventDefault();
              onCancelEdit?.();
              return;
            }
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              onTyping?.(false);
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <EmojiPicker
          disabled={disabled || busy}
          onSelect={(emoji) => {
            const element = textarea.current;
            const start = element?.selectionStart ?? value.length,
              end = element?.selectionEnd ?? start;
            onChange(value.slice(0, start) + emoji + value.slice(end));
            onTyping?.(true);
            requestAnimationFrame(() => {
              element?.focus();
              element?.setSelectionRange(
                start + emoji.length,
                start + emoji.length,
              );
              setCaret(start + emoji.length);
            });
          }}
        />
      </div>
      {dragging && (
        <span className="composerHint">Drop images or PDFs here</span>
      )}
      {error && (
        <span className="composerHint" role="alert">
          {error}
        </span>
      )}
      {progress !== null && (
        <span className="composerHint" role="status">
          {progress < 100 ? `Uploading ${progress}%` : "Sending…"}
        </span>
      )}
    </div>
  );
}

export function sendMessageRequest(
  url: string,
  body: { text: string; replyToId?: string },
  files: File[],
  onProgress: (value: number) => void,
): Promise<Response> {
  if (!files.length)
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set("text", body.text);
    if (body.replyToId) form.set("replyToId", body.replyToId);
    files.forEach((file) => form.append("files", file));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = 120000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      resolve(
        new Response(xhr.responseText, {
          status: xhr.status,
          headers: {
            "Content-Type":
              xhr.getResponseHeader("Content-Type") ?? "application/json",
            "Retry-After": xhr.getResponseHeader("Retry-After") ?? "",
          },
        }),
      );
    xhr.onerror = () =>
      reject(
        new Error(
          "Upload failed. Your draft and attachments are still available.",
        ),
      );
    xhr.ontimeout = () =>
      reject(new Error("Upload timed out. Please try again."));
    onProgress(0);
    xhr.send(form);
  });
}
