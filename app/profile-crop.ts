export type ProfileCrop = { zoom: number; x: number; y: number };
export const centeredCrop: ProfileCrop = { zoom: 1, x: 50, y: 50 };
export function cropSquare(width: number, height: number, crop: ProfileCrop) {
  const clamp = (value: number, min: number, max: number, fallback: number) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  const size = Math.min(width, height) / clamp(crop.zoom, 1, 3, 1);
  return {
    size,
    x: ((width - size) * clamp(crop.x, 0, 100, 50)) / 100,
    y: ((height - size) * clamp(crop.y, 0, 100, 50)) / 100,
  };
}
