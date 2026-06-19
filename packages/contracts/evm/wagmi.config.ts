import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

export default defineConfig({
  out: "generated/contracts.ts",
  plugins: [
    foundry({
      project: ".",
      include: [
        "Protocol.sol/Protocol.json",
        "MarketRegistry.sol/MarketRegistry.json",
        "BookmakerRegistry.sol/BookmakerRegistry.json",
        "VaultFactory.sol/VaultFactory.json",
        "Vault.sol/Vault.json",
        "LvstToken.sol/LvstToken.json",
        "Treasury.sol/Treasury.json",
        "StewardRegistry.sol/StewardRegistry.json",
        "DripsStreaming.sol/DripsStreaming.json",
        "IDrips.sol/IDrips.json",
        "Caller.sol/Caller.json",
        "AddressDriver.sol/AddressDriver.json",
        "VaultDriver.sol/VaultDriver.json",
        "LiveStreakPaymaster.sol/LiveStreakPaymaster.json"
      ]
    })
  ]
});
