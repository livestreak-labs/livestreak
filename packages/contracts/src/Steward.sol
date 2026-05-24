// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IProtocolLPBoost {
    function boost(bytes32 vaultId, uint256 amount) external;
}

/// @title Steward — two-tier governance for FlowStream
/// @notice Community stewards propose actions (boost, slash, grouping).
///         In-house stewards can veto (max 5/month).
contract Steward is Ownable, ReentrancyGuard {
    enum Tier { Community, InHouse }
    enum ActionType { Boost, Slash, Group }
    enum ProposalStatus { Pending, Challenged, Executed, Vetoed }

    struct StewardInfo {
        string name;
        Tier tier;
        uint256 successfulProposals;
        uint256 registeredAt;
        bool exists;
    }

    struct Proposal {
        uint256 id;
        address proposer;
        bytes32 vaultId;
        ActionType actionType;
        bytes data;             // encoded action data
        uint256 flowStaked;
        ProposalStatus status;
        uint256 challengeUntil;
        // Challenge
        address challenger;
        uint256 challengeStake;
        uint256 createdAt;
    }

    // --- State ---
    IERC20 public flowToken;
    IProtocolLPBoost public protocolLP;

    mapping(address => StewardInfo) public stewards;
    address[] public stewardList;

    Proposal[] public proposals;
    uint256 public constant CHALLENGE_WINDOW = 10 minutes;

    // In-house veto tracking
    mapping(address => uint256) public vetoesUsedThisMonth;
    mapping(address => uint256) public vetoMonthStart;
    uint256 public constant MAX_VETOES_PER_MONTH = 5;

    // --- Events ---
    event StewardRegistered(address indexed steward, string name, Tier tier);
    event ProposalCreated(uint256 indexed id, address indexed proposer, bytes32 vaultId, ActionType actionType, uint256 flowStaked);
    event ProposalChallenged(uint256 indexed id, address indexed challenger, uint256 challengeStake);
    event ProposalExecuted(uint256 indexed id);
    event ProposalVetoed(uint256 indexed id, address indexed vetoer);

    constructor(address _flowToken, address _protocolLP) Ownable(msg.sender) {
        require(_flowToken != address(0) && _protocolLP != address(0), "Steward: zero address");
        flowToken = IERC20(_flowToken);
        protocolLP = IProtocolLPBoost(_protocolLP);
    }

    // --- Registration ---
    function registerSteward(string calldata name, Tier tier) external {
        require(!stewards[msg.sender].exists, "Steward: already registered");
        require(bytes(name).length > 0, "Steward: empty name");
        if (tier == Tier.InHouse) {
            require(msg.sender == owner(), "Steward: only owner can register in-house");
        }

        stewards[msg.sender] = StewardInfo({
            name: name,
            tier: tier,
            successfulProposals: 0,
            registeredAt: block.timestamp,
            exists: true
        });
        stewardList.push(msg.sender);

        emit StewardRegistered(msg.sender, name, tier);
    }

    // --- Proposals ---
    function propose(
        bytes32 vaultId,
        ActionType actionType,
        bytes calldata data,
        uint256 flowStake
    ) external nonReentrant returns (uint256 proposalId) {
        require(stewards[msg.sender].exists, "Steward: not registered");
        require(stewards[msg.sender].tier == Tier.Community, "Steward: in-house cannot propose");
        require(flowStake > 0, "Steward: zero stake");

        flowToken.transferFrom(msg.sender, address(this), flowStake);

        proposalId = proposals.length;
        proposals.push(Proposal({
            id: proposalId,
            proposer: msg.sender,
            vaultId: vaultId,
            actionType: actionType,
            data: data,
            flowStaked: flowStake,
            status: ProposalStatus.Pending,
            challengeUntil: block.timestamp + CHALLENGE_WINDOW,
            challenger: address(0),
            challengeStake: 0,
            createdAt: block.timestamp
        }));

        emit ProposalCreated(proposalId, msg.sender, vaultId, actionType, flowStake);
    }

    function challengeProposal(uint256 proposalId, uint256 flowStake) external nonReentrant {
        require(proposalId < proposals.length, "Steward: invalid proposal");
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.Pending, "Steward: not pending");
        require(block.timestamp <= p.challengeUntil, "Steward: challenge window closed");
        require(flowStake > 0, "Steward: zero stake");

        flowToken.transferFrom(msg.sender, address(this), flowStake);

        p.status = ProposalStatus.Challenged;
        p.challenger = msg.sender;
        p.challengeStake = flowStake;

        emit ProposalChallenged(proposalId, msg.sender, flowStake);
    }

    function executeProposal(uint256 proposalId) external nonReentrant {
        require(proposalId < proposals.length, "Steward: invalid proposal");
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.Pending, "Steward: not pending");
        require(block.timestamp > p.challengeUntil, "Steward: challenge window open");

        p.status = ProposalStatus.Executed;

        // Execute the action
        if (p.actionType == ActionType.Boost) {
            uint256 boostAmount = abi.decode(p.data, (uint256));
            protocolLP.boost(p.vaultId, boostAmount);
        }
        // Slash and Group are tracked on-chain but not auto-executed for hackathon

        // Return staked FLOW to proposer
        flowToken.transfer(p.proposer, p.flowStaked);

        // Update leaderboard
        stewards[p.proposer].successfulProposals++;

        emit ProposalExecuted(proposalId);
    }

    // --- Veto ---
    function veto(uint256 proposalId) external {
        require(proposalId < proposals.length, "Steward: invalid proposal");
        require(stewards[msg.sender].exists, "Steward: not registered");
        require(stewards[msg.sender].tier == Tier.InHouse, "Steward: not in-house");

        Proposal storage p = proposals[proposalId];
        require(
            p.status == ProposalStatus.Pending || p.status == ProposalStatus.Challenged,
            "Steward: cannot veto"
        );

        // Check monthly veto limit
        _checkVetoLimit(msg.sender);
        vetoesUsedThisMonth[msg.sender]++;

        p.status = ProposalStatus.Vetoed;

        // Slash proposer's stake (burned / stays in contract)
        // Return challenger's stake if challenged
        if (p.challenger != address(0) && p.challengeStake > 0) {
            flowToken.transfer(p.challenger, p.challengeStake);
        }

        emit ProposalVetoed(proposalId, msg.sender);
    }

    // --- Internal ---
    function _checkVetoLimit(address steward) internal {
        uint256 monthStart = vetoMonthStart[steward];
        if (block.timestamp >= monthStart + 30 days) {
            // New month
            vetoMonthStart[steward] = block.timestamp;
            vetoesUsedThisMonth[steward] = 0;
        }
        require(
            vetoesUsedThisMonth[steward] < MAX_VETOES_PER_MONTH,
            "Steward: monthly veto limit reached"
        );
    }

    // --- Views ---
    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        require(proposalId < proposals.length, "Steward: invalid proposal");
        return proposals[proposalId];
    }

    function totalProposals() external view returns (uint256) {
        return proposals.length;
    }

    function totalStewards() external view returns (uint256) {
        return stewardList.length;
    }

    function getLeaderboard(address steward) external view returns (
        string memory name, uint256 successfulProposals, Tier tier
    ) {
        StewardInfo storage s = stewards[steward];
        require(s.exists, "Steward: not registered");
        return (s.name, s.successfulProposals, s.tier);
    }
}
