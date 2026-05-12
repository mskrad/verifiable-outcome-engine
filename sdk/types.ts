export type LamportsValue = bigint | number;
export type SignedIntegerValue = bigint | number;

export type ResolutionFormula =
  | "weighted_random"
  | "rank_desc"
  | "rank_asc"
  | "first_n"
  | "closest_to";

export type RaffleConfig = {
  type: "raffle";
  input_lamports: LamportsValue;
  participants: Array<{ address: string; weight: number }>;
  payout_lamports?: LamportsValue;
  winners_count?: number;
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
  winners_count?: number;
};

export type FormulaParticipant = {
  id: string;
  weight?: number;
  score?: SignedIntegerValue;
};

export type SnapshotParticipant = {
  id: string;
  weight?: number;
  score?: SignedIntegerValue;
  order?: number;
};

export type FormulaDrawConfig = {
  type: "formula_draw";
  formula: ResolutionFormula;
  input_lamports: LamportsValue;
  participants: FormulaParticipant[];
  payout_lamports?: LamportsValue;
  winners_count?: number;
  target?: SignedIntegerValue;
};

export type SnapshotFormulaDrawConfig = {
  type: "formula_draw_snapshot";
  formula: ResolutionFormula;
  input_lamports: LamportsValue;
  snapshot_hash: string;
  snapshot_count: number;
  snapshot_uri: string;
  payout_lamports?: LamportsValue;
  winners_count?: number;
  target?: SignedIntegerValue;
};

export type SnapshotManifest = {
  version: "vre_snapshot_manifest_v1";
  artifact_format_version: 4;
  snapshot_hash: string;
  snapshot_count: number;
  formula: ResolutionFormula;
  winners_count: number;
  snapshot_uri: string;
  created_at: string;
  target?: string;
  payout_lamports?: string;
  threshold_mode?: "simple" | "medium" | "bulk" | "streaming";
};

export type ArtifactConfig =
  | RaffleConfig
  | LootConfig
  | AirdropConfig
  | FormulaDrawConfig
  | SnapshotFormulaDrawConfig;

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
  outcome_ids?: string[];
  winners_count?: number;
  artifact_format_version?: number;
  resolution_formula?: ResolutionFormula;
  target?: number;
  snapshot_hash?: string;
  snapshot_count?: number;
  snapshot_uri?: string;
  outcomes?: Array<{ id: string; weight: number; score?: number; order?: number }>;
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
  score?: bigint;
  order?: number;
  first_effect_index: number;
  effect_count: number;
};

export type W3O1Config = {
  format_version: 1 | 2 | 3;
  winners_count: number;
  min_input_lamports: bigint;
  max_input_lamports: bigint;
  resolution_formula?: ResolutionFormula;
  target_score?: bigint;
  outcomes: W3O1Outcome[];
  effects: W3O1Effect[];
};
