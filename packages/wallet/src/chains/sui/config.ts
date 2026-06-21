import { ConfigurationError } from '#vendor/evm-erc-4337/errors.js'
import type { SuiWalletConfig } from '#vendor/sui/wallet-account-read-only-sui.js'

import type { SuiGasStation } from './sponsored-transaction.js'

export type { SuiWalletConfig }

export type SuiGasCoinRef = {
  objectId: string
  version: string
  digest: string
}

export type LiveStreakSuiWalletConfig = SuiWalletConfig & {
  isSponsored?: boolean
  gasStation?: SuiGasStation
}

export function isSponsoredSuiConfig(
  config: LiveStreakSuiWalletConfig,
): config is LiveStreakSuiWalletConfig & { gasStation: SuiGasStation } {
  if (config.isSponsored === true) {
    return config.gasStation !== undefined
  }
  return config.gasStation !== undefined
}

export function assertSponsoredConfig(
  config: LiveStreakSuiWalletConfig,
): asserts config is LiveStreakSuiWalletConfig & { gasStation: SuiGasStation } {
  if (config.isSponsored === true && config.gasStation === undefined) {
    throw new ConfigurationError(
      "Sui sponsored transactions require an injected gasStation when isSponsored is true.",
    )
  }
}
