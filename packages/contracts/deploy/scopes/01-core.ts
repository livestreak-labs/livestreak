import type { PublicClient, WalletClient, Address } from "viem";
import { type ScopeResult, deployFromArtifact } from "../utils.js";

// Arc Testnet USDC (chain ID 5042002)
const ARC_USDC = "0x3600000000000000000000000000000000000000" as Address;

export async function deployCore(
  client: PublicClient,
  walletClient: WalletClient,
  _previousScopes: Record<string, ScopeResult>,
  config: { chain: string; rpc: string; deployer: Address }
): Promise<ScopeResult> {
  console.log("Deploying FlowStream core contracts...");
  const contracts: Record<string, string> = {};

  // Determine USDC address — deploy MockUSDC on localhost, use real address on Arc
  let usdcAddress: Address;
  const chainId = await client.getChainId();

  if (chainId === 31337 || chainId === 31337n) {
    console.log("\n  [localhost] Deploying MockUSDC...");
    usdcAddress = await deployFromArtifact(
      walletClient, client,
      "out/MockUSDC.sol/MockUSDC.json",
      undefined, undefined, "flowstream.mockUSDC"
    );
    contracts.mockUSDC = usdcAddress;
  } else {
    usdcAddress = ARC_USDC;
    console.log(`  Using USDC at ${usdcAddress}`);
  }
  contracts.usdc = usdcAddress;

  // 1. FlowToken — no constructor args
  console.log("\n  Deploying FlowToken...");
  const flowToken = await deployFromArtifact(
    walletClient, client,
    "out/FlowToken.sol/FlowToken.json",
    undefined, undefined, "flowstream.flowToken"
  );
  contracts.flowToken = flowToken;

  // 2. AgentRegistry — no constructor args
  console.log("  Deploying AgentRegistry...");
  const agentRegistry = await deployFromArtifact(
    walletClient, client,
    "out/AgentRegistry.sol/AgentRegistry.json",
    undefined, undefined, "flowstream.agentRegistry"
  );
  contracts.agentRegistry = agentRegistry;

  // 3. ObserverRegistry — no constructor args
  console.log("  Deploying ObserverRegistry...");
  const observerRegistry = await deployFromArtifact(
    walletClient, client,
    "out/ObserverRegistry.sol/ObserverRegistry.json",
    undefined, undefined, "flowstream.observerRegistry"
  );
  contracts.observerRegistry = observerRegistry;

  // 4. ProtocolLP — constructor(address _usdc)
  console.log("  Deploying ProtocolLP...");
  const protocolLP = await deployFromArtifact(
    walletClient, client,
    "out/ProtocolLP.sol/ProtocolLP.json",
    [usdcAddress], undefined, "flowstream.protocolLP"
  );
  contracts.protocolLP = protocolLP;

  // 5. Vault — constructor(address _usdc)
  console.log("  Deploying Vault...");
  const vault = await deployFromArtifact(
    walletClient, client,
    "out/Vault.sol/Vault.json",
    [usdcAddress], undefined, "flowstream.vault"
  );
  contracts.vault = vault;

  // 6. Steward — constructor(address _flowToken, address _protocolLP)
  console.log("  Deploying Steward...");
  const steward = await deployFromArtifact(
    walletClient, client,
    "out/Steward.sol/Steward.json",
    [flowToken, protocolLP], undefined, "flowstream.steward"
  );
  contracts.steward = steward;

  console.log("\n  All core contracts deployed.");

  return {
    status: "completed",
    deployedAt: new Date().toISOString(),
    contracts,
  };
}
