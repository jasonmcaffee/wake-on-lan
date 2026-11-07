#!/usr/bin/env bash
# Renders every docs/diagrams/*.mmd mermaid source to docs/images/<name>.png.
# The README and docs show these images so the diagrams display everywhere, including viewers that do not run mermaid
# (such as the GitHub mobile app). Run this after editing a diagram and commit the PNGs with the source.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p docs/images
for src in docs/diagrams/*.mmd; do
  name="$(basename "$src" .mmd)"
  echo "rendering $src -> docs/images/$name.png"
  npx -y @mermaid-js/mermaid-cli@12.2.0 -i "$src" -o "docs/images/$name.png" -b white -s 2 -q
done
