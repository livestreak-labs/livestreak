// SPDX-License-Identifier: GPL-3.0-only

module livestreak::vault;

use livestreak::side;
use sui::event;
use sui::table::{Self, Table};

const E_EMPTY_QUESTION: u64 = 1;
const E_ZERO_CREATOR: u64 = 2;
const E_UNKNOWN_VAULT: u64 = 3;
const E_NOT_OPEN: u64 = 4;
const E_ZERO_RATE: u64 = 5;
const E_ALREADY_FUNDING: u64 = 6;
const E_LENGTH_MISMATCH: u64 = 7;

const STATUS_OPEN: u8 = 0;

public struct VaultRegistry has key {
    id: UID,
    nonce: u64,
    vaults: Table<vector<u8>, VaultData>,
    positions: Table<PositionKey, Position>,
    account_vaults: Table<u256, vector<vector<u8>>>,
    account_in_vault: Table<AccountVaultKey, bool>,
}

public struct VaultData has copy, drop, store {
    id: vector<u8>,
    market_id: vector<u8>,
    question: vector<u8>,
    creator: address,
    status: u8,
    exists: bool,
}

public struct Position has copy, drop, store {
    rate: u256,
    max_end: u64,
}

public struct PositionKey has copy, drop, store {
    vault_id: vector<u8>,
    side: u8,
    account: u256,
}

public struct AccountVaultKey has copy, drop, store {
    account: u256,
    vault_id: vector<u8>,
}

public struct VaultCreated has copy, drop {
    vault_id: vector<u8>,
    market_id: vector<u8>,
    creator: address,
    question: vector<u8>,
}

public struct Funded has copy, drop {
    vault_id: vector<u8>,
    side: u8,
    account: u256,
    rate: u256,
    max_end: u64,
}

public struct Stopped has copy, drop {
    vault_id: vector<u8>,
    side: u8,
    account: u256,
}

public fun create_registry(ctx: &mut TxContext) {
    let registry = VaultRegistry {
        id: object::new(ctx),
        nonce: 0,
        vaults: table::new(ctx),
        positions: table::new(ctx),
        account_vaults: table::new(ctx),
        account_in_vault: table::new(ctx),
    };
    transfer::share_object(registry);
}

public fun vault_exists(registry: &VaultRegistry, vault_id: &vector<u8>): bool {
    table::contains(&registry.vaults, *vault_id)
        && table::borrow(&registry.vaults, *vault_id).exists
}

public fun market_id(registry: &VaultRegistry, vault_id: &vector<u8>): vector<u8> {
    assert!(vault_exists(registry, vault_id), E_UNKNOWN_VAULT);
    table::borrow(&registry.vaults, *vault_id).market_id
}

public fun get_position(
    registry: &VaultRegistry,
    vault_id: &vector<u8>,
    side: u8,
    account: u256,
): (u256, u64) {
    side::assert_valid(side);
    let key = PositionKey { vault_id: *vault_id, side, account };
    if (!table::contains(&registry.positions, key)) {
        return (0, 0)
    };
    let p = table::borrow(&registry.positions, key);
    (p.rate, p.max_end)
}

public(package) fun create_vault(
    registry: &mut VaultRegistry,
    market_id: vector<u8>,
    question: vector<u8>,
    creator: address,
    clock: &sui::clock::Clock,
): vector<u8> {
    assert!(vector::length(&question) > 0, E_EMPTY_QUESTION);
    assert!(creator != @0x0, E_ZERO_CREATOR);

    let ts = sui::clock::timestamp_ms(clock) / 1000;
    let vault_id = compute_vault_id(&market_id, &question, registry.nonce, ts);
    registry.nonce = registry.nonce + 1;

    let data = VaultData {
        id: vault_id,
        market_id,
        question,
        creator,
        status: STATUS_OPEN,
        exists: true,
    };
    table::add(&mut registry.vaults, vault_id, data);

    event::emit(VaultCreated {
        vault_id,
        market_id: data.market_id,
        creator,
        question: data.question,
    });

    vault_id
}

public(package) fun on_fund(
    registry: &mut VaultRegistry,
    account: u256,
    vault_id: vector<u8>,
    side: u8,
    rate: u256,
    max_end: u64,
    ctx: &mut TxContext,
) {
    side::assert_valid(side);
    assert!(vault_exists(registry, &vault_id), E_UNKNOWN_VAULT);
    let vault = table::borrow(&registry.vaults, vault_id);
    assert!(vault.status == STATUS_OPEN, E_NOT_OPEN);
    assert!(rate > 0, E_ZERO_RATE);

    track_account_vault(registry, account, vault_id, ctx);

    let key = PositionKey { vault_id, side, account };
    if (!table::contains(&registry.positions, key)) {
        table::add(
            &mut registry.positions,
            key,
            Position { rate: 0, max_end: 0 },
        );
    };
    let p = table::borrow_mut(&mut registry.positions, key);
    assert!(p.rate == 0, E_ALREADY_FUNDING);
    p.rate = rate;
    p.max_end = max_end;

    event::emit(Funded { vault_id, side, account, rate, max_end });
}

public(package) fun on_stop(
    registry: &mut VaultRegistry,
    account: u256,
    vault_id: vector<u8>,
    side: u8,
) {
    side::assert_valid(side);
    let key = PositionKey { vault_id, side, account };
    if (!table::contains(&registry.positions, key)) {
        return
    };
    let p = table::borrow_mut(&mut registry.positions, key);
    if (p.rate > 0) {
        p.rate = 0;
        event::emit(Stopped { vault_id, side, account });
    };
}

public(package) fun refresh_max_ends(
    registry: &mut VaultRegistry,
    account: u256,
    vault_ids: vector<vector<u8>>,
    sides: vector<u8>,
    new_max_end: u64,
) {
    let len = vector::length(&vault_ids);
    assert!(len == vector::length(&sides), E_LENGTH_MISMATCH);
    let mut i = 0;
    while (i < len) {
        let vault_id = *vector::borrow(&vault_ids, i);
        let side = *vector::borrow(&sides, i);
        side::assert_valid(side);
        let key = PositionKey { vault_id, side, account };
        if (table::contains(&registry.positions, key)) {
            let p = table::borrow_mut(&mut registry.positions, key);
            if (p.rate > 0) {
                p.max_end = new_max_end;
            };
        };
        i = i + 1;
    };
}

public(package) fun withdraw(
    _registry: &VaultRegistry,
    _account: u256,
    _vault_id: vector<u8>,
    _payee: address,
): u128 {
    0
}

// --- helpers ---

fun compute_vault_id(
    market_id: &vector<u8>,
    question: &vector<u8>,
    nonce: u64,
    timestamp: u64,
): vector<u8> {
    let mut data = vector[];
    vector::append(&mut data, *market_id);
    vector::append(&mut data, *question);
    vector::append(&mut data, std::bcs::to_bytes(&nonce));
    vector::append(&mut data, std::bcs::to_bytes(&timestamp));
    bytes32_from_hash(sui::hash::keccak256(&data))
}

fun bytes32_from_hash(hash: vector<u8>): vector<u8> {
    hash
}

fun track_account_vault(
    registry: &mut VaultRegistry,
    account: u256,
    vault_id: vector<u8>,
    ctx: &mut TxContext,
) {
    let av_key = AccountVaultKey { account, vault_id };
    if (table::contains(&registry.account_in_vault, av_key)) {
        return
    };
    table::add(&mut registry.account_in_vault, av_key, true);
    if (!table::contains(&registry.account_vaults, account)) {
        table::add(&mut registry.account_vaults, account, vector[]);
    };
    let vaults = table::borrow_mut(&mut registry.account_vaults, account);
    vector::push_back(vaults, vault_id);
}
