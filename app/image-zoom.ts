export type ImageView = { scale: number; x: number; y: number };
export const initialImageView: ImageView = { scale: 1, x: 0, y: 0 };
export function clampImageView(
  view: ImageView,
  width: number,
  height: number,
): ImageView {
  const scale = Math.max(1, Math.min(5, view.scale));
  if (scale === 1) return { ...initialImageView };
  return {
    scale,
    x: Math.max(
      (-width * (scale - 1)) / 2,
      Math.min((width * (scale - 1)) / 2, view.x),
    ),
    y: Math.max(
      (-height * (scale - 1)) / 2,
      Math.min((height * (scale - 1)) / 2, view.y),
    ),
  };
}
export function zoomImageView(
  view: ImageView,
  scale: number,
  width: number,
  height: number,
  x = 0,
  y = 0,
) {
  const next = Math.max(1, Math.min(5, scale)),
    ratio = next / view.scale;
  return clampImageView(
    { scale: next, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio },
    width,
    height,
  );
}
