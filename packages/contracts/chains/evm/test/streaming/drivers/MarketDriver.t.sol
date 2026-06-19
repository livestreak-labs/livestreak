// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DripsStreaming} from "../../../solidity/streaming/DripsStreaming.sol";
import {IDrips} from "../../../solidity/streaming/IDrips.sol";
import {MarketDriver} from "../../../solidity/streaming/drivers/MarketDriver.sol";
import {VaultDriver} from "../../../solidity/streaming/drivers/VaultDriver.sol";
import {Vault} from "../../../solidity/vault/Vault.sol";
import {Side} from "../../../solidity/vault/Side.sol";
import {MarketRegistry} from "../../../solidity/registries/MarketRegistry.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../../mocks/MockUSDC.sol";
import {ProtocolWire} from "../../helpers/ProtocolWire.sol";
import {MarketDriverHarness} from "../../helpers/MarketDriverHarness.sol";
import {VaultDriverHarness} from "../../helpers/VaultDriverHarness.sol";

/// @notice MarketDriver: NFT account, multi-lane fund/stop, Board sync, holder-gated claims.
contract MarketDriverTest is Test {
    uint32 internal constant CYCLE = 10;
    uint256 internal constant START = 100;
    uint256 internal constant RATE = 1_000_000;

    DripsStreaming internal drips;
    MockUSDC internal usdc;
    Vault internal vault;
    MarketRegistry internal marketRegistry;
    MarketDriver internal marketDriver;
    VaultDriver internal vaultDriver;

    bytes32 internal marketId;
    bytes32 internal v1;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal aliceNft;
    uint256 internal bobNft;

    function setUp() public {
        vm.warp(START);

        usdc = new MockUSDC();
        ProtocolWire.Core memory core = ProtocolWire.deployCore(address(this), IERC20(address(usdc)));
        marketRegistry = core.marketRegistry;
        vault = core.vault;

        ProtocolWire.Streaming memory streaming = ProtocolWire.deployStreaming(address(this), vault, usdc, CYCLE);
        streaming = ProtocolWire.wireAll(address(this), core, streaming);
        drips = streaming.drips;
        marketDriver = streaming.marketDriver;
        vaultDriver = core.vaultDriver;

        marketId = marketRegistry.registerMarket("market", bytes32("s"));
        v1 = VaultDriverHarness.bondVault(vaultDriver, usdc, marketId, "Q1?", Side.Yes);

        aliceNft = MarketDriverHarness.mint(marketDriver, alice, marketId);
        bobNft = MarketDriverHarness.mint(marketDriver, bob, marketId);
    }

    function _fund(address who, uint256 tokenId, bytes32 vaultId, Side side, uint256 rate, uint256 deposit) internal {
        MarketDriverHarness.fund(marketDriver, usdc, who, tokenId, vaultId, side, rate, deposit);
    }

    function test_fund_opensStreamAndSyncsBoard() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);

        (uint256 rate,,, uint32 maxEnd,) = vault.getPosition(v1, Side.Yes, aliceNft);
        assertEq(rate, RATE, "board rate");
        assertEq(uint256(maxEnd), 150, "board maxEnd");

        (, uint256 sideRate,,) = vault.getBoard(v1, Side.Yes);
        assertEq(sideRate, RATE, "side rate");

        (,,,, uint32 dMaxEnd) = drips.streamsState(aliceNft, IERC20(address(usdc)));
        assertEq(uint256(dMaxEnd), 150, "real Drips stream opened");

        assertEq(marketDriver.laneCount(aliceNft), 1, "one lane");
        assertApproxEqAbs(usdc.balanceOf(address(drips)), 50 * RATE, 2, "deposit custodied");
    }

    function test_stop_keepsUnspentInSharedBalance() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);

        vm.warp(START + 20);
        vm.prank(alice);
        marketDriver.stop(aliceNft, v1, Side.Yes);

        assertEq(usdc.balanceOf(alice), 0, "no direct refund on per-lane stop");

        (uint256 rate,,,,) = vault.getPosition(v1, Side.Yes, aliceNft);
        assertEq(rate, 0, "rate cleared");
        assertEq(marketDriver.laneCount(aliceNft), 0, "lane removed");
    }

    function test_stopAll_refundsUnspent() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);

        vm.warp(START + 20);
        vm.prank(alice);
        marketDriver.stopAll(aliceNft);

        assertEq(usdc.balanceOf(alice), 30 * RATE, "unspent refunded on stopAll");
        assertEq(marketDriver.laneCount(aliceNft), 0, "all lanes cleared");
    }

    /// Hedge = flip the vault's single lane to the other side; prior-side shares survive the switch.
    function test_switchSide_flipsLaneKeepingPriorSideShares() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);
        vm.warp(START + 20);
        assertGt(vault.pendingShares(v1, Side.Yes, aliceNft), 0, "accrued YES shares before switch");

        vm.prank(alice);
        marketDriver.switchSide(aliceNft, v1, RATE, 0);

        assertEq(marketDriver.laneCount(aliceNft), 1, "still one lane after hedge");
        (, Side laneSide,) = marketDriver.laneAt(aliceNft, 0);
        assertEq(uint256(laneSide), uint256(Side.No), "lane flipped to NO");

        (uint256 yesRate,, uint256 yesAccrued,,) = vault.getPosition(v1, Side.Yes, aliceNft);
        (uint256 noRate,,,,) = vault.getPosition(v1, Side.No, aliceNft);
        assertEq(yesRate, 0, "YES lane stopped");
        assertGt(yesAccrued, 0, "YES shares survive the switch");
        assertEq(noRate, RATE, "NO lane now active at current price");

        (, uint256 noSideRate,,) = vault.getBoard(v1, Side.No);
        assertEq(noSideRate, RATE, "NO board now receiving");
    }

    /// One lane per vault: a second fund on a held vault reverts — same side OR the opposite side.
    function test_fund_revertsOnSecondLaneSameVault() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);

        usdc.mint(alice, 20 * RATE);
        vm.startPrank(alice);
        usdc.approve(address(marketDriver), 20 * RATE);
        vm.expectRevert("MarketDriver: vault already has a lane");
        marketDriver.fund(aliceNft, v1, Side.Yes, RATE, 10 * RATE);
        vm.expectRevert("MarketDriver: vault already has a lane");
        marketDriver.fund(aliceNft, v1, Side.No, RATE, 10 * RATE);
        vm.stopPrank();
    }

    function test_fund_revertsOnWrongMarket() public {
        bytes32 otherMarket = marketRegistry.registerMarket("other", bytes32("o"));
        bytes32 otherVault = VaultDriverHarness.bondVault(vaultDriver, usdc, otherMarket, "Other?", Side.Yes);

        usdc.mint(alice, 50 * RATE);
        vm.startPrank(alice);
        usdc.approve(address(marketDriver), 50 * RATE);
        vm.expectRevert("MarketDriver: wrong market");
        marketDriver.fund(aliceNft, otherVault, Side.Yes, RATE, 50 * RATE);
        vm.stopPrank();
    }

    /// The 11th lane reverts *before* any mutation, so the standing 10 lanes (and their Drips config)
    /// are untouched — no partial-state "drop one of the 10 / add an 11th" corruption.
    function test_fund_revertsOnEleventhLane_noPartialState() public {
        bytes32 lastVid;
        for (uint256 i = 0; i < 10; i++) {
            bytes32 vid =
                VaultDriverHarness.bondVault(vaultDriver, usdc, marketId, string(abi.encodePacked("Q", i)), Side.Yes);
            _fund(alice, aliceNft, vid, Side.Yes, RATE, 10 * RATE);
            lastVid = vid;
        }
        (,,,, uint32 maxEndBefore) = drips.streamsState(aliceNft, IERC20(address(usdc)));
        (uint256 rateBefore,,,,) = vault.getPosition(lastVid, Side.Yes, aliceNft);

        bytes32 v11 = VaultDriverHarness.bondVault(vaultDriver, usdc, marketId, "Q11", Side.Yes);
        usdc.mint(alice, 10 * RATE);
        vm.startPrank(alice);
        usdc.approve(address(marketDriver), 10 * RATE);
        vm.expectRevert("MarketDriver: too many lanes");
        marketDriver.fund(aliceNft, v11, Side.Yes, RATE, 10 * RATE);
        vm.stopPrank();

        assertEq(marketDriver.laneCount(aliceNft), 10, "still exactly 10 lanes after rejected 11th");
        (,,,, uint32 maxEndAfter) = drips.streamsState(aliceNft, IERC20(address(usdc)));
        (uint256 rateAfter,,,,) = vault.getPosition(lastVid, Side.Yes, aliceNft);
        assertEq(uint256(maxEndAfter), uint256(maxEndBefore), "Drips stream config unchanged");
        assertEq(rateAfter, rateBefore, "existing lane position unchanged");
    }

    /// At the cap you don't get walled off — clean up one lane and step into a new vault in one tx.
    /// The dropped lane's accrued shares survive (claimable later); net lane count stays 10.
    function test_replaceLane_swapsOneOutKeepingShares() public {
        bytes32 first;
        for (uint256 i = 0; i < 10; i++) {
            bytes32 vid =
                VaultDriverHarness.bondVault(vaultDriver, usdc, marketId, string(abi.encodePacked("R", i)), Side.Yes);
            _fund(alice, aliceNft, vid, Side.Yes, RATE, 10 * RATE);
            if (i == 0) first = vid;
        }
        assertEq(marketDriver.laneCount(aliceNft), 10, "at the lane cap");
        vm.warp(START + 5); // accrue some shares on the lane we'll drop

        bytes32 v11 = VaultDriverHarness.bondVault(vaultDriver, usdc, marketId, "R11", Side.Yes);
        usdc.mint(alice, 10 * RATE);
        vm.startPrank(alice);
        usdc.approve(address(marketDriver), 10 * RATE);
        marketDriver.replaceLane(aliceNft, first, v11, Side.No, RATE, 10 * RATE);
        vm.stopPrank();

        assertEq(marketDriver.laneCount(aliceNft), 10, "still 10 lanes after the swap");
        (uint256 droppedRate,, uint256 droppedShares,,) = vault.getPosition(first, Side.Yes, aliceNft);
        (uint256 newRate,,,,) = vault.getPosition(v11, Side.No, aliceNft);
        assertEq(droppedRate, 0, "dropped vault lane stopped");
        assertGt(droppedShares, 0, "dropped lane's accrued shares survive the swap");
        assertEq(newRate, RATE, "moved into the 11th vault");
    }

    function test_replaceLane_guards() public {
        bytes32 v2 = VaultDriverHarness.bondVault(vaultDriver, usdc, marketId, "RG2", Side.Yes);
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);
        _fund(alice, aliceNft, v2, Side.Yes, RATE, 50 * RATE);
        bytes32 v3 = VaultDriverHarness.bondVault(vaultDriver, usdc, marketId, "RG3", Side.Yes);

        usdc.mint(alice, 30 * RATE);
        vm.startPrank(alice);
        usdc.approve(address(marketDriver), 30 * RATE);
        vm.expectRevert("MarketDriver: same vault");
        marketDriver.replaceLane(aliceNft, v1, v1, Side.No, RATE, 10 * RATE);
        vm.expectRevert("MarketDriver: no lane to drop");
        marketDriver.replaceLane(aliceNft, v3, v1, Side.No, RATE, 10 * RATE);
        vm.expectRevert("MarketDriver: vault already has a lane");
        marketDriver.replaceLane(aliceNft, v1, v2, Side.No, RATE, 10 * RATE);
        vm.stopPrank();
    }

    /// Shared-balance maxEnd ripple now spans two distinct vaults (one lane each), not two sides.
    function test_maxEndRipple_afterSecondVaultFund() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 20 * RATE);
        (,,, uint32 maxEnd1,) = vault.getPosition(v1, Side.Yes, aliceNft);
        assertEq(uint256(maxEnd1), 120, "first lane maxEnd");

        bytes32 v2 = VaultDriverHarness.bondVault(vaultDriver, usdc, marketId, "Q2?", Side.Yes);
        _fund(alice, aliceNft, v2, Side.No, RATE, 80 * RATE);

        (,,, uint32 maxEndV1,) = vault.getPosition(v1, Side.Yes, aliceNft);
        (,,, uint32 maxEndV2,) = vault.getPosition(v2, Side.No, aliceNft);
        assertGt(uint256(maxEndV1), uint256(maxEnd1), "v1 lane maxEnd extended by added balance");
        assertEq(uint256(maxEndV1), uint256(maxEndV2), "both lanes share one balance maxEnd");
    }

    function test_stopOneVaultLeavesOtherActive() public {
        bytes32 v2 = VaultDriverHarness.bondVault(vaultDriver, usdc, marketId, "Q2?", Side.Yes);
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);
        _fund(alice, aliceNft, v2, Side.No, RATE, 50 * RATE);

        vm.prank(alice);
        marketDriver.stop(aliceNft, v1, Side.Yes);

        assertEq(marketDriver.laneCount(aliceNft), 1, "one lane remains");
        (uint256 v1Rate,,,,) = vault.getPosition(v1, Side.Yes, aliceNft);
        (uint256 v2Rate,,,,) = vault.getPosition(v2, Side.No, aliceNft);
        assertEq(v1Rate, 0, "stopped vault lane cleared");
        assertGt(v2Rate, 0, "other vault lane still active");
    }

    function test_nftTransfer_newHolderCanStop() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);

        vm.prank(alice);
        marketDriver.transferFrom(alice, bob, aliceNft);

        vm.prank(bob);
        marketDriver.stop(aliceNft, v1, Side.Yes);

        vm.prank(alice);
        vm.expectRevert("MarketDriver: not holder");
        marketDriver.stop(aliceNft, v1, Side.No);
    }

    function test_twoNftsAccrueByRate() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, v1, Side.Yes, 2 * RATE, 100 * RATE);

        vm.warp(START + 50);
        vault.advance(v1, Side.Yes, 64);

        uint256 aShares = vault.pendingShares(v1, Side.Yes, aliceNft);
        uint256 bShares = vault.pendingShares(v1, Side.Yes, bobNft);
        assertGt(aShares, 0);
        assertApproxEqAbs(bShares, 2 * aShares, 10, "2x rate => 2x shares");
    }

    function test_boundaryPileup_stillAdvancesWithinMaxSteps() public {
        for (uint256 i = 0; i < 25; i++) {
            _fund(alice, aliceNft, v1, Side.Yes, RATE, 10 * RATE);
            vm.prank(alice);
            marketDriver.stop(aliceNft, v1, Side.Yes);
        }
        vm.warp(START + 500);
        vault.advance(v1, Side.Yes, 64);
        assertTrue(vault.caughtUp(v1, Side.Yes), "boundary pileup does not brick advance");
    }

    /// Funding must never open a position against a board left behind by the MAX_STEPS cap.
    /// With >MAX_STEPS dry boundaries queued, a fund reverts until the board is drained; draining is
    /// permissionless and bounded, so nothing bricks and no stale-board (over-credit) accounting occurs.
    function test_fundWhileBehind_revertsUntilDrained() public {
        uint256 n = 65; // > MAX_STEPS (64)
        for (uint256 i = 0; i < n; i++) {
            address f = address(uint160(0xF00000 + i));
            uint256 nft = MarketDriverHarness.mint(marketDriver, f, marketId);
            // deposit (i+1)*RATE => maxEnd = START + (i+1) in 101..165, all before the warp target.
            MarketDriverHarness.fund(marketDriver, usdc, f, nft, v1, Side.Yes, RATE, (i + 1) * RATE);
        }

        vm.warp(START + 200); // every run-dry now past: 65 boundaries due, none processed
        assertFalse(vault.caughtUp(v1, Side.Yes), "board behind with 65 due boundaries");

        // Opening against the stale board would over-credit; must revert instead.
        usdc.mint(alice, 10 * RATE);
        vm.startPrank(alice);
        usdc.approve(address(marketDriver), 10 * RATE);
        vm.expectRevert("Vault: board behind, advance first");
        marketDriver.fund(aliceNft, v1, Side.Yes, RATE, 10 * RATE);
        vm.stopPrank();

        // Permissionless bounded drain (65/64 => 2 calls), never bricks.
        vault.advance(v1, Side.Yes, 64);
        vault.advance(v1, Side.Yes, 64);
        assertTrue(vault.caughtUp(v1, Side.Yes), "board fully drained");

        // Same fund now succeeds against a current board.
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 10 * RATE);
        (uint256 rate,,,,) = vault.getPosition(v1, Side.Yes, aliceNft);
        assertEq(rate, RATE, "fund opens cleanly after drain");
    }

    function test_vaultHooks_areDriverGated() external {
        vm.expectRevert("Vault: not funding driver");
        vault.onFund(aliceNft, v1, Side.Yes, RATE, 150);

        vm.expectRevert("VaultDriver: not funding driver");
        vaultDriver.receiverAccount(v1, Side.Yes);
    }
}
