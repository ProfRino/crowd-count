<script setup>
import { ref } from 'vue'
const expanded = ref(false)
</script>

<template>
  <div class="bg-ink-100 border-t border-ink-200 text-[10.5px] text-ink-900 px-3 py-1 flex items-start gap-2 z-10">
    <span aria-hidden="true">⚠</span>
    <div class="flex-1 leading-tight">
      <button
        type="button"
        class="text-left hover:underline focus:outline-none"
        :aria-expanded="expanded"
        @click="expanded = !expanded">
        <strong>Estimate only</strong> — verify with a qualified safety professional.
        Not for life-safety, design, or regulatory use.
        <span class="text-ink-700 ml-1">{{ expanded ? '(hide)' : '(more)' }}</span>
      </button>
      <p v-if="expanded" class="mt-1 text-ink-700 leading-snug">
        Crowd Count is a Fermi-style order-of-magnitude estimator. It multiplies a
        polygon area by a user-chosen density and benchmarks the result against
        published thresholds. Real crowd safety depends on many factors the tool
        does not model — flow direction, available exits, surface conditions,
        group behaviour, crowd composition, weather, time of day, event type. The
        authors and Massey University accept no responsibility for any decisions
        made on the basis of this tool's output. The software is provided
        <em>"as is"</em>, without warranty of any kind, under the MIT License.
      </p>
    </div>
  </div>
</template>
