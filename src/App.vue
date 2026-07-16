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
import Site3DView from './components/Site3DView.vue'
import SiteToolbar from './components/SiteToolbar.vue'
import ApiKeyModal from './components/ApiKeyModal.vue'
import { useApp } from './lib/state.js'

const { state, restoreFromUrl, saveProjectToFile, openProjectFromFile } = useApp()
const mapRef = ref(null)
const density3DOpen = ref(false)
const apiKeyOpen = ref(false)
const openFileInput = ref(null)
const openError = ref('')

onMounted(() => { restoreFromUrl() })

function onPick(r) { mapRef.value?.fly(r) }

function onSave() { saveProjectToFile() }
function triggerOpen() { openError.value = ''; openFileInput.value?.click() }
async function onOpenFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
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
function previewZoneColor() {
  const z = state.zones.find(z => z.id === state.selectedZoneId) ?? state.zones[0]
  return z?.color ?? ''
}
</script>

<template>
  <div class="h-full flex flex-col">
    <header class="bg-ink-900 text-white px-4 py-2 flex flex-wrap items-center gap-2 sm:gap-4 shadow-md z-20">
      <div class="font-semibold tracking-tight text-lg">Crowd Count</div>
      <div class="hidden sm:block flex-1" />
      <button
        class="text-xs px-2 py-1 rounded border border-ink-700 hover:bg-ink-700"
        :class="{ 'bg-ink-700': state.mode === 'outdoor' }"
        @click="state.mode = 'outdoor'">Outdoor</button>
      <button
        class="text-xs px-2 py-1 rounded border border-ink-700 hover:bg-ink-700"
        :class="{ 'bg-ink-700': state.mode === 'indoor' }"
        @click="state.mode = 'indoor'; state.viewMode = '2d'">Indoor</button>
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
        :title="state.googleMapsKey ? 'Google API key set - click to manage' : 'Set your Google Maps API key to unlock Google basemap + 3D tiles'"
        @click="apiKeyOpen = true">
        API key
      </button>
      <button
        class="text-xs px-2 py-1 rounded border border-ink-700 hover:bg-ink-700"
        @click="state.ui.aboutOpen = true">About</button>
    </header>

    <div v-if="openError"
         class="bg-red-100 text-red-800 text-xs px-4 py-1.5 flex items-center gap-2 z-10">
      <span class="font-medium">Open failed:</span>
      <span>{{ openError }}</span>
      <div class="flex-1" />
      <button class="text-red-800 hover:text-red-900" @click="openError = ''">x</button>
    </div>

    <main class="flex-1 flex flex-col md:flex-row relative min-h-0">
      <aside class="w-full md:w-80 shrink-0 bg-white border-b md:border-b-0 md:border-r border-ink-100 flex flex-col min-h-0 max-h-[42vh] md:max-h-none">
        <div class="p-3 border-b border-ink-100">
          <SearchBox v-if="state.mode === 'outdoor'" :on-pick="onPick" />
          <IndoorOverlay v-else />
        </div>
        <div class="p-3 border-b border-ink-100">
          <StandardPicker />
        </div>
        <ZonePanel class="flex-1 overflow-y-auto" />
      </aside>

      <section class="flex-1 relative min-h-[45vh] md:min-h-0">
        <template v-if="state.mode === 'outdoor'">
          <MapCanvas v-if="state.viewMode === '2d'" ref="mapRef" />
          <Site3DView v-else />
          <SiteToolbar />
        </template>
        <IndoorCanvas v-else />
        <RulerHUD v-if="state.mode === 'indoor' || state.viewMode === '2d'" />
        <ResultBar
          v-if="state.mode === 'indoor' || state.viewMode === '2d'"
          class="absolute inset-x-2 bottom-2 z-10 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:bottom-4" />
      </section>
    </main>

    <DisclaimerBar />

    <AboutPanel v-if="state.ui.aboutOpen" @close="state.ui.aboutOpen = false" />
    <ApiKeyModal v-if="apiKeyOpen" @close="apiKeyOpen = false" />
    <Density3DPreview
      v-if="density3DOpen"
      :density="previewDensity()"
      :zone-name="previewZoneName()"
      :zone-color="previewZoneColor()"
      @close="density3DOpen = false" />
  </div>
</template>
