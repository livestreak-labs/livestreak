import type { PublicClient, WalletClient, Address } from "viem";
import { type ScopeResult, loadAbi } from "../utils.js";

export async function deployWire(
  client: PublicClient,
  walletClient: WalletClient,
  previousScopes: Record<string, ScopeResult>,
  config: { chain: string; rpc: string; deployer: Address }
): Promise<ScopeResult> {
  console.log("Wiring FlowStream contracts together...");

  const core = previousScopes.core;
  if (core?.status !== "completed" || !core.contracts) {
    return { status: "failed", error: "Core scope not completed" };
  }

  const {
    flowToken,
    vault,
    protocolLP,
    steward,
    agentRegistry,
    observerRegistry,
  } = core.contracts as Record<string, Address>;

  // Load ABIs from forge artifacts
  const flowTokenAbi = loadAbi("out/FlowToken.sol/FlowToken.json");
  const vaultAbi = loadAbi("out/Vault.sol/Vault.json");
  const protocolLPAbi = loadAbi("out/ProtocolLP.sol/ProtocolLP.json");
  const agentRegistryAbi = loadAbi("out/AgentRegistry.sol/AgentRegistry.json");
  const observerRegistryAbi = loadAbi("out/ObserverRegistry.sol/ObserverRegistry.json");

  // Wire FlowToken
  console.log("  flowToken.setVault(vault)...");
  await client.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: flowToken,
      abi: flowTokenAbi,
      functionName: "setVault",
      args: [vault],
    }),
  });

  console.log("  flowToken.setProtocolLP(protocolLP)...");
  await client.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: flowToken,
      abi: flowTokenAbi,
      functionName: "setProtocolLP",
      args: [protocolLP],
    }),
  });

  // Wire ProtocolLP
  console.log("  protocolLP.setFlowToken(flowToken)...");
  await client.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: protocolLP,
      abi: protocolLPAbi,
      functionName: "setFlowToken",
      args: [flowToken],
    }),
  });

  console.log("  protocolLP.setVault(vault)...");
  await client.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: protocolLP,
      abi: protocolLPAbi,
      functionName: "setVault",
      args: [vault],
    }),
  });

  console.log("  protocolLP.setSteward(steward)...");
  await client.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: protocolLP,
      abi: protocolLPAbi,
      functionName: "setSteward",
      args: [steward],
    }),
  });

  // Wire Vault
  console.log("  vault.setFlowToken(flowToken)...");
  await client.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: vault,
      abi: vaultAbi,
      functionName: "setFlowToken",
      args: [flowToken],
    }),
  });

  console.log("  vault.setProtocolLP(protocolLP)...");
  await client.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: vault,
      abi: vaultAbi,
      functionName: "setProtocolLP",
      args: [protocolLP],
    }),
  });

  console.log("  vault.setAgentRegistry(agentRegistry)...");
  await client.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: vault,
      abi: vaultAbi,
      functionName: "setAgentRegistry",
      args: [agentRegistry],
    }),
  });

  // Wire AgentRegistry
  console.log("  agentRegistry.setVault(vault)...");
  await client.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: agentRegistry,
      abi: agentRegistryAbi,
      functionName: "setVault",
      args: [vault],
    }),
  });

  // Wire ObserverRegistry
  console.log("  observerRegistry.setVault(vault)...");
  await client.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: observerRegistry,
      abi: observerRegistryAbi,
      functionName: "setVault",
      args: [vault],
    }),
  });

  console.log("\n  All contracts wired.");

  return {
    status: "completed",
    deployedAt: new Date().toISOString(),
    contracts: {}, // No new contracts — only cross-contract wiring
  };
}
