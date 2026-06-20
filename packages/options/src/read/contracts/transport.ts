// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import {
  lvstTokenAbi,
  marketDriverAbi,
  marketRegistryAbi,
  stewardRegistryAbi,
  treasuryAbi,
  vaultAbi
} from "@livestreak/contracts/evm/abis";

import { asMarketId, asTokenId, asVaultId } from "../../model/ids.js";
import type { LvstAccount } from "../../model/lvst.js";
import type { MarketId, TokenId, UserAddress, VaultId } from "../../model/ids.js";
import type { OptionsMarket } from "../../model/market.js";
import type { OptionsNft } from "../../model/nft.js";
import type { OptionsProtocolSummary } from "../../model/snapshot.js";
import type { OptionsVault } from "../../model/vault.js";
import type { OptionsVaultShareTotals } from "../../model/vault.js";
import type { OptionsReadTransport } from "../transport.js";
import type { OptionsContractAddresses } from "./addresses.js";
import { contractsReadFailed, contractsReadNotFound } from "./errors.js";
import {
  bytes32ToHex,
  mapLane,
  mapLvstAccount,
  mapMarket,
  mapNft,
  mapProtocolSummary,
  mapVault,
  mapVaultIds,
  mapVaultPools,
  mapVaultShareTotals,
  type RawDisputeState,
  type RawHotState,
  type RawLane,
  type RawMarketData,
  type RawPosition,
  type RawVaultData,
  type RawVaultPools
} from "./mapping.js";
import { sideToSolidityValue } from "./sides.js";
import {
  validateMarketIdForContracts,
  validateOptionsContractAddresses,
  validateTokenIdForContracts,
  validateUserAddress,
  validateVaultIdForContracts
} from "./validation.js";

export type ContractReadRequest = {
  readonly address: `0x${string}`;
  readonly abi: readonly unknown[];
  readonly functionName: string;
  readonly args?: readonly unknown[];
};

export type ContractReader = {
  readonly read: (request: ContractReadRequest) => Promise<unknown>;
};

export type OptionsContractAbis = {
  readonly MarketRegistry: typeof marketRegistryAbi;
  readonly Vault: typeof vaultAbi;
  readonly MarketDriver: typeof marketDriverAbi;
  readonly StewardRegistry: typeof stewardRegistryAbi;
  readonly Treasury: typeof treasuryAbi;
  readonly LvstToken: typeof lvstTokenAbi;
};

const DEFAULT_ABIS: OptionsContractAbis = {
  MarketRegistry: marketRegistryAbi,
  Vault: vaultAbi,
  MarketDriver: marketDriverAbi,
  StewardRegistry: stewardRegistryAbi,
  Treasury: treasuryAbi,
  LvstToken: lvstTokenAbi
};

export type ContractsOptionsReadTransportInput = {
  readonly reader: ContractReader;
  readonly addresses: OptionsContractAddresses;
  readonly abis?: OptionsContractAbis;
  readonly includeProtocolSummary?: boolean;
};

export const createContractsOptionsReadTransport = (
  input: ContractsOptionsReadTransportInput
): OptionsReadTransport => new ContractsOptionsReadTransport(input);

class ContractsOptionsReadTransport implements OptionsReadTransport {
  private readonly reader: ContractReader;
  private readonly addresses: OptionsContractAddresses;
  private readonly abis: OptionsContractAbis;
  readonly readProtocolSummary?: () => Promise<OptionsProtocolSummary>;

  constructor(input: ContractsOptionsReadTransportInput) {
    this.reader = input.reader;
    this.addresses = validateOptionsContractAddresses(input.addresses);
    this.abis = input.abis ?? DEFAULT_ABIS;

    if (input.includeProtocolSummary === true) {
      this.readProtocolSummary = async () => this.loadProtocolSummary();
    }
  }

  async readMarket(marketId: MarketId): Promise<OptionsMarket> {
    const marketBytes = validateMarketIdForContracts(marketId);

    try {
      const exists = await this.call<boolean>(
        this.addresses.marketRegistry,
        this.abis.MarketRegistry,
        "marketExists",
        [marketBytes]
      );

      if (!exists) {
        throw contractsReadNotFound("market", marketId);
      }

      const market = await this.call<RawMarketData>(
        this.addresses.marketRegistry,
        this.abis.MarketRegistry,
        "getMarket",
        [marketBytes]
      );

      const vaultIdsRaw = await this.call<readonly `0x${string}`[]>(
        this.addresses.marketRegistry,
        this.abis.MarketRegistry,
        "getVaultIds",
        [marketBytes]
      );

      return mapMarket(asMarketId(bytes32ToHex(market.id)), market, mapVaultIds(vaultIdsRaw));
    } catch (error) {
      if (error instanceof LiveStreakConfigError) {
        throw error;
      }

      throw contractsReadFailed("market", error);
    }
  }

  async listMarketVaults(marketId: MarketId): Promise<readonly VaultId[]> {
    const market = await this.readMarket(marketId);
    return market.vaultIds;
  }

  async readVault(vaultId: VaultId): Promise<OptionsVault> {
    const vaultBytes = validateVaultIdForContracts(vaultId);

    try {
      const data = await this.call<RawVaultData>(
        this.addresses.vault,
        this.abis.Vault,
        "getVault",
        [vaultBytes]
      );

      if (!data.exists) {
        throw contractsReadNotFound("vault", vaultId);
      }

      const pools = await this.call<RawVaultPools>(
        this.addresses.vault,
        this.abis.Vault,
        "getVaultPools",
        [vaultBytes]
      );

      const hot = await this.call<RawHotState>(
        this.addresses.stewardRegistry,
        this.abis.StewardRegistry,
        "vaultHotState",
        [vaultBytes]
      );

      const dispute = await this.call<RawDisputeState>(
        this.addresses.stewardRegistry,
        this.abis.StewardRegistry,
        "disputeState",
        [vaultBytes]
      );

      return mapVault(data, pools, hot, dispute);
    } catch (error) {
      if (error instanceof LiveStreakConfigError) {
        throw error;
      }

      throw contractsReadFailed("vault", error);
    }
  }

  async readVaultShareTotals(vaultId: VaultId): Promise<OptionsVaultShareTotals> {
    const poolsRaw = await this.readVaultPools(vaultId);
    return mapVaultShareTotals(poolsRaw);
  }

  private async readVaultPools(vaultId: VaultId): Promise<RawVaultPools> {
    const vaultBytes = validateVaultIdForContracts(vaultId);
    return this.call<RawVaultPools>(this.addresses.vault, this.abis.Vault, "getVaultPools", [
      vaultBytes
    ]);
  }

  async listOwnerTokens(owner: UserAddress): Promise<readonly TokenId[]> {
    const account = validateUserAddress(owner);

    try {
      const tokenIds = await this.call<readonly bigint[]>(
        this.addresses.marketDriver,
        this.abis.MarketDriver,
        "tokensOfOwner",
        [account as `0x${string}`]
      );

      return tokenIds.map((id) => asTokenId(id));
    } catch (error) {
      throw contractsReadFailed("owner tokens", error);
    }
  }

  async readNft(tokenId: TokenId, owner: UserAddress): Promise<OptionsNft> {
    const id = validateTokenIdForContracts(tokenId);
    const account = validateUserAddress(owner);

    try {
      const marketIdRaw = await this.call<`0x${string}`>(
        this.addresses.marketDriver,
        this.abis.MarketDriver,
        "marketIdOf",
        [id]
      );

      const laneCount = await this.call<bigint>(
        this.addresses.marketDriver,
        this.abis.MarketDriver,
        "laneCount",
        [id]
      );

      const count = Number(laneCount);
      const lanes = [];

      for (let index = 0; index < count; index += 1) {
        const lane = await this.call<RawLane>(
          this.addresses.marketDriver,
          this.abis.MarketDriver,
          "laneAt",
          [id, BigInt(index)]
        );

        const vaultBytes = lane.vaultId;
        const position = await this.call<RawPosition>(
          this.addresses.vault,
          this.abis.Vault,
          "getPosition",
          [vaultBytes, lane.side, id]
        );

        lanes.push(mapLane(asTokenId(id), lane, position));
      }

      return mapNft(
        asTokenId(id),
        account,
        asMarketId(bytes32ToHex(marketIdRaw)),
        count,
        lanes
      );
    } catch (error) {
      if (error instanceof LiveStreakConfigError) {
        throw error;
      }

      throw contractsReadFailed("nft", error);
    }
  }

  async readLvstAccount(user: UserAddress): Promise<LvstAccount> {
    const account = validateUserAddress(user);

    try {
      const balance = await this.call<bigint>(
        this.addresses.lvstToken,
        this.abis.LvstToken,
        "balanceOf",
        [account as `0x${string}`]
      );

      const staked = await this.call<bigint>(
        this.addresses.treasury,
        this.abis.Treasury,
        "lvstStaked",
        [account as `0x${string}`]
      );

      const pendingDividends = await this.call<bigint>(
        this.addresses.treasury,
        this.abis.Treasury,
        "lvstPendingDividends",
        [account as `0x${string}`]
      );

      return mapLvstAccount(account, balance, staked, pendingDividends);
    } catch (error) {
      throw contractsReadFailed("LVST account", error);
    }
  }

  private async loadProtocolSummary(): Promise<OptionsProtocolSummary> {
    try {
      const marketCount = await this.call<bigint>(
        this.addresses.marketRegistry,
        this.abis.MarketRegistry,
        "marketCount",
        []
      );

      let vaultCount = 0;
      const count = Number(marketCount);

      for (let index = 0; index < count; index += 1) {
        const marketId = await this.call<`0x${string}`>(
          this.addresses.marketRegistry,
          this.abis.MarketRegistry,
          "marketIdAt",
          [BigInt(index)]
        );
        const ids = await this.call<readonly `0x${string}`[]>(
          this.addresses.marketRegistry,
          this.abis.MarketRegistry,
          "getVaultIds",
          [marketId]
        );
        vaultCount += ids.length;
      }

      return mapProtocolSummary(marketCount, vaultCount);
    } catch (error) {
      throw contractsReadFailed("protocol summary", error);
    }
  }

  private async call<T>(
    address: `0x${string}`,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[] = []
  ): Promise<T> {
    return (await this.reader.read({ address, abi, functionName, args })) as T;
  }
}

export type { RawVaultPools };
export { mapVaultPools, mapVaultShareTotals };
