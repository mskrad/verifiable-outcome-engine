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

  // ── Wallet layer ──────────────────────────────────────────────────────────
  // Wallet Standard, no dependencies and no build step. Every Solana wallet that
  // implements the standard registers itself here — Phantom, Solflare, Backpack,
  // Brave — so nothing is hardcoded to one vendor. We only ever read the public
  // key: the pages never sign, all signing happens with the operator key server
  // side, which is why connect + accounts is the whole surface we need.
  const walletRegistry = new Map(); // name → wallet
  const walletListeners = new Set();
  const walletUnsubscribers = new Map(); // name → () => void
  const SELECTED_WALLET_KEY = 'vre.wallet.name';

  function isSolanaWallet(wallet) {
    if (!wallet || typeof wallet.name !== 'string') return false;
    const chains = Array.isArray(wallet.chains) ? wallet.chains : [];
    if (!chains.some((chain) => String(chain).startsWith('solana:'))) return false;
    const features = wallet.features || {};
    return Boolean(features['standard:connect'] && features['standard:events']);
  }

  function notifyWalletChange() {
    const state = readConnected();
    walletListeners.forEach((cb) => {
      try { cb(state); } catch (_) { /* a broken listener must not break the rest */ }
    });
  }

  function registerWallet(wallet) {
    if (!isSolanaWallet(wallet) || walletRegistry.has(wallet.name)) return;
    walletRegistry.set(wallet.name, wallet);
    // Accounts change when the user switches or disconnects inside the wallet UI;
    // without this the page keeps showing a stale address.
    try {
      const off = wallet.features['standard:events'].on('change', notifyWalletChange);
      if (typeof off === 'function') walletUnsubscribers.set(wallet.name, off);
    } catch (_) { /* events are optional in practice */ }
    notifyWalletChange();
  }

  // Both halves of the handshake are required: the listener catches wallets that
  // load after this script, the dispatch catches the ones already present.
  const walletStandardApi = {
    register(...wallets) {
      wallets.flat().forEach(registerWallet);
      return () => {};
    },
  };
  window.addEventListener('wallet-standard:register-wallet', (event) => {
    try { event.detail(walletStandardApi); } catch (_) { /* ignore a malformed wallet */ }
  });
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: walletStandardApi }));

  function walletAccount(wallet) {
    const accounts = wallet && Array.isArray(wallet.accounts) ? wallet.accounts : [];
    return accounts.find((account) => typeof account?.address === 'string') || null;
  }

  function connectedState(wallet, account) {
    return {
      status: 'connected',
      address: account.address,
      shortAddress: shortAddress(account.address),
      wallet: wallet.name,
      icon: wallet.icon || null,
    };
  }

  function preferredWallet() {
    const remembered = walletRegistry.get(readStoredWalletName());
    if (remembered) return remembered;
    return walletRegistry.values().next().value || null;
  }

  function readStoredWalletName() {
    try { return localStorage.getItem(SELECTED_WALLET_KEY) || ''; } catch (_) { return ''; }
  }

  function rememberWallet(name) {
    try { localStorage.setItem(SELECTED_WALLET_KEY, name); } catch (_) { /* private mode */ }
  }

  // Legacy injected providers that predate the standard. Phantom registers properly,
  // so this only covers stragglers; drop it once telemetry says nobody lands here.
  function legacyProvider() {
    const provider = window.solana;
    return provider && (provider.isPhantom || provider.isConnected || provider.publicKey)
      ? provider
      : null;
  }

  function listWallets() {
    return [...walletRegistry.values()].map((wallet) => ({ name: wallet.name, icon: wallet.icon || null }));
  }

  function readConnected() {
    for (const wallet of walletRegistry.values()) {
      const account = walletAccount(wallet);
      if (account) return connectedState(wallet, account);
    }
    if (walletRegistry.size > 0) return { status: 'not-connected' };

    const provider = legacyProvider();
    if (provider?.publicKey) {
      const address = provider.publicKey.toString();
      return { status: 'connected', address, shortAddress: shortAddress(address), wallet: 'Wallet' };
    }
    return { status: provider ? 'not-connected' : 'not-installed' };
  }

  async function connect(name) {
    const wallet = name ? walletRegistry.get(name) : preferredWallet();
    if (wallet) {
      const result = await wallet.features['standard:connect'].connect();
      const accounts = Array.isArray(result?.accounts) ? result.accounts : wallet.accounts;
      const account = (accounts || []).find((entry) => typeof entry?.address === 'string');
      if (!account) return { status: 'not-connected' };
      rememberWallet(wallet.name);
      return connectedState(wallet, account);
    }

    const provider = legacyProvider();
    if (!provider) return { status: 'not-installed' };
    const resp = await provider.connect();
    const publicKey = resp?.publicKey || provider.publicKey;
    if (!publicKey) return { status: 'not-connected' };
    const address = publicKey.toString();
    return { status: 'connected', address, shortAddress: shortAddress(address), wallet: 'Wallet' };
  }

  function onWalletChange(callback) {
    if (typeof callback !== 'function') return () => {};
    walletListeners.add(callback);
    return () => walletListeners.delete(callback);
  }

  window.vreWallet = {
    listWallets,
    readConnected,
    connect,
    onChange: onWalletChange,
    shortAddress,
    // Kept for one release so nothing breaks mid-deploy; callers moved to the names above.
    readConnectedPhantom: readConnected,
    connectPhantom: () => connect(),
  };

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
