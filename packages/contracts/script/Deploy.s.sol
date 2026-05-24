// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/Vault.sol";
import "../src/FlowToken.sol";
import "../src/ProtocolLP.sol";
import "../src/Steward.sol";
import "../src/AgentRegistry.sol";
import "../src/ObserverRegistry.sol";

/// @title Deploy — FlowStream protocol deployment
/// @notice Deploys all contracts in dependency order and wires them together.
///         Env vars: PRIVATE_KEY (required)
///         Optional: USDC_ADDRESS (defaults to Arc Testnet USDC)
contract Deploy is Script {
    // Arc Testnet USDC address (chain ID 5042002)
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Allow USDC override for local/other chain deployments
        address usdcAddress = vm.envOr("USDC_ADDRESS", ARC_USDC);

        console.log("=== DEPLOYING FLOWSTREAM ===");
        console.log("Deployer:", deployer);
        console.log("USDC:", usdcAddress);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy standalone contracts first
        FlowToken flowToken = new FlowToken();
        AgentRegistry agentRegistry = new AgentRegistry();
        ObserverRegistry observerRegistry = new ObserverRegistry();

        // 2. Deploy ProtocolLP (needs USDC address)
        ProtocolLP protocolLP = new ProtocolLP(usdcAddress);

        // 3. Deploy Vault (needs USDC address)
        Vault vault = new Vault(usdcAddress);

        // 4. Deploy Steward (needs FlowToken and ProtocolLP)
        Steward steward = new Steward(address(flowToken), address(protocolLP));

        // 5. Wire everything together
        flowToken.setVault(address(vault));
        flowToken.setProtocolLP(address(protocolLP));

        protocolLP.setFlowToken(address(flowToken));
        protocolLP.setVault(address(vault));
        protocolLP.setSteward(address(steward));

        vault.setFlowToken(address(flowToken));
        vault.setProtocolLP(address(protocolLP));
        vault.setAgentRegistry(address(agentRegistry));

        agentRegistry.setVault(address(vault));
        observerRegistry.setVault(address(vault));

        vm.stopBroadcast();

        // Log deployment manifest (parseable by deploy/main.ts)
        console.log("=== DEPLOYMENT_MANIFEST_START ===");
        console.log("USDC=%s", usdcAddress);
        console.log("FlowToken=%s", address(flowToken));
        console.log("AgentRegistry=%s", address(agentRegistry));
        console.log("ObserverRegistry=%s", address(observerRegistry));
        console.log("ProtocolLP=%s", address(protocolLP));
        console.log("Vault=%s", address(vault));
        console.log("Steward=%s", address(steward));
        console.log("=== DEPLOYMENT_MANIFEST_END ===");
    }
}
