import { Schema } from "effect";

// EVM hex address. xylkstream's wdkConfig passed plain strings; kept as strings here.
export const Address = Schema.String;
export type Address = Schema.Schema.Type<typeof Address>;

// Per-chain ERC-4337 / Safe deployment addresses.
// Mirrors xylkstream `wdkConfig.contractNetworks[chainKey]` field-for-field.
export const Erc4337ContractNetwork = Schema.Struct({
  safeSingletonAddress: Address,
  safeProxyFactoryAddress: Address,
  multiSendAddress: Address,
  multiSendCallOnlyAddress: Address,
  fallbackHandlerAddress: Address,
  signMessageLibAddress: Address,
  createCallAddress: Address,
  simulateTxAccessorAddress: Address
});
export type Erc4337ContractNetwork = Schema.Schema.Type<typeof Erc4337ContractNetwork>;

// EVM ERC-4337 wallet config — mirrors xylkstream's `wdkConfig` 1:1.
// EVM-generalist: the chain is data, never baked. Every field is CALLER-INJECTED;
// a package that connects the wallet must never hardcode any of it.
export const WalletInitConfig = Schema.Struct({
  chainId: Schema.Number,
  provider: Schema.String, // rpc url (xylkstream field name)
  bundlerUrl: Schema.String, // e.g. {host}/aa/bundler/{chain}
  paymasterUrl: Schema.optional(Schema.String), // absent = self-pay (not sponsored)
  isSponsored: Schema.Boolean,
  useNativeCoins: Schema.Boolean,
  entryPointAddress: Address,
  safe4337ModuleAddress: Address,
  safeModulesSetupAddress: Address,
  safeModulesVersion: Schema.String, // e.g. "0.3.0"
  gasOverrides: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  contractNetworks: Schema.Record({ key: Schema.String, value: Erc4337ContractNetwork })
});
export type WalletInitConfig = Schema.Schema.Type<typeof WalletInitConfig>;

// Where the seed comes from. The SECRET bytes are supplied at runtime by the caller —
// never serialized into this schema, the package, or the repo.
export const WalletSeedSource = Schema.Literal("raw", "mnemonic", "signature-derived");
export type WalletSeedSource = Schema.Schema.Type<typeof WalletSeedSource>;

// The full EVM wallet-init expectation a package declares for the caller (composition root) to fill.
export const WalletInit = Schema.Struct({
  seedSource: WalletSeedSource,
  config: WalletInitConfig
});
export type WalletInit = Schema.Schema.Type<typeof WalletInit>;

// SUI wallet config. Sui signs natively (Ed25519), so there is NO bundler / paymaster /
// entryPoint / Safe apparatus — only RPC connectivity. Every field is CALLER-INJECTED.
export const SuiWalletInitConfig = Schema.Struct({
  rpcUrl: Schema.Union(Schema.String, Schema.Array(Schema.String)), // one endpoint or a failover list
  retries: Schema.optional(Schema.Number)
});
export type SuiWalletInitConfig = Schema.Schema.Type<typeof SuiWalletInitConfig>;

// Which chain a wallet-init targets. Mirrors @livestreak/wallet createWalletManager's switch key.
export const WalletChain = Schema.Literal("evm", "sui");
export type WalletChain = Schema.Schema.Type<typeof WalletChain>;

// Chain-discriminated injected wallet-init. The caller supplies the chain + its native config;
// the secret seed bytes still arrive separately at runtime, never in this schema.
export const ChainWalletInit = Schema.Union(
  Schema.Struct({
    chain: Schema.Literal("evm"),
    seedSource: WalletSeedSource,
    config: WalletInitConfig
  }),
  Schema.Struct({
    chain: Schema.Literal("sui"),
    seedSource: WalletSeedSource,
    config: SuiWalletInitConfig
  })
);
export type ChainWalletInit = Schema.Schema.Type<typeof ChainWalletInit>;
