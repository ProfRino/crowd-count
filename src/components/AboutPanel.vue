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
        <button class="text-ink-700 hover:text-ink-900" aria-label="Close About" @click="emit('close')">✕</button>
      </header>

      <section class="text-sm leading-relaxed space-y-3">
        <p>
          A browser-only tool to estimate crowd size from a map polygon or an indoor floor plan.
          Calculations and project editing run locally; Crowd Count has no application backend.
        </p>

        <h3 class="font-semibold mt-4">What the app includes</h3>
        <ul class="list-disc pl-5 space-y-1 text-ink-900 text-xs">
          <li>Outdoor map and indoor floor-plan workflows with polygon, rectangle, and circle zones.</li>
          <li>Obstructions, multiple zones, metric/imperial units, a multi-segment ruler, save/open, and share links.</li>
          <li>Uniform density or a two-point linear density gradient with a movable direction axis.</li>
          <li>Density guidance from the Purple Guide, Green Guide, NFPA 101, and Keith Still.</li>
          <li>2D people, 3D site visualisation, crowd colour/orientation controls, and aim points.</li>
          <li>Simple and animated 3 x 3 m density references for 1-6 people/m².</li>
        </ul>

        <h3 class="font-semibold mt-4">How the estimate is calculated</h3>
        <p>
          Uniform zones use <em>usable area &times; density</em>, after subtracting obstructions.
          Gradient zones integrate the changing density across the actual zone and obstruction
          geometry. The displayed people are a visualisation of that estimate, not an evacuation,
          movement, visibility, or behavioural simulation.
        </p>
        <p class="text-xs text-ink-700">
          Crowds are rarely uniformly packed. Results are planning estimates, not certified
          capacities or proof of safety. Published thresholds are reference points; real risk also
          depends on movement, ingress/egress, barriers, terrain, behaviour, demographics, weather,
          emergency arrangements, and competent professional assessment.
        </p>

        <h3 class="font-semibold mt-4">Projects, sharing, and privacy</h3>
        <ul class="list-disc pl-5 space-y-1 text-ink-900 text-xs">
          <li>Save/Open stores project data in a local file; a share link encodes project data in its URL.</li>
          <li>The optional Google API key is stored only in this browser's localStorage and is not included in project files or share links.</li>
          <li>Network requests are made to the selected tile provider, OpenStreetMap Nominatim search, Google services when enabled, and YouTube when the tutorial loads.</li>
          <li>The animated 3D density references are large models that stream from the Crowd Count website (GitHub Pages) when no local copy is available.</li>
        </ul>

        <h3 class="font-semibold mt-4">3D views</h3>
        <p class="text-xs text-ink-700">
          Drag to orbit; Shift/Space-drag or middle-drag to pan; Alt-drag or scroll to zoom.
          Keyboard movement uses WASD, Q/E, R/F, and +/-. Press H for a crowd wave. Camera presets
          provide looping site-view movements.
        </p>
        <ul class="list-disc pl-5 space-y-1 text-ink-900 text-xs">
          <li>OpenStreetMap/Esri mode uses a tiled floor and OSM buildings; Google mode uses optional Photorealistic 3D Tiles.</li>
          <li>In Google 3D mode, <strong>Reset height</strong> places people and the zone overlay against the currently loaded tile geometry.</li>
          <li>The separate 3D density reference compares 1-6 people/m² in a 3 x 3 m area using simple or animated models.</li>
        </ul>

        <h3 class="font-semibold mt-4">Data sources and attribution</h3>
        <ul class="list-disc pl-5 space-y-1 text-ink-900 text-xs">
          <li>Map tiles, search data, and buildings &copy; <a class="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors. Search is provided through Nominatim.</li>
          <li>Satellite tiles &copy; Esri and its data providers.</li>
          <li>Optional 2D and Photorealistic 3D tiles are provided by Google Maps Platform. Google and third-party tile attribution is displayed with the active map or renderer. See the <a class="underline" href="https://developers.google.com/maps/documentation/tile/policies" target="_blank" rel="noopener noreferrer">Map Tiles API policies</a>.</li>
          <li>The API key dialog links to Google billing reports, request traffic, quotas, and current pricing; Crowd Count cannot read account usage from an API key.</li>
          <li>Human model: <a class="underline" href="https://sketchfab.com/3d-models/basic-human-model-3e26036b0c7f42edbe01d7027c76e939" target="_blank" rel="noopener noreferrer">Basic human model</a> by Night12fury (<a class="underline" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC&nbsp;BY&nbsp;4.0</a>).</li>
          <li>Indoor sample: <a class="underline" href="https://commons.wikimedia.org/wiki/File:Equitable_first_floor_plan.png" target="_blank" rel="noopener noreferrer">Equitable Building first-floor plan</a>, NYC 1915, public domain (Architectural Record).</li>
        </ul>

        <h3 class="font-semibold mt-4">References</h3>
        <ul class="list-disc pl-5 space-y-1 text-ink-900">
          <li><a class="underline" href="https://www.thepurpleguide.co.uk/" target="_blank" rel="noopener">The Purple Guide</a> — UK event-industry safety standard.</li>
          <li><a class="underline" href="https://www.gov.uk/government/publications/guide-to-safety-at-sports-grounds-green-guide" target="_blank" rel="noopener">Green Guide</a> — Safety at Sports Grounds.</li>
          <li><a class="underline" href="https://www.gkstill.com/Support/crowd-density/CrowdDensity-1.html" target="_blank" rel="noopener">Keith Still — Crowd Density</a>.</li>
          <li><a class="underline" href="https://www.hse.gov.uk/event-safety/crowd-management.htm" target="_blank" rel="noopener">UK HSE — Managing Crowds Safely (HSG154)</a>.</li>
          <li>NFPA 101 Table 7.3.1.2 — Life Safety Code occupant load factors.</li>
        </ul>

        <h3 class="font-semibold mt-4">Tutorial</h3>
        <p class="text-xs text-ink-700 mb-2">
          Short walk-through of how to draw zones, set densities, and read the estimate.
        </p>
        <div class="relative w-full rounded-md overflow-hidden border border-ink-100"
             style="padding-top: 56.25%">
          <iframe
            class="absolute inset-0 w-full h-full"
            src="https://www.youtube-nocookie.com/embed/TPXZ6oP3dDE"
            title="Crowd Count — tutorial"
            loading="lazy"
            referrerpolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen />
        </div>
        <p class="text-[11px] text-ink-700 mt-1">
          Trouble loading?
          <a class="underline" href="https://youtu.be/TPXZ6oP3dDE" target="_blank" rel="noopener">
            Watch on YouTube
          </a>.
        </p>

        <h3 class="font-semibold mt-6 pt-3 border-t border-ink-100">For developers</h3>

        <h4 class="font-semibold mt-3 text-sm">Tech</h4>
        <p class="text-xs text-ink-700">
          Vue 3 + Vite + Tailwind + MapLibre GL + Turf.js + Three.js + 3d-tiles-renderer + Earcut.
        </p>

        <h4 class="font-semibold mt-3 text-sm">Source code</h4>
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
          © 2026 Rino Lovreglio · Massey University.
        </p>
      </section>
    </div>
  </div>
</template>
