<script setup>
import { computed } from 'vue'
import { useApp } from '../lib/state.js'
import { STILL_TICKS, DENSITY_MIN, DENSITY_MAX, CRUSH_THRESHOLD, STANDARDS } from '../lib/standards.js'
import { fmtAreaCompact, fmtDensity } from '../lib/units.js'
import { PEOPLE_COLOR_MODES } from '../lib/peopleAppearance.js'
import { segmentMeters, fmtDistance } from '../lib/ruler.js'

const {
  state, addZone, deleteZone, selectZone,
  zoneAreaM2, obstructionAreaM2, zoneBadge, zoneAverageDensity, zonePeopleCount,
  addObstruction, deleteObstruction, enterMode, startGradientPick,
} = useApp()

// Slider thumbs have a fixed pixel width and the runnable track inset by
// half the thumb on each side; raw % positions therefore don't line up with
// the thumb. Offset each tick by (0.5 - pct) * THUMB_W so the labels track
// the thumb exactly.
const THUMB_W_PX = 16
const GOOGLE_MAPS_METRICS_URL = 'https://console.cloud.google.com/project/_/google/maps-apis/metrics'
function tickStyle(ppm) {
  const pct = ((ppm - DENSITY_MIN) / (DENSITY_MAX - DENSITY_MIN)) * 100
  const offset = (0.5 - pct / 100) * THUMB_W_PX
  const sign = offset >= 0 ? '+' : '-'
  return { left: `calc(${pct}% ${sign} ${Math.abs(offset)}px)` }
}
const densityTicks = computed(() => {
  const standard = STANDARDS[state.standard] ?? STANDARDS.purple
  const threshold = Number(standard.threshold.toFixed(2))
  const baseTicks = STILL_TICKS
    .filter(t => Math.abs(t.ppm - 4.7) >= 0.001)
    .filter(t => Math.abs(t.ppm - threshold) > 0.45)
  return [
    ...baseTicks,
    {
      ppm: threshold,
      label: `${standard.name} limit`,
      standard: true,
      display: Number.isInteger(threshold) ? String(threshold) : threshold.toFixed(2),
    },
  ].sort((a, b) => a.ppm - b.ppm)
})
function tickLabel(t) {
  if (t.display) return t.display
  return Number.isInteger(t.ppm) ? String(t.ppm) : t.ppm.toFixed(2)
}

function fmtArea(m2) { return fmtAreaCompact(m2, state.units) }
function fmtCount(z) {
  const c = Math.round(zonePeopleCount(z))
  return c.toLocaleString()
}
function fmtZoneDensity(d) { return fmtDensity(d, state.units) }
function gradientReady(z) {
  return z.densityMode === 'gradient'
    && Array.isArray(z.densityGradient?.start)
    && Array.isArray(z.densityGradient?.end)
}
function displayDensity(z) {
  if (z.densityMode === 'gradient') {
    if (!gradientReady(z)) return `${fmtZoneDensity(z.density)} uniform`
    return `${fmtZoneDensity(zoneAverageDensity(z))} avg`
  }
  return fmtZoneDensity(z.density)
}
function sliderClassForDensity(density) {
  return density > 6 ? 'accent-red-700'
    : density > 4 ? 'accent-amber-500'
      : 'accent-ink-900'
}
function shapeGlyph(z) { return z.shape === 'circle' ? '◯' : z.shape === 'rect' ? '▭' : '▱' }
function colorModeClass(mode) {
  return state.peopleColorMode === mode
    ? 'bg-ink-900 text-white shadow-sm'
    : 'text-ink-700 hover:bg-ink-100'
}
function showGoogleHeightReset() {
  return state.mode === 'outdoor'
    && state.viewMode === '3d'
    && state.buildingSource === 'google'
}
function requestGoogleHeightReset() {
  state.googleHeight.resetNonce += 1
}

function onAddZone() {
  addZone(null, state.drawTool ?? 'polygon')
  enterMode('drawing')
}
function onAddObstruction(zoneId) {
  selectZone(zoneId)
  addObstruction(zoneId)
}
function onAim(zoneId) {
  selectZone(zoneId)
  // If already aiming for this zone, click again cancels. Otherwise switch.
  if (state.aiming === zoneId) {
    enterMode(null)
    return
  }
  enterMode(null)
  state.aiming = zoneId
}
function onClearAim(zoneId) {
  const z = state.zones.find(zz => zz.id === zoneId)
  if (z) z.facingPoint = null
}
function ensureGradient(z) {
  if (!z.densityGradient) {
    z.densityGradient = {
      start: null,
      end: null,
      stops: [
        { distanceM: 0, density: 2 },
        { distanceM: 100, density: 1 },
      ],
    }
  }
  const stops = Array.isArray(z.densityGradient.stops)
    ? z.densityGradient.stops
      .map(s => ({
        distanceM: Math.max(0, Number(s.distanceM) || 0),
        density: Math.max(0, Number(s.density) || 0),
      }))
      .sort((a, b) => a.distanceM - b.distanceM)
    : []
  let nextStops
  if (stops.length >= 2) nextStops = stops
  else if (stops.length === 1) {
    nextStops = [
      stops[0],
      { distanceM: Math.max(100, stops[0].distanceM + 100), density: 1 },
    ]
  } else {
    nextStops = [
      { distanceM: 0, density: 2 },
      { distanceM: 100, density: 1 },
    ]
  }
  const current = z.densityGradient.stops
  const changed = !Array.isArray(current)
    || current.length !== nextStops.length
    || current.some((s, i) =>
      Math.abs((Number(s.distanceM) || 0) - nextStops[i].distanceM) > 0.0001
      || Math.abs((Number(s.density) || 0) - nextStops[i].density) > 0.0001
    )
  if (changed) z.densityGradient.stops = nextStops
}
function setDensityMode(z, mode) {
  z.densityMode = mode
  if (mode === 'gradient') ensureGradient(z)
}
function sortedStops(z) {
  ensureGradient(z)
  return z.densityGradient.stops
}
function stopLabel(z, i) {
  const n = z.densityGradient.stops.length
  return i === 0 ? 'start m' : i === n - 1 ? 'end m' : 'point m'
}
// Insert a new stop in the middle of the widest gap, with the density the
// profile already has there — adding a point never changes the count until
// the user edits it.
function addGradientStop(z) {
  ensureGradient(z)
  const stops = z.densityGradient.stops
  let gapIndex = 0
  let gapSpan = -1
  for (let i = 1; i < stops.length; i += 1) {
    const span = stops[i].distanceM - stops[i - 1].distanceM
    if (span > gapSpan) { gapSpan = span; gapIndex = i }
  }
  const a = stops[gapIndex - 1]
  const b = stops[gapIndex]
  const distanceM = Math.round((a.distanceM + b.distanceM) / 2)
  const t = gapSpan > 1e-9 ? (distanceM - a.distanceM) / gapSpan : 0.5
  const density = Math.round((a.density + (b.density - a.density) * t) * 100) / 100
  stops.splice(gapIndex, 0, { distanceM, density })
}
function removeGradientStop(z, i) {
  ensureGradient(z)
  if (z.densityGradient.stops.length <= 2) return
  z.densityGradient.stops.splice(i, 1)
}
function onPickGradient(z) {
  ensureGradient(z)
  if (state.gradientPicking?.zoneId === z.id) return
  startGradientPick(z.id)
}
function gradientPickLabel(z) {
  if (state.gradientPicking?.zoneId === z.id) {
    if (state.gradientPicking.step === 'start') return 'Click map start'
    if (state.gradientPicking.step === 'end') return 'Click map end'
    return 'Press Enter'
  }
  return gradientReady(z) ? 'Change direction' : 'Set direction'
}
function gradientStatus(z) {
  ensureGradient(z)
  if (state.gradientPicking?.zoneId === z.id) {
    if (state.gradientPicking.step === 'start') return 'Click the map where the gradient starts.'
    if (state.gradientPicking.step === 'end') return 'Start point set. Click the map where the gradient ends.'
    return 'Direction set. Press Enter to apply it and render pedestrians.'
  }
  if (!z.densityGradient.start) {
    return 'Gradient not applied yet. Set a start and end direction on the map.'
  }
  if (!z.densityGradient.end) {
    return 'Gradient not applied yet. Click Set direction again, then set the end point.'
  }
  return 'Gradient active. Count uses the average density along this direction.'
}
function gradientDirectionDistance(z) {
  if (!gradientReady(z)) return 'pick 2 points'
  const m = segmentMeters(
    z.densityGradient.start,
    z.densityGradient.end,
    state.mode,
    state.indoor.pixelsPerMeter,
  )
  return fmtDistance(m, state.units)
}
function standardLimitLabel(z) {
  const b = zoneBadge(z)
  const standard = STANDARDS[state.standard] ?? STANDARDS.purple
  return `Standard limit: ${standard.limitName ?? standard.name} = ${b.threshold.toFixed(2)} ppl/m²`
}
</script>

<template>
  <div class="p-3">
    <div class="flex items-center justify-between mb-2">
      <div class="text-xs uppercase tracking-wide text-ink-700">Zones</div>
      <button
        class="text-xs px-2 py-1 rounded bg-ink-900 text-white hover:bg-ink-700"
        @click="onAddZone">+ Add zone</button>
    </div>

    <div class="mb-2">
      <div class="text-[10px] uppercase tracking-wide text-ink-700 mb-1">People colour</div>
      <div class="grid grid-cols-3 gap-1 rounded-md border border-ink-100 bg-white p-1">
        <button
          v-for="mode in PEOPLE_COLOR_MODES"
          :key="mode.value"
          type="button"
          class="h-7 rounded text-[11px] font-medium transition-colors"
          :class="colorModeClass(mode.value)"
          @click="state.peopleColorMode = mode.value">
          {{ mode.label }}
        </button>
      </div>
      <div v-if="showGoogleHeightReset()" class="mt-2">
        <button type="button"
                class="w-full h-8 rounded-md border border-ink-200 bg-white text-xs font-medium text-ink-900 shadow-sm hover:bg-ink-50 disabled:opacity-50"
                :disabled="state.googleHeight.busy"
                title="Redo people and zone height from the currently loaded Google tiles"
                @click="requestGoogleHeightReset">
          Reset height
        </button>
        <div v-if="state.googleHeight.status" class="mt-1 text-[10px] text-ink-600 leading-tight">
          {{ state.googleHeight.status }}
        </div>
        <a :href="GOOGLE_MAPS_METRICS_URL"
           target="_blank"
           rel="noopener noreferrer"
           class="mt-1 inline-block text-[10px] font-medium text-sky-700 hover:underline"
           title="Open Google Maps Platform metrics in a new tab">
          Check Google tile usage
        </a>
      </div>
    </div>

    <div v-if="!state.zones.length" class="text-xs text-ink-700 italic">
      No zones yet. Click <span class="font-medium">+ Add zone</span>, then use <span class="font-medium">Draw zone</span> on the map toolbar.
    </div>

    <ul class="space-y-2">
      <li v-for="z in state.zones" :key="z.id"
          class="border rounded-md"
          :class="state.selectedZoneId === z.id ? 'border-ink-900' : 'border-ink-100'">
        <div class="flex items-center gap-2 p-2"
             @click="selectZone(z.id)">
          <!-- The native colour input acts as the swatch + picker. Sized
               to match the old static swatch so the row height is stable. -->
          <input type="color" v-model="z.color"
                 class="w-4 h-4 rounded-sm shrink-0 cursor-pointer border-0 p-0 bg-transparent"
                 title="Pick zone colour"
                 @click.stop />
          <span class="text-[11px] text-ink-700" :title="z.shape">{{ shapeGlyph(z) }}</span>
          <input
            v-model="z.name"
            class="flex-1 bg-transparent text-sm font-medium focus:outline-none"
            @click.stop />
          <button class="text-xs text-ink-700 hover:text-red-600 px-1"
                  @click.stop="deleteZone(z.id)">✕</button>
        </div>

        <div class="px-2 pb-2">
          <div class="flex items-center gap-2 text-xs text-ink-700">
            <span class="tabular-nums">{{ fmtArea(zoneAreaM2(z)) }}</span>
            <span>·</span>
            <span class="tabular-nums">{{ displayDensity(z) }}</span>
            <span>=</span>
            <span class="font-semibold text-ink-900 tabular-nums">{{ fmtCount(z) }}</span>
          </div>

          <div class="mt-2 grid grid-cols-2 gap-1 rounded-md border border-ink-100 bg-white p-1">
            <button type="button"
                    class="h-7 rounded text-[11px] font-medium transition-colors"
                    :class="(z.densityMode ?? 'uniform') !== 'gradient' ? 'bg-ink-900 text-white shadow-sm' : 'text-ink-700 hover:bg-ink-100'"
                    @click.stop="setDensityMode(z, 'uniform')">
              Uniform
            </button>
            <button type="button"
                    class="h-7 rounded text-[11px] font-medium transition-colors"
                    :class="z.densityMode === 'gradient' ? 'bg-ink-900 text-white shadow-sm' : 'text-ink-700 hover:bg-ink-100'"
                    @click.stop="setDensityMode(z, 'gradient')">
              Gradient
            </button>
          </div>

          <template v-if="(z.densityMode ?? 'uniform') !== 'gradient'">
            <input
              type="range" :min="DENSITY_MIN" :max="DENSITY_MAX" step="0.05"
              v-model.number="z.density"
              class="w-full mt-1.5"
              :class="sliderClassForDensity(z.density)" />

            <div class="relative h-3 -mt-1">
              <div v-for="t in densityTicks" :key="`${t.ppm}-${t.standard ? 'standard' : 'tick'}`"
                   class="absolute -translate-x-1/2 text-[9px] select-none"
                   :class="t.crush ? 'text-red-700' : 'text-ink-700'"
                   :style="tickStyle(t.ppm)"
                   :title="t.label">
                <div class="h-1.5 w-px mx-auto"
                     :class="t.crush ? 'bg-red-400' : 'bg-ink-200'" />
                <div>{{ tickLabel(t) }}</div>
              </div>
            </div>
          </template>

          <div v-else class="mt-2 rounded-md border border-ink-100 bg-ink-50/60 p-2">
            <div class="flex items-center justify-between gap-2">
              <button type="button"
                      class="text-[11px] rounded border border-ink-200 bg-white px-2 py-1 hover:bg-ink-50"
                      @click.stop="onPickGradient(z)">
                {{ gradientPickLabel(z) }}
              </button>
              <span class="text-[10px] text-ink-600 tabular-nums">
                {{ gradientDirectionDistance(z) }}
              </span>
            </div>
            <div class="mt-1 text-[10px] leading-snug"
                 :class="gradientReady(z) && state.gradientPicking?.zoneId !== z.id ? 'text-emerald-700' : 'text-amber-700'">
              {{ gradientStatus(z) }}
            </div>
            <div class="mt-2 space-y-1">
              <div v-for="(stop, i) in sortedStops(z)" :key="i"
                   class="grid items-center gap-1"
                   :class="sortedStops(z).length > 2 ? 'grid-cols-[1fr_1fr_auto]' : 'grid-cols-2'">
                <label class="text-[10px] text-ink-700">
                  {{ stopLabel(z, i) }}
                  <input v-model.number="stop.distanceM"
                         type="number"
                         min="0"
                         step="1"
                         class="mt-0.5 h-7 w-full rounded border border-ink-100 px-1 text-xs"
                         @click.stop />
                </label>
                <label class="text-[10px] text-ink-700">
                  ppl/m²
                  <input v-model.number="stop.density"
                         type="number"
                         min="0"
                         max="10"
                         step="0.05"
                         class="mt-0.5 h-7 w-full rounded border border-ink-100 px-1 text-xs"
                         @click.stop />
                </label>
                <button v-if="sortedStops(z).length > 2"
                        class="mt-3.5 px-1 text-ink-700 hover:text-red-600 text-[11px]"
                        title="Remove this density point"
                        @click.stop="removeGradientStop(z, i)">✕</button>
              </div>
              <button class="text-[11px] text-sky-700 hover:underline"
                      title="Insert a density point between the existing ones"
                      @click.stop="addGradientStop(z)">
                + Add density point
              </button>
            </div>
          </div>

          <!-- Obstructions sub-list — only shown when this zone has any. -->
          <div v-if="z.obstructions && z.obstructions.length" class="mt-2 pl-2 border-l-2 border-ink-100">
            <div class="text-[10px] uppercase tracking-wide text-ink-700 mb-1">Obstructions</div>
            <div v-for="(o, i) in z.obstructions" :key="o.id"
                 class="flex items-center justify-between gap-2 text-[11px] text-ink-700">
              <span>Obstruction {{ i + 1 }}</span>
              <span class="tabular-nums">{{ fmtArea(obstructionAreaM2(z, o)) }}</span>
              <button class="text-ink-700 hover:text-red-600 px-1"
                      @click.stop="deleteObstruction(z.id, o.id)">✕</button>
            </div>
          </div>
          <div v-if="z.vertices.length >= 3" class="mt-2 flex items-center gap-3 flex-wrap">
            <button class="text-[11px] text-amber-700 hover:underline"
                    @click.stop="onAddObstruction(z.id)">
              + Add obstruction
            </button>
            <!-- Aim mode: next map click sets z.facingPoint. People in this
                 zone (2D icons + 3D mannequins) re-orient toward that point
                 with a ±15° jitter so the crowd doesn't look like a regiment. -->
            <button class="text-[11px] hover:underline"
                    :class="state.aiming === z.id ? 'text-emerald-700 font-semibold' : 'text-sky-700'"
                    :title="state.aiming === z.id
                      ? 'Click on the map to drop the focus point (Esc to cancel)'
                      : (z.facingPoint ? 'Pick a new focus point on the map' : 'Aim the crowd at a point on the map')"
                    @click.stop="onAim(z.id)">
              {{ state.aiming === z.id
                 ? 'Click map to aim…'
                 : (z.facingPoint ? 'Aim set' : 'Aim crowd') }}
            </button>
            <button v-if="z.facingPoint && state.aiming !== z.id"
                    class="text-[11px] text-ink-700 hover:text-red-600"
                    title="Clear the focus point (crowd returns to random orientation)"
                    @click.stop="onClearAim(z.id)">
              ✕ clear aim
            </button>
          </div>


          <div v-if="z.vertices.length >= 3" class="mt-2 flex items-center gap-1.5">
            <span class="inline-block w-2 h-2 rounded-full" :style="{ background: zoneBadge(z).color }" />
            <span class="text-xs" :style="{ color: zoneBadge(z).color }">
              {{ standardLimitLabel(z) }}
            </span>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
