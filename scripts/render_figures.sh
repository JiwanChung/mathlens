#!/bin/sh
# Render the paper's figure PDFs into page/static/figures/.
# Usage: scripts/render_figures.sh <paper-dir>   (the directory holding pics/)
set -eu
[ $# -eq 1 ] || { echo "usage: $0 <paper-dir>" >&2; exit 2; }
pics="$1/pics"
out="$(dirname "$0")/../page/static/figures"
mkdir -p "$out"

# Main-body figures: 2400 px wide.
for f in fixed_fig1 mathlens_main2 fixed_fig3 1_base new_v2_visual_vs_text-main \
         new_v4_perception-main x_reflection_main v5_breakdown-main \
         v8_visual_robustness-main new_v3_diagram_ood-main v6_perception_radar-main; do
  pdftoppm -png -singlefile -scale-to-x 2400 -scale-to-y -1 "$pics/$f.pdf" "$out/$f"
done

# Appendix examples are tall and shown at most 720 px wide: 1440 px.
for f in mathlens_ax_sample_perc1 mathlens_ax_sample_changed1 mathlens_ax_sample_changed2 \
         mathlens_ax_sample_failure1 mathlens_ax_sample_failure2; do
  pdftoppm -png -singlefile -scale-to-x 1440 -scale-to-y -1 "$pics/$f.pdf" "$out/$f"
done
# This one is mostly a photograph, so JPEG.
pdftoppm -jpeg -jpegopt quality=85 -singlefile -scale-to-x 1440 -scale-to-y -1 \
  "$pics/mathlens_ax_sample_general1.pdf" "$out/mathlens_ax_sample_general1"
