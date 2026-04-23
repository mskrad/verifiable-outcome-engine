/* ================================================================
   VRE — Verification UI
   Uses the repository API endpoints:
   POST /api/replay + POST /api/timeline.
   ================================================================ */

(function () {
  'use strict';

  const DEFAULT_RPC = 'https://api.devnet.solana.com';
  const DEFAULT_PROGRAM_ID = '3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq';
  const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  let lastVerifyResult = null;
  let phantomState = { status: 'not-connected' };

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

  function didIWin(address, r) {
    if (!hasAddressOutcomes(r)) return 'not-applicable';
    const candidate = String(address || '').trim();
    const winner = String(r?.outcomeId || '').trim();
    const ids = new Set((r.outcomes || []).map((outcome) => String(outcome?.id || '').trim()));
    if (candidate && candidate === winner) return 'won';
    if (candidate && ids.has(candidate)) return 'in-draw-not-selected';
    return 'not-in-draw';
  }

  function renderResult(r) {
    lastVerifyResult = r;
    const banner = el('result-banner');
    const details = el('result-details');
    const raw = el('result-raw');
    const isMatch = r.status === 'MATCH';
    const isMismatch = r.status === 'MISMATCH' || r.status === 'ERROR';
    const statusClass = isMatch ? 'result-banner-match' : 'result-banner-mismatch';
    const statusIcon = isMatch ? '✓' : '✕';
    const message = isMismatch
      ? `${escapeHtml(r.message)} <a class="text-teal" href="/spec#error-codes">See error codes →</a>`
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
      outcomes: r.outcomes,
      replay: r.replay,
      timeline: r.timeline,
    };
  }

  function renderDetails(r) {
    const details = el('result-details');
    details.innerHTML = renderOutcome(r) + renderDidIWin(r) + renderRules(r) + renderTimeline(r) + renderLinks(r);
  }

  function renderOutcome(r) {
    if (!r.outcomeId) return '';
    return `
      <div class="result-section">
        <div class="result-section-title">Selected Outcome</div>
        <div class="outcome-selected">
          <div>
            <div class="outcome-id text-faint mb-2">outcome_id</div>
            <div class="outcome-winner">${escapeHtml(r.outcomeId)}</div>
          </div>
          <div class="badge ${r.status === 'MATCH' ? 'badge-match' : 'badge-mismatch'}">
            ${r.status === 'MATCH' ? '✓ replay matches' : '✕ replay diverges'}
          </div>
        </div>
      </div>
    `;
  }

  function renderDidIWin(r) {
    if (r.status !== 'MATCH' || !hasAddressOutcomes(r)) return '';

    const state = phantomState || { status: 'not-connected' };
    if (state.status === 'not-installed') {
      return `
        <div class="result-section did-win-card">
          <div class="did-win-head">
            <div>
              <div class="result-section-title">Did I win?</div>
              <p class="did-win-copy">Connect Phantom to compare your wallet address with the selected outcome.</p>
            </div>
          </div>
          <div class="did-win-status did-win-status-warn">
            Phantom is not installed. <a class="text-teal" href="https://phantom.app/" target="_blank" rel="noopener">Install Phantom</a>
          </div>
        </div>
      `;
    }

    if (state.status !== 'connected') {
      return `
        <div class="result-section did-win-card">
          <div class="did-win-head">
            <div>
              <div class="result-section-title">Did I win?</div>
              <p class="did-win-copy">Connect Phantom to compare your wallet address with the selected outcome.</p>
            </div>
            <button class="btn btn-secondary btn-sm" type="button" data-connect-phantom>Connect Phantom</button>
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
            <p class="did-win-copy">Connected: <span class="wallet-pill">${escapeHtml(state.shortAddress || window.vreWallet?.shortAddress?.(state.address) || state.address)}</span></p>
          </div>
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
    const rows = r.outcomes.map((outcome) => {
      const id = String(outcome.id ?? '');
      const isWinner = id === r.outcomeId;
      return `<tr class="${isWinner ? 'winner' : ''}">
        <td>${escapeHtml(id)}</td>
        <td>${escapeHtml(String(outcome.weight ?? '—'))}</td>
        <td>${isWinner ? '← selected' : ''}</td>
      </tr>`;
    }).join('');

    return `
      <div class="result-section">
        <div class="result-section-title">Committed Rules</div>
        <table class="rules-table">
          <thead>
            <tr><th>Outcome</th><th>Weight</th><th></th></tr>
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
    return `
      <div class="result-section">
        <div class="result-section-title">Pre-commitment Timeline</div>
        <div class="timeline-row">
          <div class="timeline-stop">
            <span class="timeline-stop-label">Rules committed</span>
            <span class="timeline-stop-value">slot ${commitSlot != null ? commitSlot : '—'}</span>
          </div>
          <div class="timeline-arrow">→</div>
          <div class="timeline-stop">
            <span class="timeline-stop-label">Outcome drawn</span>
            <span class="timeline-stop-value">slot ${resolveSlot != null ? resolveSlot : '—'}</span>
          </div>
        </div>
        ${delta != null ? `<div class="pre-proof-caption">Rules were committed on-chain <strong>${delta} slot${delta === 1 ? '' : 's'}</strong> before the outcome was drawn.</div>` : '<div class="pre-proof-caption">Timeline unavailable for this signature.</div>'}
      </div>
    `;
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

    if (window.vreWallet?.readConnectedPhantom) {
      phantomState = window.vreWallet.readConnectedPhantom();
    }

    el('field-rpc').value = DEFAULT_RPC;
    el('field-program').value = DEFAULT_PROGRAM_ID;

    el('btn-verify').addEventListener('click', (e) => {
      e.preventDefault();
      runFromForm();
    });

    form.addEventListener('submit', (e) => { e.preventDefault(); runFromForm(); });

    document.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-connect-phantom]');
      if (!btn) return;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = 'Connecting...';
      try {
        phantomState = await window.vreWallet.connectPhantom();
      } catch (error) {
        phantomState = { status: 'not-connected', error: error?.message || String(error) };
        window.vreToast('Phantom connection cancelled');
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
