export { default as WalletManagerSui } from './manager.js'
export { default as WalletAccountReadOnlySui } from '#vendor/sui/wallet-account-read-only-sui.js'

export { patchSuiAccountSend } from './account.js'
export type { SuiTransaction } from '#vendor/sui/wallet-account-read-only-sui.js'
export type {
  LiveStreakSuiWalletConfig,
  SuiGasCoinRef,
} from './config.js'
export type { LiveStreakSuiWalletConfig as SuiWalletConfig } from './config.js'
export { isSponsoredSuiConfig } from './config.js'

export type {
  AssembleSponsoredTxBytesInput,
  ExecuteSponsoredTransactionInput,
  SuiGasStation,
  SuiGasStationSponsorInput,
  SuiGasStationSponsorResult,
} from './sponsored-transaction.js'

export {
  assembleSponsoredTxBytes,
  createLocalGasStation,
  executeSponsoredTransaction,
  normalizeSuiTransaction,
  resolveSuiClient,
  signSenderForSponsoredTransaction,
  verifySponsoredSignatures,
} from './sponsored-transaction.js'

import VendorWalletAccountSui from '#vendor/sui/wallet-account-sui.js'
import type { LiveStreakSuiWalletConfig } from './config.js'
import { patchSuiAccountSend } from './account.js'

export const WalletAccountSui = {
  at: async (
    seed: string | Uint8Array,
    path: string,
    config: LiveStreakSuiWalletConfig = {},
  ) => patchSuiAccountSend(await VendorWalletAccountSui.at(seed, path, config), config),
}
