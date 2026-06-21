import type { TransactionResult } from '@tetherto/wdk-wallet'

import { ConfigurationError } from '#vendor/evm-erc-4337/errors.js'
import type { SuiTransaction } from '#vendor/sui/wallet-account-read-only-sui.js'
import type VendorWalletAccountSui from '#vendor/sui/wallet-account-sui.js'

import type { LiveStreakSuiWalletConfig } from './config.js'
import { isSponsoredSuiConfig } from './config.js'
import { executeSponsoredTransaction, resolveSuiClient } from './sponsored-transaction.js'

const patchedAccounts = new WeakSet<VendorWalletAccountSui>()

export type WalletAccountSui = VendorWalletAccountSui

export function patchSuiAccountSend(
  account: VendorWalletAccountSui,
  config: LiveStreakSuiWalletConfig,
): WalletAccountSui {
  if (patchedAccounts.has(account)) {
    return account
  }
  patchedAccounts.add(account)

  const selfPaySend = account.sendTransaction.bind(account)
  account.sendTransaction = async (tx: SuiTransaction): Promise<TransactionResult> => {
    if (config.isSponsored === true && config.gasStation === undefined) {
      throw new ConfigurationError(
        "Sui sponsored transactions require an injected gasStation when isSponsored is true.",
      )
    }

    if (isSponsoredSuiConfig(config)) {
      return executeSponsoredTransaction({
        account,
        transaction: tx,
        gasStation: config.gasStation,
        client: resolveSuiClient(config),
        transferMaxFee: config.transferMaxFee,
      })
    }

    return selfPaySend(tx)
  }

  return account
}
