/**
 * Straightening a photographed label: given the label's four corners in the photo (as fractions), work out how far to
 * turn the photo so the label reads upright, and which rectangle to cut out afterwards. Pure geometry.
 */
export type Corner = { x: number; y: number };
export type CropPlan = {
  /** Degrees to turn the photo clockwise. */
  angle: number;
  /** Size of the photo after turning. */
  canvas: { width: number; height: number };
  /** What to cut from the turned photo, in pixels. */
  crop: { left: number; top: number; width: number; height: number };
};

/** `corners` are the label's top-left, top-right, bottom-right and bottom-left as they read upright. */
export function planCrop(corners: Corner[], width: number, height: number, padding = 0.02): CropPlan | null {
  if (corners.length !== 4 || !(width > 0 && height > 0)) return null;
  const px = corners.map((c) => ({ x: Math.min(1, Math.max(0, c.x)) * width, y: Math.min(1, Math.max(0, c.y)) * height }));
  const [tl, tr] = px;
  let angle = (-Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180) / Math.PI;
  if (Math.abs(angle) < 1.5) angle = 0;
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const newW = Math.abs(width * cos) + Math.abs(height * sin);
  const newH = Math.abs(width * sin) + Math.abs(height * cos);
  const moved = px.map((p) => {
    const vx = p.x - width / 2;
    const vy = p.y - height / 2;
    return { x: vx * cos - vy * sin + newW / 2, y: vx * sin + vy * cos + newH / 2 };
  });
  const minX = Math.min(...moved.map((p) => p.x));
  const maxX = Math.max(...moved.map((p) => p.x));
  const minY = Math.min(...moved.map((p) => p.y));
  const maxY = Math.max(...moved.map((p) => p.y));
  const padX = (maxX - minX) * padding;
  const padY = (maxY - minY) * padding;
  const left = Math.max(0, Math.floor(minX - padX));
  const top = Math.max(0, Math.floor(minY - padY));
  const right = Math.min(Math.floor(newW), Math.ceil(maxX + padX));
  const bottom = Math.min(Math.floor(newH), Math.ceil(maxY + padY));
  if (right - left < 20 || bottom - top < 20) return null;
  return { angle, canvas: { width: Math.round(newW), height: Math.round(newH) }, crop: { left, top, width: right - left, height: bottom - top } };
}
