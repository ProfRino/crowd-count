<script setup>
import { onMounted, onBeforeUnmount, watch, ref, computed } from 'vue'
import maplibregl from 'maplibre-gl'
import { useApp } from '../lib/state.js'
import { makePersonTopIcon } from '../lib/peopleSymbol.js'
import { sampleInPolygonWithHoles } from '../lib/sample.js'
import { rebuildVertices, geoDistanceM } from '../lib/shapes.js'
import { polylineTotals, radiusMeters, fmtDistance, circleAreaM2 } from '../lib/ruler.js'

const {
  state, getSelectedZone, zoneBadge, zoneAreaM2,
  addZone, addObstruction, enterMode,
} = useApp()
const selectedZone = computed(() => getSelectedZone())

const container = ref(null)
let map = null
// dragging now describes which handle is being dragged:
// { kind: 'vertex'|'obstruction-vertex'|'center'|'radius'|'corner',
//   zoneId, obstructionId?, vertexIdx?, cornerIdx? }
let dragging = null
let suppressNextClick = false

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

// Sampled-people cache keyed by zone id. Re-samples only when the zone's
// own signature changes — adding/editing OTHER zones doesn't reshuffle.
const peopleCache = new Map()

function zoneSignature(z) {
  const holeStr = (z.obstructions ?? []).map(o => o.vertices.flat().join(',')).join('|')
  return `${z.shape}|${z.density}|${JSON.stringify(z.params)}|${z.vertices.flat().join(',')}|${holeStr}`
}

function peopleCollection() {
  const feats = []
  const liveIds = new Set()
  for (const z of state.zones) {
    liveIds.add(z.id)
    if (z.vertices.length < 3) { peopleCache.delete(z.id); continue }
    const sig = zoneSignature(z)
    const cached = peopleCache.get(z.id)
    let entry
    if (cached && cached.sig === sig) entry = cached
    else {
      const target = zoneAreaM2(z) * z.density
      const holes = (z.obstructions ?? []).filter(o => o.vertices.length >= 3).map(o => o.vertices)
      const pts = sampleInPolygonWithHoles(z.vertices, holes, target)
      const features = pts.map(p => ({
        type: 'Feature',
        properties: { rot: Math.floor(Math.random() * 360) },
        geometry: { type: 'Point', coordinates: p },
      }))
      entry = { sig, features }
      peopleCache.set(z.id, entry)
    }
    for (const f of entry.features) feats.push(f)
  }
  for (const id of peopleCache.keys()) if (!liveIds.has(id)) peopleCache.delete(id)
  return { type: 'FeatureCollection', features: feats }
}

// Ruler GeoJSON ------------------------------------------------------------
function rulerLineCollection() {
  const pts = [...state.ruler.points]
  if (state.ruler.cursor && pts.length > 0 && state.ruler.tool === 'polyline') pts.push(state.ruler.cursor)
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
function rulerCircleCollection() {
  if (state.ruler.tool !== 'radius' || !state.ruler.center) return { type: 'FeatureCollection', features: [] }
  const edge = state.ruler.radiusPoint ?? state.ruler.cursor
  if (!edge) return { type: 'FeatureCollection', features: [] }
  const rM = geoDistanceM(state.ruler.center, edge)
  if (rM <= 0) return { type: 'FeatureCollection', features: [] }
  // Reuse the same haversine circle generator we use for shape circles.
  const verts = []
  const N = 64
  // Inline haversine destination
  const R = 6378137
  const [cLng, cLat] = state.ruler.center
  const δ = rM / R, φ1 = cLat * Math.PI / 180, λ1 = cLng * Math.PI / 180
  const sinφ1 = Math.sin(φ1), cosφ1 = Math.cos(φ1), sinδ = Math.sin(δ), cosδ = Math.cos(δ)
  for (let i = 0; i < N; i++) {
    const θ = (i / N) * 2 * Math.PI
    const sinθ = Math.sin(θ), cosθ = Math.cos(θ)
    const φ2 = Math.asin(sinφ1 * cosδ + cosφ1 * sinδ * cosθ)
    const λ2 = λ1 + Math.atan2(sinθ * sinδ * cosφ1, cosδ - sinφ1 * Math.sin(φ2))
    verts.push([((λ2 * 180 / Math.PI) + 540) % 360 - 180, φ2 * 180 / Math.PI])
  }
  verts.push(verts[0])
  return { type: 'FeatureCollection', features: [{
    type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [verts] },
  }] }
}

function refreshSources() {
  if (!map) return
  map.getSource('zones-fill')?.setData(zonesAsFillCollection())
  map.getSource('zones-line')?.setData(zonesAsLineCollection())
  map.getSource('obstructions-line')?.setData(obstructionsAsLineCollection())
  map.getSource('handles')?.setData(handlesCollection())
}
function refreshRulerSources() {
  if (!map) return
  map.getSource('ruler-line')?.setData(rulerLineCollection())
  map.getSource('ruler-vertices')?.setData(rulerVerticesCollection())
  map.getSource('ruler-circle')?.setData(rulerCircleCollection())
}

let peopleTimer = null
function schedulePeopleRefresh() {
  if (!map) return
  clearTimeout(peopleTimer)
  peopleTimer = setTimeout(() => map.getSource('people')?.setData(peopleCollection()), 120)
}
function applyBasemap() {
  if (!map) return
  map.setLayoutProperty('osm-tiles', 'visibility', state.basemap === 'osm' ? 'visible' : 'none')
  map.setLayoutProperty('sat-tiles', 'visibility', state.basemap === 'satellite' ? 'visible' : 'none')
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
  watch(() => state.units, (u) => { scaleCtrl.setUnit(u) })

  map.on('load', () => {
    const { imageData, pixelRatio } = makePersonTopIcon()
    map.addImage('person-top', imageData, { pixelRatio })
    map.addImage('hatch-stripe', makeHatchImage())

    map.addSource('zones-fill', { type: 'geojson', data: zonesAsFillCollection() })
    map.addSource('zones-line', { type: 'geojson', data: zonesAsLineCollection() })
    map.addSource('obstructions-line', { type: 'geojson', data: obstructionsAsLineCollection() })
    map.addSource('people', { type: 'geojson', data: peopleCollection() })
    map.addSource('handles', { type: 'geojson', data: handlesCollection() })
    map.addSource('ruler-line', { type: 'geojson', data: rulerLineCollection() })
    map.addSource('ruler-vertices', { type: 'geojson', data: rulerVerticesCollection() })
    map.addSource('ruler-circle', { type: 'geojson', data: rulerCircleCollection() })

    map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones-fill',
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'selected'], 0.25, 0.12] } })
    map.addLayer({ id: 'zones-line', type: 'line', source: 'zones-line',
      paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 3, 2] } })
    map.addLayer({ id: 'people', type: 'symbol', source: 'people',
      layout: { 'icon-image': 'person-top', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-rotation-alignment': 'map', 'icon-rotate': ['get', 'rot'],
        'icon-size': [ 'interpolate', ['exponential', 2], ['zoom'], 13, 0.18, 18, 0.215, 21, 1.72, 23, 6.90 ] },
      minzoom: 13 })
    map.addLayer({ id: 'obstructions-line', type: 'line', source: 'obstructions-line',
      paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [3, 2] } })
    map.addLayer({ id: 'ruler-circle-fill', type: 'fill', source: 'ruler-circle',
      paint: { 'fill-color': '#0ea5e9', 'fill-opacity': 0.10 } })
    map.addLayer({ id: 'ruler-circle-outline', type: 'line', source: 'ruler-circle',
      paint: { 'line-color': '#0284c7', 'line-width': 2, 'line-dasharray': [4, 3] } })
    map.addLayer({ id: 'ruler-line', type: 'line', source: 'ruler-line',
      paint: { 'line-color': '#0284c7', 'line-width': 2, 'line-dasharray': [4, 3] } })
    map.addLayer({ id: 'ruler-vertices', type: 'circle', source: 'ruler-vertices',
      paint: { 'circle-radius': 4, 'circle-color': '#0284c7', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
    map.addLayer({ id: 'handles', type: 'circle', source: 'handles',
      paint: { 'circle-radius': 6, 'circle-color': '#ffffff',
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 } })

    map.on('moveend', () => {
      const c = map.getCenter()
      state.view = { lng: c.lng, lat: c.lat, zoom: map.getZoom() }
    })

    // ===== HANDLE INTERACTION ===========================================
    map.on('mousedown', 'handles', (e) => {
      if (state.ruler.active) return
      e.preventDefault()
      const p = e.features[0].properties
      dragging = {
        kind: p.kind, zoneId: p.zoneId,
        obstructionId: p.obstructionId || null,
        vertexIdx: p.vertexIdx ?? null,
        cornerIdx: p.cornerIdx ?? null,
      }
      map.getCanvas().style.cursor = 'grabbing'
      map.dragPan.disable()
    })
    map.on('mousemove', (e) => {
      const ll = [e.lngLat.lng, e.lngLat.lat]
      // Ruler cursor preview
      if (state.ruler.active) {
        state.ruler.cursor = ll
        if (state.ruler.dragging && state.ruler.center) state.ruler.radiusPoint = ll
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
    map.on('contextmenu', 'handles', (e) => {
      if (state.ruler.active) return
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

    const defaultCursor = () => (state.drawing || state.ruler.active) ? 'crosshair' : ''
    map.on('mouseenter', 'handles', () => { map.getCanvas().style.cursor = 'grab' })
    map.on('mouseleave', 'handles', () => { if (!dragging) map.getCanvas().style.cursor = defaultCursor() })
    map.on('mouseenter', 'zones-fill', () => { if (!state.drawing && !state.ruler.active) map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'zones-fill', () => { map.getCanvas().style.cursor = defaultCursor() })

    // ===== CLICK ROUTER =================================================
    map.on('click', (e) => {
      if (suppressNextClick) { suppressNextClick = false; return }
      const ll = [e.lngLat.lng, e.lngLat.lat]
      // 1. Ruler
      if (state.ruler.active) {
        if (state.ruler.tool === 'polyline') {
          state.ruler.points.push(ll)
          refreshRulerSources()
        }
        // Radius tool uses mousedown/mousemove/mouseup, not click.
        return
      }
      // 2. Obstruction
      if (state.drawing === 'obstruction') {
        const z = selectedZone.value
        if (!z) return
        const o = z.obstructions.find(oo => oo.id === state.activeObstructionId)
        if (!o) return
        if (!isPointInsideRing(ll, z.vertices)) return
        o.vertices.push(ll)
        return
      }
      // 3. Zone drawing
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
            state.drawing = false
          }
        } else if (z.shape === 'rect') {
          if (!z.params) {
            z.params = { kind: 'rect', a: ll, b: ll }
          } else {
            z.params.b = ll
            rebuildVertices(z, { mode: state.mode, pixelsPerMeter: state.indoor.pixelsPerMeter })
            state.drawing = false
          }
        }
        return
      }
      // 4. Idle — pick selection.
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

    // ===== Ruler radius FSM (mousedown→drag→mouseup) ===================
    map.getCanvas().addEventListener('mousedown', (ev) => {
      if (!state.ruler.active || state.ruler.tool !== 'radius') return
      if (ev.button !== 0) return
      const rect = map.getCanvas().getBoundingClientRect()
      const px = ev.clientX - rect.left, py = ev.clientY - rect.top
      const ll = map.unproject([px, py])
      state.ruler.center = [ll.lng, ll.lat]
      state.ruler.radiusPoint = [ll.lng, ll.lat]
      state.ruler.dragging = true
      refreshRulerSources()
    })
    map.getCanvas().addEventListener('mouseup', () => {
      if (state.ruler.dragging) {
        state.ruler.dragging = false
        suppressNextClick = true
      }
    })
    map.on('dblclick', (e) => {
      if (state.ruler.active && state.ruler.tool === 'polyline') {
        // dblclick already pushed a point on the prior single-click; just finalize.
        // Nothing to do — leaving as-is means the polyline is "committed" and waits for next click.
        e.preventDefault()
      }
    })
    watch(() => state.ruler.active, on => {
      if (on) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable()
    })

    // Cursor cue while drawing or rulering.
    watch(() => [state.drawing, state.ruler.active], () => {
      map.getCanvas().style.cursor = defaultCursor()
    }, { immediate: true })

    applyBasemap()
  })

  watch(() => state.zones, () => { refreshSources(); schedulePeopleRefresh() }, { deep: true })
  watch(() => state.selectedZoneId, refreshSources)
  watch(() => state.basemap, applyBasemap)
  watch(() => state.ruler, refreshRulerSources, { deep: true })
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

onBeforeUnmount(() => { map?.remove(); map = null })

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
function startRuler(tool) {
  state.ruler.tool = tool
  enterMode('ruler')
}

defineExpose({ fly })
</script>

<template>
  <div class="absolute inset-0">
    <div ref="container" class="w-full h-full" />
  </div>

  <!-- Top toolbar -->
  <div class="absolute top-3 left-3 z-10 flex flex-col gap-2 items-start">
    <!-- Shape pill -->
    <div class="bg-white rounded-md shadow-md border border-ink-100 flex overflow-hidden text-xs">
      <button v-for="opt in [['polygon','▱'],['circle','◯'],['rect','▭']]" :key="opt[0]"
              class="px-2 py-1.5"
              :class="state.drawTool === opt[0] ? 'bg-ink-900 text-white' : 'text-ink-900 hover:bg-ink-50'"
              :title="`Set next zone shape: ${opt[0]}`"
              @click="state.drawTool = opt[0]">
        {{ opt[1] }} {{ opt[0][0].toUpperCase() + opt[0].slice(1) }}
      </button>
    </div>
    <!-- Draw buttons -->
    <div class="flex gap-2">
      <button class="px-3 py-1.5 rounded-md shadow-md text-xs font-medium border"
              :class="state.drawing === 'zone' ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white text-ink-900 border-ink-100 hover:bg-ink-50'"
              @click="state.drawing === 'zone' ? enterMode(null) : startZoneDrawing()">
        {{ state.drawing === 'zone'
           ? (selectedZone?.shape === 'polygon' ? 'Drawing zone… (click map)' : `Drawing ${selectedZone?.shape}…`)
           : 'Draw zone' }}
      </button>
      <button class="px-3 py-1.5 rounded-md shadow-md text-xs font-medium border"
              :disabled="!selectedZone || selectedZone.vertices.length < 3"
              :class="state.drawing === 'obstruction'
                ? 'bg-amber-600 text-white border-amber-700'
                : (!selectedZone || selectedZone.vertices.length < 3)
                  ? 'bg-white text-ink-200 border-ink-100 cursor-not-allowed'
                  : 'bg-white text-ink-900 border-ink-100 hover:bg-ink-50'"
              :title="(!selectedZone || selectedZone.vertices.length < 3) ? 'Draw a zone first' : 'Cut an obstruction out of the selected zone'"
              @click="state.drawing === 'obstruction' ? enterMode(null) : startObstructionDrawing()">
        {{ state.drawing === 'obstruction' ? 'Drawing obstruction…' : 'Draw obstruction' }}
      </button>
    </div>
    <!-- Ruler -->
    <div class="bg-white rounded-md shadow-md border border-ink-100 flex overflow-hidden text-xs">
      <button class="px-2 py-1.5"
              :class="state.ruler.active ? 'bg-sky-600 text-white' : 'text-ink-900 hover:bg-ink-50'"
              @click="state.ruler.active ? enterMode(null) : startRuler('polyline')">
        📏 {{ state.ruler.active ? 'Ruler on' : 'Ruler' }}
      </button>
      <button v-if="state.ruler.active" class="px-2 py-1.5 border-l border-ink-100"
              :class="state.ruler.tool === 'polyline' ? 'bg-sky-100' : 'hover:bg-ink-50'"
              @click="state.ruler.tool = 'polyline'; state.ruler.center = null; state.ruler.radiusPoint = null">
        Polyline
      </button>
      <button v-if="state.ruler.active" class="px-2 py-1.5 border-l border-ink-100"
              :class="state.ruler.tool === 'radius' ? 'bg-sky-100' : 'hover:bg-ink-50'"
              @click="state.ruler.tool = 'radius'; state.ruler.points = []">
        Radius
      </button>
    </div>
  </div>

  <!-- Satellite/Map toggle — placed on the right under the +/− zoom controls -->
  <button
    class="absolute top-24 right-3 z-10 px-2 py-1.5 rounded-md shadow-md text-xs font-medium bg-white border border-ink-100 hover:bg-ink-50"
    @click="state.basemap = state.basemap === 'osm' ? 'satellite' : 'osm'">
    {{ state.basemap === 'osm' ? 'Satellite' : 'Map' }}
  </button>

  <div v-if="!state.zones.length" class="absolute inset-x-0 top-1/2 -translate-y-1/2 mx-auto w-fit max-w-md px-4 py-3 bg-white/95 rounded-lg shadow-lg text-center text-sm text-ink-700 z-10 pointer-events-none">
    Pick a shape, click <strong>Draw zone</strong>, then click the map.
    Polygons: click vertices. Circles/rectangles: click two points.
  </div>
</template>
