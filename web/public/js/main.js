/* ================================================================
   VRE — shared client utilities + 2026 theme controls
   ================================================================ */

(function () {
  'use strict';

  const root = document.documentElement;

  function initTheme() {
    // The site ships one appearance. Clear anything a previous build's design-system
    // panel left in storage so an old session cannot pin a stale theme.
    ['vre-theme', 'vre-palette', 'vre-display', 'vre-density'].forEach((key) => {
      try { localStorage.removeItem(key); } catch (_) { /* private mode */ }
    });
    root.setAttribute('data-theme', 'dark');
    root.removeAttribute('data-palette');
    root.removeAttribute('data-display');
    root.removeAttribute('data-density');
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
      '/examples': 'examples',
      '/examples.html': 'examples',
      '/build': 'build',
      '/build.html': 'build',
      '/verify': 'verify',
      '/verify.html': 'verify',
      '/widget': 'widget',
      '/widget.html': 'widget',
      '/spec': 'spec',
      '/spec.html': 'spec',
      '/protocol-paths': 'protocol-paths',
      '/protocol-paths.html': 'protocol-paths',
    };
    const key = map[path] || '';
    document.querySelectorAll('[data-nav]').forEach((link) => {
      if (link.getAttribute('data-nav') === key) {
        link.classList.add('active');
      }
    });
  }

  function initNavMenu() {
    const toggle = document.querySelector('[data-nav-toggle]');
    const menu = document.getElementById('nav-menu');
    if (!toggle || !menu) return;

    const isOpen = () => menu.hasAttribute('data-open');

    function setOpen(open) {
      if (open) menu.setAttribute('data-open', '');
      else menu.removeAttribute('data-open');
      toggle.setAttribute('aria-expanded', String(open));
    }

    toggle.addEventListener('click', () => setOpen(!isOpen()));

    // Following a link closes the menu; the appearance control does not.
    menu.addEventListener('click', (e) => {
      if (e.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !isOpen()) return;
      setOpen(false);
      toggle.focus();
    });

    document.addEventListener('click', (e) => {
      if (isOpen() && !e.target.closest('.nav-inner')) setOpen(false);
    });

    // Crossing back to the desktop bar must not leave a stale open state.
    const wide = window.matchMedia('(min-width: 941px)');
    const onWide = (e) => { if (e.matches) setOpen(false); };
    if (wide.addEventListener) wide.addEventListener('change', onWide);
    else wide.addListener(onWide);
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
    initNavMenu();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
