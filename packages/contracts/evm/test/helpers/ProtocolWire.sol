// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Protocol} from "../../src/Protocol.sol";
import {BookmakerRegistry} from "../../src/registries/BookmakerRegistry.sol";
import {MarketRegistry} from "../../src/registries/MarketRegistry.sol";
import {StewardRegistry} from "../../src/steward/StewardRegistry.sol";
import {LvstToken} from "../../src/treasury/LvstToken.sol";
import {Treasury} from "../../src/treasury/Treasury.sol";
import {Vault} from "../../src/vault/Vault.sol";
import {VaultFactory} from "../../src/vault/VaultFactory.sol";
import {DripsStreaming} from "../../src/streaming/DripsStreaming.sol";
import {ManagedProxy} from "../../src/streaming/Managed.sol";
import {IDrips} from "../../src/streaming/IDrips.sol";
import {AddressDriver} from "../../src/streaming/drivers/AddressDriver.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {Vm} from "forge-std/Vm.sol";

/// @dev Shared deploy + Protocol wiring for Foundry tests and local harnesses.
library ProtocolWire {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Core {
        Protocol protocol;
        BookmakerRegistry bookmakerRegistry;
        MarketRegistry marketRegistry;
        Vault vault;
        VaultFactory vaultFactory;
        StewardRegistry stewardRegistry;
        LvstToken lvstToken;
        Treasury treasury;
        MockUSDC usdc;
    }

    struct Streaming {
        DripsStreaming drips;
        AddressDriver addressDriver;
    }

    function deployCore(address owner, IERC20 usdc) internal returns (Core memory core) {
        core.protocol = new Protocol(owner);
        core.bookmakerRegistry = new BookmakerRegistry(owner);
        core.marketRegistry = new MarketRegistry(owner, core.protocol);
        core.vault = new Vault(core.protocol);
        core.vaultFactory = new VaultFactory(core.bookmakerRegistry, core.marketRegistry, core.vault);
        core.stewardRegistry = new StewardRegistry(owner, core.protocol);
        core.lvstToken = new LvstToken(core.protocol);
        core.treasury = new Treasury(owner, usdc, core.protocol);
        core.usdc = MockUSDC(address(usdc));
    }

    function setProtocolCore(address owner, Core memory core) internal {
        vm.startPrank(owner);
        core.protocol.setMarketRegistry(address(core.marketRegistry));
        core.protocol.setBookmakerRegistry(address(core.bookmakerRegistry));
        core.protocol.setVault(address(core.vault));
        core.protocol.setVaultFactory(address(core.vaultFactory));
        core.protocol.setStewardRegistry(address(core.stewardRegistry));
        core.protocol.setLvstToken(address(core.lvstToken));
        core.protocol.setTreasury(address(core.treasury));
        vm.stopPrank();
    }

    function deployStreaming(address admin, Vault vault, MockUSDC usdc, uint32 cycleSecs)
        internal
        returns (Streaming memory streaming)
    {
        vault;
        usdc;
        DripsStreaming logic = new DripsStreaming(cycleSecs);
        streaming.drips = DripsStreaming(address(new ManagedProxy(logic, admin, "")));
    }

    function finishStreaming(address admin, Vault vault, MockUSDC usdc, Streaming memory streaming)
        internal
        returns (Streaming memory)
    {
        vm.startPrank(admin);
        uint32 addrDriverId = streaming.drips.registerDriver(admin);
        vm.stopPrank();

        AddressDriver driverLogic =
            new AddressDriver(IDrips(address(streaming.drips)), address(0), addrDriverId, vault, IERC20(address(usdc)));
        streaming.addressDriver = AddressDriver(address(new ManagedProxy(driverLogic, admin, "")));

        vm.prank(admin);
        streaming.drips.updateDriverAddress(addrDriverId, address(streaming.addressDriver));
        return streaming;
    }

    function setProtocolStreaming(address owner, Protocol protocol, Streaming memory streaming) internal {
        vm.startPrank(owner);
        protocol.setDripsStreaming(address(streaming.drips));
        protocol.setAddressDriver(address(streaming.addressDriver));
        vm.stopPrank();
    }

    function syncVault(Vault vault) internal {
        vault.syncFromProtocol();
    }

    function wireAll(address owner, Core memory core, Streaming memory streaming) internal returns (Streaming memory) {
        return wireAll(owner, core, streaming, true);
    }

    function wireAll(address owner, Core memory core, Streaming memory streaming, bool withLvst)
        internal
        returns (Streaming memory)
    {
        vm.startPrank(owner);
        core.protocol.setMarketRegistry(address(core.marketRegistry));
        core.protocol.setBookmakerRegistry(address(core.bookmakerRegistry));
        core.protocol.setVault(address(core.vault));
        core.protocol.setVaultFactory(address(core.vaultFactory));
        core.protocol.setStewardRegistry(address(core.stewardRegistry));
        if (withLvst) {
            core.protocol.setLvstToken(address(core.lvstToken));
            core.protocol.setTreasury(address(core.treasury));
        }
        core.protocol.setDripsStreaming(address(streaming.drips));
        vm.stopPrank();

        core.vault.bootstrapStreaming(IERC20(address(core.usdc)));
        streaming = finishStreaming(owner, core.vault, core.usdc, streaming);

        vm.startPrank(owner);
        core.protocol.setAddressDriver(address(streaming.addressDriver));
        vm.stopPrank();

        syncVault(core.vault);
        return streaming;
    }
}
