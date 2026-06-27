<script setup>
import { onMounted, ref } from 'vue'
import MapCanvas from './components/MapCanvas.vue'
import IndoorCanvas from './components/IndoorCanvas.vue'
import ZonePanel from './components/ZonePanel.vue'
import SearchBox from './components/SearchBox.vue'
import StandardPicker from './components/StandardPicker.vue'
import ResultBar from './components/ResultBar.vue'
import IndoorOverlay from './components/IndoorOverlay.vue'
import AboutPanel from './components/AboutPanel.vue'
import RulerHUD from './components/RulerHUD.vue'
import Density3DPreview from './components/Density3DPreview.vue'
import DisclaimerBar from './components/DisclaimerBar.vue'
import { useApp } from './lib/state.js'

const { state, restoreFromUrl, saveProjectToFile, openProjectFromFile } = useApp()
const mapRef = ref(null)
const density3DOpen = ref(false)
const openFileInput = ref(null)
const openError = ref('')

onMounted(() => { restoreFromUrl() })

function onPick(r) { mapRef.value?.fly(r) }

function onSave() { saveProjectToFile() }
function triggerOpen() { openError.value = ''; openFileInput.value?.click() }
async function onOpenFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''   // allow re-selecting the same file later
  if (!file) return
  const { error } = await openProjectFromFile(file)
  if (error) openError.value = error
}

function previewDensity() {
  const z = state.zones.find(z => z.id === state.selectedZoneId) ?? state.zones[0]
  return z?.density ?? 2
}
function previewZoneName() {
  const z = state.zones.find(z => z.id === state.selectedZoneId) ?? state.zones[0]
  return z?.name ?? ''
}
</script>

<template>
  <div class="h-full flex flex-col">
    <header class="bg-ink-900 text-white px-4 py-2 flex items-center gap-4 shadow-md z-20">
      <div class="font-semibold tracking-tight text-lg">Crowd Count</div>
      <div class="text-ink-200 text-xs hidden sm:block">area × density × a sanity check</div>
      <div class="flex-1" />
      <button
        class="text-xs px-2 py-1 rounded border border-ink-700 hover:bg-ink-700"
        :class="{ 'bg-ink-700': state.mode === 'outdoor' }"
        @click="state.mode = 'outdoor'">Outdoor</button>
      <button
        class="text-xs px-2 py-1 rounded border border-ink-700 hover:bg-ink-700"
        :class="{ 'bg-ink-700': state.mode === 'indoor' }"
        @click="state.mode = 'indoor'">Indoor</button>
      <button
        class="text-xs px-2 py-1 rounded border border-ink-700 hover:bg-ink-700"
        :title="`Switch to ${state.units === 'metric' ? 'imperial' : 'metric'} units`"
        @click="state.units = state.units === 'metric' ? 'imperial' : 'metric'">
        {{ state.units === 'metric' ? 'Metric' : 'Imperial' }}
      </button>
      <button
        class="text-xs px-2 py-1 rounded border border-ink-700 hover:bg-ink-700"
        title="3D crowd density reference"
        @click="density3DOpen = true">3D density</button>
      <button
        class="text-xs px-2 py-1 rounded border border-ink-700 hover:bg-ink-700"
        title="Save the current project to a JSON file"
        :disabled="!state.zones.length"
        :class="{ 'opacity-40 cursor-not-allowed': !state.zones.length }"
        @click="onSave">Save</button>
      <button
        class="text-xs px-2 py-1 rounded border border-ink-700 hover:bg-ink-700"
        title="Open a Crowd Count project file"
        @click="triggerOpen">Open</button>
      <input
        ref="openFileInput"
        type="file"
        accept="application/json,.json"
        class="hidden"
        @change="onOpenFile" />
      <button
        class="text-xs px-2 py-1 rounded border border-ink-700 hover:bg-ink-700"
        @click="state.ui.aboutOpen = true">About</button>
    </header>

    <div v-if="openError"
         class="bg-red-100 text-red-800 text-xs px-4 py-1.5 flex items-center gap-2 z-10">
      <span class="font-medium">Open failed:</span>
      <span>{{ openError }}</span>
      <div class="flex-1" />
      <button class="text-red-800 hover:text-red-900" @click="openError = ''">✕</button>
    </div>

    <main class="flex-1 flex relative min-h-0">
      <aside class="w-80 bg-white border-r border-ink-100 flex flex-col min-h-0">
        <div class="p-3 border-b border-ink-100">
          <SearchBox :on-pick="onPick" v-if="state.mode === 'outdoor'" />
          <IndoorOverlay v-else />
        </div>
        <div class="p-3 border-b border-ink-100">
          <StandardPicker />
        </div>
        <ZonePanel class="flex-1 overflow-y-auto" />
      </aside>

      <section class="flex-1 relative min-h-0">
        <MapCanvas v-if="state.mode === 'outdoor'" ref="mapRef" />
        <IndoorCanvas v-else />
        <RulerHUD />
        <ResultBar class="absolute left-1/2 -translate-x-1/2 bottom-4 z-10" />
      </section>
    </main>

    <DisclaimerBar />

    <AboutPanel v-if="state.ui.aboutOpen" @close="state.ui.aboutOpen = false" />
    <Density3DPreview
      v-if="density3DOpen"
      :density="previewDensity()"
      :zone-name="previewZoneName()"
      @close="density3DOpen = false" />
  </div>
</template>
