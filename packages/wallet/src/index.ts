export { default, createWalletManager } from '#create-wallet-manager.js'

export {
  WalletManagerEvmErc4337,
  WalletAccountEvmErc4337,
  WalletAccountReadOnlyEvmErc4337,
  ConfigurationError,
} from '#chains/evm.js'

export {
  WalletManagerSui,
  WalletAccountSui,
  WalletAccountReadOnlySui,
  assembleSponsoredTxBytes,
  createLocalGasStation,
  executeSponsoredTransaction,
  isSponsoredSuiConfig,
  signSenderForSponsoredTransaction,
  verifySponsoredSignatures,
} from '#chains/sui/index.js'

export type {
  WalletChain,
  EvmErc4337WalletConfig,
  SuiWalletConfig,
  WalletConfigByChain,
  WalletManagerForChain,
} from '#types.js'

export type {
  EvmErc4337WalletCommonConfig,
  EvmErc4337WalletPaymasterTokenConfig,
  EvmErc4337WalletSponsorshipPolicyConfig,
  EvmErc4337WalletNativeCoinsConfig,
} from '#chains/evm.js'

export type {
  SuiTransaction,
  LiveStreakSuiWalletConfig,
  SuiGasStation,
  SuiGasCoinRef,
} from '#chains/sui/index.js'

export type { IWalletAccount } from '@tetherto/wdk-wallet'
export type {
  TransactionResult,
  TransferResult,
  TransferOptions,
  KeyPair,
} from '@tetherto/wdk-wallet'

export type { FeeRates, EvmTransaction } from '@tetherto/wdk-wallet-evm'
