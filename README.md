# What MLLMs Learn about When they Learn about Multimodal Reasoning

Jiwan Chung, Neel Joshi, Pratyusha Sharma, Youngjae Yu, Vibhav Vineet
(Microsoft Research AI Frontiers, Yonsei University, Seoul National University) · NeurIPS 2026

[Project page](https://jiwanchung.github.io/mathlens/) · [Paper](https://arxiv.org/abs/2510.01719)

## Project page

`page/` holds the static project page. Layout and styles are adapted from the
[Academic Project Page Template](https://github.com/eliahuhorwitz/Academic-project-page-template).
`.github/workflows/deploy.yml` publishes `page/` to GitHub Pages on every push to `main`.

- `page/index.html`: page content. Text and figures are from the paper. The layout follows the
  deployed `rethinking-state-tracking` page.
- `page/page.js`: math rendering (KaTeX), the Analysis finding cards, the examples carousel, and BibTeX copy.
- `page/results.js`: the Results table, drawn from `page/static/data/results.json`.
- `page/static/data/results.json`: the paper's appendix tables (downstream accuracy across diagram
  modifications, perception-probe accuracy by relation type, and the checkpoint behind each row).
  `scripts/export_page_data.py` parses them from the paper's LaTeX source and records the source
  commit and each file's SHA-256 under `source`. `null` marks a condition the paper did not evaluate.
- `page/static/figures/`: paper figures rendered from the paper PDFs by `scripts/render_figures.sh`
  (`pdftoppm`, 2400 px wide for main-body figures and 1440 px for appendix examples).
- `scripts/check_page.mjs`: headless-Chrome check at 1280 px and 390 px. It fails on console errors,
  HTTP errors, images that don't load, KaTeX errors, horizontal page overflow, Results-table cells
  that don't match `results.json`, or finding cards / carousel slides that don't switch. It also
  saves full-page screenshots.

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
