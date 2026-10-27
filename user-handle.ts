export function buildUserHandle(
  name: string | null | undefined,
  discriminator: number,
) {
  const base =
    (name ?? "user")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 24) || "user";
  return `${base}.${String(discriminator).padStart(4, "0")}`;
}

export function normalizeUserHandle(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*\((\d{0,4})\)?$/, ".$1");
}

export function formatUserHandle(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/\.(\d{4})$/, " ($1)");
}
