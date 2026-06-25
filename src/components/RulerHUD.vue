<script setup>
import { computed } from 'vue'
import { useApp } from '../lib/state.js'
import { polylineTotals, fmtDistance } from '../lib/ruler.js'

const { state } = useApp()

const polyline = computed(() =>
  polylineTotals(state.ruler.points, state.ruler.cursor, state.mode, state.indoor.pixelsPerMeter)
)
</script>

<template>
  <div v-if="state.ruler.active"
       class="absolute top-3 right-16 z-20 bg-white/95 rounded-lg shadow-lg border border-sky-200 px-3 py-2 text-xs min-w-[180px]">
    <div class="text-[10px] uppercase tracking-wide text-sky-700">
      Ruler
    </div>
    <div v-if="polyline.total > 0" class="text-sm font-semibold mt-0.5">
      {{ fmtDistance(polyline.total, state.units) }}
    </div>
    <div v-else class="text-ink-700 mt-0.5">Click points to measure</div>
    <div v-if="polyline.segments.length > 1" class="text-[10px] text-ink-700 mt-1">
      {{ polyline.segments.length }} segments
    </div>
    <div class="text-[10px] text-ink-700 mt-1">Esc or double-click to finish</div>
  </div>
</template>
