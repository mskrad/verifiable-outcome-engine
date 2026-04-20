# TASK MEMORY: HACKATHON-OPENREPO-001

## Task Card Snapshot

- Problem:
  - The hackathon platform requires a direct GitHub repository link for the hackathon-built code.
  - The current remote points to the monorepo:
    - `https://github.com/mskrad/web3-slot-marketplace`
  - That monorepo is not appropriate as the public hackathon repo because it contains broader slot-marketplace ideas and internal surfaces outside the accepted public export boundary.
- Parent sprint / coordination frame:
  - `HACKATHON-SPRINT-1`
- Scope:
  - Define and execute the extraction of a separate public hackathon repo from the accepted `reference-slot/` surface.
  - Use `reference-slot/OPEN_REPO_MIGRATION.md` as the export contract.
  - Ensure the resulting repo can be used as the direct GitHub repository link for the hackathon submission.
- Out of scope:
  - exporting monorepo-internal folders
  - exposing slot-marketplace work outside the accepted public package
  - runtime redesign
  - replay semantic changes
  - unrelated social posting work
- Acceptance:
  - A separate public repo plan is defined from the frozen export set.
  - The extraction does not include excluded monorepo surfaces.
  - The user can provide a direct GitHub repository URL for the hackathon project.
- Facts:
  - Frozen export contract exists at:
    - `reference-slot/OPEN_REPO_MIGRATION.md`
  - Current origin:
    - `https://github.com/mskrad/web3-slot-marketplace`
  - Target extracted repo URL:
    - `https://github.com/mskrad/verifiable-outcome-engine`
  - Public/export default remains:
    - `reference-slot/` only
- Assumptions:
  - The public repo should be seeded from `reference-slot/`, not from the monorepo root.
- Unknowns:
  - Whether the repo will stay private first or become public immediately after push.
- Confidence:
  - high

## Timeline

### 2026-04-09 12:45:00 +04 - Hub opened bounded public-repo extraction task

- Decision:
  - Opened `HACKATHON-OPENREPO-001` as the next bounded Sprint 1 task.
- Status:
  - Ready for Architect.
- Notes:
  - The new priority is a direct GitHub repo link for the hackathon code.
  - Do not reuse the monorepo root as the public submission repo.
- Confidence:
  - high

### 2026-04-09 13:xx +04 - Target GitHub repo URL confirmed

- Decision:
  - The extracted hackathon repo target is now fixed as:
    - `https://github.com/mskrad/verifiable-outcome-engine`
- Status:
  - Owner/repo path is known for extraction, remote attach, and final submission link shape.
- Notes:
  - This closes the earlier unknown about final repository name and owner path.
  - Remaining operational unknown:
    - private-first vs immediate public visibility
- Confidence:
  - high

## Open Items

- Architect should define the extraction plan and resulting public repo shape.

## Handoff Pointers

- Current state:
  - `agent-instructions/hub-memory/CURRENT_TASK.md`
  - `docs/outcome_runtime/status.md`
- Export contract:
  - `reference-slot/OPEN_REPO_MIGRATION.md`
- Public package:
  - `reference-slot/`

## Default Verdict Format

1. Brief conclusion
2. Main decision / result
3. Alternatives
4. Risks / limitations
5. Confidence level

### 2026-04-09 13:25:00 +04 - Hub close review accepted bounded open-repo task

- Decision:
  - Accepted and closed `HACKATHON-OPENREPO-001`.
- Close basis:
  - separate hackathon repo target is fixed as:
    - `https://github.com/mskrad/verifiable-outcome-engine`
  - monorepo root is explicitly rejected as the submission repo:
    - `https://github.com/mskrad/web3-slot-marketplace`
  - accepted public surface remains bounded to extracted `reference-slot/` only
  - no scope expansion into runtime redesign, replay semantic changes, social posting, or submission-portal actions
- Facts:
  - frozen export contract remains:
    - `reference-slot/OPEN_REPO_MIGRATION.md`
  - local standalone sanity for the extracted line is already reported as passed:
    - `yarn install`
    - `yarn -s replay --help`
    - `yarn web`
- Unknowns:
  - whether the target repo is already created remotely or still needs manual creation/push
  - whether it will stay private temporarily before becoming public for submission
- Final status:
  - Accepted and closed.
- Confidence:
  - high

## Final Status

- Accepted and closed.
