// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MarketRegistry} from "../../solidity/registries/MarketRegistry.sol";
import {VaultDriver} from "../../solidity/streaming/drivers/VaultDriver.sol";
import {Vault} from "../../solidity/vault/Vault.sol";
import {Protocol} from "../../solidity/Protocol.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {ProtocolWire} from "../helpers/ProtocolWire.sol";

contract StreamLifecycleTest is Test {
    MarketRegistry internal marketRegistry;
    VaultDriver internal vaultDriver;
    Vault internal vault;
    MockUSDC internal usdc;
    Protocol internal protocol;

    address internal owner = makeAddr("owner");
    address internal creator = makeAddr("creator");
    address internal stranger = makeAddr("stranger");

    bytes32 internal marketId;
    bytes32 internal livePtr = bytes32(uint256(0x11));
    bytes32 internal vodPtr = bytes32(uint256(0x22));
    bytes32 internal vodRevisePtr = bytes32(uint256(0x33));

    function setUp() public {
        usdc = new MockUSDC();
        ProtocolWire.Core memory core = ProtocolWire.deployCore(owner, IERC20(address(usdc)));
        protocol = core.protocol;
        marketRegistry = core.marketRegistry;
        vault = core.vault;

        ProtocolWire.Streaming memory streaming = ProtocolWire.deployStreaming(owner, vault, usdc, 10);
        streaming = ProtocolWire.wireAll(owner, core, streaming);
        vaultDriver = core.vaultDriver;

        vm.prank(creator);
        marketId = marketRegistry.registerMarket("Stream market", bytes32("stream-lifecycle"));
    }

    function _stream(bytes32 id) internal view returns (MarketRegistry.StreamState memory) {
        (MarketRegistry.StreamStatus status, bytes32 pointer, uint64 updatedAt, uint64 endedAt) =
            marketRegistry.streamState(id);
        return MarketRegistry.StreamState({status: status, pointer: pointer, updatedAt: updatedAt, endedAt: endedAt});
    }

    function test_goLive_setsLiveAndEmits() public {
        uint256 t0 = block.timestamp;

        vm.expectEmit(true, false, false, true, address(marketRegistry));
        emit MarketRegistry.StreamLive(marketId, livePtr, uint64(t0));
        vm.prank(creator);
        marketRegistry.goLive(marketId, livePtr);

        MarketRegistry.StreamState memory s = _stream(marketId);
        assertEq(uint8(s.status), uint8(MarketRegistry.StreamStatus.Live));
        assertEq(s.pointer, livePtr);
        assertEq(s.updatedAt, uint64(t0));
        assertEq(s.endedAt, 0);
    }

    function test_goLive_nonCreatorReverts() public {
        vm.prank(stranger);
        vm.expectRevert("MarketRegistry: not creator");
        marketRegistry.goLive(marketId, livePtr);
    }

    function test_goLive_unknownMarketReverts() public {
        vm.prank(creator);
        vm.expectRevert("MarketRegistry: unknown market");
        marketRegistry.goLive(bytes32(uint256(999)), livePtr);
    }

    function test_goLive_zeroPointerReverts() public {
        vm.prank(creator);
        vm.expectRevert("MarketRegistry: zero pointer");
        marketRegistry.goLive(marketId, bytes32(0));
    }

    function test_goLive_whileLiveRepoints() public {
        bytes32 repointed = bytes32(uint256(0x44));

        vm.startPrank(creator);
        marketRegistry.goLive(marketId, livePtr);
        marketRegistry.goLive(marketId, repointed);
        vm.stopPrank();

        MarketRegistry.StreamState memory s = _stream(marketId);
        assertEq(uint8(s.status), uint8(MarketRegistry.StreamStatus.Live));
        assertEq(s.pointer, repointed);
    }

    function test_setEnded_fromLiveSetsEndedAndEmits() public {
        vm.prank(creator);
        marketRegistry.goLive(marketId, livePtr);

        uint256 t1 = block.timestamp;
        vm.expectEmit(true, false, false, true, address(marketRegistry));
        emit MarketRegistry.StreamEnded(marketId, vodPtr, uint64(t1));
        vm.prank(creator);
        marketRegistry.setEnded(marketId, vodPtr);

        MarketRegistry.StreamState memory s = _stream(marketId);
        assertEq(uint8(s.status), uint8(MarketRegistry.StreamStatus.Ended));
        assertEq(s.pointer, vodPtr);
        assertEq(s.endedAt, uint64(t1));
    }

    function test_setEnded_fromNoneReverts() public {
        vm.prank(creator);
        vm.expectRevert("MarketRegistry: not live");
        marketRegistry.setEnded(marketId, vodPtr);
    }

    function test_setEnded_nonCreatorReverts() public {
        vm.prank(creator);
        marketRegistry.goLive(marketId, livePtr);

        vm.prank(stranger);
        vm.expectRevert("MarketRegistry: not creator");
        marketRegistry.setEnded(marketId, vodPtr);
    }

    function test_setEnded_reviseWithinGrace_keepsEndedAt() public {
        uint256 t0 = 1_700_000_000;
        vm.warp(t0);

        vm.startPrank(creator);
        marketRegistry.goLive(marketId, livePtr);
        marketRegistry.setEnded(marketId, vodPtr);
        vm.warp(t0 + 12 hours);
        marketRegistry.setEnded(marketId, vodRevisePtr);
        vm.stopPrank();

        MarketRegistry.StreamState memory s = _stream(marketId);
        assertEq(s.endedAt, uint64(t0));
        assertEq(s.pointer, vodRevisePtr);
        assertFalse(marketRegistry.isLocked(marketId));
    }

    function test_setEnded_afterLockReverts() public {
        uint256 t0 = 1_700_000_000;
        vm.warp(t0);

        vm.startPrank(creator);
        marketRegistry.goLive(marketId, livePtr);
        marketRegistry.setEnded(marketId, vodPtr);
        vm.warp(t0 + 25 hours);
        vm.expectRevert("MarketRegistry: stream locked");
        marketRegistry.setEnded(marketId, vodRevisePtr);
        vm.stopPrank();
    }

    function test_isLocked_boundary() public {
        uint256 t0 = 1_700_000_000;
        vm.warp(t0);

        vm.startPrank(creator);
        marketRegistry.goLive(marketId, livePtr);
        marketRegistry.setEnded(marketId, vodPtr);
        vm.stopPrank();

        vm.warp(t0 + 1 days);
        assertFalse(marketRegistry.isLocked(marketId));

        vm.warp(t0 + 1 days + 1);
        assertTrue(marketRegistry.isLocked(marketId));
    }

    function test_goLive_afterEndedReverts() public {
        vm.startPrank(creator);
        marketRegistry.goLive(marketId, livePtr);
        marketRegistry.setEnded(marketId, vodPtr);
        vm.expectRevert("MarketRegistry: stream ended");
        marketRegistry.goLive(marketId, livePtr);
        vm.stopPrank();
    }

    function test_goldenLifecycle() public {
        uint256 t0 = 1_700_000_000;
        vm.warp(t0);

        assertEq(uint8(_stream(marketId).status), uint8(MarketRegistry.StreamStatus.None));

        vm.prank(creator);
        marketRegistry.goLive(marketId, livePtr);
        assertEq(uint8(_stream(marketId).status), uint8(MarketRegistry.StreamStatus.Live));

        vm.prank(creator);
        marketRegistry.setEnded(marketId, vodPtr);
        assertEq(_stream(marketId).endedAt, uint64(t0));

        vm.warp(t0 + 12 hours);
        vm.prank(creator);
        marketRegistry.setEnded(marketId, vodRevisePtr);
        assertEq(_stream(marketId).endedAt, uint64(t0));
        assertEq(_stream(marketId).pointer, vodRevisePtr);

        vm.warp(t0 + 1 days + 1 hours);
        assertTrue(marketRegistry.isLocked(marketId));

        vm.prank(creator);
        vm.expectRevert("MarketRegistry: stream locked");
        marketRegistry.setEnded(marketId, bytes32(uint256(0x55)));
    }
}
