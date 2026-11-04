import type { Mention } from "./notification-types";
export type MentionMember = {
  id: string;
  name: string;
  handle?: string | null;
};
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (value: string | undefined) =>
  !!value && /[\p{L}\p{N}_]/u.test(value);
export function resolveMentions(
  text: string,
  members: MentionMember[],
  authorId: string,
): Mention[] {
  const candidates = members
    .filter((member) => member.id !== authorId)
    .flatMap((member) => [
      ...(member.handle
        ? [{ member, value: member.handle, handle: true }]
        : []),
      { member, value: member.name, handle: false },
    ])
    .filter((item) => item.value.trim())
    .sort(
      (a, b) =>
        b.value.length - a.value.length || Number(b.handle) - Number(a.handle),
    );
  const mentions: Mention[] = [];
  for (
    let start = text.indexOf("@");
    start >= 0;
    start = text.indexOf("@", start + 1)
  ) {
    const previous = text[start - 1];
    if (word(previous) || previous === "." || previous === "@") continue;
    const matches = candidates.flatMap((candidate) => {
      const match = new RegExp(`^${escape(candidate.value)}`, "iu").exec(
        text.slice(start + 1),
      );
      if (!match) return [];
      const end = start + 1 + match[0].length;
      if (word(text[end]) || (text[end] === "." && word(text[end + 1])))
        return [];
      return [{ ...candidate, end }];
    });
    const best = matches[0];
    if (!best) continue;
    const equallySpecific = matches.filter(
      (item) => item.end === best.end && item.handle === best.handle,
    );
    if (new Set(equallySpecific.map((item) => item.member.id)).size !== 1)
      continue;
    mentions.push({
      userId: best.member.id,
      name: best.member.name,
      start,
      end: best.end,
    });
    start = best.end - 1;
  }
  return mentions;
}

export function mentionQuery(value: string, caret: number) {
  const start = value.lastIndexOf("@", caret - 1);
  if (
    start < 0 ||
    word(value[start - 1]) ||
    value[start - 1] === "." ||
    value[start - 1] === "@"
  )
    return null;
  const query = value.slice(start + 1, caret);
  return query.length <= 60 && !/[\n\r@]/.test(query)
    ? { start, end: caret, query }
    : null;
}
