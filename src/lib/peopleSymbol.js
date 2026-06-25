// Top-down stylized person symbol — head concentric with shoulders (no "hump").
// The source canvas is sized to fit the person tightly (no wasted padding) so
// that when symbols are placed shoulder-to-shoulder they actually touch/overlap
// on screen instead of being separated by transparent gutter.
//
// Geometry in source-pixel units (12 wide × 8 tall canvas):
//   shoulders ellipse: half-width 5.8, half-depth 3.4 → fills the canvas tightly
//   head circle:        radius 2.6, concentric
// PERSON_SOURCE_WIDTH_PX exports the effective person width so the map layer
// can compute icon-size from a real-world meter value.

const SIZE_W = 12
const SIZE_H = 8
export const PERSON_SOURCE_WIDTH_PX = 11.6

export function makePersonTopIcon(headFill = '#0f172a', shoulderFill = '#374151') {
  const scale = 2
  const c = document.createElement('canvas')
  c.width = SIZE_W * scale; c.height = SIZE_H * scale
  const ctx = c.getContext('2d')
  ctx.scale(scale, scale)
  const cx = SIZE_W / 2, cy = SIZE_H / 2

  // Shoulders — horizontal ellipse, fills the canvas
  ctx.fillStyle = shoulderFill
  ctx.beginPath()
  ctx.ellipse(cx, cy, 5.8, 3.4, 0, 0, Math.PI * 2)
  ctx.fill()

  // Head — smaller darker circle, concentric (top-down view)
  ctx.fillStyle = headFill
  ctx.beginPath()
  ctx.arc(cx, cy, 2.6, 0, Math.PI * 2)
  ctx.fill()

  return { imageData: ctx.getImageData(0, 0, SIZE_W * scale, SIZE_H * scale), pixelRatio: scale }
}
