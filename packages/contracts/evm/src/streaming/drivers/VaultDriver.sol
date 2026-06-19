// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {IDrips} from "../IDrips.sol";
import {Protocol} from "../../Protocol.sol";
import {Vault} from "../../vault/Vault.sol";
import {Side} from "../../vault/Side.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";

/// @notice Receiver-side Drips adapter: vault-side receiver accounts and harvest into the Vault.
contract VaultDriver {
    Protocol public immutable protocol;

    IDrips public drips;
    IERC20 public usdc;
    uint32 public driverId;

    uint64 public nextPoolId = 1;
    mapping(bytes32 => mapping(Side => uint64)) public poolIdOf;

    event StreamingSet(address indexed drips, address indexed usdc, uint32 driverId);

    constructor(Protocol protocol_) {
        require(address(protocol_) != address(0), "VaultDriver: zero protocol");
        protocol = protocol_;
    }

    modifier onlyFundingDriver() {
        require(msg.sender == protocol.addressDriver(), "VaultDriver: not funding driver");
        _;
    }

    /// @notice Register as the Drips receiver driver. Must run before the user AddressDriver slot is reserved.
    function bootstrapStreaming(IERC20 usdc_) external {
        require(address(drips) == address(0), "VaultDriver: streaming already bootstrapped");
        require(address(usdc_) != address(0), "VaultDriver: zero usdc");

        address drips_ = protocol.dripsStreaming();
        require(drips_ != address(0), "VaultDriver: drips unset");

        drips = IDrips(drips_);
        usdc = usdc_;
        driverId = drips.registerDriver(address(this));
        emit StreamingSet(drips_, address(usdc_), driverId);
    }

    /// @notice The Drips receiver account for a (vault, side); assigns a poolId on first use.
    function receiverAccount(bytes32 vaultId, Side side) external onlyFundingDriver returns (uint256) {
        (,,,,,,, bool exists) = Vault(protocol.vault()).vaults(vaultId);
        require(exists, "VaultDriver: unknown vault");
        uint64 pid = poolIdOf[vaultId][side];
        if (pid == 0) {
            pid = nextPoolId++;
            poolIdOf[vaultId][side] = pid;
        }
        return _receiverAccount(pid);
    }

    function receiverAccountView(bytes32 vaultId, Side side) external view returns (uint256) {
        return _receiverAccount(poolIdOf[vaultId][side]);
    }

    /// @notice Bank a vault-side's delivered USDC into the Vault. Permissionless and idempotent.
    function harvest(bytes32 vaultId, Side side) external returns (uint256) {
        uint64 pid = poolIdOf[vaultId][side];
        if (pid == 0) return 0;
        uint256 receiver = _receiverAccount(pid);
        drips.receiveStreams(receiver, usdc, type(uint32).max);
        uint128 amt = drips.collect(receiver, usdc);
        if (amt > 0) drips.withdraw(usdc, protocol.vault(), amt);
        return uint256(amt);
    }

    function _receiverAccount(uint64 poolId) internal view returns (uint256) {
        return (uint256(driverId) << 224) | uint256(poolId);
    }
}
