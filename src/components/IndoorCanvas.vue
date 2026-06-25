<script setup>
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue'
import { useApp } from '../lib/state.js'
import { sampleInPolygon } from '../lib/sample.js'
import { distanceToMeters, distanceUnitLabel, metersToDisplay } from '../lib/units.js'

const { state, getSelectedZone } = useApp()
const selectedZone = computed(() => getSelectedZone())

const distanceInput = ref('10')
const distanceInputEl = ref(null)

// Same real-world size as outdoor people layer.
const PERSON_WIDTH_METERS = 0.6

// Cache of sampled people positions per zone. Re-sampled only when the zone's
// vertices, density, or the indoor calibration changes — not every animation
// frame. Keyed by zone id; value is { sig, points: [[x, y, rot], ...] } where
// (x, y) are image-pixel coordinates and rot is per-symbol rotation in radians.
let peopleCache = new Map()

function confirmDistance() {
  const cal = state.indoor.calibration
  if (!cal || cal.phase !== 'distance' || !cal.p1 || !cal.p2) return
  // distanceInput holds a value in the user's CURRENT display unit; convert to meters
  // before computing pixelsPerMeter (which is stored canonically in meters).
  const value = parseFloat(distanceInput.value)
  const meters = value > 0 ? distanceToMeters(value, state.units) : 0
  if (meters > 0) {
    const dx = cal.p2[0] - cal.p1[0], dy = cal.p2[1] - cal.p1[1]
    const px = Math.sqrt(dx * dx + dy * dy)
    state.indoor.pixelsPerMeter = px / meters
  }
  state.indoor.calibration = null
}

function cancelCalibration() {
  state.indoor.calibration = null
}

const wrap = ref(null)
const canvas = ref(null)
let ctx = null
let img = null
let imgNaturalSize = { w: 0, h: 0 }
let viewport = { scale: 1, ox: 0, oy: 0 }  // scale + offset for fitting image into canvas
let dragging = null  // { zoneId, vertexIdx } | { pan: true, startX, startY }
let raf = 0

function loadImage(url) {
  if (!url) { img = null; imgNaturalSize = { w: 0, h: 0 }; redraw(); return }
  const i = new Image()
  i.onload = () => {
    img = i
    imgNaturalSize = { w: i.naturalWidth, h: i.naturalHeight }
    fitImage()
    redraw()
  }
  i.src = url
}

function fitImage() {
  if (!img || !canvas.value) return
  const { clientWidth: cw, clientHeight: ch } = canvas.value
  const scale = Math.min(cw / imgNaturalSize.w, ch / imgNaturalSize.h, 1) * 0.95
  viewport.scale = scale
  viewport.ox = (cw - imgNaturalSize.w * scale) / 2
  viewport.oy = (ch - imgNaturalSize.h * scale) / 2
}

function screenToImage(x, y) {
  return [(x - viewport.ox) / viewport.scale, (y - viewport.oy) / viewport.scale]
}

function imageToScreen([x, y]) {
  return [x * viewport.scale + viewport.ox, y * viewport.scale + viewport.oy]
}

function redraw() {
  if (!ctx || !canvas.value) return
  const { clientWidth: cw, clientHeight: ch } = canvas.value
  if (canvas.value.width !== cw || canvas.value.height !== ch) {
    canvas.value.width = cw; canvas.value.height = ch
    fitImage()
  }
  ctx.clearRect(0, 0, cw, ch)
  ctx.fillStyle = '#f7f7f8'
  ctx.fillRect(0, 0, cw, ch)

  if (img) {
    ctx.drawImage(img, viewport.ox, viewport.oy, imgNaturalSize.w * viewport.scale, imgNaturalSize.h * viewport.scale)
  } else {
    ctx.fillStyle = '#3a3f4b'
    ctx.font = '14px ui-sans-serif, system-ui'
    ctx.textAlign = 'center'
    ctx.fillText('Upload a floor plan to begin (sidebar).', cw / 2, ch / 2)
    return
  }

  // Calibration points and line.
  const cal = state.indoor.calibration
  if (cal) {
    if (cal.p1) drawCross(cal.p1, '#dc2626')
    if (cal.p2) drawCross(cal.p2, '#dc2626')
    if (cal.p1 && cal.p2) {
      const [x1, y1] = imageToScreen(cal.p1)
      const [x2, y2] = imageToScreen(cal.p2)
      ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2; ctx.setLineDash([6, 4])
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // Zones (polygons in image-space pixels). Fill first, then people on top,
  // then the line + handles so vertices stay clickable.
  for (const z of state.zones) {
    if (z.vertices.length < 2) continue
    const pts = z.vertices.map(imageToScreen)
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
    if (z.vertices.length >= 3) ctx.closePath()
    if (z.vertices.length >= 3) {
      ctx.fillStyle = hexToRgba(z.color, z.id === state.selectedZoneId ? 0.18 : 0.10)
      ctx.fill()
    }
  }
  drawPeople()
  for (const z of state.zones) {
    if (z.vertices.length < 2) continue
    const pts = z.vertices.map(imageToScreen)
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
    if (z.vertices.length >= 3) ctx.closePath()
    ctx.strokeStyle = z.color
    ctx.lineWidth = z.id === state.selectedZoneId ? 3 : 2
    ctx.stroke()
    for (const p of pts) drawHandle(p, z.color)
  }
}

// Sample once per (zone vertices, density, scale) signature; cache result.
function ensurePeopleSampled() {
  const ppm = state.indoor.pixelsPerMeter
  if (!ppm) { peopleCache.clear(); return }
  for (const z of state.zones) {
    if (z.vertices.length < 3) { peopleCache.delete(z.id); continue }
    const sig = `${z.vertices.length}|${z.density}|${ppm}|${z.vertices.flat().join(',')}`
    const cached = peopleCache.get(z.id)
    if (cached && cached.sig === sig) continue
    // Compute polygon area in m², then target = area * density
    const polyM2 = polygonAreaImagePx(z.vertices) / (ppm * ppm)
    const target = polyM2 * z.density
    const pts = sampleInPolygon(z.vertices, target)
    const withRot = pts.map(p => [p[0], p[1], Math.random() * Math.PI * 2])
    peopleCache.set(z.id, { sig, points: withRot })
  }
}

function polygonAreaImagePx(verts) {
  let s = 0
  for (let i = 0; i < verts.length; i++) {
    const [x1, y1] = verts[i]
    const [x2, y2] = verts[(i + 1) % verts.length]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

function drawPeople() {
  const ppm = state.indoor.pixelsPerMeter
  if (!ppm) return
  ensurePeopleSampled()

  // Screen-space size for each person = 0.6 m × pixelsPerMeter × viewport.scale.
  const personImageW = PERSON_WIDTH_METERS * ppm  // image-px width per person
  const screenW = Math.max(2, personImageW * viewport.scale)
  const screenH = screenW * 0.55  // shoulders are flatter than wide
  const headR = screenW * 0.22

  // Two-pass: shoulders, then heads. Fewer style switches per draw.
  for (const z of state.zones) {
    const cached = peopleCache.get(z.id)
    if (!cached) continue
    ctx.fillStyle = '#374151'  // slate-700 shoulders
    for (const [ix, iy, rot] of cached.points) {
      const [sx, sy] = imageToScreen([ix, iy])
      ctx.save()
      ctx.translate(sx, sy)
      ctx.rotate(rot)
      ctx.beginPath()
      ctx.ellipse(0, 0, screenW / 2, screenH / 2, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    ctx.fillStyle = '#0f172a'  // slate-900 head
    for (const [ix, iy] of cached.points) {
      const [sx, sy] = imageToScreen([ix, iy])
      ctx.beginPath()
      ctx.arc(sx, sy, headR, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function drawCross([ix, iy], color) {
  const [x, y] = imageToScreen([ix, iy])
  ctx.strokeStyle = color; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6); ctx.stroke()
}

function drawHandle([x, y], color) {
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = color; ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
}

function hexToRgba(hex, a) {
  const v = hex.replace('#', '')
  const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

function findVertexAt(x, y) {
  for (const z of state.zones) {
    for (let i = 0; i < z.vertices.length; i++) {
      const [sx, sy] = imageToScreen(z.vertices[i])
      if ((x - sx) ** 2 + (y - sy) ** 2 < 100) return { zoneId: z.id, vertexIdx: i }
    }
  }
  return null
}

function onMouseDown(e) {
  const rect = canvas.value.getBoundingClientRect()
  const x = e.clientX - rect.left, y = e.clientY - rect.top

  // Calibration interception.
  const cal = state.indoor.calibration
  if (cal && cal.phase !== 'distance') {
    const ip = screenToImage(x, y)
    if (cal.phase === 'p1') { cal.p1 = ip; cal.phase = 'p2' }
    else if (cal.phase === 'p2') {
      cal.p2 = ip; cal.phase = 'distance'
      // demoDistance is stored canonically in meters. When the user has selected
      // imperial display, show the equivalent feet value (e.g. 46 m → 151 ft).
      const seed = cal.demoDistance != null ? cal.demoDistance : 10
      const display = metersToDisplay(seed, state.units)
      // Round to 1 decimal for ft (since 46 m = 150.92 ft), whole number for m.
      distanceInput.value = state.units === 'imperial'
        ? display.toFixed(0)
        : String(seed)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        distanceInputEl.value?.focus()
        distanceInputEl.value?.select()
      }))
    }
    redraw(); return
  }

  // Vertex drag has priority.
  const hit = findVertexAt(x, y)
  if (hit) {
    dragging = hit
    state.selectedZoneId = hit.zoneId
    return
  }

  // Drawing — add a vertex.
  if (state.drawing) {
    const z = selectedZone.value
    if (!z) return
    z.vertices.push(screenToImage(x, y))
    return
  }
}

function onMouseMove(e) {
  if (!dragging) return
  const rect = canvas.value.getBoundingClientRect()
  const x = e.clientX - rect.left, y = e.clientY - rect.top
  const z = state.zones.find(zz => zz.id === dragging.zoneId)
  if (!z) return
  z.vertices[dragging.vertexIdx] = screenToImage(x, y)
}

function onMouseUp() { dragging = null }

function onContextMenu(e) {
  e.preventDefault()
  const rect = canvas.value.getBoundingClientRect()
  const x = e.clientX - rect.left, y = e.clientY - rect.top
  const hit = findVertexAt(x, y)
  if (hit) {
    const z = state.zones.find(zz => zz.id === hit.zoneId)
    if (z) z.vertices.splice(hit.vertexIdx, 1)
  }
}

function tick() { redraw(); raf = requestAnimationFrame(tick) }

let ro
onMounted(() => {
  ctx = canvas.value.getContext('2d')
  ro = new ResizeObserver(() => { fitImage(); redraw() })
  ro.observe(wrap.value)
  loadImage(state.indoor.imageUrl)
  raf = requestAnimationFrame(tick)
})
onBeforeUnmount(() => { cancelAnimationFrame(raf); ro?.disconnect() })

watch(() => state.indoor.imageUrl, loadImage)
</script>

<template>
  <div ref="wrap" class="absolute inset-0">
    <canvas
      ref="canvas"
      class="absolute inset-0 w-full h-full"
      :style="{ cursor: state.drawing ? 'crosshair' : state.indoor.calibration ? 'crosshair' : 'default' }"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseUp"
      @contextmenu="onContextMenu" />

    <div class="absolute top-3 left-3 z-10 flex gap-2">
      <button
        class="px-3 py-1.5 rounded-md shadow-md text-xs font-medium border"
        :class="state.drawing
          ? 'bg-emerald-600 text-white border-emerald-700'
          : 'bg-white text-ink-900 border-ink-100 hover:bg-ink-50'"
        @click="state.drawing = !state.drawing">
        {{ state.drawing ? 'Drawing… (click canvas)' : 'Draw' }}
      </button>
    </div>

    <div v-if="state.indoor.imageUrl && !state.indoor.pixelsPerMeter && !state.indoor.calibration"
         class="absolute inset-x-0 bottom-20 mx-auto w-fit max-w-md px-4 py-2 bg-amber-50 border border-amber-200 text-amber-900 rounded shadow text-xs z-10">
      Calibrate the scale (sidebar) before drawing zones, or areas will read as 0&nbsp;m².
    </div>

    <!-- Inline distance input — replaces window.prompt which Chrome silently suppresses -->
    <div v-if="state.indoor.calibration?.phase === 'distance'"
         class="absolute inset-x-0 top-16 mx-auto w-fit max-w-md px-4 py-3 bg-white border border-ink-200 rounded-lg shadow-xl text-sm z-20 flex items-center gap-2">
      <label class="font-medium">Distance between points:</label>
      <input
        ref="distanceInputEl"
        v-model="distanceInput"
        type="number" step="0.1" min="0"
        class="w-20 px-2 py-1 border border-ink-200 rounded text-right tabular-nums"
        @keydown.enter.prevent="confirmDistance"
        @keydown.esc.prevent="cancelCalibration" />
      <span class="text-ink-700">{{ distanceUnitLabel(state.units) }}</span>
      <button class="ml-2 px-3 py-1 rounded bg-ink-900 text-white text-xs hover:bg-ink-700"
              @click="confirmDistance">Set scale</button>
      <button class="px-2 py-1 text-xs text-ink-700 hover:text-ink-900" @click="cancelCalibration">Cancel</button>
    </div>
  </div>
</template>
