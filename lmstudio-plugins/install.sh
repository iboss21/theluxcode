#!/usr/bin/env bash
# RegesCore for LM Studio - installer (macOS / Linux)
#
# Brand and engineering by davidio.dev
# https://davidio.dev
#
# Copies both plugins into LM Studio's plugin folder and installs their
# dependencies. LM Studio picks them up on next launch.
#
#   ./install.sh              install both plugins
#   ./install.sh --link       symlink instead of copy (for development)
#   ./install.sh --uninstall  remove both plugins

set -euo pipefail

OWNER="davidio-dev"
PLUGINS=("regescore" "regescore-gateway")
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE="copy"
for arg in "$@"; do
  case "$arg" in
    --link) MODE="link" ;;
    --uninstall) MODE="uninstall" ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

# Mirrors LM Studio's own resolution order: the home pointer file first, then
# ~/.cache/lm-studio, then ~/.lmstudio.
find_lmstudio_home() {
  local pointer="$HOME/.lmstudio-home-pointer"
  if [[ -f "$pointer" ]]; then
    tr -d '[:space:]' < "$pointer"
    return
  fi
  if [[ -d "$HOME/.cache/lm-studio" ]]; then
    echo "$HOME/.cache/lm-studio"
    return
  fi
  echo "$HOME/.lmstudio"
}

LMS_HOME="$(find_lmstudio_home)"
PLUGIN_ROOT="$LMS_HOME/extensions/plugins/$OWNER"

echo "LM Studio home:  $LMS_HOME"
echo "Plugin folder:   $PLUGIN_ROOT"

if [[ ! -d "$LMS_HOME" ]]; then
  echo
  echo "error: $LMS_HOME does not exist." >&2
  echo "Start LM Studio at least once so it creates its home folder, then re-run." >&2
  exit 1
fi

if [[ "$MODE" == "uninstall" ]]; then
  for plugin in "${PLUGINS[@]}"; do
    target="$PLUGIN_ROOT/$plugin"
    if [[ -e "$target" || -L "$target" ]]; then
      rm -rf "$target"
      echo "removed $target"
    else
      echo "not installed: $plugin"
    fi
  done
  echo
  echo "Done. Restart LM Studio."
  exit 0
fi

mkdir -p "$PLUGIN_ROOT"

for plugin in "${PLUGINS[@]}"; do
  src="$SOURCE_DIR/$plugin"
  target="$PLUGIN_ROOT/$plugin"

  if [[ ! -f "$src/manifest.json" ]]; then
    echo "error: $src/manifest.json not found" >&2
    exit 1
  fi

  # Replacing an install: take the old one out rather than merging into it, so
  # a renamed or deleted source file cannot linger and get loaded.
  if [[ -e "$target" || -L "$target" ]]; then
    echo "replacing existing $plugin"
    rm -rf "$target"
  fi

  if [[ "$MODE" == "link" ]]; then
    ln -s "$src" "$target"
    echo "linked  $plugin -> $src"
  else
    mkdir -p "$target"
    # node_modules and the .lmstudio build cache are rebuilt at the target.
    tar -C "$src" \
        --exclude node_modules \
        --exclude .lmstudio \
        --exclude '*.test.ts' \
        -cf - . | tar -C "$target" -xf -
    echo "copied  $plugin"
  fi

  install_dir="$target"
  [[ "$MODE" == "link" ]] && install_dir="$src"
  if command -v npm >/dev/null 2>&1; then
    echo "        installing dependencies..."
    (cd "$install_dir" && npm install --silent --no-audit --no-fund --omit=dev)
  else
    echo "        npm not found on PATH; LM Studio will install dependencies itself"
  fi
done

TEMPLATE="$SOURCE_DIR/regescore/templates/regescore_fable5.jinja"
cat <<EOF

Installed. Restart LM Studio.

Next steps
  1. Plugin list         enable "regescore" and configure the doctrine trigger.
  2. Model dropdown      "regescore-gateway" appears there; point it at your
                         endpoint under its global settings.
  3. Chat template       plugins cannot set a model's Jinja template. Open
                         My Models > your model > Prompt Template and paste:
                         $TEMPLATE

For the Claude Code failures this ships with, also set in your shell:
  export CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1
  export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1

RegesCore // Fable 5 - davidio.dev
EOF
