<script setup>
import { ref } from 'vue'
import { useApp } from '../lib/state.js'

const { state } = useApp()

// Public domain demo: Equitable Building (120 Broadway, NYC) first-floor plan,
// Architectural Record vol. 38 no. 1, July 1915. Hosted on Wikimedia Commons.
const DEMO_FLOOR_PLAN_URL = 'https://upload.wikimedia.org/wikipedia/commons/c/c6/Equitable_first_floor_plan.png'

const loadingDemo = ref(false)
const demoError = ref(null)
const demoHint = ref(null)

function onFile(e) {
  const f = e.target.files?.[0]
  if (!f) return
  const reader = new FileReader()
  reader.onload = () => {
    state.indoor.imageUrl = reader.result
    state.indoor.calibration = null
    state.indoor.pixelsPerMeter = null
    demoHint.value = null
  }
  reader.readAsDataURL(f)
}

async function loadDemo() {
  loadingDemo.value = true
  demoError.value = null
  try {
    const res = await fetch(DEMO_FLOOR_PLAN_URL, { mode: 'cors' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const dataUrl = await new Promise((ok, fail) => {
      const r = new FileReader()
      r.onload = () => ok(r.result); r.onerror = fail
      r.readAsDataURL(blob)
    })
    state.indoor.imageUrl = dataUrl
    // Auto-start calibration so the user can click two points immediately —
    // the demoDistance hint tells IndoorCanvas what default value to pre-fill.
    state.indoor.calibration = { phase: 'p1', p1: null, p2: null, demoDistance: 46 }
    state.indoor.pixelsPerMeter = null
    demoHint.value = 'Calibration is armed. Click the two endpoints of the Nassau Street frontage (the shorter avenue side), then confirm "46" when prompted.'
  } catch (e) {
    demoError.value = e.message ?? String(e)
  } finally {
    loadingDemo.value = false
  }
}

function startCalibration() {
  state.indoor.calibration = { phase: 'p1', p1: null, p2: null }
}

function clearImage() {
  state.indoor.imageUrl = null
  state.indoor.calibration = null
  state.indoor.pixelsPerMeter = null
  demoHint.value = null
}
</script>

<template>
  <div>
    <label class="block text-xs uppercase tracking-wide text-ink-700 mb-1">Floor plan</label>
    <input type="file" accept="image/*" @change="onFile"
           class="block w-full text-xs file:mr-2 file:px-2 file:py-1 file:rounded file:border file:border-ink-100 file:bg-white file:text-xs file:cursor-pointer" />

    <button
      class="mt-2 w-full text-xs px-2 py-1.5 rounded border border-ink-100 hover:bg-ink-50 text-left"
      :disabled="loadingDemo"
      @click="loadDemo">
      {{ loadingDemo ? 'Loading sample…' : 'Try sample (Equitable Building, NYC, 1915)' }}
    </button>
    <div v-if="demoError" class="mt-1 text-xs text-red-600">{{ demoError }}</div>
    <div v-if="demoHint" class="mt-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1 leading-snug">
      {{ demoHint }}
    </div>

    <div v-if="state.indoor.imageUrl" class="mt-2 space-y-2">
      <button
        class="w-full text-xs px-2 py-1.5 rounded border border-ink-100 hover:bg-ink-50"
        @click="startCalibration">
        {{ state.indoor.pixelsPerMeter ? 'Re-calibrate scale' : 'Calibrate scale (click 2 points)' }}
      </button>
      <div v-if="state.indoor.pixelsPerMeter" class="text-[11px] text-ink-700">
        Scale: <span class="font-medium">{{ state.indoor.pixelsPerMeter.toFixed(1) }} px / m</span>
      </div>
      <div v-else-if="state.indoor.calibration" class="text-[11px] text-amber-700">
        {{ state.indoor.calibration.phase === 'p1' ? 'Click the first reference point on the floor plan.' :
            state.indoor.calibration.phase === 'p2' ? 'Click the second reference point.' :
            'Enter the distance between the two points.' }}
      </div>
      <button class="w-full text-xs text-red-600 hover:underline" @click="clearImage">Remove floor plan</button>
    </div>
  </div>
</template>
