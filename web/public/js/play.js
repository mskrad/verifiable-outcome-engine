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

  const USE_CASE_BADGES = {
    raffle:     { label: 'Raffle',     cls: 'badge-use-raffle' },
    airdrop:    { label: 'Airdrop',    cls: 'badge-use-airdrop' },
    prediction: { label: 'Prediction', cls: 'badge-use-prediction' },
    loot:       { label: 'Loot',       cls: 'badge-use-loot' },
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
    if (!res.ok) throw new Error(json.error || `POST ${path} failed`);
    return json;
  }

  function inferUseCase(entry) {
    const text = [
      entry.label,
      entry.description,
      entry.source,
      entry.notes,
      entry.id,
    ].filter(Boolean).join(' ').toLowerCase();

    if (text.includes('airdrop')) return 'airdrop';
    if (text.includes('prediction')) return 'prediction';
    if (text.includes('raffle') || entry.signature === RAFFLE_SIG) return 'raffle';
    if (text.includes('loot')) return 'loot';
    return 'loot';
  }

  function describe(entry, useCase) {
    if (entry.description) return entry.description;
    if (entry.notes) return entry.notes;
    return {
      raffle: 'Weighted raffle draw resolved',
      airdrop: 'Weighted eligible-list selection resolved',
      prediction: 'Prediction outcome declaration resolved',
      loot: 'Weighted loot outcome resolved',
    }[useCase] || 'Verifiable outcome resolved';
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
          <a class="btn btn-primary btn-sm" href="verify.html?sig=${encodeURIComponent(entry.signature)}">▶ Verify Now</a>
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
        getJson('/api/health'),
        getJson('/api/blessed-signatures'),
      ]);
      const entries = (blessed.data?.entries || [])
        .filter((entry) => entry.status === 'active');

      if (!entries.length) {
        listEl.innerHTML = `
          <div class="empty-state">
            <div style="font-size:15px;color:var(--text);margin-bottom:6px;">No active signatures yet</div>
            <div>The blessed signature bundle has no active entries.<br/>
                 Paste a signature on the <a href="verify.html" class="text-teal">verify page</a>.</div>
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

  document.addEventListener('DOMContentLoaded', loadSignatures);
})();
