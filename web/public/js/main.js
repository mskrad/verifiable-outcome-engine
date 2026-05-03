/* ================================================================
   VRE — shared client utilities + 2026 theme controls
   ================================================================ */

(function () {
  'use strict';

  const root = document.documentElement;

  function initTheme() {
    const theme = localStorage.getItem('vre-theme') || 'dark';
    root.setAttribute('data-theme', theme);

    const palette = localStorage.getItem('vre-palette');
    if (palette) root.setAttribute('data-palette', palette);

    const display = localStorage.getItem('vre-display');
    if (display) root.setAttribute('data-display', display);

    const density = localStorage.getItem('vre-density');
    if (density) root.setAttribute('data-density', density);
  }

  function ensureGrain() {
    if (document.querySelector('.grain')) return;
    const grain = document.createElement('div');
    grain.className = 'grain';
    document.body.prepend(grain);
  }

  function markActiveNav() {
    const path = location.pathname.replace(/\/$/, '') || '/';
    const map = {
      '/': 'index',
      '/index.html': 'index',
      '/play': 'play',
      '/play.html': 'play',
      '/build': 'build',
      '/build.html': 'build',
      '/verify': 'verify',
      '/verify.html': 'verify',
      '/widget': 'widget',
      '/widget.html': 'widget',
      '/spec': 'spec',
      '/spec.html': 'spec',
    };
    const key = map[path] || '';
    document.querySelectorAll('[data-nav]').forEach((link) => {
      if (link.getAttribute('data-nav') === key) {
        link.classList.add('active');
      }
    });
  }

  let toastTimer;
  window.vreToast = function (message) {
    let toast = document.getElementById('vre-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'vre-toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  };

  async function handleCopy(text) {
    try {
      await navigator.clipboard.writeText(text);
      window.vreToast('Copied');
    } catch (_) {
      window.vreToast('Copy failed');
    }
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (btn) {
      await handleCopy(btn.getAttribute('data-copy') || '');
      return;
    }

    const toggle = e.target.closest('[data-theme-toggle]');
    if (toggle) {
      const current = root.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      localStorage.setItem('vre-theme', next);
    }
  });

  window.vreShort = function (hash, head = 8, tail = 8) {
    if (!hash) return '';
    const value = String(hash);
    if (value.length <= head + tail + 3) return value;
    return `${value.slice(0, head)}…${value.slice(-tail)}`;
  };

  function shortAddress(address) {
    return window.vreShort(String(address || ''), 4, 4);
  }

  function readConnectedPhantom() {
    const provider = window.solana;
    if (!provider?.isPhantom) return { status: 'not-installed' };
    if (provider.isConnected && provider.publicKey) {
      const address = provider.publicKey.toString();
      return { status: 'connected', address, shortAddress: shortAddress(address) };
    }
    return { status: 'not-connected' };
  }

  async function connectPhantom() {
    const provider = window.solana;
    if (!provider?.isPhantom) return { status: 'not-installed' };
    const resp = await provider.connect();
    const publicKey = resp?.publicKey || provider.publicKey;
    if (!publicKey) return { status: 'not-connected' };
    const address = publicKey.toString();
    return { status: 'connected', address, shortAddress: shortAddress(address) };
  }

  window.vreWallet = { connectPhantom, readConnectedPhantom, shortAddress };

  const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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

  window.vreDidIWin = {
    looksLikeSolanaAddress,
    hasAddressOutcomes,
    didIWin,
  };

  window.vrePrettyJson = function (obj) {
    const json = JSON.stringify(obj, null, 2);
    return json.replace(
      /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'n';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'k' : 's';
        } else if (/true|false|null/.test(match)) {
          cls = 'b';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
  };

  function buildTweaks() {
    const panel = document.createElement('div');
    panel.className = 'tweaks-panel';
    panel.innerHTML = `
      <div class="tweaks-head">
        <span class="tweaks-title">Theme</span>
        <button class="tweaks-close" aria-label="Close">×</button>
      </div>
      <div class="tweaks-row">
        <span class="tweaks-label">Theme</span>
        <div class="tweaks-options" data-key="theme">
          <button data-val="dark">Dark</button>
          <button data-val="light">Light</button>
        </div>
      </div>
      <div class="tweaks-row">
        <span class="tweaks-label">Palette</span>
        <div class="tweaks-options" data-key="palette">
          <button data-val="">Solana</button>
          <button data-val="indigo">Indigo</button>
          <button data-val="mono">Mono</button>
        </div>
      </div>
      <div class="tweaks-row">
        <span class="tweaks-label">Display</span>
        <div class="tweaks-options" data-key="display">
          <button data-val="">Geist</button>
          <button data-val="serif">Serif</button>
          <button data-val="mono">Mono</button>
        </div>
      </div>
      <div class="tweaks-row">
        <span class="tweaks-label">Density</span>
        <div class="tweaks-options" data-key="density">
          <button data-val="">Default</button>
          <button data-val="dense">Dense</button>
          <button data-val="spacious">Spacious</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    const fab = document.createElement('button');
    fab.className = 'tweaks-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Open theme tweaks');
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    document.body.appendChild(fab);

    function syncTweaks() {
      panel.querySelectorAll('.tweaks-options').forEach((group) => {
        const key = group.getAttribute('data-key');
        const current = key === 'theme'
          ? (root.getAttribute('data-theme') || 'dark')
          : (root.getAttribute(`data-${key}`) || '');
        group.querySelectorAll('button').forEach((button) => {
          button.classList.toggle('active', (button.getAttribute('data-val') || '') === current);
        });
      });
    }

    panel.querySelectorAll('.tweaks-options').forEach((group) => {
      const key = group.getAttribute('data-key');
      group.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;
        const value = button.getAttribute('data-val') || '';
        if (key === 'theme') {
          root.setAttribute('data-theme', value || 'dark');
          localStorage.setItem('vre-theme', value || 'dark');
        } else if (value) {
          root.setAttribute(`data-${key}`, value);
          localStorage.setItem(`vre-${key}`, value);
        } else {
          root.removeAttribute(`data-${key}`);
          localStorage.removeItem(`vre-${key}`);
        }
        syncTweaks();
      });
    });

    fab.addEventListener('click', () => panel.classList.add('open'));
    panel.querySelector('.tweaks-close').addEventListener('click', () => panel.classList.remove('open'));
    syncTweaks();
  }

  function boot() {
    initTheme();
    ensureGrain();
    markActiveNav();
    buildTweaks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
