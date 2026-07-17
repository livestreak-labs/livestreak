//! LiveStreak on Solana. Ported from the Sui Move sources (chains/sui/sources) —
//! Move already de-EVM'd the design, so parity claims trace to Move first, EVM second.
//!
//! Phase 1: market registry (register/enumerate/stream-lifecycle) + steward config.
//! Hot/dispute/resolve land in Phase 2 with the vault module (they gate on the
//! vault -> market link, which does not exist until vaults do).

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("CZnAfgbnbVtuXDRQynwL9XMHqeQ7wngbodRihGLbErK8");

#[program]
pub mod livestreak {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, default_steward: Pubkey) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, default_steward)
    }

    pub fn register_market(
        ctx: Context<RegisterMarket>,
        title: Vec<u8>,
        stream_id: Vec<u8>,
    ) -> Result<()> {
        instructions::register_market::handle_register_market(ctx, title, stream_id)
    }

    pub fn go_live(ctx: Context<StreamLifecycle>, scheme: u8, pointer: Vec<u8>) -> Result<()> {
        instructions::stream_lifecycle::handle_go_live(ctx, scheme, pointer)
    }

    pub fn set_ended(ctx: Context<StreamLifecycle>, scheme: u8, pointer: Vec<u8>) -> Result<()> {
        instructions::stream_lifecycle::handle_set_ended(ctx, scheme, pointer)
    }

    pub fn set_market_steward(ctx: Context<SetMarketSteward>, steward: Pubkey) -> Result<()> {
        instructions::steward::handle_set_market_steward(ctx, steward)
    }
}
