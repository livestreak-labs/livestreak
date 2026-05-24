// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IProtocolLP {
    function totalDeposited() external view returns (uint256);
    function notifyDividends(uint256 amount) external;
}

/// @title FlowToken — loss-to-ownership ERC-20 for FlowStream
/// @notice Fair launch (zero initial supply). Minted to losers on vault resolution.
///         Stakers earn USDC dividends from ProtocolLP haircuts.
contract FlowToken is ERC20, Ownable {
    // --- State ---
    address public vault;
    address public protocolLP;

    // Staking
    mapping(address => uint256) public staked;
    uint256 public totalStaked;

    // Dividend tracking (scaled by 1e18 for precision)
    uint256 public accDividendPerShare;
    mapping(address => uint256) public rewardDebt;
    mapping(address => uint256) public pendingDividends;

    // Emission thresholds (USDC 6 decimals)
    uint256 public constant LP_THRESHOLD = 100_000e6;  // 100k USDC
    uint256 public constant LP_CAP = 1_000_000e6;      // 1M USDC

    // Emission rates: FLOW per 1 USDC lost (FLOW has 18 decimals, USDC has 6)
    uint256 public constant RATE_LOW = 100e18;   // LP < threshold
    uint256 public constant RATE_MID = 10e18;    // threshold < LP < cap
    uint256 public constant RATE_HIGH = 1e18;    // LP > cap

    // --- Events ---
    event VaultSet(address indexed vault);
    event ProtocolLPSet(address indexed protocolLP);
    event Minted(address indexed to, uint256 flowAmount, uint256 usdcLost);
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event DividendsClaimed(address indexed user, uint256 amount);
    event DividendsAdded(uint256 amount);

    // --- Modifiers ---
    modifier onlyVault() {
        require(msg.sender == vault, "FlowToken: caller is not vault");
        _;
    }

    constructor() ERC20("FlowStream", "FLOW") Ownable(msg.sender) {}

    // --- Admin ---
    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "FlowToken: zero address");
        vault = _vault;
        emit VaultSet(_vault);
    }

    function setProtocolLP(address _protocolLP) external onlyOwner {
        require(_protocolLP != address(0), "FlowToken: zero address");
        protocolLP = _protocolLP;
        emit ProtocolLPSet(_protocolLP);
    }

    // --- Minting ---
    /// @notice Mint FLOW to a loser. Amount based on USDC lost and LP health.
    /// @param to Recipient (loser)
    /// @param usdcLost Amount of USDC lost (6 decimals)
    function mint(address to, uint256 usdcLost) external onlyVault {
        uint256 rate = _emissionRate();
        // usdcLost is 6 decimals, rate is 18 decimals per 1e6 USDC
        // flowAmount = usdcLost * rate / 1e6
        uint256 flowAmount = (usdcLost * rate) / 1e6;
        _mint(to, flowAmount);
        emit Minted(to, flowAmount, usdcLost);
    }

    // --- Staking ---
    function stake(uint256 amount) external {
        require(amount > 0, "FlowToken: zero stake");
        _updatePending(msg.sender);
        _transfer(msg.sender, address(this), amount);
        staked[msg.sender] += amount;
        totalStaked += amount;
        rewardDebt[msg.sender] = (staked[msg.sender] * accDividendPerShare) / 1e18;
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external {
        require(amount > 0 && staked[msg.sender] >= amount, "FlowToken: invalid unstake");
        _updatePending(msg.sender);
        staked[msg.sender] -= amount;
        totalStaked -= amount;
        rewardDebt[msg.sender] = (staked[msg.sender] * accDividendPerShare) / 1e18;
        _transfer(address(this), msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    function claimDividends() external {
        _updatePending(msg.sender);
        uint256 amount = pendingDividends[msg.sender];
        require(amount > 0, "FlowToken: nothing to claim");
        pendingDividends[msg.sender] = 0;
        rewardDebt[msg.sender] = (staked[msg.sender] * accDividendPerShare) / 1e18;
        // Transfer USDC from ProtocolLP
        IProtocolLP(protocolLP).notifyDividends(amount);
        // The actual USDC transfer happens via ProtocolLP calling USDC.transfer
        // For simplicity, ProtocolLP sends USDC directly to the claimer
        // This is handled in ProtocolLP.notifyDividends
        emit DividendsClaimed(msg.sender, amount);
    }

    /// @notice Called by ProtocolLP when new dividends are deposited
    function addDividends(uint256 usdcAmount) external {
        require(msg.sender == protocolLP, "FlowToken: caller is not ProtocolLP");
        if (totalStaked == 0) return;
        accDividendPerShare += (usdcAmount * 1e18) / totalStaked;
        emit DividendsAdded(usdcAmount);
    }

    // --- Views ---
    function pendingRewards(address user) external view returns (uint256) {
        uint256 acc = accDividendPerShare;
        uint256 pending = pendingDividends[user];
        if (staked[user] > 0) {
            pending += (staked[user] * acc) / 1e18 - rewardDebt[user];
        }
        return pending;
    }

    function emissionRate() external view returns (uint256) {
        return _emissionRate();
    }

    // --- Internal ---
    function _updatePending(address user) internal {
        if (staked[user] > 0) {
            uint256 accumulated = (staked[user] * accDividendPerShare) / 1e18;
            pendingDividends[user] += accumulated - rewardDebt[user];
        }
    }

    function _emissionRate() internal view returns (uint256) {
        if (protocolLP == address(0)) return RATE_LOW;
        uint256 lpBalance = IProtocolLP(protocolLP).totalDeposited();
        if (lpBalance >= LP_CAP) return RATE_HIGH;
        if (lpBalance >= LP_THRESHOLD) return RATE_MID;
        return RATE_LOW;
    }
}
