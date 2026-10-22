/* Page chrome: section navigation, examples carousel, and BibTeX copy. */
(function () {
  'use strict';

  function need(root, selector) {
    const el = root.querySelector(selector);
    if (!el) throw new Error('missing element: ' + selector);
    return el;
  }

  // Highlights the nav link of the section currently at the top of the viewport.
  function initNav() {
    const links = [...document.querySelectorAll('[data-nav]')];
    if (links.length === 0) throw new Error('no navigation links');
    const sections = links.map((l) => {
      const target = document.getElementById(l.getAttribute('href').slice(1));
      if (!target) throw new Error('nav target missing: ' + l.getAttribute('href'));
      return target;
    });
    function update() {
      const y = window.scrollY + 80;
      let current = -1;
      sections.forEach((sec, i) => { if (sec.offsetTop <= y) current = i; });
      // The last section is too short to reach the top; at the bottom of the page it is the current one.
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) current = sections.length - 1;
      links.forEach((l, i) => l.classList.toggle('active', i === current));
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
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
    initNav();
    initCarousel();
    initCopy();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
