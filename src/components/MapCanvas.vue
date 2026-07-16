<script setup>
import { onMounted, onBeforeUnmount, watch, ref, computed } from 'vue'
import maplibregl from 'maplibre-gl'
import { useApp } from '../lib/state.js'
import { makePersonTopIcon, makePersonShouldersMask, makePersonHeadMask, PERSON_SOURCE_WIDTH_PX } from '../lib/peopleSymbol.js'
import { rebuildVertices, geoDistanceM } from '../lib/shapes.js'
import { polylineTotals, radiusMeters, fmtDistance, circleAreaM2 } from '../lib/ruler.js'
import { HUMAN_TOP_DEPTH_M, HUMAN_TOP_WIDTH_M } from '../lib/humanScale.js'
import { normalizePeopleColorMode, personAppearance, personSeed } from '../lib/peopleAppearance.js'

const {
  state, getSelectedZone, zoneBadge, zoneAreaM2,
  addZone, addObstruction, enterMode, finishRuler,
  sampleZonePoints, clearSampleCache, gcSampleCache,
} = useApp()
const selectedZone = computed(() => getSelectedZone())

const container = ref(null)
const peopleCanvas = ref(null)
let map = null
// dragging now describes which handle is being dragged:
// { kind: 'vertex'|'obstruction-vertex'|'center'|'radius'|'corner'|'facing'|'gradient-start'|'gradient-end',
//   zoneId, obstructionId?, vertexIdx?, cornerIdx? }
let dragging = null
let suppressNextClick = false
let peopleCanvasRaf = null

const STYLE = {
  version: 8,
  sources: {
    osm: { type: 'raster', tileSize: 256, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
    satellite: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Tiles &copy; Esri' },
  },
  layers: [
    { id: 'osm-tiles', type: 'raster', source: 'osm', layout: { visibility: 'visible' } },
    { id: 'sat-tiles', type: 'raster', source: 'satellite', layout: { visibility: 'none' } },
  ],
}

// --- Google Maps Tiles API session-token helper ---------------------------
// Google's 2D map tiles need a one-time session token (per mapType per key)
// that's then sent with every tile request. We cache it in-memory; the token
// is valid for ~2 weeks but we refetch on each viewmap-key change.
const googleSessionTokens = {}   // { 'roadmap': '...', 'satellite': '...' }
const googleSessionKey = { value: '' }
async function getGoogleSessionToken(mapType) {
  if (state.googleMapsKey !== googleSessionKey.value) {
    Object.keys(googleSessionTokens).forEach(k => delete googleSessionTokens[k])
    googleSessionKey.value = state.googleMapsKey
  }
  if (googleSessionTokens[mapType]) return googleSessionTokens[mapType]
  if (!state.googleMapsKey) throw new Error('No Google Maps API key set.')
  const resp = await fetch(`https://tile.googleapis.com/v1/createSession?key=${state.googleMapsKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapType, language: 'en-US', region: 'US' }),
  })
  if (!resp.ok) throw new Error(`Google session token: HTTP ${resp.status}`)
  const data = await resp.json()
  if (!data.session) throw new Error('Google session token response missing `session` field.')
  googleSessionTokens[mapType] = data.session
  return data.session
}

function closedRing(verts) {
  if (verts.length < 1) return verts
  const first = verts[0], last = verts[verts.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) return verts
  return [...verts, first]
}

// Outer ring plus inner-ring holes inside a single MapLibre Polygon feature so
// the fill is automatically punched out where the obstructions are.
function zonesAsFillCollection() {
  return {
    type: 'FeatureCollection',
    features: state.zones
      .filter(z => z.vertices.length >= 3)
      .map(z => ({
        type: 'Feature',
        properties: { id: z.id, color: z.color, selected: z.id === state.selectedZoneId },
        geometry: {
          type: 'Polygon',
          coordinates: [
            closedRing(z.vertices),
            ...(z.obstructions ?? []).filter(o => o.vertices.length >= 3).map(o => closedRing(o.vertices)),
          ],
        },
      })),
  }
}

function zonesAsLineCollection() {
  return {
    type: 'FeatureCollection',
    features: state.zones
      .filter(z => z.vertices.length >= 2)
      .map(z => ({
        type: 'Feature',
        properties: { id: z.id, color: z.color, selected: z.id === state.selectedZoneId },
        geometry: { type: 'LineString', coordinates: closedRing(z.vertices) },
      })),
  }
}

// Each obstruction renders as its own line so its dashed outline is visible
// on top of the punched-out fill.
function obstructionsAsLineCollection() {
  const feats = []
  for (const z of state.zones) {
    for (const o of z.obstructions ?? []) {
      if (o.vertices.length < 2) continue
      feats.push({
        type: 'Feature',
        properties: { zoneId: z.id, obstructionId: o.id, color: z.color },
        geometry: { type: 'LineString', coordinates: closedRing(o.vertices) },
      })
    }
  }
  return { type: 'FeatureCollection', features: feats }
}

// Handles: vertex (polygon), obstruction-vertex, center+radius (circle), corners (rect).
function handlesCollection() {
  const feats = []
  for (const z of state.zones) {
    if (z.shape === 'circle' && z.params) {
      // Center + a synthetic radius handle on bearing 90° (east).
      feats.push({ type: 'Feature',
        properties: { kind: 'center', zoneId: z.id, color: z.color },
        geometry: { type: 'Point', coordinates: z.params.center } })
      if (z.vertices.length) {
        // Use the first vertex (bearing 0) as a draggable rim handle.
        feats.push({ type: 'Feature',
          properties: { kind: 'radius', zoneId: z.id, color: z.color },
          geometry: { type: 'Point', coordinates: z.vertices[0] } })
      }
    } else if (z.shape === 'rect' && z.params) {
      // 4 corner handles in the same order rebuildVertices produces:
      // a, [b.x,a.y], b, [a.x,b.y].
      const [ax, ay] = z.params.a, [bx, by] = z.params.b
      const corners = [[ax, ay], [bx, ay], [bx, by], [ax, by]]
      for (let i = 0; i < 4; i++) {
        feats.push({ type: 'Feature',
          properties: { kind: 'corner', zoneId: z.id, cornerIdx: i, color: z.color },
          geometry: { type: 'Point', coordinates: corners[i] } })
      }
    } else {
      // Polygon: one handle per vertex.
      for (let i = 0; i < z.vertices.length; i++) {
        feats.push({ type: 'Feature',
          properties: { kind: 'vertex', zoneId: z.id, vertexIdx: i, color: z.color },
          geometry: { type: 'Point', coordinates: z.vertices[i] } })
      }
    }
    // Obstruction vertices — always polygon-style regardless of parent zone shape.
    for (const o of z.obstructions ?? []) {
      for (let i = 0; i < o.vertices.length; i++) {
        feats.push({ type: 'Feature',
          properties: { kind: 'obstruction-vertex', zoneId: z.id, obstructionId: o.id, vertexIdx: i, color: z.color },
          geometry: { type: 'Point', coordinates: o.vertices[i] } })
      }
    }
  }
  return { type: 'FeatureCollection', features: feats }
}

// Half-width (m) of an average human standing footprint. This is the real
// anatomical display size and never
// changes with density — at higher density the same-sized people just
// overlap, which is what actually happens in a crowd.
const PERSON_FOOTPRINT_RADIUS_M = HUMAN_TOP_WIDTH_M / 2
const PERSON_FOOTPRINT_DEPTH_RADIUS_M = HUMAN_TOP_DEPTH_M / 2
const CANVAS_PEOPLE_THRESHOLD = 50000

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] }
}

function drawablePeopleZones() {
  const out = []
  for (const z of state.zones) {
    if ((state.drawing && z.id === state.selectedZoneId) || state.gradientPicking?.zoneId === z.id) {
      clearSampleCache(z.id)
      continue
    }
    if (z.vertices.length < 3) {
      clearSampleCache(z.id)
      continue
    }
    out.push(z)
  }
  return out
}

function estimatedDrawablePeopleCount(zones = drawablePeopleZones()) {
  return zones.reduce((sum, z) => sum + Math.max(0, zoneAreaM2(z) * z.density), 0)
}

function useCanvasPeople() {
  return estimatedDrawablePeopleCount() > CANVAS_PEOPLE_THRESHOLD
}

// People positions come from the shared sample cache in state.js so 3D and
// 2D show identical dots. The cache invalidates per-zone-signature.
function peopleCollection() {
  const feats = []
  if (useCanvasPeople()) return emptyFeatureCollection()
  for (const z of drawablePeopleZones()) {
    const { points, rot } = sampleZonePoints(z)
    if (points.length === 0) continue
    for (let i = 0; i < points.length; i++) {
      const appearance = personAppearance(personSeed(z.id, i, points[i]))
      feats.push({
        type: 'Feature',
        properties: {
          rot: rot[i],
          color: z.color,
          bodyColor: appearance.clothing,
          skinColor: appearance.skin,
          r_m: PERSON_FOOTPRINT_RADIUS_M,
          lat: points[i][1],
        },
        geometry: { type: 'Point', coordinates: points[i] },
      })
    }
  }
  gcSampleCache()
  return { type: 'FeatureCollection', features: feats }
}

function setMapPeopleLayersVisible(visible) {
  if (!map) return
  for (const id of ['people', 'people-tint', 'people-tint-head']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
  }
}

function pixelsPerMeterAtMapCenter() {
  if (!map) return 1
  const c = map.getCenter()
  const mPerDegLng = 111320 * Math.cos(c.lat * Math.PI / 180)
  const a = map.project([c.lng, c.lat])
  const b = map.project([c.lng + 1 / mPerDegLng, c.lat])
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function syncPeopleCanvasSize(canvas) {
  const host = container.value
  if (!canvas || !host) return false
  const w = host.clientWidth
  const h = host.clientHeight
  if (!w || !h) return false
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const targetW = Math.round(w * dpr)
  const targetH = Math.round(h * dpr)
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW
    canvas.height = targetH
  }
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return true
}

function clearPeopleCanvas() {
  const canvas = peopleCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  canvas.style.display = 'none'
}

function drawCanvasPerson(ctx, x, y, widthRadiusPx, depthRadiusPx, rotationDeg, color, headColor = null) {
  const r = Math.max(0.55, widthRadiusPx)
  const ry = Math.max(0.4, depthRadiusPx)
  const rot = (Number(rotationDeg) || 0) * Math.PI / 180
  ctx.fillStyle = color
  if (r < 1.1) {
    ctx.fillRect(x - 0.5, y - 0.5, 1, 1)
    return
  }
  ctx.beginPath()
  ctx.ellipse(x, y, r, ry, rot, 0, Math.PI * 2)
  ctx.fill()
  if (headColor && r >= 1.8) {
    const headR = Math.max(0.55, r * 0.34)
    const headOffset = Math.min(r * 0.28, ry * 0.65)
    ctx.fillStyle = headColor
    ctx.beginPath()
    ctx.arc(
      x + Math.sin(rot) * headOffset,
      y - Math.cos(rot) * headOffset,
      headR,
      0,
      Math.PI * 2
    )
    ctx.fill()
  }
}

function drawPeopleCanvasNow() {
  peopleCanvasRaf = null
  if (!map || !peopleCanvas.value) return
  if (!useCanvasPeople()) {
    clearPeopleCanvas()
    return
  }

  const canvas = peopleCanvas.value
  if (!syncPeopleCanvasSize(canvas)) return
  canvas.style.display = 'block'

  const ctx = canvas.getContext('2d')
  const w = container.value.clientWidth
  const h = container.value.clientHeight
  ctx.clearRect(0, 0, w, h)
  ctx.globalAlpha = 0.88

  const mode = currentPeopleColorMode()
  const pxPerM = pixelsPerMeterAtMapCenter()
  const widthRadiusPx = Math.max(0.55, PERSON_FOOTPRINT_RADIUS_M * pxPerM)
  const depthRadiusPx = Math.max(0.4, PERSON_FOOTPRINT_DEPTH_RADIUS_M * pxPerM)
  for (const z of drawablePeopleZones()) {
    const { points, rot } = sampleZonePoints(z)
    if (!points.length) continue
    const zoneColor = z.color || '#2563eb'
    for (let i = 0; i < points.length; i++) {
      const p = map.project(points[i])
      if (p.x < -4 || p.y < -4 || p.x > w + 4 || p.y > h + 4) continue
      if (mode === 'natural') {
        const appearance = personAppearance(personSeed(z.id, i, points[i]))
        drawCanvasPerson(ctx, p.x, p.y, widthRadiusPx, depthRadiusPx, rot[i], appearance.upperClothing, appearance.skin)
      } else {
        drawCanvasPerson(ctx, p.x, p.y, widthRadiusPx, depthRadiusPx, rot[i], mode === 'zone' ? zoneColor : '#f8fafc')
      }
    }
  }
  ctx.globalAlpha = 1
  gcSampleCache()
}

function schedulePeopleCanvasDraw() {
  if (peopleCanvasRaf != null) return
  peopleCanvasRaf = requestAnimationFrame(drawPeopleCanvasNow)
}

function refreshPeopleRendering() {
  if (!map || !map.getSource('people')) return
  const canvasMode = useCanvasPeople()
  if (canvasMode) {
    map.getSource('people').setData(emptyFeatureCollection())
    setMapPeopleLayersVisible(false)
    schedulePeopleCanvasDraw()
    return
  }
  clearPeopleCanvas()
  map.getSource('people').setData(peopleCollection())
  applyPeopleColorMode()
}

function currentPeopleColorMode() {
  return normalizePeopleColorMode(state.peopleColorMode, state.peopleTint)
}

function applyPeopleColorMode() {
  if (!map || !map.getLayer('people')) return
  if (useCanvasPeople()) {
    setMapPeopleLayersVisible(false)
    schedulePeopleCanvasDraw()
    return
  }
  const mode = currentPeopleColorMode()
  const colored = mode !== 'neutral'
  if (map.getLayer('people')) {
    map.setLayoutProperty('people', 'visibility', colored ? 'none' : 'visible')
  }
  if (map.getLayer('people-tint')) {
    map.setLayoutProperty('people-tint', 'visibility', colored ? 'visible' : 'none')
    map.setPaintProperty('people-tint', 'icon-color',
      mode === 'natural' ? ['get', 'bodyColor'] : ['get', 'color'])
  }
  if (map.getLayer('people-tint-head')) {
    map.setLayoutProperty('people-tint-head', 'visibility', colored ? 'visible' : 'none')
    map.setPaintProperty('people-tint-head', 'icon-color',
      mode === 'natural' ? ['get', 'skinColor'] : '#0f172a')
  }
}

// Ruler GeoJSON ------------------------------------------------------------
function rulerLineCollection() {
  const pts = [...state.ruler.points]
  if (state.ruler.cursor && pts.length > 0) pts.push(state.ruler.cursor)
  if (pts.length < 2) return { type: 'FeatureCollection', features: [] }
  return { type: 'FeatureCollection', features: [{
    type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: pts },
  }] }
}
function rulerVerticesCollection() {
  return {
    type: 'FeatureCollection',
    features: state.ruler.points.map((p, i) => ({
      type: 'Feature', properties: { idx: i },
      geometry: { type: 'Point', coordinates: p },
    })),
  }
}

// Target markers — one per zone that has a facingPoint set. Same source feeds
// the circle dot AND the line connecting the zone centroid to the target so
// it's obvious which zone is aimed at which point when there are several.
function facingMarkersCollection() {
  const feats = []
  for (const z of state.zones) {
    if (!z.facingPoint) continue
    feats.push({
      type: 'Feature',
      properties: { color: z.color, zoneId: z.id },
      geometry: { type: 'Point', coordinates: z.facingPoint },
    })
  }
  return { type: 'FeatureCollection', features: feats }
}
function facingLinesCollection() {
  const feats = []
  for (const z of state.zones) {
    if (!z.facingPoint || z.vertices.length < 3) continue
    let cx = 0, cy = 0
    for (const [x, y] of z.vertices) { cx += x; cy += y }
    cx /= z.vertices.length; cy /= z.vertices.length
    feats.push({
      type: 'Feature',
      properties: { color: z.color },
      geometry: { type: 'LineString', coordinates: [[cx, cy], z.facingPoint] },
    })
  }
  return { type: 'FeatureCollection', features: feats }
}

function gradientLinesCollection() {
  const feats = []
  for (const z of state.zones) {
    if (z.densityMode !== 'gradient' || !z.densityGradient?.start || !z.densityGradient?.end) continue
    feats.push({
      type: 'Feature',
      properties: { color: z.color, zoneId: z.id },
      geometry: { type: 'LineString', coordinates: [z.densityGradient.start, z.densityGradient.end] },
    })
  }
  return { type: 'FeatureCollection', features: feats }
}

function gradientMarkersCollection() {
  const feats = []
  for (const z of state.zones) {
    if (z.densityMode !== 'gradient' || !z.densityGradient?.start) continue
    feats.push({
      type: 'Feature',
      properties: { color: z.color, zoneId: z.id, kind: 'start' },
      geometry: { type: 'Point', coordinates: z.densityGradient.start },
    })
    if (z.densityGradient?.end) {
      feats.push({
        type: 'Feature',
        properties: { color: z.color, zoneId: z.id, kind: 'end' },
        geometry: { type: 'Point', coordinates: z.densityGradient.end },
      })
    }
  }
  return { type: 'FeatureCollection', features: feats }
}

function refreshSources() {
  if (!map) return
  map.getSource('zones-fill')?.setData(zonesAsFillCollection())
  map.getSource('zones-line')?.setData(zonesAsLineCollection())
  map.getSource('obstructions-line')?.setData(obstructionsAsLineCollection())
  map.getSource('handles')?.setData(handlesCollection())
  map.getSource('facing-markers')?.setData(facingMarkersCollection())
  map.getSource('facing-lines')?.setData(facingLinesCollection())
  map.getSource('gradient-lines')?.setData(gradientLinesCollection())
  map.getSource('gradient-markers')?.setData(gradientMarkersCollection())
}
function refreshRulerSources() {
  if (!map) return
  map.getSource('ruler-line')?.setData(rulerLineCollection())
  map.getSource('ruler-vertices')?.setData(rulerVerticesCollection())
}

let peopleTimer = null
function schedulePeopleRefresh() {
  if (!map) return
  clearTimeout(peopleTimer)
  peopleTimer = setTimeout(() => refreshPeopleRendering(), 120)
}
// Pretty name + the mapType to ask Google for (or null for non-Google).
const BASEMAPS = {
  osm:                { label: 'OSM',              google: null },
  satellite:          { label: 'Esri satellite',   google: null },
  'google-roadmap':   { label: 'Google roadmap',   google: 'roadmap' },
  'google-satellite': { label: 'Google satellite', google: 'satellite' },
}

// Pending fetches we are mid-flight on, so we don't double-add the source.
const googleLayersAdded = {}   // { 'google-roadmap': true, ... }

async function ensureGoogleLayer(basemapKey) {
  if (!map) return
  if (googleLayersAdded[basemapKey]) return
  const cfg = BASEMAPS[basemapKey]
  if (!cfg?.google) return
  const session = await getGoogleSessionToken(cfg.google)
  const url = `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${session}&key=${state.googleMapsKey}`
  const sourceId = `src-${basemapKey}`
  const layerId  = `tiles-${basemapKey}`
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: 'raster', tileSize: 256, maxzoom: 22, tiles: [url],
      attribution: '&copy; Google',
    })
  }
  if (!map.getLayer(layerId)) {
    // Insert below the people / handles / zone layers so the basemap stays
    // beneath everything else.
    const beforeId = map.getLayer('zones-fill') ? 'zones-fill' : undefined
    map.addLayer({ id: layerId, type: 'raster', source: sourceId, layout: { visibility: 'none' } }, beforeId)
  }
  googleLayersAdded[basemapKey] = true
}

function applyBasemap() {
  if (!map) return
  // First-load race: the watcher can fire before MapLibre finishes parsing
  // the style. Defer until the map reports the style is ready.
  if (!map.isStyleLoaded()) {
    map.once('idle', applyBasemap)
    return
  }
  // Loop over every known basemap and toggle visibility — covers OSM, Esri,
  // and any Google layers that have already been initialised.
  const visibleKey = state.basemap
  const setVis = (id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none')
  }
  setVis('osm-tiles')
  setVis('sat-tiles')
  Object.keys(BASEMAPS).filter(k => BASEMAPS[k].google).forEach(k => setVis(`tiles-${k}`))

  if (visibleKey === 'osm') {
    map.setLayoutProperty('osm-tiles', 'visibility', 'visible')
    return
  }
  if (visibleKey === 'satellite') {
    map.setLayoutProperty('sat-tiles', 'visibility', 'visible')
    return
  }
  // Google option — lazily add the layer (one-time per session) then show it.
  const cfg = BASEMAPS[visibleKey]
  if (cfg?.google) {
    ensureGoogleLayer(visibleKey).then(() => {
      if (state.basemap === visibleKey && map.getLayer(`tiles-${visibleKey}`)) {
        map.setLayoutProperty(`tiles-${visibleKey}`, 'visibility', 'visible')
      }
    }).catch((err) => {
      // Fallback to OSM if Google fails (bad key, billing missing, etc.)
      console.warn('Google basemap failed:', err.message)
      state.basemap = 'osm'
      map.setLayoutProperty('osm-tiles', 'visibility', 'visible')
    })
  }
}

// Make a diagonal-stripe hatch image for the obstruction overlay.
function makeHatchImage() {
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const ctx = c.getContext('2d')
  ctx.fillStyle = 'rgba(0,0,0,0)'
  ctx.fillRect(0, 0, 16, 16)
  ctx.strokeStyle = 'rgba(15,23,42,0.7)'
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let i = -16; i < 32; i += 6) {
    ctx.moveTo(i, 0); ctx.lineTo(i + 16, 16)
  }
  ctx.stroke()
  return ctx.getImageData(0, 0, 16, 16)
}

onMounted(() => {
  map = new maplibregl.Map({
    container: container.value, style: STYLE,
    center: [state.view.lng, state.view.lat], zoom: state.view.zoom,
    attributionControl: { compact: true },
  })
  if (typeof window !== 'undefined') window.__map = map

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  const scaleCtrl = new maplibregl.ScaleControl({ maxWidth: 140, unit: state.units })
  map.addControl(scaleCtrl, 'bottom-left')
  watch(() => state.units, (u) => { if (map) scaleCtrl.setUnit(u) })

  map.on('load', () => {
    const { imageData, pixelRatio } = makePersonTopIcon()
    map.addImage('person-top', imageData, { pixelRatio })
    // Tint mode renders the icon as TWO separate SDF symbols stacked on the
    // same anchor: the shoulders take the zone colour, the head stays a fixed
    // dark circle on top. This keeps the head concentric with the shoulders
    // (matches the default icon) while still being visible against any tint.
    const shoulders = makePersonShouldersMask()
    const head = makePersonHeadMask()
    map.addImage('person-shoulders-tint', shoulders.imageData,
      { pixelRatio: shoulders.pixelRatio, sdf: true })
    map.addImage('person-head-tint', head.imageData,
      { pixelRatio: head.pixelRatio, sdf: true })
    map.addImage('hatch-stripe', makeHatchImage())

    map.addSource('zones-fill', { type: 'geojson', data: zonesAsFillCollection() })
    map.addSource('zones-line', { type: 'geojson', data: zonesAsLineCollection() })
    map.addSource('obstructions-line', { type: 'geojson', data: obstructionsAsLineCollection() })
    map.addSource('people', { type: 'geojson', data: peopleCollection() })
    map.addSource('handles', { type: 'geojson', data: handlesCollection() })
    map.addSource('ruler-line', { type: 'geojson', data: rulerLineCollection() })
    map.addSource('ruler-vertices', { type: 'geojson', data: rulerVerticesCollection() })
    map.addSource('facing-lines', { type: 'geojson', data: facingLinesCollection() })
    map.addSource('facing-markers', { type: 'geojson', data: facingMarkersCollection() })
    map.addSource('gradient-lines', { type: 'geojson', data: gradientLinesCollection() })
    map.addSource('gradient-markers', { type: 'geojson', data: gradientMarkersCollection() })

    map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones-fill',
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'selected'], 0.25, 0.12] } })
    map.addLayer({ id: 'zones-line', type: 'line', source: 'zones-line',
      paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 3, 2] } })
    // Person icon drawn at REAL ground width (2 × r_m metres). MapLibre
    // forbids `['zoom']` outside a top-level interpolate/step, so we can't
    // bake the pixels-per-metre formula into the expression. Instead the
    // layers start with a feature-only multiplier and we patch in the
    // current pxPerM via setPaintProperty / setLayoutProperty on every
    // zoom / move event (see updatePeopleSizing below).
    map.addLayer({ id: 'people', type: 'symbol', source: 'people',
      layout: { 'icon-image': 'person-top', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-rotation-alignment': 'map', 'icon-rotate': ['get', 'rot'],
        'icon-size': ['/', ['*', 2, ['get', 'r_m'], 1], PERSON_SOURCE_WIDTH_PX],
        'visibility': currentPeopleColorMode() === 'neutral' ? 'visible' : 'none' },
      minzoom: 13 })
    // Colour modes share two stacked symbol layers: shoulders/body take the
    // selected mode colour, head stays visible on top.
    map.addLayer({ id: 'people-tint', type: 'symbol', source: 'people',
      layout: { 'icon-image': 'person-shoulders-tint', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-rotation-alignment': 'map', 'icon-rotate': ['get', 'rot'],
        'icon-size': ['/', ['*', 2, ['get', 'r_m'], 1], PERSON_SOURCE_WIDTH_PX],
        'visibility': currentPeopleColorMode() === 'neutral' ? 'none' : 'visible' },
      paint: {
        'icon-color': currentPeopleColorMode() === 'natural' ? ['get', 'bodyColor'] : ['get', 'color'],
        // Subtle dark halo so light zone colours stay readable on light basemaps.
        'icon-halo-color': '#0f172a',
        'icon-halo-width': 0.4,
      },
      minzoom: 13 })
    map.addLayer({ id: 'people-tint-head', type: 'symbol', source: 'people',
      layout: { 'icon-image': 'person-head-tint', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-rotation-alignment': 'map', 'icon-rotate': ['get', 'rot'],
        'icon-size': ['/', ['*', 2, ['get', 'r_m'], 1], PERSON_SOURCE_WIDTH_PX],
        'visibility': currentPeopleColorMode() === 'neutral' ? 'none' : 'visible' },
      paint: { 'icon-color': currentPeopleColorMode() === 'natural' ? ['get', 'skinColor'] : '#0f172a' },
      minzoom: 13 })
    map.addLayer({ id: 'obstructions-line', type: 'line', source: 'obstructions-line',
      paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [3, 2] } })
    map.addLayer({ id: 'ruler-line', type: 'line', source: 'ruler-line',
      paint: { 'line-color': '#0284c7', 'line-width': 2, 'line-dasharray': [4, 3] } })
    map.addLayer({ id: 'ruler-vertices', type: 'circle', source: 'ruler-vertices',
      paint: { 'circle-radius': 4, 'circle-color': '#0284c7', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
    map.addLayer({ id: 'handles', type: 'circle', source: 'handles',
      paint: { 'circle-radius': 6, 'circle-color': '#ffffff',
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 } })

    // Facing-target connector line (centroid → focus point) — thin dashed
    // line in the zone's colour, drawn below the target dot so the dot
    // reads as the endpoint.
    map.addLayer({ id: 'facing-lines', type: 'line', source: 'facing-lines',
      paint: { 'line-color': ['get', 'color'], 'line-width': 2,
        'line-dasharray': [2, 2], 'line-opacity': 0.7 } })
    // Target dot — coloured ring + white centre so it's visible on any basemap.
    map.addLayer({ id: 'facing-markers', type: 'circle', source: 'facing-markers',
      paint: { 'circle-radius': 8, 'circle-color': '#ffffff',
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 3 } })

    map.addLayer({ id: 'gradient-lines', type: 'line', source: 'gradient-lines',
      paint: { 'line-color': ['get', 'color'], 'line-width': 3,
        'line-dasharray': [1.2, 1.2], 'line-opacity': 0.85 } })
    map.addLayer({ id: 'gradient-markers', type: 'circle', source: 'gradient-markers',
      paint: { 'circle-radius': ['case', ['==', ['get', 'kind'], 'start'], 6, 8],
        'circle-color': ['case', ['==', ['get', 'kind'], 'start'], '#ffffff', ['get', 'color']],
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 3 } })

    // Size the people icons at their TRUE real-world width (2 × r_m m = 0.6 m).
    //
    // CRITICAL: the zoom-scaling is baked into the icon-size EXPRESSION as a
    // top-level `interpolate` on `['zoom']`. MapLibre evaluates that per-frame
    // on the GPU with NO symbol re-placement, so icons scale smoothly while
    // zooming. The previous approach called setLayoutProperty('icon-size') on
    // every zoom/move frame, which forced a full symbol re-layout each frame
    // and made icons fade/flicker in and out. We now only recompute on
    // `moveend` (when latitude — hence pixels-per-metre — can have changed).
    //
    // pxPerM is calibrated from MapLibre's own projection (project two points
    // 1 m apart) so it can't drift from how the map actually renders — the old
    // hand-rolled formula assumed 256 px tiles, but MapLibre uses 512, which
    // rendered every person at half size. We derive the zoom-0 anchor p0 from
    // that measurement; pxPerM(z) = p0 · 2^z exactly, so an exponential-base-2
    // interpolation between two zoom stops is exact.
    //
    const Z_LO = 1, Z_HI = 24
    function pixelsPerMeter() {
      const c = map.getCenter()
      const mPerDegLng = 111320 * Math.cos(c.lat * Math.PI / 180)
      const a = map.project([c.lng, c.lat])
      const b = map.project([c.lng + 1 / mPerDegLng, c.lat])  // 1 m east
      return Math.hypot(b.x - a.x, b.y - a.y)
    }
    function setPeopleSizing() {
      if (!map.getLayer('people-tint') || !map.getLayer('people')) return
      const p0 = pixelsPerMeter() / Math.pow(2, map.getZoom())   // pxPerM at zoom 0
      const sizeAt = (px) => ['/',
        ['*', 2, ['get', 'r_m'], px],
        PERSON_SOURCE_WIDTH_PX]
      const iconSize = ['interpolate', ['exponential', 2], ['zoom'],
        Z_LO, sizeAt(p0 * Math.pow(2, Z_LO)),
        Z_HI, sizeAt(p0 * Math.pow(2, Z_HI))]
      map.setLayoutProperty('people', 'icon-size', iconSize)
      map.setLayoutProperty('people-tint', 'icon-size', iconSize)
      if (map.getLayer('people-tint-head')) {
        map.setLayoutProperty('people-tint-head', 'icon-size', iconSize)
      }
    }
    setPeopleSizing()
    refreshPeopleRendering()
    // Only recalibrate when movement settles (latitude may have changed). The
    // interpolate handles the zoom dimension itself, so NO per-frame updates.
    map.on('moveend', setPeopleSizing)
    map.on('move', schedulePeopleCanvasDraw)
    map.on('resize', schedulePeopleCanvasDraw)

    map.on('moveend', () => {
      const c = map.getCenter()
      state.view = { lng: c.lng, lat: c.lat, zoom: map.getZoom() }
    })

    // ===== HANDLE INTERACTION ===========================================
    function canDragHandleFeature(p) {
      if (state.ruler.active) return false
      if (!state.drawing) return true
      // While drawing a polygon, allow already-placed vertices to be refined.
      // Keep circle/rect draft handles inactive so the second click can still
      // finish those parametric shapes.
      return state.drawing === 'zone'
        && p.kind === 'vertex'
        && p.zoneId === state.selectedZoneId
    }
    function startHandleDrag(e) {
      if (dragging) return
      const p = e.features?.[0]?.properties
      if (!p || !canDragHandleFeature(p)) return
      e.preventDefault()
      state.selectedZoneId = p.zoneId
      dragging = {
        kind: p.kind, zoneId: p.zoneId,
        obstructionId: p.obstructionId || null,
        vertexIdx: p.vertexIdx ?? null,
        cornerIdx: p.cornerIdx ?? null,
      }
      map.getCanvas().style.cursor = 'grabbing'
      map.dragPan.disable()
    }
    map.on('mousedown', 'handles', startHandleDrag)
    map.on('touchstart', 'handles', startHandleDrag)
    map.on('mousedown', 'facing-markers', (e) => {
      if (state.ruler.active || state.drawing) return
      e.preventDefault()
      const p = e.features[0].properties
      dragging = { kind: 'facing', zoneId: p.zoneId }
      state.selectedZoneId = p.zoneId
      map.getCanvas().style.cursor = 'grabbing'
      map.dragPan.disable()
    })
    map.on('touchstart', 'facing-markers', (e) => {
      if (state.ruler.active || state.drawing) return
      e.preventDefault()
      const p = e.features[0].properties
      dragging = { kind: 'facing', zoneId: p.zoneId }
      state.selectedZoneId = p.zoneId
      map.getCanvas().style.cursor = 'grabbing'
      map.dragPan.disable()
    })
    function startGradientDrag(e) {
      const p = e.features?.[0]?.properties
      if (!p || (p.kind !== 'start' && p.kind !== 'end')) return
      if (state.ruler.active || state.drawing) return
      if (state.gradientPicking
        && (state.gradientPicking.step !== 'confirm' || state.gradientPicking.zoneId !== p.zoneId)) return
      e.preventDefault()
      dragging = { kind: `gradient-${p.kind}`, zoneId: p.zoneId }
      state.selectedZoneId = p.zoneId
      map.getCanvas().style.cursor = 'grabbing'
      map.dragPan.disable()
    }
    map.on('mousedown', 'gradient-markers', startGradientDrag)
    map.on('touchstart', 'gradient-markers', startGradientDrag)
    map.on('mousemove', (e) => {
      const ll = [e.lngLat.lng, e.lngLat.lat]
      // Ruler cursor preview
      if (state.ruler.active) {
        state.ruler.cursor = ll
        refreshRulerSources()
      }
      if (!dragging) return
      const z = state.zones.find(zz => zz.id === dragging.zoneId)
      if (!z) return
      if (dragging.kind === 'vertex') {
        z.vertices[dragging.vertexIdx] = ll
      } else if (dragging.kind === 'obstruction-vertex') {
        const o = z.obstructions.find(oo => oo.id === dragging.obstructionId)
        if (o) o.vertices[dragging.vertexIdx] = ll
      } else if (dragging.kind === 'center') {
        if (z.params) z.params.center = ll
      } else if (dragging.kind === 'radius') {
        if (z.params) z.params.radiusM = geoDistanceM(z.params.center, ll)
      } else if (dragging.kind === 'corner') {
        if (z.params) {
          const idx = dragging.cornerIdx
          if (idx === 0) z.params.a = ll
          else if (idx === 1) { z.params.b[0] = ll[0]; z.params.a[1] = ll[1] }
          else if (idx === 2) z.params.b = ll
          else if (idx === 3) { z.params.a[0] = ll[0]; z.params.b[1] = ll[1] }
        }
      } else if (dragging.kind === 'facing') {
        z.facingPoint = ll
        clearSampleCache(z.id)
      } else if (dragging.kind === 'gradient-start' || dragging.kind === 'gradient-end') {
        if (z.densityGradient) {
          z.densityGradient[dragging.kind === 'gradient-start' ? 'start' : 'end'] = ll
          clearSampleCache(z.id)
        }
      }
    })
    map.on('touchmove', (e) => {
      if (!dragging || !e.lngLat) return
      const ll = [e.lngLat.lng, e.lngLat.lat]
      const z = state.zones.find(zz => zz.id === dragging.zoneId)
      if (!z) return
      if (dragging.kind === 'vertex') {
        z.vertices[dragging.vertexIdx] = ll
      } else if (dragging.kind === 'obstruction-vertex') {
        const o = z.obstructions.find(oo => oo.id === dragging.obstructionId)
        if (o) o.vertices[dragging.vertexIdx] = ll
      } else if (dragging.kind === 'center') {
        if (z.params) z.params.center = ll
      } else if (dragging.kind === 'radius') {
        if (z.params) z.params.radiusM = geoDistanceM(z.params.center, ll)
      } else if (dragging.kind === 'corner') {
        if (z.params) {
          const idx = dragging.cornerIdx
          if (idx === 0) z.params.a = ll
          else if (idx === 1) { z.params.b[0] = ll[0]; z.params.a[1] = ll[1] }
          else if (idx === 2) z.params.b = ll
          else if (idx === 3) { z.params.a[0] = ll[0]; z.params.b[1] = ll[1] }
        }
      } else if (dragging.kind === 'facing') {
        z.facingPoint = ll
        clearSampleCache(z.id)
      } else if (dragging.kind === 'gradient-start' || dragging.kind === 'gradient-end') {
        if (z.densityGradient) {
          z.densityGradient[dragging.kind === 'gradient-start' ? 'start' : 'end'] = ll
          clearSampleCache(z.id)
        }
      }
    })
    map.on('mouseup', () => {
      if (dragging) {
        // For obstruction-vertex, snap back if dropped outside parent ring.
        if (dragging.kind === 'obstruction-vertex') {
          const z = state.zones.find(zz => zz.id === dragging.zoneId)
          const o = z?.obstructions.find(oo => oo.id === dragging.obstructionId)
          if (z && o) {
            const v = o.vertices[dragging.vertexIdx]
            if (!isPointInsideRing(v, z.vertices)) {
              // Best-effort: clamp by moving back to a small inset from the closest edge.
              // Simpler: just leave it; the snap-back is a nice-to-have.
            }
          }
        }
        dragging = null
        suppressNextClick = true
        map.getCanvas().style.cursor = defaultCursor()
        map.dragPan.enable()
      }
    })
    map.on('touchend', () => {
      if (dragging) {
        dragging = null
        suppressNextClick = true
        map.getCanvas().style.cursor = defaultCursor()
        map.dragPan.enable()
      }
    })
    map.on('contextmenu', 'handles', (e) => {
      if (state.ruler.active || state.drawing) return
      e.preventDefault()
      const p = e.features[0].properties
      const z = state.zones.find(zz => zz.id === p.zoneId)
      if (!z) return
      if (p.kind === 'vertex') {
        z.vertices.splice(p.vertexIdx, 1)
      } else if (p.kind === 'obstruction-vertex') {
        const o = z.obstructions.find(oo => oo.id === p.obstructionId)
        if (o) {
          o.vertices.splice(p.vertexIdx, 1)
          if (!o.vertices.length) {
            const i = z.obstructions.findIndex(oo => oo.id === o.id)
            if (i !== -1) z.obstructions.splice(i, 1)
          }
        }
      }
      // center/radius/corner right-click is a no-op.
    })

    const defaultCursor = () => (state.drawing || state.ruler.active || state.aiming || state.gradientPicking) ? 'crosshair' : ''
    map.on('mouseenter', 'handles', (e) => {
      const p = e.features?.[0]?.properties
      if (p && canDragHandleFeature(p)) map.getCanvas().style.cursor = 'grab'
    })
    map.on('mouseleave', 'handles', () => { if (!dragging) map.getCanvas().style.cursor = defaultCursor() })
    map.on('mouseenter', 'facing-markers', () => {
      if (!state.drawing && !state.ruler.active) map.getCanvas().style.cursor = 'grab'
    })
    map.on('mouseleave', 'facing-markers', () => { if (!dragging) map.getCanvas().style.cursor = defaultCursor() })
    map.on('mouseenter', 'gradient-markers', (e) => {
      const p = e.features?.[0]?.properties
      const pickingThisGradient = state.gradientPicking?.zoneId === p?.zoneId
      const canDragDuringPick = pickingThisGradient && state.gradientPicking.step === 'confirm'
      if (!state.drawing && !state.ruler.active && (!state.gradientPicking || canDragDuringPick)) {
        map.getCanvas().style.cursor = 'grab'
      }
    })
    map.on('mouseleave', 'gradient-markers', () => { if (!dragging) map.getCanvas().style.cursor = defaultCursor() })
    map.on('mouseenter', 'zones-fill', () => { if (!state.drawing && !state.ruler.active && !state.aiming && !state.gradientPicking) map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'zones-fill', () => { map.getCanvas().style.cursor = defaultCursor() })

    // ===== CLICK ROUTER =================================================
    map.on('click', (e) => {
      if (suppressNextClick) { suppressNextClick = false; return }
      const ll = [e.lngLat.lng, e.lngLat.lat]
      // 0. Density-gradient direction picking — first click = start,
      // second click = direction/end, then Enter commits.
      if (state.gradientPicking) {
        const pick = state.gradientPicking
        const z = state.zones.find(zz => zz.id === pick.zoneId)
        if (z) {
          z.densityMode = 'gradient'
          if (!z.densityGradient) z.densityGradient = { start: null, end: null, stops: [{ distanceM: 0, density: z.density }] }
          if (pick.step === 'start') {
            z.densityGradient.start = ll
            z.densityGradient.end = null
            state.gradientPicking = { ...pick, step: 'end' }
          } else if (pick.step === 'end') {
            z.densityGradient.end = ll
            clearSampleCache(z.id)
            state.gradientPicking = { ...pick, step: 'confirm' }
          }
          refreshSources()
          schedulePeopleRefresh()
        }
        return
      }
      // 1. Aiming — set this zone's facing point and exit the mode.
      if (state.aiming) {
        const z = state.zones.find(zz => zz.id === state.aiming)
        if (z) {
          z.facingPoint = ll
          clearSampleCache(z.id) // force re-roll of rot[] with new heading
        }
        enterMode(null)
        return
      }
      // 2. Ruler — append a point.
      if (state.ruler.active) {
        state.ruler.points.push(ll)
        refreshRulerSources()
        return
      }
      // 3. Obstruction
      if (state.drawing === 'obstruction') {
        const z = selectedZone.value
        if (!z) return
        const o = z.obstructions.find(oo => oo.id === state.activeObstructionId)
        if (!o) return
        if (!isPointInsideRing(ll, z.vertices)) return
        o.vertices.push(ll)
        return
      }
      // 4. Zone drawing
      if (state.drawing === 'zone') {
        const z = selectedZone.value
        if (!z) return
        if (z.shape === 'polygon') {
          z.vertices.push(ll)
        } else if (z.shape === 'circle') {
          if (!z.params) {
            z.params = { kind: 'circle', center: ll, radiusM: 0, segments: 64 }
          } else {
            z.params.radiusM = geoDistanceM(z.params.center, ll)
            rebuildVertices(z, { mode: state.mode, pixelsPerMeter: state.indoor.pixelsPerMeter })
            enterMode(null)
          }
        } else if (z.shape === 'rect') {
          if (!z.params) {
            z.params = { kind: 'rect', a: ll, b: ll }
          } else {
            z.params.b = ll
            rebuildVertices(z, { mode: state.mode, pixelsPerMeter: state.indoor.pixelsPerMeter })
            enterMode(null)
          }
        }
        return
      }
      // 5. Idle — pick selection.
      const hit = map.queryRenderedFeatures(e.point, { layers: ['zones-fill'] })
      if (hit.length) state.selectedZoneId = hit[0].properties.id
    })

    // ===== MOUSEMOVE for live circle/rect preview ======================
    map.on('mousemove', (e) => {
      if (!state.drawing || state.drawing !== 'zone') return
      const z = selectedZone.value
      if (!z) return
      const ll = [e.lngLat.lng, e.lngLat.lat]
      if (z.shape === 'circle' && z.params && !dragging) {
        z.params.radiusM = geoDistanceM(z.params.center, ll)
      } else if (z.shape === 'rect' && z.params && !dragging) {
        z.params.b = ll
      }
    })

    map.on('dblclick', (e) => {
      if (state.ruler.active) {
        e.preventDefault()
        finishRuler()
      }
    })
    watch(() => state.ruler.active, on => {
      if (on) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable()
    })

    // Cursor cue while drawing, rulering, or aiming.
    watch(() => [state.drawing, state.ruler.active, state.aiming, state.gradientPicking], () => {
      if (map) map.getCanvas().style.cursor = defaultCursor()
    }, { immediate: true })

    applyBasemap()
  })

  watch(() => state.zones, () => { if (map) { refreshSources(); schedulePeopleRefresh() } }, { deep: true })
  watch(() => state.mapRefreshNonce, () => {
    if (!map) return
    clearPeopleCanvas()
    refreshSources()
    refreshPeopleRendering()
  })
  watch(() => state.selectedZoneId, () => { if (map) refreshSources() })
  // When drawing mode flips (esp. when it exits) re-sample people for the zone
  // we were suppressing during the draw.
  watch(() => state.drawing, () => { if (map) { refreshSources(); schedulePeopleRefresh() } })
  // Gradient setup also suppresses the selected zone until Enter commits it.
  watch(() => state.gradientPicking, () => { if (map) { refreshSources(); schedulePeopleRefresh() } })
  watch(() => state.basemap, () => { if (map) applyBasemap() })
  watch(() => state.ruler, () => { if (map) refreshRulerSources() }, { deep: true })
  watch(() => state.peopleColorMode, () => refreshPeopleRendering())
})

function isPointInsideRing([px, py], verts) {
  let inside = false
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const [xi, yi] = verts[i], [xj, yj] = verts[j]
    const ok = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (ok) inside = !inside
  }
  return inside
}

onBeforeUnmount(() => {
  if (peopleCanvasRaf != null) cancelAnimationFrame(peopleCanvasRaf)
  clearTimeout(peopleTimer)
  map?.remove()
  map = null
})

function fly(r) {
  if (!map) return
  if (r.bbox) {
    const [s, n, w, e] = r.bbox
    map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 17, duration: 800 })
  } else {
    map.flyTo({ center: [r.lng, r.lat], zoom: 16, duration: 800 })
  }
}

// ---- toolbar button click handlers ---------------------------------------
function startZoneDrawing() {
  // Use the currently-selected zone if it is still empty for this shape,
  // else create a new zone matching the active drawTool.
  let z = selectedZone.value
  if (!z || z.vertices.length > 0 || z.shape !== state.drawTool) {
    z = addZone(null, state.drawTool)
  }
  enterMode('drawing')
}
function startObstructionDrawing() {
  const z = selectedZone.value
  if (!z || z.vertices.length < 3) return
  addObstruction(z.id)
}
function startRuler() {
  enterMode('ruler')
}

// Shape pill click handler: change the draw-tool, and if the currently-selected
// zone is still empty, mutate its shape live so the user can change their mind
// after pressing Draw zone but before placing any vertices.
function onShapePick(shape) {
  state.drawTool = shape
  const z = selectedZone.value
  if (z && z.shape !== shape && z.vertices.length === 0 && !z.params) {
    z.shape = shape
    z.params = null
  }
}

defineExpose({ fly })
</script>

<template>
  <div class="absolute inset-0" :class="{ 'tile-grayscale': state.tileStyle === 'grayscale' }">
    <div ref="container" class="w-full h-full" />
    <canvas ref="peopleCanvas" class="absolute inset-0 hidden pointer-events-none" />
  </div>

  <div v-if="!state.zones.length && !state.drawing" class="absolute inset-x-0 top-1/2 -translate-y-1/2 mx-auto w-fit max-w-md px-4 py-3 bg-white/95 rounded-lg shadow-lg text-center text-sm text-ink-700 z-10 pointer-events-none">
    Pick a shape, click <strong>Draw zone</strong>, then click the map.
    Polygons: click vertices, then Enter. Circles/rectangles: click once, move the pointer, then Enter or click again.
  </div>

  <!-- Helper banner during obstruction drawing -->
  <div v-if="state.drawing === 'obstruction'"
       class="absolute inset-x-0 top-32 mx-auto w-fit max-w-md px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg shadow text-xs text-amber-900 z-10 pointer-events-none">
    <strong>Click inside the selected zone</strong> to drop polygon vertices.
    Obstructions are always polygons. Right-click a vertex to delete it,
    Ctrl+Z to undo, Esc to finish.
  </div>
</template>
