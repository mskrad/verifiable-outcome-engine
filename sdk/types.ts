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
  merkle_root?: string;
  payout_lamports?: LamportsValue;
  winners_count?: number;
  target?: SignedIntegerValue;
};

export type OutcomeStandardV12ScaleDrawConfig = Omit<
  SnapshotFormulaDrawConfig,
  "type"
> & {
  type: "outcome_standard_v1_2";
};

export type OutcomeStandardV121ScaleDrawConfig = Omit<
  SnapshotFormulaDrawConfig,
  "type"
> & {
  type: "outcome_standard_v1_2_1";
};

export type CompactNamedEntry = {
  id: string;
  weight?: number;
  score?: SignedIntegerValue;
  order?: number;
};

export type CompactNamedEntryDrawConfig = {
  type: "formula_draw_v5";
  formula: ResolutionFormula;
  input_lamports: LamportsValue;
  participants: CompactNamedEntry[];
  payout_lamports?: LamportsValue;
  winners_count?: number;
  target?: SignedIntegerValue;
};

export type SnapshotPublicationStatus =
  | "pending"
  | "published"
  | "skipped_disabled"
  | "skipped_unconfigured"
  | "failed_missing_sdk"
  | "failed_upload"
  | "failed_fetch"
  | "failed";

export type SnapshotProofStatus = "pending" | "ready";

export type SnapshotMerkleProofNode = {
  position: "left" | "right";
  sibling: string;
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
  merkle_root?: string;
  leaf_hash_scheme?: "sha256d_jsonl_v1";
  merkle_hash_scheme?: "sha256_pair_v1";
  proof_manifest_url?: string;
  irys_url?: string;
  publication_status?: SnapshotPublicationStatus;
  publication_error?: string;
  proof_status?: SnapshotProofStatus;
  target?: string;
  payout_lamports?: string;
  threshold_mode?: "simple" | "medium" | "bulk" | "streaming";
};

export type OutcomeStandardV12SnapshotManifest = {
  version: "outcome_standard_snapshot_manifest_v1";
  standard_version: "1.2";
  standard_kind: "scale_snapshot";
  entry_model: "named_entry";
  entry_hash_scheme: "sha256d_canonical_named_entry_v1";
  merkle_hash_scheme: "sha256_pair_v1";
  snapshot_hash: string;
  snapshot_count: number;
  formula: ResolutionFormula;
  winners_count: number;
  snapshot_uri: string;
  created_at: string;
  merkle_root: string;
  publication_status: SnapshotPublicationStatus;
  publication_url: string | null;
  proof_manifest_url: string | null;
  proof_status: SnapshotProofStatus;
  target?: string;
  payout_lamports?: string;
  threshold_mode?: "simple" | "medium" | "bulk" | "streaming";
  publication_error?: string;
};

export type OutcomeStandardV12ProofManifest = {
  version: "outcome_standard_proof_manifest_v1";
  standard_version: "1.2";
  standard_kind: "scale_snapshot";
  signature: string;
  program_id: string;
  snapshot_hash: string;
  snapshot_count: number;
  snapshot_uri: string;
  merkle_root: string;
  formula: ResolutionFormula;
  winners_count: number;
  selected_ids: string[];
  proof_endpoint_template: string;
  publication_status: SnapshotPublicationStatus;
  publication_url: string | null;
  snapshot_manifest_uri: string;
  proof_status: SnapshotProofStatus;
  target?: string;
  publication_error?: string;
};

export type OutcomeStandardV121SnapshotManifest = Omit<
  OutcomeStandardV12SnapshotManifest,
  "standard_version"
> & {
  standard_version: "1.2.1";
  winner_claim_hash: string;
};

export type OutcomeStandardV121ProofManifest = Omit<
  OutcomeStandardV12ProofManifest,
  "standard_version"
> & {
  standard_version: "1.2.1";
  winner_claim_hash: string;
};

export type SnapshotProofResponse = {
  ok: true;
  signature: string;
  program_id: string;
  snapshot_hash: string;
  snapshot_count: number;
  snapshot_uri: string;
  merkle_root: string;
  irys_url?: string | null;
  proof_manifest_url?: string | null;
  publication_status?: SnapshotPublicationStatus;
  proof_status?: SnapshotProofStatus;
  address: string;
  participant: {
    id: string;
    order: number;
    weight?: number;
    score?: string;
  } | null;
  leaf_hash: string | null;
  proof: SnapshotMerkleProofNode[];
  included: boolean;
  winner: boolean;
  outcome_id: string;
  outcome_ids: string[];
  resolution_formula?: ResolutionFormula;
  target?: number;
};

export type ArtifactConfig =
  | RaffleConfig
  | LootConfig
  | AirdropConfig
  | FormulaDrawConfig
  | SnapshotFormulaDrawConfig
  | OutcomeStandardV12ScaleDrawConfig
  | OutcomeStandardV121ScaleDrawConfig
  | CompactNamedEntryDrawConfig;

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
  entry_count?: number;
  standard_version?: "Outcome Standard V1.1" | "1.2" | "1.2.1";
  merkle_root?: string;
  irys_url?: string;
  proof_manifest_url?: string;
  publication_status?: SnapshotPublicationStatus;
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
