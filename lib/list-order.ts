export type DropPlacement = "before" | "after";
export function moveRelative<T extends { id: string }>(
  rows: readonly T[],
  id: string,
  targetId: string,
  placement: DropPlacement,
) {
  const source = rows.find((row) => row.id === id);
  if (!source || id === targetId || !rows.some((row) => row.id === targetId))
    return [...rows];
  const result = rows.filter((row) => row.id !== id);
  const target = result.findIndex((row) => row.id === targetId);
  result.splice(target + (placement === "after" ? 1 : 0), 0, source);
  return result;
}
