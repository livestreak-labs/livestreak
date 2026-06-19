// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DripsStreaming} from "../../../src/streaming/DripsStreaming.sol";
import {IDrips} from "../../../src/streaming/IDrips.sol";
import {MarketDriver} from "../../../src/streaming/drivers/MarketDriver.sol";
import {VaultDriver} from "../../../src/streaming/drivers/VaultDriver.sol";
import {Vault} from "../../../src/vault/Vault.sol";
import {VaultFactory} from "../../../src/vault/VaultFactory.sol";
import {Side} from "../../../src/vault/Side.sol";
import {BookmakerRegistry} from "../../../src/registries/BookmakerRegistry.sol";
import {MarketRegistry} from "../../../src/registries/MarketRegistry.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../../mocks/MockUSDC.sol";
import {ProtocolWire} from "../../helpers/ProtocolWire.sol";
import {MarketDriverHarness} from "../../helpers/MarketDriverHarness.sol";

/// @notice MarketDriver: NFT account, multi-lane fund/stop, Board sync, holder-gated claims.
contract MarketDriverTest is Test {
    uint32 internal constant CYCLE = 10;
    uint256 internal constant START = 100;
    uint256 internal constant RATE = 1_000_000;

    DripsStreaming internal drips;
    MockUSDC internal usdc;
    Vault internal vault;
    VaultFactory internal vaultFactory;
    BookmakerRegistry internal bookmakerRegistry;
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
        bookmakerRegistry = core.bookmakerRegistry;
        marketRegistry = core.marketRegistry;
        vault = core.vault;
        vaultFactory = core.vaultFactory;
        vaultDriver = core.vaultDriver;

        bookmakerRegistry.setBookmaker(address(this), true);

        ProtocolWire.Streaming memory streaming = ProtocolWire.deployStreaming(address(this), vault, usdc, CYCLE);
        streaming = ProtocolWire.wireAll(address(this), core, streaming);
        drips = streaming.drips;
        marketDriver = streaming.marketDriver;

        marketId = marketRegistry.registerMarket("market", bytes32("s"));
        v1 = vaultFactory.createVault(marketId, "Q1?");

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
        assertEq(usdc.balanceOf(address(drips)), 50 * RATE, "deposit custodied");
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

    function test_hedge_sameNftFundsBothSides() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);
        _fund(alice, aliceNft, v1, Side.No, RATE, 50 * RATE);

        assertEq(marketDriver.laneCount(aliceNft), 2, "two lanes on one NFT");
        (, uint256 yesRate,,) = vault.getBoard(v1, Side.Yes);
        (, uint256 noRate,,) = vault.getBoard(v1, Side.No);
        assertEq(yesRate, RATE);
        assertEq(noRate, RATE);
    }

    function test_fund_revertsOnDuplicateLane() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);

        usdc.mint(alice, 10 * RATE);
        vm.startPrank(alice);
        usdc.approve(address(marketDriver), 10 * RATE);
        vm.expectRevert("MarketDriver: duplicate lane");
        marketDriver.fund(aliceNft, v1, Side.Yes, RATE, 10 * RATE);
        vm.stopPrank();
    }

    function test_fund_revertsOnWrongMarket() public {
        bytes32 otherMarket = marketRegistry.registerMarket("other", bytes32("o"));
        bytes32 otherVault = vaultFactory.createVault(otherMarket, "Other?");

        usdc.mint(alice, 50 * RATE);
        vm.startPrank(alice);
        usdc.approve(address(marketDriver), 50 * RATE);
        vm.expectRevert("MarketDriver: wrong market");
        marketDriver.fund(aliceNft, otherVault, Side.Yes, RATE, 50 * RATE);
        vm.stopPrank();
    }

    function test_fund_revertsOnEleventhLane() public {
        for (uint256 i = 0; i < 10; i++) {
            bytes32 vid = vaultFactory.createVault(marketId, string(abi.encodePacked("Q", i)));
            _fund(alice, aliceNft, vid, Side.Yes, RATE, 10 * RATE);
        }
        bytes32 v11 = vaultFactory.createVault(marketId, "Q11");
        usdc.mint(alice, 10 * RATE);
        vm.startPrank(alice);
        usdc.approve(address(marketDriver), 10 * RATE);
        vm.expectRevert("MarketDriver: too many lanes");
        marketDriver.fund(aliceNft, v11, Side.Yes, RATE, 10 * RATE);
        vm.stopPrank();
    }

    function test_maxEndRipple_afterSecondFund() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 20 * RATE);
        (,,, uint32 maxEnd1,) = vault.getPosition(v1, Side.Yes, aliceNft);
        assertEq(uint256(maxEnd1), 120, "first lane maxEnd");

        _fund(alice, aliceNft, v1, Side.No, RATE, 80 * RATE);
        (,,, uint32 maxEndYes,) = vault.getPosition(v1, Side.Yes, aliceNft);
        (,,, uint32 maxEndNo,) = vault.getPosition(v1, Side.No, aliceNft);

        assertGt(uint256(maxEndYes), uint256(maxEnd1), "yes lane maxEnd extended");
        assertEq(uint256(maxEndYes), uint256(maxEndNo), "both lanes share balance maxEnd");
    }

    function test_perSideStop_otherLaneStillActive() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);
        _fund(alice, aliceNft, v1, Side.No, RATE, 50 * RATE);

        vm.prank(alice);
        marketDriver.stop(aliceNft, v1, Side.Yes);

        assertEq(marketDriver.laneCount(aliceNft), 1, "one lane remains");
        (uint256 yesRate,,,,) = vault.getPosition(v1, Side.Yes, aliceNft);
        (uint256 noRate,,,,) = vault.getPosition(v1, Side.No, aliceNft);
        assertEq(yesRate, 0);
        assertGt(noRate, 0);
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

    function test_vaultHooks_areDriverGated() external {
        vm.expectRevert("Vault: not market driver");
        vault.onFund(aliceNft, v1, Side.Yes, RATE, 150);

        vm.expectRevert("VaultDriver: not market driver");
        vaultDriver.receiverAccount(v1, Side.Yes);
    }
}
