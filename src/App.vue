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
import { useApp } from './lib/state.js'

const { state, restoreFromUrl } = useApp()
const mapRef = ref(null)

onMounted(() => { restoreFromUrl() })

function onPick(r) { mapRef.value?.fly(r) }
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
        @click="state.ui.aboutOpen = true">About</button>
    </header>

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

    <AboutPanel v-if="state.ui.aboutOpen" @close="state.ui.aboutOpen = false" />
  </div>
</template>
