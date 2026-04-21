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
