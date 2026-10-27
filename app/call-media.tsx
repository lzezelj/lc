"use client";

import { createContext, useContext, useRef, type RefObject } from "react";

const CallAudioContext =
  createContext<RefObject<HTMLAudioElement | null> | null>(null);

export function CallMediaProvider({ children }: { children: React.ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  return (
    <CallAudioContext.Provider value={audio}>
      <audio ref={audio} autoPlay data-lc-call-audio="" />
      {children}
    </CallAudioContext.Provider>
  );
}

export function useCallAudio() {
  const audio = useContext(CallAudioContext);
  if (!audio) throw new Error("CallMediaProvider is missing");
  return audio;
}
