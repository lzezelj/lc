export function formatMessageTimestamp(
  sentAt: number,
  now: number,
  locale?: string,
) {
  const date = new Date(sentAt),
    current = new Date(now);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(current.getTime()))
    return "";
  const clock = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  const day = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const today = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate(),
  ).getTime();
  const yesterday = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate() - 1,
  ).getTime();
  if (day === today) return clock;
  if (day === yesterday) return `Yesterday at ${clock}`;
  return `${new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(date)} at ${clock}`;
}
