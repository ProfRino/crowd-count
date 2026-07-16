<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useApp } from '../lib/state.js'
import { fmtAreaCompact, fmtDensity } from '../lib/units.js'
import { pointInPolygon } from '../lib/sample.js'
import { HUMAN_HEIGHT_M, HUMAN_TOP_DEPTH_M, HUMAN_TOP_WIDTH_M } from '../lib/humanScale.js'
import { normalizePeopleColorMode, personAppearance, personSeed, rand01 } from '../lib/peopleAppearance.js'
import modelUrl from '../assets/basic_human_model.min.glb?url'

const { state, zoneAreaM2, computeTotals, sampleZonePoints } = useApp()

const canvasRef = ref(null)
const loadingState = ref('loading')   // 'loading' | 'ready' | 'error'
const errorMsg = ref('')
const personCount = ref(0)
const cinematicMode = ref('off')
const controlsPanelOpen = ref(true)
const googleTilesRenderable = ref(false)
const googleTileMeshCount = ref(0)

const totals = computed(() => computeTotals())
const areaStr = computed(() => fmtAreaCompact(totals.value.area, state.units))
const headcountStr = computed(() => totals.value.count.toLocaleString())

const CINEMATIC_MOVES = [
  { value: 'orbit', label: 'Orbit', title: 'Slow circular orbit around the crowd' },
  { value: 'flyover', label: 'Flyover', title: 'High-to-low crane move over the site' },
  { value: 'sweep', label: 'Sweep', title: 'Side-to-side tracking move across the crowd edge' },
  { value: 'push', label: 'Push', title: 'Looping zoom in and out on the crowd' },
  { value: 'drone', label: 'Drone', title: 'Dramatic drone-style dive over the crowd' },
  { value: 'skim', label: 'Skim', title: 'Elevated sweeping camera pass across the crowd' },
]

let THREE = null
let scene = null
let camera = null
let renderer = null
let baseModel = null         // { geometry, material } — detailed mannequin GLB
let lowPolyModel = null      // { geometry, material } — capsule LOD for big crowds
let naturalModel = null      // { upper, lower, head, hair } instanced procedural person parts
let instancedMesh = null     // primary InstancedMesh used for terrain anchoring
let crowdMeshes = []         // all InstancedMeshes currently rendering people
let crowdWaveData = null     // compact typed arrays for wave transforms
let naturalIdleInstances = [] // per-person transforms for Natural mix idle animation
let naturalIdleDummy = null
let naturalIdleLastAtMs = 0
let crowdWaveDummy = null
let crowdWaveStartMs = -Infinity
let crowdWaveLastAtMs = 0
let crowdWaveNeedsReset = false
// Above this many people we swap the detailed mannequin for a low-poly capsule.
// A capsule is ~40 tris and reads as a standing person from crowd distance,
// so even 50,000+ render smoothly; the detailed model is reserved for small
// gatherings where you can actually see it.
const LOWPOLY_THRESHOLD = 4000
const NATURAL_IDLE_TILT_MAX_RAD = 3.5 * Math.PI / 180
const NATURAL_IDLE_SWAY_MAX_RAD = 1.6 * Math.PI / 180
const NATURAL_IDLE_MOVE_MAX_M = 0.22
const NATURAL_IDLE_FPS = 24
const CROWD_WAVE_DURATION_MS = 4200
const CROWD_WAVE_FPS = 20
const CROWD_WAVE_WIDTH = 0.12
const CROWD_WAVE_LIFT_M = 0.45
const CROWD_WAVE_TILT_RAD = 11 * Math.PI / 180
let groundGroup = null       // current zones' ground plane meshes
let buildingsGroup = null    // OSM buildings extruded
let googleTilesRenderer = null  // 3d-tiles-renderer instance when source === 'google'
// Google's terrain isn't at y=0 — that's the WGS84 ellipsoid surface, but
// real ground is some metres above it (Washington DC ≈ 17 m). We raycast
// downward against the loaded tile mesh and offset the instanced people +
// zone polygon by the hit Y so they sit on terrain. As more tiles stream
// in we re-anchor (using the lowest hit) since the initial coarse tiles
// often have skirt geometry that's tens of metres above true ground.
let googleGroundOffsetY = 0
let googleGroundAnchored = false
let googleAnchoredAtTileCount = 0
let googleAnchorRefineUntilMs = 0
let googleTileStatsSignature = ''
let googleTileStatsLastChangedAtMs = 0
let googleAnchorStatsSignature = ''
let googleDepthPreparedMeshes = new WeakSet()
let googleFirstRenderableAtMs = 0
let googleTilesStartedAtMs = 0
let googleProbeDebugGroup = null
let googleManualHeightLocked = false
let target = null
let yaw = -0.6, pitch = 0.55, distance = 200
let cinematicStartMs = 0
let cinematicBase = null
let cinematicSurfaceRay = null
let isDragging = false
let dragMode = null          // 'orbit' | 'pan' | 'zoom'
let lastPointer = { x: 0, y: 0 }
let panGrabPoint = null
let spacePanActive = false
let rafId = null
let ro = null
let cleanupListeners = null
let originLngLat = null      // [lng, lat] origin for local-meter conversion
let buildingsAbort = null    // AbortController for an in-flight Overpass fetch
let tilesAbort = null        // AbortController for tile-image loads
let tileFloor = null         // the Mesh holding the stitched OSM/satellite ground texture

const buildingsState = ref('idle')   // 'idle' | 'loading' | 'ready' | 'error'
const buildingsCount = ref(0)
// Source is driven by the basemap dropdown; no separate settings popover.
const buildingsError = ref('')

// --- Map tile floor (OSM or Esri satellite XYZ tiles) --------------------
// Web Mercator helpers — convert lng/lat <-> XYZ tile coordinates.
function lngToTileX(lng, z) { return ((lng + 180) / 360) * 2 ** z }
function latToTileY(lat, z) {
  const rad = lat * Math.PI / 180
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z
}
function tileXToLng(x, z) { return x / (2 ** z) * 360 - 180 }
function tileYToLat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / (2 ** z)
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

function loadTileImage(url, signal) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('tile load failed'))
    if (signal) signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    img.src = url
  })
}

// Pick a zoom level that covers the bbox in <= ~64 tiles. Higher zoom =
// more detail. Tiles are 256×256 px.
function pickTileZoom(bbox, maxTiles = 64) {
  for (let z = 19; z >= 12; z--) {
    const xMin = Math.floor(lngToTileX(bbox.west, z))
    const xMax = Math.floor(lngToTileX(bbox.east, z))
    const yMin = Math.floor(latToTileY(bbox.north, z))
    const yMax = Math.floor(latToTileY(bbox.south, z))
    const n = (xMax - xMin + 1) * (yMax - yMin + 1)
    if (n <= maxTiles) return { z, xMin, xMax, yMin, yMax }
  }
  return null
}

async function buildTileFloor(bbox, basemap, tileStyle, signal) {
  const t = pickTileZoom(bbox)
  if (!t) return null
  const TILE = 256
  const cols = t.xMax - t.xMin + 1
  const rows = t.yMax - t.yMin + 1

  const canvas = document.createElement('canvas')
  canvas.width = cols * TILE
  canvas.height = rows * TILE
  const ctx = canvas.getContext('2d')
  // Match the 2D map: when state.tileStyle === 'grayscale' we apply the
  // same desaturation filter while compositing each tile into the canvas.
  // Three.js then samples the already-grayscale pixels straight into the
  // texture — no shader work needed.
  if (tileStyle === 'grayscale') ctx.filter = 'grayscale(100%) contrast(1.05)'

  const promises = []
  for (let ty = t.yMin; ty <= t.yMax; ty++) {
    for (let tx = t.xMin; tx <= t.xMax; tx++) {
      const url = basemap === 'satellite'
        ? `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${t.z}/${ty}/${tx}`
        : `https://tile.openstreetmap.org/${t.z}/${tx}/${ty}.png`
      const px = (tx - t.xMin) * TILE
      const py = (ty - t.yMin) * TILE
      promises.push(loadTileImage(url, signal).then(img => ({ img, px, py })).catch(() => null))
    }
  }
  const results = await Promise.all(promises)
  let loaded = 0
  for (const r of results) {
    if (!r) continue
    ctx.drawImage(r.img, r.px, r.py)
    loaded++
  }
  if (loaded === 0) return null

  // Real-world geo extent of the stitched canvas
  const west  = tileXToLng(t.xMin,         t.z)
  const east  = tileXToLng(t.xMax + 1,     t.z)
  const north = tileYToLat(t.yMin,         t.z)
  const south = tileYToLat(t.yMax + 1,     t.z)

  // Convert corners to local meters around the same origin as everything else
  const [westX, _swZ_unused1] = lngLatToLocalMeters([west, (north + south) / 2])
  const [eastX, _swZ_unused2] = lngLatToLocalMeters([east, (north + south) / 2])
  const [_swX_unused1, northZ] = lngLatToLocalMeters([(west + east) / 2, north])
  const [_swX_unused2, southZ] = lngLatToLocalMeters([(west + east) / 2, south])

  return {
    canvas,
    centerX: (westX + eastX) / 2,
    centerZ: (northZ + southZ) / 2,
    width: eastX - westX,
    height: southZ - northZ,
    loadedTiles: loaded,
    totalTiles: cols * rows,
    zoom: t.z,
  }
}

// --- OSM building fetch (Overpass API) -----------------------------------
async function fetchBuildings(bbox, signal) {
  const query = `[out:json][timeout:25];way[building](${bbox.south},${bbox.west},${bbox.north},${bbox.east});out geom;`
  const resp = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    signal,
  })
  if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`)
  const json = await resp.json()
  const out = []
  for (const el of json.elements ?? []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 3) continue
    const ring = el.geometry.map(p => [p.lon, p.lat])
    const tags = el.tags ?? {}
    const heightTag = parseFloat(tags.height)
    const levels = parseFloat(tags['building:levels'])
    const height = (isFinite(heightTag) && heightTag > 0)
      ? heightTag
      : (isFinite(levels) && levels > 0 ? levels * 3 : 6)
    out.push({ ring, height })
  }
  return out
}

function lngLatToLocalMeters([lng, lat]) {
  const R = 6378137
  const [oLng, oLat] = originLngLat
  const rad = Math.PI / 180
  const x = (lng - oLng) * rad * R * Math.cos(oLat * rad)
  const z = -(lat - oLat) * rad * R   // flip lat → -z so north is into the scene
  return [x, z]
}

// Tessellate the zone polygon into an N×N grid of vertices (clipped to the
// polygon and any obstruction holes) and return a BufferGeometry whose
// triangles are ready to be draped: anchorToGoogleGround will raycast each
// vertex down onto Google's terrain mesh and set its Y, so the red overlay
// follows actual terrain bumps (square pavement, colonnade base, steps).
function buildTessellatedGroundGeometry(outerRing, holes, N = 50) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const [x, z] of outerRing) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  const w = maxX - minX, h = maxZ - minZ
  if (w <= 0 || h <= 0) return new THREE.BufferGeometry()

  const positions = []
  const indices = []
  // grid[i][j] = vertex index or -1 (cell falls outside the polygon)
  const grid = []

  for (let i = 0; i <= N; i++) {
    const row = []
    const zCoord = minZ + (h * i) / N
    for (let j = 0; j <= N; j++) {
      const xCoord = minX + (w * j) / N
      let inside = pointInPolygon([xCoord, zCoord], outerRing)
      if (inside) {
        for (const hole of holes) {
          if (hole.length >= 3 && pointInPolygon([xCoord, zCoord], hole)) { inside = false; break }
        }
      }
      if (inside) {
        row.push(positions.length / 3)
        positions.push(xCoord, 0, zCoord)   // Y placeholder — set later by drape
      } else {
        row.push(-1)
      }
    }
    grid.push(row)
  }
  // Connect each 2×2 cell into two triangles, dropping any that hit an
  // outside vertex. Wind CCW so the surface faces +Y.
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const a = grid[i    ][j    ]
      const b = grid[i    ][j + 1]
      const c = grid[i + 1][j    ]
      const d = grid[i + 1][j + 1]
      if (a >= 0 && b >= 0 && d >= 0) indices.push(a, d, b)
      if (a >= 0 && d >= 0 && c >= 0) indices.push(a, c, d)
    }
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setIndex(indices)
  geom.computeVertexNormals()
  geom.userData.isDrapable = true   // marker for the drape pass
  geom.userData.drapeLift = 0.035
  return geom
}

function buildDrapableOutlineGeometry(ring, spacingM = 1.5) {
  const points = []
  if (!ring?.length) return new THREE.BufferGeometry().setFromPoints(points)
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const dx = b[0] - a[0], dz = b[1] - a[1]
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / spacingM))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      points.push(new THREE.Vector3(a[0] + dx * t, 0, a[1] + dz * t))
    }
  }
  points.push(points[0].clone())
  const geom = new THREE.BufferGeometry().setFromPoints(points)
  geom.userData.isDrapable = true
  geom.userData.drapeLift = 0.09
  return geom
}

const GOOGLE_TERRAIN_CANOPY_CLAMP_M = 3
const GOOGLE_TERRAIN_SINK_CLAMP_M = 1.0
const GOOGLE_PERSON_TERRAIN_LIFT_M = 0.16
// Google photorealistic tiles do not provide a single "final LOD is loaded"
// signal. We treat the stream as usable once its visible/loaded/cache stats
// have stopped changing for a short window, then reveal people + zone overlay.
const GOOGLE_TILE_SETTLE_BEFORE_FIRST_ANCHOR_MS = 3200
const GOOGLE_TILE_SETTLE_REANCHOR_MS = 2500
const GOOGLE_TILE_MAX_WAIT_BEFORE_FIRST_ANCHOR_MS = 7000
const GOOGLE_TILE_EMPTY_NOTICE_MS = 12000
const GOOGLE_ANCHOR_MAX_PROBES = 50
const GOOGLE_HEIGHT_GRID_CELL_M = 2.5
const GOOGLE_HEIGHT_GRID_AUTO_CELL_M = 80
const GOOGLE_HEIGHT_GRID_MAX_PROBES = 2500
const GOOGLE_HEIGHT_GRID_AUTO_MAX_PROBES = 4
const GOOGLE_HEIGHT_GRID_NEIGHBOR_RADIUS = 5
const GOOGLE_TERRAIN_BEAM_RADIUS_M = 0.75
const GOOGLE_DOUBLE_HIT_SEPARATION_M = 0.45

function medianValue(values) {
  if (!values.length) return null
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function quantileValue(values, q) {
  if (!values.length) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const i = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q)))
  return sorted[i]
}

function hitYValues(intersections) {
  return (intersections ?? [])
    .map(h => h?.point?.y)
    .filter(y => Number.isFinite(y))
    .sort((a, b) => a - b)
}

function googleHitClusters(ys) {
  if (!ys.length) return []
  const clusters = [[ys[0]]]
  for (let i = 1; i < ys.length; i++) {
    const current = clusters[clusters.length - 1]
    const previous = current[current.length - 1]
    if (ys[i] - previous > GOOGLE_DOUBLE_HIT_SEPARATION_M) clusters.push([ys[i]])
    else current.push(ys[i])
  }
  return clusters
}

function seedTerrainY(ys) {
  if (!ys.length) return null
  const clusters = googleHitClusters(ys)
  if (clusters.length > 1) {
    // Ambiguous vertical column, e.g. tree canopy above walkable ground.
    // For this test, choose the lower separated surface as pedestrian ground.
    return medianValue(clusters[0])
  }
  // Single continuous surface: use the top of that surface so people do not
  // sink into the rendered tile.
  const surface = clusters[0]
  return surface[surface.length - 1]
}

function terrainYNearFallback(ys, fallbackY) {
  if (!ys.length) return null
  if (!Number.isFinite(fallbackY)) return seedTerrainY(ys)
  const minY = fallbackY - GOOGLE_TERRAIN_SINK_CLAMP_M
  const maxY = fallbackY + GOOGLE_TERRAIN_CANOPY_CLAMP_M
  // Prefer the highest plausible surface near the local consensus. This keeps
  // mannequins on top of the Google mesh instead of snapping to a lower
  // underside/backface hit. Canopy/roof hits above the clamp still fall back to
  // the consensus ground.
  let bestY = null
  for (const y of ys) {
    if (y >= minY && y <= maxY) {
      bestY = y
    }
  }
  return bestY ?? fallbackY
}

function googleHeightCellKey(ix, iz) {
  return `${ix},${iz}`
}

function makeGoogleHeightGridCells(positions, cellSize) {
  const cellMap = new Map()
  for (const p of positions) {
    const ix = Math.floor(p.x / cellSize)
    const iz = Math.floor(p.z / cellSize)
    const key = googleHeightCellKey(ix, iz)
    let cell = cellMap.get(key)
    if (!cell) {
      cell = { key, ix, iz, x: 0, z: 0, count: 0 }
      cellMap.set(key, cell)
    }
    cell.x += p.x
    cell.z += p.z
    cell.count++
  }
  return [...cellMap.values()].map(cell => ({
    ...cell,
    x: cell.x / cell.count,
    z: cell.z / cell.count,
  }))
}

function buildGoogleHeightGrid(positions, tilesGroup, ray, { cellSize, maxProbes }) {
  if (!positions.length) return null
  let size = cellSize
  let cells = makeGoogleHeightGridCells(positions, size)
  for (let tries = 0; cells.length > maxProbes && tries < 4; tries++) {
    size *= Math.sqrt(cells.length / maxProbes) * 1.08
    cells = makeGoogleHeightGridCells(positions, size)
  }

  const cellsByKey = new Map()
  const probes = []
  const hitYs = []
  for (const cell of cells) {
    const ys = googleTerrainHitYValuesAt(cell.x, cell.z, tilesGroup, ray, { bidirectional: false })
    const y = seedTerrainY(ys)
    const probe = { ...cell, ys, chosenY: y }
    probes.push(probe)
    if (Number.isFinite(y)) {
      const hit = { ...probe, y }
      cellsByKey.set(cell.key, hit)
      hitYs.push(y)
    }
  }
  if (!hitYs.length) return null

  return {
    cellSize: size,
    cellsByKey,
    probes,
    fallbackY: medianValue(hitYs),
    hitCount: hitYs.length,
    sampleCount: probes.length,
  }
}

function heightFromGoogleGrid(grid, x, z) {
  if (!grid) return null
  const ix = Math.floor(x / grid.cellSize)
  const iz = Math.floor(z / grid.cellSize)
  const local = []
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cell = grid.cellsByKey.get(googleHeightCellKey(ix + dx, iz + dz))
      if (cell && Number.isFinite(cell.y)) local.push(cell.y)
    }
  }
  if (local.length) return medianValue(local)

  let bestY = null
  let bestD2 = Infinity
  for (let radius = 2; radius <= GOOGLE_HEIGHT_GRID_NEIGHBOR_RADIUS; radius++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue
        const cell = grid.cellsByKey.get(googleHeightCellKey(ix + dx, iz + dz))
        if (!cell || !Number.isFinite(cell.y)) continue
        const d2 = (cell.x - x) ** 2 + (cell.z - z) ** 2
        if (d2 < bestD2) {
          bestD2 = d2
          bestY = cell.y
        }
      }
    }
    if (bestY !== null) return bestY
  }
  return grid.fallbackY
}

function googleDebugProbesFromGrid(grid, limit = GOOGLE_ANCHOR_MAX_PROBES) {
  if (!grid?.probes?.length) return []
  const stride = Math.max(1, Math.ceil(grid.probes.length / limit))
  const out = []
  for (let i = 0; i < grid.probes.length && out.length < limit; i += stride) out.push(grid.probes[i])
  return out
}

function googleTerrainHitYValuesAt(x, z, tilesGroup, ray, { bidirectional = true } = {}) {
  // Treat this as a narrow vertical beam rather than a single fragile ray.
  // Google photogrammetry has holes, one-sided triangles, and LOD seams; a
  // few sub-rays give us the hit column at this plan position instead of
  // whichever single face happens to respond. Debug/legacy callers can also
  // ask for upward rays to expose underside/backface hits.
  const r = GOOGLE_TERRAIN_BEAM_RADIUS_M
  const samples = [
    [x, z],
    [x - r, z],
    [x + r, z],
    [x, z - r],
    [x, z + r],
  ]
  const ys = []
  for (const [sx, sz] of samples) {
    ray.set(new THREE.Vector3(sx, 5000, sz), new THREE.Vector3(0, -1, 0))
    ys.push(...hitYValues(ray.intersectObject(tilesGroup, true)))
    if (bidirectional) {
      ray.set(new THREE.Vector3(sx, -5000, sz), new THREE.Vector3(0, 1, 0))
      ys.push(...hitYValues(ray.intersectObject(tilesGroup, true)))
    }
  }
  return [...new Set(ys.map(y => Math.round(y * 1000) / 1000))]
    .sort((a, b) => a - b)
}

// For every vertex in a drapable geometry, cast a ray straight down at its
// (x, z) and snap Y to the terrain hit. Used after Google tiles
// have loaded so the red overlay follows the photogrammetric mesh.
function drapeGeometryOntoTerrain(geom, tilesGroup, fallbackY = 0) {
  if (!geom?.userData?.isDrapable) return
  const pos = geom.attributes.position
  if (!pos) return
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 10000)
  let hits = 0
  const lift = geom.userData.drapeLift ?? 0.05
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i)
    const groundY = terrainYNearFallback(googleTerrainHitYValuesAt(x, z, tilesGroup, ray), fallbackY)
    if (groundY === null) {
      pos.setY(i, fallbackY + lift)
    } else {
      pos.setY(i, groundY + lift)
      hits++
    }
  }
  pos.needsUpdate = true
  if (geom.index || geom.attributes.normal) geom.computeVertexNormals()
  geom.computeBoundingSphere()
  geom.computeBoundingBox()
  return hits
}

function drapeGroundOverlays(fallbackY) {
  if (!groundGroup || !googleTilesRenderer) return
  groundGroup.position.y = 0
  groundGroup.traverse((child) => {
    if (child.geometry?.userData?.isDrapable) {
      drapeGeometryOntoTerrain(child.geometry, googleTilesRenderer.group, fallbackY)
    }
  })
}

function setGroundOverlaysToPlane(planeY) {
  if (!groundGroup) return
  groundGroup.position.y = 0
  groundGroup.traverse((child) => {
    const geom = child.geometry
    if (!geom?.userData?.isDrapable) return
    const pos = geom.attributes.position
    if (!pos) return
    const lift = geom.userData.drapeLift ?? 0.05
    for (let i = 0; i < pos.count; i++) pos.setY(i, planeY + lift)
    pos.needsUpdate = true
    if (geom.index || geom.attributes.normal) geom.computeVertexNormals()
    geom.computeBoundingSphere()
    geom.computeBoundingBox()
  })
}

function setGroundOverlaysToHeightGrid(grid) {
  if (!groundGroup || !grid) return
  groundGroup.position.y = 0
  groundGroup.traverse((child) => {
    const geom = child.geometry
    if (!geom?.userData?.isDrapable) return
    const pos = geom.attributes.position
    if (!pos) return
    const lift = geom.userData.drapeLift ?? 0.05
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      pos.setY(i, heightFromGoogleGrid(grid, x, z) + lift)
    }
    pos.needsUpdate = true
    if (geom.index || geom.attributes.normal) geom.computeVertexNormals()
    geom.computeBoundingSphere()
    geom.computeBoundingBox()
  })
}

function clearGoogleProbeDebug() {
  if (!googleProbeDebugGroup) return
  scene?.remove(googleProbeDebugGroup)
  disposeObject(googleProbeDebugGroup)
  googleProbeDebugGroup = null
}

function drawGoogleProbeDebug(probes, placementY) {
  if (!scene || !THREE) return
  clearGoogleProbeDebug()
  const group = new THREE.Group()
  group.name = 'google-height-probes'

  const lineMat = new THREE.LineBasicMaterial({
    color: 0x00c8ff,
    transparent: true,
    opacity: 0.75,
    depthTest: false,
  })
  const chosenMat = new THREE.MeshBasicMaterial({ color: 0x00ff66, depthTest: false })
  const rejectedMat = new THREE.MeshBasicMaterial({ color: 0xff3344, depthTest: false })
  const noHitMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, depthTest: false })
  const dotGeom = new THREE.SphereGeometry(0.45, 8, 6)

  for (const p of probes) {
    const ys = p.ys ?? []
    const chosenY = Number.isFinite(p.chosenY) ? p.chosenY : null
    const low = ys.length ? Math.min(...ys, chosenY ?? placementY) - 2 : placementY - 5
    const high = ys.length ? Math.max(...ys, chosenY ?? placementY) + 2 : placementY + 5
    const lineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(p.x, low, p.z),
      new THREE.Vector3(p.x, high, p.z),
    ])
    const line = new THREE.Line(lineGeom, lineMat)
    line.renderOrder = 1000
    group.add(line)

    if (chosenY == null) {
      const noHit = new THREE.Mesh(dotGeom, noHitMat)
      noHit.position.set(p.x, placementY, p.z)
      noHit.renderOrder = 1001
      group.add(noHit)
      continue
    }

    const chosen = new THREE.Mesh(dotGeom, chosenMat)
    chosen.position.set(p.x, chosenY + 0.2, p.z)
    chosen.renderOrder = 1001
    group.add(chosen)

    const otherYs = ys.filter(y => Math.abs(y - chosenY) > 0.15)
    const shown = [...new Set([
      otherYs[0],
      otherYs[Math.floor(otherYs.length / 2)],
      otherYs[otherYs.length - 1],
    ].filter(y => Number.isFinite(y)))]
    for (const y of shown) {
      const rejected = new THREE.Mesh(dotGeom, rejectedMat)
      rejected.position.set(p.x, y, p.z)
      rejected.renderOrder = 1001
      group.add(rejected)
    }
  }

  googleProbeDebugGroup = group
  scene.add(group)
}

async function rebuildTileFloor() {
  if (!scene || !originLngLat) return
  if (tilesAbort) tilesAbort.abort()
  if (tileFloor) {
    scene.remove(tileFloor)
    tileFloor.geometry.dispose()
    if (tileFloor.material.map) tileFloor.material.map.dispose()
    tileFloor.material.dispose()
    tileFloor = null
  }

  // Google source provides its own photoreal terrain — NEVER lay our flat
  // OSM/satellite tile floor underneath it. This guard is essential because
  // switching OSM→Google fires the basemap watcher (which calls us, async)
  // AND the buildingSource watcher (which sets tileFloor.visible=false) — and
  // since we run async, without this guard we'd rebuild a fresh, visible floor
  // AFTER the visibility watcher already ran, leaving the OSM floor showing
  // through the Google tiles.
  if (state.buildingSource === 'google') return

  const allVerts = []
  for (const z of state.zones) for (const v of z.vertices) allVerts.push(v)
  if (!allVerts.length) return

  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const [lng, lat] of allVerts) {
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat
  }
  // Match the building bbox padding so the floor extends beyond the
  // surrounding buildings rather than ending mid-frame.
  const padMeters = 250
  const padLat = padMeters / 111320
  const midLat = (minLat + maxLat) / 2
  const padLng = padMeters / (111320 * Math.cos(midLat * Math.PI / 180))
  const bbox = {
    south: minLat - padLat, west: minLng - padLng,
    north: maxLat + padLat, east: maxLng + padLng,
  }

  const myAbort = new AbortController()
  tilesAbort = myAbort
  let floor
  try {
    floor = await buildTileFloor(bbox, state.basemap, state.tileStyle, myAbort.signal)
  } catch { return }
  // Bail if (a) we got aborted (per-tile .catch swallows the abort error so
  // buildTileFloor can still return a partial truthy result, and the stale
  // call would otherwise reach scene.add below), (b) a newer rebuild has
  // replaced tilesAbort, or (c) the component already tore down.
  if (myAbort.signal.aborted || tilesAbort !== myAbort || !scene || !renderer) return
  if (!floor) return

  const texture = new THREE.CanvasTexture(floor.canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy?.() ?? 8
  texture.needsUpdate = true

  const geom = new THREE.PlaneGeometry(floor.width, floor.height)
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    // Two-sided so a grazing or below-horizon orbit doesn't blank the floor.
    side: THREE.DoubleSide,
    // polygonOffset wins the depth fight against the grey worldGround
    // placeholder (also at y=0). Without this the two coplanar planes
    // shimmer against each other under camera rotation.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  })
  tileFloor = new THREE.Mesh(geom, mat)
  tileFloor.rotation.x = -Math.PI / 2
  // Tiny lift on top of the worldGround belt-and-braces with polygonOffset.
  tileFloor.position.set(floor.centerX, 0.002, floor.centerZ)
  tileFloor.visible = state.buildingSource !== 'google'
  scene.add(tileFloor)
}

// --- Google Photorealistic 3D Tiles (optional, requires API key) ---------
function syncTerrainLayerVisibility() {
  const googleTerrainActive = state.buildingSource === 'google' && googleTilesRenderable.value
  const wg = scene?.getObjectByName('world-ground')
  if (wg) wg.visible = !googleTerrainActive
  if (tileFloor) tileFloor.visible = !googleTerrainActive
}

function countRenderableGoogleTileMeshes() {
  if (!googleTilesRenderer) return 0
  let count = 0
  googleTilesRenderer.group.traverse((child) => {
    if (!child.isMesh || child.visible === false) return
    const position = child.geometry?.attributes?.position
    if (position?.count > 0) count += 1
  })
  return count
}

function updateGoogleTileReadiness(nowMs) {
  if (!googleTilesRenderer) {
    googleTilesRenderable.value = false
    googleTileMeshCount.value = 0
    return false
  }
  const meshCount = countRenderableGoogleTileMeshes()
  googleTileMeshCount.value = meshCount
  const hasGeometry = meshCount > 0
  if (hasGeometry !== googleTilesRenderable.value) {
    googleTilesRenderable.value = hasGeometry
    syncTerrainLayerVisibility()
    syncCrowdVisibilityForTerrainAnchor()
  }
  if (hasGeometry) {
    if (!googleFirstRenderableAtMs) googleFirstRenderableAtMs = nowMs
    if (buildingsState.value !== 'ready') buildingsState.value = 'ready'
    buildingsError.value = ''
    return true
  }

  const elapsed = googleTilesStartedAtMs ? nowMs - googleTilesStartedAtMs : 0
  if (elapsed > GOOGLE_TILE_EMPTY_NOTICE_MS) {
    buildingsState.value = 'error'
    buildingsError.value = 'No Google 3D tile geometry loaded for this view; showing fallback floor.'
    state.googleHeight.status = 'No Google terrain yet; fallback floor visible'
  } else if (buildingsState.value !== 'error') {
    buildingsState.value = 'loading'
  }
  return false
}

function prepareGoogleTileDepthOccluders() {
  if (!googleTilesRenderer) return
  googleTilesRenderer.group.traverse((child) => {
    if (!child.isMesh || googleDepthPreparedMeshes.has(child)) return
    googleDepthPreparedMeshes.add(child)
    child.renderOrder = 0
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (!material) continue
      material.side = THREE.DoubleSide
      material.depthTest = true
      material.depthWrite = true
      material.needsUpdate = true
    }
  })
}

function currentPeopleColorMode() {
  return normalizePeopleColorMode(state.peopleColorMode, state.peopleTint)
}

function disposeCrowdMeshes() {
  if (!crowdMeshes.length && instancedMesh) crowdMeshes = [instancedMesh]
  for (const mesh of crowdMeshes) mesh.parent?.remove(mesh)
  crowdMeshes = []
  instancedMesh = null
  crowdWaveData = null
  naturalIdleInstances = []
  naturalIdleLastAtMs = 0
  crowdWaveStartMs = -Infinity
  crowdWaveLastAtMs = 0
  crowdWaveNeedsReset = false
}

function attachCrowdMeshesToCurrentHost() {
  if (!scene) return
  for (const mesh of crowdMeshes) {
    if (mesh.parent === scene) continue
    mesh.parent?.remove(mesh)
    scene.add(mesh)
  }
}

function syncCrowdVisibilityForTerrainAnchor() {
  const visible = state.buildingSource !== 'google' || googleGroundAnchored || !googleTilesRenderable.value
  for (const mesh of crowdMeshes) mesh.visible = visible
  if (groundGroup) groundGroup.visible = visible
}

function markCrowdMatricesDirty() {
  for (const mesh of crowdMeshes) {
    mesh.instanceMatrix.needsUpdate = true
    mesh.position.y = 0
  }
}

function crowdWaveEnvelopeAt(waveOrder, waveAmp, nowMs) {
  const progress = (nowMs - crowdWaveStartMs) / CROWD_WAVE_DURATION_MS
  if (progress < 0 || progress > 1) return 0
  const head = -CROWD_WAVE_WIDTH + progress * (1 + CROWD_WAVE_WIDTH * 2)
  const proximity = 1 - Math.abs((waveOrder ?? 0.5) - head) / CROWD_WAVE_WIDTH
  if (proximity <= 0) return 0
  const crest = clamp(proximity, 0, 1)
  const band = crest * crest * (3 - 2 * crest)
  const fade = Math.sin(progress * Math.PI)
  return band * fade * (waveAmp ?? 1)
}

function crowdWaveEnvelope(p, nowMs) {
  return crowdWaveEnvelopeAt(p.waveOrder, p.waveAmp, nowMs)
}

function crowdWaveCount() {
  return naturalIdleInstances.length || crowdWaveData?.count || 0
}

function triggerCrowdWave() {
  if (!crowdWaveCount() || !crowdMeshes.length) return
  const now = performance.now()
  if (now - crowdWaveStartMs >= 0 && now - crowdWaveStartMs <= CROWD_WAVE_DURATION_MS + 250) return
  if (crowdWaveData?.previousWave) crowdWaveData.previousWave.fill(0)
  crowdWaveStartMs = now
  crowdWaveLastAtMs = 0
  crowdWaveNeedsReset = true
}

function updateCrowdWaveAnimation(nowMs) {
  if (!crowdWaveCount() || !crowdMeshes.length || !THREE) return
  // Natural mix already rewrites instance matrices every idle frame; avoid
  // fighting that loop and let it apply the wave on top of the idle pose.
  if (naturalIdleInstances.length) {
    if (crowdWaveNeedsReset && nowMs - crowdWaveStartMs > CROWD_WAVE_DURATION_MS) {
      crowdWaveNeedsReset = false
      crowdWaveStartMs = -Infinity
    }
    return
  }

  const active = nowMs - crowdWaveStartMs >= 0 && nowMs - crowdWaveStartMs <= CROWD_WAVE_DURATION_MS
  if (!active && !crowdWaveNeedsReset) return
  if (active && nowMs - crowdWaveLastAtMs < 1000 / CROWD_WAVE_FPS) return
  crowdWaveLastAtMs = nowMs

  const data = crowdWaveData
  if (!data?.count) return
  if (!crowdWaveDummy) crowdWaveDummy = new THREE.Object3D()
  const previousWave = data.previousWave
  for (let i = 0; i < data.count; i++) {
    const wave = active ? crowdWaveEnvelopeAt(data.waveOrder[i], data.waveAmp[i], nowMs) : 0
    if (wave <= 0.001 && previousWave[i] <= 0.001) continue
    previousWave[i] = wave
    const tilt = wave * CROWD_WAVE_TILT_RAD
    crowdWaveDummy.position.set(data.x[i], data.y[i] + wave * CROWD_WAVE_LIFT_M, data.z[i])
    crowdWaveDummy.rotation.set(
      Math.cos(data.waveDir[i]) * tilt,
      data.yaw[i],
      Math.sin(data.waveDir[i]) * tilt,
    )
    crowdWaveDummy.scale.set(data.scale[i], 1, data.scale[i])
    crowdWaveDummy.updateMatrix()
    for (const mesh of crowdMeshes) mesh.setMatrixAt(i, crowdWaveDummy.matrix)
  }
  markCrowdMatricesDirty()
  if (!active) {
    crowdWaveNeedsReset = false
    crowdWaveStartMs = -Infinity
  }
}

function updateNaturalIdleAnimation(nowMs) {
  if (!naturalIdleInstances.length || !crowdMeshes.length || !THREE) return
  if (nowMs - naturalIdleLastAtMs < 1000 / NATURAL_IDLE_FPS) return
  naturalIdleLastAtMs = nowMs

  if (!naturalIdleDummy) naturalIdleDummy = new THREE.Object3D()
  const t = nowMs / 1000
  for (let i = 0; i < naturalIdleInstances.length; i++) {
    const p = naturalIdleInstances[i]
    const sway = Math.sin(t * p.speed + p.phase) * p.sway
    const drift = Math.sin(t * p.speed * 0.37 + p.phase * 1.7) * 0.22
    const stepA = Math.sin(t * p.moveSpeed + p.movePhase) * p.moveRadius
    const stepB = Math.sin(t * p.moveSpeed * 0.73 + p.movePhase * 1.41) * p.moveRadius * 0.45
    const wave = crowdWaveEnvelope(p, nowMs)
    const tilt = p.tilt + sway + wave * CROWD_WAVE_TILT_RAD
    const dir = p.tiltDir + drift
    naturalIdleDummy.position.set(
      p.x + Math.cos(p.moveDir) * stepA - Math.sin(p.moveDir) * stepB,
      p.y + wave * CROWD_WAVE_LIFT_M,
      p.z + Math.sin(p.moveDir) * stepA + Math.cos(p.moveDir) * stepB,
    )
    naturalIdleDummy.rotation.set(
      Math.cos(dir) * tilt,
      p.yaw + Math.sin(t * p.moveSpeed * 0.5 + p.phase) * 0.025,
      Math.sin(dir) * tilt,
    )
    naturalIdleDummy.scale.set(p.scale, 1, p.scale)
    naturalIdleDummy.updateMatrix()
    for (const mesh of crowdMeshes) mesh.setMatrixAt(i, naturalIdleDummy.matrix)
  }
  markCrowdMatricesDirty()
  if (crowdWaveNeedsReset && nowMs - crowdWaveStartMs > CROWD_WAVE_DURATION_MS) {
    crowdWaveNeedsReset = false
    crowdWaveStartMs = -Infinity
  }
}

function disposeGoogleTiles() {
  if (googleTilesRenderer) {
    scene?.remove(googleTilesRenderer.group)
    googleTilesRenderer.dispose?.()
  }
  googleTilesRenderer = null
  googleTilesRenderable.value = false
  googleTileMeshCount.value = 0
  // Reset the anchoring offset so the next source change starts clean.
  googleGroundOffsetY = 0
  googleGroundAnchored = false
  googleAnchoredAtTileCount = 0
  googleAnchorRefineUntilMs = 0
  googleTileStatsSignature = ''
  googleTileStatsLastChangedAtMs = 0
  googleAnchorStatsSignature = ''
  googleDepthPreparedMeshes = new WeakSet()
  googleFirstRenderableAtMs = 0
  googleTilesStartedAtMs = 0
  googleManualHeightLocked = false
  state.googleHeight.status = ''
  clearGoogleProbeDebug()
  lastAnchorAttemptVisible = 0
  lastAnchorAttemptLoaded = 0
  lastAnchorAttemptAtMs = 0
  for (const mesh of crowdMeshes) mesh.position.y = 0
  if (crowdWaveData?.y) crowdWaveData.y.fill(0)
  for (const p of naturalIdleInstances) p.y = 0
  if (groundGroup) groundGroup.position.y = 0
  buildingsState.value = 'idle'
  buildingsCount.value = 0
}

// Cast a ray straight down from high above the scene origin against Google's
// loaded tile mesh, find the ground hit Y, and shift the mannequins +
// polygon overlay up onto it. Runs once per Google tile rebuild as soon as
// any tile is visible.
// Throttling for per-instance raycast — 4,000 raycasts every frame kills the
// renderer. We attempt at most when visible tile count has grown by 50%
// since last attempt, AND at least 1.5 s since the last attempt.
let lastAnchorAttemptVisible = 0
let lastAnchorAttemptLoaded = 0
let lastAnchorAttemptAtMs = 0

function googleTilesSettledFor(nowMs, settleMs) {
  return googleTileStatsLastChangedAtMs > 0 && nowMs - googleTileStatsLastChangedAtMs > settleMs
}

function anchorToGoogleGround({ force = false } = {}) {
  if (!googleTilesRenderer || !instancedMesh) return
  if (!googleTilesRenderable.value) return false
  const stats = googleTilesRenderer.stats ?? {}
  const visible = stats.visible ?? 0
  const loaded = stats.loaded ?? 0
  // Need at least one rendered Google mesh. We hide the crowd until the first
  // successful anchor, so there is no un-grounded floating preview while
  // Google is still streaming.
  if (visible < 1 || loaded < 1) return
  // Automatic anchoring stays intentionally tiny: it only makes the crowd
  // visible on Google tiles. The accurate placement pass is the manual dense
  // Reset height grid.
  const nowMs = performance.now()
  if (!googleFirstRenderableAtMs) googleFirstRenderableAtMs = nowMs
  const firstAnchorSettled = googleTilesSettledFor(nowMs, GOOGLE_TILE_SETTLE_BEFORE_FIRST_ANCHOR_MS)
  const firstAnchorMaxWaited = nowMs - googleFirstRenderableAtMs > GOOGLE_TILE_MAX_WAIT_BEFORE_FIRST_ANCHOR_MS
  if (!force && !googleGroundAnchored && !firstAnchorSettled && !firstAnchorMaxWaited) return
  if (!force && googleManualHeightLocked) return
  const visibleProgress = visible >= lastAnchorAttemptVisible + (googleGroundAnchored ? 2 : 1)
  const loadedProgress = loaded >= lastAnchorAttemptLoaded + (googleGroundAnchored ? 64 : 1)
  const statsSettled = googleTilesSettledFor(nowMs, GOOGLE_TILE_SETTLE_REANCHOR_MS)
  const finalSettle = googleGroundAnchored && statsSettled && googleAnchorStatsSignature !== googleTileStatsSignature
  if (!force && googleGroundAnchored && !visibleProgress && !loadedProgress && !finalSettle) return
  if (!force && nowMs - lastAnchorAttemptAtMs < (googleGroundAnchored ? (finalSettle ? 1200 : 3000) : 500)) return
  lastAnchorAttemptVisible = visible
  lastAnchorAttemptLoaded = loaded
  lastAnchorAttemptAtMs = nowMs
  googleAnchorStatsSignature = googleTileStatsSignature

  googleTilesRenderer.group.updateMatrixWorld(true)

  // TERRAIN-FOLLOWING anchor: build a local height grid over the occupied
  // crowd footprint, then snap each person to the nearby sampled tile height.
  // This is much denser than the 50 visible debug probes but still far cheaper
  // than raycasting every person in a 40k+ crowd.
  //
  // We deliberately do NOT filter by face.normal: Google's tile meshes come
  // through the ECEF→local transform with DOWNWARD-pointing normals
  // (face.normal.y ≈ -0.75 on flat ground), so an "up-facing" filter would
  // reject every real ground hit. Each ray column records all hit heights; in
  // this test we pick the topmost visible hit, then local median lookup reduces
  // single-cell spikes before assigning pedestrian heights.
  const m4 = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3()
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 10000)
  const N = instancedMesh.count

  const positions = []
  for (let i = 0; i < N; i++) {
    instancedMesh.getMatrixAt(i, m4)
    m4.decompose(pos, quat, scl)
    positions.push({ x: pos.x, z: pos.z })
  }
  const grid = buildGoogleHeightGrid(positions, googleTilesRenderer.group, ray, {
    cellSize: force ? GOOGLE_HEIGHT_GRID_CELL_M : GOOGLE_HEIGHT_GRID_AUTO_CELL_M,
    maxProbes: force ? GOOGLE_HEIGHT_GRID_MAX_PROBES : GOOGLE_HEIGHT_GRID_AUTO_MAX_PROBES,
  })
  if (!grid) return false

  if (force) {
    clearGoogleProbeDebug()
  }

  // Assign each instance a local grid height, preserving its existing yaw and
  // scale. Nearby-cell median lookup keeps one bad ray hit from moving a big
  // block of pedestrians.
  for (let i = 0; i < N; i++) {
    instancedMesh.getMatrixAt(i, m4)
    m4.decompose(pos, quat, scl)
    const liftedY = heightFromGoogleGrid(grid, pos.x, pos.z) + GOOGLE_PERSON_TERRAIN_LIFT_M
    pos.y = liftedY
    if (crowdWaveData?.y) crowdWaveData.y[i] = liftedY
    if (naturalIdleInstances[i]) naturalIdleInstances[i].y = liftedY
    m4.compose(pos, quat, scl)
    for (const mesh of crowdMeshes) mesh.setMatrixAt(i, m4)
  }
  markCrowdMatricesDirty()

  // Keep the blue zone on the same sampled height field as the people.
  setGroundOverlaysToHeightGrid(grid)

  googleGroundOffsetY = grid.fallbackY
  googleGroundAnchored = true
  googleManualHeightLocked = force
  googleAnchoredAtTileCount = visible
  state.googleHeight.status = `${force ? 'Height reset' : 'Height set'} from ${loaded.toLocaleString()} loaded tiles; ${grid.hitCount.toLocaleString()}/${grid.sampleCount.toLocaleString()} grid hits`
  return true
}

function resetGoogleHeightFromLoadedTiles() {
  if (state.buildingSource !== 'google') return
  if (!googleTilesRenderer || !instancedMesh) {
    state.googleHeight.status = 'Google tiles are not ready yet'
    return
  }
  if (!googleTilesRenderable.value) {
    state.googleHeight.status = 'Google tile geometry has not loaded yet'
    return
  }
  const stats = googleTilesRenderer.stats ?? {}
  const visible = stats.visible ?? 0
  const loaded = stats.loaded ?? 0
  if (visible < 1 || loaded < 1) {
    state.googleHeight.status = 'Wait until Google tiles are visible'
    return
  }

  state.googleHeight.busy = true
  state.googleHeight.status = 'Raycasting current tiles...'
  try {
    clearGoogleProbeDebug()
    googleGroundAnchored = false
    googleGroundOffsetY = 0
    googleAnchoredAtTileCount = 0
    googleAnchorStatsSignature = ''
    googleManualHeightLocked = false
    lastAnchorAttemptVisible = 0
    lastAnchorAttemptLoaded = 0
    lastAnchorAttemptAtMs = 0

    googleTilesRenderer.group.updateMatrixWorld(true)
    prepareGoogleTileDepthOccluders()
    const anchored = anchorToGoogleGround({ force: true })
    if (!anchored) state.googleHeight.status = 'No terrain hits in current Google tiles'
  } finally {
    state.googleHeight.busy = false
  }
}

async function rebuildGoogleTiles() {
  if (!scene || !originLngLat) return
  disposeGoogleTiles()
  if (!state.googleMapsKey) {
    buildingsState.value = 'error'
    buildingsError.value = 'Google source selected but no API key set.'
    return
  }
  buildingsState.value = 'loading'
  buildingsError.value = ''
  googleTilesRenderable.value = false
  googleTileMeshCount.value = 0
  googleTilesStartedAtMs = performance.now()
  state.googleHeight.status = 'Loading Google tiles...'
  try {
    const lib = await import('3d-tiles-renderer')
    const { TilesRenderer, WGS84_ELLIPSOID } = lib
    const { GoogleCloudAuthPlugin } = await import('3d-tiles-renderer/plugins')
    const tiles = new TilesRenderer('https://tile.googleapis.com/v1/3dtiles/root.json')
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: state.googleMapsKey }))
    // Default errorTarget is 6 (screen-space pixels) — too coarse: the
    // renderer stops loading after only a handful of root tiles. 2 px =
    // mid-fidelity, loads enough sub-tiles to cover the zone footprint with
    // smooth terrain.
    //
    // We deliberately do NOT enable `displayActiveTiles=true`. It exposes
    // tiles in the renderer's "active" set that aren't yet positioned by
    // the top-level ECEF→local transform (they sit at raw ECEF, thousands
    // of metres from the scene origin). Raycasting against them yields
    // wildly wrong ground heights that pull the crowd anchor to +700 m.
    // The "visible" set (what renders by default) is fully transformed.
    tiles.errorTarget = 2
    scene.add(tiles.group)
    googleTilesRenderer = tiles
    googleAnchorRefineUntilMs = performance.now() + 14000

    // Google's tiles live in ECEF (Earth-Centered Earth-Fixed) coordinates,
    // millions of metres from Earth's centre. Our scene's origin (0, 0, 0)
    // is the zone centroid in local metres. Without the matrix below, the
    // tiles render at their real ECEF positions — invisible to our camera.
    //
    // Transform chain:
    //   1. ecefToEnu = inverse(getEastNorthUpFrame at zone centroid) →
    //      brings ECEF points to an East-North-Up frame at our origin.
    //   2. enuToOurs = rotateX(-90°) →
    //      ENU has Z=Up, Y=North; ours has Y=Up, -Z=North. This rotation
    //      maps ENU axes to our convention used by lngLatToLocalMeters.
    if (originLngLat && WGS84_ELLIPSOID) {
      const [oLng, oLat] = originLngLat
      const DEG2RAD = Math.PI / 180
      const enuToEcef = new THREE.Matrix4()
      WGS84_ELLIPSOID.getEastNorthUpFrame(oLat * DEG2RAD, oLng * DEG2RAD, 0, enuToEcef)
      const ecefToEnu = enuToEcef.clone().invert()
      const enuToOurs = new THREE.Matrix4().makeRotationX(-Math.PI / 2)
      const finalMatrix = new THREE.Matrix4().multiplyMatrices(enuToOurs, ecefToEnu)
      tiles.group.matrix.copy(finalMatrix)
      tiles.group.matrixAutoUpdate = false
      tiles.group.updateMatrixWorld(true)
    }

    // Google's tiles include their own terrain — hide our grey worldGround
    // placeholder and the OSM tile floor once real Google mesh exists, so
    // we're not double-drawing. Until then, keep the fallback floor visible.
    syncTerrainLayerVisibility()

    buildingsState.value = 'loading'
    state.googleHeight.status = 'Waiting for Google tile geometry...'
    buildingsCount.value = 0  // We don't enumerate per-building counts for Google.
  } catch (e) {
    buildingsState.value = 'error'
    buildingsError.value = `Google 3D Tiles: ${e.message || e}`
    state.googleHeight.status = ''
    googleTilesRenderer = null
    googleTilesRenderable.value = false
    googleTileMeshCount.value = 0
  }
}

async function rebuildBuildings() {
  // Source dispatch — Google or OSM. OSM is the default and works without
  // any key; Google is opt-in and needs the user's API key.
  if (state.buildingSource === 'google') {
    // Clear any OSM extrusions still in the scene
    if (buildingsAbort) buildingsAbort.abort()
    if (buildingsGroup) { scene.remove(buildingsGroup); disposeObject(buildingsGroup); buildingsGroup = null }
    return rebuildGoogleTiles()
  }
  // OSM path: make sure any Google scene from a previous selection is gone.
  disposeGoogleTiles()

  if (!scene || !originLngLat) return
  // Clear previous buildings + cancel any in-flight fetch
  if (buildingsAbort) buildingsAbort.abort()
  if (buildingsGroup) { scene.remove(buildingsGroup); disposeObject(buildingsGroup); buildingsGroup = null }

  buildingsState.value = 'loading'
  buildingsError.value = ''
  buildingsCount.value = 0

  // Bounding box around all zones, padded by ~200 m so the user sees
  // surrounding context as well as the building inside the polygon.
  const allVerts = []
  for (const z of state.zones) for (const v of z.vertices) allVerts.push(v)
  if (!allVerts.length) { buildingsState.value = 'idle'; return }
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const [lng, lat] of allVerts) {
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat
  }
  const padMeters = 200
  const padLat = padMeters / 111320
  const midLat = (minLat + maxLat) / 2
  const padLng = padMeters / (111320 * Math.cos(midLat * Math.PI / 180))
  const bbox = {
    south: minLat - padLat, west: minLng - padLng,
    north: maxLat + padLat, east: maxLng + padLng,
  }

  const myBldAbort = new AbortController()
  buildingsAbort = myBldAbort
  let buildings
  try {
    buildings = await fetchBuildings(bbox, myBldAbort.signal)
  } catch (e) {
    if (e.name === 'AbortError') return
    if (myBldAbort.signal.aborted || buildingsAbort !== myBldAbort || !scene) return
    buildingsState.value = 'error'
    buildingsError.value = String(e.message || e)
    return
  }
  if (myBldAbort.signal.aborted || buildingsAbort !== myBldAbort || !scene) return

  buildingsGroup = new THREE.Group()
  const buildingMat = new THREE.MeshStandardMaterial({
    color: 0xb1b6bd, roughness: 0.85, metalness: 0,
  })
  for (const b of buildings) {
    const localRing = b.ring.map(lngLatToLocalMeters)
    if (localRing.length < 3) continue
    // Same vec2.y flip as the ground polygon so the rotated extrusion lands
    // at the correct world (x, z) rather than mirrored.
    const shape = new THREE.Shape(localRing.map(([x, z]) => new THREE.Vector2(x, -z)))
    try {
      const geom = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false })
      geom.rotateX(-Math.PI / 2)
      const mesh = new THREE.Mesh(geom, buildingMat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      buildingsGroup.add(mesh)
    } catch {
      // Bad polygon (self-intersecting / collinear) — skip silently.
    }
  }
  scene.add(buildingsGroup)
  buildingsCount.value = buildingsGroup.children.length
  buildingsState.value = 'ready'
}

function rebuildScene() {
  if (!scene || !baseModel) return
  // Clear previous content
  if (groundGroup) { scene.remove(groundGroup); disposeObject(groundGroup); groundGroup = null }
  disposeCrowdMeshes()

  const zones = state.zones.filter(z => z.vertices.length >= 3)
  if (!zones.length) {
    personCount.value = 0
    target.set(0, 0, 0)
    updateCamera()
    return
  }

  // Pick the origin from the centroid of all zones combined
  let cx = 0, cy = 0, n = 0
  for (const z of zones) for (const [lng, lat] of z.vertices) { cx += lng; cy += lat; n++ }
  originLngLat = [cx / n, cy / n]

  // Build ground planes (one extruded slab per zone using the polygon as a shape)
  groundGroup = new THREE.Group()
  scene.add(groundGroup)

  // Pre-pass: pull each zone's cached sample points. No display cap — every
  // sampled person is rendered so crush densities actually read as a crush.
  // The sampler itself still bounds the count via MAX_DOTS_PER_ZONE.
  const zonePts = zones.map(z => sampleZonePoints(z).points)
  const totalPts = zonePts.reduce((s, p) => s + p.length, 0)
  const factor = 1

  // Collect all sampled people across zones (in local meters)
  const samples = []
  let zoneIndex = 0
  for (const z of zones) {
    const localOuter = z.vertices.map(lngLatToLocalMeters)
    const localHoles = (z.obstructions ?? [])
      .filter(o => o.vertices.length >= 3)
      .map(o => o.vertices.map(lngLatToLocalMeters))

    // Ground polygon mesh. With Google source we tessellate into a grid so
    // the overlay can drape over actual terrain. With OSM source the simple flat
    // ShapeGeometry is enough — the OSM tile floor is flat anyway.
    let geom
    if (state.buildingSource === 'google') {
      geom = buildTessellatedGroundGeometry(localOuter, localHoles, 50)
    } else {
      const shape = new THREE.Shape(localOuter.map(([x, zz]) => new THREE.Vector2(x, -zz)))
      for (const ring of localHoles) {
        const hole = new THREE.Path(ring.map(([x, zz]) => new THREE.Vector2(x, -zz)))
        shape.holes.push(hole)
      }
      geom = new THREE.ShapeGeometry(shape)
      geom.rotateX(-Math.PI / 2)
    }
    const color = new THREE.Color(z.color || '#2563eb')
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.95, metalness: 0,
      transparent: true, opacity: 0.22,
      // polygonOffset shifts the depth-test value (not just the written
      // depth) before the test, so the zone polygon never z-fights against
      // the tile floor below even with depthWrite disabled.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
      depthWrite: false,
    })
    const groundMesh = new THREE.Mesh(geom, mat)
    groundMesh.receiveShadow = true
    // Keep the polygon hugging the tile floor (was y=0.05 — that sliced
    // through the 1.7 m mannequin ankles as a visible blue rim). The
    // y-stagger keeps multiple zones stable against each other under orbit:
    // Three.js back-to-front sorting becomes a stable per-zone order.
    groundMesh.position.y = 0.005 + zoneIndex * 0.001
    // Increment per zone so the transparent-bucket sort is deterministic
    // across the user's pan/orbit (rather than centroid-flipping).
    groundMesh.renderOrder = 1 + zoneIndex
    groundGroup.add(groundMesh)

    // Outline — sits ABOVE the polygon so it stays crisp instead of being
    // alpha-tinted by the zone fill.
    const outlineGeom = state.buildingSource === 'google'
      ? buildDrapableOutlineGeometry(localOuter)
      : new THREE.BufferGeometry().setFromPoints(
          localOuter.concat([localOuter[0]]).map(([x, z]) => new THREE.Vector3(x, 0.08 + zoneIndex * 0.001, z))
        )
    groundGroup.add(new THREE.Line(outlineGeom, new THREE.LineBasicMaterial({ color, linewidth: 2 })))

    // Pre-project the zone's facing target into local meters once. Per-sample
    // we use this to set each mannequin's yaw (atan2 + small jitter) so they
    // visibly look at the same focal point — stage, screen, etc.
    const facingLocal = z.facingPoint ? lngLatToLocalMeters(z.facingPoint) : null

    // Take this zone's proportional share of the display budget, using an
    // even stride so the kept points still cover the polygon uniformly
    // (instead of clustering in whichever corner the sampler emitted first).
    const ptsLngLat = zonePts[zoneIndex]
    if (ptsLngLat.length) {
      const take = Math.min(ptsLngLat.length, Math.max(1, Math.floor(ptsLngLat.length * factor)))
      const stride = ptsLngLat.length / take
      for (let i = 0; i < take; i++) {
        const idx = Math.min(ptsLngLat.length - 1, Math.floor(i * stride))
        const [x, zz] = lngLatToLocalMeters(ptsLngLat[idx])
        samples.push({ x, z: zz, color: z.color, facingLocal, seed: personSeed(z.id, idx, ptsLngLat[idx]) })
      }
    }
    zoneIndex++
  }

  personCount.value = samples.length

  // Person size is FIXED — a real adult-scale figure, never scaled
  // by density. Crush reads as crush because we render MORE figures (and swap
  // to the low-poly capsule LOD to keep it fast), not because they grow.
  const footprintScale = 1
  let minWaveX = Infinity, maxWaveX = -Infinity, minWaveZ = Infinity, maxWaveZ = -Infinity
  for (const p of samples) {
    if (p.x < minWaveX) minWaveX = p.x
    if (p.x > maxWaveX) maxWaveX = p.x
    if (p.z < minWaveZ) minWaveZ = p.z
    if (p.z > maxWaveZ) maxWaveZ = p.z
  }
  const waveSpanX = maxWaveX - minWaveX
  const waveSpanZ = maxWaveZ - minWaveZ
  const waveUsesZ = waveSpanZ > waveSpanX
  const waveMin = waveUsesZ ? minWaveZ : minWaveX
  const waveSpan = Math.max(1, waveUsesZ ? waveSpanZ : waveSpanX)

  // World ground placeholder — solid colour shown until the tile texture
  // floor finishes loading (or as a fallback if it fails). Stays in place
  // either way to swallow the void around the camera.
  const prev = scene.getObjectByName('world-ground')
  if (prev) { scene.remove(prev); prev.geometry.dispose(); prev.material.dispose() }
  const worldGround = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000),
    new THREE.MeshStandardMaterial({ color: 0xdfe5ec, roughness: 1, metalness: 0 })
  )
  worldGround.rotation.x = -Math.PI / 2
  worldGround.receiveShadow = true
  worldGround.name = 'world-ground'
  worldGround.visible = state.buildingSource !== 'google'
  scene.add(worldGround)

  // Instance the human model
  if (samples.length > 0) {
    const mode = currentPeopleColorMode()
    const useNatural = mode === 'natural' && naturalModel
    const meshes = useNatural
      ? [
          new THREE.InstancedMesh(naturalModel.upper.geometry, naturalModel.upper.material, samples.length),
          new THREE.InstancedMesh(naturalModel.lower.geometry, naturalModel.lower.material, samples.length),
          new THREE.InstancedMesh(naturalModel.head.geometry, naturalModel.head.material, samples.length),
          new THREE.InstancedMesh(naturalModel.hair.geometry, naturalModel.hair.material, samples.length),
        ]
      : (() => {
          // LOD: detailed mannequin for small gatherings, low-poly capsule for
          // big crowds. The capsule lets tens of thousands render smoothly.
          const useLowPoly = lowPolyModel && samples.length > LOWPOLY_THRESHOLD
          const model = useLowPoly ? lowPolyModel : baseModel
          const mesh = new THREE.InstancedMesh(model.geometry, model.material, samples.length)
          mesh.castShadow = !useLowPoly
          return [mesh]
        })()

    for (const mesh of meshes) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.renderOrder = 20
      mesh.receiveShadow = false
      if (useNatural) mesh.castShadow = false
    }
    crowdMeshes = meshes
    instancedMesh = meshes[0]

    const dummy = new THREE.Object3D()
    const c = new THREE.Color()
    const c2 = new THREE.Color()
    const c3 = new THREE.Color()
    const c4 = new THREE.Color()
    crowdWaveData = useNatural ? null : {
      count: samples.length,
      x: new Float32Array(samples.length),
      y: new Float32Array(samples.length),
      z: new Float32Array(samples.length),
      yaw: new Float32Array(samples.length),
      scale: new Float32Array(samples.length),
      waveOrder: new Float32Array(samples.length),
      waveAmp: new Float32Array(samples.length),
      waveDir: new Float32Array(samples.length),
      previousWave: new Float32Array(samples.length),
    }
    naturalIdleInstances = []
    for (let i = 0; i < samples.length; i++) {
      const { x, z, color: zoneColor, facingLocal, seed } = samples[i]
      let yaw
      dummy.position.set(x, 0, z)
      dummy.rotation.x = 0
      dummy.rotation.z = 0
      if (facingLocal) {
        // Three.js +X is east, +Z is south (we flipped lat so north = -Z).
        // atan2(dx, -dz) gives a compass-style heading (0 = north,
        // π/2 = east). The mannequin GLB's natural front happens to be
        // along +Z, so to rotate it toward the target we set rotation.y
        // to (heading − π). A ±15° jitter keeps the crowd from looking
        // robotically aligned.
        const dx = facingLocal[0] - x
        const dz = facingLocal[1] - z
        const heading = Math.atan2(dx, -dz)
        const jitter = (rand01(seed, 11) - 0.5) * (30 * Math.PI / 180)
        yaw = heading - Math.PI + jitter
      } else {
        // Random yaw — crowd has no focal point, so people face every way.
        yaw = (rand01(seed, 12) * 2 - 1) * Math.PI
      }
      dummy.rotation.y = yaw
      const waveOrder = ((waveUsesZ ? z : x) - waveMin) / waveSpan
      const waveAmp = 0.85 + rand01(seed, 22) * 0.3
      const waveDir = rand01(seed, 23) * Math.PI * 2
      if (crowdWaveData) {
        crowdWaveData.x[i] = x
        crowdWaveData.y[i] = 0
        crowdWaveData.z[i] = z
        crowdWaveData.yaw[i] = yaw
        crowdWaveData.scale[i] = footprintScale
        crowdWaveData.waveOrder[i] = waveOrder
        crowdWaveData.waveAmp[i] = waveAmp
        crowdWaveData.waveDir[i] = waveDir
      }
      if (useNatural) {
        const tilt = (0.25 + rand01(seed, 13) * 0.75) * NATURAL_IDLE_TILT_MAX_RAD
        const tiltDir = rand01(seed, 14) * Math.PI * 2
        dummy.rotation.x = Math.cos(tiltDir) * tilt
        dummy.rotation.z = Math.sin(tiltDir) * tilt
        naturalIdleInstances.push({
          x,
          y: 0,
          z,
          yaw,
          scale: footprintScale,
          waveOrder,
          waveAmp,
          waveDir,
          tilt,
          tiltDir,
          sway: (0.35 + rand01(seed, 15) * 0.65) * NATURAL_IDLE_SWAY_MAX_RAD,
          speed: 0.9 + rand01(seed, 16) * 0.9,
          phase: rand01(seed, 17) * Math.PI * 2,
          moveRadius: (0.35 + rand01(seed, 18) * 0.65) * NATURAL_IDLE_MOVE_MAX_M,
          moveSpeed: 0.55 + rand01(seed, 19) * 0.65,
          movePhase: rand01(seed, 20) * Math.PI * 2,
          moveDir: rand01(seed, 21) * Math.PI * 2,
        })
      }
      // footprintScale is always 1 (person size is fixed); kept as an
      // explicit identity so the matrix path is uniform.
      dummy.scale.set(footprintScale, 1, footprintScale)
      dummy.updateMatrix()
      for (const mesh of meshes) mesh.setMatrixAt(i, dummy.matrix)
      if (useNatural) {
        const appearance = personAppearance(seed)
        meshes[0].setColorAt(i, c.set(appearance.upperClothing))
        meshes[1].setColorAt(i, c2.set(appearance.lowerClothing))
        meshes[2].setColorAt(i, c3.set(appearance.skin))
        meshes[3].setColorAt(i, c4.set(appearance.hair))
      } else {
        // Per-instance colour. Zone mode uses the parent zone colour;
        // neutral mode keeps the model's off-white material.
        if (mode === 'zone') c.set(zoneColor || '#ffffff')
        else c.setRGB(1, 1, 1)
        instancedMesh.setColorAt(i, c)
      }
    }
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    attachCrowdMeshesToCurrentHost()
    // Reset the Google-terrain anchor throttle: this is a fresh instancedMesh
    // with every instance at y=0. Without resetting, the throttle's
    // last-visible-tile counter from the previous mesh stops anchorToGoogleGround
    // from firing again, leaving the new crowd floating at scene origin.
    lastAnchorAttemptVisible = 0
    lastAnchorAttemptLoaded = 0
    lastAnchorAttemptAtMs = 0
  }

  // Re-frame the camera + re-fetch tiles only when this is a structural
  // rebuild (origin/bbox changed). Density slider drags and colour-swatch
  // edits keep the user's current camera angle so they're not jolted on
  // every small parameter tweak.
  if (rebuildScene._refetchExternals) {
    rebuildScene._refetchExternals = false
    const box = new THREE.Box3().setFromObject(groundGroup)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    target.copy(center)
    target.y = 1.0
    const maxDim = Math.max(size.x, size.z, 20)
    distance = maxDim * 1.6
    pitch = 0.55
    yaw = -0.6
    updateCamera()

    rebuildBuildings()
    rebuildTileFloor()
  }
  // Reset Google ground anchoring so the (possibly resized) InstancedMesh
  // gets per-instance Y on the next animation frame.
  googleGroundAnchored = false
  googleTileStatsSignature = ''
  googleTileStatsLastChangedAtMs = 0
  googleAnchorStatsSignature = ''
  googleFirstRenderableAtMs = 0
  googleManualHeightLocked = false
  lastAnchorAttemptVisible = 0
  lastAnchorAttemptLoaded = 0
  lastAnchorAttemptAtMs = 0
  googleAnchorRefineUntilMs = performance.now() + 10000
  syncTerrainLayerVisibility()
}

function disposeObject(obj) {
  obj.traverse?.((child) => {
    child.geometry?.dispose?.()
    if (child.material) {
      const ms = Array.isArray(child.material) ? child.material : [child.material]
      ms.forEach((m) => { m.map?.dispose?.(); m.dispose?.() })
    }
  })
}

function updateCamera() {
  if (!camera || !target) return
  const h = Math.cos(pitch) * distance
  camera.position.set(
    target.x + Math.sin(yaw) * h,
    target.y + Math.sin(pitch) * distance,
    target.z + Math.cos(yaw) * h
  )
  camera.lookAt(target)
}

function keepCinematicCameraAboveGoogleTiles(clearanceM = 10) {
  if (state.buildingSource !== 'google' || !googleTilesRenderer || !camera || !target || !THREE) return
  if (!cinematicSurfaceRay) {
    cinematicSurfaceRay = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 10000)
  }
  const ys = googleTerrainHitYValuesAt(
    camera.position.x,
    camera.position.z,
    googleTilesRenderer.group,
    cinematicSurfaceRay,
    { bidirectional: false },
  )
  const surfaceY = ys.length ? ys[ys.length - 1] : googleGroundOffsetY
  const minCameraY = surfaceY + clearanceM
  if (!Number.isFinite(minCameraY) || camera.position.y >= minCameraY) return
  target.y += minCameraY - camera.position.y
  updateCamera()
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function stopCinematic() {
  cinematicMode.value = 'off'
}

function toggleCinematic(mode) {
  if (!target) return
  if (cinematicMode.value === mode) {
    stopCinematic()
    return
  }
  cinematicMode.value = mode
  cinematicStartMs = performance.now()
  cinematicBase = {
    target: target.clone(),
    yaw,
    pitch,
    distance,
  }
}

function updateCinematicCamera(nowMs) {
  if (cinematicMode.value === 'off' || !cinematicBase || !target) return
  const mode = cinematicMode.value
  const duration = mode === 'orbit' ? 26000
    : mode === 'flyover' ? 18000
    : mode === 'push' ? 14000
    : mode === 'drone' ? 22000
    : mode === 'skim' ? 17000
    : 16000
  const phase = ((nowMs - cinematicStartMs) % duration) / duration
  const a = phase * Math.PI * 2
  const base = cinematicBase

  if (mode === 'orbit') {
    target.copy(base.target)
    yaw = base.yaw + a
    pitch = clamp(base.pitch + Math.sin(a * 2) * 0.045, 0.2, 1.12)
    distance = clamp(base.distance * (1 + Math.sin(a) * 0.06), 10, 4000)
  } else if (mode === 'flyover') {
    const rise = 0.5 - Math.cos(a) * 0.5
    target.copy(base.target)
    yaw = base.yaw + Math.sin(a) * 0.18
    pitch = clamp(0.92 - rise * 0.42, 0.22, 1.15)
    distance = clamp(base.distance * (1.24 - rise * 0.44), 10, 4000)
  } else if (mode === 'sweep') {
    const swing = Math.sin(a)
    const rightX = Math.cos(base.yaw)
    const rightZ = -Math.sin(base.yaw)
    const amplitude = clamp(base.distance * 0.23, 18, 170)
    target.set(
      base.target.x + rightX * amplitude * swing,
      base.target.y,
      base.target.z + rightZ * amplitude * swing,
    )
    yaw = base.yaw + swing * 0.22
    pitch = clamp(base.pitch + Math.cos(a) * 0.04, 0.18, 1.08)
    distance = clamp(base.distance * (1 + Math.cos(a) * 0.035), 10, 4000)
  } else if (mode === 'push') {
    const zoomWave = 0.5 - Math.cos(a) * 0.5
    target.copy(base.target)
    yaw = base.yaw + Math.sin(a) * 0.08
    pitch = clamp(base.pitch + Math.sin(a * 0.5) * 0.055, 0.18, 1.08)
    distance = clamp(base.distance * (1.28 - zoomWave * 0.58), 10, 4000)
  } else if (mode === 'drone') {
    const dive = 0.5 - Math.cos(a) * 0.5
    const forwardX = Math.sin(base.yaw)
    const forwardZ = Math.cos(base.yaw)
    const track = Math.sin(a) * clamp(base.distance * 0.18, 12, 130)
    target.set(
      base.target.x + forwardX * track,
      base.target.y,
      base.target.z + forwardZ * track,
    )
    yaw = base.yaw + a * 0.22 + Math.sin(a * 2) * 0.1
    pitch = clamp(1.08 - dive * 0.66, 0.24, 1.2)
    distance = clamp(base.distance * (1.55 - dive * 0.9), 10, 4000)
  } else if (mode === 'skim') {
    const swing = Math.sin(a)
    const rightX = Math.cos(base.yaw)
    const rightZ = -Math.sin(base.yaw)
    const forwardX = Math.sin(base.yaw)
    const forwardZ = Math.cos(base.yaw)
    const side = clamp(base.distance * 0.3, 24, 190)
    const advance = Math.cos(a) * clamp(base.distance * 0.1, 8, 75)
    target.set(
      base.target.x + rightX * side * swing + forwardX * advance,
      base.target.y + 6,
      base.target.z + rightZ * side * swing + forwardZ * advance,
    )
    yaw = base.yaw + swing * 0.34
    pitch = clamp(0.46 + Math.sin(a + Math.PI / 4) * 0.05, 0.34, 0.7)
    distance = clamp(base.distance * 0.68, 18, 4000)
  }

  updateCamera()
  if (mode === 'skim') keepCinematicCameraAboveGoogleTiles(10)
}

function resize() {
  if (!canvasRef.value || !renderer || !camera) return
  const w = canvasRef.value.clientWidth, h = canvasRef.value.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

function renderSceneFrame() {
  if (!renderer || !scene || !camera) return
  attachCrowdMeshesToCurrentHost()
  syncCrowdVisibilityForTerrainAnchor()
  renderer.render(scene, camera)
}

function pointerOnTargetPlane(e) {
  if (!THREE || !camera || !target || !canvasRef.value) return null
  const rect = canvasRef.value.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -(((e.clientY - rect.top) / rect.height) * 2 - 1),
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(mouse, camera)
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -target.y)
  const hit = new THREE.Vector3()
  return raycaster.ray.intersectPlane(plane, hit) ? hit : null
}

function panFromScreenDelta(dx, dy) {
  if (!THREE || !camera || !target) return
  const forward = new THREE.Vector3()
  camera.getWorldDirection(forward)
  forward.y = 0
  if (forward.lengthSq() < 0.0001) forward.set(Math.sin(yaw), 0, Math.cos(yaw)).negate()
  forward.normalize()
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
  const scale = Math.max(0.02, distance * 0.0012)
  target.addScaledVector(right, -dx * scale)
  target.addScaledVector(forward, dy * scale)
  updateCamera()
}

// ---------------------------------------------------------------
// Navigation: pan / zoom / rotate (camera orbits around `target`).
// Step magnitudes scale with `distance` so the controls feel the same
// whether the camera is 10 m or 300 m from the action.
// ---------------------------------------------------------------
function panStep(sign) {
  return sign * Math.max(0.5, distance * 0.05)
}
function rotateStep(sign) { return sign * 0.12 }       // ~7° per click
function zoomStep(sign)   { return sign * 0.15 }       // 15% per click
function pitchStep(sign)  { return sign * 0.08 }

function panForward(sign) {
  stopCinematic()
  // Move target along the camera's forward direction projected to XZ.
  const dx = target.x - camera.position.x
  const dz = target.z - camera.position.z
  const len = Math.hypot(dx, dz) || 1
  const step = panStep(sign)
  target.x += (dx / len) * step
  target.z += (dz / len) * step
  updateCamera()
}
function panRight(sign) {
  stopCinematic()
  // Strafe perpendicular to forward, in XZ. The camera-right direction
  // in world space is Forward × Up (NOT Up × Forward), which gives
  // (-Fz, Fx) in the XZ plane.
  const dx = target.x - camera.position.x
  const dz = target.z - camera.position.z
  const len = Math.hypot(dx, dz) || 1
  const fx = dx / len, fz = dz / len
  const step = panStep(sign)
  target.x += -fz * step
  target.z +=  fx * step
  updateCamera()
}
function rotateYaw(sign) { stopCinematic(); yaw += rotateStep(sign); updateCamera() }
function rotatePitch(sign) {
  stopCinematic()
  pitch = Math.max(0.05, Math.min(1.45, pitch + pitchStep(sign)))
  updateCamera()
}
function zoom(sign) {
  stopCinematic()
  // Negative sign zooms in (smaller distance), positive zooms out.
  distance = Math.max(10, Math.min(4000, distance * (1 + zoomStep(sign))))
  updateCamera()
}
function resetView() {
  stopCinematic()
  if (!groundGroup) return
  const box = new THREE.Box3().setFromObject(groundGroup)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  target.copy(center); target.y = 1.0
  const maxDim = Math.max(size.x, size.z, 20)
  distance = maxDim * 1.6
  pitch = 0.55
  yaw = -0.6
  updateCamera()
}

function onKey(e) {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return
  const k = e.key
  let handled = true
  switch (k) {
    case ' ': case 'Spacebar': spacePanActive = true; break
    case 'ArrowUp':    case 'w': case 'W': panForward(+1); break
    case 'ArrowDown':  case 's': case 'S': panForward(-1); break
    case 'ArrowLeft':  case 'a': case 'A': panRight(-1); break
    case 'ArrowRight': case 'd': case 'D': panRight(+1); break
    case '+': case '=': zoom(-1); break
    case '-': case '_': zoom(+1); break
    case 'q': case 'Q': rotateYaw(-1); break
    case 'e': case 'E': rotateYaw(+1); break
    case 'r': case 'R': rotatePitch(+1); break
    case 'f': case 'F': rotatePitch(-1); break
    case 'h': case 'H': if (!e.repeat) triggerCrowdWave(); break
    case 'Home':       resetView(); break
    default: handled = false
  }
  if (handled) e.preventDefault()
}

function onKeyUp(e) {
  if (e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space') spacePanActive = false
}

function onWindowBlur() {
  spacePanActive = false
}

function wantsPointerPan(e) {
  return e.button === 1 || e.shiftKey || spacePanActive
}

function wantsPointerZoom(e) {
  return e.button === 0 && e.altKey
}

function onPointerDown(e) {
  if (e.button !== 0 && e.button !== 1) return
  stopCinematic()
  e.preventDefault()
  isDragging = true
  dragMode = wantsPointerZoom(e) ? 'zoom' : wantsPointerPan(e) ? 'pan' : 'orbit'
  lastPointer = { x: e.clientX, y: e.clientY }
  panGrabPoint = dragMode === 'pan' ? pointerOnTargetPlane(e) : null
  canvasRef.value.style.cursor = dragMode === 'zoom' ? 'ns-resize' : 'move'
  canvasRef.value.setPointerCapture(e.pointerId)
}
function onPointerMove(e) {
  if (!isDragging) return
  e.preventDefault()
  const dx = e.clientX - lastPointer.x
  const dy = e.clientY - lastPointer.y
  lastPointer = { x: e.clientX, y: e.clientY }
  if (dragMode === 'zoom') {
    distance = Math.max(10, Math.min(4000, distance * Math.exp(dy * 0.006)))
    updateCamera()
  } else if (dragMode === 'pan') {
    const hit = pointerOnTargetPlane(e)
    if (hit && panGrabPoint) {
      target.add(panGrabPoint.clone().sub(hit))
      updateCamera()
    } else {
      panFromScreenDelta(dx, dy)
    }
  } else {
    yaw -= dx * 0.006
    pitch = Math.max(0.05, Math.min(1.45, pitch + dy * 0.005))
    updateCamera()
  }
}
function onPointerUp(e) {
  isDragging = false
  dragMode = null
  panGrabPoint = null
  if (canvasRef.value) canvasRef.value.style.cursor = ''
  if (canvasRef.value.hasPointerCapture(e.pointerId)) {
    canvasRef.value.releasePointerCapture(e.pointerId)
  }
}
function preventCanvasAuxClick(e) {
  if (e.button === 1) e.preventDefault()
}
function onWheel(e) {
  stopCinematic()
  e.preventDefault()
  distance = Math.max(10, Math.min(4000, distance * (1 + e.deltaY * 0.001)))
  updateCamera()
}

function backTo2D() { stopCinematic(); state.viewMode = '2d' }

onMounted(async () => {
  try {
    THREE = await import('three')

    scene = new THREE.Scene()
    scene.background = new THREE.Color(0xcfe2f3)  // light sky blue
    scene.fog = new THREE.Fog(0xcfe2f3, 300, 3000)

    renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    camera = new THREE.PerspectiveCamera(45, 1, 0.5, 8000)
    target = new THREE.Vector3()

    const hemi = new THREE.HemisphereLight(0xffffff, 0xc0c8d0, 2.4)
    scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xffffff, 2.2)
    sun.position.set(80, 200, 60)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, { near: 0.5, far: 800, left: -300, right: 300, top: 300, bottom: -300 })
    scene.add(sun)

    // Load the mannequin GLB and normalize: 1.7 m tall, feet on y=0, neutral material.
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const loader = new GLTFLoader()
    await new Promise((resolve, reject) => {
      loader.load(
        modelUrl,
        async (gltf) => {
          let firstMesh = null
          gltf.scene.traverse((obj) => { if (!firstMesh && obj.isMesh) firstMesh = obj })
          if (!firstMesh) { reject(new Error('Model contains no mesh.')); return }
          gltf.scene.updateMatrixWorld(true)

          // gltfpack stores positions as Uint16 (KHR_mesh_quantization). To
          // apply the world matrix + our scale/translate without losing
          // precision (or clamping to the 0–65535 integer range), we bake
          // every vertex into a fresh Float32 attribute first.
          const srcPos = firstMesh.geometry.attributes.position
          const N = srcPos.count
          const buf = new Float32Array(N * 3)
          const v = new THREE.Vector3()
          for (let i = 0; i < N; i++) {
            v.fromBufferAttribute(srcPos, i)
            v.applyMatrix4(firstMesh.matrixWorld)
            buf[i * 3] = v.x
            buf[i * 3 + 1] = v.y
            buf[i * 3 + 2] = v.z
          }
          const geometry = new THREE.BufferGeometry()
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(buf, 3))
          if (firstMesh.geometry.index) {
            geometry.setIndex(firstMesh.geometry.index.clone())
          }

          // Normalize: 1.7 m tall, feet at y=0, centered horizontally
          const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position)
          const size = box.getSize(new THREE.Vector3())
          const scale = HUMAN_HEIGHT_M / Math.max(size.y, 0.001)
          const center = box.getCenter(new THREE.Vector3())
          geometry.translate(-center.x, -box.min.y, -center.z)
          geometry.scale(scale, scale, scale)
          geometry.computeVertexNormals()
          const material = new THREE.MeshStandardMaterial({ color: 0xf3f3f4, roughness: 0.65, metalness: 0 })
          baseModel = { geometry, material }

          // Low-poly LOD: the elliptical footprint extruded up to person
          // height — a vertical column with an oval cross-section matching
          // the shared standing footprint. Used for big crowds where the detailed mannequin would
          // be 5,344 tris × tens of thousands of instances. ~28 tris each; a
          // packed crowd reads as a forest of standing figures.
          const PERSON_H = HUMAN_HEIGHT_M
          const col = new THREE.CylinderGeometry(HUMAN_TOP_WIDTH_M / 2, HUMAN_TOP_WIDTH_M / 2, PERSON_H, 8, 1)
          col.scale(1, 1, HUMAN_TOP_DEPTH_M / HUMAN_TOP_WIDTH_M)
          col.translate(0, PERSON_H / 2, 0) // base (feet) at y=0
          col.computeVertexNormals()
          lowPolyModel = { geometry: col, material: material.clone() }

          const lowerH = HUMAN_HEIGHT_M * 0.47
          const upperH = HUMAN_HEIGHT_M * 0.36
          const waistOverlap = HUMAN_HEIGHT_M * 0.035

          const lower = new THREE.CylinderGeometry(
            HUMAN_TOP_WIDTH_M * 0.24,
            HUMAN_TOP_WIDTH_M * 0.20,
            lowerH,
            10,
            1
          )
          lower.scale(1, 1, HUMAN_TOP_DEPTH_M / HUMAN_TOP_WIDTH_M)
          lower.translate(0, lowerH / 2, 0)
          lower.computeVertexNormals()

          const upper = new THREE.CylinderGeometry(
            HUMAN_TOP_WIDTH_M * 0.36,
            HUMAN_TOP_WIDTH_M * 0.29,
            upperH,
            10,
            1
          )
          upper.scale(1, 1, HUMAN_TOP_DEPTH_M / HUMAN_TOP_WIDTH_M)
          upper.translate(0, lowerH - waistOverlap + upperH / 2, 0)
          upper.computeVertexNormals()

          const headR = HUMAN_TOP_WIDTH_M * 0.22
          const headY = HUMAN_HEIGHT_M - headR * 1.15
          const head = new THREE.SphereGeometry(headR, 10, 8)
          head.translate(0, headY, 0)
          head.computeVertexNormals()

          const hair = new THREE.SphereGeometry(headR * 1.03, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2)
          hair.translate(0, headY + headR * 0.04, 0)
          hair.computeVertexNormals()

          naturalModel = {
            upper: {
              geometry: upper,
              material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0 }),
            },
            lower: {
              geometry: lower,
              material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0 }),
            },
            head: {
              geometry: head,
              material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0 }),
            },
            hair: {
              geometry: hair,
              material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 }),
            },
          }
          resolve()
        },
        undefined,
        (err) => reject(err)
      )
    })

    canvasRef.value.addEventListener('pointerdown', onPointerDown)
    canvasRef.value.addEventListener('pointermove', onPointerMove)
    canvasRef.value.addEventListener('pointerup', onPointerUp)
    canvasRef.value.addEventListener('pointercancel', onPointerUp)
    canvasRef.value.addEventListener('auxclick', preventCanvasAuxClick)
    canvasRef.value.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)
    cleanupListeners = () => {
      canvasRef.value?.removeEventListener('pointerdown', onPointerDown)
      canvasRef.value?.removeEventListener('pointermove', onPointerMove)
      canvasRef.value?.removeEventListener('pointerup', onPointerUp)
      canvasRef.value?.removeEventListener('pointercancel', onPointerUp)
      canvasRef.value?.removeEventListener('auxclick', preventCanvasAuxClick)
      canvasRef.value?.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
    }
    ro = new ResizeObserver(() => { resize() })
    ro.observe(canvasRef.value)
    resize()
    // First mount needs to fetch buildings + tile floor for the initial bbox.
    rebuildScene._refetchExternals = true
    rebuildScene()

    loadingState.value = 'ready'

    const loop = () => {
      const nowMs = performance.now()
      updateCinematicCamera(nowMs)
      // Drive Google 3D Tiles streaming/LOD selection — without this the
      // tiles won't load further detail as the camera moves.
      if (googleTilesRenderer) {
        camera.updateMatrixWorld()
        googleTilesRenderer.group.updateMatrixWorld(true)
        googleTilesRenderer.setCamera(camera)
        googleTilesRenderer.setResolutionFromRenderer(camera, renderer)
        googleTilesRenderer.update()
        const hasGoogleGeometry = updateGoogleTileReadiness(nowMs)
        if (hasGoogleGeometry) prepareGoogleTileDepthOccluders()
        const stats = googleTilesRenderer.stats ?? {}
        // For placement, "final enough" means the currently visible tile set
        // and loaded geometry count have stopped changing. Cache/active stats
        // can churn after the view already has usable geometry, so including
        // them keeps the crowd hidden longer than necessary.
        const sig = `${stats.visible ?? 0}|${stats.loaded ?? 0}`
        if (sig !== googleTileStatsSignature) {
          googleTileStatsSignature = sig
          googleTileStatsLastChangedAtMs = performance.now()
          googleAnchorRefineUntilMs = Math.max(googleAnchorRefineUntilMs, performance.now() + 5000)
        }
        // Anchor mannequins onto Google's terrain. The function itself
        // gates on whether enough new tiles have streamed in to be worth
        // re-running (cheap when not).
        if (hasGoogleGeometry) anchorToGoogleGround()
      }
      updateNaturalIdleAnimation(nowMs)
      updateCrowdWaveAnimation(nowMs)
      renderSceneFrame()
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
  } catch (e) {
    loadingState.value = 'error'
    errorMsg.value = String(e?.message || e)
  }
})

// Structural changes (zone added/removed, vertex moved, obstruction edited)
// shift the centroid + bbox, so we DO need to re-fetch buildings and tiles.
watch(
  () => state.zones.map(z => ({
    id: z.id,
    vc: z.vertices.length,
    oc: z.obstructions?.length ?? 0,
    vertSig: z.vertices.flat().join(','),
    obSig: (z.obstructions ?? []).map(o => o.vertices.flat().join(',')).join('|'),
  })),
  () => { if (baseModel) { rebuildScene._refetchExternals = true; rebuildScene() } },
  { deep: true },
)

// Cosmetic / cheap changes (density slider, colour swatch, facing aim) —
// rebuild the people + polygon but DON'T re-fetch buildings or tiles. This
// keeps the Google scene from reloading when the user just drags density
// or picks a new focus point for the crowd.
watch(
  () => state.zones.map(z => [
    z.density,
    z.densityMode,
    JSON.stringify(z.densityGradient ?? null),
    z.color,
    z.facingPoint ? z.facingPoint.join(',') : '',
  ].join('|')),
  () => { if (baseModel) rebuildScene() },
)

// Colour-mode changes need a full instance rebuild so per-instance colours
// and, for natural mode, the procedural body/head meshes are re-written.
watch(() => state.peopleColorMode, () => { if (baseModel) rebuildScene() })

watch(() => state.googleHeight.resetNonce, () => {
  if (!baseModel) return
  resetGoogleHeightFromLoadedTiles()
})

// Re-fetch tile floor when the basemap (osm/satellite) or tile style
// (color/grayscale) is toggled.
watch(() => [state.basemap, state.tileStyle], () => { if (baseModel) rebuildTileFloor() })

// React to source/key changes — switching from OSM to Google (or back, or
// pasting a new key) re-runs the building load. We also hide the tile-floor
// when Google is active because Google's tiles include their own terrain.
watch(() => [state.buildingSource, state.googleMapsKey], ([source], [prevSource]) => {
  if (!baseModel) return
  if (source !== prevSource) {
    rebuildScene._refetchExternals = true
    rebuildScene()
    return
  }
  rebuildBuildings()
  syncTerrainLayerVisibility()
})

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  cleanupListeners?.()
  ro?.disconnect()
  if (buildingsAbort) buildingsAbort.abort()
  if (tilesAbort) tilesAbort.abort()
  if (groundGroup) disposeObject(groundGroup)
  if (buildingsGroup) disposeObject(buildingsGroup)
  if (tileFloor) {
    tileFloor.geometry.dispose()
    if (tileFloor.material.map) tileFloor.material.map.dispose()
    tileFloor.material.dispose()
  }
  disposeCrowdMeshes()
  if (baseModel) { baseModel.geometry.dispose(); baseModel.material.dispose() }
  if (lowPolyModel) { lowPolyModel.geometry.dispose(); lowPolyModel.material.dispose() }
  if (naturalModel) {
    for (const part of [naturalModel.upper, naturalModel.lower, naturalModel.head, naturalModel.hair]) {
      part.geometry.dispose()
      part.material.dispose()
    }
  }
  renderer?.dispose()
})
</script>

<template>
  <div class="absolute inset-0 bg-[#cfe2f3]">
    <canvas ref="canvasRef" class="block w-full h-full touch-none" />

    <!-- Loading / error overlay -->
    <div v-if="loadingState === 'loading'"
         class="absolute inset-0 flex items-center justify-center text-sm text-ink-700 bg-white/40 backdrop-blur-sm">
      Loading 3D scene…
    </div>
    <div v-else-if="loadingState === 'error'"
         class="absolute inset-0 flex items-center justify-center text-sm text-red-700 bg-white/80 px-6 text-center">
      3D view failed to load: {{ errorMsg }}
    </div>

    <!-- Navigation cluster — pan (WASD/arrows), rotate (QE/RF), zoom (+/-),
         and reset (Home). All buttons mirror the keyboard shortcuts.
         The collapsed button aligns with the shared SiteToolbar row. -->
    <button v-if="!controlsPanelOpen"
            type="button"
            class="absolute top-3 right-3 z-10 px-3 py-1.5 rounded-md shadow-md text-xs font-medium border bg-white text-ink-900 border-ink-100 hover:bg-ink-50"
            title="Open 3D camera controls"
            @click="controlsPanelOpen = true">
      3D controls
    </button>
    <div v-else class="absolute top-3 right-3 z-10 bg-white/95 rounded-md shadow-md border border-ink-100 p-1.5 text-xs text-ink-900 select-none">
      <div class="flex items-center justify-between gap-2 border-b border-ink-100 pb-1 mb-1">
        <span class="text-[9px] uppercase tracking-wide text-ink-700">3D controls</span>
        <button type="button"
                class="w-6 h-6 rounded text-ink-700 hover:bg-ink-100"
                title="Close 3D camera controls"
                @click="controlsPanelOpen = false">
          ×
        </button>
      </div>
      <!-- Pan d-pad -->
      <div class="grid grid-cols-3 gap-1 mb-1">
        <span></span>
        <button class="w-7 h-7 rounded hover:bg-ink-100" title="Pan forward (W / ↑)"  @click="panForward(1)">↑</button>
        <span></span>
        <button class="w-7 h-7 rounded hover:bg-ink-100" title="Pan left (A / ←)"     @click="panRight(-1)">←</button>
        <button class="w-7 h-7 rounded hover:bg-ink-100" title="Reset view (Home)"   @click="resetView">⌂</button>
        <button class="w-7 h-7 rounded hover:bg-ink-100" title="Pan right (D / →)"    @click="panRight(1)">→</button>
        <span></span>
        <button class="w-7 h-7 rounded hover:bg-ink-100" title="Pan back (S / ↓)"     @click="panForward(-1)">↓</button>
        <span></span>
      </div>
      <!-- Rotate row -->
      <div class="grid grid-cols-4 gap-1 mb-1">
        <button class="w-7 h-7 rounded hover:bg-ink-100" title="Rotate left (Q)"  @click="rotateYaw(-1)">↺</button>
        <button class="w-7 h-7 rounded hover:bg-ink-100" title="Tilt up (R)"      @click="rotatePitch(1)">▲</button>
        <button class="w-7 h-7 rounded hover:bg-ink-100" title="Tilt down (F)"    @click="rotatePitch(-1)">▼</button>
        <button class="w-7 h-7 rounded hover:bg-ink-100" title="Rotate right (E)" @click="rotateYaw(1)">↻</button>
      </div>
      <!-- Zoom row -->
      <div class="grid grid-cols-2 gap-1">
        <button class="w-7 h-7 rounded hover:bg-ink-100" title="Zoom in (+)"  @click="zoom(-1)">＋</button>
        <button class="w-7 h-7 rounded hover:bg-ink-100" title="Zoom out (−)" @click="zoom(1)">−</button>
      </div>
      <div class="text-[9px] text-ink-700 mt-1 text-center leading-tight">
        Keys: WASD<br>QE / RF / ±<br>Space/Shift drag pans<br>Alt drag zooms<br>H crowd wave
      </div>
      <div class="mt-1.5 border-t border-ink-100 pt-1.5">
        <div class="text-[9px] uppercase tracking-wide text-ink-700 text-center mb-1">Camera</div>
        <div class="grid grid-cols-3 gap-1">
          <button v-for="move in CINEMATIC_MOVES"
                  :key="move.value"
                  class="h-6 rounded px-1 text-[9px] font-medium whitespace-nowrap"
                  :class="cinematicMode === move.value ? 'bg-ink-900 text-white' : 'hover:bg-ink-100 text-ink-800'"
                  :title="move.title"
                  @click="toggleCinematic(move.value)">
            {{ move.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- Help banner if no zones -->
    <div v-if="loadingState === 'ready' && !state.zones.length"
         class="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-white/95 rounded-md shadow-md border border-ink-100 px-4 py-2 text-xs text-ink-700">
      No zones yet — switch back to 2D, draw a zone, then switch to 3D.
    </div>

    <!-- Headline panel -->
    <div v-if="loadingState === 'ready' && state.zones.length"
         class="absolute left-3 bottom-3 bg-white/95 rounded-md border border-ink-100 px-3 py-2 shadow-md text-xs">
      <div class="text-[10px] uppercase tracking-wide text-ink-700">3D site view</div>
      <div class="flex items-baseline gap-2 mt-1">
        <span class="text-lg font-bold tabular-nums">{{ headcountStr }}</span>
        <span class="text-ink-700">people</span>
      </div>
      <div class="text-ink-700 mt-0.5">over {{ areaStr }}</div>
      <div class="text-[10px] text-ink-700 mt-1">
        Rendering {{ personCount.toLocaleString() }}
        {{ personCount === 1 ? 'figure' : 'figures' }}
        <span v-if="personCount < totals.count">(representative subset; count above is exact)</span>
      </div>
    </div>

    <!-- Compact build-load status indicator. Source is now picked via the
         basemap dropdown in the top toolbar (osm/satellite → OSM buildings;
         google-* → Google Photorealistic 3D Tiles), so no separate toggle. -->
    <div class="absolute right-3 bottom-3 z-10 flex items-center gap-2">
      <div v-if="buildingsState === 'loading'"
           class="text-[10px] text-ink-700 bg-white/90 rounded px-2 py-1 shadow-sm">
        Loading {{ state.buildingSource === 'google' ? '3D tiles' : 'buildings' }}…
      </div>
      <div v-else-if="buildingsState === 'error'"
           class="text-[10px] text-red-700 bg-white/90 rounded px-2 py-1 shadow-sm max-w-xs">
        {{ buildingsError }}
      </div>
      <div v-else-if="buildingsState === 'ready' && state.buildingSource === 'google'"
           class="text-[10px] text-ink-700 bg-white/85 rounded px-2 py-1 shadow-sm">
        Google 3D Tiles<span v-if="googleTileMeshCount"> · {{ googleTileMeshCount.toLocaleString() }} meshes</span>
      </div>
      <div v-else-if="buildingsState === 'ready' && buildingsCount"
           class="text-[10px] text-ink-700 bg-white/85 rounded px-2 py-1 shadow-sm">
        {{ buildingsCount.toLocaleString() }} OSM buildings
      </div>
    </div>

  </div>
</template>
