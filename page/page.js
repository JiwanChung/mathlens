/* Page chrome: math rendering, section-nav scrollspy, example tabs, BibTeX copy. */
(function () {
  'use strict';

  function need(root, selector) {
    const el = root.querySelector(selector);
    if (!el) throw new Error('missing element: ' + selector);
    return el;
  }

  function renderMath() {
    renderMathInElement(document.body, {
      delimiters: [
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: true,
    });
  }

  // The active nav item is the last section whose top has scrolled above
  // a quarter of the viewport (and at least below the stuck nav's height).
  // At the bottom of the page the last item is active, since a short final
  // section can never scroll that far up.
  function initScrollspy() {
    const nav = need(document, '.section-nav');
    const links = [...nav.querySelectorAll('a[href^="#"]')];
    const sections = links.map((a) => need(document, a.getAttribute('href')));
    let queued = false;
    function update() {
      queued = false;
      const edge = Math.max(nav.offsetHeight + 8, window.innerHeight * 0.25);
      const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      let active = -1;
      sections.forEach((sec, i) => { if (sec.getBoundingClientRect().top <= edge) active = i; });
      if (atBottom && active >= 0) active = sections.length - 1;
      links.forEach((a, i) => {
        a.classList.toggle('is-active', i === active);
        if (i === active) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
      });
      if (active >= 0) {
        const a = links[active], ul = a.parentElement.parentElement;
        const left = a.offsetLeft - ul.clientWidth / 2 + a.offsetWidth / 2;
        if (ul.scrollWidth > ul.clientWidth) ul.scrollTo({ left: left, behavior: 'auto' });
      }
    }
    window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  // Example gallery: each tab shows the figure whose id is in its aria-controls.
  function initTabs() {
    const list = need(document, '[data-role=example-tabs]');
    const tabs = [...list.querySelectorAll('[role=tab]')];
    if (tabs.length === 0) throw new Error('example tabs: no tabs');
    const panels = tabs.map((t) => need(document, '#' + t.getAttribute('aria-controls')));
    function select(i, focus) {
      tabs.forEach((t, j) => {
        const on = i === j;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        panels[j].hidden = !on;
      });
      if (focus) tabs[i].focus();
    }
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(i, false));
      t.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); select((i + 1) % tabs.length, true); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); select((i - 1 + tabs.length) % tabs.length, true); }
      });
    });
    select(0, false);
  }

  function initCopy() {
    const btn = need(document, '[data-role=copy-bibtex]');
    const label = need(btn, 'span');
    const icon = need(btn, 'use');
    btn.addEventListener('click', () => {
      const text = need(document, '#bibtex-text').textContent;
      navigator.clipboard.writeText(text).then(() => {
        label.textContent = 'Copied';
        icon.setAttribute('href', '#i-check');
        setTimeout(() => { label.textContent = 'Copy BibTeX'; icon.setAttribute('href', '#i-copy'); }, 2000);
      }, (err) => {
        label.textContent = 'Copy failed';
        throw err;
      });
    });
  }

  function init() {
    renderMath();
    initScrollspy();
    initTabs();
    initCopy();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
