# On-Chain Multi-Winner Selection Design

- Task ID: `HACKATHON-MULTI-WINNER-001`
- Status: second-pass Architect design; ready for Engineer
- Date: 2026-04-25

## 1. Decision

Implement full on-chain multi-winner support with a W3O1 v2 artifact format and a new `OutcomeResolutionV2` account/event shape.

Recommendation: GO for Engineer with bounded MVP caps:
- `winners_count` is committed inside the W3O1 v2 artifact bytes.
- All selected winner IDs are stored on-chain in `OutcomeResolutionV2`.
- `OutcomeResolvedV2` emits all selected winner IDs.
- Existing v1 artifacts and old blessed signatures remain replay-compatible through SDK fallback decoding.
- MVP cap: `MAX_WINNERS = 32`.

Reason for cap:
- Current artifact storage is capped at `MAX_CHUNKS = 8`, `CHUNK_SIZE = 1024`, and `MAX_COMPILED_ARTIFACT_BYTES = 8192`.
- With current outcome/effect entries, 100 address outcomes exceed the existing 8KB artifact cap.
- Supporting 100+ winners should be a follow-up that expands artifact chunk/storage limits and retests compute/log size.

## 2. Facts

- Current W3O1 v1 header is 34 bytes:
  - `magic[4]`
  - `format_version u16`
  - `min_input_lamports u64`
  - `max_input_lamports u64`
  - `outcome_count u16`
  - `total_effect_count u16`
  - `reserved[8]`
- Current Rust parser accepts only `FORMAT_VERSION_V1 = 1`.
- Current Rust parser requires v1 reserved bytes to be zero.
- Current `OutcomeResolution` stores one selected `outcome_id`.
- Current `OutcomeResolvedV1` emits one selected `outcome_id`.
- Current `/api/replay` shells out to `scripts/replay_verify.ts`, so no server logic change is required if the replay JSON only adds fields.

## 3. W3O1 Artifact Format

Use a version bump to `FORMAT_VERSION_V2 = 2`. Keep the same 34-byte header size by using the existing reserved bytes differently only for v2.

### V1 Header

```text
offset  size  type       field
0       4     ascii      magic = "W3O1"
4       2     u16 LE     format_version = 1
6       8     u64 LE     min_input_lamports
14      8     u64 LE     max_input_lamports
22      2     u16 LE     outcome_count
24      2     u16 LE     total_effect_count
26      8     bytes      reserved = all zero
34      ...   outcomes
```

### V2 Header

```text
offset  size  type       field
0       4     ascii      magic = "W3O1"
4       2     u16 LE     format_version = 2
6       8     u64 LE     min_input_lamports
14      8     u64 LE     max_input_lamports
22      2     u16 LE     outcome_count
24      2     u16 LE     total_effect_count
26      2     u16 LE     winners_count
28      6     bytes      reserved = all zero
34      ...   outcomes
```

Outcome entry layout remains unchanged:

```text
u8      outcome_id_len
u8[64]  outcome_id
u32 LE  weight
u16 LE  first_effect_index
u16 LE  effect_count
```

Effect entry layout remains unchanged:

```text
u8      effect_type = 1
u8[7]   reserved = all zero
u64 LE  amount_lamports
```

Validation:
- v1: `winners_count = 1` implicit.
- v2: `1 <= winners_count <= outcome_count`.
- v2: `winners_count <= MAX_WINNERS`.
- v2: remaining 6 header reserved bytes must be zero.
- v2 should reject overlapping effect ranges across outcomes to avoid double-counted payout effects when multiple winners are selected.

## 4. OutcomeResolution Account

Do not extend the existing `OutcomeResolution` struct in place. Old resolution accounts were allocated with the old byte size; changing the struct would make old account decode fail under the new IDL.

Add a new account type:

```rust
pub const MAX_WINNERS: usize = 32;

#[account]
pub struct OutcomeResolutionV2 {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub actor: Pubkey,
    pub input_lamports: u64,
    pub status: u8,
    pub artifact_format_version: u16,
    pub winner_count: u16,
    pub total_output_lamports: u64,
    pub compiled_artifact_hash: [u8; 32],
    pub randomness: [u8; 32],

    // Backwards-friendly primary winner.
    pub outcome_id_len: u8,
    pub outcome_id: [u8; MAX_OUTCOME_ID_BYTES],

    // All winners in deterministic selection order.
    pub outcome_id_lens: Vec<u8>,
    pub outcome_ids: Vec<[u8; MAX_OUTCOME_ID_BYTES]>,

    // Total selected effects across all winners.
    pub effect_count: u16,
    pub effects_digest: [u8; 32],
    pub bump: u8,
    pub reserved: [u8; 29],
}
```

Maximum account size:

```rust
impl OutcomeResolutionV2 {
    pub const LEN: usize =
        8  // discriminator
        + 16 // runtime_id
        + 8  // resolve_id
        + 32 // actor
        + 8  // input_lamports
        + 1  // status
        + 2  // artifact_format_version
        + 2  // winner_count
        + 8  // total_output_lamports
        + 32 // compiled_artifact_hash
        + 32 // randomness
        + 1  // outcome_id_len
        + MAX_OUTCOME_ID_BYTES
        + 4 + MAX_WINNERS // Vec<u8>
        + 4 + MAX_WINNERS * MAX_OUTCOME_ID_BYTES // Vec<[u8; 64]>
        + 2  // effect_count
        + 32 // effects_digest
        + 1  // bump
        + 29; // reserved
}
```

With `MAX_WINNERS = 32`, `OutcomeResolutionV2::LEN = 2366` bytes.

Realloc:
- Not required.
- `resolve_outcome` initializes the account with `space = OutcomeResolutionV2::LEN`.
- Store vectors at actual winner length; account allocation has max capacity.

PDA:
- Keep the same seeds:
  - `["outcome_resolution", runtime_id, next_resolve_id.to_le_bytes()]`
- This preserves existing lookup derivation.
- Old signatures point to old discriminator `OutcomeResolution`.
- New signatures point to new discriminator `OutcomeResolutionV2`.

## 5. Resolution Event

Keep `OutcomeResolvedV1` for old event decoding.

Add:

```rust
#[event]
pub struct OutcomeResolvedV2 {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub actor: Pubkey,
    pub input_lamports: u64,
    pub total_output_lamports: u64,
    pub master_seed: [u8; 32],
    pub randomness: [u8; 32],
    pub compiled_artifact_hash: [u8; 32],
    pub artifact_format_version: u16,
    pub winner_count: u16,
    pub outcome_id_lens: Vec<u8>,
    pub outcome_ids: Vec<[u8; MAX_OUTCOME_ID_BYTES]>,
    pub effect_count: u16,
    pub effects_digest: [u8; 32],
}
```

Event semantics:
- `outcome_ids[0]` is the primary winner.
- For v2 with `winners_count = 1`, event still emits one-element arrays.
- SDK returns legacy `outcome_id = outcome_ids[0]`.

## 6. Rust Selection Algorithm

Use hash-derived repeated weighted selection without replacement.

Design goals:
- Round 0 stays compatible with current single-winner selection.
- Later rounds are domain-separated and deterministic.
- No expanded weighted pool.
- No duplicate winner because selected outcomes are removed from the candidate pool.

Algorithm:

```rust
const MULTI_WINNER_DOMAIN: &[u8] = b"VRE_MULTI_WINNER_V1";

fn roll_for_round(randomness: &[u8; 32], round: u16) -> u64 {
    if round == 0 {
        return u64::from_le_bytes(randomness[..8].try_into().unwrap());
    }

    let mut hasher = Sha256::new();
    hasher.update(MULTI_WINNER_DOMAIN);
    hasher.update(randomness);
    hasher.update(round.to_le_bytes());
    let digest: [u8; 32] = hasher.finalize().into();
    u64::from_le_bytes(digest[..8].try_into().unwrap())
}
```

Selection:

```rust
remaining = Vec<(original_index, ParsedOutcome)>
selected = []

for round in 0..winners_count {
    weights = remaining.map(outcome.weight)
    picked_remaining_index = choose_weighted_index(weights, roll_for_round(randomness, round))
    selected.push(remaining.remove(picked_remaining_index))
}
```

Effects:
- For each selected outcome, append its raw effect-entry bytes to a digest buffer in winner order.
- `effects_digest = sha256(concat(selected_effect_entry_bytes_in_winner_order))`.
- `effect_count = sum(selected.effect_count)`.
- `total_output_lamports = sum(all selected effect amount_lamports)`.
- Payout remains current aggregate transfer from `outcome_vault` to `actor`.

Compatibility:
- v1 parse sets `winners_count = 1`.
- v1 selection path can call the same multi-select function with `1`.
- Round 0 remains identical to existing behavior.

## 7. SDK Changes

### `sdk/types.ts`

- Add `winners_count?: number` to `RaffleConfig` and `AirdropConfig`.
- Add `format_version?: 1 | 2` or derive `2` when `winners_count > 1`.
- Extend `VerifyResult`:

```ts
type VerifyResult = {
  status: "MATCH" | "MISMATCH";
  reason: string;
  outcome_id: string;
  outcome_ids?: string[];
  winners_count?: number;
  artifact_format_version?: number;
  outcomes?: Array<{ id: string; weight: number }>;
  resolve_id: string;
  compiled_artifact_hash: string;
  runtime_id: string;
  program_id: string;
};
```

### `sdk/artifact.ts`

- Add `FORMAT_VERSION_V2 = 2`.
- Add `MAX_WINNERS = 32`.
- Add `validateWinnersCount`.
- Parse config `winners_count` optional, default `1`.
- Build W3O1:
  - if `winners_count === 1`, keep v1 by default for existing configs.
  - if `winners_count > 1`, emit v2 header.
- Header write:
  - v1: `reserved[8] = 0`.
  - v2: `u16le(winners_count) + reserved[6] = 0`.
- Reject `winners_count > normalized outcomes.length`.
- Reject `winners_count > MAX_WINNERS`.

### `sdk/verify.ts`

- Parse W3O1 v1 and v2.
- `ParsedHeader` includes `winnersCount`.
- Add `selectOutcomes` matching Rust.
- Add V2 event/account decoding:
  - find `OutcomeResolvedV2` first;
  - fallback to `OutcomeResolvedV1`.
- Account decode:
  - try `OutcomeResolutionV2`;
  - fallback to `OutcomeResolution`.
- For V1:
  - verify exactly as today.
- For V2:
  - verify `winner_count`, `outcome_id_lens`, `outcome_ids`, `effect_count`, `effects_digest`, `total_output_lamports` against recomputation.
  - return `outcome_id = outcome_ids[0]`.
  - return `outcome_ids` when `winner_count > 1`.

### `scripts/replay_verify.ts`

- No CLI flag required.
- Replay derives `outcome_ids` from event/account/artifact.
- JSON output adds `outcome_ids`, `winners_count`, `artifact_format_version`.
- Text output may print `outcome_ids` only when present.

### `sdk/operator.ts` / `scripts/resolve_operator.ts`

- Update submit args to allow `format_version = 2`.
- Ensure artifact upload/finalize handles v2 blob hash and format version.
- Existing operator config path should work with optional `winners_count`.

## 8. `/api/replay` Shape

No `web/server.mjs` logic change required.

Existing response remains:

```json
{
  "ok": true,
  "replay": {
    "verification_result": "MATCH",
    "verification_reason": "OK",
    "outcome_id": "winner_a"
  }
}
```

For multi-winner v2, replay JSON adds fields:

```json
{
  "ok": true,
  "replay": {
    "verification_result": "MATCH",
    "verification_reason": "OK",
    "outcome_id": "winner_a",
    "outcome_ids": ["winner_a", "winner_b", "winner_c"],
    "winners_count": 3,
    "artifact_format_version": 2
  }
}
```

`outcome_id` remains for backwards compatibility.

## 9. Devnet Upgrade Plan

Pre-check:

```bash
cd /Users/timurkurmangaliev/verifiable-outcome-engine
solana program show 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq --url https://api.devnet.solana.com
```

Build/test:

```bash
anchor build
npx tsc --noEmit
node --check web/server.mjs
git diff --check
```

IDL sync:

```bash
cp target/idl/outcome.json artifacts/outcome_idl.json
```

Upgrade:
- Prefer `anchor upgrade` if local Anchor does not hit the known macOS system-configuration panic.
- Fallback to `solana program deploy --program-id ... --upgrade-authority ... --keypair ...` as used in the protocol-fee upgrade.

ProgramConfig:
- No re-init expected.
- `ProgramConfig` layout does not change.
- Existing `OutcomeConfig` layout does not change.

Post-upgrade:

```bash
solana program show 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq --url https://api.devnet.solana.com
```

Demo evidence:
- Add `examples/multi_winner_raffle.config.json` with `winners_count: 3`.
- Resolve on devnet with `ANCHOR_WALLET=/Users/timurkurmangaliev/.config/solana/esjx.json`.
- Add new blessed entry, e.g. `outcome_core_devnet_sig_10`.
- Do not mutate existing blessed entries.
- New blessed entry must include `winners_count: 3`, `outcome_ids`, and `artifact_format_version: 2`.

Verification:

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
yarn -s replay \
  --sig <NEW_MULTI_WINNER_SIG> \
  --url https://api.devnet.solana.com \
  --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq
```

Expected:
- `verification_result : MATCH`
- `verification_reason : OK`
- `outcome_id` present
- `outcome_ids` has 3 distinct IDs
- `outcome_ids[0] == outcome_id`

Regression:
- Replay at least one existing v1 blessed signature.
- It must return the same `outcome_id` and no `outcome_ids` field unless Engineer chooses to emit one-element arrays internally but suppress them from public output.

## 10. Backwards Compatibility

Existing v1 artifacts:
- Continue to parse as v1.
- Implicit `winners_count = 1`.
- Existing signatures keep `OutcomeResolvedV1` logs and old `OutcomeResolution` accounts.
- SDK must decode both old and new event/account shapes.

New v1 artifacts after upgrade:
- Recommended: still produce v1 bytes when `winners_count` is omitted or `1`.
- The upgraded program may store new resolves in `OutcomeResolutionV2`; SDK handles this.

New v2 artifacts:
- Require `format_version = 2` in `submit_compiled_artifact`.
- Store and emit all selected winner IDs.

## 11. Change List for Engineer

Rust:
- `programs/outcome/src/math/compiled_outcome_v1.rs`
  - add `FORMAT_VERSION_V2`, `MAX_WINNERS`;
  - extend `ParsedHeader` with `winners_count`;
  - parse v1/v2 headers;
  - implement multi-select without replacement;
  - compute aggregate output/effect digest.
- `programs/outcome/src/state/outcome_resolution.rs`
  - keep old `OutcomeResolution`;
  - add `OutcomeResolutionV2` and `MAX_WINNERS`.
- `programs/outcome/src/events.rs`
  - keep `OutcomeResolvedV1`;
  - add `OutcomeResolvedV2`.
- `programs/outcome/src/instructions/resolve_outcome.rs`
  - switch initialized resolution account to `OutcomeResolutionV2`;
  - write vectors and primary winner fields;
  - emit `OutcomeResolvedV2`.
- `programs/outcome/src/instructions/submit_compiled_artifact.rs`
  - allow `FORMAT_VERSION_V1` and `FORMAT_VERSION_V2`.
- `programs/outcome/src/errors.rs`
  - add precise errors if needed, or reuse `InvalidCompiledArtifactFormat`.

TypeScript:
- `sdk/types.ts`
- `sdk/artifact.ts`
- `sdk/verify.ts`
- `sdk/operator.ts`
- `scripts/resolve_operator.ts`
- `scripts/replay_verify.ts`
- `artifacts/outcome_idl.json`
- `examples/multi_winner_raffle.config.json`
- `artifacts/outcome_devnet_blessed_signatures.json` append-only new entry

No frontend changes in this pass.
No `web/server.mjs` logic changes.

## 12. Complexity Estimate

Estimated Engineer complexity: high.

Reasons:
- Rust account/event shape change.
- IDL regeneration and SDK decoder compatibility for two event/account versions.
- Devnet program upgrade.
- New on-chain blessed signature.
- Regression replay for old signatures.

Expected implementation size:
- Rust: medium-to-large.
- SDK/CLI/operator: medium.
- Evidence/devnet verification: medium.

## 13. Go / No-Go

GO for Engineer.

Safest implementation default:
- W3O1 v2 header with `winners_count` in former reserved bytes.
- `MAX_WINNERS = 32`.
- New `OutcomeResolutionV2`; do not mutate old account struct.
- Add `OutcomeResolvedV2`; keep V1 decoding.
- Preserve public `outcome_id`; add `outcome_ids` only for `winners_count > 1`.
- Append a new blessed signature; do not edit existing signatures.

Confidence: high.
