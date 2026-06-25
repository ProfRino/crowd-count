// Rejection-sample points uniformly inside a polygon, optionally excluding
// any number of "hole" rings (obstructions). Used to scatter "person" symbols
// inside outdoor / indoor zones. The displayed dot count is capped to
// MAX_DOTS_PER_ZONE so rendering stays smooth; the actual headcount in the
// result bar is not affected by the cap.

// Cap per zone. MapLibre's symbol layer renders smoothly up to ~20k icons; past
// that the layer can silently stop drawing at high zoom. 15k is the proven sweet
// spot — at any plausible polygon size the jittered-grid spacing is small enough
// that 0.6 m people overlap and read as a packed crowd.
export const MAX_DOTS_PER_ZONE = 15000

export function pointInPolygon([px, py], verts) {
  let inside = false
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const [xi, yi] = verts[i]
    const [xj, yj] = verts[j]
    const intersect = (yi > py) !== (yj > py) &&
                      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

// Shoelace area in the same (x, y) units as the input ring — used internally
// to estimate the polygon's outer/net fill ratio so the over-allocation factor
// stays honest when holes reject many candidates.
function ringArea(verts) {
  let s = 0
  for (let i = 0; i < verts.length; i++) {
    const [x1, y1] = verts[i]
    const [x2, y2] = verts[(i + 1) % verts.length]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

// Jittered-grid sampling, hole-aware.
//   outerVerts: ring defining the outer boundary
//   holesVerts: array of rings to EXCLUDE (no points inside any hole)
//   target:     desired number of points after the cap
export function sampleInPolygonWithHoles(outerVerts, holesVerts, target) {
  if (!outerVerts || outerVerts.length < 3 || target <= 0) return []
  const N = Math.min(Math.max(1, Math.round(target)), MAX_DOTS_PER_ZONE)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of outerVerts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const W = maxX - minX, H = maxY - minY
  if (W <= 0 || H <= 0) return []

  // Over-allocate cells by 1/0.8 for the outer ring shape, then further inflate
  // by outer/net so holes don't blow our iteration budget.
  const outerA = ringArea(outerVerts) || 1
  let netA = outerA
  if (holesVerts?.length) for (const h of holesVerts) if (h?.length >= 3) netA -= ringArea(h)
  netA = Math.max(netA, outerA * 0.05)  // floor so we don't go infinite if a hole dominates
  const inflate = outerA / netA

  const targetCells = (N / 0.8) * inflate
  const aspect = W / H
  const ncols = Math.max(1, Math.round(Math.sqrt(targetCells * aspect)))
  const nrows = Math.max(1, Math.round(Math.sqrt(targetCells / aspect)))
  const cellW = W / ncols, cellH = H / nrows
  const jitter = 0.3

  // Shuffle cell indices so the kept points spread evenly when we hit the cap.
  const indices = new Array(ncols * nrows)
  for (let i = 0; i < ncols * nrows; i++) indices[i] = i
  for (let k = indices.length - 1; k > 0; k--) {
    const r = (Math.random() * (k + 1)) | 0
    const tmp = indices[k]; indices[k] = indices[r]; indices[r] = tmp
  }

  const holes = (holesVerts ?? []).filter(h => h && h.length >= 3)

  const out = []
  outer: for (const idx of indices) {
    const i = (idx / ncols) | 0
    const j = idx - i * ncols
    const jx = (Math.random() - 0.5) * cellW * jitter
    const jy = (Math.random() - 0.5) * cellH * jitter
    const x = minX + (j + 0.5) * cellW + jx
    const y = minY + (i + 0.5) * cellH + jy
    if (!pointInPolygon([x, y], outerVerts)) continue
    for (const h of holes) if (pointInPolygon([x, y], h)) continue outer
    out.push([x, y])
    if (out.length >= N) return out
  }
  return out
}

// Backwards-compat alias for any consumer that doesn't yet know about holes.
export function sampleInPolygon(verts, target) {
  return sampleInPolygonWithHoles(verts, [], target)
}
