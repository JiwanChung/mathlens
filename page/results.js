/* Results table: the paper's appendix tables, drawn from static/data/results.json
   (exported by scripts/export_page_data.py). null means "not evaluated" (--). */
(function () {
  'use strict';

  const DATA_URL = 'static/data/results.json';
  const CAPTIONS = {
    downstream: 'Downstream accuracy across diagram modifications with output consistency under these conditions. ' +
      'Text indicates performance from textual descriptions instead of diagrams, Raw denotes original human-generated diagrams, ' +
      'Base the newly rendered diagrams, and the other cases semantic-space modifications followed by rendering. –: not evaluated.',
    perception: 'Perception probe accuracy by question types.',
  };
  // Vertical rules before these value columns, as in the paper's tabular specs.
  const RULES = {
    downstream: { columns: ['Text', 'Raw', 'Base', 'Add lines', 'Add shapes', 'Flip', 'Merge', 'Rename', 'Rotate', 'Consistency'],
      before: new Set(['Text', 'Raw', 'Base', 'Add lines', 'Consistency']) },
    perception: { columns: ['Triangle', 'Quadrilateral', 'Parallel', 'Perpendicular', 'Collinear', 'Cocircular',
      'Same len.', 'Val. len.', 'Same ∠', 'Val. ∠'], before: new Set(['Triangle']) },
  };

  function need(root, selector) {
    const el = root.querySelector(selector);
    if (!el) throw new Error('missing element: ' + selector);
    return el;
  }

  function cell(tag, text, cls, attrs) {
    const el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
    return el;
  }

  function header(metric, columns) {
    const rules = RULES[metric];
    if (!rules) throw new Error('no table layout for ' + metric);
    if (JSON.stringify(columns) !== JSON.stringify(rules.columns)) {
      throw new Error(`unexpected ${metric} columns: ` + columns.join(', '));
    }
    const thead = document.createElement('thead');
    const r = document.createElement('tr');
    r.append(cell('th', 'Model'), cell('th', 'Variant'));
    columns.forEach((c) => r.appendChild(cell('th', c, rules.before.has(c) ? 'sep' : '')));
    thead.appendChild(r);
    return thead;
  }

  function body(data, metric, columns) {
    const rules = RULES[metric];
    const tbody = document.createElement('tbody');
    for (const m of data.models) {
      m.stages.forEach((s, j) => {
        const tr = document.createElement('tr');
        if (j === 0) {
          if (tbody.lastChild) tr.className = 'group-start';
          tr.appendChild(cell('td', m.name, 'model', { rowspan: m.stages.length }));
        }
        tr.appendChild(cell('td', s.variant, 'variant', { title: s.checkpoint }));
        const values = s[metric];
        if (values.length !== columns.length) throw new Error(`${m.name}/${s.variant}: ${values.length} values for ${columns.length} columns`);
        values.forEach((v, i) => {
          const td = cell('td', v === null ? '–' : v.toFixed(1), v === null ? 'ne' : '');
          if (rules.before.has(columns[i])) td.classList.add('sep');
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }
    return tbody;
  }

  function init(data) {
    const table = need(document, '#results-table');
    const caption = need(document, '[data-role=table-caption]');
    const buttons = [...need(document, '[data-role=metric]').querySelectorAll('button')];
    function render(metric) {
      const columns = data[metric + '_columns'];
      if (!Array.isArray(columns)) throw new Error('results.json: no columns for ' + metric);
      if (!(metric in CAPTIONS)) throw new Error('no caption for ' + metric);
      table.replaceChildren(header(metric, columns), body(data, metric, columns));
      table.dataset.metric = metric;
      caption.textContent = CAPTIONS[metric];
      buttons.forEach((b) => {
        const on = b.dataset.metric === metric;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    }
    buttons.forEach((b) => b.addEventListener('click', () => render(b.dataset.metric)));
    render('downstream');
  }

  function start() {
    fetch(DATA_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`${DATA_URL}: HTTP ${r.status}`);
        return r.json();
      })
      .then(init)
      .catch((err) => {
        need(document, '[data-role=table-caption]').textContent = 'The results table failed to load: ' + err.message;
        throw err;
      });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
