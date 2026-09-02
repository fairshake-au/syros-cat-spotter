#!/bin/sh
# Assemble the standalone one-pagers by inlining style.css into each body fragment.
# Run from docs/marketing:  sh build.sh
set -e
for f in charities boundless-life media workspace gate; do
  { sed -n '1,/<!--STYLE-->/p' "$f.body.html" | sed '$d'
    echo '<style>'
    cat style.css
    echo '</style>'
    sed -n '/<!--STYLE-->/,$p' "$f.body.html" | sed '1d'
  } > "$f.html"
  echo "built $f.html"
done
