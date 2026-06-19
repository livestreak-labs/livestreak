// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {Context} from "openzeppelin-contracts/utils/Context.sol";
import {ERC2771Context} from "openzeppelin-contracts/metatx/ERC2771Context.sol";
import {ERC721, ERC721URIStorage, IERC721} from "openzeppelin-contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {StreamReceiver, StreamConfigImpl} from "../Streams.sol";
import {Managed} from "../Managed.sol";
import {SharedDriverUtils} from "./SharedDriverUtils.sol";
import {VaultDriver} from "./VaultDriver.sol";
import {IDrips} from "../IDrips.sol";
import {Protocol} from "../../Protocol.sol";
import {Vault} from "../../vault/Vault.sol";
import {Side} from "../../vault/Side.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";

interface IMarketRegistry {
    function marketExists(bytes32 marketId) external view returns (bool);
}

interface ITreasuryLoss {
    function mintLossLvst(uint256 account, address to, bytes32 vaultId, Side side) external returns (uint256);
}

/// @notice Per-market NFT driver: one tokenId == one Drips account, ≤MAX_LANES concurrent lanes —
/// one lane per vault (a held vault streams YES or NO, never both; hedge by flipping via `switchSide`).
/// The lane ceiling is naturally the market's vault count (you cannot fund a vault that does not
/// exist), hard-capped at MAX_LANES so the shared-balance maxEnd refresh stays bounded.
contract MarketDriver is SharedDriverUtils, ERC721URIStorage, Managed {
    uint32 public immutable DRIVER_ID;
    Protocol public immutable PROTOCOL;
    Vault public immutable VAULT;
    VaultDriver public immutable VAULT_DRIVER;

    /// @notice Hard ceiling on concurrent lanes (distinct vaults) per NFT — bounds refresh gas.
    uint8 public constant MAX_LANES = 10;
    uint256 public constant MAX_WITHDRAW_VAULTS = 64;

    uint64 internal _mintedTokens;
    mapping(address => mapping(uint64 => bool)) internal _isSaltUsed;

    mapping(uint256 => bytes32) public marketIdOf;
    mapping(uint256 => bytes32[]) internal _laneKeys;
    mapping(uint256 => mapping(bytes32 => Lane)) internal _lanes;

    struct Lane {
        bytes32 vaultId;
        Side side;
        uint256 rate;
    }

    event MarketNftMinted(uint256 indexed tokenId, bytes32 indexed marketId, address indexed to);
    event LaneFunded(
        uint256 indexed tokenId, bytes32 indexed vaultId, Side side, uint256 rate, uint256 deposit, uint32 maxEnd
    );
    event LaneStopped(uint256 indexed tokenId, bytes32 indexed vaultId, Side side);
    event AllLanesStopped(uint256 indexed tokenId, uint256 refunded);

    constructor(
        address drips_,
        address forwarder,
        uint32 driverId_,
        Protocol protocol_,
        Vault vault_,
        VaultDriver vaultDriver_,
        address usdc_
    ) SharedDriverUtils(IDrips(drips_), forwarder, IERC20(usdc_)) ERC721("", "") {
        DRIVER_ID = driverId_;
        PROTOCOL = protocol_;
        VAULT = vault_;
        VAULT_DRIVER = vaultDriver_;
    }

    modifier onlyHolder(uint256 tokenId) {
        require(_isApprovedOrOwner(_msgSender(), tokenId), "MarketDriver: not holder");
        _;
    }

    // --- exports ---

    function nextTokenId() public view returns (uint256 tokenId) {
        return _calcTokenIdWithSalt(address(0), _mintedTokens);
    }

    function calcTokenIdWithSalt(address minter, uint64 salt) public view returns (uint256 tokenId) {
        return _calcTokenIdWithSalt(minter, salt);
    }

    function isSaltUsed(address minter, uint64 salt) external view returns (bool) {
        return _isSaltUsed[minter][salt];
    }

    function laneCount(uint256 tokenId) public view returns (uint256) {
        return _laneKeys[tokenId].length;
    }

    function laneAt(uint256 tokenId, uint256 index) external view returns (bytes32 vaultId, Side side, uint256 rate) {
        bytes32 key = _laneKeys[tokenId][index];
        Lane storage lane = _lanes[tokenId][key];
        return (lane.vaultId, lane.side, lane.rate);
    }

    function mint(bytes32 marketId_, address to) external whenNotPaused returns (uint256 tokenId) {
        require(IMarketRegistry(PROTOCOL.marketRegistry()).marketExists(marketId_), "MarketDriver: unknown market");
        tokenId = _registerTokenId();
        marketIdOf[tokenId] = marketId_;
        _mint(to, tokenId);
        emit MarketNftMinted(tokenId, marketId_, to);
    }

    function mintWithSalt(bytes32 marketId_, uint64 salt, address to) external whenNotPaused returns (uint256 tokenId) {
        require(IMarketRegistry(PROTOCOL.marketRegistry()).marketExists(marketId_), "MarketDriver: unknown market");
        tokenId = _registerTokenIdWithSalt(salt);
        marketIdOf[tokenId] = marketId_;
        _mint(to, tokenId);
        emit MarketNftMinted(tokenId, marketId_, to);
    }

    function fund(uint256 tokenId, bytes32 vaultId, Side side, uint256 rate, uint256 deposit)
        external
        onlyHolder(tokenId)
        whenNotPaused
    {
        require(rate > 0, "MarketDriver: zero rate");
        require(deposit > 0 && deposit <= uint256(uint128(type(int128).max)), "MarketDriver: bad deposit");
        require(VAULT.marketId(vaultId) == marketIdOf[tokenId], "MarketDriver: wrong market");
        bytes32 key = vaultId; // one lane per vault: a held vault streams YES or NO, never both
        require(_lanes[tokenId][key].rate == 0, "MarketDriver: vault already has a lane");
        require(_laneKeys[tokenId].length < MAX_LANES, "MarketDriver: too many lanes");

        StreamReceiver[] memory curr = _buildReceivers(tokenId);
        _laneKeys[tokenId].push(key);
        _lanes[tokenId][key] = Lane({vaultId: vaultId, side: side, rate: rate});

        StreamReceiver[] memory next = _buildReceivers(tokenId);
        _transferFromCaller(USDC, uint128(deposit));
        DRIPS.setStreams(tokenId, USDC, curr, int128(uint128(deposit)), next, 0, 0);
        (,,,, uint32 maxEnd) = DRIPS.streamsState(tokenId, USDC);

        VAULT.onFund(tokenId, vaultId, side, rate, maxEnd);
        _refreshOtherLanes(tokenId, vaultId, maxEnd);

        emit LaneFunded(tokenId, vaultId, side, rate, deposit, maxEnd);
    }

    function stop(uint256 tokenId, bytes32 vaultId, Side side) external onlyHolder(tokenId) whenNotPaused {
        bytes32 key = vaultId;
        Lane storage lane = _lanes[tokenId][key];
        require(lane.rate > 0 && lane.side == side, "MarketDriver: no lane");

        StreamReceiver[] memory curr = _buildReceivers(tokenId);
        _removeLane(tokenId, key);
        StreamReceiver[] memory next = _buildReceivers(tokenId);

        DRIPS.setStreams(tokenId, USDC, curr, 0, next, 0, 0);
        VAULT.onStop(tokenId, vaultId, side);
        (,,,, uint32 maxEnd) = DRIPS.streamsState(tokenId, USDC);
        if (_laneKeys[tokenId].length > 0) {
            _refreshAllLanes(tokenId, maxEnd);
        }

        emit LaneStopped(tokenId, vaultId, side);
    }

    /// @notice Hedge by flipping this vault's lane to the opposite side. Banks the current side's
    /// accrued shares (they survive and still pay out if that side wins), then opens the other side at
    /// the *current* curve price — you "suffer late incoming". One lane per vault is preserved; pass
    /// `addDeposit > 0` to top up the shared balance. Switching back later accrues onto the prior side.
    function switchSide(uint256 tokenId, bytes32 vaultId, uint256 newRate, uint256 addDeposit)
        external
        onlyHolder(tokenId)
        whenNotPaused
    {
        require(newRate > 0, "MarketDriver: zero rate");
        require(addDeposit <= uint256(uint128(type(int128).max)), "MarketDriver: bad deposit");
        Lane storage lane = _lanes[tokenId][vaultId];
        require(lane.rate > 0, "MarketDriver: no lane");
        Side oldSide = lane.side;
        Side newSide = oldSide == Side.Yes ? Side.No : Side.Yes;

        StreamReceiver[] memory curr = _buildReceivers(tokenId);
        lane.side = newSide;
        lane.rate = newRate;
        StreamReceiver[] memory next = _buildReceivers(tokenId);

        if (addDeposit > 0) _transferFromCaller(USDC, uint128(addDeposit));
        DRIPS.setStreams(tokenId, USDC, curr, int128(uint128(addDeposit)), next, 0, 0);
        (,,,, uint32 maxEnd) = DRIPS.streamsState(tokenId, USDC);

        VAULT.onStop(tokenId, vaultId, oldSide);
        VAULT.onFund(tokenId, vaultId, newSide, newRate, maxEnd);
        _refreshOtherLanes(tokenId, vaultId, maxEnd);

        emit LaneStopped(tokenId, vaultId, oldSide);
        emit LaneFunded(tokenId, vaultId, newSide, newRate, addDeposit, maxEnd);
    }

    /// @notice Atomically free a slot and move on: stop the lane on `dropVaultId` (its accrued shares
    /// survive on its Board for later claim) and open a fresh lane on `newVaultId`. Net lane count is
    /// unchanged, so this is how you keep streaming a new vault once you are at MAX_LANES — clean up a
    /// spent/unwanted lane and step to the next one, no separate stop tx and no intermediate gap.
    /// The caller chooses which lane to drop (auto-evicting a live lane would silently kill a position,
    /// and shared-balance lanes run dry together so there is no single "dead" one to detect).
    function replaceLane(
        uint256 tokenId,
        bytes32 dropVaultId,
        bytes32 newVaultId,
        Side newSide,
        uint256 newRate,
        uint256 addDeposit
    ) external onlyHolder(tokenId) whenNotPaused {
        require(newRate > 0, "MarketDriver: zero rate");
        require(addDeposit <= uint256(uint128(type(int128).max)), "MarketDriver: bad deposit");
        require(dropVaultId != newVaultId, "MarketDriver: same vault");
        require(VAULT.marketId(newVaultId) == marketIdOf[tokenId], "MarketDriver: wrong market");

        Lane storage dropLane = _lanes[tokenId][dropVaultId];
        require(dropLane.rate > 0, "MarketDriver: no lane to drop");
        require(_lanes[tokenId][newVaultId].rate == 0, "MarketDriver: vault already has a lane");
        Side dropSide = dropLane.side;

        StreamReceiver[] memory curr = _buildReceivers(tokenId);
        _removeLane(tokenId, dropVaultId);
        _laneKeys[tokenId].push(newVaultId);
        _lanes[tokenId][newVaultId] = Lane({vaultId: newVaultId, side: newSide, rate: newRate});
        StreamReceiver[] memory next = _buildReceivers(tokenId);

        if (addDeposit > 0) _transferFromCaller(USDC, uint128(addDeposit));
        DRIPS.setStreams(tokenId, USDC, curr, int128(uint128(addDeposit)), next, 0, 0);
        (,,,, uint32 maxEnd) = DRIPS.streamsState(tokenId, USDC);

        VAULT.onStop(tokenId, dropVaultId, dropSide);
        VAULT.onFund(tokenId, newVaultId, newSide, newRate, maxEnd);
        _refreshOtherLanes(tokenId, newVaultId, maxEnd);

        emit LaneStopped(tokenId, dropVaultId, dropSide);
        emit LaneFunded(tokenId, newVaultId, newSide, newRate, addDeposit, maxEnd);
    }

    function stopAll(uint256 tokenId) external onlyHolder(tokenId) {
        StreamReceiver[] memory curr = _buildReceivers(tokenId);
        bytes32[] memory keys = _laneKeys[tokenId];
        for (uint256 i = 0; i < keys.length; i++) {
            Lane memory lane = _lanes[tokenId][keys[i]];
            VAULT.onStop(tokenId, lane.vaultId, lane.side);
            delete _lanes[tokenId][keys[i]];
        }
        delete _laneKeys[tokenId];

        int128 realDelta = DRIPS.setStreams(tokenId, USDC, curr, type(int128).min, new StreamReceiver[](0), 0, 0);
        uint256 refunded;
        if (realDelta < 0) {
            refunded = uint256(uint128(-realDelta));
            DRIPS.withdraw(USDC, _msgSender(), refunded);
        }
        emit AllLanesStopped(tokenId, refunded);
    }

    function withdraw(uint256 tokenId, bytes32 vaultId) external onlyHolder(tokenId) returns (uint256 payout) {
        return VAULT.withdraw(tokenId, vaultId, _msgSender());
    }

    function withdraw(uint256 tokenId, bytes32[] calldata vaultIds)
        external
        onlyHolder(tokenId)
        returns (uint256 total)
    {
        for (uint256 i = 0; i < vaultIds.length; i++) {
            total += VAULT.withdraw(tokenId, vaultIds[i], _msgSender());
        }
    }

    function withdrawAll(uint256 tokenId, uint256 maxVaults) external onlyHolder(tokenId) returns (uint256 total) {
        bytes32[] memory ids = VAULT.getAccountVaultIds(tokenId);
        uint256 n = ids.length;
        if (n > maxVaults) n = maxVaults;
        if (n > MAX_WITHDRAW_VAULTS) n = MAX_WITHDRAW_VAULTS;
        for (uint256 i = 0; i < n; i++) {
            total += VAULT.withdraw(tokenId, ids[i], _msgSender());
        }
    }

    function claimLossLvst(uint256 tokenId, bytes32 vaultId, Side side)
        external
        onlyHolder(tokenId)
        returns (uint256 minted)
    {
        address treasury = PROTOCOL.treasury();
        require(treasury != address(0), "MarketDriver: treasury unset");
        return ITreasuryLoss(treasury).mintLossLvst(tokenId, _msgSender(), vaultId, side);
    }

    // --- helpers ---

    function _callerAccountId() internal view override returns (uint256) {
        revert("MarketDriver: no caller account");
    }

    function _calcTokenIdWithSalt(address minter, uint64 salt) internal view returns (uint256 tokenId) {
        tokenId = DRIVER_ID;
        tokenId = (tokenId << 160) | uint160(minter);
        tokenId = (tokenId << 64) | uint256(salt);
    }

    function _registerTokenId() internal returns (uint256 tokenId) {
        tokenId = nextTokenId();
        _mintedTokens++;
    }

    function _registerTokenIdWithSalt(uint64 salt) internal returns (uint256 tokenId) {
        address minter = _msgSender();
        require(!_isSaltUsed[minter][salt], "MarketDriver: salt used");
        _isSaltUsed[minter][salt] = true;
        return _calcTokenIdWithSalt(minter, salt);
    }

    function _removeLane(uint256 tokenId, bytes32 key) internal {
        bytes32[] storage keys = _laneKeys[tokenId];
        uint256 len = keys.length;
        for (uint256 i = 0; i < len; i++) {
            if (keys[i] == key) {
                keys[i] = keys[len - 1];
                keys.pop();
                delete _lanes[tokenId][key];
                return;
            }
        }
    }

    function _buildReceivers(uint256 tokenId) internal returns (StreamReceiver[] memory receivers) {
        bytes32[] storage keys = _laneKeys[tokenId];
        uint256 n = keys.length;
        receivers = new StreamReceiver[](n);
        for (uint256 i = 0; i < n; i++) {
            Lane storage lane = _lanes[tokenId][keys[i]];
            uint256 recv = VAULT_DRIVER.receiverAccount(lane.vaultId, lane.side);
            receivers[i] = StreamReceiver({
                accountId: recv, config: StreamConfigImpl.create(0, uint160(lane.rate * AMT_MUL), 0, 0)
            });
        }
        _sortReceivers(receivers);
    }

    function _sortReceivers(StreamReceiver[] memory receivers) internal pure {
        uint256 n = receivers.length;
        for (uint256 i = 1; i < n; i++) {
            StreamReceiver memory x = receivers[i];
            uint256 j = i;
            while (j > 0 && receivers[j - 1].accountId > x.accountId) {
                receivers[j] = receivers[j - 1];
                j--;
            }
            receivers[j] = x;
        }
    }

    function _refreshOtherLanes(uint256 tokenId, bytes32 newVaultId, uint32 maxEnd) internal {
        bytes32[] storage keys = _laneKeys[tokenId];
        uint256 n = keys.length;
        if (n <= 1) return;
        bytes32 newKey = newVaultId;
        bytes32[] memory vaultIds = new bytes32[](n - 1);
        Side[] memory sides = new Side[](n - 1);
        uint256 j;
        for (uint256 i = 0; i < n; i++) {
            bytes32 key = keys[i];
            if (key == newKey) continue;
            Lane storage lane = _lanes[tokenId][key];
            vaultIds[j] = lane.vaultId;
            sides[j] = lane.side;
            j++;
        }
        VAULT.refreshMaxEnds(tokenId, vaultIds, sides, maxEnd);
    }

    function _refreshAllLanes(uint256 tokenId, uint32 maxEnd) internal {
        bytes32[] storage keys = _laneKeys[tokenId];
        uint256 n = keys.length;
        bytes32[] memory vaultIds = new bytes32[](n);
        Side[] memory sides = new Side[](n);
        for (uint256 i = 0; i < n; i++) {
            Lane storage lane = _lanes[tokenId][keys[i]];
            vaultIds[i] = lane.vaultId;
            sides[i] = lane.side;
        }
        VAULT.refreshMaxEnds(tokenId, vaultIds, sides, maxEnd);
    }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
