# Verification Error Reference

VRE returns a specific reason code for every verification result. A successful
verification returns `MATCH` with reason `OK`. Any failed verification returns
`MISMATCH` with a reason that points to the failed trust boundary.

Use this reference when the verifier (`/verify`, `POST /api/replay`, or SDK `verifyOutcome`) returns a non-OK reason. The protocol specification is at https://verifiableoutcome.online/spec (Markdown: `/spec.md`).

## Reason Codes

| Code | What it means | What the operator should do |
|---|---|---|
| `OK` | The transaction event, on-chain accounts, committed artifact, randomness, replayed outcome, and effects digest all match. | Share the transaction signature and verifier output. No remediation is needed. |
| `ERR_TX_NOT_FOUND_OR_NO_LOGS` | The RPC endpoint could not return the transaction or its logs. The verifier cannot read the emitted outcome event. | Check the signature, cluster, and RPC URL. Retry with a healthy archival or confirmed devnet RPC endpoint. |
| `ERR_PROGRAM_ID_MISMATCH` | The expected program ID was not invoked, or the outcome event was emitted by a different program. | Verify with the program ID that actually resolved the outcome. If you operate a custom deployment, pass that program ID to the verifier. |
| `ERR_EVENT_DISCRIMINATOR_MISMATCH` | The expected program emitted program data, but the data did not match a supported resolution event format. | Confirm the transaction was produced by a compatible VRE program version. Do not ask users to trust this transaction until the event format is understood. |
| `ERR_EVENT_NOT_FOUND_FOR_PROGRAM` | The transaction logs do not contain a supported resolution event for the requested program ID. | Verify the correct resolution transaction, not a setup, funding, or unrelated transaction. Confirm the program ID and signature pair. |
| `ERR_ARTIFACT_CHUNK_MISSING` | A committed artifact chunk is missing, unreadable, bound to a different hash, stored at the wrong index, not fully written, or reconstructs to the wrong length. | Re-check artifact upload and finalization. Resolve again only after all artifact chunks are present and bound to the same compiled artifact hash. |
| `ERR_OUTCOME_CONFIG_NOT_FOUND` | The derived `OutcomeConfig` account for the runtime ID is missing or cannot be decoded. | Confirm the runtime was initialized by the same program and has not been queried on the wrong cluster. |
| `ERR_RESOLUTION_ACCOUNT_NOT_FOUND` | The derived `OutcomeResolution` account for the runtime ID and resolve ID is missing or cannot be decoded. | Confirm the resolution completed successfully and verify against the same program ID and cluster that produced the signature. |
| `ERR_ARTIFACT_HEADER_NOT_FOUND` | The `ApprovedOutcomeArtifact` header account is missing or cannot be decoded. | Confirm the artifact was committed under the same compiled artifact hash and program ID before the outcome was resolved. |
| `ERR_CONFIG_HASH_MISMATCH` | `OutcomeConfig.compiled_artifact_hash` does not match the hash emitted in the resolution event. | Treat the outcome as unverifiable. Reconcile which artifact was configured for the runtime before resolving another outcome. |
| `ERR_RESOLUTION_HASH_MISMATCH` | `OutcomeResolution` does not match the event hash, runtime ID, or resolve ID. | Check that the verifier is reading the correct accounts for the event. If this persists, do not present the outcome as verified. |
| `ERR_ARTIFACT_HASH_MISMATCH` | The artifact header, reconstructed on-chain blob, or optional local artifact file does not hash to the event's compiled artifact hash. | Use the exact artifact committed before resolution. If a local file was supplied, replace it with the committed artifact or omit the local artifact check. |
| `ERR_ARTIFACT_NOT_FINALIZED` | The approved artifact account exists but was not finalized before verification. | Finalize the artifact before resolving user-facing outcomes. Do not rely on unfinalized rules for public verification. |
| `ERR_ARTIFACT_STATUS_INVALID` | The artifact status does not allow binding. Pending artifacts are allowed only when program config explicitly permits unreviewed binding. | Approve the artifact, use an allowed deprecated artifact, or enable the intended program setting before resolving. |
| `ERR_RANDOMNESS_MISMATCH` | The randomness in the event, resolution account, and verifier recomputation do not agree. | Treat the outcome as invalid. Verify the correct transaction and program ID; if it persists, investigate program/account integrity before another resolve. |
| `ERR_ARTIFACT_FORMAT_VERSION_MISMATCH` | The artifact format version differs between the event, the resolution account and the artifact bytes. | Treat the outcome as unverifiable. Confirm the transaction resolved the artifact you expect. |
| `ERR_WINNER_COUNT_MISMATCH` | The winner count differs between the event, the resolution account, the artifact and the replay. | Treat the outcome as invalid. Check the committed `winners_count` and the resolution transaction. |
| `ERR_WINNER_CLAIM_HASH_MISMATCH` | The recorded winner digest differs from the digest of the replayed winner list (scale snapshot claim, or the on-chain digest of a compact rng_v2 draw). | Treat the displayed winners as unverifiable. Re-check the snapshot or artifact the draw was bound to. |
| `ERR_RNG_V2_EVIDENCE_MISSING` | A `rng_version=2` event is missing stored resolved slots, slot hashes, or optional commit evidence needed for replay. | Treat the outcome as unverifiable. Re-check the program version and resolution account. |
| `ERR_RNG_V2_SNAPSHOT_HASH_MISMATCH` | The RNG v2 snapshot hash differs between the event and committed artifact. | Do not present the result as verified. Reconcile the prepared RNG state and artifact binding. |
| `ERR_RNG_V2_STATE_MISMATCH` | RNG v2 evidence differs between the emitted event and the prepared `RngV2State` account. | Treat the outcome as invalid. Confirm the state PDA, resolution account PDA, and transaction signature match. |
| `ERR_SLOT_RANDOMNESS_MISMATCH` | Slot spin (SF1/format 10): randomness recomputed from the frozen slot-hash evidence differs from the emitted event. | Treat the spin as invalid. Confirm the transaction signature and program ID; the event evidence does not reproduce its own randomness. |
| `ERR_SLOT_REEL_STOPS_MISMATCH` | Slot spin: reel stops replayed from the committed artifact differ from the emitted event. | Treat the spin as invalid. The claimed grid does not follow from the committed game and the on-chain randomness. |
| `ERR_SLOT_WIN_MISMATCH` | Slot spin: the replayed raw win differs from the event's raw win. | Treat the spin as invalid. Paytable evaluation does not reproduce the claimed win. |
| `ERR_SLOT_PAYOUT_MISMATCH` | Slot spin: `min(raw win, max-win cap)` differs from the event's payout. | Treat the spin as invalid. The payout does not match the committed max-win policy. |
| `ERR_RNG_V2_RESOLUTION_MISMATCH` | RNG v2 evidence differs between the emitted event and the `OutcomeResolutionV4` account. | Treat the outcome as invalid. Confirm the resolution account PDA and transaction signature match. |
| `ERR_RNG_V2_OPERATOR_REVEAL_MISMATCH` | Optional RNG v2 operator reveal data is missing or does not hash to the committed value. | Treat the optional salt as invalid and do not claim the outcome is verified. |
| `ERR_CONDITIONS_ENTRANT_COUNT_MISMATCH` | Conditions (fc7): the entrant count in the event differs from the committed artifact. | Treat the ranking as invalid. Confirm the round was resolved against the committed slate. |
| `ERR_CONDITIONS_FACTS_ROOT_MISMATCH` | Conditions: the facts root in the event differs from the replayed facts. | Treat the ranking as invalid. The revealed facts are not the ones the resolution claims. |
| `ERR_CONDITIONS_SCORE_SUM_MISMATCH` | Conditions: the recomputed winning score sum differs from the event. | Treat the ranking as invalid. Scoring does not reproduce the recorded result. |
| `ERR_CONDITIONS_WINNERS_DIGEST_MISMATCH` | Conditions: the recomputed ranking digest differs from the event. | Treat the ranking as invalid. The recorded winners do not follow from the committed slips and facts. |
| `ERR_INPUT_MISMATCH` | Input lamports differ between the event, resolution account, and replay input. | Confirm the transaction belongs to the expected runtime and resolve ID. Do not reuse a signature from a different outcome attempt. |
| `ERR_OUTPUT_MISMATCH` | Output lamports differ between the event, resolution account, and replayed selected outcome. | Check the committed artifact effects and payout config. Re-resolve only after the artifact and runtime config are consistent. |
| `ERR_OUTCOME_ID_MISMATCH` | The outcome ID, outcome ID length, or zero padding differs between the event, resolution account, and replayed selected outcome. | Treat the displayed winner/result as unverifiable. Check the committed artifact ordering and verify the exact transaction signature. |
| `ERR_EFFECTS_DIGEST_MISMATCH` | The effects count or effects digest differs between the event, resolution account, and replayed selected outcome. | Check payout/effect serialization for the committed artifact. Do not claim payout effects are verified until the digest matches. |
| `ERR_REPLAY_UNHANDLED` | The verifier hit an unexpected internal error or unsupported artifact shape while replaying. | Capture the signature, RPC URL, program ID, and verifier version. On the public devnet RPC this can also be a temporary rate limit: retry after 20–30 seconds. If it persists with the latest SDK, report the signature, program ID and verifier version. |

## What MATCH Means

`MATCH / OK` means the verifier completed every check above:

- the transaction was found and its logs were readable
- the expected program emitted the expected outcome event
- all derived on-chain accounts were present and decodable
- the config, resolution, artifact header, and artifact chunks were bound to the same compiled artifact hash
- the artifact was finalized and had a status that allowed binding
- randomness, input, output, outcome ID, and effects digest all matched an independent local replay

It does not mean the operator is trusted. It means the published outcome can be
recomputed from public RPC data and matches the recorded on-chain result.

## Common MISMATCH Causes

1. RPC data is unavailable or incomplete.
   - Typical reason: `ERR_TX_NOT_FOUND_OR_NO_LOGS`.
   - Try a different RPC endpoint for the same cluster.

2. The wrong program ID was used.
   - Typical reason: `ERR_PROGRAM_ID_MISMATCH` or `ERR_EVENT_NOT_FOUND_FOR_PROGRAM`.
   - Pass the program ID that actually resolved the outcome.

3. The artifact being checked is not the committed artifact.
   - Typical reason: `ERR_ARTIFACT_HASH_MISMATCH` or `ERR_ARTIFACT_CHUNK_MISSING`.
   - Use the artifact hash and artifact bytes committed before the draw.

## How To Debug

Verify the signature in one of three ways. All of them run the same replay.

- In a browser: open `https://verifiableoutcome.online/verify?sig=<TX>`.
- Over HTTP:

```bash
curl -s -X POST https://verifiableoutcome.online/api/replay \
  -H "content-type: application/json" \
  -d '{"signature":"<TX>","programId":"<PROGRAM_ID>"}'
```

- From code, with `verifiable-outcome-sdk`:

```js
import { verifyOutcome } from "verifiable-outcome-sdk";
const r = await verifyOutcome({ signature: "<TX>", rpcUrl: "https://api.devnet.solana.com", programId: "<PROGRAM_ID>" });
```

`programId` defaults to the canonical devnet program on the HTTP endpoint and is required only for a custom deployment. The HTTP response carries `verification_result` and `verification_reason`; the SDK returns `status` and `reason`. Start with the reason, then use the table above to find the failed boundary and the next operator action.
