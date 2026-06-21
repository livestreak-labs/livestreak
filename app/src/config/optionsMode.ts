/** When `off`, hooks keep mock data paths and skip options runtime wiring. */
export function isOptionsModeEnabled(): boolean {
  return (import.meta.env.VITE_OPTIONS_MODE as string | undefined) !== 'off'
}

/** Optional on-chain market id for refreshUser (bytes32 string). */
export function defaultOptionsMarketId(): string | undefined {
  const id = import.meta.env.VITE_OPTIONS_MARKET_ID as string | undefined
  return id && id.trim().length > 0 ? id.trim() : undefined
}
