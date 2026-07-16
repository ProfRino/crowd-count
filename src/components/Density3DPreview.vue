<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import modelUrl from '../assets/basic_human_model.min.glb?url'
import { HUMAN_HEIGHT_M } from '../lib/humanScale.js'

const props = defineProps({
  density: { type: Number, default: 1.5 },
  zoneName: { type: String, default: '' },
  // When non-empty, Single-mode mannequins take this colour. Otherwise
  // fall back to the per-density palette (densityColorsHex).
  zoneColor: { type: String, default: '' },
})
const emit = defineEmits(['close'])

// The reference layouts are integer 1..6. We round the zone's density to the
// nearest preset and clamp into range. The modal also has its own 1..6 buttons.
function nearestPreset(d) {
  return Math.max(1, Math.min(6, Math.round(d)))
}

const selectedDensity = ref(nearestPreset(props.density))
const mode = ref('single')           // 'single' | 'compare'
const referenceStyle = ref('simple') // 'simple' | 'animated'
const facingMode = ref('varied')     // 'varied' | 'forward'
const canvasRef = ref(null)
const isLoading = ref(true)
const loadError = ref('')
const loadProgress = ref(0)

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

const sampleSideMeters = 3
const sampleHalfMeters = sampleSideMeters / 2
const animatedPresetTransforms = Object.freeze({
  1: { scale: 1, x: 0, z: 0 },
  2: { scale: 1, x: 0, z: 0 },
  3: { scale: 0.98, x: 0.05, z: -0.01 },
  4: { scale: 0.94, x: -0.14, z: 0 },
  5: { scale: 0.98, x: 0, z: 0 },
  6: { scale: 0.95, x: 0, z: -0.10 },
})

const headline = computed(() => mode.value === 'compare' ? '1–6' : String(selectedDensity.value))
const peopleInOneM = computed(() => mode.value === 'compare' ? '1–6' : String(selectedDensity.value))
const spaceEach = computed(() =>
  mode.value === 'compare' ? 'varies' : `${(1 / selectedDensity.value).toFixed(2)} m²`)
const peopleInArea = computed(() => {
  if (mode.value === 'compare') return '25–150'
  return String(selectedDensity.value * sampleSideMeters * sampleSideMeters)
})
const peopleInAreaLabel = computed(() =>
  mode.value === 'single'
    ? 'people in shown 9 m²'
    : 'people in 25 m²')
const statusText = computed(() =>
  mode.value === 'compare'
    ? 'density comparison'
    : referenceStyle.value === 'animated'
      ? `${statusLabels[selectedDensity.value]} · animated 3 x 3 m`
      : statusLabels[selectedDensity.value])
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
let activeMixer = null
let clock = null
let sceneRequestId = 0

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
function seededUnit(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}
function densityMinSpacing(density) {
  if (density <= 1) return 0.72
  if (density === 2) return 0.46
  if (density === 3) return 0.34
  if (density === 4) return 0.28
  if (density === 5) return 0.235
  return 0.205
}
function createReferenceLayout(density) {
  const count = density * sampleSideMeters * sampleSideMeters
  const points = []
  const edge = 0.24
  const min = -sampleHalfMeters + edge
  const max = sampleHalfMeters - edge
  let minSpacing = densityMinSpacing(density)
  let seed = density * 1000

  while (points.length < count && minSpacing > 0.05) {
    let addedThisPass = false
    const attempts = 1400
    for (let a = 0; a < attempts && points.length < count; a += 1) {
      seed += 1
      const x = min + seededUnit(seed * 17) * (max - min)
      const z = min + seededUnit(seed * 29) * (max - min)
      const ok = points.every(([px, pz]) => {
        const dx = x - px
        const dz = z - pz
        return dx * dx + dz * dz >= minSpacing * minSpacing
      })
      if (!ok) continue
      points.push([x, z])
      addedThisPass = true
    }
    if (!addedThisPass) minSpacing *= 0.92
  }

  while (points.length < count) {
    seed += 1
    points.push([
      min + seededUnit(seed * 17) * (max - min),
      min + seededUnit(seed * 29) * (max - min),
    ])
  }

  return points
}

// GLB-derived mannequin geometry — loaded once on mount, shared across all
// tiles. Same model + same normalization as Site3DView so the two 3D views
// (density reference + site view) show identical mannequins.
let personGeometry = null

async function loadPersonGeometry() {
  if (personGeometry) return personGeometry
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const loader = new GLTFLoader()
  return new Promise((resolve, reject) => {
    loader.load(modelUrl, (gltf) => {
      let firstMesh = null
      gltf.scene.traverse((o) => { if (!firstMesh && o.isMesh) firstMesh = o })
      if (!firstMesh) { reject(new Error('Model has no mesh.')); return }
      gltf.scene.updateMatrixWorld(true)
      // Bake the GLB world matrix into a Float32 attribute (the GLB is
      // quantized; without this step the matrix bakes get clamped — same
      // trick as Site3DView).
      const srcPos = firstMesh.geometry.attributes.position
      const N = srcPos.count
      const buf = new Float32Array(N * 3)
      const v = new THREE.Vector3()
      for (let i = 0; i < N; i++) {
        v.fromBufferAttribute(srcPos, i)
        v.applyMatrix4(firstMesh.matrixWorld)
        buf[i * 3] = v.x; buf[i * 3 + 1] = v.y; buf[i * 3 + 2] = v.z
      }
      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.Float32BufferAttribute(buf, 3))
      if (firstMesh.geometry.index) geom.setIndex(firstMesh.geometry.index.clone())
      // Normalize: 1.7 m tall, feet at y=0, centered in X/Z.
      const box = new THREE.Box3().setFromBufferAttribute(geom.attributes.position)
      const size = box.getSize(new THREE.Vector3())
      const scale = HUMAN_HEIGHT_M / Math.max(size.y, 0.001)
      const center = box.getCenter(new THREE.Vector3())
      geom.translate(-center.x, -box.min.y, -center.z)
      geom.scale(scale, scale, scale)
      geom.computeVertexNormals()
      personGeometry = geom
      resolve(geom)
    }, undefined, reject)
  })
}

// Stand a single mannequin at (px, 0, pz). Reuses the shared geometry and
// a per-tile material so colouring is cheap and consistent.
function makePerson(material, px, pz, indexForRotation) {
  const mesh = new THREE.Mesh(personGeometry, material)
  mesh.position.set(px, 0, pz)
  if (facingMode.value === 'forward') {
    mesh.rotation.y = 0
    mesh.castShadow = true
    return mesh
  }
  // Stagger the facing direction slightly so the crowd doesn't look frozen
  // in a single orientation. Deterministic per-index for stability.
  mesh.rotation.y = ((indexForRotation * 37 + 11) % 360) * Math.PI / 180
  mesh.castShadow = true
  return mesh
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

function createTextSprite(text, position, size, color, weight, { depthTest = false } = {}) {
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
  // depthTest:false (default) keeps the existing 1/m²-style overhead labels
  // always-on-top. depthTest:true lets mannequins occlude the dimension
  // labels naturally when they stand in front of them.
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest })
  const sprite = new THREE.Sprite(material)
  sprite.position.copy(position)
  sprite.scale.set(size * 2.6, size * 0.65, 1)
  return sprite
}

// Architectural-style dimension annotation: a rule line between p1 and p2
// with chevron arrowheads at each end and a centred label. All geometry has
// depthTest enabled so mannequins occlude it naturally.
function createDimensionAnnotation(p1, p2, label, color, lift = 0.06) {
  const group = new THREE.Group()
  const colorObj = new THREE.Color(color)
  const lineMat = new THREE.LineBasicMaterial({ color: colorObj, depthTest: true })

  const a = new THREE.Vector3(p1.x, lift, p1.z)
  const b = new THREE.Vector3(p2.x, lift, p2.z)
  // Main rule line a → b
  group.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([a, b]),
    lineMat,
  ))

  // Chevron arrowheads at each endpoint
  const dir  = new THREE.Vector3().subVectors(b, a).normalize()
  const perp = new THREE.Vector3(-dir.z, 0, dir.x)
  const aLen = 0.15, aWid = 0.07
  function chevron(tip, awayDir) {
    const back = tip.clone().addScaledVector(awayDir, aLen)
    const s1 = back.clone().addScaledVector(perp,  aWid)
    const s2 = back.clone().addScaledVector(perp, -aWid)
    group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([s1, tip, s2]),
      lineMat,
    ))
  }
  chevron(a, dir)            // < at p1
  chevron(b, dir.clone().negate())  // > at p2

  // Centred label, slightly lifted so it sits above the line. depthTest on
  // so any mannequin standing between camera and label hides it cleanly.
  const mid = new THREE.Vector3((a.x + b.x) / 2, lift + 0.04, (a.z + b.z) / 2)
  group.add(createTextSprite(label, mid, 0.28, color, '800', { depthTest: true }))

  return group
}

// Pick the material colour for the people on a given tile.
//   Single mode + a zone is open → use that zone's colour (honest to UI).
//   Compare mode → use the per-density palette colour (1=blue … 6=dark red).
//   No zone in Single mode → the per-density palette colour as a default.
function pickPersonColour(density, isCompare) {
  if (!isCompare && props.zoneColor) return new THREE.Color(props.zoneColor)
  return new THREE.Color(densityColorsHex[density])
}

function createDensityTile(density, x, z, expanded, isCompare = false) {
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

  // GLB mannequin material — single matte tint. We make a fresh material
  // per tile so the per-density / per-zone colours don't bleed across tiles.
  const personMat = new THREE.MeshStandardMaterial({
    color: pickPersonColour(density, isCompare),
    roughness: 0.65, metalness: 0,
  })
  // Preserve the exact existing layout positions — only the model + colour
  // change vs the prior primitive renderer.
  placements[density].forEach(([px, pz], index) => {
    group.add(makePerson(personMat, px, pz, index))
  })

  if (expanded) {
    group.add(createLowFence(sampleHalfMeters, densityColorsHex[density]))
    // Architectural dimension annotations on two adjacent edges of the
    // 3 m x 3 m sample square, sitting just outside the plot so the
    // mannequins inside don't fight with the arrows for screen space.
    const labelColor = colorToCss(densityColorsHex[density])
    const off = 0.22  // gap between square edge and dimension line
    // Front edge (camera-facing in default framing): runs along +X at z=halfSize+off
    group.add(createDimensionAnnotation(
      { x: -sampleHalfMeters, z: sampleHalfMeters + off },
      { x:  sampleHalfMeters, z: sampleHalfMeters + off },
      `${sampleSideMeters} m`, labelColor,
    ))
    // Left edge: runs along +Z at x=-halfSize-off
    group.add(createDimensionAnnotation(
      { x: -sampleHalfMeters - off, z: -sampleHalfMeters },
      { x: -sampleHalfMeters - off, z:  sampleHalfMeters },
      `${sampleSideMeters} m`, labelColor,
    ))
  }
  return group
}

// The six animated crowd GLBs total ~430 MB, so they are not bundled into
// the single-file build or committed to the repository. They are tried in
// order: a local copy served next to the app (dev server, the GitHub Pages
// deployment — where deploy.yml stages them from the release assets — or a
// self-hosted dist/), then the hosted site, which GitHub Pages serves with
// Access-Control-Allow-Origin: *. GitHub release-asset download URLs cannot
// be used here: their storage host sends no CORS headers.
const HOSTED_MODELS_BASE = 'https://profrino.github.io/crowd-count/crowd-models'

function animatedCrowdSources(density) {
  const file = `dynamic_crowd_export_loop_1000_3x3x${density}.glb`
  const local = `${import.meta.env.BASE_URL}crowd-models/${file}`
  const hosted = `${HOSTED_MODELS_BASE}/${file}`
  // On the hosted site itself the two URLs are the same request — skip the retry.
  return new URL(local, window.location.href).href === hosted ? [local] : [local, hosted]
}

function createPatchSurface(sideMeters, density, showDimensions = false) {
  const half = sideMeters / 2
  const group = new THREE.Group()
  const tileMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.78, metalness: 0,
    transparent: true, opacity: 0.96,
  })
  const tile = new THREE.Mesh(new THREE.PlaneGeometry(sideMeters, sideMeters), tileMaterial)
  tile.rotation.x = -Math.PI / 2
  tile.receiveShadow = true
  group.add(tile)
  group.add(createSquareOutline(half, densityColorsHex[density], 0.018))
  group.add(createGridLines(half, 0.5))
  if (showDimensions) {
    const labelColor = colorToCss(densityColorsHex[density])
    const off = 0.32
    group.add(createDimensionAnnotation(
      { x: -half, z: half + off },
      { x:  half, z: half + off },
      `${sideMeters} m`, labelColor,
    ))
    group.add(createDimensionAnnotation(
      { x: -half - off, z: -half },
      { x: -half - off, z:  half },
      `${sideMeters} m`, labelColor,
    ))
  }
  return group
}

function fitAnimatedCrowdToPatch(root) {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return

  // The animated GLBs are already authored as 3 x 3 m density patches.
  // Only centre them on the reference square. Do not auto-scale or lift Y:
  // skinned animation bounds can include bind-pose offsets that make denser
  // crowds appear resized or floating.
  const center = box.getCenter(new THREE.Vector3())
  root.position.x -= center.x
  root.position.z -= center.z
}

async function loadAnimatedCrowd(density) {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const loader = new GLTFLoader()
  let lastError = null
  for (const url of animatedCrowdSources(density)) {
    try {
      return await new Promise((resolve, reject) => {
        loader.load(url, resolve, (e) => {
          if (e.total > 0) loadProgress.value = Math.round((e.loaded / e.total) * 100)
        }, reject)
      })
    } catch (e) {
      lastError = e
      loadProgress.value = 0
    }
  }
  throw lastError
}

async function buildAnimatedCrowdScene(root, density, requestId) {
  root.add(createPatchSurface(3, density, true))

  const gltf = await loadAnimatedCrowd(density)
  if (requestId !== sceneRequestId) {
    disposeObject(gltf.scene)
    return
  }

  const crowd = gltf.scene
  crowd.traverse((child) => {
    if (!child.isMesh) return
    child.castShadow = true
    child.receiveShadow = false
    const mats = Array.isArray(child.material) ? child.material : [child.material]
    mats.forEach((m) => {
      if (m) {
        m.depthTest = true
        m.depthWrite = true
      }
    })
  })
  fitAnimatedCrowdToPatch(crowd)
  const orientedCrowd = new THREE.Group()
  orientedCrowd.rotation.y = Math.PI
  orientedCrowd.add(crowd)
  const transform = animatedPresetTransforms[density]
  orientedCrowd.scale.setScalar(transform.scale)
  orientedCrowd.position.set(transform.x, 0, transform.z)
  root.add(orientedCrowd)

  if (gltf.animations?.length) {
    activeMixer = new THREE.AnimationMixer(orientedCrowd)
    clock?.getDelta()
    activeMixer.clipAction(gltf.animations[0]).reset().play()
  }
}

function buildSingleScene(root, density) { root.add(createDensityTile(density, 0, 0, true, false)) }

function buildCompareScene(root) {
  const w = canvasRef.value?.clientWidth ?? 800
  const isNarrow = w < 740
  const columns = isNarrow ? 2 : 3
  const rows = Math.ceil(6 / columns)
  const spacingX = isNarrow ? 4.15 : 4.25
  const spacingZ = isNarrow ? 4.05 : 4.2
  for (let d = 1; d <= 6; d += 1) {
    const col = (d - 1) % columns
    const row = Math.floor((d - 1) / columns)
    const x = (col - ((columns - 1) / 2)) * spacingX
    const z = (row - ((rows - 1) / 2)) * spacingZ
    root.add(createDensityTile(d, x, z, false, true))
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
    distance = w < 740 ? 21 : 19
  } else if (referenceStyle.value === 'animated') {
    yaw = -0.72
    pitch = 0.86
    distance = w < 740 ? 10.2 : 9.1
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

async function renderDensityScene() {
  if (!scene) return
  const requestId = ++sceneRequestId
  activeMixer = null
  loadError.value = ''
  loadProgress.value = 0
  if (contentRoot) {
    scene.remove(contentRoot)
    disposeObject(contentRoot)
  }
  contentRoot = new THREE.Group()
  scene.add(contentRoot)
  try {
    if (mode.value === 'compare') {
      isLoading.value = false
      buildCompareScene(contentRoot)
      target.set(0, 0.55, 0.1)
    } else if (referenceStyle.value === 'animated') {
      isLoading.value = true
      target.set(0, 0.85, 0)
      await buildAnimatedCrowdScene(contentRoot, selectedDensity.value, requestId)
      if (requestId !== sceneRequestId) return
      isLoading.value = false
    } else {
      isLoading.value = false
      buildSingleScene(contentRoot, selectedDensity.value)
      target.set(0, 0.55, 0)
    }
  } catch (e) {
    if (requestId !== sceneRequestId) return
    console.error('Density3DPreview: animated crowd load failed', e)
    loadError.value = 'Could not load the animated crowd model. It streams from the Crowd Count website when no local copy is available, so an internet connection is required.'
    isLoading.value = false
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
  if (m === 'compare') referenceStyle.value = 'simple'
  renderDensityScene()
}
function pickReferenceStyle(m) {
  referenceStyle.value = m
  if (m === 'animated') mode.value = 'single'
  renderDensityScene()
}
function pickFacingMode(m) {
  facingMode.value = m
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
  distance = Math.max(mode.value === 'compare' ? 9 : 2.6, Math.min(mode.value === 'compare' ? 28 : 7, next))
  updateCamera()
}
function onKey(e) {
  if (e.key === 'Escape') emit('close')
}

onMounted(async () => {
  THREE = await import('three')
  clock = new THREE.Clock()
  // Load the shared GLB mannequin BEFORE the first scene build so the tiles
  // get the proper model on the very first render (no flash of nothing).
  try { await loadPersonGeometry() }
  catch (e) { console.error('Density3DPreview: GLB load failed', e) }
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
    new THREE.PlaneGeometry(28, 18),
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
    if (activeMixer && clock) {
      activeMixer.update(clock.getDelta())
    } else if (contentRoot) {
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
      <header class="px-4 py-2.5 border-b border-ink-100">
        <div class="flex min-w-0 items-center gap-2">
          <h2 class="font-semibold text-ink-900">3D density reference</h2>
          <span v-if="zoneName" class="text-xs text-ink-700">· {{ zoneName }}</span>
          <span v-if="mode === 'single'" class="text-xs text-ink-700">
            (zone is at {{ props.density.toFixed(2) }} ppl/m² — showing nearest preset)
          </span>
          <div class="flex-1" />
          <button class="text-xs w-7 h-7 rounded text-ink-700 hover:text-ink-900"
                  title="Close"
                  @click="emit('close')">✕</button>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-1">
          <button v-for="d in [1,2,3,4,5,6]" :key="d"
                  class="w-7 h-7 text-xs rounded border"
                  :class="mode === 'single' && selectedDensity === d
                          ? 'bg-ink-900 text-white border-ink-900'
                          : 'bg-white text-ink-900 border-ink-100 hover:bg-ink-50'"
                  @click="pickDensity(d)">{{ d }}</button>
        <div class="w-px h-5 bg-ink-100 mx-1" />
        <button class="text-xs px-2 h-7 rounded border"
                :class="mode === 'single' ? 'bg-ink-900 text-white border-ink-900' : 'bg-white border-ink-100 hover:bg-ink-50'"
                @click="pickMode('single')">Single</button>
        <button class="text-xs px-2 h-7 rounded border"
                :class="mode === 'compare' ? 'bg-ink-900 text-white border-ink-900' : 'bg-white border-ink-100 hover:bg-ink-50'"
                @click="pickMode('compare')">Compare</button>
        <div class="w-px h-5 bg-ink-100 mx-1" />
        <button class="text-xs px-2 h-7 rounded border"
                :class="referenceStyle === 'simple' ? 'bg-ink-900 text-white border-ink-900' : 'bg-white border-ink-100 hover:bg-ink-50'"
                title="Use the existing lightweight density reference"
                @click="pickReferenceStyle('simple')">Simple</button>
        <button class="text-xs px-2 h-7 rounded border"
                :class="referenceStyle === 'animated' ? 'bg-ink-900 text-white border-ink-900' : 'bg-white border-ink-100 hover:bg-ink-50'"
                title="Load the animated 3 x 3 m realistic crowd preset"
                @click="pickReferenceStyle('animated')">Animated</button>
        <div v-if="referenceStyle === 'simple'" class="w-px h-5 bg-ink-100 mx-1" />
        <button class="text-xs px-2 h-7 rounded border"
                v-if="referenceStyle === 'simple'"
                :class="facingMode === 'varied' ? 'bg-ink-900 text-white border-ink-900' : 'bg-white border-ink-100 hover:bg-ink-50'"
                title="Use varied mannequin directions"
                @click="pickFacingMode('varied')">Varied</button>
        <button class="text-xs px-2 h-7 rounded border"
                v-if="referenceStyle === 'simple'"
                :class="facingMode === 'forward' ? 'bg-ink-900 text-white border-ink-900' : 'bg-white border-ink-100 hover:bg-ink-50'"
                title="Face every mannequin forward"
                @click="pickFacingMode('forward')">Forward</button>
        </div>
      </header>

      <div class="relative flex-1 min-h-0 bg-[#eef2f5]">
        <canvas ref="canvasRef" class="block w-full h-full touch-none" />
        <div v-if="isLoading"
             class="absolute inset-0 flex items-center justify-center text-sm text-ink-700">
          {{ referenceStyle === 'animated'
            ? (loadProgress > 0 ? `Loading animated crowd model… ${loadProgress}%` : 'Loading animated crowd model…')
            : 'Loading 3D scene…' }}
        </div>
        <div v-if="loadError"
             class="absolute top-3 left-1/2 -translate-x-1/2 rounded-md border border-red-200 bg-white/95 px-3 py-2 text-xs text-red-700 shadow">
          {{ loadError }}
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
              <div class="font-bold text-base">{{ peopleInArea }}</div>
              <div class="text-ink-700">{{ peopleInAreaLabel }}</div>
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
