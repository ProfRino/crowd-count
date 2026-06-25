// Rejection-sample points uniformly inside a polygon (lng/lat). Used to scatter
// "person" symbols inside outdoor zones. The displayed dot count is capped to
// MAX_DOTS_PER_ZONE so rendering stays smooth on big polygons; below that cap
// we render every person, so at high densities the 0.6 m-wide symbols overlap
// naturally — the visual cue for the crush regime. The actual headcount in
// the result bar is not affected by the cap.

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

// Jittered-grid sampling. Uniform coverage of the polygon without the clumps
// and voids that plain Math.random rejection produces — critical at high density
// where any gap reads as "not a crush". Grid is sized so that, when we hit the
// cap, neighbour-to-neighbour spacing is approximately the configured person
// width, so the symbols visibly overlap on screen.
export function sampleInPolygon(verts, target) {
  if (!verts || verts.length < 3 || target <= 0) return []
  const N = Math.min(Math.max(1, Math.round(target)), MAX_DOTS_PER_ZONE)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of verts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const W = maxX - minX, H = maxY - minY
  if (W <= 0 || H <= 0) return []

  // Over-allocate cells by 1/poly-fill-ratio so we end up with ≥N inside the
  // polygon even for triangular / irregular shapes. Lower over-allocation =
  // bigger cells = less random overlap between neighbours; pick 1/0.8 as the
  // sweet spot between rectangle accuracy and triangle coverage.
  const targetCells = N / 0.8
  const aspect = W / H
  const ncols = Math.max(1, Math.round(Math.sqrt(targetCells * aspect)))
  const nrows = Math.max(1, Math.round(Math.sqrt(targetCells / aspect)))
  const cellW = W / ncols, cellH = H / nrows
  // Smaller jitter = less random overlap (each person stays closer to its own
  // grid cell). ±15% of cell still breaks the visible grid pattern while
  // keeping neighbours from drifting into each other.
  const jitter = 0.3

  // Build the cell index list and shuffle it. Iterating in a SHUFFLED order
  // matters: when there are more cells than N, stopping at N evenly spreads
  // the kept points across the whole polygon. Without the shuffle we fill the
  // bottom rows and leave the top empty.
  const indices = new Array(ncols * nrows)
  for (let i = 0; i < ncols * nrows; i++) indices[i] = i
  for (let k = indices.length - 1; k > 0; k--) {
    const r = (Math.random() * (k + 1)) | 0
    const tmp = indices[k]; indices[k] = indices[r]; indices[r] = tmp
  }

  const out = []
  for (const idx of indices) {
    const i = (idx / ncols) | 0
    const j = idx - i * ncols
    const jx = (Math.random() - 0.5) * cellW * jitter
    const jy = (Math.random() - 0.5) * cellH * jitter
    const x = minX + (j + 0.5) * cellW + jx
    const y = minY + (i + 0.5) * cellH + jy
    if (pointInPolygon([x, y], verts)) {
      out.push([x, y])
      if (out.length >= N) return out
    }
  }
  return out
}
