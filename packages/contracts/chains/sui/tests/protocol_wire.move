// SPDX-License-Identifier: MIT

#[test_only]
module livestreak::protocol_wire;

use livestreak::drips::{Self, DripsRegistry};
use livestreak::driver_registry::{Self, DriverRegistry};
use livestreak::market_driver::{Self, MarketDriverRegistry};
use livestreak::market_registry::{Self, MarketRegistry};
use livestreak::protocol::{Self, Protocol};
use livestreak::steward_registry::{Self, StewardRegistry};
use livestreak::streams::StreamsRegistry;
use livestreak::test_usdc::{Self, USDC, UsdcMintCap};
use livestreak::treasury::{Self, TreasuryRegistry};
use livestreak::vault::{Self, VaultRegistry};
use livestreak::vault_driver::{Self, VaultDriverRegistry};

const CYCLE_SECS: u64 = 10;

public fun deploy_core(ctx: &mut TxContext, admin: address) {
    protocol::create(admin, ctx);
    market_registry::create_registry(ctx);
    vault::create_registry<USDC>(ctx);
    steward_registry::create(admin, ctx);
    treasury::create_registry<USDC>(ctx);
    drips::create_drips_registry<USDC>(ctx);
    vault_driver::create_registry(ctx);
}

public fun wire_streaming(
    protocol: &mut Protocol,
    vault_registry: &mut VaultRegistry<USDC>,
    treasury: &TreasuryRegistry<USDC>,
    market_registry: &MarketRegistry,
    drips: &DripsRegistry<USDC>,
    streams: &StreamsRegistry<USDC>,
    driver_registry: &mut DriverRegistry,
    vault_driver: &mut VaultDriverRegistry,
    market_driver: &mut MarketDriverRegistry,
    steward: &StewardRegistry,
    ctx: &TxContext,
) {
    vault::set_treasury_id(vault_registry, option::some(object::id(treasury)));

    vault_driver::bootstrap_streaming(vault_driver, driver_registry);
    let market_driver_id = driver_registry::register_driver(driver_registry);
    market_driver::set_driver_id(market_driver, market_driver_id);

    protocol::set_market_registry(protocol, object::id(market_registry), ctx);
    protocol::set_vault(protocol, object::id(vault_registry), ctx);
    protocol::set_drips(protocol, object::id(drips), ctx);
    protocol::set_streams(protocol, object::id(streams), ctx);
    protocol::set_market_driver(protocol, object::id(market_driver), ctx);
    protocol::set_vault_driver(protocol, object::id(vault_driver), ctx);
    protocol::set_steward_registry(protocol, object::id(steward), ctx);
    protocol::set_treasury(protocol, object::id(treasury), ctx);
}

public fun mint_usdc(cap: &mut UsdcMintCap, amount: u64, ctx: &mut TxContext): sui::coin::Coin<USDC> {
    test_usdc::mint(cap, amount, ctx)
}

public fun cycle_secs(): u64 {
    CYCLE_SECS
}
