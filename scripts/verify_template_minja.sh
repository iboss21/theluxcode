#!/usr/bin/env bash
# Verify the RegesCore chat template against minja, the Jinja engine that
# LM Studio and llama.cpp actually use.
#
# Brand and engineering by davidio.dev - https://davidio.dev
#
# The Python test suite renders with Jinja2, which is more permissive than
# minja: it implements filters, tests and scoping rules minja does not. A
# template can pass every Python test and still fail to load in LM Studio.
# This builds a small minja harness and renders the same fixtures through it,
# so constructs minja cannot handle are caught here rather than in the app.
#
#   ./scripts/verify_template_minja.sh
#
# Requires: g++ with C++17, curl, python3. Sources are cached under
# .cache/minja/ after the first run.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="$REPO_ROOT/.cache/minja"
TEMPLATE="$REPO_ROOT/config/chat_templates/regescore_fable5.jinja"

MINJA_URL="https://raw.githubusercontent.com/google/minja/main/include/minja/minja.hpp"
JSON_URL="https://raw.githubusercontent.com/nlohmann/json/develop/single_include/nlohmann/json.hpp"

for tool in g++ curl python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool is required" >&2; exit 1; }
done

mkdir -p "$CACHE/nlohmann"

if [[ ! -f "$CACHE/minja.hpp" ]]; then
  echo "fetching minja.hpp..."
  curl -sSL -o "$CACHE/minja.hpp" "$MINJA_URL"
fi
if [[ ! -f "$CACHE/nlohmann/json.hpp" ]]; then
  echo "fetching nlohmann/json.hpp..."
  curl -sSL -o "$CACHE/nlohmann/json.hpp" "$JSON_URL"
fi

if [[ ! -x "$CACHE/render" ]] || [[ "$REPO_ROOT/scripts/minja/render.cpp" -nt "$CACHE/render" ]]; then
  echo "building the minja harness..."
  g++ -std=c++17 -O1 -I"$CACHE" -o "$CACHE/render" "$REPO_ROOT/scripts/minja/render.cpp"
fi

echo "rendering fixtures through minja..."
RENDER_BIN="$CACHE/render" TEMPLATE_FILE="$TEMPLATE" WORK_DIR="$CACHE" \
  python3 "$REPO_ROOT/scripts/minja/run_fixtures.py"
