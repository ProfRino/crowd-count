<script setup>
import { computed } from 'vue'
import { useApp } from '../lib/state.js'
import { polylineTotals, radiusMeters, circleAreaM2, fmtDistance } from '../lib/ruler.js'
import { fmtArea } from '../lib/units.js'

const { state, getSelectedZone } = useApp()

const ppm = computed(() => state.indoor.pixelsPerMeter)
const mode = computed(() => state.mode)
const units = computed(() => state.units)

const polyline = computed(() => {
  const r = polylineTotals(state.ruler.points, state.ruler.cursor, mode.value, ppm.value)
  return r
})
const radius = computed(() => {
  if (!state.ruler.center) return null
  const edge = state.ruler.radiusPoint ?? state.ruler.cursor
  if (!edge) return null
  const r = radiusMeters(state.ruler.center, edge, mode.value, ppm.value)
  return { rM: r, areaM2: circleAreaM2(r) }
})

const zone = computed(() => getSelectedZone())
const peopleInCircle = computed(() => {
  if (!radius.value || !zone.value) return null
  return Math.round(radius.value.areaM2 * zone.value.density)
})
</script>

<template>
  <div v-if="state.ruler.active"
       class="absolute top-3 right-16 z-20 bg-white/95 rounded-lg shadow-lg border border-sky-200 px-3 py-2 text-xs min-w-[180px]">
    <div class="text-[10px] uppercase tracking-wide text-sky-700">
      Ruler — {{ state.ruler.tool }}
    </div>
    <div v-if="state.ruler.tool === 'polyline'">
      <div v-if="polyline.total > 0" class="text-sm font-semibold mt-0.5">
        {{ fmtDistance(polyline.total, units) }}
      </div>
      <div v-else class="text-ink-700 mt-0.5">Click points to measure</div>
      <div v-if="polyline.segments.length > 1" class="text-[10px] text-ink-700 mt-1">
        {{ polyline.segments.length }} segments
      </div>
      <div class="text-[10px] text-ink-700 mt-1">Esc to finish · double-click to commit</div>
    </div>
    <div v-else>
      <div v-if="radius" class="text-sm font-semibold mt-0.5">
        r = {{ fmtDistance(radius.rM, units) }}
      </div>
      <div v-if="radius" class="text-xs text-ink-700">
        area {{ fmtArea(radius.areaM2, units) }}
      </div>
      <div v-if="radius && peopleInCircle != null" class="text-xs text-ink-700">
        ≈ {{ peopleInCircle.toLocaleString() }} people @ {{ zone?.density.toFixed(2) }} ppl/m²
      </div>
      <div v-else-if="!radius" class="text-ink-700 mt-0.5">Click-drag a centre to start</div>
    </div>
  </div>
</template>
