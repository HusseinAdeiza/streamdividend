use anchor_lang::prelude::*;
use solana_program::program::invoke_signed;

mod token_ix;
use token_ix::*;

declare_id!("LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA");

// ============================================================================
// StreamDividend — dividend streaming vault on Solana
//
// Users deposit xStock (tokenized stock, e.g. AAPLx — a Token-2022 mint) into
// a vault token account and receive pro-rata shares. When the dividend
// authority triggers a dividend (funded with real USDC — a Token-v3 mint),
// holders accrue their pro-rata portion instantly and can claim it in USDC at
// any time. Accrual is continuous and claim is idempotent (Synthetix-style
// per-share dividend accumulator): no time-leak, no dust loss, withdrawals
// always pay earned dividends first.
//
// Dual token standard: the xStock side is Token-v3 OR Token-2022 (dispatched
// by the mint's owner program); the dividend side is Token-v3 (USDC).
//
// Units: xStock (AAPLx) is 8-decimal; USDC is 6-decimal. `dividends_per_share`
// is a u128 accumulator scaled by 1e12 (USDC-base per share-base).
// ============================================================================

/// Per-user position inside the vault.
#[account]
pub struct UserState {
    pub user: Pubkey,           // 32
    pub vault: Pubkey,          // 32
    pub shares: u64,            // 8  — pro-rata share of the vault (xStock-base units)
    pub last_dividends_per_share: u128, // 16 — accumulator snapshot at last interaction
    pub route: RoutePreference, // 1  — where earned yield goes (stream vs auto-compound)
    pub bump: u8,               // 1
}

impl UserState {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 16 + 1 + 1;
}

/// The vault (single PDA per authority).
#[account]
pub struct Vault {
    pub authority: Pubkey,      // 32 — admin who can trigger dividends
    pub xstock_mint: Pubkey,    // 32 — tokenized stock mint (e.g. AAPLx)
    pub dividend_mint: Pubkey,  // 32 — USDC mint for dividends
    pub total_shares: u64,      // 8  — shares outstanding (pro-rata denominator)
    pub total_xstock: u64,      // 8  — xStock deposited (cached)
    pub dividend_pool: u64,     // 8  — unclaimed USDC held in the vault (6 dec)
    pub total_dividends_distributed: u64, // 8 — lifetime USDC distributed
    pub dividends_per_share: u128,       // 16 — accumulator, USDC-base * 1e12 per share-base
    pub last_dividend_ts: i64,   // 8  — timestamp of last dividend trigger
    pub route: RoutePreference,  // 1  — default routing for new depositors
    pub bump: u8,                // 1
}

impl Vault {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 16 + 8 + 1 + 1;
}

/// Where earned yield goes (auto-compound is a recorded preference for now).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum RoutePreference {
    Stream,       // 0 — USDC streams out to the user's wallet
    AutoCompound, // 1 — (preference) reinvest into xStock
}

impl Default for RoutePreference {
    fn default() -> Self {
        RoutePreference::Stream
    }
}

pub const PRECISION: u128 = 1_000_000_000_000u128; // 1e12

// ============================================================================
// Helpers
// ============================================================================

/// The token program that owns `mint` (dispatch v3 vs 2022 by owner).
fn mint_token_program(mint: &AccountInfo) -> Result<&'static Pubkey> {
    if mint.owner == &TOKEN_2022_PROGRAM_ID {
        Ok(&TOKEN_2022_PROGRAM_ID)
    } else {
        Ok(&TOKEN_PROGRAM_ID)
    }
}

/// Decimals field of a mint (data byte 44: 4 + 32 mint_authority + 8 supply).
fn mint_decimals(mint: &AccountInfo) -> Result<u8> {
    let d = mint.try_borrow_data()?;
    if d.len() < 45 {
        return Err(ErrorCode::InvalidTokenAccount.into());
    }
    Ok(d[44])
}

/// Mint field of a token account (bytes 0..32 of account data).
fn token_account_mint(acc: &AccountInfo) -> Result<Pubkey> {
    let d = acc.try_borrow_data()?;
    if d.len() < 64 {
        return Err(ErrorCode::InvalidTokenAccount.into());
    }
    Ok(Pubkey::new_from_array(d[0..32].try_into().unwrap()))
}

#[program]
pub mod streamdividend {
    use super::*;

    // ---- Vault lifecycle ----

    /// Step 1: create the vault PDA.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.xstock_mint = ctx.accounts.xstock_mint.key();
        vault.dividend_mint = ctx.accounts.dividend_mint.key();
        vault.total_shares = 0;
        vault.total_xstock = 0;
        vault.dividend_pool = 0;
        vault.total_dividends_distributed = 0;
        vault.dividends_per_share = 0;
        vault.last_dividend_ts = Clock::get()?.unix_timestamp;
        vault.route = RoutePreference::Stream;
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    // ---- Deposit xStock, receive pro-rata shares ----

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::ZeroAmount);
        let vault = &mut ctx.accounts.vault;
        let user_state = &mut ctx.accounts.user_state;
        let token_program = mint_token_program(&ctx.accounts.xstock_mint)?;

        // Defensive: both accounts must be for the vault's xStock mint and
        // owned by that mint's token program (prevents cross-mint deposits).
        require!(*ctx.accounts.vault_xstock.owner == *token_program, ErrorCode::InvalidTokenAccount);
        require!(token_account_mint(&ctx.accounts.vault_xstock)? == vault.xstock_mint, ErrorCode::InvalidTokenAccount);
        require!(token_account_mint(&ctx.accounts.user_xstock)? == vault.xstock_mint, ErrorCode::InvalidTokenAccount);

        // First deposit: snapshot the accumulator so the new depositor does
        // NOT claim dividends that were distributed before they joined.
        if user_state.shares == 0 {
            user_state.last_dividends_per_share = vault.dividends_per_share;
            user_state.route = vault.route;
        }

        // Transfer xStock from the user's account to the vault account.
        // TransferChecked: required for Token-2022 mints with extensions
        // (e.g. real AAPLx); also valid on Token-v3.
        let decimals = mint_decimals(&ctx.accounts.xstock_mint)?;
        let ix = transfer_checked(
            token_program,
            &ctx.accounts.user_xstock.key(),
            &ctx.accounts.vault_xstock.key(),
            &ctx.accounts.xstock_mint.key(),
            &ctx.accounts.user.key(),
            amount,
            decimals,
        );
        invoke_signed(
            &ix,
            &[
                ctx.accounts.user_xstock.to_account_info(),
                ctx.accounts.vault_xstock.to_account_info(),
                ctx.accounts.xstock_mint.to_account_info(),
                ctx.accounts.user.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
            &[],
        )?;

        // Pro-rata shares: first deposit is 1:1, later deposits follow the
        // existing shares-per-xstock ratio (keeps share value stable as the
        // vault grows).
        let shares = if vault.total_shares == 0 || vault.total_xstock == 0 {
            amount
        } else {
            (amount as u128)
                .checked_mul(vault.total_shares as u128)
                .ok_or(ErrorCode::Overflow)?
                .checked_div(vault.total_xstock as u128)
                .ok_or(ErrorCode::Overflow)? as u64
        };
        require!(shares > 0, ErrorCode::ZeroShares);

        vault.total_shares = vault.total_shares.checked_add(shares).ok_or(ErrorCode::Overflow)?;
        vault.total_xstock = vault.total_xstock.checked_add(amount).ok_or(ErrorCode::Overflow)?;
        user_state.shares = user_state.shares.checked_add(shares).ok_or(ErrorCode::Overflow)?;

        emit!(DepositEvent {
            user: ctx.accounts.user.key(),
            amount,
            shares,
        });
        Ok(())
    }

    // ---- Withdraw xStock (pays out earned dividends first) ----

    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        require!(shares > 0, ErrorCode::ZeroAmount);
        let vault_key = ctx.accounts.vault.key();
        let vault_info = ctx.accounts.vault.to_account_info();
        let vault = &mut ctx.accounts.vault;
        let user_state = &mut ctx.accounts.user_state;
        require!(user_state.shares >= shares, ErrorCode::InsufficientShares);
        let token_program = mint_token_program(&ctx.accounts.xstock_mint)?;
        require!(
            ctx.accounts.dividend_mint.key() == vault.dividend_mint,
            ErrorCode::InvalidTokenAccount
        );

        let bump = vault.bump;
        let auth_bytes = vault.authority.to_bytes();
        let seeds: &[&[u8]] = &[b"vault", auth_bytes.as_ref(), &[bump]];

        // 1) Pay out any accrued dividends before burning shares (USDC = v3).
        let earned = earned_amount(user_state, vault)?;
        if earned > 0 {
            let ix = transfer_checked(
                &TOKEN_PROGRAM_ID,
                &ctx.accounts.vault_dividend.key(),
                &ctx.accounts.user_dividend.key(),
                &ctx.accounts.dividend_mint.key(),
                &vault_key,
                earned,
                mint_decimals(&ctx.accounts.dividend_mint)?,
            );
            invoke_signed(
                &ix,
                &[
                    ctx.accounts.vault_dividend.to_account_info(),
                    ctx.accounts.user_dividend.to_account_info(),
                    ctx.accounts.dividend_mint.to_account_info(),
                    vault_info.clone(),
                    ctx.accounts.usdc_token_program.to_account_info(),
                ],
                &[seeds],
            )?;
            vault.dividend_pool = vault.dividend_pool.checked_sub(earned).ok_or(ErrorCode::Overflow)?;
        }
        user_state.last_dividends_per_share = vault.dividends_per_share;

        // 2) xstock_out = shares * total_xstock / total_shares
        let xstock_out = (shares as u128)
            .checked_mul(vault.total_xstock as u128)
            .ok_or(ErrorCode::Overflow)?
            .checked_div(vault.total_shares as u128)
            .ok_or(ErrorCode::Overflow)? as u64;
        require!(xstock_out > 0, ErrorCode::ZeroAmount);

        vault.total_shares = vault.total_shares.checked_sub(shares).ok_or(ErrorCode::Overflow)?;
        vault.total_xstock = vault.total_xstock.checked_sub(xstock_out).ok_or(ErrorCode::Overflow)?;
        user_state.shares = user_state.shares.checked_sub(shares).ok_or(ErrorCode::Overflow)?;

        // 3) Return xStock to the user (v3 or 2022 dispatch).
        let ix = transfer_checked(
            token_program,
            &ctx.accounts.vault_xstock.key(),
            &ctx.accounts.user_xstock.key(),
            &ctx.accounts.xstock_mint.key(),
            &vault_key,
            xstock_out,
            mint_decimals(&ctx.accounts.xstock_mint)?,
        );
        invoke_signed(
            &ix,
            &[
                ctx.accounts.vault_xstock.to_account_info(),
                ctx.accounts.user_xstock.to_account_info(),
                ctx.accounts.xstock_mint.to_account_info(),
                vault_info.clone(),
                ctx.accounts.token_program.to_account_info(),
            ],
            &[seeds],
        )?;

        emit!(WithdrawEvent {
            user: ctx.accounts.user.key(),
            shares,
            xstock_out,
            dividend_paid: earned,
        });
        Ok(())
    }

    // ---- Dividend engine ----

    /// Admin triggers a dividend: `amount` USDC is transferred into the vault
    /// pool and immediately accrues to all holders pro-rata (per-share
    /// accumulator). Holders claim at any time; claim is idempotent.
    pub fn trigger_dividend(ctx: Context<TriggerDividend>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::ZeroAmount);
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.authority, ErrorCode::Unauthorized);
        require!(vault.total_shares > 0, ErrorCode::NoShares);
        require!(
            ctx.accounts.dividend_mint.key() == vault.dividend_mint,
            ErrorCode::InvalidTokenAccount
        );

        let ix = transfer_checked(
            &TOKEN_PROGRAM_ID,
            &ctx.accounts.admin_dividend.key(),
            &ctx.accounts.vault_dividend.key(),
            &ctx.accounts.dividend_mint.key(),
            &ctx.accounts.authority.key(),
            amount,
            mint_decimals(&ctx.accounts.dividend_mint)?,
        );
        invoke_signed(
            &ix,
            &[
                ctx.accounts.admin_dividend.to_account_info(),
                ctx.accounts.vault_dividend.to_account_info(),
                ctx.accounts.dividend_mint.to_account_info(),
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
            &[],
        )?;

        // Accumulator: amount * 1e12 / total_shares (USDC-base per share-base).
        let per_share = (amount as u128)
            .checked_mul(PRECISION)
            .ok_or(ErrorCode::Overflow)?
            .checked_div(vault.total_shares as u128)
            .ok_or(ErrorCode::Overflow)?;
        vault.dividends_per_share = vault
            .dividends_per_share
            .checked_add(per_share)
            .ok_or(ErrorCode::Overflow)?;
        vault.dividend_pool = vault.dividend_pool.checked_add(amount).ok_or(ErrorCode::Overflow)?;
        vault.total_dividends_distributed = vault
            .total_dividends_distributed
            .checked_add(amount)
            .ok_or(ErrorCode::Overflow)?;
        vault.last_dividend_ts = Clock::get()?.unix_timestamp;

        emit!(DividendTriggered {
            amount,
            per_share,
        });
        Ok(())
    }

    /// User claims accrued dividends in USDC.
    pub fn claim_dividend(ctx: Context<ClaimDividend>) -> Result<()> {
        let amount = earned_amount(&ctx.accounts.user_state, &ctx.accounts.vault)?;
        require!(amount > 0, ErrorCode::NothingToClaim);
        require!(
            ctx.accounts.dividend_mint.key() == ctx.accounts.vault.dividend_mint,
            ErrorCode::InvalidTokenAccount
        );

        let vault_key = ctx.accounts.vault.key();
        let vault_info = ctx.accounts.vault.to_account_info();
        let vault = &mut ctx.accounts.vault;
        let bump = vault.bump;
        let auth_bytes = vault.authority.to_bytes();
        let seeds: &[&[u8]] = &[b"vault", auth_bytes.as_ref(), &[bump]];
        let ix = transfer_checked(
            &TOKEN_PROGRAM_ID,
            &ctx.accounts.vault_dividend.key(),
            &ctx.accounts.user_dividend.key(),
            &ctx.accounts.dividend_mint.key(),
            &vault_key,
            amount,
            mint_decimals(&ctx.accounts.dividend_mint)?,
        );
        invoke_signed(
            &ix,
            &[
                ctx.accounts.vault_dividend.to_account_info(),
                ctx.accounts.user_dividend.to_account_info(),
                ctx.accounts.dividend_mint.to_account_info(),
                vault_info.clone(),
                ctx.accounts.token_program.to_account_info(),
            ],
            &[seeds],
        )?;
        vault.dividend_pool = vault.dividend_pool.checked_sub(amount).ok_or(ErrorCode::Overflow)?;
        ctx.accounts.user_state.last_dividends_per_share = vault.dividends_per_share;

        emit!(DividendClaimed {
            user: ctx.accounts.user.key(),
            amount,
        });
        Ok(())
    }

    // ---- Preference ----

    pub fn set_route(ctx: Context<SetRoute>, route: RoutePreference) -> Result<()> {
        ctx.accounts.user_state.route = route;
        Ok(())
    }
}

fn earned_amount(user_state: &UserState, vault: &Vault) -> Result<u64> {
    // earned = shares * (dps_now - dps_last) / 1e12, in USDC-base (6 dec).
    require!(
        vault.dividends_per_share >= user_state.last_dividends_per_share,
        ErrorCode::Overflow
    );
    let delta = vault.dividends_per_share - user_state.last_dividends_per_share;
    let earned = (user_state.shares as u128)
        .checked_mul(delta)
        .ok_or(ErrorCode::Overflow)?
        .checked_div(PRECISION)
        .ok_or(ErrorCode::Overflow)? as u64;
    Ok(earned)
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub shares: u64,
}

#[event]
pub struct WithdrawEvent {
    pub user: Pubkey,
    pub shares: u64,
    pub xstock_out: u64,
    pub dividend_paid: u64,
}

#[event]
pub struct DividendTriggered {
    pub amount: u64,
    pub per_share: u128,
}

#[event]
pub struct DividendClaimed {
    pub user: Pubkey,
    pub amount: u64,
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum ErrorCode {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Shares computed to zero for this deposit")]
    ZeroShares,
    #[msg("Insufficient shares to withdraw")]
    InsufficientShares,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Overflow")]
    Overflow,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("No shares in vault")]
    NoShares,
    #[msg("Invalid token account")]
    InvalidTokenAccount,
}

// ============================================================================
// Accounts
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Vault::LEN,
        seeds = [b"vault", authority.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    /// Tokenized stock mint (Token-v3 or Token-2022).
    /// CHECK: manually validated in the handler (mint match / owner / authority)
    pub xstock_mint: AccountInfo<'info>,
    /// Dividend mint — USDC (Token-v3).
    /// CHECK: manually validated in the handler (mint match / owner / authority)
    pub dividend_mint: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserState::LEN,
        seeds = [b"user", vault.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_state: Account<'info, UserState>,
    /// User's xStock account (v3 or 2022, must match the vault's xstock mint).
    #[account(mut)]
    /// CHECK: manually validated in the handler (mint match / owner / authority)
    pub user_xstock: AccountInfo<'info>,
    /// Vault's xStock account (owned by the vault PDA).
    #[account(mut)]
    /// CHECK: manually validated in the handler (mint match / owner / authority)
    pub vault_xstock: AccountInfo<'info>,
    /// The xStock mint — must equal the vault's.
    #[account(address = vault.xstock_mint)]
    /// CHECK: manually validated in the handler (mint match / owner / authority)
    pub xstock_mint: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: client passes the xStock mint's token program (v3 or 2022).
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        seeds = [b"user", vault.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_state: Account<'info, UserState>,
    #[account(mut)]
    /// CHECK: manually validated in the handler (mint match / owner / authority)
    pub user_xstock: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: manually validated in the handler (mint match / owner / authority)
    pub vault_xstock: AccountInfo<'info>,
    /// User's USDC account — receives accrued dividend on the way out.
    #[account(mut)]
    /// CHECK: manually validated in the handler (mint match / owner / authority)
    pub user_dividend: AccountInfo<'info>,
    /// Vault's USDC pool account.
    #[account(mut)]
    /// CHECK: manually validated in the handler (mint match / owner / authority)
    pub vault_dividend: AccountInfo<'info>,
    /// CHECK: manually validated in the handler (mint match / owner / authority)
    pub xstock_mint: AccountInfo<'info>,
    /// The USDC dividend mint (Token-v3).
    /// CHECK: manually validated in the handler (must equal vault.dividend_mint).
    pub dividend_mint: AccountInfo<'info>,
    /// CHECK: client passes the xStock mint's token program (v3 or 2022).
    pub token_program: AccountInfo<'info>,
    /// CHECK: the USDC (v3) token program — used for the dividend payout.
    pub usdc_token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct TriggerDividend<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    /// CHECK: manually validated in the handler (mint match / owner / authority)
    pub admin_dividend: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: manually validated in the handler (mint match / owner / authority)
    pub vault_dividend: AccountInfo<'info>,
    /// The USDC dividend mint (Token-v3).
    /// CHECK: manually validated in the handler (must equal vault.dividend_mint).
    pub dividend_mint: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: the USDC (v3) token program.
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct ClaimDividend<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        seeds = [b"user", vault.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_state: Account<'info, UserState>,
    #[account(mut)]
    /// CHECK: manually validated in the handler (mint match / owner / authority)
    pub user_dividend: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: manually validated in the handler (mint match / owner / authority)
    pub vault_dividend: AccountInfo<'info>,
    /// The USDC dividend mint (Token-v3).
    /// CHECK: manually validated in the handler (must equal vault.dividend_mint).
    pub dividend_mint: AccountInfo<'info>,
    /// CHECK: the USDC (v3) token program.
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct SetRoute<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        seeds = [b"user", vault.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_state: Account<'info, UserState>,
}
