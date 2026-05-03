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

  function boot() {
    initTheme();
    ensureGrain();
    markActiveNav();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
