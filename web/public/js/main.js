/* ================================================================
   VRE — Shared client utilities
   ================================================================ */

(function () {
  'use strict';

  // Highlight active nav link based on current pathname
  function markActiveNav() {
    const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    document.querySelectorAll('[data-nav]').forEach((link) => {
      const key = link.getAttribute('data-nav');
      if (path === key || (path === '' && key === 'index.html')) {
        link.classList.add('active');
      }
    });
  }

  // Toast notification
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

  // Copy-to-clipboard for any element with [data-copy]
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const text = btn.getAttribute('data-copy');
    try {
      await navigator.clipboard.writeText(text);
      window.vreToast('Copied to clipboard');
    } catch (err) {
      window.vreToast('Copy failed');
    }
  });

  // Short-hash helper exposed for other scripts
  window.vreShort = function (hash, head = 8, tail = 8) {
    if (!hash) return '';
    if (hash.length <= head + tail + 3) return hash;
    return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
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

  window.vreDidIWin = window.vreDidIWin || {
    looksLikeSolanaAddress,
    hasAddressOutcomes,
    didIWin,
  };

  // Syntax-highlight JSON inside <pre class="raw-json">
  window.vrePrettyJson = function (obj) {
    const json = JSON.stringify(obj, null, 2);
    return json.replace(
      /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'n';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'k' : 's';
        } else if (/true|false/.test(match)) {
          cls = 'b';
        } else if (/null/.test(match)) {
          cls = 'b';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
  };

  document.addEventListener('DOMContentLoaded', markActiveNav);
})();
