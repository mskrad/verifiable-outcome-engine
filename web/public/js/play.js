/* ================================================================
   VRE — Blessed signatures loader (play.html)
   Uses the local public API source of truth instead of Solana RPC
   scraping, so labels/descriptions stay aligned with artifacts.
   ================================================================ */

(function () {
  'use strict';

  const DEFAULT_PROGRAM_ID = '3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq';
  const DEFAULT_RPC = 'https://api.devnet.solana.com';
  const RAFFLE_SIG = 'mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh';
  const WORLD_IDKIT_CORE_URL = 'https://esm.sh/@worldcoin/idkit-core@4.1.3?bundle';

  let liveRaffleWallet = { status: 'not-connected' };
  let liveRaffleHealth = null;
  let liveRaffleHealthPromise = null;
  let worldIdRequired = false;
  let worldIdSdkPromise = null;
  let worldIdStatus = { phase: 'idle', message: '' };

  const USE_CASE_BADGES = {
    rewards:    { label: 'Rewards Selection', cls: 'badge-use-rewards' },
    'multi-winner': { label: 'Multi-Winner', cls: 'badge-use-multi-winner' },
    dao:        { label: 'DAO Proposal', cls: 'badge-use-dao' },
    loot:       { label: 'Loot',         cls: 'badge-use-loot' },
    agent:      { label: 'Agent',        cls: 'badge-use-agent' },
  };

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function getJson(path) {
    const res = await fetch(path);
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || `GET ${path} failed`);
    return json;
  }

  async function postJson(path, payload) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.error || `POST ${path} failed`);
    return json;
  }

  async function loadHealth() {
    if (!liveRaffleHealthPromise) {
      liveRaffleHealthPromise = getJson('/api/health')
        .then((health) => {
          liveRaffleHealth = health;
          if (!health?.world_id?.enabled) {
            worldIdRequired = false;
          }
          return health;
        })
        .catch((error) => {
          liveRaffleHealthPromise = null;
          throw error;
        });
    }
    return liveRaffleHealthPromise;
  }

  function normalizeReplayForDidIWin(replay) {
    return {
      status: replay?.verification_result || 'ERROR',
      outcomeId: replay?.outcome_id || '',
      outcomeIds: Array.isArray(replay?.outcome_ids) ? replay.outcome_ids : [],
      outcomes: Array.isArray(replay?.outcomes) ? replay.outcomes : [],
    };
  }

  function resetWorldIdState() {
    worldIdStatus = { phase: 'idle', message: '' };
  }

  function worldIdCapability() {
    return liveRaffleHealth?.world_id || {
      enabled: false,
      action: 'vre-raffle-entry',
      environment: 'production',
      flow: 'v4-first',
    };
  }

  function renderWorldIdStatus() {
    if (worldIdStatus.phase === 'error' && worldIdStatus.message) {
      return `<div class="live-raffle-status live-raffle-error">${escapeHtml(worldIdStatus.message)}</div>`;
    }
    if (worldIdStatus.phase === 'verified' && worldIdStatus.message) {
      return `<div class="live-raffle-status live-raffle-success">${escapeHtml(worldIdStatus.message)}</div>`;
    }
    return '';
  }

  function renderWorldIdControls() {
    const capability = worldIdCapability();
    const enabled = capability.enabled === true;
    const checked = enabled && worldIdRequired;
    const copy = enabled
      ? checked
        ? `The raffle will first request a World ID 4.0 proof-of-human bound to your Phantom address. Environment: ${capability.environment}.`
        : `Optional World ID 4.0 gate via RP signatures. Action: ${capability.action}. Environment: ${capability.environment}.`
      : 'World ID is optional and currently unavailable on this host. The existing raffle flow still works without it.';
    return `
      <div class="world-id-panel">
        <label class="world-id-toggle ${enabled ? '' : 'world-id-toggle-disabled'}">
          <input type="checkbox" data-world-id-required ${checked ? 'checked' : ''} ${enabled ? '' : 'disabled'} />
          <span>Require World ID</span>
        </label>
        <div class="world-id-hint">${escapeHtml(copy)}</div>
        ${renderWorldIdStatus()}
      </div>
    `;
  }

  async function loadWorldIdSdk() {
    if (!worldIdSdkPromise) {
      worldIdSdkPromise = import(WORLD_IDKIT_CORE_URL).catch((error) => {
        worldIdSdkPromise = null;
        throw error;
      });
    }
    return worldIdSdkPromise;
  }

  async function fetchWorldIdRpContext() {
    return postJson('/api/world-id/rp-context', {});
  }

  function humanizeWorldIdError(errorCode) {
    const value = String(errorCode || '').trim();
    return {
      user_rejected: 'World ID request was rejected in World App',
      verification_rejected: 'World ID verification was rejected',
      credential_unavailable: 'World ID credential is unavailable for this account',
      connection_failed: 'World ID connection failed',
      timeout: 'World ID request timed out',
      cancelled: 'World ID request was cancelled',
    }[value] || 'World ID verification failed';
  }

  async function requestWorldIdProof(address) {
    const capability = worldIdCapability();
    if (!capability.enabled) {
      throw new Error('World ID is not configured on this host');
    }

    const [sdk, context] = await Promise.all([
      loadWorldIdSdk(),
      fetchWorldIdRpContext(),
    ]);
    if (!context?.enabled || !context?.rp_context) {
      throw new Error('World ID is not configured on this host');
    }

    const { IDKit, CredentialRequest } = sdk;
    const request = await IDKit.request({
      app_id: context.app_id,
      action: context.action,
      rp_context: context.rp_context,
      allow_legacy_proofs: false,
      environment: context.environment,
    }).constraints(CredentialRequest('proof_of_human', { signal: address }));

    if (request.connectorURI) {
      window.open(request.connectorURI, '_blank', 'noopener,noreferrer');
    }

    const completion = await request.pollUntilCompletion({
      pollInterval: 1500,
      timeout: 120000,
    });
    if (!completion.success) {
      throw new Error(humanizeWorldIdError(completion.error));
    }
    worldIdStatus = {
      phase: 'verified',
      message: 'World ID proof collected and sent with this raffle attempt',
    };
    return completion.result;
  }

  function renderLiveRaffle(state = 'idle', data = {}) {
    const root = document.getElementById('live-raffle');
    if (!root) return;

    if (state === 'not-installed') {
      root.innerHTML = `
        <div class="live-raffle-head">
          <div>
            <span class="eyebrow"><span class="dot"></span> Live raffle</span>
            <h2>Try a real on-chain raffle</h2>
            <p>Connect Phantom to enter a devnet raffle with your address weighted at 90%.</p>
          </div>
        </div>
        <div class="live-raffle-status live-raffle-warn">
          Phantom is not installed. <a class="text-teal" href="https://phantom.app/" target="_blank" rel="noopener">Install Phantom</a>
        </div>
      `;
      return;
    }

    if (state === 'idle') {
      const connected = liveRaffleWallet.status === 'connected';
      root.innerHTML = `
        <div class="live-raffle-head">
          <div>
            <span class="eyebrow"><span class="dot"></span> Live raffle</span>
            <h2>Try a real on-chain raffle</h2>
            <p>${connected
              ? `Your address: <span class="wallet-pill">${escapeHtml(liveRaffleWallet.shortAddress)}</span>`
              : 'Connect Phantom to enter a devnet raffle with your address weighted at 90%.'}</p>
          </div>
          <div class="live-raffle-actions">
            ${connected
              ? `<button class="btn btn-primary" type="button" data-live-raffle-start>${worldIdRequired ? 'Verify & Start Raffle →' : 'Start Raffle →'}</button>`
              : '<button class="btn btn-secondary" type="button" data-live-raffle-connect>Connect Phantom</button>'}
          </div>
        </div>
        ${renderWorldIdControls()}
        <div class="live-raffle-status">
          You will be entered with four preset participants. The result is a real devnet transaction and can be verified independently.
        </div>
      `;
      return;
    }

    if (state === 'loading') {
      root.innerHTML = `
        <div class="loading-state live-raffle-loading">
          <div class="spinner spinner-lg"></div>
          <div>
            <strong>${escapeHtml(data.title || 'Creating your raffle on Solana devnet...')}</strong>
            <div class="text-faint">${escapeHtml(data.message || 'This takes about 15-45 seconds.')}</div>
          </div>
        </div>
      `;
      return;
    }

    if (state === 'error') {
      root.innerHTML = `
        <div class="live-raffle-head">
          <div>
            <span class="eyebrow"><span class="dot"></span> Live raffle</span>
            <h2>Try a real on-chain raffle</h2>
          </div>
          <button class="btn btn-secondary" type="button" data-live-raffle-reset>Try again</button>
        </div>
        <div class="live-raffle-status live-raffle-error">${escapeHtml(data.message || 'Live raffle failed')}</div>
        ${data.signature ? `
          <div class="sig-actions mt-4">
            <a class="btn btn-secondary btn-sm" href="/verify?sig=${encodeURIComponent(data.signature)}">Open verifier →</a>
            <button class="btn btn-ghost btn-sm" data-copy="${escapeHtml(data.signature)}">Copy Sig</button>
          </div>
        ` : ''}
      `;
      return;
    }

    if (state === 'result') {
      const did = data.did || 'not-in-draw';
      const title = did === 'won'
        ? '🎉 You won!'
        : did === 'not-in-draw'
        ? 'Your address was not in this draw'
        : 'Not selected this time';
      root.innerHTML = `
        <div class="live-raffle-head">
          <div>
            <span class="eyebrow"><span class="dot"></span> Live raffle complete</span>
            <h2>${escapeHtml(title)}</h2>
            <p>Selected outcome: <span class="mono text-teal">${escapeHtml(window.vreShort(data.outcome || '', 8, 8))}</span></p>
          </div>
        </div>
        <div class="sig-meta">
          <div class="sig-meta-item">
            <div class="sig-meta-label">signature</div>
            <div class="sig-meta-value">${escapeHtml(data.signature || '—')}</div>
          </div>
          <div class="sig-meta-item">
            <div class="sig-meta-label">runtime_id</div>
            <div class="sig-meta-value">${escapeHtml(data.runtimeId || '—')}</div>
          </div>
          <div class="sig-meta-item">
            <div class="sig-meta-label">artifact_hash</div>
            <div class="sig-meta-value">${escapeHtml(window.vreShort(data.artifactHash || '—', 10, 6))}</div>
          </div>
        </div>
        <div class="sig-actions">
          <a class="btn btn-primary btn-sm" href="/verify?sig=${encodeURIComponent(data.signature)}">Verify independently →</a>
          <a class="btn btn-secondary btn-sm" href="https://explorer.solana.com/tx/${encodeURIComponent(data.signature)}?cluster=devnet" target="_blank" rel="noopener">Explorer ↗</a>
          <button class="btn btn-ghost btn-sm" data-copy="${escapeHtml(data.signature)}">Copy Sig</button>
        </div>
        ${data.worldIdVerified ? '<div class="live-raffle-status live-raffle-success">World ID was verified before raffle execution.</div>' : ''}
      `;
    }
  }

  async function connectLiveRaffleWallet() {
    if (!window.vreWallet?.connectPhantom) throw new Error('Wallet helper unavailable');
    liveRaffleWallet = await window.vreWallet.connectPhantom();
    resetWorldIdState();
    if (liveRaffleWallet.status === 'not-installed') {
      renderLiveRaffle('not-installed');
      return;
    }
    if (liveRaffleWallet.status !== 'connected') {
      throw new Error('Phantom not connected');
    }
    renderLiveRaffle('idle');
  }

  async function startLiveRaffle() {
    if (liveRaffleWallet.status !== 'connected') {
      await connectLiveRaffleWallet();
    }
    if (liveRaffleWallet.status !== 'connected') return;

    let live = null;
    try {
      let worldId = null;
      if (worldIdRequired) {
        renderLiveRaffle('loading', {
          title: 'Waiting for World ID approval...',
          message: 'Approve the request in World App or the staging simulator tab.',
        });
        worldId = await requestWorldIdProof(liveRaffleWallet.address);
      }
      renderLiveRaffle('loading', {
        title: 'Creating your raffle on Solana devnet...',
        message: 'This takes about 15-45 seconds.',
      });
      live = await postJson('/api/live-raffle', {
        address: liveRaffleWallet.address,
        requireWorldId: worldIdRequired,
        worldId,
      });
      const replayJson = await postJson('/api/replay', { signature: live.signature });
      const replay = replayJson.replay || {};
      if (replay.verification_result !== 'MATCH') {
        throw new Error(`Replay did not match: ${replay.verification_reason || 'unknown reason'}`);
      }
      const normalized = normalizeReplayForDidIWin(replay);
      const did = window.vreDidIWin?.didIWin?.(liveRaffleWallet.address, normalized) || 'not-applicable';

      const liveRaffleResult = {
        signature: live.signature,
        outcome: replay.outcome_id || live.outcome,
        runtimeId: replay.runtime_id || live.runtimeId,
        artifactHash: replay.compiled_artifact_hash || live.artifactHash,
        did,
        worldIdVerified: Boolean(live?.world_id?.verified),
      };
      renderLiveRaffle('result', liveRaffleResult);
    } catch (error) {
      const message = error?.message || String(error);
      if (worldIdRequired) {
        worldIdStatus = { phase: 'error', message };
      }
      renderLiveRaffle('error', {
        message: /rate|60/i.test(message)
          ? 'Please wait 60 seconds between raffles'
          : /world id/i.test(message)
          ? message
          : /slow|timeout/i.test(message)
          ? 'Devnet is slow right now, try again'
          : message,
        signature: live?.signature,
      });
    }
  }

  function initLiveRaffle() {
    const root = document.getElementById('live-raffle');
    if (!root) return;
    liveRaffleWallet = window.vreWallet?.readConnectedPhantom?.() || { status: 'not-connected' };
    renderLiveRaffle(liveRaffleWallet.status === 'not-installed' ? 'not-installed' : 'idle');
    loadHealth()
      .then(() => {
        renderLiveRaffle(liveRaffleWallet.status === 'not-installed' ? 'not-installed' : 'idle');
      })
      .catch(() => {});

    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-live-raffle-connect]')) {
        connectLiveRaffleWallet().catch((error) => {
          renderLiveRaffle('error', { message: error?.message || String(error) });
        });
      }
      if (event.target.closest('[data-live-raffle-start]')) {
        startLiveRaffle();
      }
      if (event.target.closest('[data-live-raffle-reset]')) {
        resetWorldIdState();
        renderLiveRaffle(liveRaffleWallet.status === 'not-installed' ? 'not-installed' : 'idle');
      }
    });

    document.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.matches('[data-world-id-required]')) return;
      worldIdRequired = target.checked && worldIdCapability().enabled === true;
      resetWorldIdState();
      renderLiveRaffle(liveRaffleWallet.status === 'not-installed' ? 'not-installed' : 'idle');
    });
  }

  function inferUseCase(entry) {
    const winnersCount = Number(entry.winners_count || 0);
    const labelText = String(entry.label || '').toLowerCase();
    const text = [
      entry.label,
      entry.description,
      entry.source,
      entry.notes,
      entry.id,
    ].filter(Boolean).join(' ').toLowerCase();

    if (winnersCount > 1 || labelText === 'multi-winner' || text.includes('multi-winner')) return 'multi-winner';
    if (text.includes('airdrop')) return 'rewards';
    if (text.includes('dao') || text.includes('proposal')) return 'dao';
    if (text.includes('prediction')) return 'dao';
    if (text.includes('raffle') || entry.signature === RAFFLE_SIG) return 'rewards';
    if (text.includes('agent')) return 'agent';
    if (text.includes('loot')) return 'loot';
    return 'loot';
  }

  function describe(entry, useCase) {
    if (entry.description) return entry.description;
    if (entry.notes) return entry.notes;
    return {
      rewards: 'Weighted recipient selection resolved',
      'multi-winner': 'Multiple winners selected from one committed weighted list',
      dao: 'DAO proposal selection resolved',
      loot: 'Weighted loot outcome resolved',
    }[useCase] || 'Verifiable outcome resolved';
  }

  function outcomeIds(entry) {
    return (Array.isArray(entry.outcome_ids) ? entry.outcome_ids : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean);
  }

  function renderWinnerList(entry) {
    const ids = outcomeIds(entry);
    if (!ids.length) return '';
    return `
      <div class="winner-list" aria-label="Selected winners">
        ${ids.map((id, index) => `
          <div class="winner-row">
            <span class="winner-index">${index + 1}</span>
            <span class="winner-address">${escapeHtml(id)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  async function loadTimeline(entry, health) {
    if (!entry.compiled_artifact_hash) return null;
    try {
      const json = await postJson('/api/timeline', {
        signature: entry.signature,
        rpc: entry.rpc_url || health.rpc || DEFAULT_RPC,
        programId: entry.program_id || health.program_id || DEFAULT_PROGRAM_ID,
        compiledArtifactHash: entry.compiled_artifact_hash,
      });
      return json.ok ? json : null;
    } catch (_) {
      return null;
    }
  }

  function renderCard(entry, idx, health) {
    const useCase = inferUseCase(entry);
    const badge = USE_CASE_BADGES[useCase] || USE_CASE_BADGES.loot;
    const short = window.vreShort(entry.signature);
    const timeline = entry.timeline;
    const artifactSlot = timeline?.artifact_slot;
    const resolutionSlot = timeline?.resolution_slot;
    const gapSlots = timeline?.gap_slots;
    const timelineText = artifactSlot != null && resolutionSlot != null
      ? `slot ${artifactSlot} → ${resolutionSlot}`
      : 'timeline unavailable';
    const updated = entry.updated_utc
      ? new Date(entry.updated_utc).toISOString().replace('T', ' ').slice(0, 19)
      : 'devnet evidence';

    return `
      <article class="sig-card" data-idx="${idx}">
        <div class="sig-card-head">
          <div class="sig-card-badges">
            <span class="badge ${badge.cls}">${badge.label}</span>
            <span class="badge badge-match">${escapeHtml(entry.verification_result || 'MATCH')} / ${escapeHtml(entry.verification_reason || 'OK')}</span>
          </div>
          <span class="text-faint mono" style="font-size:11px;">${escapeHtml(updated)} UTC</span>
        </div>
        <div class="sig-card-desc">${escapeHtml(describe(entry, useCase))}</div>
        ${renderWinnerList(entry)}
        <div class="sig-hash" data-copy-target="${escapeHtml(entry.signature)}">${escapeHtml(short)}</div>
        <div class="sig-meta">
          <div class="sig-meta-item">
            <div class="sig-meta-label">runtime_id</div>
            <div class="sig-meta-value">${escapeHtml(entry.runtime_id || '—')}</div>
          </div>
          <div class="sig-meta-item">
            <div class="sig-meta-label">resolve_id</div>
            <div class="sig-meta-value">${escapeHtml(entry.resolve_id || '—')}</div>
          </div>
          <div class="sig-meta-item">
            <div class="sig-meta-label">artifact_hash</div>
            <div class="sig-meta-value">${escapeHtml(window.vreShort(entry.compiled_artifact_hash || '—', 10, 6))}</div>
          </div>
        </div>
        <div class="sig-timeline">
          <span>🜉</span>
          <span>${escapeHtml(timelineText)}</span>
          ${gapSlots != null ? `<span class="delta">+${gapSlots} slots</span>` : ''}
        </div>
        <div class="sig-actions">
          <a class="btn btn-primary btn-sm" href="/verify?sig=${encodeURIComponent(entry.signature)}">▶ Verify Now</a>
          <a class="btn btn-secondary btn-sm" href="https://explorer.solana.com/tx/${entry.signature}?cluster=devnet" target="_blank" rel="noopener">Explorer ↗</a>
          <button class="btn btn-ghost btn-sm" data-copy="${escapeHtml(entry.signature)}">Copy Sig</button>
        </div>
      </article>
    `;
  }

  async function loadSignatures() {
    const listEl = document.getElementById('sig-list');
    const statusEl = document.getElementById('sig-status');
    if (!listEl) return;

    listEl.innerHTML = `
      <div class="loading-state">
        <div class="spinner spinner-lg"></div>
        <div>Loading blessed signatures from the VRE evidence bundle…</div>
      </div>
    `;

    try {
      const [health, blessed] = await Promise.all([
        loadHealth(),
        getJson('/api/blessed-signatures'),
      ]);
      const entries = (blessed.data?.entries || [])
        .filter((entry) => entry.status === 'active');

      if (!entries.length) {
        listEl.innerHTML = `
          <div class="empty-state">
            <div style="font-size:15px;color:var(--text);margin-bottom:6px;">No active signatures yet</div>
            <div>The blessed signature bundle has no active entries.<br/>
                 Paste a signature on the <a href="/verify" class="text-teal">verify page</a>.</div>
          </div>
        `;
        statusEl.textContent = 'No active signatures';
        return;
      }

      const enriched = await Promise.all(entries.map(async (entry) => ({
        ...entry,
        timeline: await loadTimeline(entry, health),
      })));

      listEl.innerHTML = enriched.map((entry, idx) => renderCard(entry, idx, health)).join('');
      statusEl.textContent = `${enriched.length} blessed signature${enriched.length === 1 ? '' : 's'} · ${health.blessed_signatures_count} active · ${window.vreShort(health.program_id || DEFAULT_PROGRAM_ID, 8, 8)}`;
    } catch (err) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div style="color:var(--red);margin-bottom:6px;">API error</div>
          <div>${escapeHtml(err.message || String(err))}</div>
        </div>
      `;
      statusEl.textContent = 'API error';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initLiveRaffle();
    loadSignatures();
  });
})();
