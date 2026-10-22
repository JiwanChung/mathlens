// Headless-Chrome check of the project page over the DevTools protocol.
// Usage: node scripts/check_page.mjs <url> <screenshot-dir>
// Fails (exit 1) on: console errors or uncaught exceptions, HTTP >= 400,
// images that don't load, horizontal page overflow, a results table that doesn't
// match the data, a finding card that doesn't link to its finding, a MathLens demo
// state that doesn't match the paper's example, or a carousel that doesn't cycle.
// Also reports the visible word count.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, shotDir] = process.argv.slice(2);
if (!url || !shotDir) { console.error('usage: node scripts/check_page.mjs <url> <screenshot-dir>'); process.exit(2); }

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWPORTS = [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844 }];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chrome is started with --remote-debugging-port=0 and writes the port it picked to
// DevToolsActivePort in its own profile, so we only ever talk to the instance we launched.
async function waitForDebugger(profile) {
  const file = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 50; i++) {
    if (existsSync(file)) {
      const port = Number(readFileSync(file, 'utf8').split('\n')[0]);
      if (!Number.isInteger(port) || port <= 0) throw new Error(`bad DevToolsActivePort contents in ${file}`);
      return port;
    }
    await sleep(200);
  }
  throw new Error('Chrome debugger did not come up: no ' + file);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
    } else if (msg.method) {
      listeners.forEach((f) => f(msg));
    }
  };
  const ready = new Promise((r) => { ws.onopen = r; });
  return {
    ready,
    send(method, params = {}) {
      const mid = ++id;
      ws.send(JSON.stringify({ id: mid, method, params }));
      return new Promise((resolve, reject) => pending.set(mid, { resolve, reject }));
    },
    on(f) { listeners.push(f); },
    close() { ws.close(); },
  };
}

async function evaluate(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

// Runs inside the page. Returns a report object.
const PAGE_CHECKS = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const imgs = [...document.querySelectorAll('img')];
  imgs.forEach((i) => { i.loading = 'eager'; });
  // Hidden slides never load lazily; unhide them briefly so their images load.
  const hidden = [...document.querySelectorAll('.carousel-slide')].filter((e) => e.hidden);
  hidden.forEach((e) => { e.hidden = false; });
  await Promise.all(imgs.map((i) => i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; })));
  const badImgs = imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.getAttribute('src'));
  hidden.forEach((e) => { e.hidden = true; });

  const report = {
    images: imgs.length, badImgs,
    // Prose words a reader sees without opening anything (tables and BibTeX excluded).
    words: (() => {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll('table, pre, script, noscript, [hidden], details:not([open]) > :not(summary)').forEach((e) => e.remove());
      return clone.textContent.split(/\\s+/).filter(Boolean).length;
    })(),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    tables: [], findings: [], carousel: [],
  };

  // Results table: every value cell must equal results.json, formatted to one decimal.
  const data = await (await fetch('static/data/results.json')).json();
  for (const b of document.querySelectorAll('[data-role=metric] button')) {
    b.click();
    await sleep(30);
    const key = b.dataset.metric;
    const rows = [...document.querySelectorAll('#results-table tbody tr')];
    const cells = rows.map((tr) => [...tr.querySelectorAll('td')].filter((td) => !td.classList.contains('model') && !td.classList.contains('variant')).map((td) => td.textContent));
    const expected = data.models.flatMap((m) => m.stages.map((s) => s[key].map((v) => v === null ? '–' : v.toFixed(1))));
    const variants = rows.map((tr) => tr.querySelector('td.variant').textContent);
    report.tables.push({
      metric: key,
      cellsOk: JSON.stringify(cells) === JSON.stringify(expected),
      variantsOk: JSON.stringify(variants) === JSON.stringify(data.models.flatMap((m) => m.stages.map((s) => s.variant))),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    });
  }
  document.querySelector('[data-role=metric] button').click();

  // Finding cards: each links to a finding article that has a title and a figure.
  for (const c of document.querySelectorAll('.finding-card')) {
    const href = c.getAttribute('href');
    const target = href && href.startsWith('#') ? document.getElementById(href.slice(1)) : null;
    report.findings.push({ card: href, ok: !!target && target.matches('article.finding') && !!target.querySelector('.finding-title') && target.querySelectorAll('img').length > 0 });
  }
  // Abstract opens and closes.
  const abs = document.querySelector('details.abstract-details');
  report.abstractOk = !!abs && !abs.open && (abs.querySelector('summary').click(), abs.open) && (abs.querySelector('summary').click(), !abs.open);

  // MathLens demos.
  const q = (sel) => document.querySelector(sel);
  const click = async (sel) => { const e = q(sel); if (!e) throw new Error('missing ' + sel); e.click(); await sleep(10); };
  const hlIn = (sel) => document.querySelectorAll(sel + ' .hl').length;
  const demos = [];
  const dc = q('[data-role=decomp]');
  const visibleViews = () => [...dc.querySelectorAll('[data-lane-view]')].filter((v) => !v.hidden).map((v) => v.dataset.laneView);
  for (const lane of ['perc', 'reas', 'mm']) {
    await click('[data-lane=' + lane + ']');
    const views = visibleViews();
    demos.push(['lane ' + lane, dc.dataset.lane === lane && views.length > 0 && views.every((v) => v.split(' ').includes(lane))]);
  }
  await click('[data-lane=perc]');
  await click('[data-probe=col-AFD]');
  demos.push(['probe', q('[data-role=probe-answer]').textContent === 'B. AFD' && hlIn('[data-role=decomp-diagram]') > 0]);
  await click('[data-probe=ang-DFB]');
  await click('[data-lane=mm]');
  demos.push(['lane mm clears highlight', hlIn('[data-role=decomp-diagram]') === 0]);
  // Key: perception pass, reasoning pass (1 = correct).
  const expectCat = { '00': 'pr', '01': 'p', '10': 'r', '11': 'mm' };
  const setOutcome = async (lane, pass) => { await click('[data-lane=' + lane + '] [data-pass="' + (pass ? 1 : 0) + '"]'); };
  for (const p of [0, 1]) for (const r of [0, 1]) for (const m of [0, 1]) {
    await setOutcome('perc', p); await setOutcome('reas', r); await setOutcome('mm', m);
    const want = m ? 'correct' : expectCat['' + p + r];
    const shown = [...dc.querySelectorAll('[data-result]')].filter((e) => !e.hidden).map((e) => e.dataset.result);
    const lit = [...dc.querySelectorAll('.err-cell.active')].map((e) => e.dataset.category);
    demos.push(['outcome P' + p + 'R' + r + 'M' + m, dc.dataset.category === want && shown.length === 1 && shown[0] === want
      && JSON.stringify(lit) === JSON.stringify(m ? [] : [want])]);
  }
  await setOutcome('perc', 1); await setOutcome('reas', 1); await setOutcome('mm', 0); await click('[data-lane=mm]');
  for (const b of document.querySelectorAll('[data-role=gen] .pred-btn')) {
    b.click(); await sleep(5);
    demos.push(['gen ' + b.dataset.key, hlIn('[data-role=gen-diagram]') > 0 && hlIn('[data-role=gen] .gen-out .io-box') > 0]);
  }
  await click('[data-role=gen] [data-key=ang-BDF].pred-btn');
  const ptA = () => { const c = q('[data-role=mods-diagram] circle.pt'); return c.getAttribute('cx') + ',' + c.getAttribute('cy'); };
  await click('[data-mod=original]');
  const origA = ptA();
  for (const b of document.querySelectorAll('[data-role=mods] button[data-mod]')) {
    b.click(); await sleep(5);
    const mod = b.dataset.mod;
    const qtext = q('[data-role=mods-question]').textContent;
    const labels = [...document.querySelectorAll('[data-role=mods-diagram] .plabel')].map((t) => t.textContent).join('');
    let ok = q('[data-role=mods] .answer-value').textContent === '47';
    if (mod === 'rename') ok = ok && qtext === 'Find measure of angle RKP.' && labels === 'KQLPRNM';
    else ok = ok && qtext === 'Find measure of angle IAF.' && labels === 'AGBFIDC';
    if (mod === 'flip' || mod === 'rotate') ok = ok && ptA() !== origA;
    if (mod === 'lines') ok = ok && document.querySelectorAll('[data-role=mods-diagram] line.extra').length === 1;
    if (mod === 'shapes') ok = ok && document.querySelectorAll('[data-role=mods-diagram] circle.extra').length === 1;
    demos.push(['mods ' + mod, ok]);
  }
  await click('[data-mod=original]');
  report.demos = demos;


  const slides = [...document.querySelectorAll('.carousel-slide')];
  const next = document.querySelector('[data-role=carousel] [data-role=next]');
  for (let k = 0; k <= slides.length; k++) {
    const visible = slides.map((s, j) => s.hidden ? -1 : j).filter((j) => j >= 0);
    report.carousel.push(visible.length === 1 && visible[0] === k % slides.length);
    next.click();
    await sleep(10);
  }
  document.querySelector('[data-role=carousel] [data-role=prev]').click();
  report.overflowAfter = document.documentElement.scrollWidth - window.innerWidth;
  return report;
})()`;

async function checkViewport(port, vp, failures) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  const problems = [];
  cdp.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      problems.push(`console.${m.params.type}: ` + m.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url ?? ''));
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) problems.push(`HTTP ${m.params.response.status}: ${m.params.response.url}`);
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) problems.push('load failed: ' + m.params.errorText);
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.name === 'phone' });
  await cdp.send('Page.navigate', { url });
  await sleep(4000);
  const report = await evaluate(cdp, PAGE_CHECKS);
  await sleep(300);

  const { cssContentSize } = await cdp.send('Page.getLayoutMetrics');
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: vp.width, height: Math.ceil(cssContentSize.height), scale: 1 },
  });
  const shotPath = join(shotDir, `page-${vp.name}.png`);
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));

  const bad = [];
  if (problems.length) bad.push(...problems);
  if (report.badImgs.length) bad.push('images failed: ' + report.badImgs.join(', '));
  if (!report.abstractOk) bad.push('abstract toggle broken');
  if (report.overflow > 0 || report.overflowAfter > 0) bad.push(`horizontal overflow ${report.overflow}/${report.overflowAfter}px`);
  for (const t of report.tables) if (!(t.cellsOk && t.variantsOk) || t.overflow > 0) bad.push('table mismatch: ' + JSON.stringify(t));
  for (const f of report.findings) if (!f.ok) bad.push('finding card mismatch: ' + f.card);
  if (report.findings.length !== 5) bad.push(`expected 5 finding cards, got ${report.findings.length}`);
  if (report.carousel.length !== 7 || !report.carousel.every(Boolean)) bad.push('carousel mismatch: ' + JSON.stringify(report.carousel));
  const badDemos = report.demos.filter(([, ok]) => !ok).map(([name]) => name);
  if (badDemos.length) bad.push('demo mismatch: ' + badDemos.join(', '));
  if (report.demos.length !== 3 + 2 + 8 + 11 + 6) bad.push(`expected 30 demo checks, got ${report.demos.length}: ` + report.demos.map(([n]) => n).join(', '));
  console.log(`[${vp.name}] images=${report.images} words=${report.words} tables=${report.tables.length} findings=${report.findings.length} slides=${report.carousel.length - 1} demos=${report.demos.length} height=${Math.ceil(cssContentSize.height)} screenshot=${shotPath}`);
  bad.forEach((b) => console.log(`[${vp.name}] FAIL ${b}`));
  failures.push(...bad);
  cdp.close();
}

const profile = mkdtempSync(join(tmpdir(), 'mathlens-check-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars'], { stdio: 'ignore' });
const failures = [];
try {
  const port = await waitForDebugger(profile);
  for (const vp of VIEWPORTS) await checkViewport(port, vp, failures);
} finally {
  chrome.kill();
}
if (failures.length) { console.log(`${failures.length} problem(s)`); process.exit(1); }
console.log('all checks passed');
