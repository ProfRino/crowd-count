<script setup>
import { computed } from 'vue'
import { useApp } from '../lib/state.js'
import { STANDARDS } from '../lib/standards.js'

const { state } = useApp()
const items = Object.values(STANDARDS)
const standardBlurb = computed(() => STANDARDS[state.standard]?.blurb ?? STANDARDS.purple.blurb)
</script>

<template>
  <div>
    <label class="block text-xs uppercase tracking-wide text-ink-700 mb-1">Governing standard</label>
    <div class="grid grid-cols-2 gap-1">
      <button
        v-for="s in items" :key="s.key"
        class="text-xs px-2 py-1 rounded border text-left"
        :class="state.standard === s.key
          ? 'bg-ink-900 text-white border-ink-900'
          : 'bg-white text-ink-900 border-ink-100 hover:bg-ink-50'"
        :title="s.blurb"
        @click="state.standard = s.key">
        <div class="font-medium">{{ s.short }}</div>
        <div class="text-[10px] opacity-75">{{ s.name }}</div>
      </button>
    </div>
    <div class="mt-1 text-[10px] text-ink-700 leading-snug">
      {{ standardBlurb }}
    </div>
  </div>
</template>
