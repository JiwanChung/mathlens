/* Results explorer: the paper's appendix tables (downstream accuracy across
   diagram modifications, perception-probe accuracy by relation type) drawn as
   grouped bars, one bar per training stage. Data: static/data/results.json,
   exported by scripts/export_page_data.py. null means "not evaluated" (--). */
(function () {
  'use strict';

  const DATA_URL = 'static/data/results.json';
  const DEFAULT_MODEL = 'Revisual-R1-7B';
  const SIZE_ORDER = ['7–9B open', '72B open', 'Closed'];
  const STAGE_VAR = {
    'Backbone': '--s-backbone', 'Text-SFT': '--s-textsft', 'MM-SFT': '--s-mmsft',
    'MM-RL': '--s-mmrl', 'Thinking': '--s-thinking',
  };
  const STAGE_LABEL = {
    'Backbone': 'Backbone', 'Text-SFT': 'Textual SFT', 'MM-SFT': 'Multimodal SFT',
    'MM-RL': 'Multimodal RL', 'Thinking': 'Thinking',
  };
  // Axis labels; "\n" breaks a label over two lines.
  const AXIS_LABEL = {
    'Text': 'Text', 'Raw': 'Raw', 'Base': 'Base', 'Add lines': 'Add\nlines',
    'Add shapes': 'Add\nshapes', 'Flip': 'Flip', 'Merge': 'Merge', 'Rename': 'Rename',
    'Rotate': 'Rotate', 'Consistency': 'Consis-\ntency',
    'Triangle': 'Triangle', 'Quadrilateral': 'Quadri-\nlateral', 'Parallel': 'Parallel',
    'Perpendicular': 'Perpen-\ndicular', 'Collinear': 'Collinear', 'Cocircular': 'Cocircular',
    'Same length': 'Same\nlength', 'Value length': 'Value\nlength',
    'Same angle': 'Same\nangle', 'Value angle': 'Value\nangle',
  };
  // Column groups drawn above the downstream view.
  const DOWNSTREAM_GROUPS = [
    { label: 'Text input', from: 'Text', to: 'Text' },
    { label: 'Diagram input', from: 'Raw', to: 'Rotate' },
    { label: 'Consistency rate', from: 'Consistency', to: 'Consistency' },
  ];
  const NOTES = {
    'Revisual-R1-7B': 'Revisual-R1 adds additional textual RL; the paper groups it as textual SFT → multimodal RL.',
    'GLM-4.1V-9B': 'GLM-4.1V-Thinking is outside the three recipes because its training data is undisclosed.',
  };
  const METRICS = {
    downstream: { columns: 'downstream_columns', unit: 'Accuracy (%) · consistency rate (%)' },
    perception: { columns: 'perception_columns', unit: 'Perception-probe accuracy (%)' },
  };
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function need(root, selector) {
    const el = root.querySelector(selector);
    if (!el) throw new Error('missing element: ' + selector);
    return el;
  }

  function cssVar(name) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!v) throw new Error('CSS variable not defined: ' + name);
    return v;
  }

  function stageColor(variant) {
    if (!(variant in STAGE_VAR)) throw new Error('no color for stage: ' + variant);
    return cssVar(STAGE_VAR[variant]);
  }

  function axisLabel(col) {
    if (!(col in AXIS_LABEL)) throw new Error('no axis label for column: ' + col);
    return AXIS_LABEL[col];
  }

  function el(tag, attrs, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function fmt(v) { return v === null ? 'n/e' : v.toFixed(1); }

  function validate(data) {
    for (const key of ['downstream_columns', 'perception_columns', 'models']) {
      if (!Array.isArray(data[key])) throw new Error('results.json: missing array ' + key);
    }
    for (const m of data.models) {
      if (!SIZE_ORDER.includes(m.size)) throw new Error('unknown size group: ' + m.size);
      for (const s of m.stages) {
        if (s.downstream.length !== data.downstream_columns.length ||
            s.perception.length !== data.perception_columns.length) {
          throw new Error('row length mismatch for ' + m.name + ' / ' + s.variant);
        }
        stageColor(s.variant);
      }
    }
    data.downstream_columns.concat(data.perception_columns).forEach(axisLabel);
    if (!data.models.some((m) => m.name === DEFAULT_MODEL)) throw new Error('default model missing');
  }

  function init(root, data) {
    validate(data);
    const state = { model: DEFAULT_MODEL, metric: 'downstream' };
    const pillsBox = need(root, '[data-role=model-pills]');
    const metricBox = need(root, '[data-role=metric]');
    const title = need(root, '[data-role=title]');
    const recipe = need(root, '[data-role=recipe]');
    const legend = need(root, '[data-role=legend]');
    const chart = need(root, '[data-role=chart]');
    const tip = need(root, '[data-role=tip]');
    const table = need(root, '[data-role=table]');
    const note = need(root, '[data-role=note]');

    // Model pills, one row per size group.
    for (const size of SIZE_ORDER) {
      const row = document.createElement('div');
      row.className = 'ex-row';
      const label = document.createElement('span');
      label.className = 'ex-row-label';
      label.textContent = size;
      const pills = document.createElement('div');
      pills.className = 'pills';
      pills.setAttribute('role', 'group');
      pills.setAttribute('aria-label', size + ' models');
      for (const m of data.models.filter((x) => x.size === size)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pill';
        b.textContent = m.name;
        b.dataset.model = m.name;
        b.addEventListener('click', () => { state.model = m.name; render(); });
        pills.appendChild(b);
      }
      row.append(label, pills);
      pillsBox.appendChild(row);
    }
    metricBox.querySelectorAll('button').forEach((b) => {
      if (!(b.dataset.metric in METRICS)) throw new Error('unknown metric button: ' + b.dataset.metric);
      b.addEventListener('click', () => { state.metric = b.dataset.metric; render(); });
    });

    function current() {
      const m = data.models.find((x) => x.name === state.model);
      if (!m) throw new Error('unknown model: ' + state.model);
      return m;
    }

    function drawChart(model, columns, key) {
      chart.querySelectorAll('svg').forEach((s) => s.remove());
      const W = chart.clientWidth;
      if (W === 0) throw new Error('explorer chart has zero width');
      const top = key === 'downstream' ? 34 : 12, bottom = 46, left = 40, right = 6;
      const H = 330, plotH = H - top - bottom, plotW = W - left - right;
      const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
        'aria-label': `${model.name}: ${METRICS[key].unit} by condition and training stage. Exact values are in the table below.` }, chart);
      const y = (v) => top + plotH * (1 - v / 100);
      const ink = cssVar('--ink'), muted = cssVar('--muted'), rule = cssVar('--rule'), faint = cssVar('--faint');

      for (let t = 0; t <= 100; t += 20) {
        el('line', { x1: left, x2: W - right, y1: y(t), y2: y(t), stroke: t === 0 ? '#bdbdbd' : rule, 'stroke-width': 1 }, svg);
        const lab = el('text', { x: left - 8, y: y(t) + 4, 'text-anchor': 'end', 'font-size': 12, fill: muted }, svg);
        lab.textContent = String(t);
      }

      const n = columns.length, k = model.stages.length;
      const gw = plotW / n;
      const bw = Math.min(20, (gw * 0.74) / k);
      const gx = (i) => left + gw * i + gw / 2;

      if (key === 'downstream') {
        for (const g of DOWNSTREAM_GROUPS) {
          const a = columns.indexOf(g.from), b = columns.indexOf(g.to);
          if (a < 0 || b < 0) throw new Error('downstream group column missing: ' + g.label);
          const x0 = left + gw * a + 6, x1 = left + gw * (b + 1) - 6;
          el('line', { x1: x0, x2: x1, y1: 14, y2: 14, stroke: '#bdbdbd', 'stroke-width': 1 }, svg);
          const t = el('text', { x: (x0 + x1) / 2, y: 9, 'text-anchor': 'middle', 'font-size': 12, fill: muted }, svg);
          t.textContent = g.label;
          if (a > 0) el('line', { x1: left + gw * a, x2: left + gw * a, y1: top, y2: y(0), stroke: rule, 'stroke-width': 1, 'stroke-dasharray': '3 3' }, svg);
        }
      }

      columns.forEach((col, i) => {
        axisLabel(col).split('\n').forEach((line, j) => {
          const t = el('text', { x: gx(i), y: y(0) + 17 + j * 14, 'text-anchor': 'middle', 'font-size': 12, fill: ink }, svg);
          t.textContent = line;
        });
        model.stages.forEach((s, j) => {
          const v = s[key][i];
          const x = gx(i) - (k * bw) / 2 + j * bw;
          if (v === null) {
            const t = el('text', { x: x + bw / 2, y: y(0) - 4, 'text-anchor': 'middle', 'font-size': 9, fill: faint }, svg);
            t.textContent = '–';
            return;
          }
          const r = el('rect', { x: x + 1, y: y(v), width: Math.max(1, bw - 2), height: y(0) - y(v),
            fill: stageColor(s.variant), tabindex: 0, 'aria-label': `${STAGE_LABEL[s.variant]}, ${col}: ${fmt(v)}%` }, svg);
          const show = () => {
            tip.innerHTML = '';
            const head = document.createElement('div');
            head.textContent = `${col}: ${fmt(v)}%`;
            const sub = document.createElement('div');
            sub.className = 'muted';
            sub.textContent = `${STAGE_LABEL[s.variant]} · ${s.checkpoint}`;
            tip.append(head, sub);
            tip.hidden = false;
            const cr = chart.getBoundingClientRect(), rr = r.getBoundingClientRect();
            const tw = tip.offsetWidth;
            let lx = rr.left - cr.left + rr.width / 2 - tw / 2;
            lx = Math.max(0, Math.min(lx, chart.clientWidth - tw));
            tip.style.left = lx + 'px';
            tip.style.top = Math.max(0, rr.top - cr.top - tip.offsetHeight - 8) + 'px';
            r.setAttribute('stroke', ink);
          };
          const hide = () => { tip.hidden = true; r.removeAttribute('stroke'); };
          r.addEventListener('pointerenter', show);
          r.addEventListener('pointerleave', hide);
          r.addEventListener('focus', show);
          r.addEventListener('blur', hide);
        });
      });
    }

    function drawTable(model, columns, key) {
      table.innerHTML = '';
      const thead = document.createElement('thead');
      const hr = document.createElement('tr');
      ['Stage', 'Checkpoint'].concat(columns).forEach((c, i) => {
        const th = document.createElement('th');
        th.textContent = c;
        if (i < 2) th.className = 'l';
        if (i === 1) th.classList.add('ck');
        if (key === 'downstream' && (c === 'Raw' || c === 'Consistency')) th.classList.add('sep');
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      const tbody = document.createElement('tbody');
      const sepIdx = key === 'downstream' ? [columns.indexOf('Raw'), columns.indexOf('Consistency')] : [];
      model.stages.forEach((s) => {
        const tr = document.createElement('tr');
        const t0 = document.createElement('td');
        t0.className = 'l';
        const dot = document.createElement('span');
        dot.className = 'stage-dot';
        dot.style.background = stageColor(s.variant);
        t0.append(dot, STAGE_LABEL[s.variant]);
        const t1 = document.createElement('td');
        t1.className = 'l ck';
        t1.textContent = s.checkpoint;
        tr.append(t0, t1);
        s[key].forEach((v, i) => {
          const td = document.createElement('td');
          td.textContent = fmt(v);
          if (v === null) td.classList.add('ne');
          if (sepIdx.includes(i)) td.classList.add('sep');
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      const first = model.stages[0], last = model.stages[model.stages.length - 1];
      const dr = document.createElement('tr');
      dr.className = 'delta';
      const d0 = document.createElement('td');
      d0.className = 'l';
      d0.textContent = `Δ ${STAGE_LABEL[last.variant]} − ${STAGE_LABEL[first.variant]}`;
      const d1 = document.createElement('td');
      d1.className = 'l ck';
      dr.append(d0, d1);
      columns.forEach((_, i) => {
        const a = first[key][i], b = last[key][i];
        const td = document.createElement('td');
        if (sepIdx.includes(i)) td.classList.add('sep');
        if (a === null || b === null) {
          td.textContent = 'n/e';
          td.classList.add('ne');
        } else {
          const d = b - a;
          td.textContent = (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d).toFixed(1);
          if (d > 0) td.classList.add('up');
          if (d < 0) td.classList.add('down');
        }
        dr.appendChild(td);
      });
      tbody.appendChild(dr);
      table.append(thead, tbody);
    }

    function render() {
      const model = current();
      const columns = data[METRICS[state.metric].columns];
      pillsBox.querySelectorAll('.pill').forEach((b) => {
        const on = b.dataset.model === state.model;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      metricBox.querySelectorAll('button').forEach((b) => {
        const on = b.dataset.metric === state.metric;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      title.textContent = model.name;
      recipe.textContent = model.recipe;
      legend.innerHTML = '';
      model.stages.forEach((s) => {
        const item = document.createElement('span');
        const sw = document.createElement('span');
        sw.className = 'sw';
        sw.style.background = stageColor(s.variant);
        item.append(sw, STAGE_LABEL[s.variant]);
        legend.appendChild(item);
      });
      tip.hidden = true;
      drawChart(model, columns, state.metric);
      drawTable(model, columns, state.metric);
      const notes = [];
      if (model.name in NOTES) notes.push(NOTES[model.name]);
      if (model.stages.some((s) => s[state.metric].includes(null))) {
        notes.push('n/e and – mark conditions the paper did not evaluate for this model.');
      }
      note.textContent = notes.join(' ');
      note.hidden = notes.length === 0;
    }

    let lastWidth = chart.clientWidth;
    new ResizeObserver(() => {
      if (chart.clientWidth !== lastWidth) { lastWidth = chart.clientWidth; render(); }
    }).observe(chart);
    render();
  }

  function start() {
    const root = need(document, '#explorer-widget');
    fetch(DATA_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`${DATA_URL}: HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => init(root, data))
      .catch((err) => {
        const box = document.createElement('p');
        box.className = 'chart-error';
        box.textContent = 'The results explorer failed to load: ' + err.message;
        need(root, '[data-role=chart]').replaceWith(box);
        throw err;
      });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
