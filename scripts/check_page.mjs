// Headless-Chrome check of the project page over the DevTools protocol.
// Usage: node scripts/check_page.mjs <url> <screenshot-dir>
// Fails (exit 1) on: console errors or uncaught exceptions, HTTP >= 400,
// images that don't load, horizontal page overflow, a results table that doesn't
// match the data, a finding card that doesn't link to its finding, or a carousel
// that doesn't cycle. Also reports the visible word count.
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

  // Carousel: next walks through every slide once and wraps to the first.
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
  console.log(`[${vp.name}] images=${report.images} words=${report.words} tables=${report.tables.length} findings=${report.findings.length} slides=${report.carousel.length - 1} height=${Math.ceil(cssContentSize.height)} screenshot=${shotPath}`);
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
