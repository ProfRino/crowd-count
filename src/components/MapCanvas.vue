<script setup>
import { onMounted, onBeforeUnmount, watch, ref } from 'vue'
import maplibregl from 'maplibre-gl'
import { computed } from 'vue'
import { useApp } from '../lib/state.js'
import { makePersonTopIcon } from '../lib/peopleSymbol.js'
import { sampleInPolygon } from '../lib/sample.js'

const { state, getSelectedZone, zoneBadge, zoneAreaM2 } = useApp()
const selectedZone = computed(() => getSelectedZone())

const container = ref(null)
let map = null
let dragging = null  // { zoneId, vertexIdx }
let suppressNextClick = false

const STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster', tileSize: 256,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    satellite: {
      type: 'raster', tileSize: 256, maxzoom: 19,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [
    { id: 'osm-tiles', type: 'raster', source: 'osm', layout: { visibility: 'visible' } },
    { id: 'sat-tiles', type: 'raster', source: 'satellite', layout: { visibility: 'none' } },
  ],
}

function zonesAsFillCollection() {
  return {
    type: 'FeatureCollection',
    features: state.zones
      .filter(z => z.vertices.length >= 3)
      .map(z => ({
        type: 'Feature',
        properties: { id: z.id, color: z.color, selected: z.id === state.selectedZoneId },
        geometry: { type: 'Polygon', coordinates: [closedRing(z.vertices)] },
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

function verticesCollection() {
  const feats = []
  for (const z of state.zones) {
    for (let i = 0; i < z.vertices.length; i++) {
      feats.push({
        type: 'Feature',
        properties: { zoneId: z.id, vertexIdx: i, color: z.color },
        geometry: { type: 'Point', coordinates: z.vertices[i] },
      })
    }
  }
  return { type: 'FeatureCollection', features: feats }
}

// Sampled-people cache keyed by zone id. Each entry holds the signature
// (vertices + density + area) and the pre-built GeoJSON features so that
// editing or adding a different zone doesn't re-shuffle existing zones'
// people. We only re-sample a zone when its OWN signature changes.
const peopleCache = new Map()

function zoneSignature(z) {
  // Vertex coordinates round-tripped through Number.toString are enough to
  // detect any change; density is appended to invalidate on slider changes.
  return `${z.density}|${z.vertices.length}|${z.vertices.flat().join(',')}`
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
    if (cached && cached.sig === sig) {
      entry = cached
    } else {
      const target = zoneAreaM2(z) * z.density
      const pts = sampleInPolygon(z.vertices, target)
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
  // Drop cache entries for deleted zones so the map doesn't grow forever.
  for (const id of peopleCache.keys()) if (!liveIds.has(id)) peopleCache.delete(id)
  return { type: 'FeatureCollection', features: feats }
}

function closedRing(verts) {
  if (verts.length < 1) return verts
  const first = verts[0], last = verts[verts.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) return verts
  return [...verts, first]
}

function refreshSources() {
  if (!map) return
  map.getSource('zones-fill')?.setData(zonesAsFillCollection())
  map.getSource('zones-line')?.setData(zonesAsLineCollection())
  map.getSource('vertices')?.setData(verticesCollection())
}

let peopleTimer = null
function schedulePeopleRefresh() {
  if (!map) return
  clearTimeout(peopleTimer)
  peopleTimer = setTimeout(() => {
    map.getSource('people')?.setData(peopleCollection())
  }, 120)
}

function applyBasemap() {
  if (!map) return
  map.setLayoutProperty('osm-tiles', 'visibility', state.basemap === 'osm' ? 'visible' : 'none')
  map.setLayoutProperty('sat-tiles', 'visibility', state.basemap === 'satellite' ? 'visible' : 'none')
}

onMounted(() => {
  map = new maplibregl.Map({
    container: container.value,
    style: STYLE,
    center: [state.view.lng, state.view.lat],
    zoom: state.view.zoom,
    attributionControl: { compact: true },
  })
  // Expose map for debugging from the browser console / preview eval.
  if (typeof window !== 'undefined') window.__map = map

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  const scaleCtrl = new maplibregl.ScaleControl({ maxWidth: 140, unit: state.units })
  map.addControl(scaleCtrl, 'bottom-left')
  // Re-set the scale control's unit whenever the user toggles metric/imperial.
  watch(() => state.units, (u) => { scaleCtrl.setUnit(u) })

  map.on('load', () => {
    // Person symbol — top-down silhouette, registered as a map image.
    const { imageData, pixelRatio } = makePersonTopIcon()
    map.addImage('person-top', imageData, { pixelRatio })

    map.addSource('zones-fill', { type: 'geojson', data: zonesAsFillCollection() })
    map.addSource('zones-line', { type: 'geojson', data: zonesAsLineCollection() })
    map.addSource('people', { type: 'geojson', data: peopleCollection() })
    map.addSource('vertices', { type: 'geojson', data: verticesCollection() })

    map.addLayer({
      id: 'zones-fill', type: 'fill', source: 'zones-fill',
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': ['case', ['get', 'selected'], 0.25, 0.12],
      },
    })
    map.addLayer({
      id: 'zones-line', type: 'line', source: 'zones-line',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['get', 'selected'], 3, 2],
      },
    })
    // Icon size baked into a MapLibre `interpolate exponential 2` expression so
    // each symbol represents 0.6 m of real ground regardless of zoom (size
    // doubles per zoom level). Below ~zoom 18 the geo size is sub-pixel so we
    // floor it for visibility.
    //
    // Calibration: MapLibre's internal pixel space is 512-tile, not 256-tile.
    // At lat ~40° this gives metersPerPx = 156543 × cos(L) / 2^z / 2.
    // For source image w/h 24×16 px with pixelRatio:2 (logical 12×8), the
    // CSS-pixel-wide rendered icon = 12 × icon-size. To make that equal
    // 0.6 / metersPerPx CSS px on screen:
    //   icon-size = 0.6 × 2^z / (156543 × cos(L) × 6)  ≈ 2^z / 1.2M at lat 40°.
    map.addLayer({
      id: 'people', type: 'symbol', source: 'people',
      layout: {
        'icon-image': 'person-top',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-rotation-alignment': 'map',
        'icon-rotate': ['get', 'rot'],
        'icon-size': [
          'interpolate', ['exponential', 2], ['zoom'],
          13, 0.18,    // floor — visible at low zoom
          18, 0.215,   // floor blends into geo here
          21, 1.72,    // ~0.6 m at lat ~40°, zoom 21
          23, 6.90,    // doubles per zoom level above 18
        ],
      },
      minzoom: 13,
    })
    map.addLayer({
      id: 'vertices', type: 'circle', source: 'vertices',
      paint: {
        'circle-radius': 6, 'circle-color': '#ffffff',
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2,
      },
    })

    map.on('moveend', () => {
      const c = map.getCenter()
      state.view = { lng: c.lng, lat: c.lat, zoom: map.getZoom() }
    })

    // Vertex drag.
    map.on('mousedown', 'vertices', (e) => {
      e.preventDefault()
      const f = e.features[0].properties
      dragging = { zoneId: f.zoneId, vertexIdx: f.vertexIdx }
      map.getCanvas().style.cursor = 'grabbing'
      map.dragPan.disable()
    })
    map.on('mousemove', (e) => {
      if (!dragging) return
      const z = state.zones.find(zz => zz.id === dragging.zoneId)
      if (!z) return
      z.vertices[dragging.vertexIdx] = [e.lngLat.lng, e.lngLat.lat]
    })
    map.on('mouseup', () => {
      if (dragging) {
        dragging = null
        suppressNextClick = true
        map.getCanvas().style.cursor = ''
        map.dragPan.enable()
      }
    })

    // Right-click on vertex deletes it.
    map.on('contextmenu', 'vertices', (e) => {
      e.preventDefault()
      const { zoneId, vertexIdx } = e.features[0].properties
      const z = state.zones.find(zz => zz.id === zoneId)
      if (z) z.vertices.splice(vertexIdx, 1)
    })

    const defaultCursor = () => state.drawing ? 'crosshair' : ''
    map.on('mouseenter', 'vertices', () => { map.getCanvas().style.cursor = 'grab' })
    map.on('mouseleave', 'vertices', () => { if (!dragging) map.getCanvas().style.cursor = defaultCursor() })
    map.on('mouseenter', 'zones-fill', () => { if (!state.drawing) map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'zones-fill', () => { map.getCanvas().style.cursor = defaultCursor() })

    // Click: add vertex when drawing, or select zone otherwise.
    map.on('click', (e) => {
      if (suppressNextClick) { suppressNextClick = false; return }
      if (state.drawing) {
        const z = selectedZone.value
        if (!z) return
        z.vertices.push([e.lngLat.lng, e.lngLat.lat])
        return
      }
      const hit = map.queryRenderedFeatures(e.point, { layers: ['zones-fill'] })
      if (hit.length) state.selectedZoneId = hit[0].properties.id
    })

    // Cursor cue while drawing.
    watch(() => state.drawing, (on) => {
      map.getCanvas().style.cursor = on ? 'crosshair' : ''
    }, { immediate: true })

    applyBasemap()
  })

  watch(() => state.zones, () => { refreshSources(); schedulePeopleRefresh() }, { deep: true })
  watch(() => state.selectedZoneId, refreshSources)
  watch(() => state.basemap, applyBasemap)
})

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

defineExpose({ fly })
</script>

<template>
  <div class="absolute inset-0">
    <div ref="container" class="w-full h-full" />
  </div>

  <div class="absolute top-3 left-3 z-10 flex gap-2">
    <button
      class="px-3 py-1.5 rounded-md shadow-md text-xs font-medium border"
      :class="state.drawing
        ? 'bg-emerald-600 text-white border-emerald-700'
        : 'bg-white text-ink-900 border-ink-100 hover:bg-ink-50'"
      @click="state.drawing = !state.drawing">
      {{ state.drawing ? 'Drawing… (click map to add vertex)' : 'Draw' }}
    </button>
    <button
      class="px-3 py-1.5 rounded-md shadow-md text-xs font-medium bg-white border border-ink-100 hover:bg-ink-50"
      @click="state.basemap = state.basemap === 'osm' ? 'satellite' : 'osm'">
      {{ state.basemap === 'osm' ? 'Satellite' : 'Map' }}
    </button>
  </div>

  <div v-if="!state.zones.length" class="absolute inset-x-0 top-1/2 -translate-y-1/2 mx-auto w-fit max-w-md px-4 py-3 bg-white/95 rounded-lg shadow-lg text-center text-sm text-ink-700 z-10 pointer-events-none">
    Add a zone in the sidebar, then click the map to drop polygon vertices.
    Drag a vertex to move it; right-click to delete.
  </div>
</template>
