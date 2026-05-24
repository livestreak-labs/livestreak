// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ObserverRegistry — stats provider tracking for FlowStream
/// @notice Observers submit IPFS batches of live video observations.
///         Earns fees from vault haircuts + FLOW emissions.
contract ObserverRegistry is Ownable {
    struct Observer {
        string name;
        uint256 batchesSubmitted;
        uint256 vaultsServed;
        uint256 feesEarnedUSDC;  // 6 decimals
        uint256 flowEarned;      // 18 decimals
        uint256 registeredAt;
        bool exists;
    }

    mapping(address => Observer) public observers;
    address[] public observerList;

    // Batch records
    struct Batch {
        address observer;
        bytes32 ipfsCid;
        uint256 timestamp;
    }
    Batch[] public batches;

    address public vault;

    // --- Events ---
    event ObserverRegistered(address indexed observer, string name);
    event BatchSubmitted(address indexed observer, bytes32 ipfsCid, uint256 batchIndex);
    event FeePaid(address indexed observer, uint256 usdcAmount, uint256 flowAmount);
    event VaultServed(address indexed observer);
    event VaultSet(address indexed vault);

    constructor() Ownable(msg.sender) {}

    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "ObserverRegistry: zero address");
        vault = _vault;
        emit VaultSet(_vault);
    }

    function registerObserver(string calldata name) external {
        require(!observers[msg.sender].exists, "ObserverRegistry: already registered");
        require(bytes(name).length > 0, "ObserverRegistry: empty name");

        observers[msg.sender] = Observer({
            name: name,
            batchesSubmitted: 0,
            vaultsServed: 0,
            feesEarnedUSDC: 0,
            flowEarned: 0,
            registeredAt: block.timestamp,
            exists: true
        });
        observerList.push(msg.sender);

        emit ObserverRegistered(msg.sender, name);
    }

    function submitBatch(bytes32 ipfsCid) external {
        require(observers[msg.sender].exists, "ObserverRegistry: not registered");
        require(ipfsCid != bytes32(0), "ObserverRegistry: empty CID");

        observers[msg.sender].batchesSubmitted++;
        batches.push(Batch({
            observer: msg.sender,
            ipfsCid: ipfsCid,
            timestamp: block.timestamp
        }));

        emit BatchSubmitted(msg.sender, ipfsCid, batches.length - 1);
    }

    /// @notice Called by Vault or ProtocolLP to credit fees to an observer
    function creditFee(address observer, uint256 usdcAmount, uint256 flowAmount) external {
        require(msg.sender == vault || msg.sender == owner(), "ObserverRegistry: unauthorized");
        require(observers[observer].exists, "ObserverRegistry: not registered");

        observers[observer].feesEarnedUSDC += usdcAmount;
        observers[observer].flowEarned += flowAmount;
        emit FeePaid(observer, usdcAmount, flowAmount);
    }

    function incrementVaultsServed(address observer) external {
        require(msg.sender == vault, "ObserverRegistry: caller is not vault");
        require(observers[observer].exists, "ObserverRegistry: not registered");
        observers[observer].vaultsServed++;
        emit VaultServed(observer);
    }

    // --- Views ---
    function getObserverStats(address observer) external view returns (
        uint256 batchesSubmitted,
        uint256 vaultsServed,
        uint256 feesEarnedUSDC,
        uint256 flowEarned
    ) {
        Observer storage o = observers[observer];
        require(o.exists, "ObserverRegistry: not registered");
        return (o.batchesSubmitted, o.vaultsServed, o.feesEarnedUSDC, o.flowEarned);
    }

    function isRegistered(address observer) external view returns (bool) {
        return observers[observer].exists;
    }

    function totalObservers() external view returns (uint256) {
        return observerList.length;
    }

    function totalBatches() external view returns (uint256) {
        return batches.length;
    }

    /// @notice Get all observer addresses
    function getObserverList() external view returns (address[] memory) {
        return observerList;
    }

    /// @notice Get full observer identity and stats
    function getObserver(address observer) external view returns (
        address observerAddress,
        string memory name,
        uint256 batchesSubmitted,
        uint256 vaultsServed,
        uint256 feesEarnedUSDC,
        uint256 flowEarned,
        uint256 registeredAt,
        bool exists
    ) {
        Observer storage o = observers[observer];
        return (observer, o.name, o.batchesSubmitted, o.vaultsServed,
                o.feesEarnedUSDC, o.flowEarned, o.registeredAt, o.exists);
    }
}
