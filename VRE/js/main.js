/* VRE shared scripts — nav, theme, tweaks, toast */
(function () {
  // ---- Theme ----
  const root = document.documentElement;
  const stored = localStorage.getItem('vre-theme') || 'dark';
  root.setAttribute('data-theme', stored);

  const palette = localStorage.getItem('vre-palette');
  if (palette) root.setAttribute('data-palette', palette);
  const display = localStorage.getItem('vre-display');
  if (display) root.setAttribute('data-display', display);
  const density = localStorage.getItem('vre-density');
  if (density) root.setAttribute('data-density', density);

  function setTheme(t) {
    root.setAttribute('data-theme', t);
    localStorage.setItem('vre-theme', t);
  }

  // ---- Nav active link ----
  const path = location.pathname.replace(/\/$/, '') || '/';
  const map = { '/': 'home', '/index.html': 'home', '/play': 'play', '/play.html': 'play', '/build': 'build', '/build.html': 'build', '/verify': 'verify', '/verify.html': 'verify', '/spec': 'spec', '/spec.html': 'spec' };
  const key = map[path] || '';
  document.querySelectorAll('[data-nav]').forEach(a => {
    if (a.getAttribute('data-nav') === key) a.classList.add('active');
  });

  // ---- Theme toggle ----
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-theme-toggle]');
    if (t) {
      const cur = root.getAttribute('data-theme') || 'dark';
      setTheme(cur === 'dark' ? 'light' : 'dark');
    }
    const c = e.target.closest('[data-copy]');
    if (c) {
      navigator.clipboard.writeText(c.getAttribute('data-copy')).then(() => toast('Copied'));
    }
  });

  // ---- Toast ----
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 1800);
  }
  window.vreToast = toast;

  // ---- Tweaks panel ----
  function buildTweaks() {
    const panel = document.createElement('div');
    panel.className = 'tweaks-panel';
    panel.innerHTML = `
      <div class="tweaks-head">
        <span class="tweaks-title">Tweaks</span>
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
        <span class="tweaks-label">Display font</span>
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
    fab.setAttribute('aria-label', 'Open tweaks');
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    document.body.appendChild(fab);

    const sync = () => {
      panel.querySelectorAll('.tweaks-options').forEach(group => {
        const key = group.getAttribute('data-key');
        const cur = key === 'theme'
          ? (root.getAttribute('data-theme') || 'dark')
          : (root.getAttribute('data-' + key) || '');
        group.querySelectorAll('button').forEach(b => {
          b.classList.toggle('active', (b.getAttribute('data-val') || '') === cur);
        });
      });
    };

    panel.querySelectorAll('.tweaks-options').forEach(group => {
      const key = group.getAttribute('data-key');
      group.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        const val = b.getAttribute('data-val');
        if (key === 'theme') {
          setTheme(val);
        } else if (val) {
          root.setAttribute('data-' + key, val);
          localStorage.setItem('vre-' + key, val);
        } else {
          root.removeAttribute('data-' + key);
          localStorage.removeItem('vre-' + key);
        }
        sync();
      });
    });

    fab.addEventListener('click', () => { panel.classList.add('open'); });
    panel.querySelector('.tweaks-close').addEventListener('click', () => panel.classList.remove('open'));
    sync();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildTweaks);
  } else {
    buildTweaks();
  }

  // ---- Hero flow animation ----
  function animateFlow() {
    const stage = document.querySelector('.flow-stage');
    if (!stage) return;
    const nodes = stage.querySelectorAll('.flow-node');
    if (!nodes.length) return;
    let i = 0;
    setInterval(() => {
      nodes.forEach((n, idx) => {
        n.setAttribute('data-state', idx < i ? 'done' : idx === i ? 'active' : '');
      });
      i = (i + 1) % (nodes.length + 1);
    }, 1400);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', animateFlow);
  } else {
    animateFlow();
  }
})();
