"use client";

import { createContext, useContext, useRef, type RefObject } from "react";

const CallAudioContext =
  createContext<RefObject<HTMLAudioElement | null> | null>(null);
const ScreenAudioContext =
  createContext<RefObject<HTMLAudioElement | null> | null>(null);

export function CallMediaProvider({ children }: { children: React.ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  const screenAudio = useRef<HTMLAudioElement>(null);
  return (
    <CallAudioContext.Provider value={audio}>
      <ScreenAudioContext.Provider value={screenAudio}>
        <audio ref={audio} autoPlay data-lc-call-audio="" />
        <audio ref={screenAudio} autoPlay data-lc-screen-audio="" />
        {children}
      </ScreenAudioContext.Provider>
    </CallAudioContext.Provider>
  );
}

export function useScreenAudio() {
  const audio = useContext(ScreenAudioContext);
  if (!audio) throw new Error("CallMediaProvider is missing");
  return audio;
}

export function useCallAudio() {
  const audio = useContext(CallAudioContext);
  if (!audio) throw new Error("CallMediaProvider is missing");
  return audio;
}
