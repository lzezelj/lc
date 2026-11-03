export function revealSettingsSection(element: HTMLElement | null) {
  if (!element) return;
  const pane = element.closest<HTMLElement>(
    ".settingsContent, .settingsActions",
  );
  if (!pane) return;
  const padding = parseFloat(getComputedStyle(pane).paddingTop) || 0;
  pane.scrollTo({
    top:
      pane.scrollTop +
      element.getBoundingClientRect().top -
      pane.getBoundingClientRect().top -
      padding,
    behavior: "auto",
  });
}
