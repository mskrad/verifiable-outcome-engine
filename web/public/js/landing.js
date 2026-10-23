(function () {
  'use strict';

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting || e.boundingClientRect.bottom < 0) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.rise').forEach((el) => io.observe(el));

  const FIRST = 148, LAST = 177, BASE = '498,395,';
  const SKIPPED = new Set([164, 165, 166, 167, 168, 169, 170, 171]);
  const TARGETS = { 156: '+8', 164: '+16', 172: '+24' };
  const HASH = { 156: 'F7JaN3cs…2KcKk', 172: 'EWiiX8op…Hfyp3', 173: 'CEUi62U4…MwEnd' };
  const NOTE = { 156: '(+8)', 172: '(stands in for +16)', 173: '(+24: first slot after 172)' };
  const PARTS = ['3nafSu…TMFR9', '5RbvSH…9AeR4', '5a38vh…K5xjP', '9Kpwjb…P1J8r', 'ABKKER…dHZqY', 'Aip3wC…tPvEU', 'BKo2rX…6oNa4'];

  const $ = (id) => document.getElementById(id);
  const ribbon = $('ribbon'), playhead = $('playhead'), log = $('log'), partsEl = $('parts');
  if (!ribbon || !playhead || !log || !partsEl) return;

  const cells = {};
  for (let s = FIRST; s <= LAST; s++) {
    const c = document.createElement('div');
    c.className = 'slot';
    c.innerHTML = `<span class="n">${s}</span>`;
    if (TARGETS[s]) c.dataset.off = TARGETS[s];
    ribbon.appendChild(c);
    cells[s] = c;
  }
  partsEl.innerHTML = PARTS.map((p) => `<div class="part"><span>${p}</span><span class="bar"><i></i></span><span class="wt">1000</span></div>`).join('');
  const rows = [...partsEl.children];

  function line(slot, html) {
    const d = document.createElement('div');
    d.className = 'log-line';
    d.innerHTML = `<span class="s">${slot}</span><span>${html}</span>`;
    log.appendChild(d);
    while (log.children.length > 10) log.removeChild(log.firstChild);
    if (reduce) d.classList.add('in');
    else requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('in')));
  }
  function phase(cls, text) { $('phase-dot').className = 'v3-dot ' + cls; $('phase-label').textContent = text; }
  function move(s) {
    const c = cells[s];
    if (c) playhead.style.transform = `translate(${c.offsetLeft + c.offsetWidth / 2 - 1}px, ${c.offsetTop}px)`;
  }
  function verdict(state) {
    const tag = $('verdict-tag');
    $('verdict').classList.toggle('ok', state === 'ok');
    $('verdict-t').textContent = state === 'ok' ? 'replayed from public RPC · 1.9 s' : state === 'run' ? 'replaying from public RPC…' : 'replay from public RPC';
    tag.className = 'v3-status' + (state === 'ok' ? ' ok solid' : '');
    tag.textContent = state === 'ok' ? 'MATCH' : state === 'run' ? '…' : 'pending';
  }
  function step(s, silent) {
    const c = cells[s];
    if (s === FIRST) {
      c.classList.add('commit');
      Object.keys(TARGETS).forEach((t) => cells[t].classList.add('target'));
      if (!silent) { line(BASE + s, '<b>prepare_rng_v2</b> · draw opened on artifact 11d30b3b… · targets 156 · 164 · 172'); phase('warn', 'waiting for target slots'); }
      return;
    }
    if (SKIPPED.has(s)) {
      c.classList.add('skipped');
      if (s === 164) { c.classList.add('miss'); if (!silent) line(BASE + s, '<span class="w">target +16: no block</span> · the next produced slot will stand in'); }
      return;
    }
    c.classList.add('produced');
    if (HASH[s]) { c.classList.add('resolved'); if (!silent) line(BASE + s, `slot hash <b>${HASH[s]}</b> <span class="s">${NOTE[s]}</span>`); }
  }
  function settle(silent) {
    rows[0].classList.add('win');
    if (!silent) {
      line(BASE + '203', '<b>settle_rng_v2</b> · reads SlotHashes · seed = SHA-256(artifact, runtime, slots, slot hashes)');
      line(BASE + '203', 'weighted pick → winner <b>3nafSu…TMFR9</b>');
      phase('', 'winner written');
    }
  }
  function reset() {
    log.innerHTML = '';
    Object.values(cells).forEach((c) => { c.className = 'slot'; });
    rows.forEach((r) => r.classList.remove('win'));
    verdict('idle');
    playhead.style.transition = 'none'; move(FIRST); void playhead.offsetWidth; playhead.style.transition = '';
  }

  if (reduce) {
    for (let s = FIRST; s <= LAST; s++) step(s, true);
    settle(true); verdict('ok'); phase('', 'match'); move(LAST);
  } else {
    const TICK = 400;
    let running = false, visible = false;
    const at = (ms, fn) => setTimeout(fn, ms);
    const run = () => {
      running = true; reset(); phase('idle', 'rules committed');
      line(BASE + '120', 'artifact <b>11d30b3b…</b> committed · runtime 164bb2e4 bound');
      let t = 500;
      for (let s = FIRST; s <= LAST; s++) { const slot = s; at(t, () => { move(slot); step(slot); }); t += TICK; }
      at(t + 300, () => phase('warn', 'settling'));
      at(t + 900, () => settle());
      at(t + 1700, () => { verdict('run'); line('replay', 'rebuild artifact from chain · recompute seed from recorded hashes'); });
      at(t + 3600, () => { verdict('ok'); line('replay', '<span class="ok">MATCH / OK</span> · same winner, event and account agree'); phase('', 'match'); });
      at(t + 9000, () => { if (visible && !document.hidden) run(); else running = false; });
    };
    new IntersectionObserver((es) => {
      visible = es[0].isIntersecting;
      if (visible && !running && !document.hidden) run();
    }, { threshold: 0.25 }).observe(document.querySelector('.inst'));
    document.addEventListener('visibilitychange', () => { if (!document.hidden && visible && !running) run(); });
    window.addEventListener('resize', () => {
      const last = [...ribbon.querySelectorAll('.slot.produced, .slot.skipped, .slot.commit')].pop();
      playhead.style.transition = 'none'; move(last ? +last.textContent : FIRST); void playhead.offsetWidth; playhead.style.transition = '';
    });
    move(FIRST);
  }

  const SIG = 'MVE6v5ZGeBYYSKqDbp9kpVY85VKgSGXbFgUkh3eh2E1Xh7z2TPW3NZHfx2WSi2ERvVjuZB4LCP3nh1MN1YFAy5H';
  const CODE = {
    cli: `<span class="tok-c"># no install, no key</span>\n<span class="tok-k">npx</span> -p verifiable-outcome-sdk vre verify \\\n  --sig ${SIG}`,
    ts: `<span class="tok-k">import</span> { verifyOutcome } <span class="tok-k">from</span> <span class="tok-s">"verifiable-outcome-sdk"</span>;\n\n<span class="tok-k">const</span> result = <span class="tok-k">await</span> verifyOutcome({\n  signature: <span class="tok-s">"${SIG}"</span>,\n  rpcUrl: <span class="tok-s">"https://api.devnet.solana.com"</span>,\n  programId: <span class="tok-s">"6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B"</span>,\n});\n<span class="tok-c">// result.status === "MATCH", result.reason === "OK"</span>`,
    http: `<span class="tok-k">curl</span> -X POST https://verifiableoutcome.online/api/replay \\\n  -H <span class="tok-s">"content-type: application/json"</span> \\\n  -d <span class="tok-s">'{"signature":"${SIG}"}'</span>`,
  };
  const pre = $('vcode'), tabs = $('vtabs');
  if (!pre || !tabs) return;
  const ind = tabs.querySelector('.seg-ind');
  const buttons = [...tabs.querySelectorAll('button')];
  const place = () => {
    const on = buttons.find((b) => b.getAttribute('aria-selected') === 'true');
    if (on) { ind.style.width = on.offsetWidth + 'px'; ind.style.transform = `translateX(${on.offsetLeft}px)`; }
  };
  pre.innerHTML = CODE.cli;
  buttons.forEach((b) => b.addEventListener('click', () => {
    buttons.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    place();
    pre.classList.add('swap');
    setTimeout(() => { pre.innerHTML = CODE[b.dataset.t]; pre.classList.remove('swap'); }, 160);
  }));
  $('vcopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(pre.textContent); window.vreToast && window.vreToast('Copied'); }
    catch (_) { window.vreToast && window.vreToast('Copy failed'); }
  });
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(place);
  window.addEventListener('resize', place);
})();
