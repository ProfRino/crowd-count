// Published density and Level-of-Service thresholds.
// Sources cited inline in the About page.

const SQFT_PER_M2 = 10.7639
const NFPA_STANDING_PPM2 = SQFT_PER_M2 / 5  // 5 net sq ft per person ≈ 2.153 ppl/m²

export const STANDARDS = {
  purple: {
    key: 'purple',
    name: 'UK Purple Guide',
    short: 'Purple 2.0',
    threshold: 2.0,
    blurb: 'Planning ceiling for outdoor mixed-audience events.',
    cite: 'The Purple Guide to Health, Safety and Welfare at Music and Other Events.',
  },
  green: {
    key: 'green',
    name: 'UK Green Guide (standing terrace)',
    short: 'Green 4.7',
    threshold: 4.7,
    blurb: 'Upper limit for standing-viewing accommodation at sports grounds.',
    cite: 'Guide to Safety at Sports Grounds (Green Guide).',
  },
  nfpa: {
    key: 'nfpa',
    name: 'NFPA 101 standing assembly',
    short: 'NFPA 2.15',
    threshold: NFPA_STANDING_PPM2,
    blurb: '5 net sq ft per person — US standing-assembly occupant load factor.',
    cite: 'NFPA 101 Table 7.3.1.2.',
  },
  still: {
    key: 'still',
    name: 'Still — upper safe limit',
    short: 'Still 5.0',
    threshold: 5.0,
    blurb: 'Above this, crush dynamics dominate; treat as a safety question, not a headcount.',
    cite: 'G. K. Still, gkstill.com/Support/crowd-density.',
  },
}

export const FRUIN_LOS = [
  { los: 'A', max: 0.43, label: 'Free flow', color: '#16a34a' },
  { los: 'B', max: 0.72, label: 'Restricted flow', color: '#22c55e' },
  { los: 'C', max: 1.08, label: 'Dense', color: '#eab308' },
  { los: 'D', max: 1.54, label: 'Very dense', color: '#f97316' },
  { los: 'E', max: 3.59, label: 'Jammed', color: '#dc2626' },
  { los: 'F', max: Infinity, label: 'Critical / crush risk', color: '#7f1d1d' },
]

// Density slider domain. The published planning thresholds top out at 5; above that
// is the crush regime (Still's "unpredictable" range) — included for sanity-checking
// reported densities at crush incidents like Hillsborough (~7), Itaewon (~9), Mina (10+).
export const DENSITY_MIN = 0.1
export const DENSITY_MAX = 10

// Tick marks on the density slider. crush=true marks the post-safety regime.
export const STILL_TICKS = [
  { ppm: 1.0, label: 'Comfortable' },
  { ppm: 2.0, label: 'Event Guidance safe' },
  { ppm: 4.0, label: 'Moving-queue threshold' },
  { ppm: 4.7, label: 'Standing-viewing max' },
  { ppm: 5.0, label: 'Upper safe limit' },
  { ppm: 6.0, label: 'Crush risk — Still unpredictable range', crush: true },
  { ppm: 8.0, label: 'Severe crush densities reported in incidents', crush: true },
  { ppm: 10.0, label: 'Extreme — Mina / Mecca peak densities', crush: true },
]

export const CRUSH_THRESHOLD = 5.0

export function fruinFor(density) {
  return FRUIN_LOS.find(b => density <= b.max) ?? FRUIN_LOS[FRUIN_LOS.length - 1]
}

export function badgeFor(density, standard) {
  // Returns { state: 'safe' | 'caution' | 'over', color, label, threshold }
  const s = STANDARDS[standard] ?? STANDARDS.purple
  const ratio = density / s.threshold
  let state, color, label
  if (ratio <= 0.5) { state = 'safe'; color = '#16a34a'; label = 'Within limit' }
  else if (ratio <= 1.0) { state = 'caution'; color = '#eab308'; label = 'Approaching limit' }
  else { state = 'over'; color = '#dc2626'; label = 'Over limit' }
  return { state, color, label, threshold: s.threshold, standardName: s.short }
}
