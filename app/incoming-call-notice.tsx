"use client";
import { incomingCallLocation, type IncomingCall } from "./call-context";

export function IncomingCallNotice({
  call,
  status,
  conversationUserId,
  inline = false,
  onAnswer,
  onDecline,
}: {
  call: IncomingCall | null;
  status: string;
  conversationUserId?: string;
  inline?: boolean;
  onAnswer: () => void;
  onDecline: () => void;
}) {
  const location = incomingCallLocation(status, call, conversationUserId);
  if (!call || (inline ? location !== "conversation" : location !== "popup"))
    return null;
  return (
    <div
      className={inline ? "incomingCall incomingCallInline" : "incomingCall"}
      role={inline ? "status" : "dialog"}
      aria-live={inline ? "polite" : "assertive"}
    >
      <div>
        <small>Incoming call</small>
        <strong>{call.fromName}</strong>
      </div>
      <button type="button" className="danger" onClick={onDecline}>
        Decline
      </button>
      <button type="button" className="primary" onClick={onAnswer}>
        Answer
      </button>
    </div>
  );
}
