// Rejection-sample points uniformly inside a polygon, optionally excluding
// any number of "hole" rings (obstructions). Used to scatter "person" symbols
// inside outdoor / indoor zones. Every sampled person is rendered (no visual
// cap) so the crowd shows the true density; only a high SAFETY CEILING bounds
// the count to stop a pathologically huge zone (km² × crush) from generating
// millions of features and freezing the browser.
export const MAX_DOTS_PER_ZONE = 200000

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

  // Estimate the net polygon's fill ratio inside its bounding box. This lets
  // circles, concave shapes, and zones with holes still produce the requested
  // number of visible people instead of quietly under-filling.
  const outerA = ringArea(outerVerts) || 1
  let netA = outerA
  if (holesVerts?.length) for (const h of holesVerts) if (h?.length >= 3) netA -= ringArea(h)
  if (netA <= 0) return []
  const bboxA = W * H
  const fillRatio = Math.max(0.001, Math.min(1, netA / bboxA))

  const targetCells = N * 1.25 / fillRatio
  const aspect = W / H
  const ncols = Math.max(1, Math.round(Math.sqrt(targetCells * aspect)))
  const nrows = Math.max(1, Math.round(Math.sqrt(targetCells / aspect)))
  const cellW = W / ncols, cellH = H / nrows
  const jitter = 0.3

  const holes = (holesVerts ?? []).filter(h => h && h.length >= 3)

  const out = []
  let seen = 0
  function pointInAnyHole(p) {
    for (const h of holes) if (pointInPolygon(p, h)) return true
    return false
  }
  function keepPoint(p) {
    seen++
    if (out.length < N) {
      out.push(p)
      return
    }
    const r = (Math.random() * seen) | 0
    if (r < N) out[r] = p
  }

  for (let i = 0; i < nrows; i++) {
    for (let j = 0; j < ncols; j++) {
      const jx = (Math.random() - 0.5) * cellW * jitter
      const jy = (Math.random() - 0.5) * cellH * jitter
      const p = [minX + (j + 0.5) * cellW + jx, minY + (i + 0.5) * cellH + jy]
      if (!pointInPolygon(p, outerVerts) || pointInAnyHole(p)) continue
      keepPoint(p)
    }
  }

  // Pathological skinny or highly concave zones can still beat the grid
  // estimate. Top up with bounded rejection sampling so the visual count
  // matches the density target for ordinary cases.
  let tries = 0
  const maxTries = Math.max(2000, N * 20)
  randomFill: while (out.length < N && tries < maxTries) {
    tries++
    const p = [minX + Math.random() * W, minY + Math.random() * H]
    if (!pointInPolygon(p, outerVerts) || pointInAnyHole(p)) continue randomFill
    out.push(p)
  }
  return out
}

// Weighted rejection sampler. `weightFn(point)` returns a local density-like
// weight; points in higher-weight areas are more likely to be accepted.
export function sampleWeightedInPolygonWithHoles(outerVerts, holesVerts, target, weightFn, maxWeight) {
  if (!outerVerts || outerVerts.length < 3 || target <= 0 || !weightFn || maxWeight <= 0) return []
  const N = Math.min(Math.max(1, Math.round(target)), MAX_DOTS_PER_ZONE)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of outerVerts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const W = maxX - minX, H = maxY - minY
  if (W <= 0 || H <= 0) return []

  const holes = (holesVerts ?? []).filter(h => h && h.length >= 3)
  function pointInAnyHole(p) {
    for (const h of holes) if (pointInPolygon(p, h)) return true
    return false
  }

  const out = []
  let tries = 0
  const maxTries = Math.max(5000, N * 80)
  while (out.length < N && tries < maxTries) {
    tries++
    const p = [minX + Math.random() * W, minY + Math.random() * H]
    if (!pointInPolygon(p, outerVerts) || pointInAnyHole(p)) continue
    const w = Math.max(0, Number(weightFn(p)) || 0)
    if (Math.random() <= Math.min(1, w / maxWeight)) out.push(p)
  }

  // If the weighted rejection loop cannot fill a very awkward polygon in
  // time, top up uniformly so the count remains honest.
  if (out.length < N) {
    const topUp = sampleInPolygonWithHoles(outerVerts, holesVerts, N - out.length)
    out.push(...topUp)
  }
  return out.slice(0, N)
}

// Backwards-compat alias for any consumer that doesn't yet know about holes.
export function sampleInPolygon(verts, target) {
  return sampleInPolygonWithHoles(verts, [], target)
}
