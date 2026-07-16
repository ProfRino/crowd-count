import { useApp } from '../src/lib/state.js'

const app = useApp()
let failures = 0

function closeEnough(actual, expected, tolerance = 1e-8) {
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected))
}

function check(name, actual, expected, tolerance) {
  const pass = closeEnough(actual, expected, tolerance)
  if (!pass) failures += 1
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
  console.log(`      expected ${expected}; calculated ${actual}`)
}

function gradientZone({
  id,
  vertices,
  start = [0, 0],
  end = [100, 0],
  stops = [{ distanceM: 0, density: 2 }, { distanceM: 100, density: 1 }],
  obstructions = [],
}) {
  return {
    id,
    name: id,
    density: 2,
    densityMode: 'gradient',
    densityGradient: { start, end, stops },
    vertices,
    obstructions: obstructions.map((vertices, i) => ({ id: `${id}-hole-${i}`, vertices })),
    shape: 'polygon',
    params: null,
    facingPoint: null,
  }
}

function rotate([x, y], radians) {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return [x * c - y * s, x * s + y * c]
}

app.state.mode = 'indoor'
app.state.indoor.pixelsPerMeter = 1

const uniform = {
  ...gradientZone({ id: 'uniform', vertices: [[0, 0], [20, 0], [20, 10], [0, 10]] }),
  density: 2.5,
  densityMode: 'uniform',
}
check('uniform density remains exact', app.zonePeopleCount(uniform), 500)

const rectangle = gradientZone({
  id: 'rectangle',
  vertices: [[0, 0], [100, 0], [100, 50], [0, 50]],
})
check('100 m rectangle average density', app.zoneAverageDensity(rectangle), 1.5)
check('100 m rectangle crowd count', app.zonePeopleCount(rectangle), 7500)

const increasing = gradientZone({
  id: 'increasing',
  vertices: [[0, 0], [100, 0], [100, 50], [0, 50]],
  stops: [{ distanceM: 0, density: 1 }, { distanceM: 100, density: 3 }],
})
check('increasing 1 to 3 gradient', app.zonePeopleCount(increasing), 10000)

const constant = gradientZone({
  id: 'constant',
  vertices: [[0, 0], [100, 0], [100, 50], [0, 50]],
  stops: [{ distanceM: 0, density: 4 }, { distanceM: 100, density: 4 }],
})
check('constant 4 to 4 gradient', app.zonePeopleCount(constant), 20000)

const customDistances = gradientZone({
  id: 'custom-distances',
  vertices: [[0, 0], [100, 0], [100, 50], [0, 50]],
  stops: [{ distanceM: 20, density: 3 }, { distanceM: 80, density: 1 }],
})
check('custom 20 m to 80 m gradient with clamping', app.zonePeopleCount(customDistances), 10000)

const reversedDirection = gradientZone({
  id: 'reversed-direction',
  vertices: [[0, 0], [100, 0], [100, 50], [0, 50]],
  start: [100, 0],
  end: [0, 0],
})
check('reversed gradient direction', app.zonePeopleCount(reversedDirection), 7500)

const perpendicular = gradientZone({
  id: 'perpendicular',
  vertices: [[0, 0], [100, 0], [100, 50], [0, 50]],
  start: [0, 0],
  end: [0, 50],
  stops: [{ distanceM: 0, density: 2 }, { distanceM: 50, density: 0 }],
})
check('gradient along the perpendicular axis', app.zonePeopleCount(perpendicular), 5000)

const triangle = gradientZone({
  id: 'triangle',
  vertices: [[0, 0], [100, 0], [0, 100]],
})
check('triangular width weighting', app.zonePeopleCount(triangle), 25000 / 3)

const concave = gradientZone({
  id: 'concave',
  vertices: [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]],
})
check('concave L-shaped zone', app.zonePeopleCount(concave), 10320)

const withHole = gradientZone({
  id: 'obstruction',
  vertices: [[0, 0], [100, 0], [100, 100], [0, 100]],
  obstructions: [[[50, 10], [90, 10], [90, 90], [50, 90]]],
})
check('obstruction subtracts density-weighted area', app.zonePeopleCount(withHole), 10840)

const clamped = gradientZone({
  id: 'clamped',
  vertices: [[-50, 0], [150, 0], [150, 50], [-50, 50]],
})
check('density clamps before 0 m and after 100 m', app.zonePeopleCount(clamped), 15000)

const angle = Math.PI / 4
const rotated = gradientZone({
  id: 'rotated',
  vertices: [[0, 0], [100, 0], [100, 50], [0, 50]].map(p => rotate(p, angle)),
  start: rotate([0, 0], angle),
  end: rotate([100, 0], angle),
})
check('rotation does not change the count', app.zonePeopleCount(rotated), 7500)

const origin = [-77.047, 38.8895]
const latRadians = origin[1] * Math.PI / 180
function outdoorPoint(eastM, northM) {
  return [
    origin[0] + eastM / (111320 * Math.cos(latRadians)),
    origin[1] + northM / 111320,
  ]
}
app.state.mode = 'outdoor'
const outdoor = gradientZone({
  id: 'outdoor',
  vertices: [[0, 0], [100, 0], [100, 50], [0, 50]].map(([x, y]) => outdoorPoint(x, y)),
  start: outdoorPoint(0, 0),
  end: outdoorPoint(100, 0),
})
const outdoorExpected = app.zoneAreaM2(outdoor) * 1.5
check('outdoor geodesic area with linear gradient', app.zonePeopleCount(outdoor), outdoorExpected, 1e-6)

if (failures) {
  console.error(`\n${failures} validation(s) failed.`)
  process.exitCode = 1
} else {
  console.log('\nAll gradient validations passed.')
}
