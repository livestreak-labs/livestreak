// SPDX-License-Identifier: GPL-3.0-only

module livestreak::market_registry;

use sui::clock::{Self, Clock};
use sui::event;
use sui::table::{Self, Table};

const E_EMPTY_TITLE: u64 = 1;
const E_ZERO_STREAM_ID: u64 = 2;
const E_MARKET_EXISTS: u64 = 3;
const E_UNKNOWN_MARKET: u64 = 4;

public struct MarketRegistry has key {
    id: UID,
    market_count: u64,
    markets: Table<vector<u8>, MarketData>,
    vault_ids_by_market: Table<vector<u8>, vector<vector<u8>>>,
    market_ids: vector<vector<u8>>,
}

public struct MarketData has copy, drop, store {
    id: vector<u8>,
    title: vector<u8>,
    stream_id: vector<u8>,
    creator: address,
    created_at: u64,
    exists: bool,
}

public struct MarketRegistered has copy, drop {
    market_id: vector<u8>,
    creator: address,
    stream_id: vector<u8>,
    title: vector<u8>,
}

public struct VaultIndexed has copy, drop {
    market_id: vector<u8>,
    vault_id: vector<u8>,
}

public fun create_registry(ctx: &mut TxContext) {
    let registry = MarketRegistry {
        id: object::new(ctx),
        market_count: 0,
        markets: table::new(ctx),
        vault_ids_by_market: table::new(ctx),
        market_ids: vector[],
    };
    transfer::share_object(registry);
}

public fun compute_market_id(observer: address, stream_id: &vector<u8>): vector<u8> {
    let mut data = std::bcs::to_bytes(&observer);
    vector::append(&mut data, *stream_id);
    hash_to_vec(sui::hash::keccak256(&data))
}

public fun market_exists(registry: &MarketRegistry, market_id: &vector<u8>): bool {
    table::contains(&registry.markets, *market_id)
        && table::borrow(&registry.markets, *market_id).exists
}

public fun register_market(
    registry: &mut MarketRegistry,
    title: vector<u8>,
    stream_id: vector<u8>,
    clock: &sui::clock::Clock,
    ctx: &TxContext,
): vector<u8> {
    assert!(vector::length(&title) > 0, E_EMPTY_TITLE);
    assert!(vector::length(&stream_id) > 0, E_ZERO_STREAM_ID);

    let market_id = compute_market_id(ctx.sender(), &stream_id);
    assert!(!market_exists(registry, &market_id), E_MARKET_EXISTS);

    let created_at = sui::clock::timestamp_ms(clock) / 1000;
    let creator = ctx.sender();
    let data = MarketData {
        id: market_id,
        title,
        stream_id,
        creator,
        created_at,
        exists: true,
    };
    let emit_stream_id = data.stream_id;
    let emit_title = data.title;
    table::add(&mut registry.markets, market_id, data);
    table::add(&mut registry.vault_ids_by_market, market_id, vector[]);
    vector::push_back(&mut registry.market_ids, market_id);
    registry.market_count = registry.market_count + 1;

    event::emit(MarketRegistered {
        market_id,
        creator,
        stream_id: emit_stream_id,
        title: emit_title,
    });

    market_id
}

public(package) fun add_vault(
    registry: &mut MarketRegistry,
    market_id: vector<u8>,
    vault_id: vector<u8>,
) {
    assert!(market_exists(registry, &market_id), E_UNKNOWN_MARKET);
    let vaults = table::borrow_mut(&mut registry.vault_ids_by_market, market_id);
    vector::push_back(vaults, vault_id);
    event::emit(VaultIndexed { market_id, vault_id });
}

public fun get_vault_ids(registry: &MarketRegistry, market_id: &vector<u8>): &vector<vector<u8>> {
    assert!(market_exists(registry, market_id), E_UNKNOWN_MARKET);
    table::borrow(&registry.vault_ids_by_market, *market_id)
}

// --- helpers ---

fun hash_to_vec(hash: vector<u8>): vector<u8> {
    hash
}
