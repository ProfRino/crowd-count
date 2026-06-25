// Shape primitives. A "zone" can be one of:
//   - polygon: user-authored vertices, params=null
//   - circle:  params={ kind:'circle', center, radiusM, segments? }
//   - rect:    params={ kind:'rect',   a, b }   (two opposite corners)
//
// `vertices` is the AUTHORITATIVE downstream ring for every consumer (area
// math, people sampling, MapLibre fill, IndoorCanvas Path2D). Polygons author
// it directly; circle/rect re-generate it from params via rebuildVertices().

export const CIRCLE_SEGMENTS = 64

export function makePolygonZone() { return { shape: 'polygon', params: null } }

export function makeCircleZone(center, radiusM) {
  return { shape: 'circle', params: { kind: 'circle', center: [...center], radiusM, segments: CIRCLE_SEGMENTS } }
}

export function makeRectZone(a, b) {
  return { shape: 'rect', params: { kind: 'rect', a: [...a], b: [...b] } }
}

// In-place: rewrite `zone.vertices` from `zone.params` per shape + mode.
//   ctx.mode: 'outdoor' | 'indoor'
//   ctx.pixelsPerMeter: number (only needed for indoor circles)
export function rebuildVertices(zone, ctx) {
  if (zone.shape === 'polygon' || !zone.params) return
  if (zone.shape === 'circle') {
    zone.vertices = circleVertices(zone.params, ctx)
  } else if (zone.shape === 'rect') {
    zone.vertices = rectVertices(zone.params)
  }
}

function rectVertices(params) {
  const [ax, ay] = params.a
  const [bx, by] = params.b
  // Axis-aligned in (x, y) — for outdoor that's lng/lat (close-enough at zone scale),
  // for indoor that's image pixels.
  return [
    [ax, ay],
    [bx, ay],
    [bx, by],
    [ax, by],
  ]
}

function circleVertices(params, ctx) {
  const n = params.segments ?? CIRCLE_SEGMENTS
  const [cx, cy] = params.center
  const out = new Array(n)
  if (ctx?.mode === 'indoor') {
    // Image-pixel space: radius in meters becomes radius in pixels via ppm.
    const ppm = ctx.pixelsPerMeter || 1
    const rPx = params.radiusM * ppm
    for (let i = 0; i < n; i++) {
      const θ = (i / n) * Math.PI * 2
      out[i] = [cx + rPx * Math.cos(θ), cy + rPx * Math.sin(θ)]
    }
    return out
  }
  // Outdoor — geodesic destination point on each bearing.
  for (let i = 0; i < n; i++) {
    const bearingDeg = (i / n) * 360
    out[i] = geoDestination(cx, cy, bearingDeg, params.radiusM)
  }
  return out
}

// Haversine destination point — (lng, lat) → (lng, lat) after travelling
// `distM` metres along bearing `bearingDeg` (0=N, 90=E).
function geoDestination(lng, lat, bearingDeg, distM) {
  const R = 6378137  // WGS84 equatorial radius — same as turf
  const δ = distM / R
  const θ = bearingDeg * Math.PI / 180
  const φ1 = lat * Math.PI / 180
  const λ1 = lng * Math.PI / 180
  const sinφ1 = Math.sin(φ1), cosφ1 = Math.cos(φ1)
  const sinδ = Math.sin(δ), cosδ = Math.cos(δ)
  const sinθ = Math.sin(θ), cosθ = Math.cos(θ)
  const φ2 = Math.asin(sinφ1 * cosδ + cosφ1 * sinδ * cosθ)
  const λ2 = λ1 + Math.atan2(sinθ * sinδ * cosφ1, cosδ - sinφ1 * Math.sin(φ2))
  return [((λ2 * 180 / Math.PI) + 540) % 360 - 180, φ2 * 180 / Math.PI]
}

// Compute the meter-distance between two lng/lat points using the inverse haversine.
export function geoDistanceM(a, b) {
  const R = 6378137
  const [lng1, lat1] = a
  const [lng2, lat2] = b
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lng2 - lng1) * Math.PI / 180
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}
