<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  density: { type: Number, default: 1.5 },
  zoneName: { type: String, default: '' },
})
const emit = defineEmits(['close'])

// The reference layouts are integer 1..6. We round the zone's density to the
// nearest preset and clamp into range. The modal also has its own 1..6 buttons.
function nearestPreset(d) {
  return Math.max(1, Math.min(6, Math.round(d)))
}

const selectedDensity = ref(nearestPreset(props.density))
const mode = ref('single')           // 'single' | 'compare'
const canvasRef = ref(null)
const isLoading = ref(true)

const statusLabels = {
  1: 'open spacing',
  2: 'loose crowd',
  3: 'restricted movement',
  4: 'very tight',
  5: 'packed',
  6: 'critical density',
}
const densityColorsHex = {
  1: 0x0047ff, 2: 0x4f8cff, 3: 0xb7791f,
  4: 0xc05621, 5: 0xb91c1c, 6: 0x7f1d1d,
}

const sampleSideMeters = 2
const sampleHalfMeters = 1

const headline = computed(() => mode.value === 'compare' ? '1–6' : String(selectedDensity.value))
const peopleInOneM = computed(() => mode.value === 'compare' ? '1–6' : String(selectedDensity.value))
const spaceEach = computed(() =>
  mode.value === 'compare' ? 'varies' : `${(1 / selectedDensity.value).toFixed(2)} m²`)
const peopleIn25 = computed(() =>
  mode.value === 'compare' ? '25–150' : String(selectedDensity.value * 25))
const statusText = computed(() =>
  mode.value === 'compare' ? 'density comparison' : statusLabels[selectedDensity.value])
const statusColor = computed(() => {
  if (mode.value === 'compare') return '#0034b5'
  if (selectedDensity.value >= 5) return '#b91c1c'
  if (selectedDensity.value >= 3) return '#b7791f'
  return '#0034b5'
})

let THREE = null
let scene = null
let camera = null
let renderer = null
let contentRoot = null
let target = null
let yaw = -0.72
let pitch = 0.78
let distance = 4.2
let isDragging = false
let lastPointer = { x: 0, y: 0 }
let placements = {}
let rafId = null
let ro = null
let cleanupListeners = null

function colorToCss(c) { return `#${c.toString(16).padStart(6, '0')}` }

function rowZPositions(rowCount) {
  if (rowCount === 2) return [-0.5, 0.5]
  if (rowCount === 4) return [-0.72, -0.24, 0.24, 0.72]
  if (rowCount === 5) return [-0.78, -0.39, 0, 0.39, 0.78]
  return [-0.82, -0.49, -0.16, 0.16, 0.49, 0.82]
}
function xPositions(count, density) {
  if (count === 2) return [-0.52, 0.52]
  if (count === 3) return [-0.58, 0, 0.58]
  return density >= 5
    ? [-0.57, -0.19, 0.19, 0.57]
    : [-0.66, -0.22, 0.22, 0.66]
}
function createReferenceLayout(density) {
  if (density === 2) return [
    [-0.58,-0.74],[0.28,-0.74],[-0.12,-0.25],[0.68,-0.25],
    [-0.58,0.24],[0.28,0.24],[-0.12,0.73],[0.68,0.73],
  ]
  if (density === 3) return [
    [-0.54,-0.78],[0.30,-0.78],[-0.78,-0.39],[-0.08,-0.39],[0.62,-0.39],
    [-0.42,0],[0.42,0],[-0.70,0.39],[0,0.39],[0.70,0.39],
    [-0.30,0.78],[0.54,0.78],
  ]
  if (density === 4) return [
    [-0.62,-0.84],[0,-0.84],[0.62,-0.84],[-0.31,-0.51],[0.31,-0.51],
    [-0.62,-0.18],[0,-0.18],[0.62,-0.18],[-0.50,0.15],[0,0.15],[0.50,0.15],
    [-0.62,0.48],[0,0.48],[0.62,0.48],[-0.31,0.81],[0.31,0.81],
  ]
  if (density === 5) return [
    [-0.62,-0.84],[0,-0.84],[0.62,-0.84],
    [-0.78,-0.52],[-0.28,-0.52],[0.22,-0.52],[0.72,-0.52],
    [-0.50,-0.19],[0,-0.19],[0.50,-0.19],
    [-0.72,0.14],[-0.22,0.14],[0.28,0.14],[0.78,0.14],
    [-0.62,0.47],[-0.05,0.47],[0.52,0.47],
    [-0.32,0.80],[0.22,0.80],[0.76,0.80],
  ]
  if (density === 6) return [
    [-0.58,-0.86],[0,-0.86],[0.58,-0.86],
    [-0.76,-0.53],[-0.25,-0.53],[0.25,-0.53],[0.76,-0.53],
    [-0.82,-0.20],[-0.41,-0.20],[0,-0.20],[0.41,-0.20],[0.82,-0.20],
    [-0.64,0.13],[-0.18,0.13],[0.28,0.13],[0.74,0.13],
    [-0.82,0.46],[-0.41,0.46],[0,0.46],[0.41,0.46],[0.82,0.46],
    [-0.58,0.79],[0,0.79],[0.58,0.79],
  ]
  const rowCounts = { 1: [2, 2] }[density]
  const zRows = rowZPositions(rowCounts.length)
  return rowCounts.flatMap((count, rowIndex) => {
    const stagger = 0
    return xPositions(count, density).map((x) => [x + stagger, zRows[rowIndex]])
  })
}

function createHumanMaterials(color) {
  const c = new THREE.Color(color)
  return {
    shirt: new THREE.MeshStandardMaterial({ color: c, roughness: 0.64 }),
    pants: new THREE.MeshStandardMaterial({ color: 0x273444, roughness: 0.7 }),
    skin:  new THREE.MeshStandardMaterial({ color: 0xd5a77a, roughness: 0.58 }),
    shoe:  new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 }),
  }
}

function createPerson(materials, index, density) {
  const g = new THREE.Group()
  const slim = 1
  const heightJitter = 0.94 + ((index % 3) * 0.03)
  const shoulderWidth = density >= 4 ? 0.34 : 0.32
  const bodyDepth = density >= 5 ? 0.095 : 0.105

  const chest = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), materials.shirt)
  chest.scale.set(0.145 * slim, 0.205 * heightJitter, bodyDepth)
  chest.position.y = 0.86 * heightJitter
  chest.castShadow = true; g.add(chest)

  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), materials.shirt)
  abdomen.scale.set(0.112 * slim, 0.155 * heightJitter, bodyDepth * 0.88)
  abdomen.position.y = 0.67 * heightJitter
  abdomen.castShadow = true; g.add(abdomen)

  const shoulders = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.034, shoulderWidth - 0.068, 7, 12),
    materials.shirt
  )
  shoulders.rotation.z = Math.PI / 2
  shoulders.position.y = 0.995 * heightJitter
  shoulders.position.z = 0.006
  shoulders.castShadow = true; g.add(shoulders)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.092 * slim, 18, 14), materials.skin)
  head.position.y = 1.18 * heightJitter
  head.castShadow = true; g.add(head)

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.025 * slim, 10, 8), materials.skin)
  nose.position.set(0, 1.175 * heightJitter, 0.088)
  nose.castShadow = true; g.add(nose)

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.034 * slim, 0.04 * slim, 0.08, 12), materials.skin)
  neck.position.y = 1.05 * heightJitter
  neck.castShadow = true; g.add(neck)

  const hip = new THREE.Mesh(new THREE.CylinderGeometry(0.103 * slim, 0.092 * slim, 0.11, 14), materials.pants)
  hip.position.y = 0.56 * heightJitter
  hip.castShadow = true; g.add(hip)

  const armOffset = shoulderWidth / 2 + 0.006
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.026 * slim, 0.37 * heightJitter, 5, 8), materials.skin)
    arm.position.set(side * armOffset, 0.79 * heightJitter, 0.006)
    arm.rotation.z = side * 0.13
    arm.castShadow = true; g.add(arm)

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.031 * slim, 0.43 * heightJitter, 5, 8), materials.pants)
    leg.position.set(side * 0.045 * slim, 0.31 * heightJitter, 0)
    leg.castShadow = true; g.add(leg)

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.073 * slim, 0.035, 0.12), materials.shoe)
    shoe.position.set(side * 0.045 * slim, 0.08 * heightJitter, 0.025)
    shoe.castShadow = true; g.add(shoe)
  }
  return g
}

function createSquareOutline(halfSize, color, lift) {
  const points = [
    new THREE.Vector3(-halfSize, lift, -halfSize),
    new THREE.Vector3( halfSize, lift, -halfSize),
    new THREE.Vector3( halfSize, lift,  halfSize),
    new THREE.Vector3(-halfSize, lift,  halfSize),
    new THREE.Vector3(-halfSize, lift, -halfSize),
  ]
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }))
}

function createGridLines(halfSize, step) {
  const group = new THREE.Group()
  const minorPoints = []
  const majorPoints = []
  const epsilon = 0.0001
  for (let v = -halfSize + step; v < halfSize - epsilon; v += step) {
    const target = Math.abs(v) < epsilon || Math.abs(Math.abs(v) - 0.5) < epsilon ? majorPoints : minorPoints
    target.push(new THREE.Vector3(v, 0.015, -halfSize), new THREE.Vector3(v, 0.015, halfSize))
    target.push(new THREE.Vector3(-halfSize, 0.015, v), new THREE.Vector3(halfSize, 0.015, v))
  }
  if (minorPoints.length) {
    const g = new THREE.BufferGeometry().setFromPoints(minorPoints)
    group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9aa8b5, transparent: true, opacity: 0.32 })))
  }
  if (majorPoints.length) {
    const g = new THREE.BufferGeometry().setFromPoints(majorPoints)
    group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x6b7785, transparent: true, opacity: 0.58 })))
  }
  return group
}

function createLowFence(halfSize, color) {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
  const postGeometry = new THREE.CylinderGeometry(0.014, 0.014, 0.18, 8)
  for (const [x, z] of [[-halfSize, -halfSize], [halfSize, -halfSize], [halfSize, halfSize], [-halfSize, halfSize]]) {
    const post = new THREE.Mesh(postGeometry, material)
    post.position.set(x, 0.09, z)
    post.castShadow = true
    group.add(post)
  }
  return group
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function createTextSprite(text, position, size, color, weight) {
  const scale = 2
  const c = document.createElement('canvas')
  c.width = 1024; c.height = 256
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)'
  roundRect(ctx, 20, 34, 984, 188, 28); ctx.fill()
  ctx.strokeStyle = 'rgba(31, 41, 51, 0.12)'; ctx.lineWidth = 3
  roundRect(ctx, 20, 34, 984, 188, 28); ctx.stroke()
  ctx.fillStyle = color
  ctx.font = `${weight || '700'} ${Math.floor(62 * scale)}px Arial, Helvetica, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, 512, 128)
  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(material)
  sprite.position.copy(position)
  sprite.scale.set(size * 2.6, size * 0.65, 1)
  return sprite
}

function createDensityTile(density, x, z, expanded) {
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  const tileMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.78, metalness: 0,
    transparent: true, opacity: 0.96,
  })
  const tile = new THREE.Mesh(new THREE.PlaneGeometry(sampleSideMeters, sampleSideMeters), tileMaterial)
  tile.rotation.x = -Math.PI / 2
  tile.receiveShadow = true
  group.add(tile)
  group.add(createSquareOutline(sampleHalfMeters, densityColorsHex[density], 0.018))
  group.add(createGridLines(sampleHalfMeters, expanded ? 0.25 : 0.5))
  const mats = createHumanMaterials(densityColorsHex[density])
  placements[density].forEach(([px, pz], index) => {
    const person = createPerson(mats, index, density)
    person.position.set(px, 0, pz)
    group.add(person)
  })
  if (expanded) group.add(createLowFence(sampleHalfMeters, densityColorsHex[density]))
  return group
}

function buildSingleScene(root, density) { root.add(createDensityTile(density, 0, 0, true)) }

function buildCompareScene(root) {
  const w = canvasRef.value?.clientWidth ?? 800
  const isNarrow = w < 740
  const columns = isNarrow ? 2 : 3
  const rows = Math.ceil(6 / columns)
  const spacingX = isNarrow ? 2.75 : 3.2
  const spacingZ = isNarrow ? 2.65 : 3.05
  for (let d = 1; d <= 6; d += 1) {
    const col = (d - 1) % columns
    const row = Math.floor((d - 1) / columns)
    const x = (col - ((columns - 1) / 2)) * spacingX
    const z = (row - ((rows - 1) / 2)) * spacingZ
    root.add(createDensityTile(d, x, z, false))
    root.add(createTextSprite(`${d}/m²`, new THREE.Vector3(x, 1.52, z - sampleHalfMeters - 0.34), 0.48, colorToCss(densityColorsHex[d]), '800'))
  }
}

function disposeObject(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose()
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose() })
    }
  })
}

function updateCamera() {
  const horizontal = Math.cos(pitch) * distance
  const x = target.x + Math.sin(yaw) * horizontal
  const z = target.z + Math.cos(yaw) * horizontal
  const y = target.y + Math.sin(pitch) * distance
  camera.position.set(x, y, z)
  camera.lookAt(target)
}

function resetCamera() {
  const w = canvasRef.value?.clientWidth ?? 800
  if (mode.value === 'compare') {
    yaw = w < 740 ? 0 : -0.54
    pitch = w < 740 ? 1.1 : 1.02
    distance = w < 740 ? 13.5 : 13.4
  } else {
    yaw = -0.72
    pitch = 0.92
    distance = w < 740 ? 8.2 : 7.2
  }
  updateCamera()
}

function resize() {
  if (!canvasRef.value || !renderer || !camera) return
  const w = canvasRef.value.clientWidth
  const h = canvasRef.value.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

function renderDensityScene() {
  if (!scene) return
  if (contentRoot) {
    scene.remove(contentRoot)
    disposeObject(contentRoot)
  }
  contentRoot = new THREE.Group()
  scene.add(contentRoot)
  if (mode.value === 'compare') {
    buildCompareScene(contentRoot)
    target.set(0, 0.55, 0.1)
  } else {
    buildSingleScene(contentRoot, selectedDensity.value)
    target.set(0, 0.55, 0)
  }
  resetCamera()
}

function pickDensity(d) {
  selectedDensity.value = d
  mode.value = 'single'
  renderDensityScene()
}
function pickMode(m) {
  mode.value = m
  renderDensityScene()
}

function onPointerDown(e) {
  isDragging = true
  lastPointer = { x: e.clientX, y: e.clientY }
  canvasRef.value.setPointerCapture(e.pointerId)
}
function onPointerMove(e) {
  if (!isDragging) return
  const dx = e.clientX - lastPointer.x
  const dy = e.clientY - lastPointer.y
  lastPointer = { x: e.clientX, y: e.clientY }
  yaw -= dx * 0.006
  pitch = Math.max(0.26, Math.min(1.24, pitch + dy * 0.0045))
  updateCamera()
}
function onPointerUp(e) {
  isDragging = false
  if (canvasRef.value.hasPointerCapture(e.pointerId)) {
    canvasRef.value.releasePointerCapture(e.pointerId)
  }
}
function onWheel(e) {
  e.preventDefault()
  const next = distance + e.deltaY * 0.004
  distance = Math.max(mode.value === 'compare' ? 4.6 : 2.6, Math.min(mode.value === 'compare' ? 10 : 7, next))
  updateCamera()
}
function onKey(e) {
  if (e.key === 'Escape') emit('close')
}

onMounted(async () => {
  THREE = await import('three')
  isLoading.value = false

  for (let d = 1; d <= 6; d += 1) placements[d] = createReferenceLayout(d)

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xeef2f5)

  renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
  target = new THREE.Vector3(0, 0.45, 0)

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a95a3, 2.5)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xffffff, 2.5)
  sun.position.set(4.5, 7, 3.2)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { near: 0.5, far: 18, left: -8, right: 8, top: 8, bottom: -8 })
  scene.add(sun)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 12),
    new THREE.MeshStandardMaterial({ color: 0xe2e8ee, roughness: 0.9, metalness: 0 })
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.012
  ground.receiveShadow = true
  scene.add(ground)

  canvasRef.value.addEventListener('pointerdown', onPointerDown)
  canvasRef.value.addEventListener('pointermove', onPointerMove)
  canvasRef.value.addEventListener('pointerup',   onPointerUp)
  canvasRef.value.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('keydown', onKey)
  cleanupListeners = () => {
    canvasRef.value?.removeEventListener('pointerdown', onPointerDown)
    canvasRef.value?.removeEventListener('pointermove', onPointerMove)
    canvasRef.value?.removeEventListener('pointerup',   onPointerUp)
    canvasRef.value?.removeEventListener('wheel', onWheel)
    window.removeEventListener('keydown', onKey)
  }

  ro = new ResizeObserver(() => { resize(); updateCamera() })
  ro.observe(canvasRef.value)

  resize()
  renderDensityScene()

  const loop = (t) => {
    if (contentRoot) {
      contentRoot.traverse((child) => {
        if (child.isGroup && child.children.length > 4 && child.position.y === 0) {
          child.position.y = Math.sin(t * 0.0012 + child.position.x * 3 + child.position.z * 2) * 0.004
        }
      })
    }
    renderer.render(scene, camera)
    rafId = requestAnimationFrame(loop)
  }
  rafId = requestAnimationFrame(loop)
})

watch(() => props.density, (d) => {
  if (mode.value === 'single') {
    selectedDensity.value = nearestPreset(d)
    renderDensityScene()
  }
})

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  if (cleanupListeners) cleanupListeners()
  if (ro) ro.disconnect()
  if (contentRoot) disposeObject(contentRoot)
  if (scene) {
    scene.traverse((c) => {
      if (c.geometry) c.geometry.dispose()
      if (c.material) {
        const ms = Array.isArray(c.material) ? c.material : [c.material]
        ms.forEach((m) => { if (m.map) m.map.dispose(); m.dispose() })
      }
    })
  }
  if (renderer) renderer.dispose()
})
</script>

<template>
  <div class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
       @click.self="emit('close')">
    <div class="bg-white rounded-lg shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">
      <header class="flex items-center gap-3 px-4 py-2.5 border-b border-ink-100">
        <h2 class="font-semibold text-ink-900">3D density reference</h2>
        <span v-if="zoneName" class="text-xs text-ink-700">· {{ zoneName }}</span>
        <span v-if="mode === 'single'" class="text-xs text-ink-700">
          (zone is at {{ props.density.toFixed(2) }} ppl/m² — showing nearest preset)
        </span>
        <div class="flex-1" />
        <div class="flex items-center gap-1">
          <button v-for="d in [1,2,3,4,5,6]" :key="d"
                  class="w-7 h-7 text-xs rounded border"
                  :class="mode === 'single' && selectedDensity === d
                          ? 'bg-ink-900 text-white border-ink-900'
                          : 'bg-white text-ink-900 border-ink-100 hover:bg-ink-50'"
                  @click="pickDensity(d)">{{ d }}</button>
        </div>
        <div class="w-px h-5 bg-ink-100 mx-1" />
        <button class="text-xs px-2 h-7 rounded border"
                :class="mode === 'single' ? 'bg-ink-900 text-white border-ink-900' : 'bg-white border-ink-100 hover:bg-ink-50'"
                @click="pickMode('single')">Single</button>
        <button class="text-xs px-2 h-7 rounded border"
                :class="mode === 'compare' ? 'bg-ink-900 text-white border-ink-900' : 'bg-white border-ink-100 hover:bg-ink-50'"
                @click="pickMode('compare')">Compare</button>
        <button class="text-xs w-7 h-7 rounded border bg-white border-ink-100 hover:bg-ink-50"
                title="Reset view"
                @click="resetCamera">↺</button>
        <button class="text-xs w-7 h-7 rounded text-ink-700 hover:text-ink-900"
                title="Close"
                @click="emit('close')">✕</button>
      </header>

      <div class="relative flex-1 min-h-0 bg-[#eef2f5]">
        <canvas ref="canvasRef" class="block w-full h-full touch-none" />
        <div v-if="isLoading"
             class="absolute inset-0 flex items-center justify-center text-sm text-ink-700">
          Loading 3D scene…
        </div>
        <div class="absolute left-3 bottom-3 bg-white/90 backdrop-blur rounded-md border border-ink-100 px-3 py-2 shadow-sm">
          <div class="flex items-baseline gap-1">
            <span class="text-2xl font-bold tabular-nums">{{ headline }}</span>
            <span class="text-xs text-ink-700">person/m²</span>
          </div>
          <div class="text-[11px] font-semibold mt-0.5" :style="{ color: statusColor }">
            {{ statusText }}
          </div>
          <div class="grid grid-cols-3 gap-2 mt-2 text-[11px]">
            <div>
              <div class="font-bold text-base">{{ peopleInOneM }}</div>
              <div class="text-ink-700">people in 1 m²</div>
            </div>
            <div>
              <div class="font-bold text-base">{{ spaceEach }}</div>
              <div class="text-ink-700">space each</div>
            </div>
            <div>
              <div class="font-bold text-base">{{ peopleIn25 }}</div>
              <div class="text-ink-700">people in 25 m²</div>
            </div>
          </div>
        </div>
        <div class="absolute right-3 bottom-3 text-[10px] text-ink-700 bg-white/80 rounded px-2 py-1">
          drag to orbit · scroll to zoom
        </div>
      </div>
    </div>
  </div>
</template>
