export const PEOPLE_COLOR_MODES = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'zone', label: 'By zone' },
  { value: 'natural', label: 'Natural mix' },
]

const MODE_VALUES = new Set(PEOPLE_COLOR_MODES.map(m => m.value))

const UPPER_CLOTHING_COLORS = [
  '#f8fafc', '#f1f5f9', '#e7e5e4', '#cbd5e1',
  '#111827', '#1f2937', '#0f172a', '#292524',
  '#1e3a8a', '#1d4ed8', '#4338ca', '#164e63',
  '#0f766e', '#166534', '#3f6212', '#4d7c0f',
  '#854d0e', '#92400e', '#7f1d1d', '#9f1239',
  '#581c87', '#be123c', '#78716c', '#0e7490',
]

const LOWER_CLOTHING_COLORS = [
  '#111827', '#0f172a', '#1f2937', '#292524',
  '#172554', '#1e3a8a', '#1e40af', '#1d4ed8',
  '#1c1917', '#3f3f46', '#44403c', '#57534e',
  '#713f12', '#78350f', '#854d0e', '#365314',
  '#3f6212', '#164e63', '#334155', '#78716c',
]

const SKIN_COLORS = [
  '#e8b98f', '#dda979', '#c98c61', '#b8754f',
  '#9f6440', '#815032', '#613b25', '#422719',
]

// Weighted toward dark brown/black hair. Bright auburn and grey read as
// visual noise at crowd scale, so they stay out of the common draw.
const HAIR_COLORS = [
  '#0b0908', '#111111', '#17120f', '#1c1917',
  '#21160f', '#2a1a12', '#2f2118', '#3a261a',
  '#432b1d', '#4a3424', '#0b0908', '#111111',
  '#1c1917', '#2a1a12', '#2f2118', '#3a261a',
  '#4a3424', '#0b0908', '#111111', '#1c1917',
  '#2a1a12', '#2f2118', '#3a261a', '#4a3424',
  '#5f4529', '#7a623e', '#8f7a53',
  '#6b6258',
]

export function normalizePeopleColorMode(mode, legacyTint = false) {
  if (MODE_VALUES.has(mode)) return mode
  return legacyTint ? 'zone' : 'neutral'
}

export function hashString(input) {
  let h = 2166136261
  const str = String(input)
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function personSeed(zoneId, pointIndex, point) {
  const lng = Number(point?.[0] ?? 0).toFixed(6)
  const lat = Number(point?.[1] ?? 0).toFixed(6)
  return hashString(`${zoneId}|${pointIndex}|${lng}|${lat}`)
}

export function rand01(seed, salt = 0) {
  let x = (seed + Math.imul(salt + 1, 0x9e3779b9)) >>> 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return (x >>> 0) / 4294967296
}

function pick(palette, seed, salt) {
  return palette[Math.floor(rand01(seed, salt) * palette.length) % palette.length]
}

export function personAppearance(seed) {
  const upper = pick(UPPER_CLOTHING_COLORS, seed, 1)
  return {
    clothing: upper,
    upperClothing: upper,
    lowerClothing: pick(LOWER_CLOTHING_COLORS, seed, 4),
    skin: pick(SKIN_COLORS, seed, 2),
    hair: pick(HAIR_COLORS, seed, 3),
  }
}
