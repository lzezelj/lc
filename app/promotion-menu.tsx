"use client";
import { useId, useRef } from "react";
import { InformationHint } from "./information-hint";

export function PromotionMenu({
  name,
  disabled,
  moderatorDisabled,
  ownerDisabled,
  canDemote,
  onSelect,
}: {
  name: string;
  disabled: boolean;
  moderatorDisabled: boolean;
  ownerDisabled: boolean;
  canDemote: boolean;
  onSelect: (role: "mod" | "owner" | "member") => void;
}) {
  const id = useId(),
    panel = useRef<HTMLDivElement>(null);
  function choose(role: "mod" | "owner" | "member") {
    panel.current?.hidePopover();
    onSelect(role);
  }
  return (
    <>
      <button
        type="button"
        className="promotionTrigger"
        disabled={disabled}
        popoverTarget={id}
        aria-label={`Promote ${name}`}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          if (panel.current) {
            panel.current.style.left = `${Math.max(8, Math.min(box.left, innerWidth - 248))}px`;
            panel.current.style.top = `${Math.max(8, Math.min(box.bottom + 6, innerHeight - 180))}px`;
          }
        }}
      >
        Promote{" "}
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div
        id={id}
        ref={panel}
        popover="auto"
        className="promotionMenu"
        aria-label={`Promotion options for ${name}`}
      >
        <div className="promotionOption">
          <button
            type="button"
            disabled={moderatorDisabled}
            onClick={() => choose("mod")}
          >
            Moderator
          </button>
          <InformationHint text="Moderators help manage this server without becoming its owner." />
        </div>
        <div className="promotionOption">
          <button
            type="button"
            disabled={ownerDisabled}
            onClick={() => choose("owner")}
          >
            Owner
          </button>
          <InformationHint text="Transfers server ownership. You become a regular member and lose owner controls. Confirmation is required." />
        </div>
        {canDemote && (
          <button type="button" onClick={() => choose("member")}>
            Demote to member
          </button>
        )}
      </div>
    </>
  );
}
