use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::admin_pause::AdminPause;
use instructions::admin_withdraw::AdminWithdraw;
use instructions::attest_winners::{AttestWinners, AttestWinnersArgs};
use instructions::claim_sortition_ticket::{ClaimSortitionTicket, ClaimSortitionTicketArgs};
use instructions::close_sortition_ticket::{CloseSortitionTicket, CloseSortitionTicketArgs};
use instructions::create_sortition_draw::{CreateSortitionDraw, CreateSortitionDrawArgs};
use instructions::expire_rng_v2::{ExpireRngV2, ExpireRngV2Args};
use instructions::expire_sealed_rng_v2::{ExpireSealedRngV2, ExpireSealedRngV2Args};
use instructions::finalize_compiled_artifact::FinalizeCompiledArtifact;
use instructions::init_compiled_artifact_chunk::{
    InitCompiledArtifactChunk, InitCompiledArtifactChunkArgs,
};
use instructions::init_sortition_economics::{InitSortitionEconomics, InitSortitionEconomicsArgs};
use instructions::initialize_outcome_config::{
    InitializeOutcomeConfig, InitializeOutcomeConfigArgs,
};
use instructions::initialize_program_config::{
    InitializeProgramConfig, InitializeProgramConfigArgs,
};
use instructions::initialize_unicorn_g_config::{
    InitializeUnicornGConfig, InitializeUnicornGConfigArgs,
};
use instructions::prepare_rng_v2::{PrepareRngV2, PrepareRngV2Args};
use instructions::prepare_rng_v2_unicorn::PrepareRngV2Unicorn;
use instructions::recover_program_config_admin::{
    RecoverProgramConfigAdmin, RecoverProgramConfigAdminArgs,
};
use instructions::refresh_master_seed::{RefreshMasterSeed, RefreshMasterSeedArgs};
use instructions::register_sortition_ticket::{
    RegisterSortitionTicket, RegisterSortitionTicketArgs,
};
use instructions::register_sortition_ticket_paid::RegisterSortitionTicketPaid;
use instructions::resolve_outcome::{ResolveOutcome, ResolveOutcomeArgs};
use instructions::resolve_outcome_v121::{ResolveOutcomeV121, ResolveOutcomeV121Args};
use instructions::resolve_outcome_v4::{ResolveOutcomeV4, ResolveOutcomeV4Args};
use instructions::review_compiled_artifact::{ReviewCompiledArtifact, ReviewCompiledArtifactArgs};
use instructions::seal_randomness::{SealRandomness, SealRandomnessArgs};
use instructions::seal_randomness_unicorn::{SealRandomnessUnicorn, SealRandomnessUnicornArgs};
use instructions::seal_sortition_draw::{SealSortitionDraw, SealSortitionDrawArgs};
use instructions::set_program_config::{SetProgramConfig, SetProgramConfigArgs};
use instructions::set_unicorn_g_config::{SetUnicornGConfig, SetUnicornGConfigArgs};
use instructions::submit_compiled_artifact::{SubmitCompiledArtifact, SubmitCompiledArtifactArgs};
use instructions::sweep_sortition_tickets::{SweepSortitionTickets, SweepSortitionTicketsArgs};
use instructions::write_compiled_artifact_chunk::{
    WriteCompiledArtifactChunk, WriteCompiledArtifactChunkArgs,
};

include!(concat!(env!("OUT_DIR"), "/program_id.rs"));

#[program]
pub mod outcome {
    use super::*;

    pub fn initialize_program_config(
        ctx: Context<InitializeProgramConfig>,
        args: InitializeProgramConfigArgs,
    ) -> Result<()> {
        instructions::initialize_program_config::handler(ctx, args)
    }

    pub fn set_program_config(
        ctx: Context<SetProgramConfig>,
        args: SetProgramConfigArgs,
    ) -> Result<()> {
        instructions::set_program_config::handler(ctx, args)
    }

    pub fn recover_program_config_admin(
        ctx: Context<RecoverProgramConfigAdmin>,
        args: RecoverProgramConfigAdminArgs,
    ) -> Result<()> {
        instructions::recover_program_config_admin::handler(ctx, args)
    }

    pub fn initialize_unicorn_g_config(
        ctx: Context<InitializeUnicornGConfig>,
        args: InitializeUnicornGConfigArgs,
    ) -> Result<()> {
        instructions::initialize_unicorn_g_config::handler(ctx, args)
    }

    pub fn set_unicorn_g_config(
        ctx: Context<SetUnicornGConfig>,
        args: SetUnicornGConfigArgs,
    ) -> Result<()> {
        instructions::set_unicorn_g_config::handler(ctx, args)
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

    pub fn resolve_outcome_v4(
        ctx: Context<ResolveOutcomeV4>,
        args: ResolveOutcomeV4Args,
    ) -> Result<()> {
        instructions::resolve_outcome_v4::handler(ctx, args)
    }

    pub fn resolve_outcome_v121(
        ctx: Context<ResolveOutcomeV121>,
        args: ResolveOutcomeV121Args,
    ) -> Result<()> {
        instructions::resolve_outcome_v121::handler(ctx, args)
    }

    pub fn prepare_rng_v2(ctx: Context<PrepareRngV2>, args: PrepareRngV2Args) -> Result<()> {
        instructions::prepare_rng_v2::handler(ctx, args)
    }

    pub fn prepare_rng_v2_unicorn(
        ctx: Context<PrepareRngV2Unicorn>,
        args: PrepareRngV2Args,
    ) -> Result<()> {
        instructions::prepare_rng_v2_unicorn::handler(ctx, args)
    }

    pub fn seal_randomness(ctx: Context<SealRandomness>, args: SealRandomnessArgs) -> Result<()> {
        instructions::seal_randomness::handler(ctx, args)
    }

    pub fn seal_randomness_unicorn(
        ctx: Context<SealRandomnessUnicorn>,
        args: SealRandomnessUnicornArgs,
    ) -> Result<()> {
        instructions::seal_randomness_unicorn::handler(ctx, args)
    }

    pub fn attest_winners(ctx: Context<AttestWinners>, args: AttestWinnersArgs) -> Result<()> {
        instructions::attest_winners::handler(ctx, args)
    }

    pub fn expire_rng_v2(ctx: Context<ExpireRngV2>, args: ExpireRngV2Args) -> Result<()> {
        instructions::expire_rng_v2::handler(ctx, args)
    }

    pub fn expire_sealed_rng_v2(
        ctx: Context<ExpireSealedRngV2>,
        args: ExpireSealedRngV2Args,
    ) -> Result<()> {
        instructions::expire_sealed_rng_v2::handler(ctx, args)
    }

    pub fn admin_pause(ctx: Context<AdminPause>, paused: bool) -> Result<()> {
        instructions::admin_pause::handler(ctx, paused)
    }

    pub fn admin_withdraw(ctx: Context<AdminWithdraw>, lamports: u64) -> Result<()> {
        instructions::admin_withdraw::handler(ctx, lamports)
    }

    pub fn create_sortition_draw(
        ctx: Context<CreateSortitionDraw>,
        args: CreateSortitionDrawArgs,
    ) -> Result<()> {
        instructions::create_sortition_draw::handler(ctx, args)
    }

    pub fn register_sortition_ticket(
        ctx: Context<RegisterSortitionTicket>,
        args: RegisterSortitionTicketArgs,
    ) -> Result<()> {
        instructions::register_sortition_ticket::handler(ctx, args)
    }

    pub fn seal_sortition_draw(
        ctx: Context<SealSortitionDraw>,
        args: SealSortitionDrawArgs,
    ) -> Result<()> {
        instructions::seal_sortition_draw::handler(ctx, args)
    }

    pub fn claim_sortition_ticket(
        ctx: Context<ClaimSortitionTicket>,
        args: ClaimSortitionTicketArgs,
    ) -> Result<()> {
        instructions::claim_sortition_ticket::handler(ctx, args)
    }

    pub fn init_sortition_economics(
        ctx: Context<InitSortitionEconomics>,
        args: InitSortitionEconomicsArgs,
    ) -> Result<()> {
        instructions::init_sortition_economics::handler(ctx, args)
    }

    pub fn register_sortition_ticket_paid(
        ctx: Context<RegisterSortitionTicketPaid>,
        args: RegisterSortitionTicketArgs,
    ) -> Result<()> {
        instructions::register_sortition_ticket_paid::handler(ctx, args)
    }

    pub fn close_sortition_ticket(
        ctx: Context<CloseSortitionTicket>,
        args: CloseSortitionTicketArgs,
    ) -> Result<()> {
        instructions::close_sortition_ticket::handler(ctx, args)
    }

    pub fn sweep_sortition_tickets<'info>(
        ctx: Context<'_, '_, 'info, 'info, SweepSortitionTickets<'info>>,
        args: SweepSortitionTicketsArgs,
    ) -> Result<()> {
        instructions::sweep_sortition_tickets::handler(ctx, args)
    }
}

mod __client_accounts_initialize_program_config {
    pub use crate::instructions::initialize_program_config::__client_accounts_initialize_program_config::*;
}
mod __client_accounts_set_program_config {
    pub use crate::instructions::set_program_config::__client_accounts_set_program_config::*;
}
mod __client_accounts_recover_program_config_admin {
    pub use crate::instructions::recover_program_config_admin::__client_accounts_recover_program_config_admin::*;
}
mod __client_accounts_initialize_unicorn_g_config {
    pub use crate::instructions::initialize_unicorn_g_config::__client_accounts_initialize_unicorn_g_config::*;
}
mod __client_accounts_set_unicorn_g_config {
    pub use crate::instructions::set_unicorn_g_config::__client_accounts_set_unicorn_g_config::*;
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
mod __client_accounts_resolve_outcome_v4 {
    pub use crate::instructions::resolve_outcome_v4::__client_accounts_resolve_outcome_v4::*;
}
mod __client_accounts_resolve_outcome_v121 {
    pub use crate::instructions::resolve_outcome_v121::__client_accounts_resolve_outcome_v121::*;
}
mod __client_accounts_prepare_rng_v2 {
    pub use crate::instructions::prepare_rng_v2::__client_accounts_prepare_rng_v2::*;
}
mod __client_accounts_prepare_rng_v2_unicorn {
    pub use crate::instructions::prepare_rng_v2_unicorn::__client_accounts_prepare_rng_v2_unicorn::*;
}
mod __client_accounts_seal_randomness {
    pub use crate::instructions::seal_randomness::__client_accounts_seal_randomness::*;
}
mod __client_accounts_seal_randomness_unicorn {
    pub use crate::instructions::seal_randomness_unicorn::__client_accounts_seal_randomness_unicorn::*;
}
mod __client_accounts_attest_winners {
    pub use crate::instructions::attest_winners::__client_accounts_attest_winners::*;
}
mod __client_accounts_expire_rng_v2 {
    pub use crate::instructions::expire_rng_v2::__client_accounts_expire_rng_v2::*;
}
mod __client_accounts_expire_sealed_rng_v2 {
    pub use crate::instructions::expire_sealed_rng_v2::__client_accounts_expire_sealed_rng_v2::*;
}
mod __client_accounts_admin_pause {
    pub use crate::instructions::admin_pause::__client_accounts_admin_pause::*;
}
mod __client_accounts_admin_withdraw {
    pub use crate::instructions::admin_withdraw::__client_accounts_admin_withdraw::*;
}
mod __client_accounts_create_sortition_draw {
    pub use crate::instructions::create_sortition_draw::__client_accounts_create_sortition_draw::*;
}
mod __client_accounts_register_sortition_ticket {
    pub use crate::instructions::register_sortition_ticket::__client_accounts_register_sortition_ticket::*;
}
mod __client_accounts_seal_sortition_draw {
    pub use crate::instructions::seal_sortition_draw::__client_accounts_seal_sortition_draw::*;
}
mod __client_accounts_claim_sortition_ticket {
    pub use crate::instructions::claim_sortition_ticket::__client_accounts_claim_sortition_ticket::*;
}
mod __client_accounts_init_sortition_economics {
    pub use crate::instructions::init_sortition_economics::__client_accounts_init_sortition_economics::*;
}
mod __client_accounts_register_sortition_ticket_paid {
    pub use crate::instructions::register_sortition_ticket_paid::__client_accounts_register_sortition_ticket_paid::*;
}
mod __client_accounts_close_sortition_ticket {
    pub use crate::instructions::close_sortition_ticket::__client_accounts_close_sortition_ticket::*;
}
mod __client_accounts_sweep_sortition_tickets {
    pub use crate::instructions::sweep_sortition_tickets::__client_accounts_sweep_sortition_tickets::*;
}
