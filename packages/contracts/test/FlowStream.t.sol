// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/Vault.sol";
import "../src/FlowToken.sol";
import "../src/ProtocolLP.sol";
import "../src/Steward.sol";
import "../src/AgentRegistry.sol";
import "../src/ObserverRegistry.sol";
import "./mocks/MockUSDC.sol";

contract FlowStreamTest is Test {
    MockUSDC usdc;
    Vault vault;
    FlowToken flowToken;
    ProtocolLP protocolLP;
    Steward steward;
    AgentRegistry agentRegistry;
    ObserverRegistry observerRegistry;

    address owner = address(this);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address charlie = address(0xC);
    address agent1 = address(0xA6E1);

    function setUp() public {
        // Deploy
        usdc = new MockUSDC();
        flowToken = new FlowToken();
        protocolLP = new ProtocolLP(address(usdc));
        vault = new Vault(address(usdc));
        agentRegistry = new AgentRegistry();
        observerRegistry = new ObserverRegistry();
        steward = new Steward(address(flowToken), address(protocolLP));

        // Wire up
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

        // Fund users
        usdc.mint(alice, 100_000e6);
        usdc.mint(bob, 100_000e6);
        usdc.mint(charlie, 100_000e6);

        // Approvals
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(charlie);
        usdc.approve(address(vault), type(uint256).max);
    }

    // ===== Vault Creation =====

    function test_createVault() public {
        vm.prank(alice);
        bytes32 vaultId = vault.createVault("Next goal before 70'", 3, 1 hours, 100e6, true);

        Vault.VaultData memory v = vault.getVault(vaultId);
        assertEq(v.option, "Next goal before 70'");
        assertEq(v.optionType, 3);
        assertEq(v.creator, alice);
        assertEq(v.yesTotal, 100e6);
        assertEq(v.noTotal, 0);
        assertEq(uint8(v.status), uint8(Vault.Status.Open));
        assertEq(vault.totalVaults(), 1);
    }

    // ===== Streaming =====

    function test_streamBothSides() public {
        vm.prank(alice);
        bytes32 vaultId = vault.createVault("Will it rain?", 0, 1 hours, 50e6, true);

        vm.prank(bob);
        vault.stream(vaultId, false, 30e6); // NO side

        Vault.VaultData memory v = vault.getVault(vaultId);
        assertEq(v.yesTotal, 50e6);
        assertEq(v.noTotal, 30e6);

        Vault.Position memory posAlice = vault.getPosition(vaultId, alice);
        assertTrue(posAlice.yesShares > 0);

        Vault.Position memory posBob = vault.getPosition(vaultId, bob);
        assertTrue(posBob.noShares > 0);
    }

    // ===== Bonding Curve =====

    function test_sharePriceIncreases() public {
        vm.prank(alice);
        bytes32 vaultId = vault.createVault("Test curve", 0, 1 hours, 10e6, true);

        uint256 price1 = vault.getSharePrice(vaultId, true);

        // Stream more to YES side
        vm.prank(bob);
        vault.stream(vaultId, true, 1000e6);

        uint256 price2 = vault.getSharePrice(vaultId, true);
        assertTrue(price2 > price1, "Price should increase with volume");
    }

    function test_sharePriceIncreasesWithTime() public {
        vm.prank(alice);
        bytes32 vaultId = vault.createVault("Time test", 0, 1 hours, 10e6, true);

        uint256 price1 = vault.getSharePrice(vaultId, true);

        vm.warp(block.timestamp + 30 minutes);
        uint256 price2 = vault.getSharePrice(vaultId, true);
        assertTrue(price2 > price1, "YES price should increase with time");
    }

    // ===== Resolution & Payout =====

    function test_fullLifecycle_resolve_payout() public {
        // Alice creates vault, stakes YES
        vm.prank(alice);
        bytes32 vaultId = vault.createVault("Goal scored?", 0, 1 hours, 100e6, true);

        // Bob stakes NO
        vm.prank(bob);
        vault.stream(vaultId, false, 100e6);

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        uint256 bobBalBefore = usdc.balanceOf(bob);

        // Resolve YES
        bytes32 proof = keccak256("goal scored at 45'");
        vault.resolve(vaultId, Vault.Outcome.Yes, proof);

        // Wait for challenge window
        vm.warp(block.timestamp + 6 minutes);
        vault.finalize(vaultId);

        // Alice (winner) withdraws
        vm.prank(alice);
        vault.withdraw(vaultId);

        // Bob (loser) withdraws — gets FLOW
        vm.prank(bob);
        vault.withdraw(vaultId);

        uint256 aliceBalAfter = usdc.balanceOf(alice);
        assertTrue(aliceBalAfter > aliceBalBefore, "Alice should profit");

        // Bob should have FLOW tokens
        assertTrue(flowToken.balanceOf(bob) > 0, "Bob should receive FLOW");

        // ProtocolLP should have received haircut
        assertTrue(protocolLP.totalDeposited() > 0, "ProtocolLP should receive haircut");
    }

    // ===== FLOW Emissions =====

    function test_flowMintedToLosers() public {
        vm.prank(alice);
        bytes32 vaultId = vault.createVault("Test emit", 0, 1 hours, 50e6, true);

        vm.prank(bob);
        vault.stream(vaultId, false, 50e6);

        vault.resolve(vaultId, Vault.Outcome.Yes, keccak256("proof"));
        vm.warp(block.timestamp + 6 minutes);
        vault.finalize(vaultId);

        vm.prank(bob);
        vault.withdraw(vaultId);

        // Bob lost 50 USDC. At RATE_LOW (100 FLOW per 1 USDC), should get 50 * 100 = 5000 FLOW
        uint256 expectedFlow = (50e6 * 100e18) / 1e6; // 5000e18
        assertEq(flowToken.balanceOf(bob), expectedFlow);
    }

    // ===== Haircut to ProtocolLP =====

    function test_haircutGoesToProtocolLP() public {
        vm.prank(alice);
        bytes32 vaultId = vault.createVault("Haircut test", 0, 1 hours, 100e6, true);

        vm.prank(bob);
        vault.stream(vaultId, false, 100e6);

        vault.resolve(vaultId, Vault.Outcome.Yes, keccak256("proof"));
        vm.warp(block.timestamp + 6 minutes);
        vault.finalize(vaultId);

        vm.prank(alice);
        vault.withdraw(vaultId);

        // Haircut is 5% of winnings (100 USDC from losing pool)
        // Expected haircut = 100e6 * 500 / 10000 = 5e6
        assertEq(protocolLP.totalDeposited(), 5e6);
        assertEq(usdc.balanceOf(address(protocolLP)), 5e6);
    }

    // ===== Hot Period =====

    function test_hotPeriod_exitBurn() public {
        vm.prank(alice);
        bytes32 vaultId = vault.createVault("Hot test", 0, 1 hours, 100e6, true);

        vm.prank(bob);
        vault.stream(vaultId, false, 100e6);

        // Trigger hot period (critical severity)
        vault.triggerHot(vaultId, Vault.Severity.Critical);

        Vault.VaultData memory v = vault.getVault(vaultId);
        assertEq(uint8(v.status), uint8(Vault.Status.Hot));

        // Bob exits during hot — 30% burn
        uint256 bobBalBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        vault.exitDuringHot(vaultId);

        uint256 bobBalAfter = usdc.balanceOf(bob);
        // Bob deposited 100e6, burns 30% = 30e6, gets back 70e6
        assertEq(bobBalAfter - bobBalBefore, 70e6);

        // ProtocolLP gets half the burn = 15e6
        assertTrue(protocolLP.totalDeposited() > 0);
    }

    function test_hotPeriod_smallHolderBlocked() public {
        vm.prank(alice);
        bytes32 vaultId = vault.createVault("Hot block test", 0, 1 hours, 1000e6, true);

        vm.prank(bob);
        vault.stream(vaultId, true, 10e6); // Small position

        vault.triggerHot(vaultId, Vault.Severity.Warm);

        // Bob tries to stream more during hot — should fail (< 30% of YES shares)
        vm.prank(bob);
        vm.expectRevert("Vault: too small during hot");
        vault.stream(vaultId, true, 5e6);
    }

    // ===== Max Floating Bets =====

    function test_maxFloatingBets() public {
        // Create 10 vaults for alice
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(alice);
            vault.createVault(
                string(abi.encodePacked("Vault ", vm.toString(i))),
                0, 1 hours, 1e6, true
            );
        }

        // 11th should fail
        vm.prank(alice);
        vm.expectRevert("Vault: max floating bets reached");
        vault.createVault("Vault 11", 0, 1 hours, 1e6, true);
    }

    // ===== Challenge =====

    function test_challengeBlocksFinalization() public {
        vm.prank(alice);
        bytes32 vaultId = vault.createVault("Challenge test", 0, 1 hours, 50e6, true);

        vm.prank(bob);
        vault.stream(vaultId, false, 50e6);

        vault.resolve(vaultId, Vault.Outcome.Yes, keccak256("proof"));

        // Challenge
        vm.prank(bob);
        vault.challenge(vaultId, keccak256("counter-proof"));

        // Should not be finalizable (status is Disputed)
        vm.warp(block.timestamp + 6 minutes);
        vm.expectRevert("Vault: not locked or disputed");
        vault.finalize(vaultId);
    }

    // ===== Steward Governance =====

    function test_stewardProposalFlow() public {
        // Register community steward
        vm.prank(alice);
        steward.registerSteward("Alice", Steward.Tier.Community);

        // Give alice FLOW tokens
        vm.prank(alice);
        vault.createVault("flow gen", 0, 1 hours, 100e6, true);
        vm.prank(bob);
        vault.stream(keccak256(abi.encodePacked(alice, block.timestamp, uint256(0))), false, 100e6);

        // We need to mint FLOW to alice for staking — resolve a vault where she loses
        // Simpler: just have the owner set up a separate test vault
        // For this test, let's give alice FLOW directly via a losing position

        // Create vault where alice loses
        vm.prank(alice);
        bytes32 vid = vault.createVault("lose test", 0, 1 hours, 50e6, true);
        vm.prank(bob);
        vault.stream(vid, false, 50e6);
        vault.resolve(vid, Vault.Outcome.No, keccak256("proof"));
        vm.warp(block.timestamp + 6 minutes);
        vault.finalize(vid);
        vm.prank(alice);
        vault.withdraw(vid);
        // Alice now has FLOW tokens

        uint256 aliceFlow = flowToken.balanceOf(alice);
        assertTrue(aliceFlow > 0, "Alice should have FLOW");

        // Approve steward to spend FLOW
        vm.prank(alice);
        flowToken.approve(address(steward), aliceFlow);

        // Propose a boost
        bytes memory data = abi.encode(uint256(100e6));
        vm.prank(alice);
        uint256 proposalId = steward.propose(bytes32(0), Steward.ActionType.Boost, data, aliceFlow / 10);

        assertEq(steward.totalProposals(), 1);

        Steward.Proposal memory p = steward.getProposal(proposalId);
        assertEq(uint8(p.status), uint8(Steward.ProposalStatus.Pending));
    }

    function test_stewardVeto() public {
        // Register in-house steward (owner only)
        steward.registerSteward("Admin", Steward.Tier.InHouse);

        // Register community steward
        vm.prank(alice);
        steward.registerSteward("Alice", Steward.Tier.Community);

        // Give alice FLOW via losing
        vm.prank(alice);
        bytes32 vid = vault.createVault("veto test", 0, 1 hours, 50e6, true);
        vm.prank(bob);
        vault.stream(vid, false, 50e6);
        vault.resolve(vid, Vault.Outcome.No, keccak256("p"));
        vm.warp(block.timestamp + 6 minutes);
        vault.finalize(vid);
        vm.prank(alice);
        vault.withdraw(vid);

        uint256 aliceFlow = flowToken.balanceOf(alice);
        vm.prank(alice);
        flowToken.approve(address(steward), aliceFlow);

        vm.prank(alice);
        uint256 pid = steward.propose(bytes32(0), Steward.ActionType.Boost, abi.encode(uint256(0)), aliceFlow / 10);

        // Owner vetoes
        steward.veto(pid);

        Steward.Proposal memory p = steward.getProposal(pid);
        assertEq(uint8(p.status), uint8(Steward.ProposalStatus.Vetoed));
    }

    // ===== Observer Registry =====

    function test_observerBatchSubmission() public {
        vm.prank(alice);
        observerRegistry.registerObserver("AliceObserver");

        assertTrue(observerRegistry.isRegistered(alice));

        vm.prank(alice);
        observerRegistry.submitBatch(keccak256("batch1"));

        vm.prank(alice);
        observerRegistry.submitBatch(keccak256("batch2"));

        (uint256 batches, , , ) = observerRegistry.getObserverStats(alice);
        assertEq(batches, 2);
        assertEq(observerRegistry.totalBatches(), 2);
    }

    // ===== Agent Registry =====

    function test_agentRegistration() public {
        vm.prank(alice);
        agentRegistry.registerAgent("BookmakerAlice", AgentRegistry.AgentType.Bookmaker);

        assertTrue(agentRegistry.isRegistered(alice));
        assertEq(agentRegistry.totalAgents(), 1);

        (uint256 wins, uint256 losses, uint256 created, ) = agentRegistry.getReputation(alice);
        assertEq(wins, 0);
        assertEq(losses, 0);
        assertEq(created, 0);
    }

    // ===== FLOW Staking =====

    function test_flowStaking() public {
        // Give bob FLOW by having him lose a vault
        vm.prank(alice);
        bytes32 vid = vault.createVault("staking test", 0, 1 hours, 50e6, true);
        vm.prank(bob);
        vault.stream(vid, false, 50e6);
        vault.resolve(vid, Vault.Outcome.Yes, keccak256("p"));
        vm.warp(block.timestamp + 6 minutes);
        vault.finalize(vid);
        vm.prank(bob);
        vault.withdraw(vid);

        uint256 bobFlow = flowToken.balanceOf(bob);
        assertTrue(bobFlow > 0);

        // Stake half
        uint256 stakeAmount = bobFlow / 2;
        vm.prank(bob);
        flowToken.stake(stakeAmount);

        assertEq(flowToken.staked(bob), stakeAmount);
        assertEq(flowToken.totalStaked(), stakeAmount);

        // Unstake
        vm.prank(bob);
        flowToken.unstake(stakeAmount);

        assertEq(flowToken.staked(bob), 0);
        assertEq(flowToken.totalStaked(), 0);
    }

    // ===== Expired Vault =====

    function test_expiredVault() public {
        vm.prank(alice);
        bytes32 vaultId = vault.createVault("Expire test", 0, 1 hours, 50e6, true);

        vm.warp(block.timestamp + 2 hours);

        vault.expireVault(vaultId);

        Vault.VaultData memory v = vault.getVault(vaultId);
        assertEq(uint8(v.status), uint8(Vault.Status.Resolved));
        assertEq(uint8(v.outcome), uint8(Vault.Outcome.No));
    }
}
