# Task: HACKATHON-DEPLOY-001

**Title:** Public web deploy - make Sprint 2 reviewer flow shareable

**Parent Sprint:** HACKATHON-SPRINT-2 (Apr 12-18)
**Priority:** High
**Status:** Ready for Hub acceptance
**Owner:** Deployment
**Reviewer:** Hub

---

## Scope

Deploy the reviewer-facing VRE web flow to a public HTTPS domain so judges can verify the engine without local setup.

In scope:
- Serve `web/server.mjs` behind nginx/systemd on VPS.
- Route `https://verifiableoutcome.online/` to the web app.
- Keep `/api/health`, `/api/replay`, and `/api/timeline` operational.
- Ensure certificate renewal works.

Out of scope:
- Runtime redesign.
- New on-chain transactions.
- Manual server edits as long-term source of truth. Server changes must come through git.

---

## Evidence - 2026-04-15 19:01:44 +0300

Public URL:
- `https://verifiableoutcome.online/`

Verified endpoints:
- `GET /` returned HTTP `200`.
- `GET /api/health` returned `ok:true`, canonical devnet program id `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`, and `blessed_signatures_count:3`.
- `POST /api/replay` for blessed signature `mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh` returned `MATCH / OK`.
- `POST /api/timeline` for the same signature returned `artifact_slot:455663125`, `resolution_slot:455693113`, `gap_slots:29988`.
- `certbot renew --dry-run -v` succeeded on VPS after DNS/nginx correction.

Deployed engine binding:
- `GET /play.html` shows blessed signatures.
- `GET /verify.html` calls `/api/replay`.
- `/api/replay` executes the replay verifier against devnet and canonical program id.
- `/api/timeline` independently proves `artifact_slot < resolution_slot`.

---

## Remaining Work

- Update public docs with `https://verifiableoutcome.online/` as the click-to-verify link.
- Add a short Sprint 2 wrap-up note: real artifact, config engine, timeline, Explorer links, public deploy.
- Start Sprint 3 developer story: `INTEGRATION.md`, second use case narrative, and developer-facing engine flow.

---

## Handoff Prompt

```
You are Hub for Verifiable Outcome Engine. Accept HACKATHON-DEPLOY-001 if the public URL and endpoints still pass.

Verify:
- https://verifiableoutcome.online/
- GET /api/health
- POST /api/replay with blessed signature
- POST /api/timeline with blessed signature
- certbot renew evidence is recorded

Then:
- Update README/RUNBOOK/DEMO_RUNBOOK with the public click-to-verify URL if missing.
- Mark Sprint 2 WS-4 public deploy as accepted.
- Open Sprint 3 developer story task for INTEGRATION.md and public engine integration flow.
```
