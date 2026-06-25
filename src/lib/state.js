import { reactive, watch } from 'vue'
import { geodesicAreaM2, planarAreaM2 } from './area.js'
import { badgeFor } from './standards.js'
import { encodeState, decodeState, pickColor } from './share.js'
import { rebuildVertices } from './shapes.js'

const DEFAULT_VIEW = { lng: -77.0470, lat: 38.8895, zoom: 16 }  // National Mall, in front of the Lincoln Memorial

const state = reactive({
  mode: 'outdoor',  // 'outdoor' | 'indoor'
  basemap: 'osm',   // 'osm' | 'satellite'
  units: 'metric',  // 'metric' | 'imperial' — display-only
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
  ui: { aboutOpen: false, justShared: false },
})

function newZoneId() { return 'z' + Math.random().toString(36).slice(2, 8) }
function newObstructionId() { return 'o' + Math.random().toString(36).slice(2, 8) }

function addZone(name = null, shape = state.drawTool ?? 'polygon', params = null) {
  const i = state.zones.length
  const z = {
    id: newZoneId(),
    name: name ?? `Zone ${i + 1}`,
    density: 1.5,
    color: pickColor(i),
    shape,            // 'polygon' | 'circle' | 'rect'
    params,           // null for polygon; { kind, center, radiusM } for circle; { kind, a, b } for rect
    vertices: [],     // derived for circle/rect (via rebuildVertices); authored for polygon
    obstructions: [], // inner rings: [{ id, vertices }]
  }
  state.zones.push(z)
  state.selectedZoneId = z.id
  return z
}

function deleteZone(id) {
  const i = state.zones.findIndex(z => z.id === id)
  if (i === -1) return
  state.zones.splice(i, 1)
  if (state.selectedZoneId === id) state.selectedZoneId = state.zones[0]?.id ?? null
}

function selectZone(id) { state.selectedZoneId = id }

// Mutual-exclusion gate: at most one of {drawing, calibrating, ruler} is active.
// mode ∈ 'drawing' | 'obstruction' | 'calibrating' | 'ruler' | null. Returns the chosen state value.
function enterMode(mode) {
  // Always clear all three first.
  state.drawing = false
  state.activeObstructionId = null
  state.indoor.calibration = null
  state.ruler.active = false
  state.ruler.points = []
  state.ruler.cursor = null
  if (mode === 'drawing') state.drawing = 'zone'
  else if (mode === 'obstruction') state.drawing = 'obstruction'
  else if (mode === 'ruler') state.ruler.active = true
  // 'calibrating' is set up by the caller (IndoorOverlay) after this returns.
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
    count += a * z.density
  }
  return { area, count: Math.round(count) }
}

function zoneBadge(zone) { return badgeFor(zone.density, state.standard) }

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
      view: state.view, standard: state.standard, basemap: state.basemap, zones: state.zones,
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
  state.zones = restored.zones
  state.selectedZoneId = restored.zones[0]?.id ?? null
  return true
}

function shareLink() {
  const hash = encodeState({
    view: state.view, standard: state.standard, basemap: state.basemap, zones: state.zones,
  })
  return location.origin + location.pathname + '#' + hash
}

watch(() => [state.view, state.zones, state.standard, state.basemap],
  () => scheduleShare(), { deep: true })

// Module-level Ctrl+Z + Esc key listener — attached once, survives Vue HMR cycles.
if (typeof window !== 'undefined' && !window.__crowdCountKeyHandler) {
  const handler = (e) => {
    const t = e.target
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    // Esc — exit any active mode cleanly. Also pops last ruler point if mid-polyline.
    if (e.key === 'Escape' && !inField) {
      if (state.ruler.active) {
        // Drop last polyline point first; second Esc exits ruler mode.
        if (state.ruler.points.length > 0) {
          state.ruler.points.pop()
          if (state.ruler.points.length === 0) enterMode(null)
        } else {
          enterMode(null)
        }
        e.preventDefault()
        return
      }
      if (state.drawing || state.indoor.calibration) {
        enterMode(null)
        e.preventDefault()
        return
      }
    }
    // Enter — commit the current polygon / obstruction (only if it has ≥3 vertices).
    // Circles and rects commit on their own second click and don't need this.
    if (e.key === 'Enter' && !inField) {
      // Ruler polyline: finish + clear cursor (mirror double-click behaviour).
      if (state.ruler.active && state.ruler.points.length >= 2) {
        state.ruler.cursor = null
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
    enterMode,
    zoneAreaM2, zoneGrossAreaM2, zoneNetAreaM2, obstructionAreaM2,
    zoneBadge,
    restoreFromUrl, shareLink,
  }
}
