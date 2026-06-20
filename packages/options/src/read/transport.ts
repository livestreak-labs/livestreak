// --- exports ---

import type {
  LvstAccount,
  MarketId,
  OptionsMarket,
  OptionsNft,
  TokenId,
  UserAddress,
  VaultId
} from "../model/index.js";
import type { OptionsProtocolSummary } from "../model/snapshot.js";
import type { OptionsVault, OptionsVaultShareTotals } from "../model/vault.js";

export interface OptionsReadTransport {
  readMarket(marketId: MarketId): Promise<OptionsMarket>;
  listMarketVaults(marketId: MarketId): Promise<readonly VaultId[]>;
  readVault(vaultId: VaultId): Promise<OptionsVault>;
  readVaultShareTotals(vaultId: VaultId): Promise<OptionsVaultShareTotals>;
  listOwnerTokens(owner: UserAddress): Promise<readonly TokenId[]>;
  readNft(tokenId: TokenId, owner: UserAddress): Promise<OptionsNft>;
  readLvstAccount(user: UserAddress): Promise<LvstAccount>;
  readProtocolSummary?(): Promise<OptionsProtocolSummary>;
}
