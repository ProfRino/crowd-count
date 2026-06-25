import { reactive, watch } from 'vue'
import { geodesicAreaM2, planarAreaM2 } from './area.js'
import { badgeFor } from './standards.js'
import { encodeState, decodeState, pickColor } from './share.js'

const DEFAULT_VIEW = { lng: -77.0470, lat: 38.8895, zoom: 16 }  // National Mall, in front of the Lincoln Memorial

const state = reactive({
  mode: 'outdoor',  // 'outdoor' | 'indoor'
  basemap: 'osm',   // 'osm' | 'satellite'
  units: 'metric',  // 'metric' | 'imperial' — display-only
  view: { ...DEFAULT_VIEW },
  standard: 'purple',
  zones: [],
  selectedZoneId: null,
  drawing: false,
  indoor: { imageUrl: null, calibration: null, pixelsPerMeter: null },
  ui: { aboutOpen: false, justShared: false },
})

function newZoneId() { return 'z' + Math.random().toString(36).slice(2, 8) }

function addZone(name = null) {
  const i = state.zones.length
  const z = {
    id: newZoneId(),
    name: name ?? `Zone ${i + 1}`,
    density: 1.5,
    vertices: [],
    color: pickColor(i),
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

function setDrawing(on) { state.drawing = on }

function undoLastVertex() {
  const z = state.zones.find(zz => zz.id === state.selectedZoneId)
  if (!z || !z.vertices.length) return false
  z.vertices.pop()
  return true
}

function zoneAreaM2(zone) {
  if (state.mode === 'indoor') return planarAreaM2(zone.vertices, state.indoor.pixelsPerMeter)
  return geodesicAreaM2(zone.vertices)
}

function computeTotals() {
  let area = 0, count = 0
  for (const z of state.zones) {
    const a = zoneAreaM2(z)
    area += a
    count += a * z.density
  }
  return { area, count: Math.round(count) }
}

function zoneBadge(zone) { return badgeFor(zone.density, state.standard) }

// Permalink — encode into URL fragment, debounced.
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

// Module-level Ctrl+Z / Cmd+Z listener — attached once, survives Vue HMR cycles.
if (typeof window !== 'undefined' && !window.__crowdCountKeyHandler) {
  const handler = (e) => {
    if (!state.drawing) return
    const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key && e.key.toLowerCase() === 'z'
    if (!isUndo) return
    const t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
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
    zoneAreaM2, zoneBadge,
    restoreFromUrl, shareLink,
  }
}
