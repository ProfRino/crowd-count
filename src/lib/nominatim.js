// Tiny Nominatim wrapper. OSM ToS asks for a meaningful User-Agent / referer and rate-limit ≤1 req/s.
// Browser fetch cannot set User-Agent; the Referer header (the site origin) is what OSM sees.

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'

let lastCallAt = 0
const MIN_GAP_MS = 1100

export async function searchPlace(query, { limit = 6, signal } = {}) {
  const q = query.trim()
  if (!q) return []
  const wait = Math.max(0, MIN_GAP_MS - (performance.now() - lastCallAt))
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastCallAt = performance.now()
  const url = `${ENDPOINT}?format=jsonv2&limit=${limit}&q=${encodeURIComponent(q)}`
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Nominatim ${res.status}`)
  const json = await res.json()
  return json.map(r => ({
    name: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    type: r.type,
    importance: r.importance ?? 0,
    bbox: r.boundingbox ? r.boundingbox.map(parseFloat) : null,
  }))
}
