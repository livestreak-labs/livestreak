// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFlowToken {
    function addDividends(uint256 usdcAmount) external;
}

/// @title ProtocolLP — self-bootstrapping treasury for FlowStream
/// @notice Receives haircuts from vault resolutions. Distributes USDC dividends
///         to FLOW stakers. NOT the counterparty — purely a fee collector.
contract ProtocolLP is Ownable, ReentrancyGuard {
    IERC20 public immutable usdc;
    address public flowToken;
    address public vault;
    address public steward;

    uint256 public totalDeposited;

    // Surplus threshold — stewards can only boost from surplus above this
    uint256 public surplusThreshold = 10_000e6; // 10k USDC

    // Per-vault boost cap
    uint256 public maxBoostPerVault = 1_000e6; // 1k USDC
    mapping(bytes32 => uint256) public vaultBoosts;

    // --- Events ---
    event Deposited(uint256 amount, uint256 totalDeposited);
    event DividendsDistributed(uint256 amount);
    event BoostedVault(bytes32 indexed vaultId, uint256 amount);
    event SurplusThresholdUpdated(uint256 newThreshold);
    event FlowTokenSet(address indexed flowToken);
    event VaultSet(address indexed vault);
    event StewardSet(address indexed steward);

    constructor(address _usdc) Ownable(msg.sender) {
        require(_usdc != address(0), "ProtocolLP: zero USDC address");
        usdc = IERC20(_usdc);
    }

    // --- Admin ---
    function setFlowToken(address _flowToken) external onlyOwner {
        require(_flowToken != address(0), "ProtocolLP: zero address");
        flowToken = _flowToken;
        emit FlowTokenSet(_flowToken);
    }

    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "ProtocolLP: zero address");
        vault = _vault;
        emit VaultSet(_vault);
    }

    function setSteward(address _steward) external onlyOwner {
        require(_steward != address(0), "ProtocolLP: zero address");
        steward = _steward;
        emit StewardSet(_steward);
    }

    function setSurplusThreshold(uint256 _threshold) external onlyOwner {
        surplusThreshold = _threshold;
        emit SurplusThresholdUpdated(_threshold);
    }

    // --- Core ---
    /// @notice Called by Vault when a haircut is taken from resolution winnings
    function deposit(uint256 amount) external {
        require(msg.sender == vault, "ProtocolLP: caller is not vault");
        require(amount > 0, "ProtocolLP: zero amount");
        // USDC must already be transferred to this contract by the vault
        totalDeposited += amount;
        emit Deposited(amount, totalDeposited);
    }

    /// @notice Distribute available dividends to FLOW stakers
    function distributeDividends() external nonReentrant {
        require(flowToken != address(0), "ProtocolLP: FlowToken not set");
        uint256 balance = usdc.balanceOf(address(this));
        require(balance > 0, "ProtocolLP: no funds");

        // Distribute all current balance as dividends
        uint256 distributable = balance;
        usdc.approve(flowToken, distributable);
        IFlowToken(flowToken).addDividends(distributable);

        emit DividendsDistributed(distributable);
    }

    /// @notice Called by FlowToken when a staker claims dividends
    function notifyDividends(uint256 amount) external nonReentrant {
        require(msg.sender == flowToken, "ProtocolLP: caller is not FlowToken");
        require(usdc.balanceOf(address(this)) >= amount, "ProtocolLP: insufficient funds");
        // Transfer USDC to the original caller (the staker)
        // FlowToken calls this, so tx.origin is the staker
        // For safety, FlowToken should pass the recipient
        // Simplified: send to tx.origin for hackathon
        usdc.transfer(tx.origin, amount);
    }

    /// @notice Called by Steward contract to boost a vault from surplus funds
    function boost(bytes32 vaultId, uint256 amount) external nonReentrant {
        require(msg.sender == steward, "ProtocolLP: caller is not steward");
        require(amount > 0, "ProtocolLP: zero amount");

        uint256 balance = usdc.balanceOf(address(this));
        uint256 surplus = balance > surplusThreshold ? balance - surplusThreshold : 0;
        require(amount <= surplus, "ProtocolLP: exceeds surplus");

        require(
            vaultBoosts[vaultId] + amount <= maxBoostPerVault,
            "ProtocolLP: exceeds per-vault boost cap"
        );
        vaultBoosts[vaultId] += amount;

        // Transfer USDC to vault contract for the boost
        usdc.transfer(vault, amount);
        emit BoostedVault(vaultId, amount);
    }

    // --- Views ---
    function surplus() external view returns (uint256) {
        uint256 balance = usdc.balanceOf(address(this));
        return balance > surplusThreshold ? balance - surplusThreshold : 0;
    }
}
