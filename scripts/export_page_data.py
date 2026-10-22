"""Export the paper's appendix result tables to page/static/data/results.json.

Inputs are the LaTeX sources of the paper (not the raw model outputs):
  tabs/full_main.tex        downstream accuracy per diagram condition + consistency
  tabs/full_perception.tex  perception-probe accuracy per relation type
  tabs/models.tex           checkpoint behind every (model, variant) pair

Every number on the page's results explorer comes from this file. Any row,
cell or model the parser does not recognise is an error.

Usage:
  python3 scripts/export_page_data.py --paper-repo <paper-repo> \
      --paper-dir mathlens_resub/Multimodal_Reasoning_Analysis \
      --out page/static/data/results.json
"""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

DOWNSTREAM_COLUMNS = ["Text", "Raw", "Base", "Add lines", "Add shapes", "Flip",
                      "Merge", "Rename", "Rotate", "Consistency"]
# Header fragments that must appear, in order, in each table's header.
DOWNSTREAM_HEADER = ["Text", "Raw", "Base", "Add", "Add", "Flip", "Merge", "Rename",
                     "Rotate", "Consistency"]
PERCEPTION_COLUMNS = ["Triangle", "Quadrilateral", "Parallel", "Perpendicular", "Collinear",
                      "Cocircular", "Same length", "Value length", "Same angle", "Value angle"]
PERCEPTION_HEADER = ["Tri-", "Quad-", "Parallel", "Perpen-", "Collinear", "Co-",
                     "Same len.", "Val. len.", r"Same $\angle$", r"Val. $\angle$"]

# Results-table model name -> (models.tex section, models.tex name, size group, recipe).
# Recipes follow Sec. 3 of the paper.
MODELS = {
    "VL-Rethinker-7B": ("7--9B Open-Weight", "VL-Rethinker", "7–9B open", "Direct multimodal RL"),
    "ShareVL-R1-7B": ("7--9B Open-Weight", "ShareVL-R1", "7–9B open", "Direct multimodal RL"),
    "R1-OneVision-7B": ("7--9B Open-Weight", "R1-OneVision", "7–9B open", "Multimodal SFT → multimodal RL"),
    "Vision-R1-7B": ("7--9B Open-Weight", "Vision-R1", "7–9B open", "Multimodal SFT → multimodal RL"),
    "Revisual-R1-7B": ("7--9B Open-Weight", "Revisual-R1", "7–9B open", "Textual SFT → multimodal RL"),
    "OVR-7B": ("7--9B Open-Weight", "OVR", "7–9B open", "Textual SFT → multimodal RL"),
    "GLM-4.1V-9B": ("7--9B Open-Weight", "GLM-4.1V", "7–9B open", "Multimodal RL (training data undisclosed)"),
    "VL-Rethinker-72B": ("72B Open-Weight", "VL-Rethinker", "72B open", "Direct multimodal RL"),
    "OpenAI 4O / O3": ("Closed-Weight", "OpenAI", "Closed", "Non-thinking vs. thinking"),
    "Gemini-2.5-Flash": ("Closed-Weight", "Gemini", "Closed", "Non-thinking vs. thinking"),
    "Claude-4-Sonnet": ("Closed-Weight", "Claude", "Closed", "Non-thinking vs. thinking"),
}
VARIANTS = {"Backbone": "backbone", "MM-RL": "mm-rl", "MM-SFT": "mm-sft",
            "Text-SFT": "text-sft", "Thinking": "thinking"}

MULTIROW = re.compile(r"^\\multirow\{(\d+)\}(?:\{\*\}|\*)\{(.+)\}$")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def table_body(text, path):
    """Return (header, rows) where rows are the '&'-split cells of each data line."""
    begin = text.index(r"\toprule")
    end = text.index(r"\bottomrule")
    body = text[begin + len(r"\toprule"):end]
    first_mid = body.index(r"\midrule")
    header = body[:first_mid]
    rows = []
    for line in body[first_mid:].splitlines():
        line = line.strip()
        if not line or line == r"\midrule":
            continue
        if not line.endswith(r"\\"):
            raise ValueError(f"{path}: unexpected line in table body: {line!r}")
        rows.append([c.strip() for c in line[:-2].split("&")])
    return header, rows


def check_header(header, fragments, path):
    pos = 0
    for frag in fragments:
        found = header.find(frag, pos)
        if found < 0:
            raise ValueError(f"{path}: header fragment {frag!r} not found after offset {pos}")
        pos = found + len(frag)


def parse_value(cell, path):
    if cell == "--":
        return None  # the paper reports this condition as not evaluated
    try:
        return float(cell)
    except ValueError:
        raise ValueError(f"{path}: cell is neither a number nor '--': {cell!r}") from None


def parse_results(path, header_fragments, n_values):
    header, rows = table_body(path.read_text(), path)
    check_header(header, header_fragments, path)
    groups = []  # [(model, expected_rows, [(variant, values)])]
    for cells in rows:
        if len(cells) != 2 + n_values:
            raise ValueError(f"{path}: expected {2 + n_values} cells, got {len(cells)}: {cells}")
        name_cell, variant = cells[0], cells[1]
        if name_cell:
            m = MULTIROW.match(name_cell)
            if not m:
                raise ValueError(f"{path}: model cell is not a \\multirow: {name_cell!r}")
            groups.append((m.group(2), int(m.group(1)), []))
        elif not groups:
            raise ValueError(f"{path}: continuation row before any model: {cells}")
        if variant not in VARIANTS:
            raise ValueError(f"{path}: unknown variant {variant!r}")
        groups[-1][2].append((variant, [parse_value(c, path) for c in cells[2:]]))
    for model, expected, stages in groups:
        if len(stages) != expected:
            raise ValueError(f"{path}: {model} spans {expected} rows but has {len(stages)}")
    return groups


def parse_checkpoints(path):
    """(section, name, variant) -> checkpoint string, from tabs/models.tex."""
    text = path.read_text()
    body = text[text.index(r"\toprule"):text.index(r"\bottomrule")]
    out, section, name = {}, None, None
    for line in body.splitlines():
        line = line.strip()
        if not line or line in (r"\toprule", r"\midrule") or line.startswith(r"\textbf{Model}"):
            continue
        sec = re.match(r"^\\multicolumn\{3\}\{l\}\{\\textbf\{(.+)\}\} \\\\$", line)
        if sec:
            section = sec.group(1)
            continue
        if not line.endswith(r"\\"):
            raise ValueError(f"{path}: unexpected line: {line!r}")
        cells = [c.strip() for c in line[:-2].split("&")]
        if len(cells) != 3:
            raise ValueError(f"{path}: expected 3 cells: {cells}")
        if cells[0]:
            name = cells[0]
        if section is None or name is None:
            raise ValueError(f"{path}: row before section/model: {cells}")
        ckpt = cells[2].replace(r"\_", "_")
        ckpt = re.sub(r"\\texttt\{([^}]*)\}", r"\1", ckpt)
        if "\\" in ckpt or "{" in ckpt:
            raise ValueError(f"{path}: unhandled LaTeX in checkpoint cell: {cells[2]!r}")
        key = (section, name, cells[1])
        if key in out:
            raise ValueError(f"{path}: duplicate checkpoint row {key}")
        out[key] = ckpt
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--paper-repo", type=Path, required=True)
    ap.add_argument("--paper-dir", type=Path, required=True,
                    help="paper source directory, relative to --paper-repo")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    paper = args.paper_repo / args.paper_dir
    files = {k: paper / "tabs" / f"{k}.tex" for k in ("full_main", "full_perception", "models")}
    down = parse_results(files["full_main"], DOWNSTREAM_HEADER, len(DOWNSTREAM_COLUMNS))
    perc = parse_results(files["full_perception"], PERCEPTION_HEADER, len(PERCEPTION_COLUMNS))
    ckpts = parse_checkpoints(files["models"])

    if [g[0] for g in down] != [g[0] for g in perc]:
        raise ValueError("model order differs between full_main and full_perception")
    unknown = {g[0] for g in down} ^ set(MODELS)
    if unknown:
        raise ValueError(f"models not in both the tables and MODELS: {sorted(unknown)}")

    used = set()
    models = []
    for (name, _, d_stages), (_, _, p_stages) in zip(down, perc):
        if [v for v, _ in d_stages] != [v for v, _ in p_stages]:
            raise ValueError(f"{name}: variants differ between tables")
        section, ck_name, size, recipe = MODELS[name]
        stages = []
        for (variant, d_vals), (_, p_vals) in zip(d_stages, p_stages):
            key = (section, ck_name, VARIANTS[variant])
            if key not in ckpts:
                raise ValueError(f"{name}/{variant}: no checkpoint row {key} in models.tex")
            used.add(key)
            stages.append({"variant": variant, "checkpoint": ckpts[key],
                           "downstream": d_vals, "perception": p_vals})
        models.append({"name": name, "size": size, "recipe": recipe, "stages": stages})
    if set(ckpts) - used:
        raise ValueError(f"models.tex rows not used: {sorted(set(ckpts) - used)}")

    commit = subprocess.run(["git", "-C", str(args.paper_repo), "rev-parse", "HEAD"],
                            check=True, capture_output=True, text=True).stdout.strip()
    dirty = subprocess.run(["git", "-C", str(args.paper_repo), "status", "--porcelain", "--",
                            str(args.paper_dir / "tabs")],
                           check=True, capture_output=True, text=True).stdout.strip()
    if dirty:
        raise ValueError(f"paper tables have uncommitted changes:\n{dirty}")

    out = {
        "source": {
            "paper_commit": commit,
            "files": {str(args.paper_dir / "tabs" / p.name): sha256(p) for p in files.values()},
            "script": "scripts/export_page_data.py",
            "note": "Appendix tables 'Downstream accuracy across diagram modifications' "
                    "and 'Perception probe accuracy by question types'. null = not evaluated (--).",
        },
        "downstream_columns": DOWNSTREAM_COLUMNS,
        "perception_columns": PERCEPTION_COLUMNS,
        "models": models,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {args.out}: {len(models)} models, "
          f"{sum(len(m['stages']) for m in models)} stages, commit {commit[:7]}")


if __name__ == "__main__":
    main()
