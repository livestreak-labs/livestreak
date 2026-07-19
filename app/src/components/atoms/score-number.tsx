import NumberFlow, { type Format } from '@number-flow/react'
import type { CSSProperties } from 'react'

import { useLiveCounter } from '#/hooks/use-live-counter'

/**
 * A plain number that rolls like a scoreboard when it changes (NumberFlow) — the SAME animation the pool
 * uses (ScoreUSD), just without the currency format. Pass `live` + `ratePerSec` for a value that grows
 * continuously (a streaming position's shares/%): it projects `value + ratePerSec × elapsed` between the
 * 3s polls and re-anchors each poll. Omit/undefined `live` (paused, depleted, held) → no RAF loop runs at
 * all, so idle positions cost nothing.
 */
export function ScoreNumber({
  value,
  live = false,
  ratePerSec,
  format,
  className,
  style,
}: {
  value: number
  live?: boolean
  ratePerSec?: number
  format?: Format
  className?: string
  style?: CSSProperties
}) {
  const v = useLiveCounter(value, { live, ratePerSec })
  return (
    <NumberFlow
      className={className}
      style={style}
      value={Number.isFinite(v) ? v : 0}
      format={format}
      willChange={live}
    />
  )
}
