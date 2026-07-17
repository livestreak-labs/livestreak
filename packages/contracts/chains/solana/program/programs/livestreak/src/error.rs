use anchor_lang::prelude::*;

// Mirrors the Move abort codes in meaning; Anchor gives each a distinct error code.
#[error_code]
pub enum LivestreakError {
    #[msg("title must be non-empty")]
    EmptyTitle,
    #[msg("stream id must be non-empty")]
    ZeroStreamId,
    #[msg("input exceeds maximum length")]
    InputTooLong,
    #[msg("caller is not the market creator")]
    NotCreator,
    #[msg("stream already ended")]
    StreamEnded,
    #[msg("stream was never live")]
    NotLive,
    #[msg("stream pointer is locked (evidence grace elapsed)")]
    StreamLocked,
    #[msg("unknown storage pointer scheme")]
    BadScheme,
}
