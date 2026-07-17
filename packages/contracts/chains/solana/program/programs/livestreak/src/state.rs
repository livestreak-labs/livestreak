use anchor_lang::prelude::*;

use crate::constants::{MAX_POINTER_LEN, MAX_STREAM_ID_LEN, MAX_TITLE_LEN};

/// Singleton protocol registry: market counter + steward default.
#[account]
#[derive(InitSpace)]
pub struct Registry {
    pub market_count: u64,
    pub default_steward: Pubkey,
    pub bump: u8,
}

/// One market. PDA: ["market", market_id]. market_id = keccak256(creator ++ stream_id),
/// the same id scheme as Move compute_market_id — 32 opaque bytes on every chain.
#[account]
#[derive(InitSpace)]
pub struct Market {
    pub market_id: [u8; 32],
    pub creator: Pubkey,
    #[max_len(MAX_TITLE_LEN)]
    pub title: Vec<u8>,
    #[max_len(MAX_STREAM_ID_LEN)]
    pub stream_id: Vec<u8>,
    pub created_at: i64,
    // Stream lifecycle (embedded — one account read serves catalog + player).
    pub stream_status: u8,
    pub stream_scheme: u8,
    #[max_len(MAX_POINTER_LEN)]
    pub stream_pointer: Vec<u8>,
    pub stream_updated_at: i64,
    pub stream_ended_at: i64,
    pub bump: u8,
}

/// Enumeration ledger: PDA ["market_idx", index_le] -> market_id.
/// The append-only equivalent of EVM marketIdAt / Move market_ids.
#[account]
#[derive(InitSpace)]
pub struct MarketIndex {
    pub market_id: [u8; 32],
    pub bump: u8,
}

/// Per-market steward override. PDA ["steward", market_id].
/// effective steward = this account if it exists, else registry.default_steward.
#[account]
#[derive(InitSpace)]
pub struct MarketSteward {
    pub steward: Pubkey,
    pub bump: u8,
}
