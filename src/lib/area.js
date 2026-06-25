import area from '@turf/area'
import { polygon as turfPolygon } from '@turf/helpers'

// Geodesic area for outdoor lng/lat polygons.
export function geodesicAreaM2(vertices) {
  if (!vertices || vertices.length < 3) return 0
  const ring = [...vertices.map(([lng, lat]) => [lng, lat])]
  // Close the ring if not closed.
  const first = ring[0], last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first)
  try {
    const poly = turfPolygon([ring])
    return area(poly)
  } catch {
    return 0
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
