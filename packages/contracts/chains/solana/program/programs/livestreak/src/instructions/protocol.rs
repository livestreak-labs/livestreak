//! Engine-wrapping instructions: the per-market Protocol blob + USDC escrow.
//! Money movement is real SPL transfers; the engine is the single source of truth
//! for every amount (instructions only move what the engine returns).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use ruint::aliases::U256;
use livestreak_engine::{Protocol, STATUS_RESOLVED, SIDE_NO, SIDE_YES};

use crate::constants::{LVST_AUTHORITY_SEED, MARKET_SEED, MARKET_STEWARD_SEED, REGISTRY_SEED};
use crate::error::LivestreakError;
use crate::state::{Market, MarketSteward, PositionOwner, ProtocolState, Registry};

pub const PROTOCOL_SEED: &[u8] = b"protocol";
pub const ESCROW_SEED: &[u8] = b"escrow";
pub const POSITION_SEED: &[u8] = b"position";

/// Blob headroom: 8 discr + 32 market_id + 1 bump + 4 vec len + payload.
pub const PROTOCOL_HEADER: usize = 8 + 32 + 1 + 4;

pub fn log_cu(tag: &str) {
    msg!("cu-mark: {}", tag);
    #[cfg(target_os = "solana")]
    unsafe {
        solana_define_syscall::definitions::sol_log_compute_units_()
    };
}

fn now_secs() -> Result<u64> {
    Ok(Clock::get()?.unix_timestamp as u64)
}

fn valid_side(side: u8) -> Result<()> {
    require!(side == SIDE_YES || side == SIDE_NO, LivestreakError::BadScheme);
    Ok(())
}

/// Winnings freeze from board truth at `resolved_at`, but the CASH only lands in the
/// vault ledger when the next drips cycle boundary completes. A withdraw before that
/// boundary would otherwise fail deep in the pay path with the confusing
/// VaultInsufficientUsdc — gate it up front with a legible error and log the concrete
/// `ready_at` so clients can wait for it. Unresolved vaults are untouched (the engine
/// keeps its NotResolved / zero-payout behavior).
fn require_settled(p: &Protocol, vault_id: &[u8; 32], now: u64) -> Result<()> {
    if let Ok(v) = p.vault.get_vault(vault_id) {
        if v.status == STATUS_RESOLVED {
            let cycle = p.streams.cycle_secs;
            // ceil(resolved_at / cycle) * cycle — on-boundary resolves pay immediately.
            let ready_at = if cycle == 0 {
                v.resolved_at
            } else {
                v.resolved_at.div_ceil(cycle).saturating_mul(cycle)
            };
            if now < ready_at {
                msg!("settlement pending: ready_at={}", ready_at);
                return Err(error!(LivestreakError::SettlementPending));
            }
        }
    }
    Ok(())
}

pub fn load(state: &ProtocolState) -> Result<Protocol> {
    Protocol::from_bytes(&state.data).ok_or_else(|| error!(LivestreakError::EngineState))
}

pub fn store(state: &mut ProtocolState, protocol: &Protocol, account_len: usize) -> Result<()> {
    let bytes = protocol.to_bytes();
    require!(
        PROTOCOL_HEADER + bytes.len() <= account_len,
        LivestreakError::StateFull
    );
    state.data = bytes;
    Ok(())
}

/// token_id bytes <-> engine U256 (big-endian, opaque).
pub fn token_id_bytes(id: U256) -> [u8; 32] {
    id.to_be_bytes()
}

fn token_id_from(bytes: &[u8; 32]) -> U256 {
    U256::from_be_bytes(*bytes)
}

fn u64_amount(amount: u128) -> Result<u64> {
    u64::try_from(amount).map_err(|_| error!(LivestreakError::StateFull))
}

// ── init_protocol ───────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(capacity: u16)]
pub struct InitProtocol<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [MARKET_SEED, &market.market_id], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = payer,
        space = PROTOCOL_HEADER + capacity as usize,
        seeds = [PROTOCOL_SEED, &market.market_id],
        bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        seeds = [ESCROW_SEED, &market.market_id],
        bump,
        token::mint = usdc_mint,
        token::authority = protocol_state
    )]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_protocol(ctx: Context<InitProtocol>, _capacity: u16) -> Result<()> {
    let state = &mut ctx.accounts.protocol_state;
    state.market_id = ctx.accounts.market.market_id;
    state.bump = ctx.bumps.protocol_state;
    state.data = Protocol::default().to_bytes();
    Ok(())
}

// ── shared account shells ───────────────────────────────────────────────────────

/// User-pays flows (create/fund): USDC moves user -> escrow before the engine op.
#[derive(Accounts)]
pub struct UserEngineOp<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [PROTOCOL_SEED, &protocol_state.market_id],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,
    #[account(mut, seeds = [ESCROW_SEED, &protocol_state.market_id], bump)]
    pub escrow: Account<'info, TokenAccount>,
    #[account(mut, constraint = user_usdc.owner == user.key() @ LivestreakError::NotCreator)]
    pub user_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

impl<'info> UserEngineOp<'info> {
    fn pull(&self, amount: u128) -> Result<()> {
        let amt = u64_amount(amount)?;
        if amt == 0 {
            return Ok(());
        }
        token::transfer(
            CpiContext::new(
                self.token_program.key(),
                Transfer {
                    from: self.user_usdc.to_account_info(),
                    to: self.escrow.to_account_info(),
                    authority: self.user.to_account_info(),
                },
            ),
            amt,
        )
    }

    fn pay(&self, amount: u128) -> Result<()> {
        let amt = u64_amount(amount)?;
        if amt == 0 {
            return Ok(());
        }
        let market_id = self.protocol_state.market_id;
        let bump = self.protocol_state.bump;
        let seeds: &[&[u8]] = &[PROTOCOL_SEED, &market_id, &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                self.token_program.key(),
                Transfer {
                    from: self.escrow.to_account_info(),
                    to: self.user_usdc.to_account_info(),
                    authority: self.protocol_state.to_account_info(),
                },
                &[seeds],
            ),
            amt,
        )
    }
}

// ── create_vault_seeded ─────────────────────────────────────────────────────────

pub fn handle_create_vault_seeded(
    ctx: Context<UserEngineOp>,
    question: Vec<u8>,
    seed_side: u8,
    rate: u64,
    deposit: u64,
) -> Result<Vec<u8>> {
    valid_side(seed_side)?;
    let mut p = load(&ctx.accounts.protocol_state)?;
    ctx.accounts.pull(deposit as u128)?;
    let vault_id = p
        .create_vault_seeded(
            ctx.accounts.protocol_state.market_id,
            question,
            ctx.accounts.user.key().to_bytes(),
            seed_side,
            U256::from(rate),
            deposit as u128,
            now_secs()?,
        )
        .map_err(engine_err)?;
    let len = ctx.accounts.protocol_state.to_account_info().data_len();
    store(&mut ctx.accounts.protocol_state, &p, len)?;
    assert_conserved(&mut ctx.accounts.escrow, &p)?;
    Ok(vault_id.to_vec())
}

// ── mint_position ───────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(salt: u64)]
pub struct MintPosition<'info> {
    #[account(mut)]
    pub minter: Signer<'info>,
    #[account(
        mut,
        seeds = [PROTOCOL_SEED, &protocol_state.market_id],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,
    /// CHECK: seeds prove it is this market's account; existence proves registration.
    #[account(seeds = [MARKET_SEED, &protocol_state.market_id], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = minter,
        space = 8 + PositionOwner::INIT_SPACE,
        seeds = [POSITION_SEED, &position_token_id(&protocol_state, &minter.key(), salt)],
        bump
    )]
    pub position: Account<'info, PositionOwner>,
    pub system_program: Program<'info, System>,
}

pub fn position_token_id(_state: &ProtocolState, minter: &Pubkey, salt: u64) -> [u8; 32] {
    // Mirrors Protocol::calc_token_id_with_salt (keccak of minter ++ salt).
    token_id_bytes(Protocol::default().calc_token_id_with_salt(&minter.to_bytes(), salt))
}

pub fn handle_mint_position(ctx: Context<MintPosition>, salt: u64) -> Result<()> {
    let mut p = load(&ctx.accounts.protocol_state)?;
    let token_id = p
        .mint_with_salt(
            ctx.accounts.protocol_state.market_id,
            true, // market account existence is proven by the seeds constraint
            ctx.accounts.minter.key().to_bytes(),
            salt,
        )
        .map_err(engine_err)?;
    let len = ctx.accounts.protocol_state.to_account_info().data_len();
    store(&mut ctx.accounts.protocol_state, &p, len)?;

    let position = &mut ctx.accounts.position;
    position.token_id = token_id_bytes(token_id);
    position.owner = ctx.accounts.minter.key();
    position.bump = ctx.bumps.position;
    Ok(())
}

// ── position-gated ops (fund/stop_all/withdraw) ─────────────────────────────────

#[derive(Accounts)]
pub struct PositionEngineOp<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [PROTOCOL_SEED, &protocol_state.market_id],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,
    #[account(
        seeds = [POSITION_SEED, &position.token_id],
        bump = position.bump,
        constraint = position.owner == user.key() @ LivestreakError::NotCreator
    )]
    pub position: Account<'info, PositionOwner>,
    #[account(mut, seeds = [ESCROW_SEED, &protocol_state.market_id], bump)]
    pub escrow: Account<'info, TokenAccount>,
    #[account(mut, constraint = user_usdc.owner == user.key() @ LivestreakError::NotCreator)]
    pub user_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

impl<'info> PositionEngineOp<'info> {
    fn as_user_op(&self) -> UserOpRefs<'_, 'info> {
        UserOpRefs {
            protocol_state: &self.protocol_state,
            escrow: &self.escrow,
            user_usdc: &self.user_usdc,
            user: &self.user,
            token_program: &self.token_program,
        }
    }
}

struct UserOpRefs<'a, 'info> {
    protocol_state: &'a Account<'info, ProtocolState>,
    escrow: &'a Account<'info, TokenAccount>,
    user_usdc: &'a Account<'info, TokenAccount>,
    user: &'a Signer<'info>,
    token_program: &'a Program<'info, Token>,
}

impl UserOpRefs<'_, '_> {
    fn pull(&self, amount: u128) -> Result<()> {
        let amt = u64_amount(amount)?;
        if amt == 0 {
            return Ok(());
        }
        token::transfer(
            CpiContext::new(
                self.token_program.key(),
                Transfer {
                    from: self.user_usdc.to_account_info(),
                    to: self.escrow.to_account_info(),
                    authority: self.user.to_account_info(),
                },
            ),
            amt,
        )
    }

    fn pay(&self, amount: u128) -> Result<()> {
        let amt = u64_amount(amount)?;
        if amt == 0 {
            return Ok(());
        }
        let market_id = self.protocol_state.market_id;
        let bump = self.protocol_state.bump;
        let seeds: &[&[u8]] = &[PROTOCOL_SEED, &market_id, &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                self.token_program.key(),
                Transfer {
                    from: self.escrow.to_account_info(),
                    to: self.user_usdc.to_account_info(),
                    authority: self.protocol_state.to_account_info(),
                },
                &[seeds],
            ),
            amt,
        )
    }
}

pub fn handle_fund(
    ctx: Context<PositionEngineOp>,
    vault_id: [u8; 32],
    side: u8,
    rate: u64,
    deposit: u64,
) -> Result<()> {
    valid_side(side)?;
    let mut p = load(&ctx.accounts.protocol_state)?;
    ctx.accounts.as_user_op().pull(deposit as u128)?;
    p.fund(
        token_id_from(&ctx.accounts.position.token_id),
        &vault_id,
        side,
        U256::from(rate),
        deposit as u128,
        now_secs()?,
    )
    .map_err(engine_err)?;
    let len = ctx.accounts.protocol_state.to_account_info().data_len();
    store(&mut ctx.accounts.protocol_state, &p, len)?;
    assert_conserved(&mut ctx.accounts.escrow, &p)?;
    Ok(())
}

pub fn handle_stop_all(ctx: Context<PositionEngineOp>) -> Result<()> {
    let mut p = load(&ctx.accounts.protocol_state)?;
    let refunded = p
        .stop_all(token_id_from(&ctx.accounts.position.token_id), now_secs()?)
        .map_err(engine_err)?;
    ctx.accounts.as_user_op().pay(refunded)?;
    let len = ctx.accounts.protocol_state.to_account_info().data_len();
    store(&mut ctx.accounts.protocol_state, &p, len)?;
    assert_conserved(&mut ctx.accounts.escrow, &p)?;
    Ok(())
}

pub fn handle_withdraw(ctx: Context<PositionEngineOp>, vault_id: [u8; 32]) -> Result<()> {
    let mut p = load(&ctx.accounts.protocol_state)?;
    let now = now_secs()?;
    require_settled(&p, &vault_id, now)?;
    let paid = p
        .withdraw(token_id_from(&ctx.accounts.position.token_id), &vault_id, now)
        .map_err(engine_err)?;
    ctx.accounts.as_user_op().pay(paid)?;
    let len = ctx.accounts.protocol_state.to_account_info().data_len();
    store(&mut ctx.accounts.protocol_state, &p, len)?;
    assert_conserved(&mut ctx.accounts.escrow, &p)?;
    Ok(())
}

// ── claim_loss_lvst ─────────────────────────────────────────────────────────────

/// A losing position mints LVST against its loss basis. The basis is READ FROM THE
/// VAULT by the engine (trust boundary, EVM/Move parity) — never caller-supplied — and
/// the double-claim guard lives in the treasury ledger (`loss_claimed`). This touches
/// the LVST mint only; the USDC escrow ledgers are untouched, so — like `resolve` — it
/// carries no escrow account and no conservation assert.
#[derive(Accounts)]
pub struct ClaimLossLvst<'info> {
    pub claimer: Signer<'info>,
    #[account(
        mut,
        seeds = [PROTOCOL_SEED, &protocol_state.market_id],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,
    /// Ownership gate: the claimer must own the position whose token_id fixes the loss.
    #[account(
        seeds = [POSITION_SEED, &position.token_id],
        bump = position.bump,
        constraint = position.owner == claimer.key() @ LivestreakError::NotCreator
    )]
    pub position: Account<'info, PositionOwner>,
    /// CHECK: protocol-wide LVST mint authority PDA — seeds prove it; signs the mint_to CPI.
    #[account(seeds = [LVST_AUTHORITY_SEED], bump)]
    pub lvst_authority: UncheckedAccount<'info>,
    /// The canonical LVST mint (its authority must be the lvst_authority PDA).
    #[account(mut, mint::authority = lvst_authority)]
    pub lvst_mint: Account<'info, Mint>,
    /// The claimer's LVST token account. Require-exists (mirrors how the program treats
    /// user USDC ATAs): the client prepends a createAtaIdempotent for the LVST mint.
    #[account(mut, token::mint = lvst_mint, token::authority = claimer)]
    pub claimer_lvst: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_claim_loss_lvst(
    ctx: Context<ClaimLossLvst>,
    vault_id: [u8; 32],
    side: u8,
) -> Result<()> {
    valid_side(side)?;
    let mut p = load(&ctx.accounts.protocol_state)?;
    let token_id = token_id_from(&ctx.accounts.position.token_id);
    // Call the treasury directly (not the driver wrapper, which flattens NothingLost /
    // AlreadyClaimed to NoLane) so each failure decodes to its own typed error. A loser
    // with any non-zero basis always yields amount > 0 (mint_rate >= MINT_FLOOR).
    let minted = p
        .treasury
        .mint_loss_lvst(&p.vault, token_id, &vault_id, side)
        .map_err(engine_err)?;
    let amount = u64_amount(livestreak_math::wide::narrow(minted, "lvst_mint"))?;

    let bump = ctx.bumps.lvst_authority;
    let seeds: &[&[u8]] = &[LVST_AUTHORITY_SEED, &[bump]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::MintTo {
                mint: ctx.accounts.lvst_mint.to_account_info(),
                to: ctx.accounts.claimer_lvst.to_account_info(),
                authority: ctx.accounts.lvst_authority.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;

    let len = ctx.accounts.protocol_state.to_account_info().data_len();
    store(&mut ctx.accounts.protocol_state, &p, len)?;
    Ok(())
}

// ── seed creator ops ────────────────────────────────────────────────────────────

pub fn handle_stop_seed(ctx: Context<UserEngineOp>, vault_id: [u8; 32]) -> Result<()> {
    let mut p = load(&ctx.accounts.protocol_state)?;
    let refunded = p
        .stop_seed(&vault_id, ctx.accounts.user.key().to_bytes(), now_secs()?)
        .map_err(engine_err)?;
    ctx.accounts.pay(refunded)?;
    let len = ctx.accounts.protocol_state.to_account_info().data_len();
    store(&mut ctx.accounts.protocol_state, &p, len)?;
    assert_conserved(&mut ctx.accounts.escrow, &p)?;
    Ok(())
}

pub fn handle_withdraw_seed(ctx: Context<UserEngineOp>, vault_id: [u8; 32]) -> Result<()> {
    let mut p = load(&ctx.accounts.protocol_state)?;
    let now = now_secs()?;
    require_settled(&p, &vault_id, now)?;
    let paid = p
        .withdraw_seed(&vault_id, ctx.accounts.user.key().to_bytes(), now)
        .map_err(engine_err)?;
    ctx.accounts.pay(paid)?;
    let len = ctx.accounts.protocol_state.to_account_info().data_len();
    store(&mut ctx.accounts.protocol_state, &p, len)?;
    assert_conserved(&mut ctx.accounts.escrow, &p)?;
    Ok(())
}

// ── permissionless + steward ops ────────────────────────────────────────────────

#[derive(Accounts)]
pub struct EngineOp<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_SEED, &protocol_state.market_id],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,
    /// Read-only: present so the conservation guard can verify the invariant.
    #[account(seeds = [ESCROW_SEED, &protocol_state.market_id], bump)]
    pub escrow: Account<'info, TokenAccount>,
}

pub fn handle_advance(
    ctx: Context<EngineOp>,
    vault_id: [u8; 32],
    side: u8,
    max_steps: u64,
) -> Result<()> {
    valid_side(side)?;
    let mut p = load(&ctx.accounts.protocol_state)?;
    p.vault.advance(&vault_id, side, max_steps, now_secs()?).map_err(engine_err)?;
    let len = ctx.accounts.protocol_state.to_account_info().data_len();
    store(&mut ctx.accounts.protocol_state, &p, len)?;
    assert_conserved(&mut ctx.accounts.escrow, &p)?;
    Ok(())
}

pub fn handle_collect(ctx: Context<EngineOp>, vault_id: [u8; 32]) -> Result<()> {
    let mut p = load(&ctx.accounts.protocol_state)?;
    // Skim stays inside the shared escrow; the treasury ledger partitions it.
    p.collect_vault(&vault_id, now_secs()?).map_err(engine_err)?;
    let len = ctx.accounts.protocol_state.to_account_info().data_len();
    store(&mut ctx.accounts.protocol_state, &p, len)?;
    assert_conserved(&mut ctx.accounts.escrow, &p)?;
    Ok(())
}

#[derive(Accounts)]
pub struct Resolve<'info> {
    pub steward: Signer<'info>,
    #[account(
        mut,
        seeds = [PROTOCOL_SEED, &protocol_state.market_id],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,
    #[account(seeds = [REGISTRY_SEED], bump = registry.bump)]
    pub registry: Account<'info, Registry>,
    /// Per-market override; pass the registry's default when none exists.
    #[account(
        seeds = [MARKET_STEWARD_SEED, &protocol_state.market_id],
        bump = market_steward.bump
    )]
    pub market_steward: Option<Account<'info, MarketSteward>>,
}

pub fn handle_resolve(ctx: Context<Resolve>, vault_id: [u8; 32], winning_side: u8) -> Result<()> {
    valid_side(winning_side)?;
    let effective = ctx
        .accounts
        .market_steward
        .as_ref()
        .map(|m| m.steward)
        .unwrap_or(ctx.accounts.registry.default_steward);
    require!(ctx.accounts.steward.key() == effective, LivestreakError::NotSteward);

    let mut p = load(&ctx.accounts.protocol_state)?;
    p.vault.resolve(&vault_id, winning_side, now_secs()?).map_err(engine_err)?;
    let len = ctx.accounts.protocol_state.to_account_info().data_len();
    store(&mut ctx.accounts.protocol_state, &p, len)?;
    Ok(())
}

fn engine_err<E: core::fmt::Debug + Into<LivestreakError>>(e: E) -> anchor_lang::error::Error {
    msg!("engine: {:?}", e);
    anchor_lang::error::Error::from(e.into())
}

/// The conservation invariant, live: the escrow token account must exactly equal
/// the sum of the three engine ledgers after every money-moving instruction.
/// A logic/codec/width bug aborts the transaction instead of corrupting a market.
fn assert_conserved(escrow: &mut Account<TokenAccount>, p: &Protocol) -> Result<()> {
    escrow.reload()?;
    require!(
        escrow.amount as u128 == p.drips.held + p.vault.usdc_held + p.treasury.usdc_held,
        LivestreakError::ConservationViolated
    );
    Ok(())
}
