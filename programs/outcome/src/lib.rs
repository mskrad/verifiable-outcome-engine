use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::admin_pause::AdminPause;
use instructions::admin_withdraw::AdminWithdraw;
use instructions::finalize_compiled_artifact::FinalizeCompiledArtifact;
use instructions::init_compiled_artifact_chunk::{
    InitCompiledArtifactChunk, InitCompiledArtifactChunkArgs,
};
use instructions::initialize_outcome_config::{
    InitializeOutcomeConfig, InitializeOutcomeConfigArgs,
};
use instructions::initialize_program_config::InitializeProgramConfig;
use instructions::refresh_master_seed::{RefreshMasterSeed, RefreshMasterSeedArgs};
use instructions::resolve_outcome::{ResolveOutcome, ResolveOutcomeArgs};
use instructions::review_compiled_artifact::{ReviewCompiledArtifact, ReviewCompiledArtifactArgs};
use instructions::set_program_config::{SetProgramConfig, SetProgramConfigArgs};
use instructions::submit_compiled_artifact::{SubmitCompiledArtifact, SubmitCompiledArtifactArgs};
use instructions::write_compiled_artifact_chunk::{
    WriteCompiledArtifactChunk, WriteCompiledArtifactChunkArgs,
};

declare_id!("3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq");

#[program]
pub mod outcome {
    use super::*;

    pub fn initialize_program_config(ctx: Context<InitializeProgramConfig>) -> Result<()> {
        instructions::initialize_program_config::handler(ctx)
    }

    pub fn set_program_config(
        ctx: Context<SetProgramConfig>,
        args: SetProgramConfigArgs,
    ) -> Result<()> {
        instructions::set_program_config::handler(ctx, args)
    }

    pub fn submit_compiled_artifact(
        ctx: Context<SubmitCompiledArtifact>,
        args: SubmitCompiledArtifactArgs,
    ) -> Result<()> {
        instructions::submit_compiled_artifact::handler(ctx, args)
    }

    pub fn init_compiled_artifact_chunk(
        ctx: Context<InitCompiledArtifactChunk>,
        args: InitCompiledArtifactChunkArgs,
    ) -> Result<()> {
        instructions::init_compiled_artifact_chunk::handler(ctx, args)
    }

    pub fn write_compiled_artifact_chunk(
        ctx: Context<WriteCompiledArtifactChunk>,
        args: WriteCompiledArtifactChunkArgs,
    ) -> Result<()> {
        instructions::write_compiled_artifact_chunk::handler(ctx, args)
    }

    pub fn finalize_compiled_artifact(ctx: Context<FinalizeCompiledArtifact>) -> Result<()> {
        instructions::finalize_compiled_artifact::handler(ctx)
    }

    pub fn review_compiled_artifact(
        ctx: Context<ReviewCompiledArtifact>,
        args: ReviewCompiledArtifactArgs,
    ) -> Result<()> {
        instructions::review_compiled_artifact::handler(ctx, args)
    }

    pub fn initialize_outcome_config(
        ctx: Context<InitializeOutcomeConfig>,
        args: InitializeOutcomeConfigArgs,
    ) -> Result<()> {
        instructions::initialize_outcome_config::handler(ctx, args)
    }

    pub fn refresh_master_seed(
        ctx: Context<RefreshMasterSeed>,
        args: RefreshMasterSeedArgs,
    ) -> Result<()> {
        instructions::refresh_master_seed::handler(ctx, args)
    }

    pub fn resolve_outcome(ctx: Context<ResolveOutcome>, args: ResolveOutcomeArgs) -> Result<()> {
        instructions::resolve_outcome::handler(ctx, args)
    }

    pub fn admin_pause(ctx: Context<AdminPause>, paused: bool) -> Result<()> {
        instructions::admin_pause::handler(ctx, paused)
    }

    pub fn admin_withdraw(ctx: Context<AdminWithdraw>, lamports: u64) -> Result<()> {
        instructions::admin_withdraw::handler(ctx, lamports)
    }
}

mod __client_accounts_initialize_program_config {
    pub use crate::instructions::initialize_program_config::__client_accounts_initialize_program_config::*;
}
mod __client_accounts_set_program_config {
    pub use crate::instructions::set_program_config::__client_accounts_set_program_config::*;
}
mod __client_accounts_submit_compiled_artifact {
    pub use crate::instructions::submit_compiled_artifact::__client_accounts_submit_compiled_artifact::*;
}
mod __client_accounts_init_compiled_artifact_chunk {
    pub use crate::instructions::init_compiled_artifact_chunk::__client_accounts_init_compiled_artifact_chunk::*;
}
mod __client_accounts_write_compiled_artifact_chunk {
    pub use crate::instructions::write_compiled_artifact_chunk::__client_accounts_write_compiled_artifact_chunk::*;
}
mod __client_accounts_finalize_compiled_artifact {
    pub use crate::instructions::finalize_compiled_artifact::__client_accounts_finalize_compiled_artifact::*;
}
mod __client_accounts_review_compiled_artifact {
    pub use crate::instructions::review_compiled_artifact::__client_accounts_review_compiled_artifact::*;
}
mod __client_accounts_initialize_outcome_config {
    pub use crate::instructions::initialize_outcome_config::__client_accounts_initialize_outcome_config::*;
}
mod __client_accounts_refresh_master_seed {
    pub use crate::instructions::refresh_master_seed::__client_accounts_refresh_master_seed::*;
}
mod __client_accounts_resolve_outcome {
    pub use crate::instructions::resolve_outcome::__client_accounts_resolve_outcome::*;
}
mod __client_accounts_admin_pause {
    pub use crate::instructions::admin_pause::__client_accounts_admin_pause::*;
}
mod __client_accounts_admin_withdraw {
    pub use crate::instructions::admin_withdraw::__client_accounts_admin_withdraw::*;
}
