/* Page chrome: math rendering, finding cards, examples carousel, BibTeX copy. */
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

  function initFindings() {
    const cards = [...document.querySelectorAll('.finding-card')];
    const panels = [...document.querySelectorAll('.finding-detail-content')];
    if (cards.length === 0 || cards.length !== panels.length) throw new Error('finding cards and panels do not match');
    function select(idx) {
      cards.forEach((c) => {
        const on = c.dataset.finding === idx;
        c.classList.toggle('active', on);
        c.setAttribute('aria-pressed', String(on));
      });
      panels.forEach((p) => { p.hidden = p.dataset.finding !== idx; });
    }
    cards.forEach((card) => card.addEventListener('click', () => select(card.dataset.finding)));
    select(cards[0].dataset.finding);
  }

  function initCarousel() {
    const root = need(document, '[data-role=carousel]');
    const slides = [...root.querySelectorAll('.carousel-slide')];
    if (slides.length === 0) throw new Error('carousel has no slides');
    const count = need(root, '[data-role=count]');
    let i = 0;
    function show(j) {
      i = (j + slides.length) % slides.length;
      slides.forEach((s, k) => { s.hidden = k !== i; });
      const title = slides[i].dataset.title;
      if (!title) throw new Error('carousel slide without data-title');
      count.textContent = `${i + 1} / ${slides.length} · ${title}`;
    }
    need(root, '[data-role=prev]').addEventListener('click', () => show(i - 1));
    need(root, '[data-role=next]').addEventListener('click', () => show(i + 1));
    root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') show(i - 1);
      if (e.key === 'ArrowRight') show(i + 1);
    });
    show(0);
  }

  function initCopy() {
    const btn = need(document, '[data-role=copy-bibtex]');
    btn.addEventListener('click', () => {
      const text = need(document, '#bibtex-text').textContent;
      navigator.clipboard.writeText(text).then(() => {
        btn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i>'; }, 2000);
      }, (err) => { throw err; });
    });
  }

  function init() {
    renderMath();
    initFindings();
    initCarousel();
    initCopy();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
