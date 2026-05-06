/* ================================================================
   VRE — Blessed signatures loader (play.html)
   Uses the local public API source of truth instead of Solana RPC
   scraping, so labels/descriptions stay aligned with artifacts.
   ================================================================ */

(function () {
  'use strict';

  const DEFAULT_PROGRAM_ID = '9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F';
  const DEFAULT_RPC = 'https://api.devnet.solana.com';
  const WORLD_IDKIT_CORE_URL = 'https://esm.sh/@worldcoin/idkit-core@4.1.3?bundle';
  const TOTAL_SIGNATURE_LIMIT = 6;
  const BLESSED_LIMIT = 4;
  const HISTORICAL_LIMIT = 6;

  let liveRaffleWallet = { status: 'not-connected' };
  let liveRaffleHealth = null;
  let liveRaffleHealthPromise = null;
  let worldIdRequired = false;
  let worldIdSdkPromise = null;
  let worldIdStatus = { phase: 'idle', message: '' };
  let worldIdConnectorURI = null;

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
      if (context.environment === 'staging') {
        worldIdConnectorURI = request.connectorURI;
        renderLiveRaffle('loading', {
          title: 'Scan with World ID Simulator',
          message: 'Open simulator.worldcoin.org on desktop and scan the QR code.',
        });
      } else {
        window.open(request.connectorURI, '_blank', 'noopener,noreferrer');
        renderLiveRaffle('loading', {
          title: 'Waiting for World ID approval...',
          message: 'Approve the request in World App on your mobile device.',
        });
      }
    }

    let completion;
    try {
      completion = await request.pollUntilCompletion({
        pollInterval: 1500,
        timeout: 120000,
      });
    } finally {
      worldIdConnectorURI = null;
    }
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
        <div class="live-raffle-grain"></div>
        <div class="live-raffle-head">
          <div>
            <span class="eyebrow"><span class="dot pulse"></span> Live on devnet</span>
            <h2 class="live-raffle-title">Try a real on-chain raffle</h2>
            <div class="live-raffle-sub">Connect Phantom to enter a weighted devnet raffle and verify the result from the resulting transaction signature.</div>
          </div>
          <div class="live-raffle-countdown">
            <div class="countdown-num"><span>—</span></div>
            <div class="countdown-label">wallet missing</div>
          </div>
        </div>
        <div class="live-raffle-stats">
          <div class="lr-stat">
            <div class="lr-stat-label">Network</div>
            <div class="lr-stat-value">Devnet</div>
          </div>
          <div class="lr-stat">
            <div class="lr-stat-label">Program</div>
            <div class="lr-stat-value mono" style="font-size:14px;">9tEram…FE1F</div>
          </div>
          <div class="lr-stat">
            <div class="lr-stat-label">Flow</div>
            <div class="lr-stat-value">Phantom</div>
          </div>
          <div class="lr-stat">
            <div class="lr-stat-label">World ID</div>
            <div class="lr-stat-value">Optional</div>
          </div>
        </div>
        <div class="live-raffle-cta">
          <a class="btn btn-primary btn-lg" href="https://phantom.app/" target="_blank" rel="noopener">Install Phantom <span aria-hidden>→</span></a>
          <a class="btn btn-secondary btn-lg" href="/verify">Open verifier</a>
          <span class="text-faint" style="font-size:12.5px;">Phantom is required for the live raffle flow.</span>
        </div>
      `;
      return;
    }

    if (state === 'idle') {
      const connected = liveRaffleWallet.status === 'connected';
      const capability = worldIdCapability();
      root.innerHTML = `
        <div class="live-raffle-grain"></div>
        <div class="live-raffle-head">
          <div>
            <span class="eyebrow"><span class="dot pulse"></span> Live on devnet</span>
            <h2 class="live-raffle-title">Try a real on-chain raffle</h2>
            <div class="live-raffle-sub">${connected
              ? `Your address is connected: <span class="wallet-pill">${escapeHtml(liveRaffleWallet.shortAddress)}</span>`
              : 'Connect Phantom to enter a weighted devnet raffle. Your wallet will be added to a fixed public test set.'}</div>
          </div>
          <div class="live-raffle-countdown">
            <div class="countdown-num"><span>${connected ? 'READY' : 'WAIT'}</span></div>
            <div class="countdown-label">${connected ? 'wallet connected' : 'connect wallet'}</div>
          </div>
        </div>
        <div class="live-raffle-stats">
          <div class="lr-stat">
            <div class="lr-stat-label">Network</div>
            <div class="lr-stat-value">Devnet</div>
          </div>
          <div class="lr-stat">
            <div class="lr-stat-label">Formula</div>
            <div class="lr-stat-value mono">weighted_random</div>
          </div>
          <div class="lr-stat">
            <div class="lr-stat-label">Wallet weight</div>
            <div class="lr-stat-value">90%</div>
          </div>
          <div class="lr-stat">
            <div class="lr-stat-label">World ID</div>
            <div class="lr-stat-value">${capability.enabled ? (worldIdRequired ? 'Required' : 'Optional') : 'Unavailable'}</div>
          </div>
        </div>
        <div class="live-raffle-cta">
          ${connected
            ? `<button class="btn btn-primary btn-lg" type="button" data-live-raffle-start>${worldIdRequired ? 'Verify & Start Raffle' : 'Start Raffle'} <span aria-hidden>→</span></button>`
            : '<button class="btn btn-primary btn-lg" type="button" data-live-raffle-connect>Connect Phantom <span aria-hidden>→</span></button>'}
          <a class="btn btn-secondary btn-lg" href="/verify">Open verifier</a>
          <span class="text-faint" style="font-size:12.5px;">The result is a real devnet transaction you can replay independently.</span>
        </div>
        ${renderWorldIdControls()}
        <div class="status-bar" style="margin-top:16px;">
          <div class="status-bar-left">
            <span class="status-pill"><span class="dot pulse"></span> weighted draw</span>
            <span class="text-faint" style="font-size:12.5px;">You will be entered with four preset participants.</span>
          </div>
          <div class="status-bar-right">
            <button class="btn btn-ghost btn-sm" data-copy="${escapeHtml(DEFAULT_PROGRAM_ID)}">Copy program ID</button>
          </div>
        </div>
      `;
      return;
    }

    if (state === 'loading') {
      root.innerHTML = `
        <div class="live-raffle-grain"></div>
        <div class="live-raffle-head">
          <div>
            <span class="eyebrow"><span class="dot pulse"></span> Live on devnet</span>
            <h2 class="live-raffle-title">${escapeHtml(data.title || 'Creating your raffle on Solana devnet...')}</h2>
            <div class="live-raffle-sub">${escapeHtml(data.message || 'This takes about 15-45 seconds.')}</div>
          </div>
          ${worldIdConnectorURI ? `
          <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
            <img src="https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(worldIdConnectorURI)}&size=160x160&margin=8" width="160" height="160" style="border-radius:8px;background:#fff;" alt="World ID QR" />
            <div style="font-size:11px;opacity:.6;text-align:center;">scan with World App or<br><a href="https://simulator.worldcoin.org" target="_blank" rel="noopener" style="color:inherit;">simulator.worldcoin.org</a></div>
          </div>
          ` : `
          <div class="live-raffle-countdown">
            <div class="spinner spinner-lg"></div>
            <div class="countdown-label">in progress</div>
          </div>`}
        </div>
        <div class="live-raffle-stats">
          <div class="lr-stat">
            <div class="lr-stat-label">Status</div>
            <div class="lr-stat-value">Submitting</div>
          </div>
          <div class="lr-stat">
            <div class="lr-stat-label">Network</div>
            <div class="lr-stat-value">Devnet</div>
          </div>
          <div class="lr-stat">
            <div class="lr-stat-label">Wallet</div>
            <div class="lr-stat-value mono" style="font-size:14px;">${escapeHtml(liveRaffleWallet.shortAddress || 'pending')}</div>
          </div>
          <div class="lr-stat">
            <div class="lr-stat-label">Verifier</div>
            <div class="lr-stat-value">Queued</div>
          </div>
        </div>
      `;
      return;
    }

    if (state === 'error') {
      root.innerHTML = `
        <div class="live-raffle-grain"></div>
        <div class="live-raffle-head">
          <div>
            <span class="eyebrow"><span class="dot pulse"></span> Live on devnet</span>
            <h2 class="live-raffle-title">Live raffle failed</h2>
            <div class="live-raffle-sub">${escapeHtml(data.message || 'Live raffle failed')}</div>
          </div>
          <div class="live-raffle-countdown">
            <div class="countdown-num"><span>FAIL</span></div>
            <div class="countdown-label">simulation error</div>
          </div>
        </div>
        <div class="live-raffle-cta">
          <button class="btn btn-primary btn-lg" type="button" data-live-raffle-reset>Try again</button>
          ${data.signature ? `<a class="btn btn-secondary btn-lg" href="/verify?sig=${encodeURIComponent(data.signature)}">Open verifier</a>` : '<a class="btn btn-secondary btn-lg" href="/verify">Open verifier</a>'}
          ${data.signature ? `<button class="btn btn-ghost btn-lg" data-copy="${escapeHtml(data.signature)}">Copy Sig</button>` : ''}
        </div>
        <div class="status-bar" style="margin-top:16px;">
          <div class="status-bar-left">
            <span class="status-pill">${escapeHtml(worldIdRequired ? 'world-id flow' : 'standard flow')}</span>
            <span class="text-faint" style="font-size:12.5px;">Inspect the verifier or explorer if the error persists.</span>
          </div>
        </div>
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
        <div class="live-raffle-grain"></div>
        <div class="live-raffle-head">
          <div>
            <span class="eyebrow"><span class="dot pulse"></span> Live raffle complete</span>
            <h2 class="live-raffle-title">${escapeHtml(title)}</h2>
            <div class="live-raffle-sub">Selected outcome: <span class="mono text-teal">${escapeHtml(window.vreShort(data.outcome || '', 8, 8))}</span></div>
          </div>
          <div class="live-raffle-countdown">
            <div class="countdown-num"><span>${did === 'won' ? 'WIN' : 'DONE'}</span></div>
            <div class="countdown-label">${did === 'won' ? 'selected' : 'resolved'}</div>
          </div>
        </div>
        <div class="live-raffle-stats">
          <div class="lr-stat">
            <div class="lr-stat-label">Signature</div>
            <div class="lr-stat-value mono" style="font-size:14px;">${escapeHtml(window.vreShort(data.signature || '—', 8, 8))}</div>
          </div>
          <div class="lr-stat">
            <div class="lr-stat-label">Runtime ID</div>
            <div class="lr-stat-value mono" style="font-size:14px;">${escapeHtml(window.vreShort(data.runtimeId || '—', 8, 8))}</div>
          </div>
          <div class="lr-stat">
            <div class="lr-stat-label">Artifact</div>
            <div class="lr-stat-value mono" style="font-size:14px;">${escapeHtml(window.vreShort(data.artifactHash || '—', 10, 6))}</div>
          </div>
          <div class="lr-stat">
            <div class="lr-stat-label">Verifier</div>
            <div class="lr-stat-value">MATCH</div>
          </div>
        </div>
        <div class="live-raffle-cta">
          <a class="btn btn-primary btn-lg" href="/verify?sig=${encodeURIComponent(data.signature)}">Verify independently <span aria-hidden>→</span></a>
          <a class="btn btn-secondary btn-lg" href="https://explorer.solana.com/tx/${encodeURIComponent(data.signature)}?cluster=devnet" target="_blank" rel="noopener">Explorer ↗</a>
          <button class="btn btn-ghost btn-lg" data-copy="${escapeHtml(data.signature)}">Copy Sig</button>
        </div>
        <div class="status-bar" style="margin-top:16px;">
          <div class="status-bar-left">
            <span class="status-pill">${escapeHtml(did === 'won' ? 'winner' : 'resolved')}</span>
            <span class="text-faint" style="font-size:12.5px;">${data.worldIdVerified ? 'World ID was verified before raffle execution.' : 'Replay matched independently against public RPC data.'}</span>
          </div>
        </div>
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

  function describe(entry) {
    if (entry.description) return entry.description;
    if (entry.source === 'historical') {
      const formula = String(entry.resolution_formula || '').trim();
      const winners = Number(entry.winners_count || 0);
      return formula
        ? `Historical devnet transaction replayed as ${formula}${winners > 1 ? ` with ${winners} winners` : ''}.`
        : 'Historical devnet transaction replayed from public RPC data.';
    }
    if (entry.notes) return entry.notes;
    return 'Verifiable outcome resolved';
  }

  function primaryLabel(entry) {
    const label = String(entry.label || '').trim();
    if (label) return label;
    return entry.source === 'historical' ? 'Historical Transaction' : 'Blessed Signature';
  }

  function renderEvidenceBadges(entry) {
    const badges = [];
    const formatVersion = Number(entry.artifact_format_version || 0);
    const winnersCount = Number(entry.winners_count || 0);
    const formula = String(entry.resolution_formula || '').trim();

    if (formatVersion > 0) {
      badges.push(`<span class="badge badge-neutral">W3O1 v${formatVersion}</span>`);
    }
    if (formula) {
      badges.push(`<span class="badge badge-neutral">${escapeHtml(formula)}</span>`);
    }
    if (winnersCount > 1) {
      badges.push(`<span class="badge badge-neutral">${winnersCount} winners</span>`);
    }

    return badges.join('');
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
    const short = window.vreShort(entry.signature);
    const timeline = entry.timeline;
    const artifactSlot = timeline?.artifact_slot;
    const resolutionSlot = timeline?.resolution_slot;
    const gapSlots = timeline?.gap_slots;
    const formula = String(entry.resolution_formula || '').trim() || 'unknown';
    const ids = outcomeIds(entry);
    const primaryOutcomeRaw = ids[0] || entry.outcome_id || '—';
    const primaryOutcome = primaryOutcomeRaw.length > 20
      ? window.vreShort(primaryOutcomeRaw, 8, 8)
      : primaryOutcomeRaw;
    const effectiveWinnersCount = ids.length > 1 ? ids.length : Number(entry.winners_count || 0);
    const winnersText = effectiveWinnersCount > 1 ? `${effectiveWinnersCount} winners` : 'single outcome';
    const statusText = String(entry.verification_result || 'MATCH').toUpperCase();
    const reasonText = String(entry.verification_reason || 'OK').toUpperCase();
    const isMatch = statusText === 'MATCH' && reasonText === 'OK';
    const timelineText = artifactSlot != null && resolutionSlot != null
      ? `slot ${artifactSlot} → ${resolutionSlot}`
      : 'timeline unavailable';
    const updated = entry.updated_utc
      ? new Date(entry.updated_utc).toISOString().replace('T', ' ').slice(0, 19)
      : 'devnet evidence';

    return `
      <article class="sig-card ${isMatch ? 'sig-card-resolved' : 'sig-card-pending'}" data-idx="${idx}">
        <div class="sig-card-head">
          <div>
            <div class="sig-card-label">${escapeHtml(primaryLabel(entry))}</div>
            <div class="sig-card-id mono">${escapeHtml(short)}</div>
          </div>
          <span class="sig-status ${isMatch ? 'sig-status-ok' : 'sig-status-pending'}">${escapeHtml(`${statusText} / ${reasonText}`)}</span>
        </div>
        <div class="sig-card-desc">${escapeHtml(describe(entry))}</div>
        <div class="sig-card-badges">
          ${renderEvidenceBadges(entry)}
        </div>
        <div class="sig-card-body">
          <div class="sig-row">
            <span class="sig-row-label">Formula</span>
            <span class="sig-row-value mono">${escapeHtml(formula)}</span>
          </div>
          <div class="sig-row">
            <span class="sig-row-label">Selected</span>
            <span class="sig-row-value mono text-teal">${escapeHtml(primaryOutcome)}</span>
          </div>
          <div class="sig-row">
            <span class="sig-row-label">Winners</span>
            <span class="sig-row-value">${escapeHtml(winnersText)}</span>
          </div>
          <div class="sig-row">
            <span class="sig-row-label">Timeline</span>
            <span class="sig-row-value">${escapeHtml(timelineText)}</span>
          </div>
          <div class="sig-row">
            <span class="sig-row-label">Artifact</span>
            <span class="sig-row-value mono">${escapeHtml(window.vreShort(entry.compiled_artifact_hash || '—', 10, 6))}</span>
          </div>
          <div class="sig-row">
            <span class="sig-row-label">Updated</span>
            <span class="sig-row-value">${escapeHtml(updated)} UTC</span>
          </div>
          <div class="sig-row">
            <span class="sig-row-label">Runtime ID</span>
            <span class="sig-row-value mono">${escapeHtml(window.vreShort(entry.runtime_id || '—', 8, 8))}</span>
          </div>
          <div class="sig-row">
            <span class="sig-row-label">Resolve ID</span>
            <span class="sig-row-value mono">${escapeHtml(window.vreShort(entry.resolve_id || '—', 8, 8))}</span>
          </div>
          ${gapSlots != null ? `
            <div class="sig-row">
              <span class="sig-row-label">Gap</span>
              <span class="sig-row-value">+${gapSlots} slots</span>
            </div>
          ` : ''}
        </div>
        ${renderWinnerList(entry)}
        <div class="sig-card-foot">
          <a class="btn btn-primary btn-sm" href="/verify?sig=${encodeURIComponent(entry.signature)}">Verify now <span aria-hidden>→</span></a>
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
      const [health, blessed, recent] = await Promise.all([
        loadHealth(),
        getJson('/api/blessed-signatures'),
        getJson(`/api/recent-resolutions?limit=${HISTORICAL_LIMIT}`),
      ]);
      const blessedEntries = (blessed.data?.entries || [])
        .filter((entry) => entry.status === 'active')
        .slice(0, BLESSED_LIMIT)
        .map((entry) => ({ ...entry, source: 'blessed' }));
      const recentEntries = (recent.resolutions || [])
        .slice(0, HISTORICAL_LIMIT)
        .map((entry) => ({
          ...entry,
          source: 'historical',
          timeline: entry.commit_slot != null && entry.resolve_slot != null
            ? {
                artifact_slot: entry.commit_slot,
                resolution_slot: entry.resolve_slot,
                gap_slots: entry.resolve_slot - entry.commit_slot,
              }
            : null,
        }));
      const dedupedRecentEntries = recentEntries.filter(
        (entry) => !blessedEntries.some((blessedEntry) => blessedEntry.signature === entry.signature)
      );
      const entries = [
        ...blessedEntries,
        ...dedupedRecentEntries.slice(0, Math.max(0, TOTAL_SIGNATURE_LIMIT - blessedEntries.length)),
      ].slice(0, TOTAL_SIGNATURE_LIMIT);

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
        timeline: entry.timeline || await loadTimeline(entry, health),
      })));

      listEl.innerHTML = enriched.map((entry, idx) => renderCard(entry, idx, health)).join('');
      const historicalCount = enriched.filter((entry) => entry.source === 'historical').length;
      const blessedCount = enriched.filter((entry) => entry.source === 'blessed').length;
      statusEl.textContent = `Latest transactions · ${enriched.length} total · ${blessedCount} blessed · ${historicalCount} historical · last 24h`;
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
