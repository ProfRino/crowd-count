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
//
// SDF tint mode renders the head + shoulders as TWO separate icons (one
// recoloured to the zone colour, one fixed dark) so the head stays visible
// without changing its position.

const SIZE_W = 12
const SIZE_H = 8
export const PERSON_SOURCE_WIDTH_PX = 11.6

const SHOULDER_CX = 6, SHOULDER_CY = 4
const SHOULDER_RX = 5.8, SHOULDER_RY = 3.4
const HEAD_CX = 6, HEAD_CY = 4
const HEAD_R = 2.6

export function makePersonTopIcon(headFill = '#ffffff', shoulderFill = '#f8fafc') {
  const scale = 2
  const c = document.createElement('canvas')
  c.width = SIZE_W * scale; c.height = SIZE_H * scale
  const ctx = c.getContext('2d')
  ctx.scale(scale, scale)

  // Shoulders — horizontal ellipse, fills the canvas
  ctx.fillStyle = shoulderFill
  ctx.beginPath()
  ctx.ellipse(SHOULDER_CX, SHOULDER_CY, SHOULDER_RX, SHOULDER_RY, 0, 0, Math.PI * 2)
  ctx.fill()

  // Head — smaller darker circle, concentric (top-down view)
  ctx.fillStyle = headFill
  ctx.beginPath()
  ctx.arc(HEAD_CX, HEAD_CY, HEAD_R, 0, Math.PI * 2)
  ctx.fill()

  return { imageData: ctx.getImageData(0, 0, SIZE_W * scale, SIZE_H * scale), pixelRatio: scale }
}

// SDF mask of the SHOULDERS only — recoloured per-zone via icon-color.
export function makePersonShouldersMask() {
  const scale = 2
  const c = document.createElement('canvas')
  c.width = SIZE_W * scale; c.height = SIZE_H * scale
  const ctx = c.getContext('2d')
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.ellipse(SHOULDER_CX, SHOULDER_CY, SHOULDER_RX, SHOULDER_RY, 0, 0, Math.PI * 2)
  ctx.fill()
  return { imageData: ctx.getImageData(0, 0, SIZE_W * scale, SIZE_H * scale), pixelRatio: scale }
}

// SDF mask of the HEAD only — drawn on a SECOND symbol layer above the
// shoulders so the dark head stays visible regardless of the zone colour.
export function makePersonHeadMask() {
  const scale = 2
  const c = document.createElement('canvas')
  c.width = SIZE_W * scale; c.height = SIZE_H * scale
  const ctx = c.getContext('2d')
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(HEAD_CX, HEAD_CY, HEAD_R, 0, Math.PI * 2)
  ctx.fill()
  return { imageData: ctx.getImageData(0, 0, SIZE_W * scale, SIZE_H * scale), pixelRatio: scale }
}
