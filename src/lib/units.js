// Display-only conversion helpers. All app-internal state stays metric
// (meters, m², ppl/m²) so URL permalinks survive any unit toggle and the
// physics-of-a-person stays consistent.
// Format follows the user-facing `units` setting which is either 'metric' or 'imperial'.

export const M2_TO_FT2 = 10.7639104
export const M_TO_FT = 3.28084
export const FT2_PER_ACRE = 43560
export const M2_PER_HA = 10000

export function fmtArea(m2, units) {
  if (!m2 || m2 < 0) return units === 'imperial' ? '0 ft²' : '0 m²'
  if (units === 'imperial') {
    const ft2 = m2 * M2_TO_FT2
    if (ft2 >= FT2_PER_ACRE) {
      const acres = ft2 / FT2_PER_ACRE
      return `${acres.toFixed(2)} ac (${Math.round(ft2).toLocaleString()} ft²)`
    }
    return Math.round(ft2).toLocaleString() + ' ft²'
  }
  if (m2 >= M2_PER_HA) {
    const ha = m2 / M2_PER_HA
    return `${ha.toFixed(2)} ha (${Math.round(m2).toLocaleString()} m²)`
  }
  return m2.toFixed(0) + ' m²'
}

export function fmtAreaCompact(m2, units) {
  if (!m2 || m2 < 0) return units === 'imperial' ? '— ft²' : '— m²'
  if (units === 'imperial') {
    const ft2 = m2 * M2_TO_FT2
    if (ft2 >= FT2_PER_ACRE) return (ft2 / FT2_PER_ACRE).toFixed(2) + ' ac'
    return Math.round(ft2).toLocaleString() + ' ft²'
  }
  if (m2 >= M2_PER_HA) return (m2 / M2_PER_HA).toFixed(2) + ' ha'
  return m2.toFixed(1) + ' m²'
}

// Density: internal value is always ppl/m². Imperial display uses ft²/person
// (the "X square feet per person" framing NFPA / IBC use).
export function fmtDensity(perM2, units) {
  if (perM2 <= 0) return units === 'imperial' ? '— ft²/person' : '— ppl/m²'
  if (units === 'imperial') {
    const ft2PerPerson = 1 / (perM2 * 0.092903)
    return ft2PerPerson.toFixed(1) + ' ft²/person'
  }
  return perM2.toFixed(2) + ' ppl/m²'
}

// Distance unit label for the indoor calibration input.
export function distanceUnitLabel(units) {
  return units === 'imperial' ? 'ft' : 'm'
}

// Convert a distance from the user's chosen unit into meters for internal
// storage (used by the indoor calibration prompt).
export function distanceToMeters(value, units) {
  return units === 'imperial' ? value / M_TO_FT : value
}

// And the inverse — meters back into the user's chosen unit for display.
export function metersToDisplay(m, units) {
  return units === 'imperial' ? m * M_TO_FT : m
}
