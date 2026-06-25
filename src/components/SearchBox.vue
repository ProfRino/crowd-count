<script setup>
import { ref, watch } from 'vue'
import { searchPlace } from '../lib/nominatim.js'

const props = defineProps({ onPick: Function })

const q = ref('')
const results = ref([])
const loading = ref(false)
const error = ref(null)
const open = ref(false)
let ac = null
let timer = null

watch(q, (v) => {
  clearTimeout(timer)
  error.value = null
  if (!v.trim()) { results.value = []; open.value = false; return }
  timer = setTimeout(run, 350)
})

async function run() {
  ac?.abort()
  ac = new AbortController()
  loading.value = true
  try {
    results.value = await searchPlace(q.value, { signal: ac.signal, limit: 6 })
    open.value = true
  } catch (e) {
    if (e.name !== 'AbortError') { error.value = e.message; results.value = [] }
  } finally {
    loading.value = false
  }
}

function pick(r) {
  open.value = false
  q.value = r.name.split(',')[0]
  props.onPick?.(r)
}
</script>

<template>
  <div class="relative">
    <label class="block text-xs uppercase tracking-wide text-ink-700 mb-1">Find a place</label>
    <input
      v-model="q"
      type="search"
      placeholder="e.g. Place de la Concorde"
      class="w-full px-2.5 py-1.5 rounded border border-ink-200 text-sm focus:outline-none focus:border-ink-700"
      @focus="results.length && (open = true)"
      @blur="setTimeout(() => open = false, 150)" />
    <div v-if="loading" class="absolute right-2 top-7 text-xs text-ink-700">…</div>
    <ul v-if="open && results.length"
        class="absolute z-30 left-0 right-0 mt-1 bg-white rounded shadow-lg border border-ink-100 max-h-72 overflow-y-auto text-sm">
      <li v-for="r in results" :key="r.name + r.lat"
          @mousedown.prevent="pick(r)"
          class="px-2.5 py-1.5 hover:bg-ink-50 cursor-pointer border-b border-ink-100 last:border-b-0">
        <div class="text-ink-900 truncate">{{ r.name.split(',')[0] }}</div>
        <div class="text-xs text-ink-700 truncate">{{ r.name }}</div>
      </li>
    </ul>
    <div v-if="error" class="mt-1 text-xs text-red-600">{{ error }}</div>
    <div class="mt-1 text-[10px] text-ink-700">Search via OpenStreetMap Nominatim.</div>
  </div>
</template>
