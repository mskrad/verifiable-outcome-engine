/* ================================================================
   VRE — Verification UI
   Uses the repository API endpoints:
   POST /api/replay + POST /api/timeline.
   ================================================================ */

(function () {
  'use strict';

  const DEFAULT_RPC = 'https://api.devnet.solana.com';
  const DEFAULT_PROGRAM_ID = '6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B';
  const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const LAST_MATCH_STORAGE_KEY = 'vre:last-match-verify';

  let lastVerifyResult = null;
  let walletState = { status: 'not-connected' };

  function el(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function inferCluster(url) {
    if (/devnet/i.test(url)) return 'devnet';
    if (/testnet/i.test(url)) return 'testnet';
    if (/localhost|127\.0\.0\.1/.test(url)) return 'localnet';
    if (/mainnet/i.test(url)) return 'mainnet-beta';
    return 'custom';
  }

  async function postJson(path, payload) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || `${path} failed`);
    return json;
  }

  async function fetchTimeline({ signature, rpcUrl, programId, compiledArtifactHash }) {
    if (!compiledArtifactHash) return null;
    try {
      const json = await postJson('/api/timeline', {
        signature,
        rpc: rpcUrl,
        programId,
        compiledArtifactHash,
      });
      return json.ok ? json : null;
    } catch (_) {
      return null;
    }
  }

  async function verify({ rpcUrl, programId, signature }) {
    const t0 = performance.now();
    const replayJson = await postJson('/api/replay', {
      signature,
      rpc: rpcUrl,
      programId,
    });
    const replay = replayJson.replay || {};
    const timeline = await fetchTimeline({
      signature,
      rpcUrl,
      programId,
      compiledArtifactHash: replay.compiled_artifact_hash,
    });

    return {
      status: replay.verification_result || 'ERROR',
      code: replay.verification_reason || 'ERR_REPLAY_UNHANDLED',
      message: messageFor(replay),
      elapsedMs: Math.round(performance.now() - t0),
      signature,
      cluster: inferCluster(rpcUrl),
      programId,
      rpcUrl,
      replay,
      timeline,
      resolveSlot: timeline?.resolution_slot ?? null,
      commitSlot: timeline?.artifact_slot ?? null,
      gapSlots: timeline?.gap_slots ?? null,
      artifactHash: replay.compiled_artifact_hash || null,
      outcomeId: replay.outcome_id || null,
      outcomeIds: Array.isArray(replay.outcome_ids) ? replay.outcome_ids : [],
      outcomes: Array.isArray(replay.outcomes) ? replay.outcomes : [],
    };
  }

  function messageFor(replay) {
    if (replay.verification_result === 'MATCH') {
      return 'Outcome replayed successfully — computation matches on-chain record.';
    }
    return 'Replay result does not match on-chain record.';
  }

  function errorResult(code, message, extra = {}) {
    return {
      status: 'ERROR',
      code,
      message,
      outcomes: [],
      outcomeIds: [],
      replay: {},
      timeline: null,
      ...extra,
    };
  }

  function looksLikeSolanaAddress(value) {
    return SOLANA_ADDRESS_RE.test(String(value || '').trim());
  }

  function hasAddressOutcomes(r) {
    const ids = (Array.isArray(r?.outcomes) ? r.outcomes : [])
      .map((outcome) => String(outcome?.id || '').trim())
      .filter(Boolean);
    return ids.length > 0 && ids.every(looksLikeSolanaAddress);
  }

  function selectedOutcomeIds(r) {
    const ids = (Array.isArray(r?.outcomeIds) ? r.outcomeIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    if (ids.length) return ids;
    return r?.outcomeId ? [String(r.outcomeId).trim()] : [];
  }

  function didIWin(address, r) {
    if (!hasAddressOutcomes(r)) return 'not-applicable';
    const candidate = String(address || '').trim();
    const winners = new Set(selectedOutcomeIds(r));
    const ids = new Set((r.outcomes || []).map((outcome) => String(outcome?.id || '').trim()));
    if (candidate && winners.has(candidate)) return 'won';
    if (candidate && ids.has(candidate)) return 'in-draw-not-selected';
    return 'not-in-draw';
  }

  function persistLastMatch(r) {
    if (r.status !== 'MATCH') return;
    try {
      localStorage.setItem(LAST_MATCH_STORAGE_KEY, JSON.stringify({
        signature: r.signature,
        rpcUrl: r.rpcUrl,
        programId: r.programId,
        cluster: r.cluster,
        verifiedAt: new Date().toISOString(),
      }));
    } catch (_) {}
  }

  function renderResult(r) {
    lastVerifyResult = r;
    persistLastMatch(r);
    const banner = el('result-banner');
    const details = el('result-details');
    const raw = el('result-raw');
    const isMatch = r.status === 'MATCH';
    const isMismatch = r.status === 'MISMATCH' || r.status === 'ERROR';
    const statusClass = isMatch ? 'result-banner-match' : 'result-banner-mismatch';
    const statusIcon = isMatch ? '✓' : '✕';
    const message = isMismatch
      ? `${escapeHtml(r.message)} <a class="text-teal" href="/spec#verification">See reason codes →</a>`
      : escapeHtml(r.message);

    banner.classList.remove('hidden');
    details.classList.add('hidden');
    banner.className = `result-banner ${statusClass}`;
    banner.innerHTML = `
      <div class="result-banner-icon">${statusIcon}</div>
      <div class="result-banner-body">
        <h3>${escapeHtml(r.status)} / ${escapeHtml(r.code)}</h3>
        <p>${message}</p>
        ${r.elapsedMs != null ? `<p class="text-faint mt-2" style="font-size:12px;">Verified in ${r.elapsedMs} ms against <span class="mono">${escapeHtml(r.cluster || 'custom RPC')}</span></p>` : ''}
      </div>
    `;

    if (isMatch || r.status === 'MISMATCH') {
      renderDetails(r);
      details.classList.remove('hidden');
    } else {
      details.innerHTML = '';
    }

    raw.innerHTML = window.vrePrettyJson(sanitizeRaw(r));
    el('result-raw-wrap').classList.remove('hidden');
    banner.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function sanitizeRaw(r) {
    return {
      status: r.status,
      code: r.code,
      signature: r.signature,
      cluster: r.cluster,
      programId: r.programId,
      commitSlot: r.commitSlot,
      resolveSlot: r.resolveSlot,
      gapSlots: r.gapSlots,
      artifactHash: r.artifactHash,
      outcomeId: r.outcomeId,
      outcomeIds: r.outcomeIds,
      outcomes: r.outcomes,
      replay: r.replay,
      timeline: r.timeline,
    };
  }

  function artifactFormatVersion(r) {
    return Number(r?.replay?.artifact_format_version || r?.replay?.artifactFormatVersion || 0);
  }

  function resolutionFormula(r) {
    return String(r?.replay?.resolution_formula || '').trim();
  }

  function resolutionTarget(r) {
    return r?.replay?.target;
  }

  function showResolutionTarget(r) {
    return resolutionFormula(r) === 'closest_to' && resolutionTarget(r) !== undefined;
  }

  function committedWinnerCount(r) {
    const explicit = Number(r?.replay?.winners_count || r?.replay?.winnerCount || 0);
    if (explicit > 0) return explicit;
    const selected = selectedOutcomeIds(r).length;
    return selected > 0 ? selected : 1;
  }

  function hasFormulaScores(r) {
    return (r.outcomes || []).some((outcome) => outcome?.score !== undefined || outcome?.order !== undefined);
  }

  function renderDetails(r) {
    const details = el('result-details');
    details.innerHTML = renderOutcome(r) + renderSnapshot(r) + renderDidIWin(r) + renderRules(r) + renderTimeline(r) + renderLinks(r);
    bindTimelineReload();
  }

  function renderOutcome(r) {
    const winners = selectedOutcomeIds(r);
    if (!winners.length) return '';
    const isMulti = winners.length > 1;
    const formatVersion = artifactFormatVersion(r);
    const formula = resolutionFormula(r);
    const target = resolutionTarget(r);
    const winnersCount = committedWinnerCount(r);
    return `
      <div class="result-section">
        <div class="result-section-title">${isMulti ? 'Selected Winners' : 'Selected Outcome'}</div>
        <div class="outcome-selected">
          <div>
            <div class="outcome-id text-faint mb-2">${isMulti ? 'outcome_ids' : 'outcome_id'}</div>
            ${isMulti ? `
              <div class="winner-list">
                ${winners.map((id, index) => `
                  <div class="winner-row">
                    <span class="winner-index">${index + 1}</span>
                    <span class="winner-address">${escapeHtml(id)}</span>
                  </div>
                `).join('')}
              </div>
            ` : `<div class="outcome-winner">${escapeHtml(winners[0])}</div>`}
          </div>
          <div class="badge ${r.status === 'MATCH' ? 'badge-match' : 'badge-mismatch'}">
            ${r.status === 'MATCH' ? '✓ replay matches' : '✕ replay diverges'}
          </div>
        </div>
        <div class="artifact-summary">
          ${formatVersion > 0 ? `<span class="badge badge-neutral">W3O1 v${formatVersion}</span>` : ''}
          ${formula ? `<span class="badge badge-neutral">${escapeHtml(formula)}</span>` : ''}
          ${winnersCount > 1 ? `<span class="badge badge-neutral">${winnersCount} winners</span>` : ''}
          ${showResolutionTarget(r) ? `<span class="badge badge-neutral">target ${escapeHtml(String(target))}</span>` : ''}
        </div>
      </div>
    `;
  }

  // ---- Snapshot draws: the participant list lives off-chain, committed by hash and Merkle root ----

  const HEX64_RE = /^[0-9a-f]{64}$/;
  const SNAPSHOT_URI_GATEWAYS = {
    'irys-devnet:': 'https://devnet.irys.xyz/',
    'irys:': 'https://gateway.irys.xyz/',
    'ar:': 'https://arweave.net/',
  };

  function snapshotInfo(r) {
    const replay = r?.replay || {};
    const hash = String(replay.snapshot_hash || '').toLowerCase();
    if (r?.status !== 'MATCH' || !HEX64_RE.test(hash)) return null;
    return {
      hash,
      count: Number(replay.snapshot_count || 0),
      uri: String(replay.snapshot_uri || ''),
      merkleRoot: HEX64_RE.test(String(replay.merkle_root || '').toLowerCase()) ? String(replay.merkle_root).toLowerCase() : null,
      formula: resolutionFormula(r),
    };
  }

  function snapshotSourceUrl(uri) {
    if (/^https:\/\//i.test(uri)) return uri;
    const match = /^([a-z][a-z0-9-]*:)\/\/([A-Za-z0-9_-]+)$/.exec(uri);
    if (!match || !SNAPSHOT_URI_GATEWAYS[match[1]]) return null;
    return SNAPSHOT_URI_GATEWAYS[match[1]] + match[2];
  }

  // Irys devnet has no explorer page for uploads; its /tx/<id> JSON names the uploader, the tags
  // (including VRE-Snapshot-SHA256) and the size.
  function snapshotReceiptUrl(uri) {
    const match = /^irys-devnet:\/\/([A-Za-z0-9_-]+)$/.exec(uri);
    return match ? `https://devnet.irys.xyz/tx/${match[1]}` : null;
  }

  function renderSnapshot(r) {
    const info = snapshotInfo(r);
    if (!info) return '';
    const sourceUrl = snapshotSourceUrl(info.uri);
    const receiptUrl = snapshotReceiptUrl(info.uri);
    const address = walletState?.status === 'connected' ? walletState.address : '';
    return `
      <div class="result-section snapshot-card">
        <div class="section-head-with-action">
          <div class="result-section-title">Participant snapshot</div>
          <div class="artifact-summary artifact-summary-inline">
            ${info.count > 0 ? `<span class="badge badge-neutral">${escapeHtml(info.count.toLocaleString('en-US'))} participants</span>` : ''}
            ${info.merkleRoot ? '<span class="badge badge-neutral">Merkle root on-chain</span>' : ''}
          </div>
        </div>
        <dl class="snapshot-facts">
          <dt>snapshot_hash</dt><dd class="mono">${escapeHtml(info.hash)}</dd>
          ${info.merkleRoot ? `<dt>merkle_root</dt><dd class="mono">${escapeHtml(info.merkleRoot)}</dd>` : ''}
          <dt>snapshot_uri</dt><dd class="mono">${escapeHtml(info.uri || '—')}</dd>
        </dl>
        <p class="pre-proof-caption">The replay above fetched this list and matched it to <span class="mono">snapshot_hash</span> before recomputing the winners.</p>
        <div class="flex gap-2 mt-4" style="flex-wrap:wrap;">
          <a class="btn btn-secondary btn-sm" href="/sha256/${info.hash}.jsonl" download="snapshot-${info.hash.slice(0, 12)}.jsonl">Download list (.jsonl)</a>
          ${receiptUrl ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(receiptUrl)}" target="_blank" rel="noopener">Irys receipt ↗</a>` : ''}
          ${sourceUrl ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">Raw file ↗</a>` : ''}
        </div>
        ${info.merkleRoot ? `
          <form class="snapshot-check" data-snapshot-check autocomplete="off">
            <label class="form-label" for="snapshot-address">Check a participant</label>
            <div class="snapshot-check-row">
              <input id="snapshot-address" name="address" class="form-input mono" placeholder="participant id or wallet address" spellcheck="false" value="${escapeHtml(address)}" />
              <button class="btn btn-primary btn-sm" type="submit">Check</button>
            </div>
          </form>
          <div id="snapshot-check-result" aria-live="polite"></div>
        ` : ''}
      </div>
    `;
  }

  async function sha256Bytes(bytes) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  }

  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Same canonical line as canonicalSnapshotLine() in the SDK.
  function canonicalSnapshotLine(participant, formula) {
    if (formula === 'weighted_random') {
      return `${JSON.stringify({ id: participant.id, order: participant.order, weight: participant.weight ?? 1 })}\n`;
    }
    if (formula === 'first_n') {
      return `${JSON.stringify({ id: participant.id, order: participant.order })}\n`;
    }
    return `${JSON.stringify({ id: participant.id, order: participant.order, score: String(participant.score) })}\n`;
  }

  // Leaf = SHA-256(SHA-256(line)); each proof step hashes the sibling on its stated side.
  async function merkleRootFromProof(line, proof) {
    let node = await sha256Bytes(await sha256Bytes(new TextEncoder().encode(line)));
    for (const step of proof) {
      if (!step || (step.position !== 'left' && step.position !== 'right') || !HEX64_RE.test(String(step.sibling).toLowerCase())) {
        throw new Error('malformed proof');
      }
      const sibling = hexToBytes(String(step.sibling).toLowerCase());
      const joined = new Uint8Array(64);
      joined.set(step.position === 'left' ? sibling : node, 0);
      joined.set(step.position === 'left' ? node : sibling, 32);
      node = await sha256Bytes(joined);
    }
    return bytesToHex(node);
  }

  function renderSnapshotCheck(state) {
    const target = el('snapshot-check-result');
    if (!target) return;
    if (state.kind === 'loading') {
      target.innerHTML = '<div class="did-win-status did-win-status-muted">Fetching the proof…</div>';
      return;
    }
    if (state.kind === 'error') {
      target.innerHTML = `<div class="did-win-status did-win-status-warn">${escapeHtml(state.message)}</div>`;
      return;
    }
    const titles = {
      won: 'Selected as a winner',
      included: 'In the list — not selected',
      absent: 'Not in the committed list',
    };
    const modifier = state.kind === 'won' ? 'did-win-status-won' : 'did-win-status-muted';
    const copy = state.kind === 'absent'
      ? 'This server has no entry with that id in the committed list.'
      : 'Merkle proof checked in your browser against the on-chain root.';
    target.innerHTML = `
      <div class="did-win-status ${modifier}">
        <strong>${escapeHtml(titles[state.kind])}</strong>
        <span>${escapeHtml(copy)}</span>
        ${state.download ? '<span><button class="btn btn-ghost btn-sm" type="button" data-snapshot-proof-download>Download proof (.json)</button></span>' : ''}
      </div>
    `;
  }

  let lastSnapshotProof = null;

  async function runSnapshotCheck(address) {
    const r = lastVerifyResult;
    const info = snapshotInfo(r);
    if (!info || !info.merkleRoot) return;
    const id = String(address || '').trim();
    if (!id) {
      renderSnapshotCheck({ kind: 'error', message: 'Enter a participant id or wallet address.' });
      return;
    }
    lastSnapshotProof = null;
    renderSnapshotCheck({ kind: 'loading' });
    try {
      const res = await fetch(`/api/partner/draw/${encodeURIComponent(r.signature)}/proof?address=${encodeURIComponent(id)}`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 404) {
        renderSnapshotCheck({ kind: 'error', message: 'This server keeps no proof index for this draw. Download the list and check it with verifySnapshotMerkleProof from verifiable-outcome-sdk.' });
        return;
      }
      if (!res.ok || !json.ok) throw new Error(json.error || `proof request failed (${res.status})`);
      if (!json.participant) {
        renderSnapshotCheck({ kind: 'absent' });
        return;
      }
      const line = canonicalSnapshotLine(json.participant, info.formula);
      const root = await merkleRootFromProof(line, Array.isArray(json.proof) ? json.proof : []);
      if (root !== info.merkleRoot) {
        renderSnapshotCheck({ kind: 'error', message: 'The proof does not lead to the on-chain Merkle root. Do not trust this answer.' });
        return;
      }
      lastSnapshotProof = {
        signature: r.signature,
        program_id: r.programId,
        merkle_root: info.merkleRoot,
        snapshot_hash: info.hash,
        formula: info.formula,
        participant: json.participant,
        line,
        proof: json.proof,
      };
      const won = selectedOutcomeIds(r).includes(String(json.participant.id));
      renderSnapshotCheck({ kind: won ? 'won' : 'included', download: true });
    } catch (err) {
      renderSnapshotCheck({ kind: 'error', message: err?.message || String(err) });
    }
  }

  function downloadSnapshotProof() {
    if (!lastSnapshotProof) return;
    const blob = new Blob([`${JSON.stringify(lastSnapshotProof, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `proof-${String(lastSnapshotProof.participant.id).slice(0, 16).replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderDidIWin(r) {
    if (r.status !== 'MATCH' || !hasAddressOutcomes(r)) return '';

    const state = walletState || { status: 'not-connected' };
    if (state.status === 'not-installed') {
      return `
        <div class="result-section did-win-card">
          <div class="did-win-head">
            <div>
              <div class="result-section-title">Did I win?</div>
              <p class="did-win-copy">Connect a wallet to compare your address with the selected winner list.</p>
            </div>
          </div>
          <div class="did-win-status did-win-status-warn">
            No Solana wallet detected. Any wallet works —
            <a class="text-teal" href="https://phantom.app/" target="_blank" rel="noopener">Phantom</a>,
            <a class="text-teal" href="https://solflare.com/" target="_blank" rel="noopener">Solflare</a>,
            <a class="text-teal" href="https://backpack.app/" target="_blank" rel="noopener">Backpack</a>.
          </div>
        </div>
      `;
    }

    if (state.status !== 'connected') {
      // One wallet connects on click; several get named buttons so the user picks
      // the one they actually hold the address in.
      const wallets = window.vreWallet?.listWallets?.() || [];
      const buttons = wallets.length > 1
        ? wallets.map((wallet) => `
            <button class="btn btn-secondary btn-sm" type="button" data-connect-wallet="${escapeHtml(wallet.name)}">
              ${wallet.icon ? `<img src="${escapeHtml(wallet.icon)}" alt="" width="16" height="16" style="vertical-align:-3px;margin-right:6px;border-radius:4px;" />` : ''}${escapeHtml(wallet.name)}
            </button>`).join('')
        : '<button class="btn btn-secondary btn-sm" type="button" data-connect-wallet>Connect wallet</button>';
      return `
        <div class="result-section did-win-card">
          <div class="did-win-head">
            <div>
              <div class="result-section-title">Did I win?</div>
              <p class="did-win-copy">Connect a wallet to compare your address with the selected winner list.</p>
            </div>
            <div class="flex gap-2" style="flex-wrap:wrap;">${buttons}</div>
          </div>
          <div class="did-win-status did-win-status-muted">Read-only wallet check. No transaction signing.</div>
        </div>
      `;
    }

    const result = didIWin(state.address, r);
    const labels = {
      won: ['🎉 You won!', 'Your connected address was selected.'],
      'in-draw-not-selected': ['You were in this draw — not selected', 'Your address was eligible, but another outcome was selected.'],
      'not-in-draw': ['Your address was not in this draw', 'This wallet address is not in the committed outcome list.'],
    };
    const [title, copy] = labels[result] || labels['not-in-draw'];
    const modifier = result === 'won' ? 'did-win-status-won' : 'did-win-status-muted';

    return `
      <div class="result-section did-win-card">
        <div class="did-win-head">
          <div>
            <div class="result-section-title">Did I win?</div>
            <p class="did-win-copy">Connected: <span class="wallet-pill">${escapeHtml(state.shortAddress || window.vreWallet?.shortAddress?.(state.address) || state.address)}</span>${state.wallet ? ` · ${escapeHtml(state.wallet)}` : ''}</p>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" data-disconnect-wallet>Disconnect</button>
        </div>
        <div class="did-win-status ${modifier}">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(copy)}</span>
        </div>
      </div>
    `;
  }

  function renderRules(r) {
    if (!r.outcomes.length) return '';
    const winners = new Set(selectedOutcomeIds(r));
    const showFormulaColumns = hasFormulaScores(r);
    const formatVersion = artifactFormatVersion(r);
    const formula = resolutionFormula(r);
    const target = resolutionTarget(r);
    const rows = r.outcomes.map((outcome) => {
      const id = String(outcome.id ?? '');
      const isWinner = winners.has(id);
      return `<tr class="${isWinner ? 'winner' : ''}">
        <td>${escapeHtml(id)}</td>
        <td>${escapeHtml(String(outcome.weight ?? '—'))}</td>
        ${showFormulaColumns ? `<td>${escapeHtml(String(outcome.score ?? '—'))}</td>` : ''}
        ${showFormulaColumns ? `<td>${escapeHtml(String(outcome.order ?? '—'))}</td>` : ''}
        <td>${isWinner ? '← selected' : ''}</td>
      </tr>`;
    }).join('');

    return `
      <div class="result-section">
        <div class="section-head-with-action">
          <div class="result-section-title">Committed W3O1 Rules</div>
          <div class="artifact-summary artifact-summary-inline">
            ${formatVersion > 0 ? `<span class="badge badge-neutral">W3O1 v${formatVersion}</span>` : ''}
            ${formula ? `<span class="badge badge-neutral">${escapeHtml(formula)}</span>` : ''}
            ${showResolutionTarget(r) ? `<span class="badge badge-neutral">target ${escapeHtml(String(target))}</span>` : ''}
          </div>
        </div>
        <table class="rules-table">
          <thead>
            <tr>
              <th>Outcome</th>
              <th>Weight</th>
              ${showFormulaColumns ? '<th>Score</th>' : ''}
              ${showFormulaColumns ? '<th>Order</th>' : ''}
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function renderTimeline(r) {
    if (r.status !== 'MATCH') return '';
    const commitSlot = r.commitSlot;
    const resolveSlot = r.resolveSlot;
    const delta = r.gapSlots;
    const noData = commitSlot == null || resolveSlot == null;
    return `
      <div class="result-section" id="timeline-section">
        <div class="result-section-title">Pre-commitment Timeline</div>
        ${noData ? `
          <div class="pre-proof-caption" id="timeline-pending">
            Timeline not yet available.
            <button class="btn btn-ghost btn-sm" id="reload-timeline-btn"
              data-sig="${escapeHtml(r.signature)}"
              data-rpc="${escapeHtml(r.rpcUrl)}"
              data-program="${escapeHtml(r.programId)}"
              data-hash="${escapeHtml(r.artifactHash || '')}">
              Reload →
            </button>
          </div>
        ` : `
          <div class="timeline-row">
            <div class="timeline-stop">
              <span class="timeline-stop-label">Rules committed</span>
              <span class="timeline-stop-value">slot ${commitSlot}</span>
            </div>
            <div class="timeline-arrow">→</div>
            <div class="timeline-stop">
              <span class="timeline-stop-label">Outcome drawn</span>
              <span class="timeline-stop-value">slot ${resolveSlot}</span>
            </div>
          </div>
          <div class="pre-proof-caption">Rules were committed on-chain <strong>${delta} slot${delta === 1 ? '' : 's'}</strong> before the outcome was drawn.</div>
        `}
      </div>
    `;
  }

  function bindTimelineReload() {
    const btn = document.getElementById('reload-timeline-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.textContent = 'Loading…';
      btn.disabled = true;
      try {
        const result = await fetchTimeline({
          signature: btn.dataset.sig,
          rpcUrl: btn.dataset.rpc,
          programId: btn.dataset.program,
          compiledArtifactHash: btn.dataset.hash,
        });
        if (result && result.artifact_slot != null) {
          const section = document.getElementById('timeline-section');
          const delta = result.gap_slots;
          section.innerHTML = `
            <div class="result-section-title">Pre-commitment Timeline</div>
            <div class="timeline-row">
              <div class="timeline-stop">
                <span class="timeline-stop-label">Rules committed</span>
                <span class="timeline-stop-value">slot ${result.artifact_slot}</span>
              </div>
              <div class="timeline-arrow">→</div>
              <div class="timeline-stop">
                <span class="timeline-stop-label">Outcome drawn</span>
                <span class="timeline-stop-value">slot ${result.resolution_slot}</span>
              </div>
            </div>
            <div class="pre-proof-caption">Rules were committed on-chain <strong>${delta} slot${delta === 1 ? '' : 's'}</strong> before the outcome was drawn.</div>
          `;
        } else {
          btn.textContent = 'Retry →';
          btn.disabled = false;
        }
      } catch (_) {
        btn.textContent = 'Retry →';
        btn.disabled = false;
      }
    });
  }

  function renderLinks(r) {
    return `
      <div class="mt-6 flex gap-3">
        <a class="btn btn-secondary btn-sm" href="${buildExplorerUrl(r.signature, r.cluster)}" target="_blank" rel="noopener">
          View on Solana Explorer ↗
        </a>
        <button class="btn btn-ghost btn-sm" data-copy="${escapeHtml(r.signature)}">Copy signature</button>
      </div>
    `;
  }

  function buildExplorerUrl(sig, cluster) {
    const c = cluster && cluster !== 'mainnet-beta' ? `?cluster=${cluster}` : '';
    return `https://explorer.solana.com/tx/${sig}${c}`;
  }

  function runFromForm() {
    const rpcUrl = el('field-rpc').value.trim() || DEFAULT_RPC;
    const programId = el('field-program').value.trim() || DEFAULT_PROGRAM_ID;
    const signature = el('field-sig').value.trim();

    if (!signature) {
      window.vreToast('Please paste a transaction signature');
      el('field-sig').focus();
      return;
    }

    const btn = el('btn-verify');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Verifying…';
    lastVerifyResult = null;

    el('result-banner').classList.add('hidden');
    el('result-details').classList.add('hidden');
    el('result-raw-wrap').classList.add('hidden');

    verify({ rpcUrl, programId, signature })
      .then(renderResult)
      .catch((err) => {
        renderResult(errorResult('ERR_REPLAY_UNHANDLED', err.message || String(err), {
          signature,
          cluster: inferCluster(rpcUrl),
          programId,
          rpcUrl,
        }));
      })
      .finally(() => {
        btn.disabled = false;
        btn.innerHTML = original;
      });
  }

  function onReady() {
    const form = el('verify-form');
    if (!form) return;

    if (window.vreWallet?.readConnected) {
      walletState = window.vreWallet.readConnected();
      // The wallet UI can switch or disconnect an account at any time; re-render so
      // the panel never claims a win for an address the user no longer has.
      window.vreWallet.onChange?.((state) => {
        walletState = state;
        if (lastVerifyResult) renderDetails(lastVerifyResult);
      });
    }

    el('field-rpc').value = DEFAULT_RPC;
    el('field-program').value = DEFAULT_PROGRAM_ID;

    el('btn-verify').addEventListener('click', (e) => {
      e.preventDefault();
      runFromForm();
    });

    form.addEventListener('submit', (e) => { e.preventDefault(); runFromForm(); });

    document.addEventListener('submit', (e) => {
      const check = e.target instanceof HTMLFormElement && e.target.matches('[data-snapshot-check]') ? e.target : null;
      if (!check) return;
      e.preventDefault();
      runSnapshotCheck(check.elements.address?.value);
    });
    document.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('[data-snapshot-proof-download]')) downloadSnapshotProof();
    });

    document.addEventListener('click', async (event) => {
      if (event.target.closest('[data-disconnect-wallet]')) {
        walletState = await window.vreWallet.disconnect();
        if (lastVerifyResult) renderDetails(lastVerifyResult);
        return;
      }
      const btn = event.target.closest('[data-connect-wallet]');
      if (!btn) return;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = 'Connecting...';
      try {
        walletState = await window.vreWallet.connect(btn.getAttribute('data-connect-wallet') || undefined);
      } catch (error) {
        walletState = { status: 'not-connected', error: error?.message || String(error) };
        window.vreToast('Wallet connection cancelled');
      } finally {
        btn.disabled = false;
        btn.textContent = original;
        if (lastVerifyResult) renderDetails(lastVerifyResult);
      }
    });

    const params = new URLSearchParams(location.search);
    const sigParam = params.get('sig');
    const rpcParam = params.get('rpc');
    const progParam = params.get('program') || params.get('programId') || params.get('program-id');
    if (rpcParam) el('field-rpc').value = rpcParam;
    if (progParam) el('field-program').value = progParam;
    if (sigParam) {
      el('field-sig').value = sigParam;
      setTimeout(runFromForm, 80);
    }

    const cluster = el('field-cluster');
    if (cluster) {
      cluster.addEventListener('change', () => {
        const rpcMap = {
          devnet: 'https://api.devnet.solana.com',
          testnet: 'https://api.testnet.solana.com',
          localnet: 'http://localhost:8899',
        };
        if (rpcMap[cluster.value]) el('field-rpc').value = rpcMap[cluster.value];
      });
    }
  }

  window.vreVerify = verify;
  window.vreDidIWin = { looksLikeSolanaAddress, hasAddressOutcomes, didIWin };
  document.addEventListener('DOMContentLoaded', onReady);
})();
