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
      <label className="rnnoiseToggle cameraMirrorControl">
        <input
          type="checkbox"
          checked={mirrored}
          onChange={(event) => {
            try {
              localStorage.setItem(
                "lc.cameraMirror",
                String(event.target.checked),
              );
            } catch {}
            window.dispatchEvent(new Event("lc-camera-mirror"));
          }}
        />
        <span>Mirror camera</span>
      </label>
    </div>
  );
}
