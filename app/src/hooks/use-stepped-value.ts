import { useEffect, useRef, useState } from 'react'

export interface SteppedValueOptions {
  /** Step forward only while this position is actively streaming. Held/paused/depleted → shows the real value. */
  readonly live?: boolean
  /** Real accrual in display-units per SECOND (the SDK's share rate). Between polls the next step lands on
   *  `base + ratePerSec × Δt`; rate 0 → nothing to project. */
  readonly ratePerSec?: number
  /** Hard ceiling the shown value never exceeds (e.g. 100 for a share-%). It can still fall below it. */
  readonly max?: number
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// Distinct dwell times (seconds) between steps — pick from this set, never repeating the last, so the
// cadence reads as organic rather than a metronome.
const STEP_SECONDS = [3, 4, 5, 6] as const
// The FIRST step fires fast so a freshly-entered position comes alive right away instead of sitting frozen
// for a full dwell; only afterwards does it settle into the 3–6s rhythm.
const FIRST_STEP_MS = 900

/**
 * A polled value revealed in DISCRETE steps, not a continuous count. It shows immediately on entry, gives a
 * quick first update (~1s), then snaps prev→current every 3–6s (random dwell, never repeating the last) and
 * HOLDS — NumberFlow rolls the digits on each jump. The poll silently re-anchors the projection baseline
 * (via `anchor`), so a per-poll rate wobble can NOT reset the step timer — the loop keys only on `live`.
 * `max` clamps the shown value (a share-% must never read above 100). Not streaming → the real value, no work.
 */
export function useSteppedValue(target: number, opts: SteppedValueOptions = {}): number {
  const { live = false, ratePerSec = 0, max } = opts
  const applyMax = (n: number): number => (max !== undefined ? Math.min(max, n) : n)
  const anchor = useRef({ base: target, rate: 0, at: now() })
  const lastStep = useRef(0)
  const [display, setDisplay] = useState(applyMax(target))

  // Re-anchor the projection baseline on every poll (target) / rate change — silently, so the display keeps
  // holding until the next scheduled step reads this fresh baseline. Crucially NOT a step-timer dependency.
  useEffect(() => {
    anchor.current = { base: target, rate: live ? Math.max(0, ratePerSec) : 0, at: now() }
  }, [target, ratePerSec, live])

  // Step loop — runs while live, keyed ONLY on `live` so a poll's rate wobble never tears it down and
  // restarts the timer (that bug made the step never fire). Reads the always-fresh `anchor` each step.
  useEffect(() => {
    if (!live) return
    let timer: ReturnType<typeof setTimeout>
    const nextDelay = (): number => {
      const choices = STEP_SECONDS.filter((s) => s !== lastStep.current)
      const s = choices[Math.floor(Math.random() * choices.length)]!
      lastStep.current = s
      return s * 1000
    }
    const step = (): void => {
      const a = anchor.current
      setDisplay(applyMax(a.base + a.rate * ((now() - a.at) / 1000)))
      timer = setTimeout(step, nextDelay())
    }
    timer = setTimeout(step, FIRST_STEP_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  return live ? display : applyMax(target)
}
