// Calm municipal-dashboard color ramp for the 3D workload view: a controlled
// green → amber → orange scale. We deliberately stop at orange and never reach
// intense red, so the 3D extrusion reads as a measured operational signal rather
// than an alarming "skyscraper" heat map. The same stops are used for the
// deck.gl polygon fills (RGB) and the shared legend gradient (CSS), so the two
// always match. This module has no deck.gl dependency, so importing the CSS
// helper into the 2D map path does NOT pull the deck.gl bundle in.

type Rgb = [number, number, number]

/** Color stops at normalized workload t = 0 (low) → 1 (high). No red. */
export const WORKLOAD_STOPS: Array<[number, Rgb]> = [
  [0.0, [74, 158, 110]], // calm green  #4A9E6E
  [0.5, [232, 178, 58]], // amber       #E8B23A
  [1.0, [221, 122, 53]], // orange      #DD7A35
]

/** Calm workload color as an [r, g, b] triple for a normalized t in [0, 1]. */
export function calmWorkloadRgb(t: number): Rgb {
  const clamped = Math.max(0, Math.min(1, t))
  for (let i = 1; i < WORKLOAD_STOPS.length; i++) {
    const [t1, c1] = WORKLOAD_STOPS[i]
    if (clamped <= t1) {
      const [t0, c0] = WORKLOAD_STOPS[i - 1]
      const f = t1 > t0 ? (clamped - t0) / (t1 - t0) : 0
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ]
    }
  }
  return WORKLOAD_STOPS[WORKLOAD_STOPS.length - 1][1]
}

/** Calm workload color as a CSS rgb() string for a normalized t in [0, 1]. */
export function calmWorkloadCss(t: number): string {
  const [r, g, b] = calmWorkloadRgb(t)
  return `rgb(${r}, ${g}, ${b})`
}
