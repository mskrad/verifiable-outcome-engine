# Metaplex Agent Registry Design Note

- Task ID: `HACKATHON-METAPLEX-001`
- Status: Architect decision ready for Engineer
- Date: 2026-04-24

## 1. Context and Problem

VRE needs a minimal sponsor-facing Metaplex Agent Registry integration that registers `VRE Outcome Verification Agent` and points discoverable agent services to the existing VRE verification surfaces.

The integration must not change Rust/Anchor outcome semantics, must not add LLM-dependent verification, and must keep agent token / Genesis and execution delegation out of the MVP.

## 2. Facts

- Official Metaplex docs say `mintAndSubmitAgent` creates a new MPL Core asset and registers an Agent Identity PDA in one atomic flow through the Metaplex API.
- Official Metaplex docs say `registerIdentityV1` attaches an Agent Identity record to an existing MPL Core asset.
- Official Metaplex docs say devnet registration uses `network: "solana-devnet"` with a matching devnet RPC.
- Official Metaplex docs say the Agent Identity program ID is `1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p` on mainnet and devnet.
- Official Metaplex docs say verification should inspect the Core asset `AgentIdentity` plugin and its registration URI / lifecycle hooks.
- VRE already has public verification surfaces:
  - `https://verifiableoutcome.online/verify`
  - `https://verifiableoutcome.online/api/replay`
  - `https://verifiableoutcome.online/play`
- VRE canonical devnet program ID is `9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F`.

Sources:
- https://www.metaplex.com/docs/agents/mint-agent
- https://www.metaplex.com/docs/agents/register-agent
- https://www.metaplex.com/docs/agents/read-agent-data
- https://www.metaplex.com/docs/smart-contracts/mpl-agent/identity

## 3. Assumptions

- Devnet registration is sufficient for hackathon sponsor evidence unless Metaplex explicitly requests mainnet.
- VRE does not already own a suitable MPL Core asset for this agent.
- HTTPS-hosted metadata under `https://verifiableoutcome.online/` is acceptable for the MVP; Arweave/Irys can be a hardening follow-up if sponsor expects permanent storage.
- The Metaplex API accepts custom service names and custom `supportedTrust` string values. If it rejects them, the safe fallback is only `web` services and `supportedTrust: []`.

## 4. Unknowns

- Whether sponsor judging requires mainnet rather than devnet.
- Whether sponsor judging requires Arweave/Irys metadata instead of VRE HTTPS.
- Whether Metaplex discovery/indexing immediately surfaces devnet agents.
- Whether custom service names like `replay-api` are accepted by current Metaplex API validation.

## 5. Options Considered

### Option A: `mintAndSubmitAgent` with VRE-hosted metadata

Create a new MPL Core asset and Agent Identity PDA in one transaction. Host Core asset metadata JSON in `web/public/agents/`, pass VRE service endpoints in `agentMetadata`, and write the resulting asset address/signature to an evidence artifact.

Trade-offs:
- Pros: lowest implementation complexity, no existing Core asset required, atomic agent registration, matches Metaplex "Mint an Agent" path.
- Cons: creates a new asset each run, no deduplication, metadata permanence depends on VRE hosting unless later uploaded to Arweave/Irys.

### Option B: Create/own an MPL Core asset, then call `registerIdentityV1`

Create a Core asset explicitly, then register identity against it with `registerIdentityV1`.

Trade-offs:
- Pros: more direct control over asset creation, collection, and registration URI.
- Cons: more steps, more failure points, not needed because VRE does not already have an asset, and it increases Engineer scope.

### Option C: Register agent plus Genesis token / execution delegation

Register the agent and add a Genesis agent token or executive profile.

Trade-offs:
- Pros: broader Metaplex agent ecosystem story.
- Cons: out of scope for MVP; agent token can be permanent when set, and delegation is not required for deterministic VRE verification.

## 6. Recommended Option

Use Option A: `mintAndSubmitAgent` on Solana devnet.

Decision basis:
- VRE has no existing MPL Core agent asset.
- The MVP only needs discoverability and service links to existing verification surfaces.
- The integration should be additive and must not touch the outcome program or replay semantics.
- `registerIdentityV1` is reserved for a fallback path when VRE already has a Core asset or if the Metaplex API mint flow is unavailable.

## 7. Exact Agent Fields

### Core asset `uri`

Recommended hosted file:

`https://verifiableoutcome.online/agents/vre-outcome-verification-agent.json`

Repo path:

`web/public/agents/vre-outcome-verification-agent.json`

JSON:

```json
{
  "name": "VRE Outcome Verification Agent",
  "symbol": "VREVERIFY",
  "description": "A deterministic Solana outcome verification agent for Verifiable Outcome Engine. It points reviewers to public VRE surfaces that replay outcome transactions from public RPC data and compare the recomputed output with the on-chain record.",
  "image": "https://verifiableoutcome.online/assets/og-image.png",
  "external_url": "https://verifiableoutcome.online/verify",
  "attributes": [
    {
      "trait_type": "Project",
      "value": "Verifiable Outcome Engine"
    },
    {
      "trait_type": "Cluster",
      "value": "Solana devnet"
    },
    {
      "trait_type": "Program ID",
      "value": "9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F"
    },
    {
      "trait_type": "Verification Mode",
      "value": "Deterministic replay"
    },
    {
      "trait_type": "LLM-dependent verification",
      "value": "false"
    }
  ],
  "properties": {
    "category": "agent",
    "files": [
      {
        "uri": "https://verifiableoutcome.online/assets/og-image.png",
        "type": "image/png"
      }
    ],
    "links": {
      "website": "https://verifiableoutcome.online/",
      "verify": "https://verifiableoutcome.online/verify",
      "replayApi": "https://verifiableoutcome.online/api/replay",
      "repository": "https://github.com/mskrad/verifiable-outcome-engine"
    }
  }
}
```

### `mintAndSubmitAgent` input

```ts
{
  wallet: umi.identity.publicKey,
  network: "solana-devnet",
  name: "VRE Outcome Verification Agent",
  uri: "https://verifiableoutcome.online/agents/vre-outcome-verification-agent.json",
  agentMetadata: {
    type: "agent",
    name: "VRE Outcome Verification Agent",
    description:
      "Deterministic Solana outcome verification agent for Verifiable Outcome Engine. Use the web verifier or replay API with a transaction signature to recompute outcome evidence from public RPC data and compare it with the on-chain record. Verification does not depend on LLM judgment.",
    services: [
      {
        name: "web",
        endpoint: "https://verifiableoutcome.online/verify",
        domains: ["solana", "outcome-verification", "replay"]
      },
      {
        name: "web",
        endpoint: "https://verifiableoutcome.online/play",
        domains: ["solana", "demo", "reviewer-flow"]
      },
      {
        name: "replay-api",
        endpoint: "https://verifiableoutcome.online/api/replay",
        domains: ["solana", "api", "verification"]
      },
      {
        name: "repository",
        endpoint: "https://github.com/mskrad/verifiable-outcome-engine",
        domains: ["source", "evidence"]
      }
    ],
    registrations: [],
    supportedTrust: ["deterministic-replay"]
  }
}
```

Fallback if API validation rejects custom fields:

```ts
agentMetadata: {
  type: "agent",
  name: "VRE Outcome Verification Agent",
  description:
    "Deterministic Solana outcome verification agent for Verifiable Outcome Engine. Use the web verifier or replay API with a transaction signature to recompute outcome evidence from public RPC data and compare it with the on-chain record. Verification does not depend on LLM judgment.",
  services: [
    {
      name: "web",
      endpoint: "https://verifiableoutcome.online/verify"
    },
    {
      name: "web",
      endpoint: "https://verifiableoutcome.online/play"
    }
  ],
  registrations: [],
  supportedTrust: []
}
```

## 8. Required Repo Changes

Minimum Engineer scope:

- Add `web/public/agents/vre-outcome-verification-agent.json`.
- Add `scripts/metaplex_register_agent.ts` that:
  - reads a Solana keypair JSON from `METAPLEX_AGENT_WALLET` or `ANCHOR_WALLET`;
  - creates Umi with `METAPLEX_AGENT_RPC_URL` or `https://api.devnet.solana.com`;
  - calls `mintAndSubmitAgent`;
  - prints JSON with asset address, signature, network, metadata URI, and timestamp;
  - optionally verifies the result with `fetchAsset`.
- Add package scripts:
  - `metaplex:agent:mint`
  - `metaplex:agent:verify`
- Add Metaplex SDK dependencies as dev dependencies:
  - `@metaplex-foundation/mpl-agent-registry`
  - `@metaplex-foundation/mpl-core`
  - `@metaplex-foundation/umi`
  - `@metaplex-foundation/umi-bundle-defaults`
- Add `artifacts/metaplex_agent_registry_evidence.json` after real registration.
- Add short demo copy to `README.md` and/or `DEMO_RUNBOOK.md` after evidence exists.

No changes:
- `programs/outcome/`
- `sdk/verify.ts`
- `/api/replay` semantics
- LLM runtime or judgement path
- Genesis token or execution delegation

## 9. Commands, Env, Wallet Requirements

Before on-chain execution, verify RPC:

```bash
cd /Users/timurkurmangaliev/verifiable-outcome-engine
solana program show 1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p --url https://api.devnet.solana.com
```

Install dependencies:

```bash
cd /Users/timurkurmangaliev/verifiable-outcome-engine
yarn add -D @metaplex-foundation/mpl-agent-registry @metaplex-foundation/mpl-core @metaplex-foundation/umi @metaplex-foundation/umi-bundle-defaults
```

Required env:

```bash
cd /Users/timurkurmangaliev/verifiable-outcome-engine
export METAPLEX_AGENT_RPC_URL=https://api.devnet.solana.com
export METAPLEX_AGENT_NETWORK=solana-devnet
export METAPLEX_AGENT_WALLET=$HOME/.config/solana/esjx.json
export METAPLEX_AGENT_URI=https://verifiableoutcome.online/agents/vre-outcome-verification-agent.json
```

Wallet requirements:
- funded Solana devnet keypair;
- keypair owner becomes the agent asset owner;
- do not use production/mainnet wallet for devnet MVP;
- do not reuse this flow for mainnet without Hub decision.

Expected run commands after Engineer adds scripts:

```bash
yarn -s metaplex:agent:mint
```

```bash
yarn -s metaplex:agent:verify --asset <AGENT_ASSET_ADDRESS>
```

VRE verify evidence command:

```bash
curl -fsS https://verifiableoutcome.online/api/replay \
  -H 'content-type: application/json' \
  --data '{"signature":"5wZUU5YQ8Nu5RddNeEEigYUEM5Q45C2SJmwLgdLhQcLQi4S3vYhAUvLc6YchYnxqU5b1pvEsBSD1USZPPDEaRVd2"}'
```

## 10. Verification Evidence Required

Engineer must produce `artifacts/metaplex_agent_registry_evidence.json` with:

```json
{
  "task_id": "HACKATHON-METAPLEX-001",
  "network": "solana-devnet",
  "agent_name": "VRE Outcome Verification Agent",
  "agent_asset_address": "<asset address>",
  "agent_identity_program_id": "1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p",
  "mint_transaction_signature": "<signature>",
  "registration_uri": "https://verifiableoutcome.online/agents/vre-outcome-verification-agent.json",
  "agent_identity_plugin": {
    "present": true,
    "uri": "https://verifiableoutcome.online/agents/vre-outcome-verification-agent.json",
    "lifecycle_checks": {
      "transfer": true,
      "update": true,
      "execute": true
    }
  },
  "service_checks": [
    {
      "name": "web",
      "endpoint": "https://verifiableoutcome.online/verify",
      "status": "reachable"
    },
    {
      "name": "replay-api",
      "endpoint": "https://verifiableoutcome.online/api/replay",
      "status": "MATCH/OK for blessed signature"
    }
  ],
  "vre_program_id": "9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F",
  "verified_at": "<ISO-8601 timestamp>"
}
```

Verification checklist:

- agent asset address recorded;
- mint/register transaction signature recorded;
- `fetchAsset` shows `assetData.agentIdentities?.[0]`;
- AgentIdentity URI equals the hosted VRE metadata URI;
- lifecycle checks for `transfer`, `update`, and `execute` are present/truthy;
- registration URI returns HTTP 200 and valid JSON;
- `https://verifiableoutcome.online/verify?sig=<blessed_sig>` loads;
- `/api/replay` returns `MATCH / OK` for a blessed signature.

## 11. Failure Modes and Rollback

- Duplicate mint: `mintAndSubmitAgent` has no deduplication. Mitigation: script should refuse to mint if `artifacts/metaplex_agent_registry_evidence.json` already has an asset address unless `--force` is passed.
- API validation rejects custom service/trust values. Mitigation: fallback to only `web` services and `supportedTrust: []`.
- VRE HTTPS metadata is unavailable. Mitigation: test URL before mint; follow-up can move metadata to Arweave/Irys.
- Devnet RPC unavailable. Mitigation: check RPC before on-chain execution and fail before signing.
- Wrong wallet owns agent. Mitigation: print owner pubkey before mint and require explicit `--yes`.

Rollback:
- On-chain agent registration cannot be deleted by repo rollback.
- Repo rollback can remove demo copy and evidence references.
- If a wrong devnet asset is minted, mark it superseded in evidence and mint a new one after Hub approval.

## 12. Test Strategy Requirements

Engineer local/static checks:

```bash
node --check web/server.mjs
npx tsc --noEmit
git diff --check
```

Metaplex checks:

```bash
solana program show 1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p --url https://api.devnet.solana.com
yarn -s metaplex:agent:mint
yarn -s metaplex:agent:verify --asset <AGENT_ASSET_ADDRESS>
```

VRE checks:

```bash
yarn -s replay \
  --sig 5wZUU5YQ8Nu5RddNeEEigYUEM5Q45C2SJmwLgdLhQcLQi4S3vYhAUvLc6YchYnxqU5b1pvEsBSD1USZPPDEaRVd2 \
  --url https://api.devnet.solana.com \
  --program-id 9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F
```

## 13. Acceptance Mapping

- 2-3 options: Options A, B, C.
- Recommended path: Option A, `mintAndSubmitAgent`.
- `mintAndSubmitAgent` vs `registerIdentityV1`: use `mintAndSubmitAgent`; `registerIdentityV1` only for existing Core asset fallback.
- Exact metadata/service fields: section 7.
- Repo changes: section 8.
- Commands/env/wallet requirements: section 9.
- Verification evidence: section 10.
- Go/no-go: GO for Engineer with devnet-only scope.

## 14. Go / No-Go

GO for Engineer.

Safest default:
- devnet only;
- no agent token;
- no execution delegation;
- no Rust/Anchor changes;
- VRE-hosted metadata first;
- fallback to minimal `web` services if Metaplex API validation rejects custom service names.

Confidence: medium.
