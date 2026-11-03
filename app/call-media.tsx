"use client";

import { createContext, useContext, useRef, type RefObject } from "react";

const CallAudioContext =
  createContext<RefObject<HTMLAudioElement | null> | null>(null);
const ScreenAudioContext =
  createContext<RefObject<HTMLAudioElement | null> | null>(null);
const SoundboardAudioContext =
  createContext<RefObject<HTMLAudioElement | null> | null>(null);

export function CallMediaProvider({ children }: { children: React.ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  const screenAudio = useRef<HTMLAudioElement>(null);
  const soundboardAudio = useRef<HTMLAudioElement>(null);
  return (
    <CallAudioContext.Provider value={audio}>
      <ScreenAudioContext.Provider value={screenAudio}>
        <SoundboardAudioContext.Provider value={soundboardAudio}>
          <audio ref={audio} autoPlay data-lc-call-audio="" />
          <audio ref={screenAudio} autoPlay data-lc-screen-audio="" />
          <audio ref={soundboardAudio} autoPlay data-lc-soundboard-audio="" />
          {children}
        </SoundboardAudioContext.Provider>
      </ScreenAudioContext.Provider>
    </CallAudioContext.Provider>
  );
}

export function useSoundboardAudio() {
  const audio = useContext(SoundboardAudioContext);
  if (!audio) throw new Error("CallMediaProvider is missing");
  return audio;
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
