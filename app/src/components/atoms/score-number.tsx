import NumberFlow, { type Format } from '@number-flow/react'
import type { CSSProperties } from 'react'

import { useSteppedValue } from '#/hooks/use-stepped-value'

/**
 * A number for a streaming position's shares / %. Unlike the pool (ScoreUSD, a smooth live counter), this
 * updates in DISCRETE steps every 3–6s and holds between them — NumberFlow rolls the digits on each jump.
 * Pass `live` + `ratePerSec` for a streaming holding; `max` caps the value (100 for a share-%). Held /
 * paused / depleted (live=false) → shows the real value, no ticking, no work.
 */
export function ScoreNumber({
  value,
  live = false,
  ratePerSec,
  max,
  format,
  className,
  style,
}: {
  value: number
  live?: boolean
  ratePerSec?: number
  max?: number
  format?: Format
  className?: string
  style?: CSSProperties
}) {
  const v = useSteppedValue(value, { live, ratePerSec, max })
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
