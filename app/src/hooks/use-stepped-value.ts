import { useEffect, useRef, useState } from 'react'

export interface SteppedValueOptions {
  /** Step forward only while this position is actively streaming. Held/paused/depleted → shows the real value. */
  readonly live?: boolean
  /** Real accrual in display-units per SECOND (the SDK's share rate). Between polls the next step lands on
   *  `base + ratePerSec × Δt`; rate 0 → nothing to project, so no ticking. */
  readonly ratePerSec?: number
  /** Hard ceiling the shown value never exceeds (e.g. 100 for a share-%). It can still fall below it. */
  readonly max?: number
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// Distinct dwell times (seconds) between steps. We pick from this set and never repeat the last pick, so
// the cadence reads as organic rather than a metronome.
const STEP_SECONDS = [3, 4, 5, 6] as const

/**
 * A polled value revealed in DISCRETE steps, not a continuous count. Every 3–6s (a random dwell, never the
 * same twice running) it snaps from the previously shown value to the current projected value and HOLDS —
 * NumberFlow rolls the digits on the jump, then rests until the next step. This gives a streaming holding an
 * "alive" pulse without the distracting per-frame crawl of a live counter. The poll silently re-anchors the
 * projection baseline; the display only moves on a step. `max` clamps the shown value (a share-% must never
 * read above 100). Not streaming → shows the real value exactly, no ticking, no work.
 */
export function useSteppedValue(target: number, opts: SteppedValueOptions = {}): number {
  const { live = false, ratePerSec = 0, max } = opts
  const clamp = (n: number): number => (max !== undefined ? Math.min(max, n) : n)
  const anchor = useRef({ base: target, rate: 0, at: now() })
  const lastStep = useRef(0)
  const [display, setDisplay] = useState(clamp(target))

  // Re-anchor the projection baseline on every poll (target change) and rate change — silently, so the
  // display keeps holding until the next scheduled step reads this fresh baseline.
  useEffect(() => {
    anchor.current = { base: target, rate: live ? Math.max(0, ratePerSec) : 0, at: now() }
  }, [target, ratePerSec, live])

  useEffect(() => {
    if (!live || ratePerSec <= 0) return
    let timer: ReturnType<typeof setTimeout>
    const pickDelay = (): number => {
      const choices = STEP_SECONDS.filter((s) => s !== lastStep.current)
      const s = choices[Math.floor(Math.random() * choices.length)]!
      lastStep.current = s
      return s * 1000
    }
    const step = (): void => {
      const a = anchor.current
      setDisplay(clamp(a.base + a.rate * ((now() - a.at) / 1000)))
      timer = setTimeout(step, pickDelay())
    }
    timer = setTimeout(step, pickDelay())
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, ratePerSec, max])

  // While streaming, show the stepped value; otherwise the real (clamped) value directly — no lag, no ticking.
  return live && ratePerSec > 0 ? display : clamp(target)
}
