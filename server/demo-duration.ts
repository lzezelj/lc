export const DEFAULT_DEMO_DURATION_HOURS = 4;
export const MAX_DEMO_EXTENSION_HOURS = 720;

export function parseDemoExtensionHours(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_DEMO_EXTENSION_HOURS
    ? value
    : null;
}

export function extendDemoDeadline(current: Date, hours: number) {
  return new Date(current.getTime() + hours * 60 * 60 * 1000);
}
