import { reactive, watch } from 'vue'
import earcut from 'earcut'
import { geodesicAreaM2, planarAreaM2 } from './area.js'
import { badgeFor } from './standards.js'
import { encodeState, decodeState, pickColor, serializeProject, loadProject } from './share.js'
import { rebuildVertices, geoDistanceM } from './shapes.js'
import { pointInPolygon, sampleInPolygonWithHoles, sampleWeightedInPolygonWithHoles } from './sample.js'
import { normalizePeopleColorMode } from './peopleAppearance.js'

const DEFAULT_VIEW = { lng: -77.0470, lat: 38.8895, zoom: 16 }  // National Mall, in front of the Lincoln Memorial

const state = reactive({
  mode: 'outdoor',  // 'outdoor' | 'indoor'
  basemap: 'osm',   // 'osm' | 'satellite'
  tileStyle: 'color', // 'color' | 'grayscale' — visual style of the basemap
  units: 'metric',  // 'metric' | 'imperial' — display-only
  viewMode: '2d',   // '2d' | '3d' — outdoor only (indoor stays 2D for now)
  peopleColorMode: 'neutral', // 'neutral' | 'zone' | 'natural'
  peopleTint: false, // legacy mirror: true means peopleColorMode === 'zone'
  googleHeight: {
    status: '',
    busy: false,
    resetNonce: 0,
  },
  // 3D building data source. 'osm' (default, free, no key) uses our Overpass
  // fetch + manual extrusion; 'google' uses Google Photorealistic 3D Tiles
  // and needs an API key (state.googleMapsKey, stored in localStorage only).
  buildingSource: (typeof localStorage !== 'undefined' && localStorage.getItem('crowd-count-building-source')) || 'osm',
  googleMapsKey: (typeof localStorage !== 'undefined' && localStorage.getItem('crowd-count-google-key')) || '',
  view: { ...DEFAULT_VIEW },
  standard: 'purple',
  zones: [],
  selectedZoneId: null,
  // Drawing mode: false | 'zone' | 'obstruction'. Truthy checks still work.
  drawing: false,
  // Which shape the next `+ Add zone` will create.
  drawTool: 'polygon',  // 'polygon' | 'circle' | 'rect'
  // Which inner ring obstruction-mode clicks land in (null when no active draft).
  activeObstructionId: null,
  indoor: { imageUrl: null, calibration: null, pixelsPerMeter: null },
  // Ruler is a transient measurement overlay — never persisted to the permalink.
  ruler: {
    active: false,
    points: [],                // clicked lng/lat or image-px points
    cursor: null,              // current pointer position for live segment preview
  },
  // Aiming = "pick the focus point for this zone's crowd". Holds the zone id
  // we're targeting while the user clicks the map; null otherwise.
  aiming: null,
  // Gradient picking = two-click setup for a zone's density-gradient axis.
  // { zoneId, step: 'start' | 'end' } while active.
  gradientPicking: null,
  mapRefreshNonce: 0,
  ui: { aboutOpen: false, justShared: false },
})

function newZoneId() { return 'z' + Math.random().toString(36).slice(2, 8) }
function newObstructionId() { return 'o' + Math.random().toString(36).slice(2, 8) }

function addZone(name = null, shape = state.drawTool ?? 'polygon', params = null) {
  const i = state.zones.length
  const z = {
    id: newZoneId(),
    name: name ?? `Zone ${i + 1}`,
    density: 2,
    densityMode: 'uniform', // 'uniform' | 'gradient'
    densityGradient: {
      start: null,
      end: null,
      stops: [
        { distanceM: 0, density: 2 },
        { distanceM: 100, density: 1 },
      ],
    },
    color: pickColor(i),
    shape,            // 'polygon' | 'circle' | 'rect'
    params,           // null for polygon; { kind, center, radiusM } for circle; { kind, a, b } for rect
    vertices: [],     // derived for circle/rect (via rebuildVertices); authored for polygon
    obstructions: [], // inner rings: [{ id, vertices }]
    facingPoint: null, // [lng, lat] | null — when set, people in this zone face this point
  }
  state.zones.push(z)
  state.selectedZoneId = z.id
  return z
}

function deleteZone(id) {
  const i = state.zones.findIndex(z => z.id === id)
  if (i === -1) return
  state.zones.splice(i, 1)
  clearSampleCache(id)
  if (state.aiming === id || state.gradientPicking?.zoneId === id || state.selectedZoneId === id) {
    enterMode(null)
  }
  if (state.selectedZoneId === id) state.selectedZoneId = state.zones[0]?.id ?? null
  state.mapRefreshNonce += 1
}

function selectZone(id) { state.selectedZoneId = id }

function startGradientPick(zoneId = state.selectedZoneId) {
  const z = state.zones.find(zz => zz.id === zoneId)
  if (!z) return
  ensureDensityModel(z)
  z.densityMode = 'gradient'
  enterMode(null)
  state.selectedZoneId = z.id
  state.gradientPicking = {
    zoneId: z.id,
    step: 'start',
    original: {
      start: Array.isArray(z.densityGradient.start) ? [...z.densityGradient.start] : null,
      end: Array.isArray(z.densityGradient.end) ? [...z.densityGradient.end] : null,
    },
  }
}

function cancelGradientPick() {
  const pick = state.gradientPicking
  if (pick) {
    const z = state.zones.find(zz => zz.id === pick.zoneId)
    if (z?.densityGradient && pick.original) {
      z.densityGradient.start = pick.original.start ? [...pick.original.start] : null
      z.densityGradient.end = pick.original.end ? [...pick.original.end] : null
      clearSampleCache(z.id)
    }
  }
  enterMode(null)
}

// Mutual-exclusion gate: at most one of {drawing, calibrating, ruler} is active.
// mode ∈ 'drawing' | 'obstruction' | 'calibrating' | 'ruler' | null. Returns the chosen state value.
function enterMode(mode) {
  // Always clear all modes first.
  state.drawing = false
  state.activeObstructionId = null
  state.indoor.calibration = null
  state.ruler.active = false
  state.ruler.points = []
  state.ruler.cursor = null
  state.aiming = null
  state.gradientPicking = null
  if (mode === 'drawing') state.drawing = 'zone'
  else if (mode === 'obstruction') state.drawing = 'obstruction'
  else if (mode === 'ruler') state.ruler.active = true
  // 'aiming' is set up by the caller (ZonePanel) after this returns, so it
  // can pass the target zone id.
  // 'calibrating' is set up by the caller (IndoorOverlay) after this returns.
}

function finishRuler({ clear = false } = {}) {
  state.ruler.active = false
  state.ruler.cursor = null
  if (clear) state.ruler.points = []
}

function canCommitParametricZone(z) {
  if (!z?.params) return false
  if (z.shape === 'circle') return Number.isFinite(z.params.radiusM) && z.params.radiusM > 0
  if (z.shape === 'rect') {
    const [ax, ay] = z.params.a ?? []
    const [bx, by] = z.params.b ?? []
    return Math.abs((bx ?? ax) - ax) > 1e-9 && Math.abs((by ?? ay) - ay) > 1e-9
  }
  return false
}

function commitParametricZone(z) {
  if (!canCommitParametricZone(z)) return false
  rebuildVertices(z, { mode: state.mode, pixelsPerMeter: state.indoor.pixelsPerMeter })
  enterMode(null)
  return true
}

function setDrawing(on) { state.drawing = on ? 'zone' : false }

// --- Obstructions ---------------------------------------------------------
function addObstruction(zoneId = state.selectedZoneId) {
  const z = state.zones.find(zz => zz.id === zoneId)
  if (!z || z.vertices.length < 3) return null
  const o = { id: newObstructionId(), vertices: [] }
  z.obstructions.push(o)
  state.selectedZoneId = z.id
  state.activeObstructionId = o.id
  state.drawing = 'obstruction'
  return o
}

function deleteObstruction(zoneId, obstructionId) {
  const z = state.zones.find(zz => zz.id === zoneId)
  if (!z) return
  const i = z.obstructions.findIndex(o => o.id === obstructionId)
  if (i === -1) return
  z.obstructions.splice(i, 1)
  if (state.activeObstructionId === obstructionId) state.activeObstructionId = null
}

function getActiveObstruction() {
  const z = state.zones.find(zz => zz.id === state.selectedZoneId)
  if (!z || !state.activeObstructionId) return null
  return z.obstructions.find(o => o.id === state.activeObstructionId) ?? null
}

function undoLastVertex() {
  const z = state.zones.find(zz => zz.id === state.selectedZoneId)
  if (!z) return false
  // Obstruction sub-mode: pop from the active inner ring; delete the empty obstruction.
  if (state.drawing === 'obstruction' && state.activeObstructionId) {
    const o = z.obstructions.find(oo => oo.id === state.activeObstructionId)
    if (!o) return false
    if (!o.vertices.length) return false
    o.vertices.pop()
    if (!o.vertices.length) {
      const i = z.obstructions.findIndex(oo => oo.id === o.id)
      if (i !== -1) z.obstructions.splice(i, 1)
      state.activeObstructionId = null
    }
    return true
  }
  // Polygon zone — same as before.
  if (z.shape === 'polygon') {
    if (!z.vertices.length) return false
    z.vertices.pop()
    return true
  }
  // Circle / rect — reset the in-progress draft if not yet committed.
  if (z.params && (z.shape === 'circle' || z.shape === 'rect')) {
    // If currently drawing this zone (z.vertices not yet rebuilt at full segments),
    // clear params so the next click restarts the shape.
    if (state.drawing === 'zone') {
      z.params = null
      z.vertices = []
      return true
    }
  }
  return false
}

// --- Shared sampled-people cache -----------------------------------------
// Both MapCanvas (2D dot layer) and Site3DView (3D mannequin instances) need
// scattered points inside each zone's polygon. They used to sample
// independently — same distribution but DIFFERENT random draws — so toggling
// 2D → 3D would re-roll the dots. This cache hands out the SAME lng/lat
// points to anything that asks, until the zone's signature changes.
//
// Entry shape: { sig: string, points: [[lng, lat], ...], rot: [int, ...] }
//   rot[] is one rotation per point (used by the 2D symbol layer; ignored
//   by the 3D view, which jitters yaw via Math.random for variety).
const sampleCache = new Map()

function zoneSampleSignature(z) {
  const holeStr = (z.obstructions ?? [])
    .map(o => o.vertices.flat().join(','))
    .join('|')
  // facingPoint is part of the signature so changing the aim point
  // invalidates the cached rot[] and re-orients the crowd.
  const aim = z.facingPoint ? z.facingPoint.join(',') : ''
  const densityProfile = z.densityMode === 'gradient'
    ? JSON.stringify(z.densityGradient ?? null)
    : ''
  return [
    z.shape,
    z.density,
    z.densityMode,
    densityProfile,
    JSON.stringify(z.params),
    z.vertices.flat().join(','),
    holeStr,
    aim,
  ].join('|')
}

// Returns a stable { points, rot } for this zone. Re-samples only when the
// signature changes. Other code paths can opt out of caching by passing
// `cache: false` (used during the in-progress draw so the half-finished
// polygon never poisons the cache for the final geometry).
function defaultDensityGradient() {
  return {
    start: null,
    end: null,
    stops: [
      { distanceM: 0, density: 2 },
      { distanceM: 100, density: 1 },
    ],
  }
}

function twoGradientStops(stops, baseDensity = 2) {
  const normalized = Array.isArray(stops)
    ? stops
      .map(s => ({
        distanceM: Math.max(0, Number(s.distanceM) || 0),
        density: Math.max(0, Number(s.density) || 0),
      }))
      .sort((a, b) => a.distanceM - b.distanceM)
    : []
  if (normalized.length >= 2) return [normalized[0], normalized[normalized.length - 1]]
  if (normalized.length === 1) {
    return [
      normalized[0],
      { distanceM: Math.max(100, normalized[0].distanceM + 100), density: 1 },
    ]
  }
  return defaultDensityGradient(baseDensity).stops
}

function gradientStopsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  return a.every((s, i) =>
    Math.abs((Number(s.distanceM) || 0) - (Number(b[i].distanceM) || 0)) < 0.0001
    && Math.abs((Number(s.density) || 0) - (Number(b[i].density) || 0)) < 0.0001
  )
}

function ensureDensityModel(z) {
  if (!z) return null
  if (z.densityMode !== 'gradient') z.densityMode = 'uniform'
  if (!z.densityGradient) z.densityGradient = defaultDensityGradient(z.density)
  const stops = twoGradientStops(z.densityGradient.stops, z.density)
  if (!gradientStopsEqual(z.densityGradient.stops, stops)) {
    z.densityGradient.stops = stops
  }
  return z
}

function gradientStops(z) {
  ensureDensityModel(z)
  return twoGradientStops(z.densityGradient?.stops, z.density)
}

function maxGradientDensity(z) {
  const stops = gradientStops(z)
  return stops.reduce((m, s) => Math.max(m, s.density), 0)
}

function densityAtDistanceM(z, distanceM) {
  const stops = gradientStops(z)
  if (!stops.length) return z.density
  if (distanceM <= stops[0].distanceM) return stops[0].density
  for (let i = 1; i < stops.length; i += 1) {
    const a = stops[i - 1]
    const b = stops[i]
    if (distanceM > b.distanceM) continue
    const span = Math.max(0.0001, b.distanceM - a.distanceM)
    const t = (distanceM - a.distanceM) / span
    return a.density + (b.density - a.density) * t
  }
  return stops[stops.length - 1].density
}

function axisCoordsM(z, point) {
  const g = z.densityGradient
  if (!g?.start || !g?.end) return null
  const [sx, sy] = g.start
  const [ex, ey] = g.end
  if (state.mode === 'indoor') {
    const ppm = state.indoor.pixelsPerMeter || 1
    return {
      px: (point[0] - sx) / ppm,
      py: (point[1] - sy) / ppm,
      ex: (ex - sx) / ppm,
      ey: (ey - sy) / ppm,
    }
  }
  const lat0 = sy * Math.PI / 180
  const mPerLng = 111320 * Math.cos(lat0)
  const mPerLat = 111320
  return {
    px: (point[0] - sx) * mPerLng,
    py: (point[1] - sy) * mPerLat,
    ex: (ex - sx) * mPerLng,
    ey: (ey - sy) * mPerLat,
  }
}

function distanceAlongGradientM(z, point) {
  const c = axisCoordsM(z, point)
  if (!c) return 0
  const len = Math.hypot(c.ex, c.ey)
  if (len <= 0.001) return 0
  return (c.px * c.ex + c.py * c.ey) / len
}

function densityAtPoint(z, point) {
  ensureDensityModel(z)
  if (z.densityMode !== 'gradient' || !z.densityGradient?.start || !z.densityGradient?.end) {
    return Math.max(0, Number(z.density) || 0)
  }
  return densityAtDistanceM(z, distanceAlongGradientM(z, point))
}

function zoneRiskDensity(z) {
  ensureDensityModel(z)
  if (z.densityMode !== 'gradient') return Math.max(0, Number(z.density) || 0)
  return maxGradientDensity(z)
}

function pointInAnyHole(p, holes) {
  for (const h of holes) if (pointInPolygon(p, h)) return true
  return false
}

function clipGradientPolygon(poly, threshold, keepGreater) {
  if (!poly.length) return []
  const out = []
  const inside = p => keepGreater ? p.s >= threshold : p.s <= threshold
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const aInside = inside(a)
    const bInside = inside(b)
    if (aInside) out.push(a)
    if (aInside === bInside) continue
    const span = b.s - a.s
    const t = Math.abs(span) < 1e-12 ? 0 : (threshold - a.s) / span
    out.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      s: threshold,
    })
  }
  return out
}

function polygonAreaAndGradientMoment(poly) {
  if (poly.length < 3) return { area: 0, moment: 0 }
  let area = 0
  let moment = 0
  const a = poly[0]
  for (let i = 1; i < poly.length - 1; i += 1) {
    const b = poly[i]
    const c = poly[i + 1]
    const triangleArea = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2
    area += triangleArea
    moment += triangleArea * (a.s + b.s + c.s) / 3
  }
  return { area, moment }
}

function exactGradientAverageDensity(z) {
  const g = z.densityGradient
  if (!g?.start || !g?.end) return null
  const axis = axisCoordsM(z, g.end)
  if (!axis) return null
  const axisLength = Math.hypot(axis.ex, axis.ey)
  if (axisLength <= 0.001) return null
  const ux = axis.ex / axisLength
  const uy = axis.ey / axisLength

  const holes = (z.obstructions ?? []).filter(o => o.vertices.length >= 3).map(o => o.vertices)
  const rings = [z.vertices, ...holes]
  const flat = []
  const holeIndices = []
  let vertexCount = 0
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    const ring = rings[ringIndex]
    if (ringIndex > 0) holeIndices.push(vertexCount)
    for (const point of ring) {
      const metric = axisCoordsM(z, point)
      if (!metric) return null
      flat.push(metric.px, metric.py)
      vertexCount += 1
    }
  }

  let indices
  try {
    indices = earcut(flat, holeIndices, 2)
  } catch {
    return null
  }
  if (!indices.length) return null

  const stops = gradientStops(z)
  const first = stops[0]
  const last = stops[stops.length - 1]
  const span = last.distanceM - first.distanceM
  const slope = span > 1e-9 ? (last.density - first.density) / span : 0
  const intercept = first.density - slope * first.distanceM
  let totalArea = 0
  let densityIntegral = 0

  for (let i = 0; i < indices.length; i += 3) {
    const triangle = [indices[i], indices[i + 1], indices[i + 2]].map(index => {
      const x = flat[index * 2]
      const y = flat[index * 2 + 1]
      return { x, y, s: x * ux + y * uy }
    })
    const whole = polygonAreaAndGradientMoment(triangle)
    totalArea += whole.area

    const low = polygonAreaAndGradientMoment(clipGradientPolygon(triangle, first.distanceM, false))
    densityIntegral += low.area * first.density

    if (span > 1e-9) {
      const middlePoly = clipGradientPolygon(
        clipGradientPolygon(triangle, first.distanceM, true),
        last.distanceM,
        false,
      )
      const middle = polygonAreaAndGradientMoment(middlePoly)
      densityIntegral += middle.area * intercept + middle.moment * slope
    }

    const high = polygonAreaAndGradientMoment(clipGradientPolygon(triangle, last.distanceM, true))
    densityIntegral += high.area * last.density
  }

  return totalArea > 1e-9 ? densityIntegral / totalArea : null
}

function zoneAverageDensity(z) {
  ensureDensityModel(z)
  if (z.densityMode !== 'gradient' || !z.densityGradient?.start || !z.densityGradient?.end || z.vertices.length < 3) {
    return Math.max(0, Number(z.density) || 0)
  }
  const exactAverage = exactGradientAverageDensity(z)
  if (Number.isFinite(exactAverage)) return exactAverage

  // Invalid or self-intersecting polygons can defeat triangulation. Retain a
  // high-resolution deterministic grid as a fallback instead of losing the count.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of z.vertices) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const W = maxX - minX, H = maxY - minY
  if (W <= 0 || H <= 0) return 0
  const holes = (z.obstructions ?? []).filter(o => o.vertices.length >= 3).map(o => o.vertices)
  let sum = 0, n = 0

  // Use roughly 128 x 128 cells for a square zone, redistributed along the
  // longer axis for narrow zones. Outdoor longitude is corrected by latitude
  // so the sampling cells are approximately square in metres.
  const targetCells = 128 * 128
  const midLat = (minY + maxY) / 2
  const widthScale = state.mode === 'outdoor' ? Math.max(0.01, Math.cos(midLat * Math.PI / 180)) : 1
  const aspect = Math.max(0.01, (W * widthScale) / H)
  const cols = Math.max(32, Math.min(256, Math.round(Math.sqrt(targetCells * aspect))))
  const rows = Math.max(32, Math.min(256, Math.round(Math.sqrt(targetCells / aspect))))
  for (let iy = 0; iy < rows; iy += 1) {
    for (let ix = 0; ix < cols; ix += 1) {
      const p = [minX + (ix + 0.5) * W / cols, minY + (iy + 0.5) * H / rows]
      if (!pointInPolygon(p, z.vertices) || pointInAnyHole(p, holes)) continue
      sum += densityAtPoint(z, p)
      n += 1
    }
  }
  return n ? sum / n : 0
}

function zonePeopleCount(zone) {
  return zoneAreaM2(zone) * zoneAverageDensity(zone)
}

function sampleZonePoints(z, { cache = true } = {}) {
  if (!z || z.vertices.length < 3) return { points: [], rot: [] }
  ensureDensityModel(z)
  const sig = zoneSampleSignature(z)
  if (cache) {
    const hit = sampleCache.get(z.id)
    if (hit && hit.sig === sig) return hit
  }
  const target = zonePeopleCount(z)
  const holes = (z.obstructions ?? [])
    .filter(o => o.vertices.length >= 3)
    .map(o => o.vertices)
  const points = z.densityMode === 'gradient' && z.densityGradient?.start && z.densityGradient?.end
    ? sampleWeightedInPolygonWithHoles(
      z.vertices,
      holes,
      target,
      (p) => densityAtPoint(z, p),
      Math.max(0.001, zoneRiskDensity(z)),
    )
    : sampleInPolygonWithHoles(z.vertices, holes, target)
  // rot is the icon's heading in DEGREES, where 0 = north and rotation is
  // clockwise (MapLibre's icon-rotate convention). When facingPoint is set
  // we point each person at the target with a ±15° jitter so the crowd
  // reads as people, not a regiment.
  let rot
  if (z.facingPoint) {
    const [tLng, tLat] = z.facingPoint
    rot = points.map(([lng, lat]) => {
      const dLng = (tLng - lng) * Math.cos(lat * Math.PI / 180)
      const dLat = tLat - lat
      const headingDeg = (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360
      const jitter = (Math.random() - 0.5) * 30 // ±15°
      return Math.floor((headingDeg + jitter + 360) % 360)
    })
  } else {
    rot = points.map(() => Math.floor(Math.random() * 360))
  }
  const entry = { sig, points, rot }
  if (cache) sampleCache.set(z.id, entry)
  return entry
}

function clearSampleCache(zoneId = null) {
  if (zoneId == null) sampleCache.clear()
  else sampleCache.delete(zoneId)
}

// Drop cache entries whose zone no longer exists (called after deleteZone).
function gcSampleCache() {
  const liveIds = new Set(state.zones.map(z => z.id))
  for (const id of sampleCache.keys()) if (!liveIds.has(id)) sampleCache.delete(id)
}

// --- Areas (gross + net) ---------------------------------------------------
function zoneGrossAreaM2(zone) {
  if (state.mode === 'indoor') return planarAreaM2(zone.vertices, state.indoor.pixelsPerMeter)
  return geodesicAreaM2(zone.vertices)
}

function obstructionAreaM2(zone, obstruction) {
  if (!obstruction || obstruction.vertices.length < 3) return 0
  if (state.mode === 'indoor') return planarAreaM2(obstruction.vertices, state.indoor.pixelsPerMeter)
  return geodesicAreaM2(obstruction.vertices)
}

function zoneNetAreaM2(zone) {
  const gross = zoneGrossAreaM2(zone)
  let holes = 0
  for (const o of zone.obstructions ?? []) holes += obstructionAreaM2(zone, o)
  return Math.max(0, gross - holes)
}

// Public-facing alias — every existing caller (ZonePanel/computeTotals/people-sampling)
// silently switches to NET area without code changes.
function zoneAreaM2(zone) { return zoneNetAreaM2(zone) }

function computeTotals() {
  let area = 0, count = 0
  for (const z of state.zones) {
    // Skip the in-progress zone while drawing (either a new shape or a new
    // obstruction cut from the parent zone) — its net area is sliding around
    // as the user shapes it, and the headline number should only "land" once
    // the shape is committed.
    if (state.drawing && z.id === state.selectedZoneId) continue
    const a = zoneAreaM2(z)
    area += a
    count += zonePeopleCount(z)
  }
  return { area, count: Math.round(count) }
}

function zoneBadge(zone) { return badgeFor(zoneRiskDensity(zone), state.standard) }

// --- Vertices rebuild watcher for circle/rect -----------------------------
// Polygon zones are no-ops. Circle/rect zones regenerate vertices from params
// when any of {params, mode, pixelsPerMeter} changes.
watch(
  () => state.zones.map(z => ({ id: z.id, shape: z.shape, params: z.params })),
  () => {
    for (const z of state.zones) {
      if (z.shape !== 'polygon' && z.params) {
        rebuildVertices(z, {
          mode: state.mode,
          pixelsPerMeter: state.indoor.pixelsPerMeter,
        })
      }
    }
  },
  { deep: true }
)
// Re-run on indoor calibration changes so circle/rect zones drawn before
// calibration still get the right vertices once ppm is known.
watch(() => [state.mode, state.indoor.pixelsPerMeter], () => {
  for (const z of state.zones) {
    if (z.shape !== 'polygon' && z.params) {
      rebuildVertices(z, { mode: state.mode, pixelsPerMeter: state.indoor.pixelsPerMeter })
    }
  }
})

// --- Permalink ------------------------------------------------------------
let saveTimer = null
function scheduleShare() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const hash = encodeState({
      view: state.view, standard: state.standard, basemap: state.basemap,
      peopleColorMode: state.peopleColorMode, peopleTint: state.peopleTint,
      zones: state.zones,
    })
    history.replaceState(null, '', '#' + hash)
  }, 500)
}

function restoreFromUrl() {
  const hash = location.hash.replace(/^#/, '')
  if (!hash) return false
  const restored = decodeState(hash)
  if (!restored) return false
  state.view = restored.view
  state.standard = restored.standard
  state.basemap = restored.basemap
  state.peopleColorMode = normalizePeopleColorMode(restored.peopleColorMode)
  state.peopleTint = state.peopleColorMode === 'zone'
  state.zones = restored.zones
  state.selectedZoneId = restored.zones[0]?.id ?? null
  return true
}

function shareLink() {
  const hash = encodeState({
    view: state.view, standard: state.standard, basemap: state.basemap,
    peopleColorMode: state.peopleColorMode, peopleTint: state.peopleTint,
    zones: state.zones,
  })
  return location.origin + location.pathname + '#' + hash
}

// --- Save / Open project files -------------------------------------------
function saveProjectToFile() {
  const json = serializeProject({
    view: state.view, standard: state.standard, basemap: state.basemap,
    peopleColorMode: state.peopleColorMode, peopleTint: state.peopleTint,
    zones: state.zones,
  })
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `crowd-count-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function openProjectFromFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const { project, error } = loadProject(String(reader.result ?? ''))
      if (error) { resolve({ error }); return }
      // Replace state. Clear hash so the loaded project takes precedence over
      // any stale permalink in the URL.
      enterMode(null)
      state.view = project.view
      state.standard = project.standard
      state.basemap = project.basemap
      state.peopleColorMode = normalizePeopleColorMode(project.peopleColorMode)
      state.peopleTint = state.peopleColorMode === 'zone'
      state.zones = project.zones
      state.selectedZoneId = project.zones[0]?.id ?? null
      history.replaceState(null, '', location.pathname + location.search)
      resolve({ ok: true })
    }
    reader.onerror = () => resolve({ error: 'Could not read file.' })
    reader.readAsText(file)
  })
}

watch(() => [state.view, state.zones, state.standard, state.basemap, state.peopleColorMode],
  () => scheduleShare(), { deep: true })

watch(() => state.peopleColorMode, (mode) => {
  state.peopleColorMode = normalizePeopleColorMode(mode, state.peopleTint)
  state.peopleTint = state.peopleColorMode === 'zone'
})

watch(() => state.peopleTint, (on) => {
  if (on && state.peopleColorMode !== 'zone') state.peopleColorMode = 'zone'
  if (!on && state.peopleColorMode === 'zone') state.peopleColorMode = 'neutral'
})

// Persist the building source + Google API key to localStorage only. They
// are NOT included in the permalink hash or the project-file serializer
// (an API key in a shareable URL or downloaded file would leak it).
watch(() => state.buildingSource, (v) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem('crowd-count-building-source', v)
})
watch(() => state.googleMapsKey, (v) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem('crowd-count-google-key', v)
})

// Keep the 3D building source consistent with the 2D basemap. Picking a
// Google tile in the basemap dropdown should auto-flip 3D to Google;
// picking OSM/Esri should revert 3D back to OSM buildings. Without this
// the user can end up looking at Google photorealistic buildings while
// their basemap dropdown reads "OpenStreetMap".
watch(() => state.basemap, (bm) => {
  state.buildingSource = bm.startsWith('google-') ? 'google' : 'osm'
}, { immediate: true })

// Module-level Ctrl+Z + Esc key listener. Replace the previous copy during
// Vite HMR so key behaviour updates without a full browser restart.
if (typeof window !== 'undefined') {
  if (window.__crowdCountKeyHandler) {
    window.removeEventListener('keydown', window.__crowdCountKeyHandler)
  }
  const handler = (e) => {
    const t = e.target
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    // Esc — exit any active mode cleanly.
    if (e.key === 'Escape' && !inField) {
      if (state.ruler.active) {
        finishRuler()
        e.preventDefault()
        return
      }
      if (state.drawing || state.indoor.calibration) {
        enterMode(null)
        e.preventDefault()
        return
      }
      if (state.aiming) {
        enterMode(null)
        e.preventDefault()
        return
      }
      if (state.gradientPicking) {
        cancelGradientPick()
        e.preventDefault()
        return
      }
    }
    // Enter — commit the current polygon / obstruction (only if it has ≥3 vertices).
    // Circles and rects commit on their own second click and don't need this.
    if (e.key === 'Enter' && !inField) {
      // Gradient direction: two map clicks define the axis; Enter commits it.
      if (state.gradientPicking) {
        const pick = state.gradientPicking
        const z = state.zones.find(zz => zz.id === pick.zoneId)
        if (pick.step === 'confirm' && z?.densityGradient?.start && z.densityGradient?.end) {
          clearSampleCache(z.id)
          enterMode(null)
          e.preventDefault()
          return
        }
      }
      // Ruler polyline: finish and keep the current measurement visible.
      if (state.ruler.active && state.ruler.points.length >= 2) {
        finishRuler()
        e.preventDefault()
        return
      }
      // Obstruction polygon
      if (state.drawing === 'obstruction' && state.activeObstructionId) {
        const z = state.zones.find(zz => zz.id === state.selectedZoneId)
        const o = z?.obstructions.find(oo => oo.id === state.activeObstructionId)
        if (o && o.vertices.length >= 3) {
          enterMode(null)
          e.preventDefault()
          return
        }
      }
      // Zone polygon
      if (state.drawing === 'zone') {
        const z = state.zones.find(zz => zz.id === state.selectedZoneId)
        if (z && z.shape === 'polygon' && z.vertices.length >= 3) {
          enterMode(null)
          e.preventDefault()
          return
        }
        if (z && (z.shape === 'circle' || z.shape === 'rect') && commitParametricZone(z)) {
          e.preventDefault()
          return
        }
      }
    }
    // Ctrl/Cmd+Z — undo last vertex (zone or obstruction, or ruler point).
    const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key && e.key.toLowerCase() === 'z'
    if (!isUndo) return
    if (inField) return
    // Ruler polyline takes priority while active.
    if (state.ruler.active && state.ruler.points.length > 0) {
      state.ruler.points.pop()
      e.preventDefault()
      return
    }
    if (!state.drawing) return
    if (undoLastVertex()) e.preventDefault()
  }
  window.addEventListener('keydown', handler)
  window.__crowdCountKeyHandler = handler
}

function getSelectedZone() {
  return state.zones.find(z => z.id === state.selectedZoneId) ?? null
}

export function useApp() {
  return {
    state,
    getSelectedZone, computeTotals,
    addZone, deleteZone, selectZone, setDrawing, undoLastVertex,
    addObstruction, deleteObstruction, getActiveObstruction,
    enterMode, finishRuler, startGradientPick,
    zoneAreaM2, zoneGrossAreaM2, zoneNetAreaM2, obstructionAreaM2,
    zoneBadge, zoneAverageDensity, zonePeopleCount, densityAtPoint, zoneRiskDensity,
    restoreFromUrl, shareLink,
    saveProjectToFile, openProjectFromFile,
    sampleZonePoints, clearSampleCache, gcSampleCache,
  }
}
