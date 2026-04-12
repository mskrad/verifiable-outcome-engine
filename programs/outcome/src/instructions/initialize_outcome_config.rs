use anchor_lang::{prelude::*, system_program};

use crate::{
    errors::OutcomeError,
    events::OutcomeConfigInitializedV1,
    instructions::compiled_artifact_chunks::load_blob_from_remaining,
    math::compiled_outcome_v1,
    state::{
        approved_outcome_artifact::ApprovedOutcomeArtifact, outcome_config::OutcomeConfig,
        program_config::ProgramConfig,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeOutcomeConfigArgs {
    pub runtime_id: [u8; 16],
    pub min_input_lamports: u64,
    pub max_input_lamports: u64,
    pub compiled_artifact_hash: [u8; 32],
    pub master_seed: [u8; 32],
}

#[derive(Accounts)]
#[instruction(args: InitializeOutcomeConfigArgs)]
pub struct InitializeOutcomeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"outcome_program_config"],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    #[account(
        init,
        payer = authority,
        space = OutcomeConfig::LEN,
        seeds = [b"outcome_config", args.runtime_id.as_ref()],
        bump
    )]
    pub outcome_config: Account<'info, OutcomeConfig>,
    #[account(
        mut,
        seeds = [b"outcome_vault", args.runtime_id.as_ref()],
        bump
    )]
    pub outcome_vault: SystemAccount<'info>,
    /// CHECK: treasury pubkey is stored verbatim in OutcomeConfig and validated by replay-visible events.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    #[account(
        seeds = [b"approved_outcome_artifact", args.compiled_artifact_hash.as_ref()],
        bump = approved_outcome_artifact.bump
    )]
    pub approved_outcome_artifact: Account<'info, ApprovedOutcomeArtifact>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeOutcomeConfig>,
    args: InitializeOutcomeConfigArgs,
) -> Result<()> {
    require!(
        args.min_input_lamports <= args.max_input_lamports,
        OutcomeError::InvalidInputAmount
    );

    let artifact = &ctx.accounts.approved_outcome_artifact;
    require!(
        artifact.is_finalized,
        OutcomeError::CompiledArtifactNotFinalized
    );
    require!(
        artifact.status_allows_binding(ctx.accounts.program_config.allow_unreviewed_binding),
        OutcomeError::UnapprovedCompiledArtifact
    );
    require!(
        artifact.status != crate::state::approved_outcome_artifact::STATUS_REJECTED,
        OutcomeError::UnapprovedCompiledArtifact
    );

    let blob = load_blob_from_remaining(artifact, &ctx.remaining_accounts, ctx.program_id)?;
    let parsed = compiled_outcome_v1::parse(&blob)?;
    require!(
        parsed.header.min_input_lamports == args.min_input_lamports
            && parsed.header.max_input_lamports == args.max_input_lamports,
        OutcomeError::ArtifactBindingMismatch
    );

    let config = &mut ctx.accounts.outcome_config;
    config.runtime_id = args.runtime_id;
    config.authority = ctx.accounts.authority.key();
    config.treasury = ctx.accounts.treasury.key();
    config.min_input_lamports = args.min_input_lamports;
    config.max_input_lamports = args.max_input_lamports;
    config.next_resolve_id = 0;
    config.is_paused = false;
    config.bump = ctx.bumps.outcome_config;
    config.vault_bump = ctx.bumps.outcome_vault;
    config.compiled_artifact_hash = args.compiled_artifact_hash;
    config.master_seed = args.master_seed;
    config.last_seed_slot = Clock::get()?.slot;
    config.reserved = [0u8; 63];

    let vault_info = ctx.accounts.outcome_vault.to_account_info();
    if vault_info.data_is_empty() {
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(0);
        let seeds: &[&[u8]] = &[b"outcome_vault", &args.runtime_id, &[config.vault_bump]];
        let signer = &[seeds];
        let cpi_accounts = system_program::CreateAccount {
            from: ctx.accounts.authority.to_account_info(),
            to: vault_info.clone(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        system_program::create_account(cpi_ctx, lamports, 0, &system_program::ID)?;
    }

    emit!(OutcomeConfigInitializedV1 {
        runtime_id: args.runtime_id,
        authority: config.authority,
        treasury: config.treasury,
        min_input_lamports: config.min_input_lamports,
        max_input_lamports: config.max_input_lamports,
        compiled_artifact_hash: config.compiled_artifact_hash,
    });

    Ok(())
}
