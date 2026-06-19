// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DripsStreaming} from "../../src/streaming/DripsStreaming.sol";
import {AddressDriver} from "../../src/streaming/drivers/AddressDriver.sol";
import {Vault} from "../../src/vault/Vault.sol";
import {VaultFactory} from "../../src/vault/VaultFactory.sol";
import {LvstToken} from "../../src/treasury/LvstToken.sol";
import {Treasury} from "../../src/treasury/Treasury.sol";
import {Side} from "../../src/vault/Side.sol";
import {BookmakerRegistry} from "../../src/registries/BookmakerRegistry.sol";
import {MarketRegistry} from "../../src/registries/MarketRegistry.sol";
import {StewardRegistry} from "../../src/steward/StewardRegistry.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {ProtocolWire} from "../helpers/ProtocolWire.sol";

/// @notice Treasury house-pot economics end-to-end: losers mint LVST on the pool-driven curve, the
/// winner-skim feeds the house pot, stakers earn the skim as USDC dividends, and a both-sides wash
/// self-limits (its rate decays as it feeds the pot that backs LVST).
contract TreasuryTest is Test {
    uint32 internal constant CYCLE = 10;
    uint256 internal constant START = 100;
    uint256 internal constant RATE = 1_000_000; // 1 USDC/sec

    DripsStreaming internal drips;
    MockUSDC internal usdc;
    Vault internal vault;
    VaultFactory internal vaultFactory;
    BookmakerRegistry internal bookmakerRegistry;
    MarketRegistry internal marketRegistry;
    StewardRegistry internal stewardRegistry;
    AddressDriver internal addressDriver;
    LvstToken internal lvst;
    Treasury internal treasury;

    bytes32 internal marketId;
    bytes32 internal v1;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal steward = makeAddr("steward");

    function setUp() public {
        vm.warp(START);

        usdc = new MockUSDC();
        ProtocolWire.Core memory core = ProtocolWire.deployCore(address(this), IERC20(address(usdc)));
        bookmakerRegistry = core.bookmakerRegistry;
        marketRegistry = core.marketRegistry;
        vault = core.vault;
        vaultFactory = core.vaultFactory;
        stewardRegistry = core.stewardRegistry;
        lvst = core.lvstToken;
        treasury = core.treasury;

        bookmakerRegistry.setBookmaker(address(this), true);

        ProtocolWire.Streaming memory streaming = ProtocolWire.deployStreaming(address(this), vault, usdc, CYCLE);
        streaming = ProtocolWire.wireAll(address(this), core, streaming);
        drips = streaming.drips;
        addressDriver = streaming.addressDriver;

        stewardRegistry.registerSteward(steward);

        marketId = marketRegistry.registerMarket("m", bytes32("s"));
        v1 = vaultFactory.createVault(marketId, "Q?");
    }

    function _fund(address who, bytes32 vid, Side side, uint256 rate, uint256 deposit) internal {
        usdc.mint(who, deposit);
        vm.startPrank(who);
        usdc.approve(address(addressDriver), deposit);
        addressDriver.fund(vid, side, rate, deposit);
        vm.stopPrank();
    }

    function _resolve(bytes32 vid, Vault.Outcome outcome) internal {
        vm.prank(steward);
        stewardRegistry.resolveVault(vid, outcome);
    }

    function _newVault() internal returns (bytes32) {
        return vaultFactory.createVault(marketId, "Q2?");
    }

    // ── loss -> LVST ─────────────────────────────────────────────────────────

    /// A loser mints LVST = lostUSD x mintRate(); the winner mints nothing.
    function test_lossMintsFlowOnCurve() public {
        _fund(alice, v1, Side.Yes, RATE, 50 * RATE);
        _fund(bob, v1, Side.No, RATE, 50 * RATE);
        vm.warp(200); // both deplete at 150
        _resolve(v1, Vault.Outcome.Yes);
        vault.collect(v1);

        assertEq(vault.lossClaimable(bob, v1, Side.No), 50 * RATE, "bob lost his streamed $50");
        assertEq(vault.lossClaimable(alice, v1, Side.Yes), 0, "winner has no loss");

        uint256 rate = treasury.mintRate();
        uint256 expected = (uint256(50 * RATE) * rate) / 1e6;
        vm.prank(bob);
        uint256 minted = treasury.claimLossLvst(v1, Side.No);
        assertEq(minted, expected, "LVST = lostUSD x mintRate");
        assertEq(lvst.balanceOf(bob), expected);

        vm.prank(bob);
        vm.expectRevert("Treasury: already claimed");
        treasury.claimLossLvst(v1, Side.No);

        vm.prank(alice);
        vm.expectRevert("Treasury: nothing lost");
        treasury.claimLossLvst(v1, Side.Yes);
    }

    /// The skim takes 2% of the losing pool: the pot shrinks by it and the house pot grows by it.
    function test_skimReducesPotAndFeedsHousePot() public {
        _fund(alice, v1, Side.Yes, RATE, 50 * RATE);
        _fund(bob, v1, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(v1, Vault.Outcome.Yes);
        vault.collect(v1);

        uint256 skim = (50 * RATE * 200) / 10_000; // 2% of bob's $50 = $1
        assertEq(treasury.totalSkimmed(), skim, "house pot took the skim");
        assertEq(vault.pot(v1), 100 * RATE - skim, "pot = winPool + 98% of bounty");
        assertEq(usdc.balanceOf(address(treasury)), skim, "skim USDC sits in the house pot");

        vm.prank(alice);
        assertEq(addressDriver.claim(v1, Side.Yes), 100 * RATE - skim, "winner takes the reduced pot");
    }

    /// No opposing side -> no bounty -> no skim, and winners are simply refunded their own stream.
    function test_noLossNoSkimFullRefund() public {
        _fund(alice, v1, Side.Yes, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(v1, Vault.Outcome.Yes);
        vault.collect(v1);

        assertEq(treasury.totalSkimmed(), 0, "nothing skimmed with no bounty");
        assertEq(vault.pot(v1), 50 * RATE, "pot = winner's own money, whole");
        vm.prank(alice);
        assertEq(addressDriver.claim(v1, Side.Yes), 50 * RATE, "winner fully refunded");
    }

    // ── staking + dividends ───────────────────────────────────────────────────

    /// Staked LVST earns later skims as USDC dividends.
    function test_stakeEarnsDividends() public {
        // First market: bob loses, mints LVST, stakes it.
        _fund(alice, v1, Side.Yes, RATE, 50 * RATE);
        _fund(bob, v1, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(v1, Vault.Outcome.Yes);
        vault.collect(v1);
        vm.startPrank(bob);
        uint256 bobFlow = treasury.claimLossLvst(v1, Side.No);
        treasury.stakeLvst(bobFlow);
        vm.stopPrank();
        assertEq(treasury.lvstStaked(bob), bobFlow);

        // Second market resolves -> a fresh skim, now distributed to the staker (bob).
        bytes32 v2 = _newVault();
        _fund(carol, v2, Side.Yes, RATE, 50 * RATE);
        _fund(dave, v2, Side.No, RATE, 50 * RATE);
        vm.warp(400);
        _resolve(v2, Vault.Outcome.Yes);
        vault.collect(v2);

        // bob earns both the v2 skim and the v1 skim that was held until he staked.
        uint256 pending = treasury.pendingDividends(bob);
        assertLe(pending, treasury.totalSkimmed(), "never over-distribute (solvency)");
        assertApproxEqAbs(
            pending, treasury.totalSkimmed(), 1e4, "sole staker earns ~every skim (minus accumulator dust)"
        );
        assertGt(pending, 0);

        uint256 before = usdc.balanceOf(bob);
        vm.prank(bob);
        uint256 paid = treasury.claimDividends();
        assertEq(paid, pending, "dividends paid in USDC");
        assertEq(usdc.balanceOf(bob) - before, pending);
        assertEq(treasury.pendingDividends(bob), 0, "settled");
    }

    /// claim + stake in one call.
    function test_claimAndStakeLossLvst() public {
        _fund(alice, v1, Side.Yes, RATE, 50 * RATE);
        _fund(bob, v1, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(v1, Vault.Outcome.Yes);
        vault.collect(v1);

        vm.prank(bob);
        uint256 minted = treasury.claimAndStakeLossLvst(v1, Side.No);
        assertEq(treasury.lvstStaked(bob), minted, "minted LVST is staked");
        assertEq(lvst.balanceOf(bob), 0, "nothing left liquid");
    }

    // ── the curve + the wash ─────────────────────────────────────────────────

    /// The mint rate starts at `mintStart` on an empty pot and decays as the pot fills.
    function test_mintRateDecaysWithPool() public {
        assertEq(treasury.mintRate(), treasury.mintStart(), "empty pot -> start rate");

        _fund(alice, v1, Side.Yes, RATE, 50 * RATE);
        _fund(bob, v1, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(v1, Vault.Outcome.Yes);
        vault.collect(v1);

        assertLt(treasury.mintRate(), treasury.mintStart(), "skim grew the pot -> rate decayed");
        assertGe(treasury.mintRate(), treasury.mintFloor(), "never below the floor");
    }

    /// The wash self-limits: a farmer feeding the pot sees its own mint rate strictly fall, while the
    /// skim it pays accumulates in the very pot that backs LVST. To make it visible in one test we set
    /// a tiny knee so the decay is sharp.
    function test_washSelfLimits() public {
        treasury.setMintParams(100e18, 1e18, 100 * RATE); // knee = $100 so two markets move the rate a lot

        uint256 r0 = treasury.mintRate();

        bytes32 vA = v1;
        _fund(alice, vA, Side.Yes, RATE, 50 * RATE);
        _fund(bob, vA, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(vA, Vault.Outcome.Yes);
        vault.collect(vA);
        uint256 r1 = treasury.mintRate();

        bytes32 vB = _newVault();
        _fund(carol, vB, Side.Yes, RATE, 50 * RATE);
        _fund(dave, vB, Side.No, RATE, 50 * RATE);
        vm.warp(400);
        _resolve(vB, Vault.Outcome.Yes);
        vault.collect(vB);
        uint256 r2 = treasury.mintRate();

        assertLt(r1, r0, "rate fell after the first wash");
        assertLt(r2, r1, "and fell again after the second");
        assertGt(treasury.totalSkimmed(), 0, "the farmer's skims accumulate in the pot that backs LVST");
    }
}
