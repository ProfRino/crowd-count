<script setup>
import { computed, ref } from 'vue'
import { useApp } from '../lib/state.js'
import { fmtArea as fmtAreaUnits } from '../lib/units.js'

const { state, computeTotals, shareLink } = useApp()
const totals = computed(() => computeTotals())
const copied = ref(false)

function fmtArea(m2) { return fmtAreaUnits(m2, state.units) }

async function copyShare() {
  try {
    await navigator.clipboard.writeText(shareLink())
    copied.value = true
    setTimeout(() => copied.value = false, 1600)
  } catch {
    prompt('Copy this link:', shareLink())
  }
}
</script>

<template>
  <div class="bg-white/95 rounded-lg shadow-xl border border-ink-100 px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-center gap-3 sm:gap-5 max-w-[calc(100vw-1rem)]">
    <div>
      <div class="text-[10px] uppercase tracking-wide text-ink-700">Total area</div>
      <div class="text-sm font-semibold tabular-nums">{{ fmtArea(totals.area) }}</div>
    </div>
    <div class="w-px h-8 bg-ink-100" />
    <div>
      <div class="text-[10px] uppercase tracking-wide text-ink-700">Estimated crowd</div>
      <div class="text-2xl font-bold leading-none tabular-nums">{{ totals.count.toLocaleString() }}</div>
    </div>
    <div class="w-px h-8 bg-ink-100" />
    <button
      class="text-xs px-3 py-1.5 rounded border border-ink-100 hover:bg-ink-50"
      @click="copyShare">
      {{ copied ? 'Copied ✓' : 'Copy share link' }}
    </button>
  </div>
</template>
