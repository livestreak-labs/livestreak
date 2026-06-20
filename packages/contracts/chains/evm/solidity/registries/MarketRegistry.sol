// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Protocol} from "../Protocol.sol";

/// @title MarketRegistry — observer-created market index and vault catalog
/// @notice Owns market registration and market -> vault id index. Vault creation is VaultDriver-gated.
/// @dev marketId = keccak256(abi.encode(observer, streamId)). registerMarket is state writes + emit only (no external calls).
contract MarketRegistry is Ownable {
    Protocol public immutable protocol;

    struct MarketData {
        bytes32 id;
        string title;
        bytes32 streamId;
        address creator;
        uint256 createdAt;
        bool exists;
    }

    uint256 public marketCount;
    bytes32[] private _marketIds;
    mapping(bytes32 => MarketData) public markets;
    mapping(bytes32 => bytes32[]) private _vaultIdsByMarket;

    event MarketRegistered(bytes32 indexed marketId, address indexed creator, bytes32 indexed streamId, string title);
    event VaultIndexed(bytes32 indexed marketId, bytes32 indexed vaultId);

    enum StreamStatus {
        None,
        Live,
        Ended
    }

    struct StreamState {
        StreamStatus status;
        bytes32 pointer;
        uint64 updatedAt;
        uint64 endedAt;
    }

    uint64 public constant STREAM_LOCK_GRACE = 1 days;

    mapping(bytes32 => StreamState) public streamState;

    event StreamLive(bytes32 indexed marketId, bytes32 pointer, uint64 updatedAt);
    event StreamEnded(bytes32 indexed marketId, bytes32 pointer, uint64 endedAt);

    constructor(address initialOwner, Protocol protocol_) Ownable(initialOwner) {
        require(address(protocol_) != address(0), "MarketRegistry: zero protocol");
        protocol = protocol_;
    }

    function computeMarketId(address observer, bytes32 streamId) public pure returns (bytes32) {
        return keccak256(abi.encode(observer, streamId));
    }

    function vaultDriver() public view returns (address) {
        return protocol.vaultDriver();
    }

    function registerMarket(string calldata title, bytes32 streamId) external returns (bytes32 marketId) {
        require(bytes(title).length > 0, "MarketRegistry: empty title");
        require(streamId != bytes32(0), "MarketRegistry: zero streamId");

        marketId = computeMarketId(msg.sender, streamId);
        require(!markets[marketId].exists, "MarketRegistry: market exists");

        markets[marketId] = MarketData({
            id: marketId,
            title: title,
            streamId: streamId,
            creator: msg.sender,
            createdAt: block.timestamp,
            exists: true
        });

        marketCount++;
        _marketIds.push(marketId);

        emit MarketRegistered(marketId, msg.sender, streamId, title);
    }

    function addVault(bytes32 marketId, bytes32 vaultId) external {
        require(msg.sender == vaultDriver(), "MarketRegistry: not vault driver");
        require(markets[marketId].exists, "MarketRegistry: unknown market");

        _vaultIdsByMarket[marketId].push(vaultId);
        emit VaultIndexed(marketId, vaultId);
    }

    function marketExists(bytes32 marketId) external view returns (bool) {
        return markets[marketId].exists;
    }

    function getMarket(bytes32 marketId) external view returns (MarketData memory) {
        require(markets[marketId].exists, "MarketRegistry: unknown market");
        return markets[marketId];
    }

    function marketIdAt(uint256 index) external view returns (bytes32) {
        require(index < _marketIds.length, "MarketRegistry: index out of bounds");
        return _marketIds[index];
    }

    function getVaultIds(bytes32 marketId) external view returns (bytes32[] memory) {
        require(markets[marketId].exists, "MarketRegistry: unknown market");
        return _vaultIdsByMarket[marketId];
    }

    modifier onlyMarketCreator(bytes32 marketId) {
        require(markets[marketId].exists, "MarketRegistry: unknown market");
        require(markets[marketId].creator == msg.sender, "MarketRegistry: not creator");
        _;
    }

    /// @notice Creator marks the stream live (first call) or re-points the live manifest.
    function goLive(bytes32 marketId, bytes32 pointer) external onlyMarketCreator(marketId) {
        require(pointer != bytes32(0), "MarketRegistry: zero pointer");
        StreamState storage s = streamState[marketId];
        require(s.status != StreamStatus.Ended, "MarketRegistry: stream ended");
        s.status = StreamStatus.Live;
        s.pointer = pointer;
        s.updatedAt = uint64(block.timestamp);
        emit StreamLive(marketId, pointer, s.updatedAt);
    }

    /// @notice Creator ends the stream (first call freezes endedAt) or revises the VOD pointer until lock.
    function setEnded(bytes32 marketId, bytes32 vodPointer) external onlyMarketCreator(marketId) {
        require(vodPointer != bytes32(0), "MarketRegistry: zero pointer");
        StreamState storage s = streamState[marketId];
        require(s.status != StreamStatus.None, "MarketRegistry: not live");
        require(!_isLocked(s), "MarketRegistry: stream locked");
        if (s.status != StreamStatus.Ended) {
            s.status = StreamStatus.Ended;
            s.endedAt = uint64(block.timestamp);
        }
        s.pointer = vodPointer;
        s.updatedAt = uint64(block.timestamp);
        emit StreamEnded(marketId, vodPointer, s.endedAt);
    }

    function isLocked(bytes32 marketId) external view returns (bool) {
        return _isLocked(streamState[marketId]);
    }

    function _isLocked(StreamState storage s) private view returns (bool) {
        return s.status == StreamStatus.Ended && block.timestamp > uint256(s.endedAt) + STREAM_LOCK_GRACE;
    }
}
