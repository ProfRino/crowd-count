<script setup>
import { useApp } from '../lib/state.js'
import { STILL_TICKS, DENSITY_MIN, DENSITY_MAX, CRUSH_THRESHOLD } from '../lib/standards.js'
import { fmtAreaCompact, fmtDensity } from '../lib/units.js'

const {
  state, addZone, deleteZone, selectZone,
  zoneAreaM2, obstructionAreaM2, zoneBadge,
  addObstruction, deleteObstruction, enterMode,
} = useApp()

function tickPos(ppm) {
  return ((ppm - DENSITY_MIN) / (DENSITY_MAX - DENSITY_MIN)) * 100
}

function fmtArea(m2) { return fmtAreaCompact(m2, state.units) }
function fmtCount(z) {
  const c = Math.round(zoneAreaM2(z) * z.density)
  return c.toLocaleString()
}
function fmtZoneDensity(d) { return fmtDensity(d, state.units) }
function shapeGlyph(z) { return z.shape === 'circle' ? '◯' : z.shape === 'rect' ? '▭' : '▱' }

function onAddZone() {
  addZone(null, state.drawTool ?? 'polygon')
  enterMode('drawing')
}
function onAddObstruction(zoneId) {
  selectZone(zoneId)
  addObstruction(zoneId)
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

    <div v-if="!state.zones.length" class="text-xs text-ink-700 italic">
      No zones yet. Pick a shape on the map toolbar, then click <span class="font-medium">+ Add zone</span>.
    </div>

    <ul class="space-y-2">
      <li v-for="z in state.zones" :key="z.id"
          class="border rounded-md"
          :class="state.selectedZoneId === z.id ? 'border-ink-900' : 'border-ink-100'">
        <div class="flex items-center gap-2 p-2"
             @click="selectZone(z.id)">
          <span class="w-3 h-3 rounded-sm shrink-0" :style="{ background: z.color }" />
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
            <span class="tabular-nums">{{ fmtZoneDensity(z.density) }}</span>
            <span>=</span>
            <span class="font-semibold text-ink-900 tabular-nums">{{ fmtCount(z) }}</span>
          </div>

          <input
            type="range" :min="DENSITY_MIN" :max="DENSITY_MAX" step="0.05"
            v-model.number="z.density"
            class="w-full mt-1.5"
            :class="z.density > 6 ? 'accent-red-700'
                    : z.density > 4 ? 'accent-amber-500'
                    : 'accent-ink-900'" />

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
          <button v-if="z.vertices.length >= 3"
                  class="mt-2 text-[11px] text-amber-700 hover:underline"
                  @click.stop="onAddObstruction(z.id)">
            + Add obstruction
          </button>


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
