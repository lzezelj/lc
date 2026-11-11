// Shared by microphone/deafen controls, including the dock and call view.
let nextToggle = 0;
export function takeVoiceToggle(now = Date.now()) {
  if (now < nextToggle) return false;
  nextToggle = now + 750;
  return true;
}
