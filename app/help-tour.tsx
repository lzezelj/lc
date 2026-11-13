"use client";

import { useEffect, useRef, useState } from "react";
import { SettingsModal } from "./settings-modal";
import { HelpSpotlight, type HelpTarget } from "./help-spotlight";
import { HelpCallPreview } from "./help-call-preview";

const stepTargets: HelpTarget[] = [
  { selectors: [] },
  {
    selectors: [".workspaceLogo", ".friendSearchForm", ".friendsSidebar"],
    fallbacks: [".panelControls > button:first-child"],
    hint: "On a narrow screen, Show servers reveals the LZR button and server rail.",
  },
  {
    selectors: [
      ".serverScroller",
      ".channelSidebar:not(.friendsSidebar) > nav",
    ],
    fallbacks: [
      ".panelControls > button:first-child",
      ".panelControls > button:nth-child(2)",
    ],
    hint: "Use Show servers or Show channels to reveal these panels. Open a server to see its channels.",
  },
  {
    selectors: [".chatLog", ".chat form"],
    fallbacks: [
      ".friendSearchForm",
      ".channelSidebar:not(.friendsSidebar) > nav",
    ],
    hint: "Select a friend or a text channel to see its conversation and message box.",
  },
  {
    selectors: [
      ".profileBar .profileMicrophone",
      ".profileBar .profileDeafen",
      ".profileConnectionDetails",
      ".voiceChannel > button",
    ],
    fallbacks: [".panelControls > button:nth-child(2)"],
    hint: "Show channels reveals the voice channels and your microphone and deafen controls.",
  },
  {
    selectors: [".voiceDock", ".callMediaButtons"],
    hint: "These controls appear after joining a call. The example in the bottom-left corner shows their connected layout.",
  },
  {
    selectors: [".profileSettings", "[aria-label='Server settings']"],
    fallbacks: [".panelControls > button:nth-child(2)"],
    hint: "Show channels reveals your profile and server settings. Members can choose their own join sound; server management remains owner-only.",
  },
  {
    selectors: [".profileBar .profileMicrophone", ".profileSettings"],
    fallbacks: [".panelControls > button:nth-child(2)"],
    hint: "Show channels reveals your microphone options and profile settings.",
  },
  {
    selectors: [".chatLog", ".chat form"],
    fallbacks: [".friendSearchForm"],
    hint: "Open a conversation to attach files, or a server text channel to mention its members.",
  },
  {
    selectors: [".serverScroller", ".channelSidebar", ".profileSettings"],
    fallbacks: [".panelControls > button:nth-child(2)"],
    hint: "Show channels reveals unread indicators and your notification settings.",
  },
  { selectors: [".helpTrigger", ".appLegalLinks"] },
];

export const helpSteps = [
  {
    title: "Welcome to LZRelay",
    location: "Your workspace",
    text: "LZRelay brings server chats, direct messages and voice calls together. This short introduction shows where the main controls live. Use Next to continue, or Skip to leave the tour.",
  },
  {
    title: "Messages and friends",
    location: "LZR button → Messages",
    text: "Click LZR at the top of the server rail to open Messages. Message someone who shares a server with you, or continue an existing conversation. Friend requests are optional for messaging; calls require an accepted friendship.",
  },
  {
    title: "Servers and channels",
    location: "Server rail → channel sidebar",
    text: "Server bubbles on the left open your servers. Text channels hold conversations; voice channels let you talk. On smaller screens, use the Show/Hide panel buttons in the header to reveal the rail or channel list.",
  },
  {
    title: "Messages",
    location: "Conversation → message box",
    text: "Use the smiley beside Send to insert emojis. Right-click a message and hover over React (or tap it) to pick your one reaction; choosing another emoji replaces it. Click a reaction count to see everyone who reacted and use the × beside your own reaction to remove it. The menu also lets you reply, edit or delete your own message. Editing uses the message box; choose Edit to save or Escape to cancel. Search the conversation header to find older messages and attachments.",
  },
  {
    title: "Joining and controlling voice",
    location: "Voice channel or DM Call → bottom-left call controls",
    text: "Click a voice channel to join, or use Call in a direct conversation. The bottom-left panel shows your active call. Microphone toggles mute; headphones toggle deafen, which also silences incoming sound. The arrows beside device controls choose devices.",
  },
  {
    title: "Camera, screen sharing and sounds",
    location: "Active call controls",
    text: "The camera and Share screen controls enable video; their options choose quality. Soundboard opens above the call controls for server calls. Click a sound to play it for everyone, or its preview icon to hear it yourself. Soundboard and screen audio have separate volume controls. Server owners and moderators can add sounds; only owners can remove them.",
  },
  {
    title: "Settings and server management",
    location: "Your profile → cog · server name → cog",
    text: "The cog beside your profile opens account, privacy, microphone, output and camera settings. Do not disturb silences notification alerts. In server settings, choose your personal join sound from that server's soundboard. Joining publishes the clip through the soundboard so everyone in the channel hears it. Owners also manage channels, members, invitations and sounds; their join-sound choice is under Soundboard. Right-click menus expose additional actions when you have permission.",
  },
  {
    title: "Microphone processing",
    location: "Microphone arrow or User settings → Voice & video → Audio",
    text: "For the best starting point with headphones, choose RNNoise and turn Echo cancellation off. If speakers feed sound back into your microphone, turn echo cancellation on. Raw bypasses processing; Browser uses browser noise suppression. Test microphone plays back your processed voice, so use headphones. The transmission threshold defaults to −50 dB and applies only to Browser processing, including fallback when RNNoise is unavailable; Raw and active RNNoise do not use it. Avoid stacking RNNoise with noise removal in another app.",
  },
  {
    title: "Attachments and mentions",
    location: "Conversation → attachment button or @",
    text: "Use the attachment button beside the message box or drag files into it to send images and PDFs in channels and direct messages. Check image previews before sending. Click a sent image to preview it inside LZRelay, or use its download icon to save the file. In server chats, type @ to choose another member or type their handle to mention them.",
  },
  {
    title: "Unread messages and notifications",
    location: "Server/channel indicators · User settings → Notifications",
    text: "A dot marks unread server or channel messages; a numbered badge counts mentions. The New messages divider separates previously read history from new messages. User settings → Notifications has searchable Servers and People tabs with separate server message/mention and direct-message/call controls. Right-click a server or friend for mute options. User settings → My messages lets you find and manage your own messages across servers and people.",
  },
  {
    title: "You're ready",
    location: "Help, Licenses, Privacy and Impressum → workspace footer",
    text: "Choose Help & introduction in the workspace footer to reopen this guide. Licenses includes the full RNNoise and WebAssembly integration notices; legal documents open inside LZRelay without ending your call. Choose below whether this tour should appear automatically next time.",
  },
];

export function HelpIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 5 .2c0 1.7-2.5 2-2.5 3.8" />
      <circle cx="12" cy="16.5" r=".7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function HelpTour({
  userId,
  requestKey,
  onStepChange,
  profile,
}: {
  userId: string;
  requestKey: number;
  onStepChange?: (step: number | null) => void;
  profile?: { name: string; status: string; statusCode: string };
}) {
  const [phase, setPhase] = useState<"closed" | "tour" | "skipped">("closed");
  const [step, setStep] = useState(0);
  const [dontShow, setDontShow] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastRequest = useRef(requestKey);
  const stepChange = useRef(onStepChange);
  useEffect(() => {
    stepChange.current = onStepChange;
  });
  useEffect(() => {
    stepChange.current?.(phase === "tour" ? step : null);
  }, [phase, step]);
  useEffect(() => () => stepChange.current?.(null), []);
  const storageKey = `lc.help.dismissed:${userId}`;
  useEffect(() => {
    const manual = requestKey !== lastRequest.current;
    lastRequest.current = requestKey;
    let dismissed = false;
    let preference = true;
    try {
      const savedPreference = localStorage.getItem(storageKey);
      dismissed = savedPreference === "true";
      preference = savedPreference !== "false";
    } catch {}
    const timer = window.setTimeout(() => {
      setDontShow(preference);
      setStep(0);
      setPhase(manual || !dismissed ? "tour" : "closed");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey, requestKey]);
  useEffect(() => {
    if (phase !== "closed") heading.current?.focus();
  }, [phase, step]);
  function finish() {
    try {
      localStorage.setItem(storageKey, String(dontShow));
    } catch {}
    setPhase("closed");
  }
  if (phase === "closed") return null;
  const last = step === helpSteps.length - 1;
  const item = helpSteps[step];
  return (
    <SettingsModal
      title="LZRelay introduction"
      className="helpTour"
      movable
      layers={
        phase === "tour" && (
          <>
            <HelpSpotlight key={step} target={stepTargets[step]} />
            {step === 5 && <HelpCallPreview {...profile} />}
          </>
        )
      }
      closeLabel={phase === "tour" ? "Skip introduction" : "Close introduction"}
      onClose={() => (phase === "tour" ? setPhase("skipped") : finish())}
    >
      {phase === "tour" ? (
        <>
          <div className="helpProgress">
            <span>
              Step {step + 1} of {helpSteps.length}
            </span>
            <progress
              value={step + 1}
              max={helpSteps.length}
              aria-label="Introduction progress"
            />
          </div>
          <div className="helpStep" aria-live="polite">
            <h3 ref={heading} tabIndex={-1}>
              {item.title}
            </h3>
            <p className="helpLocation">{item.location}</p>
            <p>{item.text}</p>
          </div>
        </>
      ) : (
        <div className="helpStep">
          <h3 ref={heading} tabIndex={-1}>
            Skip the introduction?
          </h3>
          <p>
            You can reopen it anytime with Help & introduction in the workspace
            footer. Should LZRelay show it again next time?
          </p>
        </div>
      )}
      {(last || phase === "skipped") && (
        <label className="helpPreference">
          <input
            type="checkbox"
            checked={dontShow}
            onChange={(event) => setDontShow(event.target.checked)}
          />
          Do not show again
        </label>
      )}
      <div className="helpActions">
        {phase === "tour" ? (
          <>
            <button
              className="primary"
              type="button"
              onClick={() => (last ? finish() : setStep((value) => value + 1))}
            >
              {last ? "Finish" : "Next"}
            </button>
            <button type="button" onClick={() => setPhase("skipped")}>
              Skip
            </button>
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((value) => value - 1)}
              >
                Back
              </button>
            )}
          </>
        ) : (
          <>
            <button className="primary" type="button" onClick={finish}>
              Done
            </button>
            <button type="button" onClick={() => setPhase("tour")}>
              Continue tour
            </button>
          </>
        )}
      </div>
    </SettingsModal>
  );
}
