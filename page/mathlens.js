/* MathLens section demos, built on the paper's running example (Figs. 2 and 3):
   find ∠IAF given ∠BDF = 47°, ∠CIF = 112° and ∠DFB = 65°; the answer is 47. */
(function () {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';

  function need(root, selector) {
    const el = root.querySelector(selector);
    if (!el) throw new Error('missing element: ' + selector);
    return el;
  }

  // Coordinates traced from the rendered diagram in Fig. 3(e). The diagram is not drawn to scale.
  const POINTS = { A: [63, 18], G: [628, 51], B: [498, 74], F: [367, 96], I: [148, 131], D: [672, 172], C: [243, 258] };
  const POINT_LABELS = { A: [46, 26], G: [660, 30], B: [528, 50], F: [352, 58], I: [116, 140], D: [686, 194], C: [226, 262] };
  // Every drawn element carries the keys of the semantic-state predicates it comes from.
  const SEGMENTS = [
    { from: 'I', to: 'G', keys: ['col-GBFI'] },
    { from: 'A', to: 'D', keys: ['col-AFD'] },
    { from: 'A', to: 'C', keys: ['col-AIC'] },
    { from: 'B', to: 'D', keys: ['tri-BDF'] },
    // Sub-segments named by Line(...) predicates; drawn only when highlighted.
    { from: 'B', to: 'G', keys: ['line-BG'], overlay: true },
    { from: 'I', to: 'C', keys: ['line-CI'], overlay: true },
  ];
  const TRIANGLES = [
    { pts: ['B', 'D', 'F'], keys: ['tri-BDF'] },
    { pts: ['F', 'I', 'A'], keys: ['tri-FIA'] },
  ];
  const POINT_KEYS = {
    A: ['col-AFD', 'col-AIC', 'tri-FIA', 'query'], B: ['col-GBFI', 'line-BG', 'tri-BDF'],
    C: ['col-AIC', 'line-CI'], D: ['col-AFD', 'tri-BDF'], F: ['col-GBFI', 'col-AFD', 'tri-BDF', 'tri-FIA'],
    G: ['col-GBFI', 'line-BG'], I: ['col-GBFI', 'col-AIC', 'line-CI', 'tri-FIA'],
  };
  const ANGLES = [
    { at: 'D', rays: ['B', 'F'], label: '47°', labelAt: [603, 137], keys: ['ang-BDF'] },
    { at: 'I', rays: ['C', 'F'], label: '112°', labelAt: [192, 162], keys: ['ang-CIF'] },
    { at: 'F', rays: ['D', 'B'], label: '65°', labelAt: [412, 120], keys: ['ang-DFB'] },
    { at: 'A', rays: ['I', 'F'], label: '?', labelAt: [104, 58], keys: ['query'], query: true },
  ];
  const EXTRA_LINE = { from: 'C', to: 'D' };
  const EXTRA_SHAPE = { center: [540, 226], r: 28 };
  const RENAME = { A: 'K', B: 'L', C: 'M', D: 'N', F: 'P', G: 'Q', I: 'R' };
  const CENTER = [367.5, 138];

  function transformer(mode) {
    const [cx, cy] = CENTER;
    if (mode === 'original') return (p) => p;
    if (mode === 'flip') return ([x, y]) => [2 * cx - x, y];
    if (mode === 'rotate') {
      const a = (-25 * Math.PI) / 180;
      const [c, sn] = [Math.cos(a), Math.sin(a)];
      return ([x, y]) => [cx + c * (x - cx) - sn * (y - cy), cy + sn * (x - cx) + c * (y - cy)];
    }
    throw new Error('unknown diagram mode: ' + mode);
  }

  function el(tag, attrs, keys) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (keys) e.dataset.keys = keys.join(' ');
    return e;
  }

  // Arc between two rays at a vertex, always the smaller angle.
  function arcPath(v, p1, p2, r, sector) {
    const a1 = Math.atan2(p1[1] - v[1], p1[0] - v[0]);
    const a2 = Math.atan2(p2[1] - v[1], p2[0] - v[0]);
    let d = a2 - a1;
    while (d <= -Math.PI) d += 2 * Math.PI;
    while (d > Math.PI) d -= 2 * Math.PI;
    const s = [v[0] + r * Math.cos(a1), v[1] + r * Math.sin(a1)];
    const e = [v[0] + r * Math.cos(a2), v[1] + r * Math.sin(a2)];
    const arc = `A ${r} ${r} 0 0 ${d > 0 ? 1 : 0} ${e[0].toFixed(1)} ${e[1].toFixed(1)}`;
    return sector
      ? `M ${v[0]} ${v[1]} L ${s[0].toFixed(1)} ${s[1].toFixed(1)} ${arc} Z`
      : `M ${s[0].toFixed(1)} ${s[1].toFixed(1)} ${arc}`;
  }

  // opts: { mode: 'original' | 'flip' | 'rotate', rename: bool, extraLine: bool, extraShape: bool }
  function renderDiagram(svg, opts) {
    const t = transformer(opts.mode);
    const P = {};
    for (const k in POINTS) P[k] = t(POINTS[k]);
    const name = (k) => (opts.rename ? RENAME[k] : k);
    svg.replaceChildren();
    const xs = [], ys = [];
    const track = ([x, y]) => { xs.push(x); ys.push(y); };

    for (const tri of TRIANGLES) {
      svg.appendChild(el('polygon', { class: 'tri', points: tri.pts.map((k) => P[k].join(',')).join(' ') }, tri.keys));
    }
    for (const a of ANGLES) {
      const [r1, r2] = a.rays.map((k) => P[k]);
      svg.appendChild(el('path', { class: 'asector' + (a.query ? ' q' : ''), d: arcPath(P[a.at], r1, r2, 36, true) }, a.keys));
    }
    const segs = SEGMENTS.slice();
    if (opts.extraLine) segs.push({ from: EXTRA_LINE.from, to: EXTRA_LINE.to, keys: [], extra: true });
    for (const s of segs) {
      const [a, b] = [P[s.from], P[s.to]];
      const cls = 'seg' + (s.overlay ? ' overlay' : '') + (s.extra ? ' extra' : '');
      svg.appendChild(el('line', { class: cls, x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, s.keys));
    }
    if (opts.extraShape) {
      const c = t(EXTRA_SHAPE.center);
      svg.appendChild(el('circle', { class: 'seg extra', cx: c[0], cy: c[1], r: EXTRA_SHAPE.r, fill: 'none' }, []));
      track([c[0] - EXTRA_SHAPE.r, c[1] - EXTRA_SHAPE.r]);
      track([c[0] + EXTRA_SHAPE.r, c[1] + EXTRA_SHAPE.r]);
    }
    for (const a of ANGLES) {
      if (a.query) continue;
      const [r1, r2] = a.rays.map((k) => P[k]);
      svg.appendChild(el('path', { class: 'amark', d: arcPath(P[a.at], r1, r2, 14, false) }, a.keys));
    }
    for (const k in P) {
      svg.appendChild(el('circle', { class: 'pt', cx: P[k][0], cy: P[k][1], r: 3.5 }, POINT_KEYS[k]));
      track(P[k]);
    }
    for (const k in POINT_LABELS) {
      const [x, y] = t(POINT_LABELS[k]);
      const txt = el('text', { class: 'plabel', x, y }, POINT_KEYS[k]);
      txt.textContent = name(k);
      svg.appendChild(txt);
      track([x, y]);
    }
    for (const a of ANGLES) {
      const [x, y] = t(a.labelAt);
      const txt = el('text', { class: 'alabel' + (a.query ? ' q' : ''), x, y }, a.keys);
      txt.textContent = a.label;
      svg.appendChild(txt);
      track([x, y]);
    }
    const pad = 26;
    const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
    svg.setAttribute('viewBox', `${x0.toFixed(0)} ${y0.toFixed(0)} ${(Math.max(...xs) - x0 + pad).toFixed(0)} ${(Math.max(...ys) - y0 + pad).toFixed(0)}`);
    svg.dataset.mode = opts.mode;
  }

  function highlight(root, key) {
    root.querySelectorAll('[data-keys], [data-key]').forEach((e) => {
      const keys = e.dataset.keys !== undefined ? e.dataset.keys.split(' ') : [e.dataset.key];
      e.classList.toggle('hl', key !== null && keys.includes(key));
    });
  }

  // (1)-(3): what the model sees in each test.
  function initTests() {
    const root = need(document, '[data-role=tests]');
    const svg = need(root, '[data-role=tests-diagram]');
    renderDiagram(svg, { mode: 'original', rename: false, extraLine: false, extraShape: false });
    const tabs = [...root.querySelectorAll('[data-test]')];
    const panels = [...root.querySelectorAll('[data-test-panel]')];
    const answer = need(root, '[data-role=tests-answer]');
    const probes = [...root.querySelectorAll('[data-probe]')];
    if (tabs.length !== 3 || panels.length === 0 || probes.length === 0) throw new Error('tests demo is incomplete');

    function selectProbe(p) {
      probes.forEach((q) => q.classList.toggle('active', q === p));
      highlight(svg, p.dataset.probe);
      answer.textContent = p.dataset.answer;
    }
    function selectTest(test) {
      tabs.forEach((b) => {
        const on = b.dataset.test === test;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
      panels.forEach((p) => { p.hidden = !p.dataset.testPanel.split(' ').includes(test); });
      root.dataset.test = test;
      if (test === 'perc') selectProbe(probes.find((p) => p.classList.contains('active')) || probes[0]);
      else { highlight(svg, null); answer.textContent = '47'; }
    }
    tabs.forEach((b) => b.addEventListener('click', () => selectTest(b.dataset.test)));
    probes.forEach((p) => p.addEventListener('click', () => selectProbe(p)));
    selectTest('mm');
  }

  // Error types: wrong answers on (1), by the outcome of (2) and (3).
  const CATEGORIES = {
    'P0R0': 'pr', 'P0R1': 'p', 'P1R0': 'r', 'P1R1': 'mm',
  };
  function initErrors() {
    const root = need(document, '[data-role=errors]');
    const toggles = [...root.querySelectorAll('[data-outcome]')];
    const cells = [...root.querySelectorAll('[data-category]')];
    const results = [...root.querySelectorAll('[data-result]')];
    if (toggles.length !== 3 || cells.length !== 4 || results.length !== 5) throw new Error('error-type demo is incomplete');
    const state = { perc: true, reas: true, mm: false };
    function render() {
      toggles.forEach((b) => {
        const pass = state[b.dataset.outcome];
        const mark = need(b, '.state');
        mark.textContent = pass ? '✓ correct' : '✗ wrong';
        mark.classList.toggle('pass', pass);
        mark.classList.toggle('fail', !pass);
        b.setAttribute('aria-pressed', String(pass));
      });
      const cat = state.mm ? 'correct' : CATEGORIES[`P${state.perc ? 1 : 0}R${state.reas ? 1 : 0}`];
      cells.forEach((c) => c.classList.toggle('active', c.dataset.category === cat));
      results.forEach((r) => { r.hidden = r.dataset.result !== cat; });
      root.dataset.category = cat;
    }
    toggles.forEach((b) => b.addEventListener('click', () => { state[b.dataset.outcome] = !state[b.dataset.outcome]; render(); }));
    render();
  }

  // Data generation: every artifact traces back to a predicate of the semantic state.
  function initGeneration() {
    const root = need(document, '[data-role=gen]');
    const svg = need(root, '[data-role=gen-diagram]');
    renderDiagram(svg, { mode: 'original', rename: false, extraLine: false, extraShape: false });
    const preds = [...root.querySelectorAll('.pred-btn')];
    if (preds.length === 0) throw new Error('generation demo has no predicates');
    let pinned = need(root, '.pred-btn.active').dataset.key;
    function show(key) {
      highlight(root, key);
      preds.forEach((p) => p.classList.toggle('active', p.dataset.key === key));
      root.dataset.key = key;
    }
    root.querySelectorAll('[data-key]').forEach((e) => {
      e.addEventListener('pointerenter', () => show(e.dataset.key));
      e.addEventListener('pointerleave', () => show(pinned));
      e.addEventListener('click', () => { pinned = e.dataset.key; show(pinned); });
    });
    show(pinned);
  }

  // Diagram modifications on the same example; the answer does not change.
  const MODS = {
    original: { mode: 'original', rename: false, extraLine: false, extraShape: false },
    lines: { mode: 'original', rename: false, extraLine: true, extraShape: false },
    shapes: { mode: 'original', rename: false, extraLine: false, extraShape: true },
    flip: { mode: 'flip', rename: false, extraLine: false, extraShape: false },
    rotate: { mode: 'rotate', rename: false, extraLine: false, extraShape: false },
    rename: { mode: 'original', rename: true, extraLine: false, extraShape: false },
  };
  function initModifications() {
    const root = need(document, '[data-role=mods]');
    const svg = need(root, '[data-role=mods-diagram]');
    const question = need(root, '[data-role=mods-question]');
    const buttons = [...root.querySelectorAll('[data-mod]')];
    if (buttons.length !== Object.keys(MODS).length) throw new Error('modification buttons do not match MODS');
    function select(mod) {
      const opts = MODS[mod];
      if (!opts) throw new Error('unknown modification: ' + mod);
      renderDiagram(svg, opts);
      const angle = ['I', 'A', 'F'].map((k) => (opts.rename ? RENAME[k] : k)).join('');
      question.textContent = `Find measure of angle ${angle}.`;
      buttons.forEach((b) => {
        const on = b.dataset.mod === mod;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      root.dataset.mod = mod;
    }
    buttons.forEach((b) => b.addEventListener('click', () => select(b.dataset.mod)));
    select('original');
  }

  function init() {
    initTests();
    initErrors();
    initGeneration();
    initModifications();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
