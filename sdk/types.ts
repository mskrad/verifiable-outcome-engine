export type LamportsValue = bigint | number;

export type RaffleConfig = {
  type: "raffle";
  input_lamports: LamportsValue;
  participants: Array<{ address: string; weight: number }>;
  payout_lamports?: LamportsValue;
};

export type LootConfig = {
  type: "loot";
  input_lamports: LamportsValue;
  outcomes: Array<{
    id: string;
    weight: number;
    payout_lamports: LamportsValue;
  }>;
};

export type AirdropConfig = {
  type: "airdrop";
  input_lamports: LamportsValue;
  slots: number;
  eligible: Array<{ address: string; weight: number }>;
  payout_lamports?: LamportsValue;
};

export type ArtifactConfig = RaffleConfig | LootConfig | AirdropConfig;

export type VerifyOutcomeOptions = {
  signature: string;
  rpcUrl: string;
  programId?: string;
  artifactPath?: string;
};

export type VerifyResult = {
  status: "MATCH" | "MISMATCH";
  reason: string;
  outcome_id: string;
  resolve_id: string;
  compiled_artifact_hash: string;
  runtime_id: string;
  program_id: string;
};

export type W3O1Effect = {
  type: "transfer_sol";
  amount_lamports: bigint;
};

export type W3O1Outcome = {
  id: string;
  weight: number;
  first_effect_index: number;
  effect_count: number;
};

export type W3O1Config = {
  format_version: 1;
  min_input_lamports: bigint;
  max_input_lamports: bigint;
  outcomes: W3O1Outcome[];
  effects: W3O1Effect[];
};
