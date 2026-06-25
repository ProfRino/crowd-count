<script setup>
import { useApp } from '../lib/state.js'
import { STILL_TICKS, DENSITY_MIN, DENSITY_MAX, CRUSH_THRESHOLD } from '../lib/standards.js'
import { fmtAreaCompact, fmtDensity } from '../lib/units.js'

const { state, addZone, deleteZone, selectZone, zoneAreaM2, zoneBadge } = useApp()

function tickPos(ppm) {
  return ((ppm - DENSITY_MIN) / (DENSITY_MAX - DENSITY_MIN)) * 100
}

function fmtArea(m2) { return fmtAreaCompact(m2, state.units) }
function fmtCount(z) {
  const c = Math.round(zoneAreaM2(z) * z.density)
  return c.toLocaleString()
}
function fmtZoneDensity(d) { return fmtDensity(d, state.units) }
</script>

<template>
  <div class="p-3">
    <div class="flex items-center justify-between mb-2">
      <div class="text-xs uppercase tracking-wide text-ink-700">Zones</div>
      <button
        class="text-xs px-2 py-1 rounded bg-ink-900 text-white hover:bg-ink-700"
        @click="addZone(); state.drawing = true">+ Add zone</button>
    </div>

    <div v-if="!state.zones.length" class="text-xs text-ink-700 italic">
      No zones yet. Click <span class="font-medium">+ Add zone</span> then click the map to drop vertices.
    </div>

    <ul class="space-y-2">
      <li v-for="z in state.zones" :key="z.id"
          class="border rounded-md"
          :class="state.selectedZoneId === z.id ? 'border-ink-900' : 'border-ink-100'">
        <div class="flex items-center gap-2 p-2"
             @click="selectZone(z.id)">
          <span class="w-3 h-3 rounded-sm shrink-0" :style="{ background: z.color }" />
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
            <span class="tabular-nums">{{ fmtZoneDensity(z.density) }}</span>
            <span>=</span>
            <span class="font-semibold text-ink-900 tabular-nums">{{ fmtCount(z) }}</span>
          </div>

          <input
            type="range" :min="DENSITY_MIN" :max="DENSITY_MAX" step="0.05"
            v-model.number="z.density"
            class="w-full mt-1.5"
            :class="z.density > CRUSH_THRESHOLD ? 'accent-red-700' : 'accent-ink-900'" />

          <!-- Tick marks: black for the safe regime, red dashed for the crush regime -->
          <div class="relative h-3 -mt-1">
            <div v-for="t in STILL_TICKS" :key="t.ppm"
                 class="absolute -translate-x-1/2 text-[9px] select-none"
                 :class="t.crush ? 'text-red-700' : 'text-ink-700'"
                 :style="{ left: tickPos(t.ppm) + '%' }"
                 :title="t.label">
              <div class="h-1.5 w-px mx-auto"
                   :class="t.crush ? 'bg-red-400' : 'bg-ink-200'" />
              <div>{{ t.ppm }}</div>
            </div>
          </div>

          <div v-if="z.density > CRUSH_THRESHOLD"
               class="mt-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 leading-snug">
            Above {{ CRUSH_THRESHOLD }} ppl/m² is the <strong>crush regime</strong> — area × density
            no longer estimates a safe headcount, only a crowd that has likely lost the ability
            to control its own motion.
          </div>

          <div v-if="z.vertices.length >= 3" class="mt-2 flex items-center gap-1.5">
            <span class="inline-block w-2 h-2 rounded-full" :style="{ background: zoneBadge(z).color }" />
            <span class="text-xs" :style="{ color: zoneBadge(z).color }">
              {{ zoneBadge(z).label }} ({{ zoneBadge(z).standardName }} = {{ zoneBadge(z).threshold.toFixed(2) }})
            </span>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
