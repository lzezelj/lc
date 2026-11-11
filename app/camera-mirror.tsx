"use client";
import { useEffect, useState } from "react";

export function readMirror() {
  try {
    return localStorage.getItem("lc.cameraMirror") === "true";
  } catch {
    return false;
  }
}
export function useCameraMirror() {
  const [mirrored, setMirrored] = useState(readMirror);
  useEffect(() => {
    const update = () => setMirrored(readMirror());
    window.addEventListener("lc-camera-mirror", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("lc-camera-mirror", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return mirrored;
}
export function CameraMirrorControl() {
  const mirrored = useCameraMirror();
  return (
    <div className="deviceSelection deviceToggleSettings">
      <button
        className="cameraMirrorControl"
        type="button"
        aria-pressed={mirrored}
        onClick={() => {
          try {
            localStorage.setItem("lc.cameraMirror", String(!mirrored));
          } catch {}
          window.dispatchEvent(new Event("lc-camera-mirror"));
        }}
      >
        Mirror camera: {mirrored ? "On" : "Off"}
      </button>
    </div>
  );
}
