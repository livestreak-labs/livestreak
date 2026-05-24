// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AgentRegistry — ERC-8004-style identity for FlowStream agents
/// @notice Tracks bookmaker, steward, and observer agents with reputation
contract AgentRegistry {
    enum AgentType { Bookmaker, Steward, Observer }

    struct Agent {
        string name;
        AgentType agentType;
        uint256 vaultsCreated;
        uint256 wins;
        uint256 losses;
        uint256 registeredAt;
        bool exists;
    }

    mapping(address => Agent) public agents;
    address[] public agentList;

    address public vault; // only vault can update reputation

    // --- Events ---
    event AgentRegistered(address indexed agent, string name, AgentType agentType);
    event ReputationUpdated(address indexed agent, bool win, uint256 wins, uint256 losses);
    event VaultSet(address indexed vault);

    modifier onlyVault() {
        require(msg.sender == vault, "AgentRegistry: caller is not vault");
        _;
    }

    function setVault(address _vault) external {
        // One-time set or owner-only in production; for hackathon, first-caller wins
        require(vault == address(0), "AgentRegistry: vault already set");
        vault = _vault;
        emit VaultSet(_vault);
    }

    function registerAgent(string calldata name, AgentType agentType) external {
        require(!agents[msg.sender].exists, "AgentRegistry: already registered");
        require(bytes(name).length > 0, "AgentRegistry: empty name");

        agents[msg.sender] = Agent({
            name: name,
            agentType: agentType,
            vaultsCreated: 0,
            wins: 0,
            losses: 0,
            registeredAt: block.timestamp,
            exists: true
        });
        agentList.push(msg.sender);

        emit AgentRegistered(msg.sender, name, agentType);
    }

    function updateReputation(address agent, bool win) external onlyVault {
        require(agents[agent].exists, "AgentRegistry: not registered");
        if (win) {
            agents[agent].wins++;
        } else {
            agents[agent].losses++;
        }
        emit ReputationUpdated(agent, win, agents[agent].wins, agents[agent].losses);
    }

    function incrementVaultsCreated(address agent) external onlyVault {
        require(agents[agent].exists, "AgentRegistry: not registered");
        agents[agent].vaultsCreated++;
    }

    // --- Views ---

    /// @notice Get full agent identity and stats
    function getAgent(address agent) external view returns (
        address agentAddress,
        string memory name,
        AgentType agentType,
        uint256 vaultsCreated,
        uint256 wins,
        uint256 losses,
        uint256 accuracy,
        uint256 registeredAt,
        bool exists
    ) {
        Agent storage a = agents[agent];
        agentAddress = agent;
        name = a.name;
        agentType = a.agentType;
        vaultsCreated = a.vaultsCreated;
        wins = a.wins;
        losses = a.losses;
        registeredAt = a.registeredAt;
        exists = a.exists;
        uint256 total = wins + losses;
        accuracy = total > 0 ? (wins * 10000) / total : 0;
    }

    function getReputation(address agent) external view returns (
        uint256 wins, uint256 losses, uint256 vaultsCreated, uint256 accuracy
    ) {
        Agent storage a = agents[agent];
        require(a.exists, "AgentRegistry: not registered");
        wins = a.wins;
        losses = a.losses;
        vaultsCreated = a.vaultsCreated;
        uint256 total = wins + losses;
        accuracy = total > 0 ? (wins * 10000) / total : 0; // basis points
    }

    function isRegistered(address agent) external view returns (bool) {
        return agents[agent].exists;
    }

    function totalAgents() external view returns (uint256) {
        return agentList.length;
    }

    /// @notice Get all agent addresses (use with getAgent for full data)
    function getAgentList() external view returns (address[] memory) {
        return agentList;
    }

    /// @notice Get top agents by accuracy, filtered by type
    /// @param limit Max agents to return (0 = all)
    /// @param filterType Agent type to filter (255 = all types)
    function getAgentsByType(uint8 filterType, uint256 limit) external view returns (
        address[] memory addrs,
        uint256 count
    ) {
        uint256 total = agentList.length;
        uint256 maxOut = limit == 0 ? total : (limit < total ? limit : total);
        addrs = new address[](maxOut);
        count = 0;

        for (uint256 i = 0; i < total && count < maxOut; i++) {
            Agent storage a = agents[agentList[i]];
            if (filterType == 255 || uint8(a.agentType) == filterType) {
                addrs[count] = agentList[i];
                count++;
            }
        }
    }
}
