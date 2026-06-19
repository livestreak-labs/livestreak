import type { Abi, Address, PublicClient, WalletClient } from "viem";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import { deployFromArtifact, type ScopeResult } from "../utils.js";

const LABEL = "livestreak";
const CONTRACTS_ROOT = resolve(import.meta.dirname, "../..");

const loadAbi = (artifactPath: string): Abi =>
  JSON.parse(readFileSync(join(CONTRACTS_ROOT, artifactPath), "utf-8")).abi;

export async function deployWire(
  client: PublicClient,
  walletClient: WalletClient,
  previousScopes: Record<string, ScopeResult>,
  config: { chain: string; rpc: string; deployer: Address }
): Promise<ScopeResult> {
  console.log("Wiring protocol + streaming...");

  const streaming = previousScopes.streaming;
  const protocolScope = previousScopes.protocol;
  if (streaming?.status !== "completed" || !streaming.contracts) {
    return { status: "failed", error: "Streaming scope not completed" };
  }
  if (protocolScope?.status !== "completed" || !protocolScope.contracts) {
    return { status: "failed", error: "Protocol scope not completed" };
  }

  const { dripsProxy, caller } = streaming.contracts as Record<string, Address>;
  const { protocol, vault, vaultFactory, marketRegistry, bookmakerRegistry, mockUsdc, stewardRegistry, lvstToken, treasury } =
    protocolScope.contracts as Record<string, Address>;
  const { deployer } = config;

  try {
    const protocolAbi = loadAbi("out/Protocol.sol/Protocol.json");
    const vaultAbi = loadAbi("out/Vault.sol/Vault.json");
    const dripsAbi = loadAbi("out/IDrips.sol/IDrips.json");
    const stewardAbi = loadAbi("out/StewardRegistry.sol/StewardRegistry.json");

    const write = async (address: Address, abi: Abi, functionName: string, args: readonly unknown[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hash = await walletClient.writeContract({ address, abi, functionName, args } as any);
      await client.waitForTransactionReceipt({ hash });
    };

    // 1. Protocol address book (core modules).
    await write(protocol, protocolAbi, "setMarketRegistry", [marketRegistry]);
    await write(protocol, protocolAbi, "setBookmakerRegistry", [bookmakerRegistry]);
    await write(protocol, protocolAbi, "setVault", [vault]);
    await write(protocol, protocolAbi, "setVaultFactory", [vaultFactory]);
    await write(protocol, protocolAbi, "setStewardRegistry", [stewardRegistry]);
    await write(protocol, protocolAbi, "setLvstToken", [lvstToken]);
    await write(protocol, protocolAbi, "setTreasury", [treasury]);
    await write(protocol, protocolAbi, "setDripsStreaming", [dripsProxy]);

    // Vault registers as the Drips receiver driver before the user driver slot is reserved.
    await write(vault, vaultAbi, "bootstrapStreaming", [mockUsdc]);

    // Reserve the user driver slot (FD_user), deploy AddressDriver, register on Protocol.
    const driverId = Number(
      await client.readContract({ address: dripsProxy, abi: dripsAbi, functionName: "nextDriverId" })
    );
    console.log(`  Registering AddressDriver slot (FD_user=${driverId})...`);
    await write(dripsProxy, dripsAbi, "registerDriver", [deployer]);

    const addressDriverLogic = await deployFromArtifact(
      walletClient,
      client,
      "out/AddressDriver.sol/AddressDriver.json",
      [dripsProxy, caller, driverId, vault, mockUsdc],
      undefined,
      `${LABEL}.addressDriverLogic`
    );
    const addressDriverProxy = await deployFromArtifact(
      walletClient,
      client,
      "out/Managed.sol/ManagedProxy.json",
      [addressDriverLogic, deployer, "0x"],
      undefined,
      `${LABEL}.addressDriverProxy`
    );
    await write(dripsProxy, dripsAbi, "updateDriverAddress", [driverId, addressDriverProxy]);
    await write(protocol, protocolAbi, "setAddressDriver", [addressDriverProxy]);
    console.log(`    addressDriverProxy → ${addressDriverProxy}`);

    // Vault one-shot sync of factory, funding driver, resolver, and Treasury from Protocol.
    await write(vault, vaultAbi, "syncFromProtocol", []);
    console.log(`    vault synced from Protocol`);

    // 4. First steward for local deploy.
    await write(stewardRegistry, stewardAbi, "registerSteward", [deployer]);
    console.log(`    resolver → stewardRegistry ${stewardRegistry}`);

    console.log("  Protocol + streaming wired.");

    return {
      status: "completed",
      deployedAt: new Date().toISOString(),
      contracts: { addressDriverLogic, addressDriverProxy }
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
