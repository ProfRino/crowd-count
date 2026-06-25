<script setup>
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue'
import { useApp } from '../lib/state.js'
import { sampleInPolygonWithHoles } from '../lib/sample.js'
import { rebuildVertices } from '../lib/shapes.js'
import { distanceToMeters, distanceUnitLabel, metersToDisplay } from '../lib/units.js'

const {
  state, getSelectedZone, addZone, addObstruction, enterMode,
} = useApp()
const selectedZone = computed(() => getSelectedZone())

const distanceInput = ref('10')
const distanceInputEl = ref(null)

const PERSON_WIDTH_METERS = 0.6
let peopleCache = new Map()

function confirmDistance() {
  const cal = state.indoor.calibration
  if (!cal || cal.phase !== 'distance' || !cal.p1 || !cal.p2) return
  const value = parseFloat(distanceInput.value)
  const meters = value > 0 ? distanceToMeters(value, state.units) : 0
  if (meters > 0) {
    const dx = cal.p2[0] - cal.p1[0], dy = cal.p2[1] - cal.p1[1]
    const px = Math.sqrt(dx * dx + dy * dy)
    state.indoor.pixelsPerMeter = px / meters
  }
  state.indoor.calibration = null
}
function cancelCalibration() { state.indoor.calibration = null }

const wrap = ref(null)
const canvas = ref(null)
let ctx = null
let img = null
let imgNaturalSize = { w: 0, h: 0 }
let viewport = { scale: 1, ox: 0, oy: 0 }
let dragging = null
let raf = 0
let hatchPattern = null

function loadImage(url) {
  if (!url) { img = null; imgNaturalSize = { w: 0, h: 0 }; redraw(); return }
  const i = new Image()
  i.onload = () => {
    img = i
    imgNaturalSize = { w: i.naturalWidth, h: i.naturalHeight }
    fitImage(); redraw()
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
function screenToImage(x, y) { return [(x - viewport.ox) / viewport.scale, (y - viewport.oy) / viewport.scale] }
function imageToScreen([x, y]) { return [x * viewport.scale + viewport.ox, y * viewport.scale + viewport.oy] }

function buildHatchPattern() {
  const c = document.createElement('canvas')
  c.width = c.height = 12
  const cx = c.getContext('2d')
  cx.strokeStyle = 'rgba(15,23,42,0.45)'
  cx.lineWidth = 2
  cx.beginPath()
  for (let i = -12; i < 24; i += 5) { cx.moveTo(i, 0); cx.lineTo(i + 12, 12) }
  cx.stroke()
  return cx.createPattern ? null : null // pattern made on the live ctx below
}

function getHatchPattern() {
  if (hatchPattern) return hatchPattern
  const c = document.createElement('canvas')
  c.width = c.height = 12
  const cx = c.getContext('2d')
  cx.strokeStyle = 'rgba(15,23,42,0.45)'
  cx.lineWidth = 2
  cx.beginPath()
  for (let i = -12; i < 24; i += 5) { cx.moveTo(i, 0); cx.lineTo(i + 12, 12) }
  cx.stroke()
  hatchPattern = ctx.createPattern(c, 'repeat')
  return hatchPattern
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
    ctx.fillStyle = '#3a3f4b'; ctx.font = '14px ui-sans-serif, system-ui'; ctx.textAlign = 'center'
    ctx.fillText('Upload a floor plan to begin (sidebar).', cw / 2, ch / 2)
    return
  }

  // Calibration overlay
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

  // Pass 1: zone fills with evenodd (holes punch out automatically)
  for (const z of state.zones) {
    if (z.vertices.length < 3) continue
    const path = new Path2D()
    addRingToPath(path, z.vertices, true)
    for (const o of z.obstructions ?? []) {
      if (o.vertices.length >= 3) addRingToPath(path, o.vertices, false)
    }
    ctx.fillStyle = hexToRgba(z.color, z.id === state.selectedZoneId ? 0.18 : 0.10)
    ctx.fill(path, 'evenodd')
    // Overlay hatch on each obstruction
    for (const o of z.obstructions ?? []) {
      if (o.vertices.length < 3) continue
      const ph = new Path2D()
      addRingToPath(ph, o.vertices, true)
      ctx.fillStyle = getHatchPattern() || 'rgba(0,0,0,0.15)'
      ctx.fill(ph, 'evenodd')
    }
  }

  // Pass 2: people
  drawPeople()

  // Pass 3: zone outlines + handles
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
    // Polygon vertex handles only for polygon zones; circle/rect use specialized handles
    if (z.shape === 'polygon' || !z.shape) {
      for (const p of pts) drawHandle(p, z.color)
    } else if (z.shape === 'circle' && z.params) {
      drawHandle(imageToScreen(z.params.center), z.color)
      if (z.vertices.length) drawHandle(imageToScreen(z.vertices[0]), z.color)
    } else if (z.shape === 'rect' && z.params) {
      const [ax, ay] = z.params.a, [bx, by] = z.params.b
      const corners = [[ax, ay], [bx, ay], [bx, by], [ax, by]]
      for (const c of corners) drawHandle(imageToScreen(c), z.color)
    }
    // Obstruction outlines + handles (dashed)
    for (const o of z.obstructions ?? []) {
      if (o.vertices.length < 2) continue
      const opts = o.vertices.map(imageToScreen)
      ctx.beginPath()
      ctx.moveTo(opts[0][0], opts[0][1])
      for (let i = 1; i < opts.length; i++) ctx.lineTo(opts[i][0], opts[i][1])
      if (o.vertices.length >= 3) ctx.closePath()
      ctx.strokeStyle = z.color
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.stroke()
      ctx.setLineDash([])
      for (const p of opts) drawHandle(p, z.color)
    }
  }

  // Pass 4: ruler
  drawRuler()
}

function addRingToPath(path, verts, closeLast = true) {
  if (verts.length < 2) return
  const [x0, y0] = imageToScreen(verts[0])
  path.moveTo(x0, y0)
  for (let i = 1; i < verts.length; i++) {
    const [x, y] = imageToScreen(verts[i])
    path.lineTo(x, y)
  }
  if (closeLast) path.closePath()
}

function drawRuler() {
  if (!state.ruler.active) return
  ctx.strokeStyle = '#0284c7'
  ctx.lineWidth = 2
  ctx.setLineDash([4, 3])
  const pts = [...state.ruler.points]
  if (state.ruler.cursor && pts.length > 0) pts.push(state.ruler.cursor)
  if (pts.length >= 2) {
    ctx.beginPath()
    const [x0, y0] = imageToScreen(pts[0])
    ctx.moveTo(x0, y0)
    for (let i = 1; i < pts.length; i++) {
      const [x, y] = imageToScreen(pts[i])
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.setLineDash([])
  for (const p of state.ruler.points) {
    const [x, y] = imageToScreen(p)
    ctx.fillStyle = '#0284c7'
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
  }
}

function ensurePeopleSampled() {
  const ppm = state.indoor.pixelsPerMeter
  if (!ppm) { peopleCache.clear(); return }
  for (const z of state.zones) {
    // Suppress people for the in-progress zone (including obstruction
    // drawing in the same parent zone) until drawing is committed.
    if (state.drawing && z.id === state.selectedZoneId) {
      peopleCache.delete(z.id); continue
    }
    if (z.vertices.length < 3) { peopleCache.delete(z.id); continue }
    const holeStr = (z.obstructions ?? []).map(o => o.vertices.flat().join(',')).join('|')
    const sig = `${z.shape}|${z.density}|${ppm}|${JSON.stringify(z.params)}|${z.vertices.flat().join(',')}|${holeStr}`
    const cached = peopleCache.get(z.id)
    if (cached && cached.sig === sig) continue
    const polyM2 = polygonAreaImagePx(z.vertices) / (ppm * ppm)
    let netM2 = polyM2
    for (const o of z.obstructions ?? []) {
      netM2 -= polygonAreaImagePx(o.vertices) / (ppm * ppm)
    }
    netM2 = Math.max(0, netM2)
    const target = netM2 * z.density
    const holes = (z.obstructions ?? []).filter(o => o.vertices.length >= 3).map(o => o.vertices)
    const pts = sampleInPolygonWithHoles(z.vertices, holes, target)
    const withRot = pts.map(p => [p[0], p[1], Math.random() * Math.PI * 2])
    peopleCache.set(z.id, { sig, points: withRot })
  }
}

function polygonAreaImagePx(verts) {
  if (verts.length < 3) return 0
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
  const personImageW = PERSON_WIDTH_METERS * ppm
  const screenW = Math.max(2, personImageW * viewport.scale)
  const screenH = screenW * 0.55
  const headR = screenW * 0.22
  for (const z of state.zones) {
    const cached = peopleCache.get(z.id)
    if (!cached) continue
    ctx.fillStyle = '#374151'
    for (const [ix, iy, rot] of cached.points) {
      const [sx, sy] = imageToScreen([ix, iy])
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(rot)
      ctx.beginPath(); ctx.ellipse(0, 0, screenW / 2, screenH / 2, 0, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }
    ctx.fillStyle = '#0f172a'
    for (const [ix, iy] of cached.points) {
      const [sx, sy] = imageToScreen([ix, iy])
      ctx.beginPath(); ctx.arc(sx, sy, headR, 0, Math.PI * 2); ctx.fill()
    }
  }
}

function drawCross([ix, iy], color) {
  const [x, y] = imageToScreen([ix, iy])
  ctx.strokeStyle = color; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6); ctx.stroke()
}
function drawHandle([x, y], color) {
  ctx.fillStyle = '#fff'; ctx.strokeStyle = color; ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
}
function hexToRgba(hex, a) {
  const v = hex.replace('#', '')
  const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

// Hit-test: returns { kind, zoneId, ... } in image-pixel space, screen radius 10.
function findHandleAt(x, y) {
  for (const z of state.zones) {
    if (z.shape === 'circle' && z.params) {
      const cs = imageToScreen(z.params.center)
      if ((x - cs[0]) ** 2 + (y - cs[1]) ** 2 < 100) return { kind: 'center', zoneId: z.id }
      if (z.vertices.length) {
        const rs = imageToScreen(z.vertices[0])
        if ((x - rs[0]) ** 2 + (y - rs[1]) ** 2 < 100) return { kind: 'radius', zoneId: z.id }
      }
    } else if (z.shape === 'rect' && z.params) {
      const [ax, ay] = z.params.a, [bx, by] = z.params.b
      const corners = [[ax, ay], [bx, ay], [bx, by], [ax, by]]
      for (let i = 0; i < 4; i++) {
        const cs = imageToScreen(corners[i])
        if ((x - cs[0]) ** 2 + (y - cs[1]) ** 2 < 100) return { kind: 'corner', zoneId: z.id, cornerIdx: i }
      }
    } else {
      for (let i = 0; i < z.vertices.length; i++) {
        const [sx, sy] = imageToScreen(z.vertices[i])
        if ((x - sx) ** 2 + (y - sy) ** 2 < 100) return { kind: 'vertex', zoneId: z.id, vertexIdx: i }
      }
    }
    for (const o of z.obstructions ?? []) {
      for (let i = 0; i < o.vertices.length; i++) {
        const [sx, sy] = imageToScreen(o.vertices[i])
        if ((x - sx) ** 2 + (y - sy) ** 2 < 100) return { kind: 'obstruction-vertex', zoneId: z.id, obstructionId: o.id, vertexIdx: i }
      }
    }
  }
  return null
}

function pointInRing([px, py], verts) {
  let inside = false
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const [xi, yi] = verts[i], [xj, yj] = verts[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function onMouseDown(e) {
  const rect = canvas.value.getBoundingClientRect()
  const x = e.clientX - rect.left, y = e.clientY - rect.top
  const ip = screenToImage(x, y)

  // Ruler — click adds a point
  if (state.ruler.active) {
    state.ruler.points.push(ip)
    return
  }

  // 3. Calibration
  const cal = state.indoor.calibration
  if (cal && cal.phase !== 'distance') {
    if (cal.phase === 'p1') { cal.p1 = ip; cal.phase = 'p2' }
    else if (cal.phase === 'p2') {
      cal.p2 = ip; cal.phase = 'distance'
      const seed = cal.demoDistance != null ? cal.demoDistance : 10
      const display = metersToDisplay(seed, state.units)
      distanceInput.value = state.units === 'imperial' ? display.toFixed(0) : String(seed)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        distanceInputEl.value?.focus(); distanceInputEl.value?.select()
      }))
    }
    return
  }

  // 4. Handle drag
  const hit = findHandleAt(x, y)
  if (hit) {
    dragging = hit
    state.selectedZoneId = hit.zoneId
    return
  }

  // 5. Drawing
  if (state.drawing === 'obstruction') {
    const z = selectedZone.value
    if (!z) return
    const o = z.obstructions.find(oo => oo.id === state.activeObstructionId)
    if (!o) return
    if (!pointInRing(ip, z.vertices)) return
    o.vertices.push(ip)
    return
  }
  if (state.drawing === 'zone') {
    const z = selectedZone.value
    if (!z) return
    if (z.shape === 'polygon' || !z.shape) {
      z.vertices.push(ip)
    } else if (z.shape === 'circle') {
      if (!z.params) {
        z.params = { kind: 'circle', center: ip, radiusM: 0, segments: 64 }
      } else {
        const dx = ip[0] - z.params.center[0], dy = ip[1] - z.params.center[1]
        const ppm = state.indoor.pixelsPerMeter || 1
        z.params.radiusM = Math.sqrt(dx * dx + dy * dy) / ppm
        rebuildVertices(z, { mode: state.mode, pixelsPerMeter: ppm })
        state.drawing = false
      }
    } else if (z.shape === 'rect') {
      if (!z.params) {
        z.params = { kind: 'rect', a: ip, b: ip }
      } else {
        z.params.b = ip
        rebuildVertices(z, { mode: state.mode, pixelsPerMeter: state.indoor.pixelsPerMeter })
        state.drawing = false
      }
    }
  }
}

function onMouseMove(e) {
  const rect = canvas.value.getBoundingClientRect()
  const x = e.clientX - rect.left, y = e.clientY - rect.top
  const ip = screenToImage(x, y)

  if (state.ruler.active) {
    state.ruler.cursor = ip
  }

  if (state.drawing === 'zone' && selectedZone.value && !dragging) {
    const z = selectedZone.value
    if (z.shape === 'circle' && z.params) {
      const dx = ip[0] - z.params.center[0], dy = ip[1] - z.params.center[1]
      const ppm = state.indoor.pixelsPerMeter || 1
      z.params.radiusM = Math.sqrt(dx * dx + dy * dy) / ppm
    } else if (z.shape === 'rect' && z.params) {
      z.params.b = ip
    }
  }

  if (!dragging) return
  const z = state.zones.find(zz => zz.id === dragging.zoneId)
  if (!z) return
  if (dragging.kind === 'vertex') z.vertices[dragging.vertexIdx] = ip
  else if (dragging.kind === 'obstruction-vertex') {
    const o = z.obstructions.find(oo => oo.id === dragging.obstructionId)
    if (o) o.vertices[dragging.vertexIdx] = ip
  } else if (dragging.kind === 'center') {
    if (z.params) z.params.center = ip
  } else if (dragging.kind === 'radius') {
    if (z.params) {
      const dx = ip[0] - z.params.center[0], dy = ip[1] - z.params.center[1]
      const ppm = state.indoor.pixelsPerMeter || 1
      z.params.radiusM = Math.sqrt(dx * dx + dy * dy) / ppm
    }
  } else if (dragging.kind === 'corner') {
    if (z.params) {
      const idx = dragging.cornerIdx
      if (idx === 0) z.params.a = ip
      else if (idx === 1) { z.params.b[0] = ip[0]; z.params.a[1] = ip[1] }
      else if (idx === 2) z.params.b = ip
      else if (idx === 3) { z.params.a[0] = ip[0]; z.params.b[1] = ip[1] }
    }
  }
}

function onMouseUp() {
  dragging = null
}

function onContextMenu(e) {
  e.preventDefault()
  if (state.ruler.active) return
  const rect = canvas.value.getBoundingClientRect()
  const x = e.clientX - rect.left, y = e.clientY - rect.top
  const hit = findHandleAt(x, y)
  if (!hit) return
  const z = state.zones.find(zz => zz.id === hit.zoneId)
  if (!z) return
  if (hit.kind === 'vertex') z.vertices.splice(hit.vertexIdx, 1)
  else if (hit.kind === 'obstruction-vertex') {
    const o = z.obstructions.find(oo => oo.id === hit.obstructionId)
    if (o) {
      o.vertices.splice(hit.vertexIdx, 1)
      if (!o.vertices.length) {
        const i = z.obstructions.findIndex(oo => oo.id === o.id)
        if (i !== -1) z.obstructions.splice(i, 1)
      }
    }
  }
}

function onDblClick(e) {
  if (state.ruler.active) {
    e.preventDefault()
    state.ruler.cursor = null
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

// Toolbar handlers
function startZoneDrawing() {
  let z = selectedZone.value
  if (!z || z.vertices.length > 0 || z.shape !== state.drawTool) {
    z = addZone(null, state.drawTool)
  }
  enterMode('drawing')
}
function startObstructionDrawing() {
  const z = selectedZone.value
  if (!z || z.vertices.length < 3) return
  addObstruction(z.id)
}
function startRuler() {
  enterMode('ruler')
}
function onShapePick(shape) {
  state.drawTool = shape
  const z = selectedZone.value
  if (z && z.shape !== shape && z.vertices.length === 0 && !z.params) {
    z.shape = shape
    z.params = null
  }
}
</script>

<template>
  <div ref="wrap" class="absolute inset-0">
    <canvas
      ref="canvas"
      class="absolute inset-0 w-full h-full"
      :style="{ cursor: (state.drawing || state.indoor.calibration || state.ruler.active) ? 'crosshair' : 'default' }"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseUp"
      @contextmenu="onContextMenu"
      @dblclick="onDblClick" />

    <div class="absolute top-3 left-3 z-10 flex flex-col gap-2 items-start">
      <!-- Top row: Draw zone, Draw obstruction, Ruler -->
      <div class="flex gap-2 flex-wrap">
        <button class="px-3 py-1.5 rounded-md shadow-md text-xs font-medium border"
                :class="state.drawing === 'zone' ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white text-ink-900 border-ink-100 hover:bg-ink-50'"
                @click="state.drawing === 'zone' ? enterMode(null) : startZoneDrawing()">
          {{ state.drawing === 'zone' ? 'Drawing… (click canvas)' : 'Draw zone' }}
        </button>
        <button class="px-3 py-1.5 rounded-md shadow-md text-xs font-medium border"
                :disabled="!selectedZone || selectedZone.vertices.length < 3"
                :class="state.drawing === 'obstruction'
                  ? 'bg-amber-600 text-white border-amber-700'
                  : (!selectedZone || selectedZone.vertices.length < 3)
                    ? 'bg-white text-ink-200 border-ink-100 cursor-not-allowed'
                    : 'bg-white text-ink-900 border-ink-100 hover:bg-ink-50'"
                @click="state.drawing === 'obstruction' ? enterMode(null) : startObstructionDrawing()">
          {{ state.drawing === 'obstruction' ? 'Drawing obstruction… (click inside the zone)' : 'Draw obstruction' }}
        </button>
        <button class="px-3 py-1.5 rounded-md shadow-md text-xs font-medium border"
                :class="state.ruler.active ? 'bg-sky-600 text-white border-sky-700' : !state.indoor.pixelsPerMeter ? 'bg-white text-ink-200 border-ink-100 cursor-not-allowed' : 'bg-white text-ink-900 border-ink-100 hover:bg-ink-50'"
                :disabled="!state.indoor.pixelsPerMeter"
                :title="!state.indoor.pixelsPerMeter ? 'Calibrate scale first' : 'Measure distance'"
                @click="state.ruler.active ? enterMode(null) : startRuler()">
          📏 {{ state.ruler.active ? 'Ruler on' : 'Ruler' }}
        </button>
      </div>
      <!-- Shape pill — only while drawing a zone -->
      <div v-if="state.drawing === 'zone'"
           class="bg-white rounded-md shadow-md border border-ink-100 flex overflow-hidden text-xs">
        <button v-for="opt in [['polygon','▱'],['circle','◯'],['rect','▭']]" :key="opt[0]"
                class="px-2 py-1.5"
                :class="state.drawTool === opt[0] ? 'bg-ink-900 text-white' : 'text-ink-900 hover:bg-ink-50'"
                @click="onShapePick(opt[0])">
          {{ opt[1] }} {{ opt[0][0].toUpperCase() + opt[0].slice(1) }}
        </button>
      </div>
    </div>

    <div v-if="state.indoor.imageUrl && !state.indoor.pixelsPerMeter && !state.indoor.calibration"
         class="absolute inset-x-0 bottom-20 mx-auto w-fit max-w-md px-4 py-2 bg-amber-50 border border-amber-200 text-amber-900 rounded shadow text-xs z-10">
      Calibrate the scale (sidebar) before drawing zones, or areas will read as 0&nbsp;m².
    </div>

    <!-- Helper banner during obstruction drawing -->
    <div v-if="state.drawing === 'obstruction'"
         class="absolute inset-x-0 top-32 mx-auto w-fit max-w-md px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg shadow text-xs text-amber-900 z-10 pointer-events-none">
      <strong>Click inside the selected zone</strong> to drop polygon vertices.
      Obstructions are always polygons. Right-click a vertex to delete it,
      Ctrl+Z to undo, Esc to finish.
    </div>

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
