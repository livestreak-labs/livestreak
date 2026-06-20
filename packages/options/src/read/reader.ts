// --- exports ---

import type { LvstAccount } from "../model/lvst.js";
import type {
  MarketId,
  TokenId,
  UserAddress,
  VaultId
} from "../model/ids.js";
import type { OptionsBoardState } from "../model/math/accrual.js";
import type { OptionsMarket } from "../model/market.js";
import type { OptionsNft } from "../model/nft.js";
import type { OptionsProtocolSummary } from "../model/snapshot.js";
import type { OptionsStreamState } from "../model/stream.js";
import type { OptionsVault } from "../model/vault.js";
import type { OptionsVaultShareTotals, OptionsVaultSide } from "../model/vault.js";
import {
  readAccountVaultIds,
  readClaimable,
  readCollected,
  readLossClaimable,
  readPot,
  readWinningSide
} from "./claims.js";
import {
  createReaderContext,
  type OptionsReaderInput
} from "./context.js";
import {
  listMarketVaults,
  loadProtocolSummary,
  readMarket,
  readStreamState as readMarketStreamState
} from "./market.js";
import {
  listOwnerTokens,
  readApproved,
  readIsApprovedForAll,
  readNft,
  readNftBalance,
  readOwnerOf
} from "./nft.js";
import { readLvstAccount, readUsdcAddress } from "./lvst.js";
import type { OptionsReadTransport } from "./transport.js";
import {
  readBoard,
  readPendingShares,
  readSharePrice,
  readVault,
  readVaultShareTotals
} from "./vault.js";

export type { OptionsContractAbis } from "./context.js";

export const createOptionsReader = (input: OptionsReaderInput): OptionsReadTransport =>
  new OptionsReader(input);

class OptionsReader implements OptionsReadTransport {
  private readonly ctx;
  readonly readProtocolSummary?: () => Promise<OptionsProtocolSummary>;

  constructor(input: OptionsReaderInput) {
    this.ctx = createReaderContext(input);

    if (input.includeProtocolSummary === true) {
      this.readProtocolSummary = async () => loadProtocolSummary(this.ctx);
    }
  }

  readMarket(marketId: MarketId): Promise<OptionsMarket> {
    return readMarket(this.ctx, marketId);
  }

  readStreamState(marketId: MarketId): Promise<OptionsStreamState> {
    return readMarketStreamState(this.ctx, marketId);
  }

  listMarketVaults(marketId: MarketId): Promise<readonly VaultId[]> {
    return listMarketVaults(this.ctx, marketId);
  }

  readVault(vaultId: VaultId): Promise<OptionsVault> {
    return readVault(this.ctx, vaultId);
  }

  readVaultShareTotals(vaultId: VaultId): Promise<OptionsVaultShareTotals> {
    return readVaultShareTotals(this.ctx, vaultId);
  }

  listOwnerTokens(owner: UserAddress): Promise<readonly TokenId[]> {
    return listOwnerTokens(this.ctx, owner);
  }

  readNft(tokenId: TokenId, owner: UserAddress): Promise<OptionsNft> {
    return readNft(this.ctx, tokenId, owner);
  }

  readClaimable(
    tokenId: TokenId,
    vaultId: VaultId,
    side: OptionsVaultSide
  ): Promise<bigint> {
    return readClaimable(this.ctx, tokenId, vaultId, side);
  }

  readLossClaimable(
    tokenId: TokenId,
    vaultId: VaultId,
    side: OptionsVaultSide
  ): Promise<bigint> {
    return readLossClaimable(this.ctx, tokenId, vaultId, side);
  }

  readPot(vaultId: VaultId): Promise<bigint> {
    return readPot(this.ctx, vaultId);
  }

  readCollected(vaultId: VaultId): Promise<boolean> {
    return readCollected(this.ctx, vaultId);
  }

  readAccountVaultIds(tokenId: TokenId): Promise<readonly VaultId[]> {
    return readAccountVaultIds(this.ctx, tokenId);
  }

  readWinningSide(vaultId: VaultId): Promise<OptionsVaultSide | undefined> {
    return readWinningSide(this.ctx, vaultId);
  }

  readBoard(vaultId: VaultId, side: OptionsVaultSide): Promise<OptionsBoardState> {
    return readBoard(this.ctx, vaultId, side);
  }

  readSharePrice(vaultId: VaultId, side: OptionsVaultSide): Promise<bigint> {
    return readSharePrice(this.ctx, vaultId, side);
  }

  readPendingShares(
    vaultId: VaultId,
    side: OptionsVaultSide,
    tokenId: TokenId
  ): Promise<bigint> {
    return readPendingShares(this.ctx, vaultId, side, tokenId);
  }

  readUsdcAddress(): Promise<`0x${string}`> {
    return readUsdcAddress(this.ctx);
  }

  readNftBalance(tokenId: TokenId): Promise<bigint> {
    return readNftBalance(this.ctx, tokenId);
  }

  readOwnerOf(tokenId: TokenId): Promise<UserAddress> {
    return readOwnerOf(this.ctx, tokenId);
  }

  readApproved(tokenId: TokenId): Promise<UserAddress | undefined> {
    return readApproved(this.ctx, tokenId);
  }

  readIsApprovedForAll(owner: UserAddress, operator: UserAddress): Promise<boolean> {
    return readIsApprovedForAll(this.ctx, owner, operator);
  }

  readLvstAccount(user: UserAddress): Promise<LvstAccount> {
    return readLvstAccount(this.ctx, user);
  }
}
