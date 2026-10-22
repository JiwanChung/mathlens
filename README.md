# What MLLMs Learn about When they Learn about Multimodal Reasoning

Jiwan Chung, Neel Joshi, Pratyusha Sharma, Youngjae Yu, Vibhav Vineet
(Microsoft Research AI Frontiers, Yonsei University, Seoul National University) · NeurIPS 2026

[Project page](https://jiwanchung.github.io/mathlens/) · [Paper](https://arxiv.org/abs/2510.01719)

## Project page

`page/` holds the static project page. Layout and styles are adapted from the
[Academic Project Page Template](https://github.com/eliahuhorwitz/Academic-project-page-template).
`.github/workflows/deploy.yml` publishes `page/` to GitHub Pages on every push to `main`.

- `page/index.html`: page content. Five finding cards up top link to the paper's Findings 1–5,
  each shown as a claim, one line of numbers, and its figure. Figures are from the paper; the
  abstract is collapsed. The styles follow the deployed `rethinking-state-tracking` page.
- `page/page.js`: the examples carousel and BibTeX copy.
- `page/mathlens.js`: the interactive MathLens section, built on the paper's running example
  (Figs. 2 and 3). It covers the three tests, the error types, the semantic state → artifact
  mapping, and diagram modifications. The diagram is an SVG traced from Fig. 3(e). Modified
  diagrams are transforms of that SVG (flip, rotate, relabel, added line or shape), not dataset
  files.
- `page/results.js`: the Results table, drawn from `page/static/data/results.json`.
- `page/static/data/results.json`: the paper's appendix tables (downstream accuracy across diagram
  modifications, perception-probe accuracy by relation type, and the checkpoint behind each row).
  `scripts/export_page_data.py` parses them from the paper's LaTeX source and records the source
  commit and each file's SHA-256 under `source`. `null` marks a condition the paper did not evaluate.
- `page/static/figures/`: paper figures rendered from the paper PDFs by `scripts/render_figures.sh`
  (`pdftoppm`, 2400 px wide for main-body figures and 1440 px for appendix examples).
- `scripts/check_page.mjs`: headless-Chrome check at 1280 px and 390 px. It fails on console errors,
  HTTP errors, images that don't load, horizontal page overflow, Results-table cells that don't
  match `results.json`, finding cards that don't link to their finding, a broken abstract toggle,
  or carousel slides that don't switch. It reports the visible word count and saves full-page
  screenshots.

Preview and check locally:

```bash
cd page && python3 -m http.server 8914 --bind 127.0.0.1   # then open http://127.0.0.1:8914/
node scripts/check_page.mjs http://127.0.0.1:8914/ /tmp/mathlens-shots
```

Regenerate the data and figures from the paper source:

```bash
python3 scripts/export_page_data.py --paper-repo <paper-repo> \
    --paper-dir mathlens_resub/Multimodal_Reasoning_Analysis --out page/static/data/results.json
scripts/render_figures.sh <paper-repo>/mathlens_resub/Multimodal_Reasoning_Analysis
```

## Citation

```bibtex
@inproceedings{chung2025whatmllms,
  title={What MLLMs Learn about When they Learn about Multimodal Reasoning},
  author={Chung, Jiwan and Joshi, Neel and Sharma, Pratyusha and Yu, Youngjae and Vineet, Vibhav},
  booktitle={Advances in Neural Information Processing Systems: NeurIPS},
  year={2026}
}
```
