export const microphoneProcessingChanged = "lc-microphone-processing-change";
export function readEchoCancellationEnabled() {
  return (
    typeof localStorage === "undefined" ||
    localStorage.getItem("lc.echoCancellation") !== "off"
  );
}
/** @param {boolean} enabled */
export function saveEchoCancellationEnabled(enabled) {
  localStorage.setItem("lc.echoCancellation", enabled ? "on" : "off");
  window.dispatchEvent(new Event(microphoneProcessingChanged));
}
/** @returns {"raw" | "browser" | "rnnoise"} */
export function readMicrophoneMode() {
  if (typeof localStorage === "undefined") return "rnnoise";
  const saved = localStorage.getItem("lc.microphoneMode");
  if (saved === "raw" || saved === "browser" || saved === "rnnoise")
    return saved;
  // Preserve choices saved before the three-mode selector existed.
  if (localStorage.getItem("lc.microphoneProcessing") === "off") return "raw";
  return localStorage.getItem("lc.rnnoise") === "off" ? "browser" : "rnnoise";
}
/** @param {"raw" | "browser" | "rnnoise"} mode */
export function saveMicrophoneMode(mode) {
  if (!["raw", "browser", "rnnoise"].includes(mode))
    throw new Error("Invalid microphone mode");
  localStorage.setItem("lc.microphoneMode", mode);
  // Older open tabs still understand these preferences.
  localStorage.setItem("lc.rnnoise", mode === "rnnoise" ? "on" : "off");
  localStorage.setItem(
    "lc.microphoneProcessing",
    mode === "raw" ? "off" : "on",
  );
  window.dispatchEvent(new Event(microphoneProcessingChanged));
}
