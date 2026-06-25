import area from '@turf/area'
import { polygon as turfPolygon } from '@turf/helpers'

// Close a ring if it isn't already.
function closedRing(ring) {
  const first = ring[0], last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) return [...ring, first]
  return ring
}

// Geodesic area for outdoor lng/lat polygons.
export function geodesicAreaM2(vertices) {
  if (!vertices || vertices.length < 3) return 0
  try {
    const poly = turfPolygon([closedRing(vertices)])
    return area(poly)
  } catch {
    return 0
  }
}

// Geodesic area for an outer ring minus any number of hole rings.
// Holes outside the outer ring contribute negatively to the result; clamped at 0.
export function geodesicAreaM2WithHoles(outer, holes = []) {
  if (!outer || outer.length < 3) return 0
  const validHoles = (holes ?? []).filter(h => h && h.length >= 3).map(closedRing)
  try {
    const poly = turfPolygon([closedRing(outer), ...validHoles])
    return Math.max(0, area(poly))
  } catch {
    // Fall back to per-ring subtraction if turf can't construct the polygon
    // (e.g. degenerate holes).
    let net = geodesicAreaM2(outer)
    for (const h of validHoles) net -= geodesicAreaM2(h)
    return Math.max(0, net)
  }
}

// Planar (pixel) area for indoor overlays, then convert via scale (pixels per meter).
export function planarAreaM2(verticesPx, pixelsPerMeter) {
  if (!verticesPx || verticesPx.length < 3 || !pixelsPerMeter || pixelsPerMeter <= 0) return 0
  let s = 0
  for (let i = 0; i < verticesPx.length; i++) {
    const [x1, y1] = verticesPx[i]
    const [x2, y2] = verticesPx[(i + 1) % verticesPx.length]
    s += x1 * y2 - x2 * y1
  }
  const pxArea = Math.abs(s) / 2
  return pxArea / (pixelsPerMeter * pixelsPerMeter)
}

// Planar area, outer minus holes. Same scale conversion as planarAreaM2.
export function planarAreaM2WithHoles(outerPx, holesPx = [], pixelsPerMeter) {
  if (!outerPx || outerPx.length < 3 || !pixelsPerMeter || pixelsPerMeter <= 0) return 0
  let net = planarAreaM2(outerPx, pixelsPerMeter)
  for (const h of holesPx ?? []) net -= planarAreaM2(h, pixelsPerMeter)
  return Math.max(0, net)
}
