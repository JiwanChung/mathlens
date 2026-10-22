// Headless-Chrome check of the project page over the DevTools protocol.
// Usage: node scripts/check_page.mjs <url> <screenshot-dir>
// Fails (exit 1) on: console errors or uncaught exceptions, HTTP >= 400,
// images that don't load, KaTeX errors, horizontal page overflow,
// or an explorer / tab state that doesn't match the data.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, shotDir] = process.argv.slice(2);
if (!url || !shotDir) { console.error('usage: node scripts/check_page.mjs <url> <screenshot-dir>'); process.exit(2); }

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const VIEWPORTS = [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844 }];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDebugger() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chrome debugger did not come up');
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
  // Hidden tab panels never load lazily; show each briefly so its image loads.
  const panels = [...document.querySelectorAll('.example')];
  panels.forEach((p) => { p.hidden = false; });
  await Promise.all(imgs.map((i) => i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; })));
  const badImgs = imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.getAttribute('src'));
  panels.forEach((p, j) => { p.hidden = j !== 0; });

  const report = {
    images: imgs.length, badImgs,
    katex: document.querySelectorAll('.katex').length,
    katexErrors: document.querySelectorAll('.katex-error').length,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    explorer: [], tabs: [],
  };

  const data = await (await fetch('static/data/results.json')).json();
  const pills = [...document.querySelectorAll('#explorer-widget .pill')];
  const metrics = [...document.querySelectorAll('#explorer-widget [data-role=metric] button')];
  for (const pill of pills) {
    for (const mb of metrics) {
      pill.click(); mb.click();
      await sleep(30);
      const model = data.models.find((m) => m.name === pill.dataset.model);
      const key = mb.dataset.metric;
      const values = model.stages.flatMap((s) => s[key]);
      const rects = document.querySelectorAll('#explorer-widget [data-role=chart] svg rect').length;
      const rows = document.querySelectorAll('#explorer-widget [data-role=table] tbody tr').length;
      // Every rendered table cell must equal the data, formatted to one decimal.
      const cells = [...document.querySelectorAll('#explorer-widget [data-role=table] tbody tr:not(.delta)')]
        .flatMap((tr) => [...tr.querySelectorAll('td')].slice(2).map((td) => td.textContent));
      const expected = values.map((v) => v === null ? 'n/e' : v.toFixed(1));
      report.explorer.push({
        model: model.name, metric: key,
        rectsOk: rects === values.filter((v) => v !== null).length,
        rowsOk: rows === model.stages.length + 1,
        cellsOk: JSON.stringify(cells) === JSON.stringify(expected),
        title: document.querySelector('#explorer-widget [data-role=title]').textContent === model.name,
      });
    }
  }
  const tabs = [...document.querySelectorAll('[data-role=example-tabs] [role=tab]')];
  for (const t of tabs) {
    t.click();
    await sleep(10);
    const visible = panels.filter((p) => !p.hidden).map((p) => p.id);
    report.tabs.push({ tab: t.id, ok: visible.length === 1 && visible[0] === t.getAttribute('aria-controls') });
  }
  tabs[0].click();
  // Restore the default explorer state for the screenshot.
  document.querySelector('#explorer-widget .pill[data-model="Revisual-R1-7B"]').click();
  metrics[0].click();
  report.overflowAfter = document.documentElement.scrollWidth - window.innerWidth;
  return report;
})()`;

async function checkViewport(vp, failures) {
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
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
  if (report.katex === 0) bad.push('no KaTeX output');
  if (report.katexErrors) bad.push(`${report.katexErrors} KaTeX errors`);
  if (report.overflow > 0 || report.overflowAfter > 0) bad.push(`horizontal overflow ${report.overflow}/${report.overflowAfter}px`);
  for (const e of report.explorer) if (!(e.rectsOk && e.rowsOk && e.cellsOk && e.title)) bad.push('explorer mismatch: ' + JSON.stringify(e));
  for (const t of report.tabs) if (!t.ok) bad.push('tab mismatch: ' + t.tab);
  console.log(`[${vp.name}] images=${report.images} katex=${report.katex} explorer-states=${report.explorer.length} tabs=${report.tabs.length} height=${Math.ceil(cssContentSize.height)} screenshot=${shotPath}`);
  bad.forEach((b) => console.log(`[${vp.name}] FAIL ${b}`));
  failures.push(...bad);
  cdp.close();
}

const profile = mkdtempSync(join(tmpdir(), 'mathlens-check-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars'], { stdio: 'ignore' });
const failures = [];
try {
  await waitForDebugger();
  for (const vp of VIEWPORTS) await checkViewport(vp, failures);
} finally {
  chrome.kill();
}
if (failures.length) { console.log(`${failures.length} problem(s)`); process.exit(1); }
console.log('all checks passed');
