import { deflateSync, inflateSync } from 'fflate'
import { fromUint8Array, toUint8Array } from 'js-base64'

const VERSION = 1

// Compact wire format: { v, m, s, b, z: [[name, density, [[lng,lat],...]],...], v3: { ... } }
// m = map view [lng, lat, zoom]; s = governing standard key; b = basemap; mode kept simple for v1.

export function encodeState(state) {
  const payload = {
    v: VERSION,
    m: [round(state.view.lng, 6), round(state.view.lat, 6), round(state.view.zoom, 3)],
    s: state.standard,
    b: state.basemap,
    z: state.zones.map(z => [z.name, round(z.density, 3), z.vertices.map(([lng, lat]) => [round(lng, 6), round(lat, 6)])]),
  }
  const json = JSON.stringify(payload)
  const bytes = deflateSync(new TextEncoder().encode(json), { level: 9 })
  return fromUint8Array(bytes, true)  // URL-safe base64
}

export function decodeState(b64) {
  try {
    const bytes = toUint8Array(b64)
    const json = new TextDecoder().decode(inflateSync(bytes))
    const p = JSON.parse(json)
    if (p.v !== VERSION) return null
    return {
      view: { lng: p.m[0], lat: p.m[1], zoom: p.m[2] },
      standard: p.s,
      basemap: p.b,
      zones: p.z.map(([name, density, vertices], i) => ({
        id: `z${i}`,
        name,
        density,
        vertices,
        color: pickColor(i),
      })),
    }
  } catch {
    return null
  }
}

function round(n, places) {
  const f = Math.pow(10, places)
  return Math.round(n * f) / f
}

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777']
export function pickColor(i) { return COLORS[i % COLORS.length] }
