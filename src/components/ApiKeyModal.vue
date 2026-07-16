<script setup>
import { ref } from 'vue'
import { useApp } from '../lib/state.js'

const { state } = useApp()
const emit = defineEmits(['close'])

const draftKey = ref(state.googleMapsKey)
const showSetupSteps = ref(false)
const googleMapsMetricsUrl = 'https://console.cloud.google.com/project/_/google/maps-apis/metrics'
const googleBillingUrl = 'https://console.cloud.google.com/billing'
const googleMapsQuotasUrl = 'https://console.cloud.google.com/project/_/google/maps-apis/quotas'
const googleMapsPricingUrl = 'https://developers.google.com/maps/billing-and-pricing/pricing'

function save() {
  state.googleMapsKey = draftKey.value.trim()
  emit('close')
}
function clearKey() {
  state.googleMapsKey = ''
  draftKey.value = ''
}
</script>

<template>
  <div class="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4"
       @click.self="emit('close')">
    <div class="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
      <header class="flex items-center mb-3">
        <h2 class="text-lg font-semibold">Google Maps API key</h2>
        <div class="flex-1" />
        <button class="text-ink-700 hover:text-ink-900" @click="emit('close')">✕</button>
      </header>

      <section class="text-sm leading-relaxed space-y-3">
        <p class="text-ink-700">
          Crowd Count uses your own Google Cloud API key to unlock optional Google features:
        </p>
        <ul class="list-disc pl-5 text-xs text-ink-900 space-y-1">
          <li><strong>Google roadmap / satellite</strong> tiles in the 2D map (basemap dropdown).</li>
          <li><strong>Google Photorealistic 3D Tiles</strong> in the 3D site view (basemap dropdown).</li>
        </ul>
        <p class="text-xs text-ink-700">
          The default OpenStreetMap basemap and OSM 3D buildings stay free and key-less — you only need a key if you want the Google options.
        </p>

        <div>
          <label class="text-xs text-ink-700">Google Cloud API key</label>
          <input type="password" v-model="draftKey"
                 class="mt-1 w-full text-sm px-2 py-1.5 border border-ink-100 rounded font-mono"
                 placeholder="AIza…" />
          <p class="text-[11px] text-ink-700 mt-1">
            Stored in your browser's localStorage only — never in the project file, the share link, or sent anywhere except Google's tile servers. Restrict the key to your domain in the Google Cloud console for safety.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button class="text-xs px-3 py-1.5 rounded bg-ink-900 text-white hover:bg-ink-700"
                  @click="save">Save key</button>
          <button v-if="state.googleMapsKey"
                  class="text-xs px-3 py-1.5 rounded border border-ink-100 text-ink-700 hover:bg-ink-50"
                  @click="clearKey">Clear stored key</button>
          <button class="text-xs underline text-ink-700 hover:text-ink-900 ml-2"
                  @click="showSetupSteps = !showSetupSteps">
            {{ showSetupSteps ? 'Hide setup steps' : 'How do I get a key?' }}
          </button>
        </div>

        <section aria-labelledby="google-usage-heading"
                 class="border-y border-ink-100 py-3 space-y-2 text-xs">
          <h3 id="google-usage-heading" class="font-semibold text-ink-900">Google tile usage and cost</h3>
          <p class="text-ink-700">
            Crowd Count cannot read account usage from an API key. Check it in Google Cloud:
          </p>
          <ol class="list-decimal pl-5 space-y-1 text-ink-900">
            <li>Open <strong>Billing &gt; Reports</strong> and keep <strong>Current month</strong>.</li>
            <li>Set <strong>Group by</strong> to <strong>SKU</strong>.</li>
            <li>
              Find <strong>Map Tiles API: 2D Map Tiles</strong> and
              <strong>Map Tiles API: Photorealistic 3D Tiles</strong>. The table's
              <strong>Usage</strong> column shows requests; cost is shown separately.
            </li>
          </ol>
          <p class="text-[11px] text-ink-700">
            Metrics shows request traffic. Quotas shows limits. Billing data commonly appears within a day,
            but can take longer than 24 hours.
          </p>
          <div class="flex flex-wrap gap-x-4 gap-y-1">
            <a :href="googleBillingUrl" target="_blank" rel="noopener noreferrer"
               class="underline text-ink-700 hover:text-ink-900">Billing reports</a>
            <a :href="googleMapsMetricsUrl" target="_blank" rel="noopener noreferrer"
               class="underline text-ink-700 hover:text-ink-900">API traffic</a>
            <a :href="googleMapsQuotasUrl" target="_blank" rel="noopener noreferrer"
               class="underline text-ink-700 hover:text-ink-900">Quotas</a>
            <a :href="googleMapsPricingUrl" target="_blank" rel="noopener noreferrer"
               class="underline text-ink-700 hover:text-ink-900">Current pricing</a>
          </div>
        </section>

        <!-- Inline step-by-step walkthrough. -->
        <div v-if="showSetupSteps"
             class="mt-2 pt-3 border-t border-ink-100 text-xs text-ink-900 leading-snug space-y-2">
          <div class="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-amber-900 text-xs">
            ⚠ <strong>Heads-up:</strong> Google requires billing to be enabled for the Map Tiles API.
            Pricing and no-cost allowances can change, so check the current pricing and set quotas or budget alerts before use.
          </div>
          <ol class="list-decimal pl-5 space-y-1.5">
            <li>
              Open the
              <a class="underline" href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a>
              and sign in.
            </li>
            <li>
              Top bar → project dropdown → <strong>New Project</strong>. Name it anything (e.g. <code class="bg-ink-100 px-1 rounded">crowd-count-3d</code>).
            </li>
            <li>
              Side menu → <strong>Billing</strong> → <strong>Link a billing account</strong>.
            </li>
            <li>
              Enable the API:
              <a class="underline" href="https://console.cloud.google.com/apis/library/tile.googleapis.com" target="_blank" rel="noopener">
                Map Tiles API → Enable
              </a>.
            </li>
            <li>
              Side menu → <strong>APIs &amp; Services</strong> → <strong>Credentials</strong> → <strong>+ Create credentials</strong> → <strong>API key</strong>. Copy the <code class="bg-ink-100 px-1 rounded">AIza…</code> string.
            </li>
            <li>
              <strong>Restrict the key before using it.</strong> Click the new key:
              <ul class="list-disc pl-5 mt-1 space-y-0.5">
                <li><em>Application restrictions</em> → HTTP referrers → add <code class="bg-ink-100 px-1 rounded">https://profrino.github.io/*</code> (and <code class="bg-ink-100 px-1 rounded">http://localhost:*</code> for local testing).</li>
                <li><em>API restrictions</em> → Restrict key → check only <strong>Map Tiles API</strong>.</li>
              </ul>
            </li>
            <li>
              Paste the key in the field above and click <strong>Save key</strong>.
            </li>
          </ol>
        </div>
      </section>
    </div>
  </div>
</template>
