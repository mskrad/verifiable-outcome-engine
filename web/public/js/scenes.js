(function () {
  'use strict';

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const WALLETS = ['3nafSu…TMFR9', '5RbvSH…9AeR4', '5a38vh…K5xjP', '9Kpwjb…P1J8r', 'ABKKER…dHZqY', 'Aip3wC…tPvEU', 'BKo2rX…6oNa4'];

  function scene(root, durations, play) {
    const steps = [...root.querySelectorAll('.vx-st')];
    let loop = [];
    let running = false;
    let visible = false;
    const stepUI = (i) => steps.forEach((s, k) => {
      s.classList.toggle('is-on', k === i);
      const f = s.querySelector('.vx-fill');
      if (!f) return;
      f.style.transition = 'none';
      f.style.height = '0';
      if (k === i && !reduce) {
        void f.offsetHeight;
        f.style.transition = `height ${durations[i]}ms linear`;
        f.style.height = 'calc(100% - 32px)';
      }
    });
    const go = (i) => { stepUI(i); play(i); };
    const stop = () => { loop.forEach(clearTimeout); loop = []; };
    const run = () => {
      running = true;
      stop();
      let t = 0;
      durations.forEach((d, i) => { loop.push(setTimeout(() => go(i), t)); t += d; });
      loop.push(setTimeout(() => { if (visible && !document.hidden) run(); else running = false; }, t + 500));
    };
    steps.forEach((s) => s.addEventListener('click', () => { stop(); running = false; go(+s.dataset.i); }));
    if (reduce) { go(durations.length - 1); return; }
    new IntersectionObserver((es) => {
      visible = es[0].isIntersecting;
      if (visible && !running && !document.hidden) run();
    }, { threshold: 0.3 }).observe(root);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && visible && !running) run(); });
  }

  function device(root) {
    const panel = root.querySelector('[data-vx-panel]');
    panel.innerHTML = `
      <div class="vx-stage"><div class="vx-device" role="img" aria-label="Example app running a VRE draw: entries close, future slots decide, the winner appears and the proof replays to MATCH">
        <div class="vx-screen">
          <div class="vx-island"></div>
          <div class="vx-sbar"><span>12:00</span><i></i></div>
          <div class="vx-app">
            <div class="vx-app-top"><span class="vx-app-logo"><b>R</b>Raffle</span><span class="vx-pill"><span class="vx-pdot"></span><span data-r="pill">open</span></span></div>
            <h4>Weekly raffle</h4>
            <div class="vx-sub">7 entries · 1 winner · equal weights</div>
            <div class="vx-entries" data-r="entries">${WALLETS.map((w) => `<div class="vx-entry"><span>${w}</span><span class="vx-w"></span></div>`).join('')}</div>
          </div>
          <div class="vx-layer" data-r="commit"><div class="vx-card"><div class="vx-row"><span>Rules committed on Solana</span><span class="vx-pill">locked</span></div><div class="vx-m">artifact 11d30b3b…b032</div></div></div>
          <div class="vx-layer is-off" data-r="draw"><div class="vx-card">
            <div class="vx-clock"><span>slot <b data-r="slot">498,395,148</b></span><span data-r="drawt">waiting</span></div>
            <div class="vx-track"><div class="vx-tgt" data-r="t0"><b>+8</b><span>156</span></div><div class="vx-tgt" data-r="t1"><b>+16</b><span>172</span></div><div class="vx-tgt" data-r="t2"><b>+24</b><span>173</span></div></div>
          </div></div>
          <div class="vx-layer is-off" data-r="win"><div class="vx-winner"><div class="vx-k">winner</div><div class="vx-a">3nafSu…TMFR9</div><div class="vx-btn-row"><span class="vx-vbtn" data-r="vbtn">View proof</span><span class="vx-verified">sig MVE6v5…FAy5H</span></div></div></div>
          <div class="vx-touch" data-r="touch"></div>
          <div class="vx-scrim" data-r="scrim"></div>
          <div class="vx-sheet" data-r="sheet">
            <div class="vx-grab"></div>
            <h5>Proof <span class="vx-pill">devnet</span></h5>
            <dl><dt>signature</dt><dd>MVE6v5…FAy5H</dd><dt>formula</dt><dd>weighted_random</dd><dt>slots</dt><dd>156 · 172 · 173</dd><dt>hashes</dt><dd>F7JaN3cs… EWiiX8op… CEUi62U4…</dd><dt>winner</dt><dd>3nafSu…TMFR9</dd></dl>
            <div class="vx-replay" data-r="replay"><span data-r="replayt">replaying from public RPC…</span><span class="v3-status" data-r="replays">…</span></div>
          </div>
        </div>
      </div></div>`;
    const r = (k) => panel.querySelector(`[data-r="${k}"]`);
    const entries = [...r('entries').children];
    let ph = [];
    const later = (ms, fn) => ph.push(setTimeout(fn, ms));
    const show = (k, on) => r(k).classList.toggle('is-off', !on);
    const matchState = (on) => {
      r('replay').classList.toggle('is-ok', on);
      r('replayt').textContent = on ? 'same winner, replayed' : 'replaying from public RPC…';
      r('replays').className = 'v3-status' + (on ? ' ok solid' : '');
      r('replays').textContent = on ? 'MATCH' : '…';
    };
    function play(i) {
      ph.forEach(clearTimeout); ph = [];
      entries.forEach((e) => e.classList.remove('is-win'));
      ['t0', 't1', 't2'].forEach((t) => r(t).classList.remove('is-hit'));
      ['sheet', 'scrim', 'touch'].forEach((k) => r(k).classList.remove('is-open', 'is-on'));
      r('vbtn').classList.remove('is-press');
      matchState(false);
      r('slot').textContent = '498,395,148';
      r('drawt').textContent = 'waiting';
      r('entries').style.opacity = '1';
      show('commit', i === 0); show('draw', i === 1); show('win', i >= 2);
      r('pill').textContent = ['entries closed', 'drawing', 'settled', 'settled'][i];
      if (i === 1) {
        r('entries').style.opacity = '0.55';
        [149, 150, 152, 154, 156, 158, 160, 163, 172, 173].forEach((s, k) => later(260 + k * 330, () => {
          r('slot').textContent = '498,395,' + s;
          if (s === 156) r('t0').classList.add('is-hit');
          if (s === 163) r('drawt').textContent = '164–171 empty';
          if (s === 172) { r('t1').classList.add('is-hit'); r('drawt').textContent = 'waiting'; }
          if (s === 173) { r('t2').classList.add('is-hit'); r('drawt').textContent = '3 of 3 hashes'; }
        }));
      }
      if (i >= 2) entries[0].classList.add('is-win');
      if (i === 3) {
        if (reduce) { r('sheet').classList.add('is-open'); r('scrim').classList.add('is-on'); matchState(true); return; }
        const b = r('vbtn').getBoundingClientRect();
        const sc = r('touch').parentElement.getBoundingClientRect();
        r('touch').style.left = (b.left - sc.left + b.width / 2) + 'px';
        r('touch').style.top = (b.top - sc.top + b.height / 2) + 'px';
        later(350, () => { r('touch').classList.add('is-on'); r('vbtn').classList.add('is-press'); });
        later(620, () => { r('vbtn').classList.remove('is-press'); r('touch').classList.remove('is-on'); r('sheet').classList.add('is-open'); r('scrim').classList.add('is-on'); });
        later(2300, () => matchState(true));
      }
    }
    scene(root, [3200, 4200, 3000, 4600], play);
  }

  function sortition(root) {
    const panel = root.querySelector('[data-vx-panel]');
    panel.innerHTML = `
      <div class="vx-head"><span class="vx-t">sortition · 100 tickets</span><span data-r="count">sealed <b>100</b></span></div>
      <div class="vx-sbox" data-r="box" role="img" aria-label="Illustration: 100 sealed tickets, omega from three future slots, points below the threshold claim">
        <div class="vx-omega" data-r="omega"><span class="vx-sl" data-r="o0">+75</span><span class="vx-sl" data-r="o1">+90</span><span class="vx-sl" data-r="o2">+105</span><span>→</span><span>omega <b data-r="oval">pending</b></span></div>
        <div class="vx-axis" data-r="axis"><span style="left:0">0</span><span style="right:0">2²⁵⁶</span></div>
        <div class="vx-thr" data-r="thr"><span>threshold</span></div>
      </div>`;
    const r = (k) => panel.querySelector(`[data-r="${k}"]`);
    const box = r('box');
    let seed = 1532;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const N = 100;
    const THR = 0.1;
    const pts = Array.from({ length: N }, () => rnd());
    const below = pts.map((v, i) => [v, i]).filter(([v]) => v < THR).map(([, i]) => i);
    const tks = pts.map(() => { const d = document.createElement('div'); d.className = 'vx-tk'; box.appendChild(d); return d; });
    let ph = [];
    let current = 0;
    const geom = () => {
      const W = box.clientWidth;
      const cols = 20;
      const cell = Math.min(22, (W - 20) / cols);
      const gx = (W - cell * (cols - 1)) / 2;
      return { W, grid: (i) => [gx + (i % cols) * cell, 90 + Math.floor(i / cols) * cell], line: (i) => [8 + pts[i] * (W - 16), 294 - ((i * 37) % 9) * 15] };
    };
    function play(i) {
      current = i;
      ph.forEach(clearTimeout); ph = [];
      const g = geom();
      r('thr').style.left = (8 + THR * (g.W - 16)) + 'px';
      const atGrid = i < 2;
      tks.forEach((t, k) => {
        t.className = 'vx-tk' + (atGrid ? '' : ' is-dot');
        const [x, y] = atGrid ? g.grid(k) : g.line(k);
        t.style.transform = `translate(${x}px, ${y}px)`;
      });
      r('omega').classList.toggle('is-show', i >= 1);
      ['o0', 'o1', 'o2'].forEach((o) => r(o).classList.toggle('is-hit', i >= 2));
      r('oval').textContent = i >= 2 ? 'fixed' : 'pending';
      r('axis').classList.toggle('is-show', i >= 2);
      r('thr').classList.toggle('is-show', i >= 2);
      r('count').innerHTML = i < 3 ? `sealed <b>${N}</b>` : 'claimed <b>0</b>';
      if (i === 0 && !reduce) tks.forEach((t, k) => { t.classList.add('is-pre'); ph.push(setTimeout(() => t.classList.remove('is-pre'), 20 + k * 22)); });
      if (i === 1) {
        ['o0', 'o1', 'o2'].forEach((o, k) => ph.push(setTimeout(() => r(o).classList.add('is-hit'), 700 + k * 900)));
        ph.push(setTimeout(() => { r('oval').textContent = 'fixed'; }, 3200));
      }
      if (i === 2 && !reduce) tks.forEach((t, k) => { t.style.transitionDelay = (k % 20) * 12 + 'ms'; ph.push(setTimeout(() => { t.style.transitionDelay = ''; }, 1400)); });
      if (i >= 3) {
        below.forEach((k) => tks[k].classList.add('is-below'));
        below.forEach((k, n) => ph.push(setTimeout(() => {
          tks[k].classList.add('is-claimed');
          r('count').innerHTML = `claimed <b>${n + 1}</b> of ${below.length}`;
        }, reduce ? 0 : 400 + n * 380)));
      }
    }
    scene(root, [3200, 4000, 2800, 5400], play);
    window.addEventListener('resize', () => play(current));
  }

  function unicorn(root) {
    const panel = root.querySelector('[data-vx-panel]');
    panel.innerHTML = `
      <div class="vx-head"><span class="vx-t">seal_randomness_unicorn</span><span data-r="pass">valid proof</span></div>
      <div class="vx-ubox">
        <div class="vx-urow"><span class="vx-chip" data-r="h0">hash 1</span><span class="vx-chip" data-r="h1">hash 2</span><span class="vx-chip" data-r="h2">hash 3</span><span>→</span><span class="vx-chip" data-r="u">u</span></div>
        <div class="vx-box">
          <div class="vx-box-top"><span>VDF · sequential squarings</span><span data-r="vdf">waiting</span></div>
          <div class="vx-lanes">${Array.from({ length: 8 }, (_, k) => `<div class="vx-lane${k ? ' is-idle' : ''}"><i${k ? '' : ' data-r="lane"'}></i></div>`).join('')}</div>
          <div class="vx-note">8 cores: one does the work, more do not help</div>
        </div>
        <div class="vx-urow"><span class="vx-chip" data-r="y">y</span><span class="vx-chip" data-r="pi">π · 256 B</span><span>→</span><span>on-chain</span></div>
        <div class="vx-box">
          <div class="vx-box-top"><span>compute units</span><span data-r="cu"><b>0</b> / 1,400,000</span></div>
          <div class="vx-bar"><i data-r="bar"></i></div>
          <div class="vx-verdict"><span data-r="res">—</span><span data-r="tag"></span></div>
        </div>
      </div>`;
    const r = (k) => panel.querySelector(`[data-r="${k}"]`);
    const fmt = (n) => n.toLocaleString('en-US');
    let ph = [];
    let forged = !reduce;
    let raf = 0;
    function play(i) {
      ph.forEach(clearTimeout); ph = [];
      cancelAnimationFrame(raf);
      if (i === 0) forged = !forged;
      r('pass').textContent = forged ? 'forged proof' : 'valid proof';
      ['h0', 'h1', 'h2'].forEach((h) => { r(h).className = 'vx-chip is-on'; });
      r('u').className = 'vx-chip is-solid';
      r('y').className = 'vx-chip' + (i >= 2 ? ' is-solid' : '');
      r('pi').className = 'vx-chip' + (i >= 2 ? ' is-on' : '');
      r('pi').textContent = forged && i >= 2 ? 'π′ · tampered' : 'π · 256 B';
      const lane = r('lane');
      lane.style.transition = 'none';
      lane.style.transform = `scaleX(${i >= 2 ? 1 : 0})`;
      r('vdf').innerHTML = i >= 2 ? '<b>done</b>' : 'waiting';
      const bar = r('bar');
      bar.style.transition = 'none';
      bar.style.transform = 'scaleX(0)';
      bar.style.background = 'var(--v-text-2)';
      r('cu').innerHTML = '<b>0</b> / 1,400,000';
      r('res').textContent = '—';
      r('tag').innerHTML = '';
      if (i === 0 && !reduce) {
        ['h0', 'h1', 'h2'].forEach((h, k) => { r(h).className = 'vx-chip'; ph.push(setTimeout(() => r(h).classList.add('is-on'), 300 + k * 500)); });
        r('u').className = 'vx-chip';
        ph.push(setTimeout(() => r('u').classList.add('is-solid'), 2000));
      }
      if (i === 1 && !reduce) {
        r('vdf').textContent = 'running';
        void lane.offsetWidth;
        lane.style.transition = 'transform 3800ms linear';
        lane.style.transform = 'scaleX(1)';
        ph.push(setTimeout(() => { r('vdf').innerHTML = '<b>done</b>'; }, 3800));
      }
      if (i === 3) {
        const target = forged ? 143069 : 247476;
        const finish = () => {
          r('cu').innerHTML = `<b>${fmt(target)}</b> / 1,400,000`;
          if (forged) {
            bar.style.background = 'var(--v-err)';
            r('res').textContent = 'proof rejected, no randomness written';
            r('tag').innerHTML = '<span class="v3-status err">InvalidUnicornGProof</span>';
          } else {
            bar.style.background = 'var(--v-ok)';
            r('res').textContent = 'verified · randomness taken from y';
            r('tag').innerHTML = '<span class="v3-status ok solid">VERIFIED</span>';
          }
        };
        if (reduce) { bar.style.transform = `scaleX(${target / 1400000})`; finish(); return; }
        void bar.offsetWidth;
        bar.style.transition = 'transform 1600ms cubic-bezier(0.23, 1, 0.32, 1)';
        bar.style.transform = `scaleX(${target / 1400000})`;
        const t0 = performance.now();
        const tick = () => {
          const p = Math.min(1, (performance.now() - t0) / 1600);
          r('cu').innerHTML = `<b>${fmt(Math.round(target * (1 - Math.pow(1 - p, 3))))}</b> / 1,400,000`;
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        ph.push(setTimeout(finish, 1700));
      }
    }
    scene(root, [2800, 4400, 2400, 4600], play);
  }

  const SCENES = { device, sortition, unicorn };
  document.querySelectorAll('[data-vx]').forEach((root) => {
    const make = SCENES[root.dataset.vx];
    if (make) make(root);
  });
})();
