// Distance / radius ruler — pure helpers. State lives in state.ruler; rendering
// and click handling lives in the canvases; this module just does the math.

import { geoDistanceM } from './shapes.js'
import { metersToDisplay, distanceUnitLabel } from './units.js'

// Distance between two points. mode 'outdoor' → haversine on lng/lat; mode
// 'indoor' → euclidean pixel distance ÷ pixelsPerMeter.
export function segmentMeters(a, b, mode, pixelsPerMeter) {
  if (!a || !b) return 0
  if (mode === 'indoor') {
    if (!pixelsPerMeter || pixelsPerMeter <= 0) return 0
    const dx = b[0] - a[0], dy = b[1] - a[1]
    return Math.sqrt(dx * dx + dy * dy) / pixelsPerMeter
  }
  return geoDistanceM(a, b)
}

// Polyline totals — given the committed points plus an optional live cursor,
// return per-segment + cumulative distance. The cursor (mouse position) is
// rendered as a ghost segment from the last point.
export function polylineTotals(points, cursor, mode, ppm) {
  const segments = []
  let total = 0
  if (!points?.length) return { segments, total }
  for (let i = 1; i < points.length; i++) {
    const s = segmentMeters(points[i - 1], points[i], mode, ppm)
    segments.push(s); total += s
  }
  if (cursor) {
    const s = segmentMeters(points[points.length - 1], cursor, mode, ppm)
    segments.push(s); total += s
  }
  return { segments, total }
}

// Radius (a single click + drag) — returns meters from center to edge.
export function radiusMeters(center, edge, mode, ppm) {
  return segmentMeters(center, edge, mode, ppm)
}

// Human-readable distance, in the user's chosen unit.
export function fmtDistance(m, units) {
  if (!m || m <= 0) return '0 ' + distanceUnitLabel(units)
  const v = metersToDisplay(m, units)
  // For short distances show 1 decimal; for >1000 m / >3000 ft switch to km / mi.
  if (units === 'imperial') {
    if (v >= 5280) return (v / 5280).toFixed(2) + ' mi'
    return v.toFixed(v < 100 ? 1 : 0) + ' ft'
  }
  if (v >= 1000) return (v / 1000).toFixed(2) + ' km'
  return v.toFixed(v < 100 ? 1 : 0) + ' m'
}

// Circle area for the radius-tool HUD.
export function circleAreaM2(radiusM) { return Math.PI * radiusM * radiusM }
