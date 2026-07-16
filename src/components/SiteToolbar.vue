<script setup>
import { computed, ref } from 'vue'
import { useApp } from '../lib/state.js'

const {
  state, getSelectedZone,
  addZone, addObstruction, enterMode, finishRuler,
} = useApp()
const selectedZone = computed(() => getSelectedZone())

// In the 3D view we keep the toolbar visible but disable anything that
// edits geometry — the 3D canvas has no click-to-place affordance.
const drawingDisabled = computed(() => state.viewMode === '3d')

function startZoneDrawing() {
  if (drawingDisabled.value) return
  let z = selectedZone.value
  if (!z || z.vertices.length > 0 || z.shape !== state.drawTool) {
    z = addZone(null, state.drawTool)
  }
  enterMode('drawing')
}
function startObstructionDrawing() {
  if (drawingDisabled.value) return
  const z = selectedZone.value
  if (!z || z.vertices.length < 3) return
  addObstruction(z.id)
}
function startRuler() {
  if (drawingDisabled.value) return
  enterMode('ruler')
}
function onShapePick(shape) {
  if (drawingDisabled.value) return
  state.drawTool = shape
  const z = selectedZone.value
  if (z && z.shape !== shape && z.vertices.length === 0 && !z.params) {
    z.shape = shape
    z.params = null
  }
}
function toggleView() {
  if (state.viewMode !== '3d' && !canEnter3D.value) return
  if (state.viewMode !== '3d') enterMode(null)
  state.viewMode = state.viewMode === '3d' ? '2d' : '3d'
}

// Tailwind class helper for the disabled look on drawing buttons.
const dim = 'bg-white text-ink-200 border-ink-100 cursor-not-allowed'
const obstructionAllowed = computed(() =>
  !drawingDisabled.value && !!selectedZone.value && selectedZone.value.vertices.length >= 3
)
// The 3D view only makes sense once we have at least one committed zone
// (vertices.length >= 3 — a draft polygon with 0/1/2 vertices doesn't count).
const canEnter3D = computed(() =>
  state.zones.some(z => z.vertices.length >= 3),
)

// Basemap dropdown wiring.
const basemapOpen = ref(false)
const basemapLabel = computed(() => {
  if (state.basemap === 'osm') return 'OpenStreetMap'
  if (state.basemap === 'satellite') return 'Esri satellite'
  if (state.basemap === 'google-roadmap') return 'Google roadmap'
  if (state.basemap === 'google-satellite') return 'Google satellite'
  return 'Map'
})
function pickBasemap(key) {
  if (key.startsWith('google-') && !state.googleMapsKey) return
  state.basemap = key
  basemapOpen.value = false
}
</script>

<template>
  <div class="absolute top-3 left-3 z-10 flex flex-col gap-2 items-start pointer-events-none">
    <!-- Row 1: drawing tools + view/style switches. pointer-events-auto on
         the inner row so the outer wrapper doesn't block map interaction. -->
    <div class="flex gap-2 flex-wrap pointer-events-auto">
      <!-- Draw zone -->
      <button class="px-3 py-1.5 rounded-md shadow-md text-xs font-medium border"
              :disabled="drawingDisabled"
              :class="drawingDisabled
                ? dim
                : (state.drawing === 'zone'
                    ? 'bg-emerald-600 text-white border-emerald-700'
                    : 'bg-white text-ink-900 border-ink-100 hover:bg-ink-50')"
              :title="drawingDisabled ? 'Switch to 2D to draw' : 'Draw a new zone'"
              @click="state.drawing === 'zone' ? enterMode(null) : startZoneDrawing()">
        {{ state.drawing === 'zone'
           ? (selectedZone?.shape === 'polygon' ? 'Drawing zone… (click map)' : `Drawing ${selectedZone?.shape}…`)
           : 'Draw zone' }}
      </button>

      <!-- Draw obstruction -->
      <button class="px-3 py-1.5 rounded-md shadow-md text-xs font-medium border"
              :disabled="!obstructionAllowed && state.drawing !== 'obstruction'"
              :class="drawingDisabled
                ? dim
                : (state.drawing === 'obstruction'
                    ? 'bg-amber-600 text-white border-amber-700'
                    : !obstructionAllowed
                      ? dim
                      : 'bg-white text-ink-900 border-ink-100 hover:bg-ink-50')"
              :title="drawingDisabled
                ? 'Switch to 2D to draw'
                : (!obstructionAllowed ? 'Draw a zone first' : 'Cut an obstruction out of the selected zone')"
              @click="state.drawing === 'obstruction' ? enterMode(null) : startObstructionDrawing()">
        {{ state.drawing === 'obstruction' ? 'Drawing obstruction… (click inside the zone)' : 'Draw obstruction' }}
      </button>

      <!-- Ruler -->
      <button class="px-3 py-1.5 rounded-md shadow-md text-xs font-medium border"
              :disabled="drawingDisabled"
              :class="drawingDisabled
                ? dim
                : (state.ruler.active
                    ? 'bg-sky-600 text-white border-sky-700'
                    : 'bg-white text-ink-900 border-ink-100 hover:bg-ink-50')"
              :title="drawingDisabled ? 'Switch to 2D to measure' : 'Measure distance'"
              @click="state.ruler.active ? finishRuler() : startRuler()">
        {{ state.ruler.active ? 'Ruler on' : 'Ruler' }}
      </button>

      <!-- View toggle — bidirectional. Greys out in 2D mode when no zone
           with vertices exists, since the 3D scene has nothing to render. -->
      <button class="px-3 py-1.5 rounded-md shadow-md text-xs font-medium border"
              :disabled="state.viewMode !== '3d' && !canEnter3D"
              :class="(state.viewMode !== '3d' && !canEnter3D)
                ? dim
                : 'bg-white text-ink-900 border-ink-100 hover:bg-ink-50'"
              :title="state.viewMode === '3d'
                ? 'Return to the 2D map'
                : (canEnter3D ? 'Switch the map to a 3D crowd view' : 'Draw a zone first')"
              @click="toggleView">
        {{ state.viewMode === '3d' ? 'View in 2D' : 'View in 3D' }}
      </button>

      <!-- Grayscale toggle -->
      <button class="px-3 py-1.5 rounded-md shadow-md text-xs font-medium border bg-white text-ink-900 border-ink-100 hover:bg-ink-50"
              :title="state.tileStyle === 'color' ? 'Show map tiles in grayscale' : 'Show map tiles in colour'"
              @click="state.tileStyle = state.tileStyle === 'color' ? 'grayscale' : 'color'">
        {{ state.tileStyle === 'color' ? 'Grayscale' : 'Color' }}
      </button>

      <!-- Basemap dropdown: OSM / Esri satellite / Google roadmap /
           Google satellite. Google options are gated on having the Google
           Maps API key set in localStorage (same one used for 3D). -->
      <div class="relative">
        <button class="px-3 py-1.5 rounded-md shadow-md text-xs font-medium border bg-white text-ink-900 border-ink-100 hover:bg-ink-50"
                title="Choose basemap"
                @click="basemapOpen = !basemapOpen">
          {{ basemapLabel }} ▾
        </button>
        <div v-if="basemapOpen"
             class="absolute right-0 mt-1 bg-white rounded-md shadow-lg border border-ink-100 text-xs w-52 z-10 overflow-hidden">
          <button class="block w-full text-left px-3 py-1.5 hover:bg-ink-50"
                  :class="state.basemap === 'osm' ? 'bg-ink-100 font-semibold' : ''"
                  @click="pickBasemap('osm')">OpenStreetMap</button>
          <button class="block w-full text-left px-3 py-1.5 hover:bg-ink-50"
                  :class="state.basemap === 'satellite' ? 'bg-ink-100 font-semibold' : ''"
                  @click="pickBasemap('satellite')">Esri satellite</button>
          <div class="border-t border-ink-100" />
          <button class="block w-full text-left px-3 py-1.5 hover:bg-ink-50"
                  :class="state.basemap === 'google-roadmap' ? 'bg-ink-100 font-semibold' : ''"
                  :disabled="!state.googleMapsKey"
                  :title="state.googleMapsKey ? '' : 'Set your Google Maps API key from the API key button in the top bar.'"
                  @click="pickBasemap('google-roadmap')">
            Google roadmap
            <span class="text-[10px] text-ink-700 block">2D map</span>
            <span v-if="!state.googleMapsKey" class="text-ink-200 text-[10px] block">key required</span>
          </button>
          <button class="block w-full text-left px-3 py-1.5 hover:bg-ink-50"
                  :class="state.basemap === 'google-satellite' ? 'bg-ink-100 font-semibold' : ''"
                  :disabled="!state.googleMapsKey"
                  :title="state.googleMapsKey ? '' : 'Set your Google Maps API key from the API key button in the top bar.'"
                  @click="pickBasemap('google-satellite')">
            Google satellite
            <span class="text-[10px] text-ink-700 block">2D imagery</span>
            <span v-if="!state.googleMapsKey" class="text-ink-200 text-[10px] block">key required</span>
          </button>
          <div class="border-t border-ink-100 px-3 py-1.5 text-[10px] text-ink-700 leading-snug">
            3D view uses Google Photorealistic Tiles for either Google basemap.
          </div>
        </div>
      </div>
    </div>

    <!-- Shape pill — only while drawing a zone, only in 2D. -->
    <div v-if="!drawingDisabled && state.drawing === 'zone'"
         class="bg-white rounded-md shadow-md border border-ink-100 flex overflow-hidden text-xs pointer-events-auto">
      <button v-for="opt in [['polygon','▱'],['circle','◯'],['rect','▭']]" :key="opt[0]"
              class="px-2 py-1.5"
              :class="state.drawTool === opt[0] ? 'bg-ink-900 text-white' : 'text-ink-900 hover:bg-ink-50'"
              :title="`Set zone shape: ${opt[0]}`"
              @click="onShapePick(opt[0])">
        {{ opt[1] }} {{ opt[0][0].toUpperCase() + opt[0].slice(1) }}
      </button>
    </div>
  </div>
</template>
