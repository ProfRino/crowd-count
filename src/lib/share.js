import { deflateSync, inflateSync } from 'fflate'
import { fromUint8Array, toUint8Array } from 'js-base64'

// v1 wire: { v:1, m, s, b, z: [[name, density, [[lng,lat],...]],...] }
// v2 wire: { v:2, m, s, b, z: [...tagged tuples...], h?: [[innerRing,...] per zone] }
//   Polygon tuple stays 3-element (byte-identical to v1).
//   Circle  tuple: [name, density, vertices, 'c', center, radiusM, segments?]
//   Rect    tuple: [name, density, vertices, 'r', a, b]
//   The `h` array is OMITTED when no zone has obstructions, so polygon-only-no-hole
//   states encode to the same bytes as v1 — old user URLs don't grow.
const VERSION = 2

export function encodeState(state) {
  const anyHoles = state.zones.some(z => z.obstructions?.length > 0)
  const payload = {
    v: VERSION,
    m: [round(state.view.lng, 6), round(state.view.lat, 6), round(state.view.zoom, 3)],
    s: state.standard,
    b: state.basemap,
    z: state.zones.map(zoneToTuple),
  }
  if (anyHoles) {
    payload.h = state.zones.map(z =>
      (z.obstructions ?? []).map(o => o.vertices.map(roundPt))
    )
  }
  const json = JSON.stringify(payload)
  const bytes = deflateSync(new TextEncoder().encode(json), { level: 9 })
  return fromUint8Array(bytes, true)  // URL-safe base64
}

function zoneToTuple(z) {
  const verts = z.vertices.map(roundPt)
  const base = [z.name, round(z.density, 3), verts]
  if (!z.shape || z.shape === 'polygon') return base
  if (z.shape === 'circle' && z.params) {
    const c = z.params
    const tup = [...base, 'c', c.center.map(n => round(n, 6)), round(c.radiusM, 3)]
    if (c.segments && c.segments !== 64) tup.push(c.segments)
    return tup
  }
  if (z.shape === 'rect' && z.params) {
    return [...base, 'r', z.params.a.map(n => round(n, 6)), z.params.b.map(n => round(n, 6))]
  }
  return base
}

export function decodeState(b64) {
  try {
    const bytes = toUint8Array(b64)
    const json = new TextDecoder().decode(inflateSync(bytes))
    const p = JSON.parse(json)
    if (p.v !== 1 && p.v !== 2) return null
    const holes = p.h ?? []
    return {
      view: { lng: p.m[0], lat: p.m[1], zoom: p.m[2] },
      standard: p.s,
      basemap: p.b,
      zones: p.z.map((tuple, i) => tupleToZone(tuple, i, holes[i] ?? [])),
    }
  } catch {
    return null
  }
}

function tupleToZone(tuple, i, holesForThisZone) {
  const [name, density, vertices, tag, ...rest] = tuple
  const obstructions = (holesForThisZone ?? []).map((ring, j) => ({
    id: `o${i}_${j}`,
    vertices: ring,
  }))
  const base = {
    id: `z${i}`,
    name,
    density,
    vertices,
    color: pickColor(i),
    shape: 'polygon',
    params: null,
    obstructions,
  }
  if (!tag) return base
  if (tag === 'c') {
    const [center, radiusM, segments] = rest
    return { ...base, shape: 'circle', params: { kind: 'circle', center, radiusM, segments: segments ?? 64 } }
  }
  if (tag === 'r') {
    const [a, b] = rest
    return { ...base, shape: 'rect', params: { kind: 'rect', a, b } }
  }
  // Unknown tag — fall back to polygon so future formats don't crash older readers.
  return base
}

function round(n, places) {
  const f = Math.pow(10, places)
  return Math.round(n * f) / f
}
function roundPt([x, y]) { return [round(x, 6), round(y, 6)] }

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777']
export function pickColor(i) { return COLORS[i % COLORS.length] }

// --- Project file format (Save / Open) ------------------------------------
// Unlike the permalink format, project files are human-readable JSON: they
// get emailed, version-controlled, diffed. Schema:
// {
//   format: 'crowd-count.project',
//   formatVersion: 1,
//   savedAt: '2026-06-27T...',  // ISO timestamp (informational only)
//   view, standard, basemap,
//   zones: [{ name, density, shape, params, vertices, obstructions: [...] }],
// }
const PROJECT_FORMAT = 'crowd-count.project'
const PROJECT_VERSION = 1

export function serializeProject(state, now = new Date().toISOString()) {
  const payload = {
    format: PROJECT_FORMAT,
    formatVersion: PROJECT_VERSION,
    savedAt: now,
    view: {
      lng: round(state.view.lng, 6),
      lat: round(state.view.lat, 6),
      zoom: round(state.view.zoom, 3),
    },
    standard: state.standard,
    basemap: state.basemap,
    zones: state.zones.map((z, i) => ({
      name: z.name,
      density: round(z.density, 3),
      color: z.color ?? pickColor(i),
      shape: z.shape ?? 'polygon',
      params: z.params ?? null,
      vertices: z.vertices.map(roundPt),
      obstructions: (z.obstructions ?? []).map((o, j) => ({
        id: `o${i}_${j}`,
        vertices: o.vertices.map(roundPt),
      })),
    })),
  }
  return JSON.stringify(payload, null, 2)
}

export function loadProject(jsonString) {
  let p
  try { p = JSON.parse(jsonString) } catch { return { error: 'Not valid JSON.' } }
  if (!p || p.format !== PROJECT_FORMAT) {
    return { error: 'Not a Crowd Count project file.' }
  }
  if (typeof p.formatVersion !== 'number' || p.formatVersion > PROJECT_VERSION) {
    return { error: `Project file uses format version ${p.formatVersion} — this build understands up to ${PROJECT_VERSION}.` }
  }
  if (!p.view || !Array.isArray(p.zones)) {
    return { error: 'Project file is missing required fields.' }
  }
  return {
    project: {
      view: { lng: +p.view.lng, lat: +p.view.lat, zoom: +p.view.zoom },
      standard: p.standard ?? 'purple',
      basemap: p.basemap ?? 'osm',
      zones: p.zones.map((z, i) => ({
        id: `z${i}`,
        name: z.name ?? `Zone ${i + 1}`,
        density: +z.density,
        color: z.color ?? pickColor(i),
        shape: z.shape ?? 'polygon',
        params: z.params ?? null,
        vertices: Array.isArray(z.vertices) ? z.vertices : [],
        obstructions: Array.isArray(z.obstructions)
          ? z.obstructions.map((o, j) => ({ id: `o${i}_${j}`, vertices: Array.isArray(o.vertices) ? o.vertices : [] }))
          : [],
      })),
    },
  }
}
