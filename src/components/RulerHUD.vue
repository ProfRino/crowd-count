<script setup>
import { computed } from 'vue'
import { useApp } from '../lib/state.js'
import { polylineTotals, fmtDistance } from '../lib/ruler.js'

const { state, finishRuler } = useApp()

const clicked = computed(() =>
  polylineTotals(state.ruler.points, null, state.mode, state.indoor.pixelsPerMeter)
)
const preview = computed(() =>
  polylineTotals(state.ruler.points, state.ruler.cursor, state.mode, state.indoor.pixelsPerMeter)
)
const committedSegments = computed(() => Math.max(0, state.ruler.points.length - 1))
const hasLiveNext = computed(() =>
  state.ruler.active && state.ruler.cursor && state.ruler.points.length > 0
)
const liveNextMeters = computed(() =>
  hasLiveNext.value ? Math.max(0, preview.value.total - clicked.value.total) : 0
)

function done() {
  finishRuler()
}

function clear() {
  finishRuler({ clear: true })
}
</script>

<template>
  <div v-if="state.ruler.active || state.ruler.points.length"
       class="absolute left-3 top-16 z-30 w-[260px] rounded-md border border-sky-300 bg-white/95 px-3 py-2 text-xs shadow-xl">
    <div class="flex items-center justify-between gap-2">
      <div class="text-[10px] uppercase tracking-wide text-sky-700">
        {{ state.ruler.active ? 'Measuring' : 'Measured' }}
      </div>
      <div class="flex items-center gap-1">
        <button
          v-if="state.ruler.active"
          type="button"
          class="rounded border border-sky-200 px-2 py-0.5 text-[10px] font-medium text-sky-800 hover:bg-sky-50"
          @click="done">
          Done
        </button>
        <button
          type="button"
          class="rounded border border-ink-100 px-2 py-0.5 text-[10px] font-medium text-ink-700 hover:bg-ink-50"
          @click="clear">
          Clear
        </button>
      </div>
    </div>
    <div class="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
      <div class="text-ink-700">Clicked distance</div>
      <div class="font-semibold tabular-nums text-ink-900">
        {{ fmtDistance(clicked.total, state.units) }}
      </div>
      <template v-if="hasLiveNext">
        <div class="text-sky-700">Next click adds</div>
        <div class="font-semibold tabular-nums text-sky-800">
          {{ fmtDistance(liveNextMeters, state.units) }}
        </div>
        <div class="text-ink-700">Total if clicked</div>
        <div class="font-semibold tabular-nums text-ink-900">
          {{ fmtDistance(preview.total, state.units) }}
        </div>
      </template>
    </div>
    <div class="mt-2 flex items-center gap-2 text-[10px] text-ink-700">
      <span>{{ state.ruler.points.length }} point{{ state.ruler.points.length === 1 ? '' : 's' }}</span>
      <span>{{ committedSegments }} segment{{ committedSegments === 1 ? '' : 's' }}</span>
    </div>
  </div>
</template>
