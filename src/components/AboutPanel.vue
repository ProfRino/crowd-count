<script setup>
const emit = defineEmits(['close'])
</script>

<template>
  <div class="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4"
       @click.self="emit('close')">
    <div class="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
      <header class="flex items-center mb-3">
        <h2 class="text-lg font-semibold">About Crowd Count</h2>
        <div class="flex-1" />
        <button class="text-ink-700 hover:text-ink-900" @click="emit('close')">✕</button>
      </header>

      <section class="text-sm leading-relaxed space-y-3">
        <p>
          A browser-only tool to estimate crowd size from a map polygon or an indoor floor plan.
          Everything runs locally — there is no backend, and your data never leaves the tab.
        </p>

        <h3 class="font-semibold mt-4">How to read the numbers</h3>
        <p>
          The estimate is <em>area &times; density</em>. Crowds are rarely uniformly packed and
          this number is a <strong>Fermi estimate</strong> — useful for sanity-checking
          orders-of-magnitude, not for certifying safety. Use the governing-standard picker
          to anchor the density to a published threshold (Purple Guide, Green Guide, NFPA 101,
          or Keith Still's upper safe limit).
        </p>
        <p class="text-amber-900 bg-amber-50 border border-amber-200 rounded p-2">
          Above ~5&nbsp;ppl/m&sup2; crowds enter the <strong>crush-density regime</strong> where the
          linear area&times;density model is misleading — the safety question is no longer
          how many people are present, but whether they can still control their own motion.
        </p>

        <h3 class="font-semibold mt-4">Demo content</h3>
        <ul class="list-disc pl-5 space-y-1 text-ink-900 text-xs">
          <li>Indoor sample: <a class="underline" href="https://commons.wikimedia.org/wiki/File:Equitable_first_floor_plan.png" target="_blank" rel="noopener">Equitable Building first-floor plan</a>, NYC 1915, public domain (Architectural Record).</li>
        </ul>

        <h3 class="font-semibold mt-4">References</h3>
        <ul class="list-disc pl-5 space-y-1 text-ink-900">
          <li><a class="underline" href="https://www.thepurpleguide.co.uk/" target="_blank" rel="noopener">The Purple Guide</a> — UK event-industry safety standard.</li>
          <li><a class="underline" href="https://www.gov.uk/government/publications/guide-to-safety-at-sports-grounds-green-guide" target="_blank" rel="noopener">Green Guide</a> — Safety at Sports Grounds.</li>
          <li><a class="underline" href="https://www.gkstill.com/Support/crowd-density/CrowdDensity-1.html" target="_blank" rel="noopener">Keith Still — Crowd Density</a>.</li>
          <li><a class="underline" href="https://www.hse.gov.uk/event-safety/crowd-management.htm" target="_blank" rel="noopener">UK HSE — Managing Crowds Safely (HSG154)</a>.</li>
          <li>NFPA 101 Table 7.3.1.2 — Life Safety Code occupant load factors.</li>
        </ul>

        <h3 class="font-semibold mt-4">Tech</h3>
        <p class="text-xs text-ink-700">
          Vue 3 + Vite + Tailwind + MapLibre GL (OSM tiles, Esri satellite tiles) + Turf.js.
        </p>

        <h3 class="font-semibold mt-4">Source code</h3>
        <p class="text-xs text-ink-700">
          <a class="underline" href="https://github.com/ProfRino/crowd-count" target="_blank" rel="noopener">
            github.com/ProfRino/crowd-count
          </a>
        </p>

        <h3 class="font-semibold mt-4">License</h3>
        <p class="text-xs text-ink-700">
          MIT License —
          <a class="underline" href="https://github.com/ProfRino/crowd-count/blob/main/LICENSE" target="_blank" rel="noopener">
            full text
          </a>.
          The software is provided <em>"as is"</em>, without warranty of any kind.
        </p>

        <h3 class="font-semibold mt-4">Citation</h3>
        <p class="text-xs text-ink-700">
          If you reference this work, please cite:
        </p>
        <blockquote class="text-xs text-ink-900 border-l-2 border-ink-200 pl-3 italic">
          Lovreglio, R. <em>Crowd Count</em>. Massey University.
          <a class="underline not-italic" href="https://github.com/ProfRino/crowd-count" target="_blank" rel="noopener">
            github.com/ProfRino/crowd-count
          </a>
        </blockquote>

        <p class="text-[10px] text-ink-700 pt-3 border-t border-ink-100 mt-4">
          © 2026 Rino Lovreglio · Massey University · All rights reserved.
        </p>
      </section>
    </div>
  </div>
</template>
