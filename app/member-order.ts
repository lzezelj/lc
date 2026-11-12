export function compareServerMembers(
  a: { id: string; name: string; role: string },
  b: { id: string; name: string; role: string },
) {
  return (
    Number(b.role === "owner") - Number(a.role === "owner") ||
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
    a.id.localeCompare(b.id)
  );
}
