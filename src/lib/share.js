import { deflateSync, inflateSync } from 'fflate'
import { fromUint8Array, toUint8Array } from 'js-base64'
import { normalizePeopleColorMode } from './peopleAppearance.js'

// v1 wire: { v:1, m, s, b, z: [[name, density, [[lng,lat],...]],...] }
// v2 wire: { v:2, m, s, b, z: [...tagged tuples...], h?: [[innerRing,...] per zone] }
//   Polygon tuple stays 3-element (byte-identical to v1).
//   Circle  tuple: [name, density, vertices, 'c', center, radiusM, segments?]
//   Rect    tuple: [name, density, vertices, 'r', a, b]
//   The `h` array is OMITTED when no zone has obstructions, so polygon-only-no-hole
//   states encode to the same bytes as v1 — old user URLs don't grow.
// v3 adds optional top-level arrays:
//   c?: [zoneColor|null, ...] and f?: [facingPoint|null, ...]
// They are omitted unless needed, keeping default-colour/no-aim links compact.
//   p?: 'zone' | 'natural' keeps non-default people colouring compact.
// v4 adds optional density gradients:
//   g?: [null | [start|null, end|null, [[distanceM,density],...]], ...]
const VERSION = 4

export function encodeState(state) {
  const anyHoles = state.zones.some(z => z.obstructions?.length > 0)
  const anyCustomColors = state.zones.some((z, i) => z.color && z.color !== pickColor(i))
  const anyFacingPoints = state.zones.some(z => Array.isArray(z.facingPoint))
  const anyGradients = state.zones.some(hasGradient)
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
  if (anyCustomColors) {
    payload.c = state.zones.map((z, i) => z.color && z.color !== pickColor(i) ? z.color : null)
  }
  if (anyFacingPoints) {
    payload.f = state.zones.map(z => Array.isArray(z.facingPoint) ? roundPt(z.facingPoint) : null)
  }
  if (anyGradients) {
    payload.g = state.zones.map(gradientToWire)
  }
  const peopleColorMode = normalizePeopleColorMode(state.peopleColorMode, state.peopleTint)
  if (peopleColorMode !== 'neutral') payload.p = peopleColorMode
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
    if (p.v !== 1 && p.v !== 2 && p.v !== 3 && p.v !== 4) return null
    const holes = p.h ?? []
    const colors = p.c ?? []
    const facingPoints = p.f ?? []
    const gradients = p.g ?? []
    return {
      view: { lng: p.m[0], lat: p.m[1], zoom: p.m[2] },
      standard: p.s,
      basemap: p.b,
      peopleColorMode: normalizePeopleColorMode(p.p),
      zones: p.z.map((tuple, i) => tupleToZone(
        tuple,
        i,
        holes[i] ?? [],
        colors[i] ?? null,
        facingPoints[i] ?? null,
        gradients[i] ?? null,
      )),
    }
  } catch {
    return null
  }
}

function tupleToZone(tuple, i, holesForThisZone, colorForThisZone, facingPointForThisZone, gradientForThisZone) {
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
    densityMode: gradientForThisZone ? 'gradient' : 'uniform',
    densityGradient: gradientFromWire(gradientForThisZone, density),
    color: colorForThisZone ?? pickColor(i),
    shape: 'polygon',
    params: null,
    obstructions,
    facingPoint: Array.isArray(facingPointForThisZone) ? facingPointForThisZone : null,
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

function defaultGradient() {
  return {
    start: null,
    end: null,
    stops: [
      { distanceM: 0, density: 2 },
      { distanceM: 100, density: 1 },
    ],
  }
}

function twoGradientStops(stops, baseDensity = 2) {
  const normalized = Array.isArray(stops)
    ? stops
      .map(s => ({
        distanceM: Math.max(0, Number(s.distanceM) || 0),
        density: Math.max(0, Number(s.density) || 0),
      }))
      .sort((a, b) => a.distanceM - b.distanceM)
    : []
  if (normalized.length >= 2) return [normalized[0], normalized[normalized.length - 1]]
  if (normalized.length === 1) {
    return [
      normalized[0],
      { distanceM: Math.max(100, normalized[0].distanceM + 100), density: Math.max(0, (Number(baseDensity) || 0) + 1) },
    ]
  }
  return defaultGradient(baseDensity).stops
}

function hasGradient(z) {
  return z.densityMode === 'gradient'
}

function gradientToWire(z) {
  if (!hasGradient(z)) return null
  const g = z.densityGradient ?? defaultGradient(z.density)
  const stops = twoGradientStops(g.stops, z.density)
  return [
    Array.isArray(g.start) ? roundPt(g.start) : null,
    Array.isArray(g.end) ? roundPt(g.end) : null,
    stops.map(s => [round(Number(s.distanceM) || 0, 2), round(Number(s.density) || 0, 3)]),
  ]
}

function gradientFromWire(wire, baseDensity) {
  if (!wire) return defaultGradient(baseDensity)
  const [start, end, stops] = wire
  const normalizedStops = Array.isArray(stops) && stops.length
    ? twoGradientStops(stops.map(([distanceM, density]) => ({
      distanceM: Math.max(0, Number(distanceM) || 0),
      density: Math.max(0, Number(density) || 0),
    })), baseDensity)
    : defaultGradient(baseDensity).stops
  return {
    start: Array.isArray(start) ? start : null,
    end: Array.isArray(end) ? end : null,
    stops: normalizedStops,
  }
}

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777']
export function pickColor(i) { return COLORS[i % COLORS.length] }

// --- Project file format (Save / Open) ------------------------------------
// Unlike the permalink format, project files are human-readable JSON: they
// get emailed, version-controlled, diffed. Schema:
// {
//   format: 'crowd-count.project',
//   formatVersion: 2,
//   savedAt: '2026-06-27T...',  // ISO timestamp (informational only)
//   view, standard, basemap,
//   zones: [{ name, density, densityMode, densityGradient, shape, params, vertices, obstructions: [...] }],
// }
const PROJECT_FORMAT = 'crowd-count.project'
const PROJECT_VERSION = 2

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
    peopleColorMode: normalizePeopleColorMode(state.peopleColorMode, state.peopleTint),
    zones: state.zones.map((z, i) => ({
      name: z.name,
      density: round(z.density, 3),
      densityMode: z.densityMode === 'gradient' ? 'gradient' : 'uniform',
      densityGradient: z.densityMode === 'gradient' ? gradientFromWire(gradientToWire(z), z.density) : null,
      color: z.color ?? pickColor(i),
      shape: z.shape ?? 'polygon',
      params: z.params ?? null,
      vertices: z.vertices.map(roundPt),
      facingPoint: Array.isArray(z.facingPoint) ? roundPt(z.facingPoint) : null,
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
      peopleColorMode: normalizePeopleColorMode(p.peopleColorMode),
      zones: p.zones.map((z, i) => ({
        id: `z${i}`,
        name: z.name ?? `Zone ${i + 1}`,
        density: +z.density,
        densityMode: z.densityMode === 'gradient' ? 'gradient' : 'uniform',
        densityGradient: gradientFromProject(z.densityGradient, +z.density),
        color: z.color ?? pickColor(i),
        shape: z.shape ?? 'polygon',
        params: z.params ?? null,
        vertices: Array.isArray(z.vertices) ? z.vertices : [],
        facingPoint: Array.isArray(z.facingPoint) ? z.facingPoint : null,
        obstructions: Array.isArray(z.obstructions)
          ? z.obstructions.map((o, j) => ({ id: `o${i}_${j}`, vertices: Array.isArray(o.vertices) ? o.vertices : [] }))
          : [],
      })),
    },
  }
}

function gradientFromProject(g, baseDensity) {
  if (!g) return defaultGradient(baseDensity)
  const stops = Array.isArray(g.stops) && g.stops.length
    ? twoGradientStops(g.stops.map(s => ({
      distanceM: Math.max(0, Number(s.distanceM) || 0),
      density: Math.max(0, Number(s.density) || 0),
    })), baseDensity)
    : defaultGradient(baseDensity).stops
  return {
    start: Array.isArray(g.start) ? g.start : null,
    end: Array.isArray(g.end) ? g.end : null,
    stops,
  }
}
