// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFlowTokenMint {
    function mint(address to, uint256 usdcLost) external;
}

interface IProtocolLPDeposit {
    function deposit(uint256 amount) external;
}

interface IAgentRegistry {
    function isRegistered(address agent) external view returns (bool);
    function incrementVaultsCreated(address agent) external;
    function updateReputation(address agent, bool win) external;
}

/// @title Vault — two-sided binary prediction market for FlowStream
/// @notice Core contract. Agents create vaults, users stream USDC to YES/NO sides.
///         Bonding curves price shares. Includes hot period (Adversity) logic.
contract Vault is Ownable, ReentrancyGuard {
    // --- Types ---
    enum Status { Open, Hot, Locked, Resolved, Disputed }
    enum Outcome { Pending, Yes, No }
    enum Severity { Warm, Hot, Critical }

    struct VaultData {
        bytes32 id;
        string option;          // "Next goal before 70'"
        uint8 optionType;       // 0=momentum, 1=player, 2=threshold, 3=timing, 4=swing
        address creator;

        uint256 noTotal;        // total USDC on NO side (6 decimals)
        uint256 yesTotal;       // total USDC on YES side

        uint256 noCurveK;       // NO side curve steepness
        uint256 yesCurveK;      // YES side curve steepness

        Status status;
        uint256 hotUntil;       // timestamp when hot period ends
        Severity hotSeverity;
        uint256 createdAt;
        uint256 expiresAt;

        Outcome outcome;
        bytes32 proofCid;       // IPFS CID of resolution proof
        address resolver;
        uint256 challengeUntil;
        bool creatorSideYes;    // true if creator staked YES, false if NO
    }

    // Per-user position in a vault
    struct Position {
        uint256 yesShares;
        uint256 noShares;
        uint256 yesDeposited;  // USDC deposited on YES
        uint256 noDeposited;   // USDC deposited on NO
        bool withdrawn;
    }

    // --- State ---
    IERC20 public immutable usdc;
    IFlowTokenMint public flowToken;
    IProtocolLPDeposit public protocolLP;
    IAgentRegistry public agentRegistry;

    mapping(bytes32 => VaultData) public vaults;
    bytes32[] public vaultIds;

    // vaultId => user => position
    mapping(bytes32 => mapping(address => Position)) public positions;

    // vaultId => total shares per side
    mapping(bytes32 => uint256) public totalYesShares;
    mapping(bytes32 => uint256) public totalNoShares;

    // Max floating bets per address
    uint256 public constant MAX_FLOATING_BETS = 10;
    mapping(address => bytes32[]) public activeVaults;

    // Bonding curve base price (0.10 USDC = 100000 in 6 decimals)
    uint256 public constant BASE_PRICE = 100_000; // 0.10 USDC
    uint256 public constant DEFAULT_K = 10_000e6; // curve steepness parameter

    // Haircut: 5% of winnings (500 basis points)
    uint256 public constant HAIRCUT_BPS = 500;
    uint256 public constant BPS = 10000;

    // Challenge window: 5 minutes for hackathon
    uint256 public constant CHALLENGE_WINDOW = 5 minutes;

    // Hot period exit burns (basis points)
    uint256 public constant WARM_BURN = 1000;     // 10%
    uint256 public constant HOT_BURN = 2000;      // 20%
    uint256 public constant CRITICAL_BURN = 3000;  // 30%

    // Hot period durations
    uint256 public constant WARM_DURATION = 30;
    uint256 public constant HOT_DURATION = 60;
    uint256 public constant CRITICAL_DURATION = 120;

    // Hot period: minimum share % to modify position (30% = 3000 bps)
    uint256 public constant HOT_MIN_SHARE_BPS = 3000;

    uint256 private _nonce;

    // --- Events ---
    event VaultCreated(bytes32 indexed id, address indexed creator, string option, uint8 optionType, uint256 expiresAt);
    event Streamed(bytes32 indexed vaultId, address indexed user, bool yesSide, uint256 amount, uint256 shares, uint256 price);
    event HotTriggered(bytes32 indexed vaultId, Severity severity, uint256 hotUntil);
    event HotExit(bytes32 indexed vaultId, address indexed user, uint256 burnAmount);
    event Resolved(bytes32 indexed vaultId, Outcome outcome, bytes32 proofCid, address resolver);
    event Challenged(bytes32 indexed vaultId, bytes32 proofCid, address challenger);
    event Finalized(bytes32 indexed vaultId, Outcome outcome);
    event Withdrawn(bytes32 indexed vaultId, address indexed user, uint256 payout, uint256 flowMinted);
    event VaultExpired(bytes32 indexed vaultId);

    constructor(address _usdc) Ownable(msg.sender) {
        require(_usdc != address(0), "Vault: zero USDC");
        usdc = IERC20(_usdc);
    }

    // --- Admin ---
    function setFlowToken(address _flowToken) external onlyOwner {
        flowToken = IFlowTokenMint(_flowToken);
    }

    function setProtocolLP(address _protocolLP) external onlyOwner {
        protocolLP = IProtocolLPDeposit(_protocolLP);
    }

    function setAgentRegistry(address _agentRegistry) external onlyOwner {
        agentRegistry = IAgentRegistry(_agentRegistry);
    }

    // --- Vault Creation ---
    function createVault(
        string calldata option,
        uint8 optionType,
        uint256 duration,
        uint256 creatorStake,
        bool creatorSide // true = YES, false = NO
    ) external nonReentrant returns (bytes32 vaultId) {
        require(bytes(option).length > 0, "Vault: empty option");
        require(optionType <= 4, "Vault: invalid option type");
        require(duration > 0, "Vault: zero duration");
        require(creatorStake > 0, "Vault: zero stake");

        vaultId = keccak256(abi.encodePacked(msg.sender, block.timestamp, _nonce++));

        VaultData storage v = vaults[vaultId];
        v.id = vaultId;
        v.option = option;
        v.optionType = optionType;
        v.creator = msg.sender;
        v.noCurveK = DEFAULT_K;
        v.yesCurveK = DEFAULT_K;
        v.status = Status.Open;
        v.createdAt = block.timestamp;
        v.expiresAt = block.timestamp + duration;
        v.outcome = Outcome.Pending;

        v.creatorSideYes = creatorSide;
        vaultIds.push(vaultId);

        // Creator stakes on one side
        usdc.transferFrom(msg.sender, address(this), creatorStake);

        uint256 shares = _calculateShares(vaultId, creatorSide, creatorStake);
        if (creatorSide) {
            v.yesTotal += creatorStake;
            totalYesShares[vaultId] += shares;
            positions[vaultId][msg.sender].yesShares += shares;
            positions[vaultId][msg.sender].yesDeposited += creatorStake;
        } else {
            v.noTotal += creatorStake;
            totalNoShares[vaultId] += shares;
            positions[vaultId][msg.sender].noShares += shares;
            positions[vaultId][msg.sender].noDeposited += creatorStake;
        }

        _trackActiveVault(msg.sender, vaultId);

        // Update agent registry if registered
        if (address(agentRegistry) != address(0) && agentRegistry.isRegistered(msg.sender)) {
            agentRegistry.incrementVaultsCreated(msg.sender);
        }

        emit VaultCreated(vaultId, msg.sender, option, optionType, v.expiresAt);
        emit Streamed(vaultId, msg.sender, creatorSide, creatorStake, shares, _getSharePrice(vaultId, creatorSide));
    }

    // --- Streaming ---
    function stream(bytes32 vaultId, bool yesSide, uint256 amount) external nonReentrant {
        VaultData storage v = vaults[vaultId];
        require(v.createdAt > 0, "Vault: does not exist");
        require(v.status == Status.Open || v.status == Status.Hot, "Vault: not open");
        require(block.timestamp < v.expiresAt, "Vault: expired");
        require(amount > 0, "Vault: zero amount");

        // During hot period, only large holders can modify
        if (v.status == Status.Hot) {
            require(block.timestamp <= v.hotUntil, "Vault: hot period ended");
            _requireLargeHolder(vaultId, msg.sender, yesSide);
        }

        // Check max floating bets
        _trackActiveVault(msg.sender, vaultId);

        usdc.transferFrom(msg.sender, address(this), amount);

        uint256 shares = _calculateShares(vaultId, yesSide, amount);

        if (yesSide) {
            v.yesTotal += amount;
            totalYesShares[vaultId] += shares;
            positions[vaultId][msg.sender].yesShares += shares;
            positions[vaultId][msg.sender].yesDeposited += amount;
        } else {
            v.noTotal += amount;
            totalNoShares[vaultId] += shares;
            positions[vaultId][msg.sender].noShares += shares;
            positions[vaultId][msg.sender].noDeposited += amount;
        }

        emit Streamed(vaultId, msg.sender, yesSide, amount, shares, _getSharePrice(vaultId, yesSide));
    }

    // --- Bonding Curve ---
    function getSharePrice(bytes32 vaultId, bool yesSide) external view returns (uint256) {
        return _getSharePrice(vaultId, yesSide);
    }

    function _getSharePrice(bytes32 vaultId, bool yesSide) internal view returns (uint256) {
        VaultData storage v = vaults[vaultId];
        uint256 hotMultiplier = 1;
        if (v.status == Status.Hot && block.timestamp <= v.hotUntil) {
            if (v.hotSeverity == Severity.Warm) hotMultiplier = 2;
            else if (v.hotSeverity == Severity.Hot) hotMultiplier = 3;
            else hotMultiplier = 5;
        }

        if (yesSide) {
            // YES_share_price = base * (1 + timeElapsed / duration) * (1 + yesTotal / k)
            uint256 elapsed = block.timestamp > v.createdAt ? block.timestamp - v.createdAt : 0;
            uint256 duration = v.expiresAt - v.createdAt;
            // Scale by 1e6 for precision
            uint256 timeFactor = 1e6 + (elapsed * 1e6) / duration;
            uint256 volumeFactor = 1e6 + (v.yesTotal * 1e6) / v.yesCurveK;
            return (BASE_PRICE * timeFactor * volumeFactor * hotMultiplier) / (1e6 * 1e6);
        } else {
            // NO_share_price = base * (1 + yesTotal / k)
            // Using yesTotal as the driver for NO price (contrarian signal)
            uint256 volumeFactor = 1e6 + (v.yesTotal * 1e6) / v.noCurveK;
            return (BASE_PRICE * volumeFactor * hotMultiplier) / 1e6;
        }
    }

    function _calculateShares(bytes32 vaultId, bool yesSide, uint256 amount) internal view returns (uint256) {
        uint256 price = _getSharePrice(vaultId, yesSide);
        require(price > 0, "Vault: zero price");
        // shares = amount * 1e6 / price (both in 6 decimals)
        return (amount * 1e6) / price;
    }

    // --- Hot Periods (Adversity) ---
    function triggerHot(bytes32 vaultId, Severity severity) external onlyOwner {
        VaultData storage v = vaults[vaultId];
        require(v.createdAt > 0, "Vault: does not exist");
        require(v.status == Status.Open || v.status == Status.Hot, "Vault: cannot go hot");
        require(block.timestamp < v.expiresAt, "Vault: expired");

        uint256 duration;
        if (severity == Severity.Warm) duration = WARM_DURATION;
        else if (severity == Severity.Hot) duration = HOT_DURATION;
        else duration = CRITICAL_DURATION;

        v.status = Status.Hot;
        v.hotUntil = block.timestamp + duration;
        v.hotSeverity = severity;

        emit HotTriggered(vaultId, severity, v.hotUntil);
    }

    function exitDuringHot(bytes32 vaultId) external nonReentrant {
        VaultData storage v = vaults[vaultId];
        require(v.status == Status.Hot, "Vault: not hot");
        require(block.timestamp <= v.hotUntil, "Vault: hot period ended");

        Position storage pos = positions[vaultId][msg.sender];
        uint256 totalDeposited = pos.yesDeposited + pos.noDeposited;
        require(totalDeposited > 0, "Vault: no position");
        require(!pos.withdrawn, "Vault: already withdrawn");

        // Calculate burn
        uint256 burnBps;
        if (v.hotSeverity == Severity.Warm) burnBps = WARM_BURN;
        else if (v.hotSeverity == Severity.Hot) burnBps = HOT_BURN;
        else burnBps = CRITICAL_BURN;

        uint256 burnAmount = (totalDeposited * burnBps) / BPS;
        uint256 refund = totalDeposited - burnAmount;

        // Remove position
        if (pos.yesShares > 0) {
            totalYesShares[vaultId] -= pos.yesShares;
            v.yesTotal -= pos.yesDeposited;
        }
        if (pos.noShares > 0) {
            totalNoShares[vaultId] -= pos.noShares;
            v.noTotal -= pos.noDeposited;
        }
        pos.yesShares = 0;
        pos.noShares = 0;
        pos.yesDeposited = 0;
        pos.noDeposited = 0;
        pos.withdrawn = true;

        // Half of burn to ProtocolLP, half stays in vault (strengthens remaining holders)
        uint256 toLp = burnAmount / 2;
        if (toLp > 0 && address(protocolLP) != address(0)) {
            usdc.transfer(address(protocolLP), toLp);
            protocolLP.deposit(toLp);
        }
        // Other half stays in contract (effectively distributed to remaining holders on resolution)

        // Refund user
        if (refund > 0) {
            usdc.transfer(msg.sender, refund);
        }

        _removeActiveVault(msg.sender, vaultId);
        emit HotExit(vaultId, msg.sender, burnAmount);
    }

    /// @notice Called to transition back to Open after hot period ends
    function endHot(bytes32 vaultId) external {
        VaultData storage v = vaults[vaultId];
        require(v.status == Status.Hot, "Vault: not hot");
        require(block.timestamp > v.hotUntil, "Vault: hot period not ended");
        v.status = Status.Open;
    }

    // --- Resolution ---
    function resolve(bytes32 vaultId, Outcome outcome, bytes32 proofCid) external {
        VaultData storage v = vaults[vaultId];
        require(v.createdAt > 0, "Vault: does not exist");
        require(v.status == Status.Open || v.status == Status.Hot, "Vault: cannot resolve");
        require(outcome == Outcome.Yes || outcome == Outcome.No, "Vault: invalid outcome");
        require(proofCid != bytes32(0), "Vault: empty proof");

        v.status = Status.Locked;
        v.outcome = outcome;
        v.proofCid = proofCid;
        v.resolver = msg.sender;
        v.challengeUntil = block.timestamp + CHALLENGE_WINDOW;

        emit Resolved(vaultId, outcome, proofCid, msg.sender);
    }

    function challenge(bytes32 vaultId, bytes32 proofCid) external {
        VaultData storage v = vaults[vaultId];
        require(v.status == Status.Locked, "Vault: not locked");
        require(block.timestamp <= v.challengeUntil, "Vault: challenge window closed");
        require(proofCid != bytes32(0), "Vault: empty proof");

        v.status = Status.Disputed;
        v.proofCid = proofCid; // overwrite with challenger's proof

        emit Challenged(vaultId, proofCid, msg.sender);
    }

    function finalize(bytes32 vaultId) external {
        VaultData storage v = vaults[vaultId];
        require(v.status == Status.Locked, "Vault: not locked or disputed");
        require(block.timestamp > v.challengeUntil, "Vault: challenge window open");

        v.status = Status.Resolved;
        emit Finalized(vaultId, v.outcome);

        // Update creator reputation — compare outcome to creator's staked side
        if (address(agentRegistry) != address(0) && agentRegistry.isRegistered(v.creator)) {
            bool creatorWon = (v.outcome == Outcome.Yes && v.creatorSideYes) ||
                              (v.outcome == Outcome.No && !v.creatorSideYes);
            agentRegistry.updateReputation(v.creator, creatorWon);
        }
    }

    // --- Withdraw ---
    function withdraw(bytes32 vaultId) external nonReentrant {
        VaultData storage v = vaults[vaultId];
        require(v.status == Status.Resolved, "Vault: not resolved");

        Position storage pos = positions[vaultId][msg.sender];
        require(!pos.withdrawn, "Vault: already withdrawn");
        pos.withdrawn = true;

        bool isWinner;
        uint256 winnerShares;
        uint256 totalWinShares;
        uint256 loserDeposited;
        uint256 losingPool;

        if (v.outcome == Outcome.Yes) {
            isWinner = pos.yesShares > 0;
            winnerShares = pos.yesShares;
            totalWinShares = totalYesShares[vaultId];
            loserDeposited = pos.noDeposited;
            losingPool = v.noTotal;
        } else {
            isWinner = pos.noShares > 0;
            winnerShares = pos.noShares;
            totalWinShares = totalNoShares[vaultId];
            loserDeposited = pos.yesDeposited;
            losingPool = v.yesTotal;
        }

        if (isWinner && winnerShares > 0 && totalWinShares > 0) {
            // Winner gets their deposit back + proportional share of losing pool (minus haircut)
            uint256 winnerDeposited = v.outcome == Outcome.Yes ? pos.yesDeposited : pos.noDeposited;
            uint256 winnings = (losingPool * winnerShares) / totalWinShares;
            uint256 haircut = (winnings * HAIRCUT_BPS) / BPS;
            uint256 payout = winnerDeposited + winnings - haircut;

            // Send haircut to ProtocolLP
            if (haircut > 0 && address(protocolLP) != address(0)) {
                usdc.transfer(address(protocolLP), haircut);
                protocolLP.deposit(haircut);
            }

            // Pay winner
            if (payout > 0) {
                usdc.transfer(msg.sender, payout);
            }

            emit Withdrawn(vaultId, msg.sender, payout, 0);
        }

        // Loser gets FLOW tokens
        if (loserDeposited > 0 && address(flowToken) != address(0)) {
            flowToken.mint(msg.sender, loserDeposited);
            emit Withdrawn(vaultId, msg.sender, 0, loserDeposited);
        }

        _removeActiveVault(msg.sender, vaultId);
    }

    // --- Expiry ---
    /// @notice Expire a vault that passed its deadline without resolution
    function expireVault(bytes32 vaultId) external {
        VaultData storage v = vaults[vaultId];
        require(v.createdAt > 0, "Vault: does not exist");
        require(block.timestamp >= v.expiresAt, "Vault: not expired");
        require(v.status == Status.Open || v.status == Status.Hot, "Vault: already resolved/locked");

        v.status = Status.Resolved;
        v.outcome = Outcome.No; // Default to NO on expiry

        // Dust goes to ProtocolLP
        uint256 dust = v.yesTotal + v.noTotal;
        if (dust > 0 && address(protocolLP) != address(0)) {
            // Small fraction as dust
            uint256 dustAmount = dust / 100; // 1% as dust fee
            if (dustAmount > 0) {
                usdc.transfer(address(protocolLP), dustAmount);
                protocolLP.deposit(dustAmount);
            }
        }

        emit VaultExpired(vaultId);
    }

    // --- Internal: Active Vault Tracking ---
    function _trackActiveVault(address user, bytes32 vaultId) internal {
        // Check if already tracked
        bytes32[] storage active = activeVaults[user];
        for (uint256 i = 0; i < active.length; i++) {
            if (active[i] == vaultId) return; // already tracked
        }
        require(active.length < MAX_FLOATING_BETS, "Vault: max floating bets reached");
        active.push(vaultId);
    }

    function _removeActiveVault(address user, bytes32 vaultId) internal {
        bytes32[] storage active = activeVaults[user];
        for (uint256 i = 0; i < active.length; i++) {
            if (active[i] == vaultId) {
                active[i] = active[active.length - 1];
                active.pop();
                return;
            }
        }
    }

    function _requireLargeHolder(bytes32 vaultId, address user, bool yesSide) internal view {
        Position storage pos = positions[vaultId][user];
        if (yesSide) {
            uint256 total = totalYesShares[vaultId];
            require(total > 0 && (pos.yesShares * BPS) / total >= HOT_MIN_SHARE_BPS, "Vault: too small during hot");
        } else {
            uint256 total = totalNoShares[vaultId];
            require(total > 0 && (pos.noShares * BPS) / total >= HOT_MIN_SHARE_BPS, "Vault: too small during hot");
        }
    }

    // --- Views ---
    function getVault(bytes32 vaultId) external view returns (VaultData memory) {
        return vaults[vaultId];
    }

    function getPosition(bytes32 vaultId, address user) external view returns (Position memory) {
        return positions[vaultId][user];
    }

    function getActiveVaults(address user) external view returns (bytes32[] memory) {
        return activeVaults[user];
    }

    function totalVaults() external view returns (uint256) {
        return vaultIds.length;
    }

    function getVaultTotals(bytes32 vaultId) external view returns (
        uint256 yesTotal, uint256 noTotal, uint256 yesShares, uint256 noShares
    ) {
        VaultData storage v = vaults[vaultId];
        return (v.yesTotal, v.noTotal, totalYesShares[vaultId], totalNoShares[vaultId]);
    }
}
